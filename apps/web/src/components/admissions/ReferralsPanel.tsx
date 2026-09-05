"use client";

/**
 * Admissions → Referrals & stories.
 * Referrals: every enrolled household has a stable code; invite via
 * WhatsApp (AI-drafted from school facts, or the template), track leads →
 * registered → enrolled per referrer. Rewards are a note — nothing is paid
 * here.
 * Testimonials: request → paste the parent's words → polish (grammar only,
 * guard-checked) → send for approval → mark approved with how consent was
 * given → the Marketing generator may quote it.
 */

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { AdmissionsState } from "@/lib/admissions";
import type { SisState } from "@/lib/sis";
import { ReferralPolicyEditor } from "@/components/admissions/ReferralPolicyEditor";
import {
  approvedTestimonialLines,
  loadReferrals,
  markInvited,
  referralAttribution,
  referralCodeFor,
  removeTestimonial,
  saveReferrals,
  testimonialPolishProblems,
  upsertTestimonial,
  type ReferralsState,
  type Testimonial,
  type TestimonialStatus,
} from "@/lib/referrals";
import { achievementsToFactLines, loadSchoolAchievements } from "@/lib/schoolAchievements";
import { publicEnquiryAbsoluteUrl } from "@/lib/admissions";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";
import { openWaMe } from "@/lib/waMe";
import { TENANT } from "@/lib/types";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";
const STATUS_LABEL: Record<TestimonialStatus, string> = { requested: "Requested", received: "Received", polished: "Polished", approved: "Approved", declined: "Declined" };

function referralLink(code: string): string {
  const base = publicEnquiryAbsoluteUrl("referral");
  return `${base}${base.includes("?") ? "&" : "?"}ref=${encodeURIComponent(code)}`;
}

export function ReferralsPanel({ admissions, sis, canEdit, by }: { admissions: AdmissionsState; sis: SisState; canEdit: boolean; by: string }) {
  const [state, setState] = useState<ReferralsState>(() => loadReferrals());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [inviteText, setInviteText] = useState("");
  const [busy, setBusy] = useState<"invite" | "polish" | null>(null);
  const [tDraft, setTDraft] = useState<{ id: string; householdId: string; parentName: string; studentLabel: string; rawText: string } | null>(null);
  const [polish, setPolish] = useState<{ id: string; text: string; problems: string[]; generationId: string } | null>(null);
  useModuleStateHydration("referrals", () => setState(loadReferrals()));

  const households = useMemo(() => sis.households.map((h) => ({ id: h.id, code: h.code, mobile: h.mobile, whatsappMobile: h.whatsappMobile, guardianName: h.guardianName })), [sis.households]);
  const studentsByHh = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of sis.students) if (s.status === "active" && s.householdId) m.set(s.householdId, [...(m.get(s.householdId) || []), s.fullName]);
    return m;
  }, [sis.students]);
  const attribution = useMemo(() => referralAttribution(admissions.leads, households), [admissions.leads, households]);
  const attrByHh = new Map(attribution.map((a) => [a.householdId, a]));
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return households
      .filter((h) => studentsByHh.has(h.id))
      .filter((h) => !q || h.guardianName.toLowerCase().includes(q) || (h.mobile || "").includes(q) || referralCodeFor(h).toLowerCase().includes(q))
      .slice(0, 200);
  }, [households, studentsByHh, search]);

  function persist(next: ReferralsState, msg: string) {
    setState(saveReferrals(next));
    setNotice(msg);
  }

  async function draftInvite() {
    if (busy) return;
    setBusy("invite");
    try {
      const ach = loadSchoolAchievements();
      const res = await fetch("/api/ai/marketing-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "referral_invite",
          audiences: [{ language: "en", register: "warm" }],
          facts: {
            achievementLines: achievementsToFactLines(ach.achievements.filter((a) => a.publicSafe)).slice(0, 4),
            usps: ach.positioning.ours.split("\n").map((l) => l.trim()).filter(Boolean),
            brandLines: ach.positioning.brandLines.split("\n").map((l) => l.trim()).filter(Boolean),
            competitorNames: ach.positioning.competitorNames.split(/[,\n]/).map((l) => l.trim()).filter(Boolean),
            ctaUrl: "{{link}}",
            note: `Existing parent referral invite. Use the placeholders {{guardianName}} for the parent, {{code}} for their personal referral code and {{link}} for their share link, exactly as written.${state.rewardNote ? ` Reward policy: ${state.rewardNote}` : " No reward is promised."}`,
          },
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; variants?: { text: string; flags: { forbiddenNames: string[] } }[] };
      if (!res.ok || !j.ok || !j.variants?.length) return setError(j.error || "Draft failed");
      if (j.variants[0].flags.forbiddenNames.length) return setError("Draft named a competitor — try again");
      setInviteText(j.variants[0].text);
    } finally {
      setBusy(null);
    }
  }

  function sendInvite(h: (typeof households)[number]) {
    const code = referralCodeFor(h);
    const text = (inviteText || `Dear {{guardianName}}, thank you for being part of the ${TENANT.nameDisplay} family. If you know a family looking for a school, share your personal link {{link}} (code {{code}}) — we will take good care of them.`)
      .replace(/\{\{guardianName\}\}/g, h.guardianName || "Parent")
      .replace(/\{\{code\}\}/g, code)
      .replace(/\{\{link\}\}/g, referralLink(code));
    openWaMe(h.whatsappMobile || h.mobile, text);
    persist(markInvited(state, h.id, code, "whatsapp"), `Invite opened for ${h.guardianName}`);
  }

  function saveT(patch: Partial<Testimonial> & { id?: string }, msg: string) {
    const r = upsertTestimonial(state, { ...patch, by });
    if (!r.ok) return setError(r.error);
    setError(null);
    persist(r.state, msg);
    return r.testimonial;
  }

  function requestT(h: (typeof households)[number]) {
    const label = (studentsByHh.get(h.id) || []).slice(0, 2).join(", ");
    const t = saveT({ householdId: h.id, parentName: h.guardianName, studentLabel: label, status: "requested", requestedAt: new Date().toISOString() }, "Testimonial requested");
    if (!t) return;
    openWaMe(h.whatsappMobile || h.mobile, `Dear ${h.guardianName || "Parent"}, would you share a few lines about your experience with ${TENANT.nameDisplay} — what you like, what your child enjoys? Reply here in your own words (English or Hindi). We will only use it with your approval. Thank you!`);
  }

  async function polishT(t: Testimonial) {
    if (busy || !t.rawText.trim()) return;
    setBusy("polish");
    setPolish(null);
    try {
      const res = await fetch("/api/ai/testimonial-polish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawText: t.rawText }) });
      const j = (await res.json()) as { ok?: boolean; error?: string; polished?: string; problems?: string[]; generationId?: string };
      if (!res.ok || !j.ok || !j.polished) return setError(j.error || "Polish failed");
      setPolish({ id: t.id, text: j.polished, problems: j.problems || testimonialPolishProblems(t.rawText, j.polished), generationId: j.generationId || "" });
    } finally {
      setBusy(null);
    }
  }

  const approvedCount = approvedTestimonialLines(state).length;

  return (
    <div className="mt-4 space-y-4">
      {notice ? <p className="rounded-lg bg-[var(--success-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--success)]">{notice}</p> : null}
      {error ? <p className="rounded-lg bg-[var(--danger)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}

      {/* Referrals */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <p className="text-sm font-semibold">Parent referrals</p>
            <p className="text-[11px] text-[var(--muted)]">
              {attribution.length} referrer{attribution.length === 1 ? "" : "s"} · {attribution.reduce((a, r) => a + r.leads, 0)} leads · {attribution.reduce((a, r) => a + r.enrolled, 0)} enrolled · {state.invites.length} invited
            </p>
          </div>
          <input className={`${inp} !w-56 ml-auto`} placeholder="Search parent / mobile / code" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {canEdit ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="text-[11px] text-[var(--muted)] sm:col-span-2">
              Invite message (placeholders {"{{guardianName}} {{code}} {{link}}"})
              <textarea className={`${inp} mt-0.5 min-h-[4rem]`} value={inviteText} onChange={(e) => setInviteText(e.target.value)} placeholder="Leave blank for the default, or draft one from the school's achievements" />
            </label>
            <div className="text-[11px] text-[var(--muted)]">
              Reward note (informational, shown to staff only)
              <input className={`${inp} mt-0.5`} value={state.rewardNote} onChange={(e) => setState({ ...state, rewardNote: e.target.value })} onBlur={() => persist(state, "Reward note saved")} placeholder="e.g. ₹1,000 fee credit per enrolment" />
              <button type="button" disabled={busy === "invite"} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50" onClick={() => void draftInvite()}>
                <Sparkles className="h-3 w-3" />
                {busy === "invite" ? "Drafting…" : "Draft invite from school facts"}
              </button>
            </div>
          </div>
        ) : null}

        {canEdit ? (
          <ReferralPolicyEditor leads={admissions.leads} sis={sis} by={by} />
        ) : null}
        <div className="mt-2">
          <ErpTableShell>
            <ErpTable>
              <ErpTableHead>
                <tr>
                  <th className="px-2 py-2 text-left">Parent</th>
                  <th className="px-2 py-2 text-left">Children</th>
                  <th className="px-2 py-2 text-left">Code</th>
                  <th className="px-2 py-2 text-right">Leads</th>
                  <th className="px-2 py-2 text-right">Registered</th>
                  <th className="px-2 py-2 text-right">Enrolled</th>
                  <th className="px-2 py-2 text-left">Invited</th>
                  <th className="px-2 py-2" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-center text-xs text-[var(--muted)]">No enrolled households match.</td>
                  </tr>
                ) : (
                  rows.map((h) => {
                    const code = referralCodeFor(h);
                    const a = attrByHh.get(h.id);
                    const inv = state.invites.find((i) => i.householdId === h.id);
                    return (
                      <tr key={h.id} className="text-xs">
                        <td className="px-2 py-1.5 font-semibold">{h.guardianName || "—"}<div className="text-[10px] font-normal text-[var(--muted)]">{h.mobile}</div></td>
                        <td className="px-2 py-1.5">{(studentsByHh.get(h.id) || []).join(", ")}</td>
                        <td className="px-2 py-1.5 font-mono">{code}</td>
                        <td className="px-2 py-1.5 text-right">{a?.leads || 0}</td>
                        <td className="px-2 py-1.5 text-right">{a?.registered || 0}</td>
                        <td className="px-2 py-1.5 text-right font-semibold">{a?.enrolled || 0}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-[var(--muted)]">{inv?.invitedAt ? inv.invitedAt.slice(0, 10) : "—"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {canEdit ? (
                            <RowActionMenu
                              row={h}
                              label={`Actions for ${h.guardianName || h.mobile}`}
                              actions={[
                                { id: "invite", label: "Invite on WhatsApp", onSelect: (x) => sendInvite(x) },
                                {
                                  id: "copy",
                                  label: "Copy referral link",
                                  onSelect: () => void navigator.clipboard.writeText(referralLink(code)).then(() => setNotice("Link copied")),
                                },
                                { id: "story", label: "Ask for a testimonial", onSelect: (x) => requestT(x) },
                              ]}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </ErpTableBody>
            </ErpTable>
          </ErpTableShell>
        </div>
      </div>

      {/* Testimonials */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <p className="text-sm font-semibold">Parent stories (testimonials)</p>
            <p className="text-[11px] text-[var(--muted)]">{state.testimonials.length} total · {approvedCount} approved and usable by Marketing. Polish changes grammar only; the parent approves the final words.</p>
          </div>
          {canEdit ? (
            <button type="button" className="ml-auto rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={() => setTDraft({ id: "", householdId: "", parentName: "", studentLabel: "", rawText: "" })}>
              + Paste a story
            </button>
          ) : null}
        </div>
        {tDraft ? (
          <div className="mt-2 grid gap-2 rounded-lg border border-[var(--border)] p-2 sm:grid-cols-3">
            <label className="text-[11px] text-[var(--muted)]">
              Parent name
              <input className={`${inp} mt-0.5`} value={tDraft.parentName} onChange={(e) => setTDraft({ ...tDraft, parentName: e.target.value })} />
            </label>
            <label className="text-[11px] text-[var(--muted)]">
              Child / class (public-safe)
              <input className={`${inp} mt-0.5`} value={tDraft.studentLabel} onChange={(e) => setTDraft({ ...tDraft, studentLabel: e.target.value })} placeholder="Riya, Class II" />
            </label>
            <label className="text-[11px] text-[var(--muted)]">
              Household (optional)
              <select className={`${inp} mt-0.5`} value={tDraft.householdId} onChange={(e) => { const h = households.find((x) => x.id === e.target.value); setTDraft({ ...tDraft, householdId: e.target.value, parentName: tDraft.parentName || h?.guardianName || "" }); }}>
                <option value="">—</option>
                {rows.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.guardianName} · {h.mobile}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-[var(--muted)] sm:col-span-3">
              The parent&apos;s words, exactly as received
              <textarea className={`${inp} mt-0.5 min-h-[5rem]`} value={tDraft.rawText} onChange={(e) => setTDraft({ ...tDraft, rawText: e.target.value })} />
            </label>
            <div className="flex gap-2 sm:col-span-3">
              <button type="button" className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]" onClick={() => { if (saveT({ ...tDraft, id: tDraft.id || undefined, status: "received", receivedAt: new Date().toISOString() }, "Story saved")) setTDraft(null); }}>
                Save
              </button>
              <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={() => setTDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        <ul className="mt-2 space-y-2">
          {state.testimonials.map((t) => (
            <li key={t.id} className="rounded-lg border border-[var(--border)] p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t.parentName || "Parent"}</span>
                <span className="text-[var(--muted)]">{t.studentLabel}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.status === "approved" ? "bg-[var(--success-soft)] text-[var(--success)]" : t.status === "declined" ? "bg-[var(--danger)]/10 text-[var(--danger)]" : "bg-[var(--surface-sunken)] text-[var(--muted)]"}`}>{STATUS_LABEL[t.status]}</span>
                {t.consentNote ? <span className="text-[10px] text-[var(--muted)]">consent: {t.consentNote}</span> : null}
                {canEdit ? (
                  <button type="button" className="ml-auto text-[var(--danger)] underline" onClick={() => { if (window.confirm("Remove this story?")) persist(removeTestimonial(state, t.id), "Removed"); }}>
                    remove
                  </button>
                ) : null}
              </div>
              {t.rawText ? <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">&ldquo;{t.rawText}&rdquo;</p> : <p className="mt-1 text-[var(--muted)]">Waiting for the parent&apos;s words — paste them when they reply.</p>}
              {t.polishedText ? <p className="mt-1 whitespace-pre-wrap">Polished: &ldquo;{t.polishedText}&rdquo;</p> : null}
              {polish && polish.id === t.id ? (
                <div className={`mt-1 rounded border p-2 ${polish.problems.length ? "border-[var(--warning)]" : "border-[var(--success)]"}`}>
                  <p className="whitespace-pre-wrap">{polish.text}</p>
                  {polish.problems.length ? <p className="mt-1 text-[10px] font-semibold text-[var(--warning)]">Guard: {polish.problems.join("; ")} — cannot be kept; edit the raw text or try again.</p> : null}
                  <div className="mt-1 flex gap-2">
                    <button type="button" disabled={polish.problems.length > 0} className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-50" onClick={() => { if (polish.generationId) reportAiOutcome({ ids: [polish.generationId], outcome: "accepted", targetType: "testimonial", targetId: t.id }); saveT({ id: t.id, polishedText: polish.text, status: "polished" }, "Polish kept"); setPolish(null); }}>
                      Keep polish
                    </button>
                    <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold" onClick={() => setPolish(null)}>
                      Discard
                    </button>
                  </div>
                </div>
              ) : null}
              {canEdit ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {t.status === "requested" ? (
                    <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold" onClick={() => setTDraft({ id: t.id, householdId: t.householdId, parentName: t.parentName, studentLabel: t.studentLabel, rawText: t.rawText })}>
                      Paste reply
                    </button>
                  ) : null}
                  {t.rawText && t.status !== "approved" ? (
                    <button type="button" disabled={busy === "polish"} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50" onClick={() => void polishT(t)}>
                      <Sparkles className="h-3 w-3" />
                      Polish (grammar only)
                    </button>
                  ) : null}
                  {(t.polishedText || t.rawText) && t.status !== "approved" ? (
                    <>
                      <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold" onClick={() => { const h = households.find((x) => x.id === t.householdId); if (!h) return setError("No household mobile on this story — send manually"); openWaMe(h.whatsappMobile || h.mobile, `Dear ${t.parentName || "Parent"}, thank you for your kind words. May we share this on our brochure / website / social media?\n\n"${t.polishedText || t.rawText}"\n\nReply YES to approve (and tell us if we may use your name), or reply with any change.`); }}>
                        Send for approval (WA)
                      </button>
                      <button type="button" className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)]" onClick={() => { const note = window.prompt("How did the parent approve? (e.g. WhatsApp YES 20-Aug-2026)"); if (!note) return; const showName = window.confirm("Did the parent allow their name to be shown? OK = yes, Cancel = withhold name"); saveT({ id: t.id, status: "approved", approvedAt: new Date().toISOString(), consentNote: note, showName }, "Approved — usable by Marketing"); }}>
                        Mark approved
                      </button>
                      <button type="button" className="text-[var(--muted)] underline" onClick={() => saveT({ id: t.id, status: "declined" }, "Marked declined")}>
                        declined
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
