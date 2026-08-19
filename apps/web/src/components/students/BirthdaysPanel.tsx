"use client";

/**
 * Students → Birthdays — today's and upcoming birthdays, the card template
 * gallery (design × format, live previews rendered by /api/birthday/card),
 * the greeting message per language, auto-send settings (hour, WhatsApp
 * template for outside-24h delivery), optional social post, a send log, and
 * per-student actions: download card, open WhatsApp, send now (server).
 */

import { useEffect, useMemo, useState } from "react";
import { Cake, Download, Send, Sparkles } from "lucide-react";
import {
  BIRTHDAY_DESIGNS,
  BIRTHDAY_FORMATS,
  BIRTHDAY_PLACEHOLDERS,
  birthdayMessageFor,
  DEFAULT_BIRTHDAY_MESSAGES,
  DEFAULT_SOCIAL_CAPTION,
  loadBirthdayState,
  saveBirthdayState,
  upcomingBirthdays,
  type BirthdayDesignId,
  type BirthdayFormatId,
  type BirthdaySettings,
  type BirthdayState,
} from "@/lib/birthdayCards";
import { loadSis } from "@/lib/sis";
import { loadMasters } from "@/lib/masters";
import { listApprovedTemplates, loadWaTemplates } from "@/lib/waTemplates";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";
import { openWaMe } from "@/lib/waMe";
import { TENANT } from "@/lib/types";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";

type TodayRow = { studentId: string; fullName: string; className: string; age: number | null; guardianName: string; mobile: string; language: "en" | "hi"; hasPhoto: boolean; cardUrl: string };

function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function BirthdaysPanel({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<BirthdayState>(() => loadBirthdayState());
  const [s, setS] = useState<BirthdaySettings>(state.settings);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(todayIst());
  const [today, setToday] = useState<TodayRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewFormat, setPreviewFormat] = useState<BirthdayFormatId>(state.settings.format);
  const [cacheBust, setCacheBust] = useState(0);
  useModuleStateHydration("birthday_settings", () => {
    const st = loadBirthdayState();
    setState(st);
    if (!dirty) setS(st.settings);
  });
  useEffect(() => {
    const t = notice ? window.setTimeout(() => setNotice(null), 3500) : null;
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [notice]);

  const sis = useMemo(() => loadSis(), []);
  const masters = useMemo(() => loadMasters(), []);
  const upcoming = useMemo(() => upcomingBirthdays(sis.students, todayIst(), 14).filter((u) => u.date !== todayIst()).slice(0, 30), [sis.students]);
  const imageTemplates = useMemo(() => listApprovedTemplates(loadWaTemplates()).filter((t) => t.headerFormat === "IMAGE"), []);

  async function loadToday(d: string) {
    try {
      const r = await fetch(`/api/birthday/send?date=${d}&design=${s.design}&format=${s.format}`);
      const j = (await r.json()) as { ok?: boolean; students?: TodayRow[]; error?: string };
      if (!r.ok || !j.ok) return setError(j.error || "Could not load");
      setToday(j.students || []);
    } catch {
      setError("Could not load today's birthdays");
    }
  }
  useEffect(() => {
    void loadToday(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, s.design, s.format]);

  function patch(p: Partial<BirthdaySettings>) {
    setS((x) => ({ ...x, ...p }));
    setDirty(true);
  }
  function save() {
    const next = saveBirthdayState({ ...state, settings: s });
    setState(next);
    setS(next.settings);
    setDirty(false);
    setNotice("Birthday settings saved");
    setCacheBust((c) => c + 1);
  }

  const sampleUrl = (design: BirthdayDesignId, format: BirthdayFormatId) =>
    `/api/birthday/card?sample=1&design=${design}&format=${format}${s.cardWish ? `&wish=${encodeURIComponent(s.cardWish)}` : ""}&v=${cacheBust}`;

  async function sendNow(ids: string[], dryRun: boolean) {
    if (busy) return;
    setBusy(dryRun ? "dry" : "send");
    setError(null);
    try {
      const r = await fetch("/api/birthday/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, studentIds: ids, dryRun, includeSocial: false }) });
      const j = (await r.json()) as { ok?: boolean; error?: string; sent?: number; failed?: number; deferred?: number; skipped?: number; rows?: { fullName: string; status: string; detail: string }[] };
      if (!r.ok || !j.ok) return setError(j.error || "Send failed");
      setNotice(`${dryRun ? "Dry run" : "Sent"}: ${j.sent} sent · ${j.failed} failed · ${j.deferred} deferred · ${j.skipped} skipped`);
      if (j.rows?.some((x) => x.status === "failed")) setError(j.rows.filter((x) => x.status === "failed").map((x) => `${x.fullName}: ${x.detail}`).join(" · ").slice(0, 400));
      setState(loadBirthdayState());
    } finally {
      setBusy(null);
    }
  }

  function openWa(row: TodayRow) {
    const text = birthdayMessageFor({ settings: s, language: row.language, childName: row.fullName, guardianName: row.guardianName, className: row.className, age: row.age, schoolName: TENANT.nameDisplay, cardLink: row.cardUrl });
    openWaMe(row.mobile, text);
  }

  const logToday = state.log.filter((e) => e.date === date);

  return (
    <div className="mt-4 space-y-4">
      {notice ? <p className="rounded-lg bg-[var(--success-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--success)]">{notice}</p> : null}
      {error ? <p className="rounded-lg bg-[var(--danger)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}

      {/* Today */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Cake className="h-4 w-4 text-[var(--brand-deep)]" />
          <p className="text-sm font-semibold">Birthdays on</p>
          <input type="date" className={`${inp} !w-40`} value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="text-[11px] text-[var(--muted)]">{today.length} student{today.length === 1 ? "" : "s"} · auto-send {s.autoSend ? `ON at ${s.sendHour}:00 IST` : "OFF"}</span>
          {canEdit && today.length ? (
            <span className="ml-auto flex gap-2">
              <button type="button" disabled={!!busy} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={() => void sendNow(today.map((t) => t.studentId), true)}>
                Dry run
              </button>
              <button type="button" disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50" onClick={() => { if (window.confirm(`Send birthday greetings to ${today.length} famil${today.length === 1 ? "y" : "ies"} on WhatsApp now?`)) void sendNow(today.map((t) => t.studentId), false); }}>
                <Send className="h-3.5 w-3.5" />
                {busy === "send" ? "Sending…" : "Send all now"}
              </button>
            </span>
          ) : null}
        </div>
        {today.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">No birthdays on this date.</p>
        ) : (
          <div className="mt-2">
            <ErpTableShell>
              <ErpTable>
                <ErpTableHead>
                  <tr>
                    <th className="px-2 py-2 text-left">Card</th>
                    <th className="px-2 py-2 text-left">Student</th>
                    <th className="px-2 py-2 text-left">Family</th>
                    <th className="px-2 py-2 text-left">Status today</th>
                    <th className="px-2 py-2" />
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {today.map((row) => {
                    const log = logToday.filter((e) => e.studentId === row.studentId);
                    return (
                      <tr key={row.studentId} className="text-xs align-top">
                        <td className="px-2 py-1.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/birthday/card?student=${encodeURIComponent(row.studentId)}&date=${date}&design=${s.design}&format=square&v=${cacheBust}`} alt="" width={72} height={72} className="rounded-lg border border-[var(--border)] object-cover" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="font-semibold">{row.fullName}</div>
                          <div className="text-[var(--muted)]">{row.className}{row.age != null ? ` · turns ${row.age}` : ""}{row.hasPhoto ? "" : " · no photo"}</div>
                        </td>
                        <td className="px-2 py-1.5">
                          <div>{row.guardianName || "—"}</div>
                          <div className="text-[var(--muted)]">{row.mobile || "no mobile"} · {row.language === "hi" ? "हिंदी" : "English"}</div>
                        </td>
                        <td className="px-2 py-1.5">
                          {log.length ? log.map((e) => <div key={e.channel} className={e.status === "sent" ? "text-[var(--success)]" : e.status === "failed" ? "text-[var(--danger)]" : "text-[var(--muted)]"}>{e.channel}: {e.status}{e.detail ? ` · ${e.detail.slice(0, 60)}` : ""}</div>) : <span className="text-[var(--muted)]">not sent</span>}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <a className="inline-flex items-center gap-1 text-[var(--brand-deep)] underline" href={`/api/birthday/card?student=${encodeURIComponent(row.studentId)}&date=${date}&design=${s.design}&format=${s.format}`} download={`birthday-${row.fullName.replace(/\s+/g, "_")}.png`}>
                            <Download className="h-3 w-3" /> PNG
                          </a>
                          {canEdit && row.mobile ? (
                            <>
                              <button type="button" className="ml-2 text-[var(--brand-deep)] underline" onClick={() => openWa(row)}>
                                Open WhatsApp
                              </button>
                              <button type="button" disabled={!!busy} className="ml-2 text-[var(--brand-deep)] underline disabled:opacity-50" onClick={() => void sendNow([row.studentId], false)}>
                                Send now
                              </button>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </ErpTableBody>
              </ErpTable>
            </ErpTableShell>
          </div>
        )}
        {upcoming.length ? (
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            Next 14 days: {upcoming.slice(0, 12).map((u) => `${u.student.fullName} (${u.date.slice(5).replace("-", "/")})`).join(" · ")}{upcoming.length > 12 ? ` · +${upcoming.length - 12} more` : ""}
          </p>
        ) : null}
      </div>

      {/* Card template gallery */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">Card design</p>
          <span className="text-[11px] text-[var(--muted)]">Click a design; preview in each format. Photos come from the student record; the school crest and name are on every design.</span>
          <div className="ml-auto flex gap-1">
            {BIRTHDAY_FORMATS.map((f) => (
              <button key={f.id} type="button" className={`rounded-full border px-2 py-0.5 text-[11px] ${previewFormat === f.id ? "border-[var(--brand-deep)] bg-[var(--brand-deep)] text-white" : "border-[var(--border)]"}`} onClick={() => setPreviewFormat(f.id)} title={f.use}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {BIRTHDAY_DESIGNS.map((d) => {
            const f = BIRTHDAY_FORMATS.find((x) => x.id === previewFormat)!;
            const ratio = f.height / f.width;
            return (
              <button key={d.id} type="button" disabled={!canEdit} className={`rounded-xl border-2 p-1.5 text-left ${s.design === d.id ? "border-[var(--brand-deep)]" : "border-[var(--border)]"}`} onClick={() => patch({ design: d.id })}>
                <div className="w-full overflow-hidden rounded-lg bg-[var(--surface-sunken)]" style={{ aspectRatio: `${f.width} / ${f.height}`, maxHeight: ratio > 1.3 ? 260 : undefined }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sampleUrl(d.id, previewFormat)} alt={d.label} className="h-full w-full object-contain" loading="lazy" />
                </div>
                <p className="mt-1 text-xs font-semibold">{d.label}</p>
                <p className="text-[10px] text-[var(--muted)]">{d.hint}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="text-[11px] text-[var(--muted)]">
            Format sent to families
            <select className={`${inp} mt-0.5`} value={s.format} disabled={!canEdit} onChange={(e) => patch({ format: e.target.value as BirthdayFormatId })}>
              {BIRTHDAY_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} — {f.use}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-[var(--muted)] sm:col-span-2">
            Wish line on the card (blank = design default)
            <input className={`${inp} mt-0.5`} maxLength={120} value={s.cardWish} disabled={!canEdit} onChange={(e) => patch({ cardWish: e.target.value })} placeholder="e.g. With love from your teachers and friends" />
          </label>
        </div>
      </div>

      {/* Message templates */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-sm font-semibold">Greeting message</p>
        <p className="text-[11px] text-[var(--muted)]">Sent to the family&apos;s WhatsApp in their language (from Students → Family; unset → school default). Placeholders: {BIRTHDAY_PLACEHOLDERS.join(" ")}. No AI — a birthday wish must be instant and safe.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(["en", "hi"] as const).map((lang) => (
            <div key={lang}>
              <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                {lang === "en" ? "English" : "हिंदी"}
                <span className="ml-auto flex gap-1">
                  {DEFAULT_BIRTHDAY_MESSAGES[lang].map((m) => (
                    <button key={m.label} type="button" disabled={!canEdit} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px]" onClick={() => patch(lang === "en" ? { messageEn: m.body } : { messageHi: m.body })}>
                      {m.label}
                    </button>
                  ))}
                </span>
              </div>
              <textarea className={`${inp} mt-0.5 min-h-[6rem]`} disabled={!canEdit} value={lang === "en" ? s.messageEn || DEFAULT_BIRTHDAY_MESSAGES.en[0].body : s.messageHi || DEFAULT_BIRTHDAY_MESSAGES.hi[0].body} onChange={(e) => patch(lang === "en" ? { messageEn: e.target.value } : { messageHi: e.target.value })} lang={lang === "hi" ? "hi" : undefined} />
            </div>
          ))}
          <label className="text-[11px] text-[var(--muted)]">
            School default language (when the family has not chosen)
            <select className={`${inp} mt-0.5`} value={s.defaultLanguage} disabled={!canEdit} onChange={(e) => patch({ defaultLanguage: e.target.value as "en" | "hi" })}>
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
            </select>
          </label>
        </div>
      </div>

      {/* Auto-send + WhatsApp template + social */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-sm font-semibold">Automatic sending</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={s.autoSend} disabled={!canEdit} onChange={(e) => patch({ autoSend: e.target.checked })} />
            Send greetings automatically every day
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            At (IST hour)
            <select className={`${inp} mt-0.5`} value={s.sendHour} disabled={!canEdit} onChange={(e) => patch({ sendHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            WhatsApp template (image header) — needed outside Meta&apos;s 24h window
            <select className={`${inp} mt-0.5`} value={s.waTemplateName} disabled={!canEdit} onChange={(e) => { const t = imageTemplates.find((x) => x.metaName === e.target.value); patch({ waTemplateName: e.target.value, waTemplateLanguage: t?.metaLanguage || t?.language || "en", waTemplateVars: t?.variables || [] }); }}>
              <option value="">Free text only (works inside 24h of the family&apos;s last message)</option>
              {imageTemplates.map((t) => (
                <option key={t.id} value={t.metaName}>
                  {t.name} · {t.metaName} ({t.language})
                </option>
              ))}
            </select>
          </label>
          {s.waTemplateName ? (
            <p className="text-[11px] text-[var(--muted)] sm:col-span-3">
              Template body variables in order: {s.waTemplateVars.length ? s.waTemplateVars.join(", ") : "none"} — values: childName · firstName · guardianName · className · age · schoolName · cardLink. The card goes as the image header.
            </p>
          ) : (
            <p className="text-[11px] text-[var(--warning)] sm:col-span-3">
              Without an approved image-header template, Meta only delivers free text to families who messaged the school in the last 24 hours. Create &ldquo;birthday_greeting&rdquo; in Masters → WhatsApp templates (header IMAGE, body with variables) and pick it here.
            </p>
          )}
          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={s.socialEnabled} disabled={!canEdit} onChange={(e) => patch({ socialEnabled: e.target.checked })} />
            Also post on the school&apos;s social pages (one post per day)
          </label>
          <label className="inline-flex items-center gap-2 text-xs" title="Off = a names-only group card. On = the student's photo card (only when exactly one birthday that day). Use only with parents' photo consent.">
            <input type="checkbox" checked={s.socialIncludePhoto} disabled={!canEdit || !s.socialEnabled} onChange={(e) => patch({ socialIncludePhoto: e.target.checked })} />
            Include the student&apos;s photo on social (needs consent)
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Social card design
            <select className={`${inp} mt-0.5`} value={s.socialDesign} disabled={!canEdit || !s.socialEnabled} onChange={(e) => patch({ socialDesign: e.target.value as BirthdayDesignId })}>
              {BIRTHDAY_DESIGNS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-[var(--muted)] sm:col-span-3">
            Social caption ({"{{names}} {{schoolName}} {{schoolTag}}"})
            <input className={`${inp} mt-0.5`} disabled={!canEdit || !s.socialEnabled} value={s.socialCaption || DEFAULT_SOCIAL_CAPTION} onChange={(e) => patch({ socialCaption: e.target.value })} />
          </label>
        </div>
        {canEdit ? (
          <div className="mt-3 flex items-center gap-2">
            <button type="button" disabled={!dirty} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50" onClick={save}>
              <Sparkles className="h-3.5 w-3.5" />
              Save birthday settings
            </button>
            {dirty ? <span className="text-[11px] text-[var(--warning)]">Unsaved changes</span> : null}
          </div>
        ) : null}
      </div>

      {/* Log */}
      {state.log.length ? (
        <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
          <summary className="cursor-pointer text-sm font-semibold">Send log ({state.log.length})</summary>
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-[11px]">
            {[...state.log].reverse().slice(0, 200).map((e) => (
              <li key={`${e.key}|${e.channel}`} className={e.status === "sent" ? "" : e.status === "failed" ? "text-[var(--danger)]" : "text-[var(--muted)]"}>
                {e.at.slice(0, 16).replace("T", " ")} · {e.date} · {sis.students.find((x) => x.id === e.studentId)?.fullName || e.studentId} · {e.channel} · {e.status}{e.detail ? ` · ${e.detail}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-[10px] text-[var(--muted)]">Families&apos; quiet hours are respected (deferred sends are retried by the next tick). STOP opt-outs are enforced at send. Masters: {masters.classes?.length || 0} classes loaded.</p>
    </div>
  );
}
