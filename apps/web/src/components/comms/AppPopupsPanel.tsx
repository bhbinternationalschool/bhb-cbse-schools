"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import type { AppPopup } from "@/lib/appPopups";
import { loadMasters } from "@/lib/masters";
import { uploadMedia } from "@/lib/mediaUpload";

type Stats = Record<string, { shown: number; dismissed: number; done: number; pendingNow?: number }>;

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
  const [draft, setDraft] = useState<AppPopup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const classes = useMemo(() => (loadMasters().classes ?? []).filter((c) => c.isActive !== false), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/comms/app-popups", { cache: "no-store" });
      const body = (await res.json()) as { ok?: boolean; popups?: AppPopup[]; stats?: Stats; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setPopups(body.popups ?? []);
      setStats(body.stats ?? {});
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
        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold">Title (English)</span>
              <input className={field} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Title (Hindi)</span>
              <input className={field} value={draft.titleHi} onChange={(e) => set({ titleHi: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Message (English)</span>
              <textarea className={`${field} min-h-[72px]`} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Message (Hindi)</span>
              <textarea className={`${field} min-h-[72px]`} value={draft.bodyHi} onChange={(e) => set({ bodyHi: e.target.value })} />
            </label>
          </div>

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
              <label className="block">
                <span className="text-xs font-semibold">Consent text (English)</span>
                <textarea className={`${field} min-h-[90px]`} value={draft.consentText} onChange={(e) => set({ consentText: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">Consent text (Hindi)</span>
                <textarea className={`${field} min-h-[90px]`} value={draft.consentTextHi} onChange={(e) => set({ consentTextHi: e.target.value })} />
              </label>
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
      ) : null}

      {popups === null && !error ? <p className="text-xs text-[var(--muted)]">Loading…</p> : null}
      {popups && popups.length === 0 && !draft ? <p className="text-xs text-[var(--muted)]">No pop-ups yet.</p> : null}
      <ul className="space-y-2">
        {(popups ?? []).map((p) => {
          const st = stats[p.id];
          return (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--border)] p-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--brand-deep)]">
                  {p.title} {!p.active ? <span className="text-xs text-[var(--muted)]">(off)</span> : null}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {p.audience === "parents" ? "Parents" : "Staff"} ·{" "}
                  {p.targetMode === "rule" ? RULES.find((r) => r.id === p.rule)?.label : p.targetMode === "classes" ? `${p.classIds.length} class(es)` : "everyone"} ·{" "}
                  {p.frequency === "once" ? "once" : p.frequency === "daily" ? "daily" : "until done"} · {p.startsOn || "now"}
                  {p.endsOn ? ` → ${p.endsOn}` : ""}
                </p>
                {st ? (
                  <p className="text-xs">
                    Seen by {st.shown} · completed {st.done} · “Later” {st.dismissed}
                    {typeof st.pendingNow === "number" ? ` · ${st.pendingNow} famil${st.pendingNow === 1 ? "y" : "ies"} still to do` : ""}
                  </p>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex gap-2">
                  <button type="button" className={btnOutline} onClick={() => setDraft(p)}>
                    Edit
                  </button>
                  <button type="button" className={btnOutline} onClick={() => void save({ ...p, active: !p.active })}>
                    {p.active ? "Switch off" : "Switch on"}
                  </button>
                  <button type="button" className={btnOutline} onClick={() => void remove(p.id)}>
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
