"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

const fieldCls = field;
import type { AadhaarGapCounts, AadhaarScope, AppPopup } from "@/lib/appPopups";
import { loadMasters } from "@/lib/masters";
import { uploadMedia } from "@/lib/mediaUpload";
import { AppPopupPreview, popupStatus } from "@/components/comms/AppPopupPreview";
import { looksHindi, POPUP_CONSENT_MAX, POPUP_TITLE_MAX, popupBodyMax } from "@/lib/appPopupText";

/** The paired fields: English and Hindi of the title, message and consent. */
type Field = "title" | "body" | "consent";
const KEYS: Record<Field, { en: "title" | "body" | "consentText"; hi: "titleHi" | "bodyHi" | "consentTextHi" }> = {
  title: { en: "title", hi: "titleHi" },
  body: { en: "body", hi: "bodyHi" },
  consent: { en: "consentText", hi: "consentTextHi" },
};

type Stats = Record<string, { shown: number; dismissed: number; done: number; pendingNow?: number }>;

const AADHAAR_SCOPES: { id: AadhaarScope; label: string }[] = [
  { id: "all", label: "Child + father + mother" },
  { id: "child", label: "Only the child" },
  { id: "parents", label: "Only father and mother" },
];

const RULES: { id: AppPopup["rule"]; label: string; form: AppPopup["form"]; hint: string }[] = [
  { id: "missing_docs", label: "Child's documents missing", form: "documents", hint: "Families whose child has no birth certificate, photo, Aadhaar card or address proof uploaded. The pop-up opens the upload." },
  { id: "missing_aadhaar", label: "Aadhaar number missing", form: "aadhaar", hint: "Families where the child's, father's or mother's Aadhaar number is missing. The parent types it; it is checked and saved on the child's record." },
  { id: "consent_pending", label: "Consent not given", form: "consent", hint: "APAAR consent (consent key \"apaar\") is pending by the record; a consent of your own (any other key) until the family answers." },
];

function blank(): AppPopup {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return {
    id: "",
    title: "",
    titleHi: "",
    body: "",
    bodyHi: "",
    imageUrl: "",
    kind: "info",
    form: "none",
    consentKey: "",
    consentText: "",
    consentTextHi: "",
    aadhaarScope: "all",
    audience: "parents",
    targetMode: "all",
    classIds: [],
    rule: "",
    startsOn: today,
    endsOn: "",
    frequency: "once",
    ctaLabel: "",
    ctaRoute: "",
    active: true,
    createdBy: "",
    createdAt: "",
    updatedAt: "",
  };
}

const APP_SCREENS: { route: string; label: string }[] = [
  { route: "", label: "— no button —" },
  { route: "/fees", label: "Fees" },
  { route: "/homework", label: "Homework" },
  { route: "/attendance", label: "Attendance" },
  { route: "/notices", label: "Notices" },
  { route: "/transport", label: "Transport" },
  { route: "/ptm", label: "PTM" },
  { route: "/leave", label: "Leave" },
  { route: "/profile", label: "Profile & documents" },
  { route: "/online-classes", label: "Online classes" },
];

/**
 * Comms → App pop-ups (director, 9 Oct 2026): a poster, an announcement or a
 * short form shown when parents or staff open the app — to everyone, some
 * classes, or by a rule on the family's own record (documents missing,
 * Aadhaar missing, consent pending). A rule pop-up stops for a family by
 * itself once their record is complete.
 */
export function AppPopupsPanel({ canEdit }: { canEdit: boolean }) {
  const [popups, setPopups] = useState<AppPopup[] | null>(null);
  const [stats, setStats] = useState<Stats>({});
  const [gaps, setGaps] = useState<AadhaarGapCounts | null>(null);
  const [draft, setDraft] = useState<AppPopup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which list item's phone preview is open, and the language it shows. */
  const [previewId, setPreviewId] = useState("");
  const [lang, setLang] = useState<"hi" | "en">("hi");
  /** Fields the AI filled (and nobody has changed since) — only these are refilled. */
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [aiBusy, setAiBusy] = useState("");
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const classes = useMemo(() => (loadMasters().classes ?? []).filter((c) => c.isActive !== false), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/comms/app-popups", { cache: "no-store" });
      const body = (await res.json()) as { ok?: boolean; popups?: AppPopup[]; stats?: Stats; aadhaarCounts?: AadhaarGapCounts | null; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setPopups(body.popups ?? []);
      setStats(body.stats ?? {});
      setGaps(body.aadhaarCounts ?? null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(p: AppPopup) {
    setBusy(true);
    try {
      const res = await fetch("/api/comms/app-popups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", popup: p }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) setError(body.error || `HTTP ${res.status}`);
      else {
        setDraft(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this pop-up? Families will stop seeing it.")) return;
    await fetch("/api/comms/app-popups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    await load();
  }

  async function onImage(file: File | undefined) {
    if (!file || !draft) return;
    setBusy(true);
    const r = await uploadMedia({ file, visibility: "public", pathPrefix: "app-popups" });
    setBusy(false);
    if (r.ok) setDraft({ ...draft, imageUrl: r.url });
    else setError(r.error);
  }

  const set = (patch: Partial<AppPopup>) => draft && setDraft({ ...draft, ...patch });
  const bodyMax = draft ? popupBodyMax(draft.form, !!draft.imageUrl) : 0;

  async function ai(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const res = await fetch("/api/ai/app-popup-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !body.ok) {
      setError(String(body.error || `AI: HTTP ${res.status}`));
      return null;
    }
    return body;
  }

  /** The message (both languages) written from the title. */
  async function writeWithAi() {
    if (!draft) return;
    setAiBusy("draft");
    const r = await ai({ mode: "draft", title: draft.title.trim() || draft.titleHi.trim(), form: draft.form, imageUrl: draft.imageUrl });
    setAiBusy("");
    const d = r?.draft as { title: string; titleHi: string; body: string; bodyHi: string } | undefined;
    if (!d) return;
    setDraft((cur) =>
      cur
        ? {
            ...cur,
            title: cur.title.trim() ? cur.title : d.title,
            titleHi: cur.titleHi.trim() && !aiFilled.has("titleHi") ? cur.titleHi : d.titleHi,
            body: d.body,
            bodyHi: d.bodyHi,
          }
        : cur,
    );
    setAiFilled((s0) => new Set([...s0, "body", "bodyHi", ...(draft.titleHi.trim() && !aiFilled.has("titleHi") ? [] : ["titleHi"])]));
  }

  /**
   * After typing in one box: Hindi typed in the English box moves to the
   * Hindi box (and the other way round), then the other language is filled —
   * unless someone wrote that box by hand.
   */
  async function fillOther(field: Field, typedIn: "en" | "hi") {
    if (!draft) return;
    const k = KEYS[field];
    let text = (typedIn === "en" ? draft[k.en] : draft[k.hi]).trim();
    if (!text) return;
    const isHi = looksHindi(text);
    let from: "en" | "hi" = typedIn;
    if (typedIn === "en" && isHi) {
      set({ [k.hi]: text, [k.en]: "" } as Partial<AppPopup>);
      from = "hi";
    } else if (typedIn === "hi" && !isHi) {
      set({ [k.en]: text, [k.hi]: "" } as Partial<AppPopup>);
      from = "en";
    }
    const target = from === "en" ? k.hi : k.en;
    const existing = from === typedIn ? (target === k.hi ? draft[k.hi] : draft[k.en]).trim() : "";
    if (existing && !aiFilled.has(target)) return; // written by hand — leave it
    text = text.trim();
    setAiBusy(field);
    const r = await ai({ mode: "translate", text, from, field, form: draft.form, imageUrl: draft.imageUrl });
    setAiBusy("");
    if (typeof r?.text !== "string") return;
    const translated = r.text;
    setDraft((cur) => (cur ? { ...cur, [target]: translated } : cur));
    setAiFilled((s0) => new Set([...s0, target]));
  }

  /** An English + Hindi pair with live counters, capped at `max`. */
  function pairField(field: Field, label: string, max: number, multiline: boolean) {
    if (!draft) return null;
    const k = KEYS[field];
    return (["en", "hi"] as const).map((l) => {
      const key = l === "en" ? k.en : k.hi;
      const value = draft[key];
      const n = [...value].length;
      const props = {
        value,
        maxLength: Math.max(max, n),
        lang: l,
        onChange: (e: { target: { value: string } }) => {
          // A field typed into is no longer the AI's: it will not be refilled.
          setAiFilled((s0) => {
            const next = new Set(s0);
            next.delete(key);
            return next;
          });
          // Never longer than the limit (an older, longer text may only shrink).
          const v = [...e.target.value].length > Math.max(max, n) ? [...e.target.value].slice(0, max).join("") : e.target.value;
          set({ [key]: v } as Partial<AppPopup>);
        },
        onBlur: () => void fillOther(field, l),
      };
      return (
        <label key={key} className="block">
          <span className="flex items-center justify-between text-xs font-semibold">
            <span>
              {label} ({l === "en" ? "English" : "Hindi"})
              {aiFilled.has(key) ? <span className="ml-1 font-normal text-[var(--muted)]">· AI</span> : null}
            </span>
            <span className={n > max ? "text-[var(--danger)]" : "font-normal text-[var(--muted)]"}>
              {n}/{max}
            </span>
          </span>
          {multiline ? <textarea {...props} className={`${fieldCls} min-h-[72px]`} /> : <input {...props} className={fieldCls} />}
          {n > max ? <span className="text-[11px] text-[var(--danger)]">Too long for one phone screen — shorten to {max}.</span> : null}
        </label>
      );
    });
  }



  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="App pop-ups">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">App pop-ups</h3>
          <p className="text-[11px] text-[var(--muted)]">
            Shown full-screen when parents or staff open the app — one at a time, newest first. Rule pop-ups stop for a family once their record is complete.
          </p>
        </div>
        {canEdit && !draft ? (
          <button type="button" className={btn} onClick={() => setDraft(blank())}>
            New pop-up
          </button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}

      {draft ? (
        <div className="grid gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-[var(--muted)]">
              Type in either language — the other box fills itself. Limits keep the whole pop-up on one phone screen.
            </p>
            <button
              type="button"
              className={btnOutline}
              disabled={!!aiBusy || (draft.title.trim() || draft.titleHi.trim()).length < 3}
              onClick={() => void writeWithAi()}
            >
              {aiBusy === "draft" ? "Writing…" : "Write message with AI"}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {pairField("title", "Title", POPUP_TITLE_MAX, false)}
            {pairField("body", "Message", bodyMax, true)}
          </div>
          {aiBusy && aiBusy !== "draft" ? <p className="text-[11px] text-[var(--muted)]">Filling the other language…</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-semibold">
              Poster image{" "}
              <input type="file" accept="image/*" className="text-xs" onChange={(e) => void onImage(e.target.files?.[0])} disabled={busy} />
            </label>
            {draft.imageUrl ? (
              <span className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded poster, shown as stored */}
                <img src={draft.imageUrl} alt="" className="h-14 rounded border border-[var(--border)]" />
                <button type="button" className="text-xs text-[var(--danger)]" onClick={() => set({ imageUrl: "" })}>
                  Remove
                </button>
              </span>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-semibold">For</span>
              <select className={field} value={draft.audience} onChange={(e) => set({ audience: e.target.value as AppPopup["audience"] })}>
                <option value="parents">Parents (parent app)</option>
                <option value="staff">Staff (staff app)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Who sees it</span>
              <select
                className={field}
                value={draft.targetMode}
                onChange={(e) => {
                  const mode = e.target.value as AppPopup["targetMode"];
                  set(mode === "rule" ? { targetMode: mode, rule: "missing_aadhaar", form: "aadhaar" } : { targetMode: mode, rule: "" });
                }}
              >
                <option value="all">Everyone</option>
                <option value="classes">Some classes</option>
                {draft.audience === "parents" ? <option value="rule">By a rule (missing information)</option> : null}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold">How often</span>
              <select className={field} value={draft.frequency} onChange={(e) => set({ frequency: e.target.value as AppPopup["frequency"] })}>
                <option value="once">Once</option>
                <option value="daily">Once a day</option>
                <option value="until_done">Every app open until done</option>
              </select>
            </label>
          </div>

          {draft.targetMode === "classes" ? (
            <div className="flex flex-wrap gap-2">
              {classes.map((c) => (
                <label key={c.id} className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                  <input
                    type="checkbox"
                    checked={draft.classIds.includes(c.id)}
                    onChange={(e) => set({ classIds: e.target.checked ? [...draft.classIds, c.id] : draft.classIds.filter((x) => x !== c.id) })}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          ) : null}

          {draft.targetMode === "rule" ? (
            <div className="space-y-1">
              <select
                className={field}
                value={draft.rule}
                onChange={(e) => {
                  const r = RULES.find((x) => x.id === e.target.value)!;
                  set({ rule: r.id, form: r.form, consentKey: r.id === "consent_pending" ? draft.consentKey || "apaar" : draft.consentKey });
                }}
              >
                {RULES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[var(--muted)]">{RULES.find((r) => r.id === draft.rule)?.hint}</p>
            </div>
          ) : (
            <label className="block">
              <span className="text-xs font-semibold">Form in the pop-up</span>
              <select className={field} value={draft.form} onChange={(e) => set({ form: e.target.value as AppPopup["form"] })}>
                <option value="none">None — poster / information</option>
                <option value="consent">Consent (I agree / I do not agree)</option>
                {draft.audience === "parents" ? <option value="aadhaar">Aadhaar numbers (only missing ones are asked)</option> : null}
                {draft.audience === "parents" ? <option value="documents">Upload missing documents</option> : null}
              </select>
            </label>
          )}

          {draft.form === "aadhaar" || draft.rule === "missing_aadhaar" ? (
            <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5">
              <label className="block">
                <span className="text-xs font-semibold">Ask for whose Aadhaar?</span>
                <select
                  className={field}
                  value={draft.aadhaarScope}
                  onChange={(e) => set({ aadhaarScope: e.target.value as AadhaarScope })}
                >
                  {AADHAAR_SCOPES.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-[var(--muted)]">Only the numbers still missing are asked; the pop-up stops for a family once they are filled.</span>
              </label>
              {gaps ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-[var(--muted)]">Missing right now ({gaps.families} families, {gaps.children} children on roll)</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { k: "Children", v: gaps.childrenMissing, sub: `in ${gaps.familiesChildMissing} families` },
                      { k: "Fathers", v: gaps.fatherMissing, sub: "families" },
                      { k: "Mothers", v: gaps.motherMissing, sub: "families" },
                    ].map((c) => (
                      <div key={c.k} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
                        <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">{c.k}</p>
                        <p className="text-base font-bold text-[var(--brand-deep)]">{c.v}</p>
                        <p className="text-[10px] text-[var(--muted)]">{c.sub}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-[var(--ink)]">
                    This pop-up would reach <strong>{gaps.reach[draft.aadhaarScope]}</strong> families with “{AADHAAR_SCOPES.find((o) => o.id === draft.aadhaarScope)?.label}”.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-[var(--muted)]">Counts could not be loaded just now.</p>
              )}
            </div>
          ) : null}

          {draft.form === "consent" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold">Consent key</span>
                <input
                  className={field}
                  placeholder='apaar — or your own, e.g. "photo2026"'
                  value={draft.consentKey}
                  onChange={(e) => set({ consentKey: e.target.value })}
                />
                <span className="text-[11px] text-[var(--muted)]">
                  &quot;apaar&quot; records the APAAR consent on each child (as WhatsApp does). Any other key just records each family&apos;s answer.
                </span>
              </label>
              {pairField("consent", "Consent text", POPUP_CONSENT_MAX, true)}
            </div>
          ) : null}

          {draft.form === "none" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold">Button opens (optional)</span>
                <select className={field} value={draft.ctaRoute} onChange={(e) => set({ ctaRoute: e.target.value })}>
                  {APP_SCREENS.map((s) => (
                    <option key={s.route} value={s.route}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold">Button text</span>
                <input className={field} placeholder="e.g. Pay now" value={draft.ctaLabel} onChange={(e) => set({ ctaLabel: e.target.value })} />
              </label>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-semibold">From</span>
              <input type="date" className={field} value={draft.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Until (optional)</span>
              <input type="date" className={field} value={draft.endsOn} onChange={(e) => set({ endsOn: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 pt-5 text-xs">
              <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} /> Active
            </label>
          </div>

          <div className="flex gap-2">
            <button type="button" className={btn} disabled={busy || !draft.title.trim()} onClick={() => void save(draft)}>
              {draft.id ? "Save changes" : "Publish pop-up"}
            </button>
            <button type="button" className={btnOutline} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <LangSwitch lang={lang} setLang={setLang} />
          <AppPopupPreview popup={draft} lang={lang} />
          <p className="max-w-[300px] text-[11px] text-[var(--muted)]">
            Live preview — as it opens on the phone. The app asks only for what each family is missing.
          </p>
        </div>
        </div>
      ) : null}

      {popups === null && !error ? <p className="text-xs text-[var(--muted)]">Loading…</p> : null}
      {popups && popups.length === 0 && !draft ? <p className="text-xs text-[var(--muted)]">No pop-ups yet.</p> : null}
      <ul className="space-y-2">
        {(popups ?? []).map((p) => {
          const st = stats[p.id];
          const status = popupStatus(p, today);
          const toDo = typeof st?.pendingNow === "number" ? st.pendingNow : null;
          const reached = st ? st.shown : 0;
          // Done out of everyone it is meant for: those who finished plus,
          // for a rule pop-up, the families the rule still matches.
          const of = toDo !== null ? (st?.done ?? 0) + toDo : reached;
          const pct = of > 0 ? Math.round(((st?.done ?? 0) / of) * 100) : 0;
          const open = previewId === p.id;
          return (
            <li key={p.id} className="space-y-2 rounded-lg border border-[var(--border)] p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--brand-deep)]">
                    {p.title}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        status.tone === "live"
                          ? "bg-[var(--success-soft)] text-[var(--success)]"
                          : status.tone === "wait"
                            ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                            : "bg-[var(--surface)] text-[var(--muted)]"
                      }`}
                    >
                      {status.label}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {p.audience === "parents" ? "Parents" : "Staff"} ·{" "}
                    {p.targetMode === "rule" ? RULES.find((r) => r.id === p.rule)?.label : p.targetMode === "classes" ? `${p.classIds.length} class(es)` : "everyone"} ·{" "}
                    {p.frequency === "once" ? "once" : p.frequency === "daily" ? "daily" : "until done"} · {p.startsOn || "now"}
                    {p.endsOn ? ` → ${p.endsOn}` : ""}
                    {p.createdBy ? ` · by ${p.createdBy}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnOutline} onClick={() => setPreviewId(open ? "" : p.id)} aria-expanded={open}>
                    {open ? "Hide preview" : "Preview"}
                  </button>
                  {canEdit ? (
                    <>
                      <button type="button" className={btnOutline} onClick={() => setDraft(p)}>
                        Edit
                      </button>
                      <button type="button" className={btnOutline} onClick={() => void save({ ...p, active: !p.active })}>
                        {p.active ? "Stop" : "Start"}
                      </button>
                      <button
                        type="button"
                        className={btnOutline}
                        onClick={() => setDraft({ ...p, id: "", title: `${p.title} (copy)`, createdAt: "", createdBy: "", updatedAt: "" })}
                      >
                        Duplicate
                      </button>
                      <button type="button" className={btnOutline} onClick={() => void remove(p.id)}>
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {st ? (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { k: p.audience === "parents" ? "Families who saw it" : "Staff who saw it", v: st.shown },
                      { k: p.form === "none" ? "Tapped OK / button" : "Completed", v: st.done },
                      { k: "Tapped “Later”", v: st.dismissed },
                      ...(toDo !== null ? [{ k: "Still to do", v: toDo }] : []),
                    ].map((c) => (
                      <div key={c.k} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
                        <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">{c.k}</p>
                        <p className="text-base font-bold text-[var(--brand-deep)]">{c.v}</p>
                      </div>
                    ))}
                  </div>
                  {of > 0 ? (
                    <div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-[var(--success)]" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                        {st.done} of {of} {toDo !== null ? "families it is meant for" : "who saw it"} completed ({pct}%)
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-[var(--muted)]">Nobody has opened the app since it went live.</p>
                  )}
                </div>
              ) : null}

              {open ? (
                <div className="space-y-2 pt-1">
                  <LangSwitch lang={lang} setLang={setLang} />
                  <AppPopupPreview popup={p} lang={lang} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LangSwitch({ lang, setLang }: { lang: "hi" | "en"; setLang: (l: "hi" | "en") => void }) {
  return (
    <div className="flex gap-1 text-xs" role="group" aria-label="Preview language">
      {(["hi", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={`rounded-full border px-2.5 py-0.5 ${lang === l ? "border-[var(--brand-deep)] font-semibold text-[var(--brand-deep)]" : "border-[var(--border)] text-[var(--muted)]"}`}
        >
          {l === "hi" ? "Hindi (parents' default)" : "English"}
        </button>
      ))}
    </div>
  );
}
