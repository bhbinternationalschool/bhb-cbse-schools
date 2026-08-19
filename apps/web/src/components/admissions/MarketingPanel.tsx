"use client";

/**
 * Admissions → Marketing — achievements the office entered (the only
 * source of numbers), positioning notes, and the content generator:
 * pick facts → pick format + languages → variants with flags → a human
 * accepts → Copy / Cross-post. Nothing leaves the page un-accepted.
 */

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  ACHIEVEMENT_KINDS,
  achievementKindLabel,
  achievementsToFactLines,
  loadSchoolAchievements,
  removeAchievement,
  saveSchoolAchievements,
  upsertAchievement,
  type Achievement,
  type AchievementKind,
  type MarketingPositioning,
  type SchoolAchievementsState,
} from "@/lib/schoolAchievements";
import { loadAdmissionsKb } from "@/lib/admissionsKb";
import { complianceFactsToText, loadComplianceFacts } from "@/lib/complianceFacts";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import { HOUSEHOLD_LANGUAGES } from "@/lib/householdPrefs";
import { MARKETING_KINDS, type MarketingKind, type MarketingRegister, type MarketingVariant, type MarketingVariantFlags } from "@/lib/marketingContentAi";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import { buildCrossPostPayload, requestSocialCrossPost, summarizeCrossPostResult } from "@/lib/socialCrossPost";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";

type Draft = { id: string; kind: AchievementKind; academicYearCode: string; title: string; detail: string; metrics: string; date: string; publicSafe: boolean; sourceNote: string };
type Variant = MarketingVariant & { flags: MarketingVariantFlags; accepted: boolean };

export function MarketingPanel({ masters, canEdit, by }: { masters: MastersState | null; canEdit: boolean; by: string }) {
  const ay = masters ? currentAcademicYearCode(masters) : "";
  const [state, setState] = useState<SchoolAchievementsState>(() => loadSchoolAchievements());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pos, setPos] = useState<MarketingPositioning>(state.positioning);
  const [posDirty, setPosDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // generator
  const [kind, setKind] = useState<MarketingKind>("social_post");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [usps, setUsps] = useState("");
  const [langs, setLangs] = useState<string[]>(["en"]);
  const [register, setRegister] = useState<MarketingRegister>("warm");
  const [positioning, setPositioning] = useState(false);
  const [occasion, setOccasion] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"gen" | "post" | null>(null);
  const [result, setResult] = useState<{ variants: Variant[]; generationId: string; engine: string } | null>(null);

  useModuleStateHydration("school_achievements", () => {
    const s = loadSchoolAchievements();
    setState(s);
    if (!posDirty) setPos(s.positioning);
  });
  useEffect(() => {
    const t = notice ? window.setTimeout(() => setNotice(null), 3000) : null;
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [notice]);
  // Seed USPs once from positioning + compliance facts + KB "usp" entries.
  useEffect(() => {
    if (usps) return;
    const fromPos = state.positioning.ours;
    const fromKb = loadAdmissionsKb().entries.filter((e) => e.kind === "usp" && e.publicSafe).map((e) => `${e.title}: ${e.body}`.slice(0, 200));
    const fromCompliance = complianceFactsToText(loadComplianceFacts(), ay).split("\n").filter((l) => l.startsWith("Infrastructure:"))[0] || "";
    const seed = [fromPos, ...fromKb, fromCompliance].filter(Boolean).join("\n");
    if (seed) setUsps(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.positioning.ours]);

  function persist(next: SchoolAchievementsState, msg: string) {
    const saved = saveSchoolAchievements(next);
    setState(saved);
    setNotice(msg);
  }
  function saveDraft() {
    if (!draft) return;
    const metrics = draft.metrics
      .split("\n")
      .map((l) => l.split(/[:=]/))
      .filter((p) => p.length >= 2)
      .map((p) => ({ label: p[0].trim(), value: p.slice(1).join(":").trim() }));
    const r = upsertAchievement(state, { ...draft, id: draft.id || undefined, metrics, by });
    if (!r.ok) return setError(r.error);
    setError(null);
    persist(r.state, draft.id ? "Achievement updated" : "Achievement added");
    setDraft(null);
  }
  function savePositioning() {
    persist({ ...state, positioning: pos }, "Positioning saved");
    setPosDirty(false);
  }

  const publicAch = useMemo(() => state.achievements.filter((a) => a.publicSafe), [state.achievements]);

  async function generate() {
    if (busy) return;
    setBusy("gen");
    setError(null);
    setResult(null);
    try {
      const chosen = publicAch.filter((a) => selected.has(a.id));
      const res = await fetch("/api/ai/marketing-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          positioning,
          audiences: langs.map((language) => ({ language, register })),
          facts: {
            achievementLines: achievementsToFactLines(chosen),
            usps: usps.split("\n").map((l) => l.trim()).filter(Boolean),
            brandLines: pos.brandLines.split("\n").map((l) => l.trim()).filter(Boolean),
            positioningOthers: positioning ? pos.others : "",
            competitorNames: pos.competitorNames.split(/[,\n]/).map((l) => l.trim()).filter(Boolean),
            occasion,
            ctaUrl,
            note,
          },
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; variants?: (MarketingVariant & { flags: MarketingVariantFlags })[]; generationId?: string; engine?: string };
      if (!res.ok || !j.ok || !j.variants) return setError(j.error || "Generation failed");
      setResult({ variants: j.variants.map((v) => ({ ...v, accepted: false })), generationId: j.generationId || "", engine: j.engine || "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(null);
    }
  }

  function accept(i: number) {
    if (!result) return;
    const next = { ...result, variants: result.variants.map((v, idx) => (idx === i ? { ...v, accepted: true } : v)) };
    setResult(next);
    if (result.generationId) {
      reportAiOutcome({ ids: [result.generationId], outcome: "accepted", targetType: "marketing_content", targetId: kind });
      next.generationId = "";
    }
  }
  async function copy(v: Variant) {
    try {
      await navigator.clipboard.writeText(v.subject ? `${v.subject}\n\n${v.text}` : v.text);
      setNotice("Copied");
    } catch {
      setError("Could not copy");
    }
  }
  async function crossPost(v: Variant) {
    if (busy || !v.accepted) return;
    if (!window.confirm("Post this to the school's connected Facebook / Instagram pages now?")) return;
    setBusy("post");
    try {
      const contentId = `mkt_${kind}_${Date.now().toString(36)}`;
      const r = await requestSocialCrossPost(
        buildCrossPostPayload({ kind: "marketing", contentId, title: v.subject || MARKETING_KINDS.find((k) => k.id === kind)?.label || "School update", body: v.text, linkUrl: ctaUrl || undefined }),
      );
      setNotice(summarizeCrossPostResult(r));
      if (!r.ok && r.error) setError(r.error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {notice ? <p className="rounded-lg bg-[var(--success-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--success)]">{notice}</p> : null}
      {error ? <p className="rounded-lg bg-[var(--danger)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}

      {/* Achievements */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <p className="text-sm font-semibold">Achievements &amp; results</p>
            <p className="text-[11px] text-[var(--muted)]">The only source of numbers for marketing copy. Type them from the result sheet / certificate; the generator never adds figures.</p>
          </div>
          {canEdit ? (
            <button type="button" className="ml-auto rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={() => setDraft({ id: "", kind: "board_result", academicYearCode: ay, title: "", detail: "", metrics: "", date: "", publicSafe: true, sourceNote: "" })}>
              + Achievement
            </button>
          ) : null}
        </div>
        {draft ? (
          <div className="mt-2 grid gap-2 rounded-lg border border-[var(--border)] p-2 sm:grid-cols-3">
            <label className="text-xs text-[var(--muted)]">
              Kind
              <select className={`${inp} mt-0.5`} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AchievementKind })}>
                {ACHIEVEMENT_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">
              Session
              <input className={`${inp} mt-0.5`} value={draft.academicYearCode} onChange={(e) => setDraft({ ...draft, academicYearCode: e.target.value })} placeholder="2025-26" />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Date
              <input type="date" className={`${inp} mt-0.5`} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </label>
            <label className="text-xs text-[var(--muted)] sm:col-span-3">
              Title
              <input className={`${inp} mt-0.5`} maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Class X CBSE result 2025-26" />
            </label>
            <label className="text-xs text-[var(--muted)] sm:col-span-2">
              Detail ({ACHIEVEMENT_KINDS.find((k) => k.id === draft.kind)?.hint})
              <textarea className={`${inp} mt-0.5 min-h-[4rem]`} maxLength={1200} value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Metrics — one per line, label: value
              <textarea className={`${inp} mt-0.5 min-h-[4rem]`} value={draft.metrics} onChange={(e) => setDraft({ ...draft, metrics: e.target.value })} placeholder={"Pass %: 100\nDistinctions: 42\nSchool topper: 97.2%"} />
            </label>
            <label className="text-xs text-[var(--muted)] sm:col-span-2">
              Source (where the numbers came from)
              <input className={`${inp} mt-0.5`} maxLength={200} value={draft.sourceNote} onChange={(e) => setDraft({ ...draft, sourceNote: e.target.value })} placeholder="CBSE result PDF 13-May-2026" />
            </label>
            <label className="mt-5 inline-flex items-center gap-2 text-xs">
              <input type="checkbox" checked={draft.publicSafe} onChange={(e) => setDraft({ ...draft, publicSafe: e.target.checked })} />
              Safe for public use
            </label>
            <div className="flex gap-2 sm:col-span-3">
              <button type="button" className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]" onClick={saveDraft}>
                Save
              </button>
              <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {state.achievements.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">No achievements yet. Add the latest board result first — it is the strongest admission-season asset.</p>
        ) : (
          <div className="mt-2">
            <ErpTableShell>
              <ErpTable>
                <ErpTableHead>
                  <tr>
                    <th className="px-2 py-2 text-left">Use</th>
                    <th className="px-2 py-2 text-left">Kind</th>
                    <th className="px-2 py-2 text-left">Title</th>
                    <th className="px-2 py-2 text-left">Metrics</th>
                    <th className="px-2 py-2 text-left">Date</th>
                    <th className="px-2 py-2" />
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {state.achievements.map((a: Achievement) => (
                    <tr key={a.id} className="text-xs align-top">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          disabled={!a.publicSafe}
                          checked={selected.has(a.id)}
                          onChange={(e) => setSelected((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(a.id);
                            else n.delete(a.id);
                            return n;
                          })}
                          title={a.publicSafe ? "Use in generated content" : "Not public-safe"}
                        />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{achievementKindLabel(a.kind)}{a.academicYearCode ? ` · ${a.academicYearCode}` : ""}</td>
                      <td className="px-2 py-1.5 font-semibold">{a.title}{!a.publicSafe ? <span className="ml-1 rounded-full bg-[var(--warning-soft)] px-1.5 text-[10px] text-[var(--warning)]">staff only</span> : null}</td>
                      <td className="px-2 py-1.5 text-[var(--muted)]">{a.metrics.map((m) => `${m.label}: ${m.value}`).join(" · ") || "—"}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{a.date || "—"}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {canEdit ? (
                          <>
                            <button type="button" className="text-[var(--brand-deep)] underline" onClick={() => setDraft({ id: a.id, kind: a.kind, academicYearCode: a.academicYearCode, title: a.title, detail: a.detail, metrics: a.metrics.map((m) => `${m.label}: ${m.value}`).join("\n"), date: a.date, publicSafe: a.publicSafe, sourceNote: a.sourceNote })}>
                              Edit
                            </button>
                            <button type="button" className="ml-2 text-[var(--danger)] underline" onClick={() => { if (window.confirm("Remove this achievement?")) persist(removeAchievement(state, a.id), "Removed"); }}>
                              Remove
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            </ErpTableShell>
          </div>
        )}
      </div>

      {/* Positioning */}
      <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <summary className="cursor-pointer text-sm font-semibold">Positioning &amp; brand notes</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-[var(--muted)]">
            Our strengths (one per line — only what the office stands behind)
            <textarea className={`${inp} mt-0.5 min-h-[6rem]`} value={pos.ours} onChange={(e) => { setPos({ ...pos, ours: e.target.value }); setPosDirty(true); }} disabled={!canEdit} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            What nearby schools advertise (contrast only; never named in output)
            <textarea className={`${inp} mt-0.5 min-h-[6rem]`} value={pos.others} onChange={(e) => { setPos({ ...pos, others: e.target.value }); setPosDirty(true); }} disabled={!canEdit} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Competitor names to block (comma separated)
            <input className={`${inp} mt-0.5`} value={pos.competitorNames} onChange={(e) => { setPos({ ...pos, competitorNames: e.target.value }); setPosDirty(true); }} disabled={!canEdit} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Brand lines the generator may reuse verbatim (one per line)
            <textarea className={`${inp} mt-0.5 min-h-[3rem]`} value={pos.brandLines} onChange={(e) => { setPos({ ...pos, brandLines: e.target.value }); setPosDirty(true); }} disabled={!canEdit} />
          </label>
        </div>
        {canEdit ? (
          <button type="button" disabled={!posDirty} className="mt-2 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50" onClick={savePositioning}>
            Save positioning
          </button>
        ) : null}
      </details>

      {/* Generator */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-sm font-semibold">Generate content</p>
        <p className="text-[11px] text-[var(--muted)]">Tick achievements above, choose a format and languages. Every variant is checked for numbers not in the facts, competitor names and sensitive claims, and must be accepted before it can be posted.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-[var(--muted)]">
            Format
            <select className={`${inp} mt-0.5`} value={kind} onChange={(e) => setKind(e.target.value as MarketingKind)}>
              {MARKETING_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Register
            <select className={`${inp} mt-0.5`} value={register} onChange={(e) => setRegister(e.target.value as MarketingRegister)}>
              <option value="warm">Warm</option>
              <option value="formal">Formal</option>
            </select>
          </label>
          <div className="text-xs text-[var(--muted)]">
            Languages
            <div className="mt-1 flex flex-wrap gap-1">
              {HOUSEHOLD_LANGUAGES.map((l) => (
                <button key={l.id} type="button" className={`rounded-full border px-2 py-0.5 text-[11px] ${langs.includes(l.id) ? "border-[var(--brand-deep)] bg-[var(--brand-deep)] text-white" : "border-[var(--border)]"}`} onClick={() => setLangs((p) => (p.includes(l.id) ? p.filter((x) => x !== l.id) : [...p, l.id].slice(-4)))}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <label className="text-xs text-[var(--muted)] sm:col-span-3">
            Strengths to draw on (one per line — seeded from positioning, KB &ldquo;Why this school&rdquo; and compliance facts)
            <textarea className={`${inp} mt-0.5 min-h-[4rem]`} value={usps} onChange={(e) => setUsps(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)] sm:col-span-2">
            Occasion / event facts (what · when · where · RSVP) — required for invites &amp; greetings
            <input className={`${inp} mt-0.5`} maxLength={400} value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="Open House · Sat 24 Aug 2026 · 10 am · campus · RSVP on WhatsApp" />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Call-to-action link
            <input className={`${inp} mt-0.5`} maxLength={200} value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://bhbinternational.school/apply?src=social" />
          </label>
          <label className="text-xs text-[var(--muted)] sm:col-span-2">
            Note to the writer
            <input className={`${inp} mt-0.5`} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. lead with the Class X result, mention the new science lab" />
          </label>
          <label className="mt-5 inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={positioning} onChange={(e) => setPositioning(e.target.checked)} disabled={!pos.others} />
            Differentiate vs what others advertise
          </label>
        </div>
        <button type="button" disabled={busy === "gen" || !canEdit} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50" onClick={() => void generate()}>
          <Sparkles className="h-3.5 w-3.5" />
          {busy === "gen" ? "Generating…" : "Generate"}
        </button>

        {result ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {result.variants.map((v, i) => {
              const blocked = v.flags.forbiddenNames.length > 0;
              const warn = v.flags.ungroundedNumbers.length > 0 || v.flags.sensitiveClaims.length > 0 || v.flags.overLimit;
              return (
                <div key={i} className={`rounded-lg border p-2.5 ${blocked ? "border-[var(--danger)]" : warn ? "border-[var(--warning)]" : "border-[var(--border)]"}`}>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="font-semibold">{HOUSEHOLD_LANGUAGES.find((l) => l.id === v.language)?.label || v.language} · {v.register}</span>
                    <span className="text-[var(--muted)]">{v.text.length} chars · {result.engine}</span>
                    {v.accepted ? <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 font-semibold text-[var(--success)]">accepted</span> : null}
                  </div>
                  {blocked ? <p className="mt-1 text-[11px] font-semibold text-[var(--danger)]">Names a competitor ({v.flags.forbiddenNames.join(", ")}) — cannot be accepted; regenerate.</p> : null}
                  {v.flags.ungroundedNumbers.length ? <p className="mt-1 text-[11px] font-semibold text-[var(--warning)]">Numbers not in the facts: {v.flags.ungroundedNumbers.join(", ")}</p> : null}
                  {v.flags.sensitiveClaims.length ? <p className="mt-1 text-[11px] font-semibold text-[var(--warning)]">Claims needing a human check (CBSE/ASCI): {v.flags.sensitiveClaims.join(", ")}</p> : null}
                  {v.flags.overLimit ? <p className="mt-1 text-[11px] font-semibold text-[var(--warning)]">Longer than this format&apos;s limit.</p> : null}
                  {v.subject ? <p className="mt-1 text-xs font-semibold">{v.subject}</p> : null}
                  <p className="mt-1 whitespace-pre-wrap text-xs" lang={v.language === "en" ? undefined : v.language}>{v.text}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold" onClick={() => void copy(v)}>
                      Copy
                    </button>
                    {!v.accepted ? (
                      <button type="button" disabled={blocked} className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-50" onClick={() => accept(i)} title="I have read this and it is accurate">
                        Accept
                      </button>
                    ) : (
                      <button type="button" disabled={busy === "post"} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50" onClick={() => void crossPost(v)}>
                        Cross-post to FB / IG
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
