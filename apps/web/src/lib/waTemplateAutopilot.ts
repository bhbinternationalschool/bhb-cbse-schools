/**
 * WhatsApp template autopilot — pure rules.
 *
 * The director's brief, 30 Sep 2026: when a message cannot go because its
 * template is not approved, nobody should have to do anything.
 *
 *   1. HOLD — the message is kept, and sent the moment Meta approves the
 *      template in the family's language. If the day it talks about comes
 *      first, it is dropped and the sender is told.
 *   2. FIX — a template Meta rejects is rewritten (by the AI, with Meta's
 *      reason) and resubmitted. Two automatic tries; after that the
 *      director gets one WhatsApp note.
 *   3. CHECK — every run, each of the school's utility templates is checked
 *      in both languages; one that was never submitted is submitted.
 *
 * Why not a new template per message: Meta takes minutes to a day to
 * approve, rejects one-off or mostly-blank templates, re-prices them as
 * marketing, and counts rejections against the number's quality. The
 * approved general templates carry any message; this keeps them approved.
 */

import { datesMentioned } from "@/lib/staffLeaveWa";

/** Mobiles per template language: { hi: [...], en: [...] }. */
export type HeldRecipients = Record<string, string[]>;

/* ── Time, in IST ─────────────────────────────────────────────────────── */

const IST_MS = 5.5 * 60 * 60_000;

function istDateOf(d: Date): string {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
}

/** An IST wall-clock time on a date, as an instant. */
function istInstant(dateIso: string, hh: number, mm = 0): Date {
  return new Date(Date.parse(`${dateIso}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`) - IST_MS);
}

/** "Thu 2 Oct, 7:00 AM" — for the sender. */
export function formatIstWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + IST_MS);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getUTCHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${h}:${String(d.getUTCMinutes()).padStart(2, "0")} ${ampm}`;
}

/**
 * Until when a held message is still worth sending.
 *
 * A notice is about a day: "kal chhutti hai" is no use once tomorrow's
 * school day has begun. So it lapses at 7:00 AM IST on the first future
 * day it mentions; at midnight when it only mentions today; and a day
 * after it was written when it names no day at all. Never more than a
 * week.
 */
export function heldExpiryFor(text: string, now: Date, eventDateIso = ""): string {
  const today = istDateOf(now);
  const dates = [...datesMentioned(text, today), ...(eventDateIso ? [eventDateIso] : [])]
    .filter((d) => d >= today)
    .sort();
  const weekOut = now.getTime() + 7 * 24 * 60 * 60_000;
  let at: number;
  const first = dates[0];
  if (!first) at = now.getTime() + 24 * 60 * 60_000;
  else if (first === today) at = istInstant(today, 23, 59).getTime();
  else at = istInstant(first, 7).getTime();
  // Always at least an hour to wait — a notice written at 6:50 AM about
  // "today" still has its evening.
  at = Math.max(at, now.getTime() + 60 * 60_000);
  return new Date(Math.min(at, weekOut)).toISOString();
}

/* ── Releasing held messages ──────────────────────────────────────────── */

/**
 * Which language groups can go now: those whose template is approved.
 * Never a group in another language — a family gets its own language or,
 * for now, nothing.
 */
export function splitReleasable(
  recipients: HeldRecipients,
  approvedLanguages: string[],
): { send: HeldRecipients; keep: HeldRecipients } {
  const send: HeldRecipients = {};
  const keep: HeldRecipients = {};
  for (const [lang, mobiles] of Object.entries(recipients || {})) {
    const list = (mobiles || []).filter(Boolean);
    if (!list.length) continue;
    if (approvedLanguages.includes(lang)) send[lang] = list;
    else keep[lang] = list;
  }
  return { send, keep };
}

export function countRecipients(r: HeldRecipients): number {
  return Object.values(r || {}).reduce((n, list) => n + (list?.length ?? 0), 0);
}

/* ── Checking an AI rewrite before Meta sees it ───────────────────────── */

const VAR_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** Named variables in first-appearance order, each once. */
export function templateVariables(text: string): string[] {
  const out: string[] = [];
  for (const m of (text || "").matchAll(VAR_RE)) {
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/**
 * A rewritten body the senders can still fill in, and that Meta's own
 * checks will not bounce: the SAME variables in the SAME order (Meta fills
 * parameters by position, so a reordering would put a child's name where
 * the date goes), text before the first and after the last variable, no
 * two variables side by side, enough words around them, within 1024.
 */
export function validateTemplateRewrite(
  original: { body: string },
  candidate: string,
): { ok: true } | { ok: false; errors: string[] } {
  const body = (candidate || "").trim();
  const errors: string[] = [];
  if (!body) return { ok: false, errors: ["empty"] };
  if (body.length > 1024) errors.push("longer than 1024 characters");
  const want = templateVariables(original.body);
  const got = templateVariables(body);
  if (got.join(",") !== want.join(",")) {
    errors.push(`variables must be exactly ${want.map((v) => `{{${v}}}`).join(", ") || "none"}, in that order (got ${got.map((v) => `{{${v}}}`).join(", ") || "none"})`);
  }
  if (/\{\{(?!\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\})/.test(body) || /(?<!\{)\{(?!\{)[^}]*\}\}/.test(body)) {
    errors.push("a broken {{ }} placeholder");
  }
  if (/^\s*\{\{/.test(body)) errors.push("starts with a variable");
  if (/\}\}\s*[.!।]?\s*$/.test(body)) errors.push("ends with a variable");
  if (/\}\}\s*\{\{/.test(body)) errors.push("two variables side by side");
  if (/\n{3,}/.test(body)) errors.push("more than one blank line in a row");
  const words = body.replace(VAR_RE, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (got.length && words < got.length * 3 + 3) errors.push("too few words for its variables");
  return errors.length ? { ok: false, errors } : { ok: true };
}

/* ── What to do with each template ────────────────────────────────────── */

export const MAX_AUTO_FIXES = 2;

export type TemplateLike = {
  familyKey: string;
  language: string;
  category: string;
  status: string;
  metaTemplateId: string;
  syncedAt: string;
  headerFormat: string;
  carousel?: unknown[];
};

export type RepairState = { attempts: number; notifiedAt: string; lastAttemptAt: string };

/**
 * submit — never sent to Meta; fix — rejected, try a rewrite;
 * notify — rejected after every automatic try, or paused by Meta: one note
 * to the director; none — nothing to do (approved, pending, or not ours).
 */
export function templateAction(
  t: TemplateLike,
  repair: RepairState | null,
  seedFamilies: ReadonlySet<string>,
): "submit" | "fix" | "notify" | "none" {
  if (!seedFamilies.has(t.familyKey)) return "none";
  // Media headers need an uploaded sample and carousels are not submitted
  // by this code at all; authentication templates have a fixed shape.
  const automatable =
    t.category !== "AUTHENTICATION" &&
    !(t.carousel && t.carousel.length) &&
    (t.headerFormat === "NONE" || t.headerFormat === "TEXT" || !t.headerFormat);
  if (t.status === "paused") return repair?.notifiedAt ? "none" : "notify";
  if (t.status === "rejected") {
    if (!automatable) return repair?.notifiedAt ? "none" : "notify";
    if ((repair?.attempts ?? 0) >= MAX_AUTO_FIXES) return repair?.notifiedAt ? "none" : "notify";
    return "fix";
  }
  if (t.status === "pending" && !t.metaTemplateId && !t.syncedAt) {
    // Only utility templates go on their own: a marketing one is a choice
    // the school makes, and it is billed as marketing.
    return automatable && t.category === "UTILITY" ? "submit" : "none";
  }
  return "none";
}

/* ── What the sender and the director are told ────────────────────────── */

export function composeHeldAck(opts: { label: string; held: number; expiresAt: string }): string {
  return [
    `⏳ ${opts.held} ${opts.held === 1 ? "family" : "families"} could not get "${opts.label}" yet: WhatsApp has not approved the school's template for them.`,
    "",
    `It is kept, and goes to them *automatically* the moment WhatsApp approves it — you don't need to do anything.`,
    `If it is not approved by *${formatIstWhen(opts.expiresAt)}*, it is dropped and you'll be told.`,
  ].join("\n");
}

export function composeReleasedNote(opts: { label: string; sent: number; failed: number; stillHeld: number }): string {
  const bits = [`✅ "${opts.label}" has now gone to ${opts.sent} more ${opts.sent === 1 ? "family" : "families"} — WhatsApp approved the template.`];
  if (opts.failed) bits.push(`${opts.failed} could not be delivered.`);
  if (opts.stillHeld) bits.push(`${opts.stillHeld} still waiting (their language's template is not approved yet).`);
  return bits.join(" ");
}

export function composeExpiredNote(opts: { label: string; notSent: number }): string {
  return `⌛ "${opts.label}" was not sent to ${opts.notSent} ${opts.notSent === 1 ? "family" : "families"}: WhatsApp did not approve the template in time, and the message is about a day that has now come. Nothing more will be sent. If it still matters, tell them another way.`;
}

export function composeRepairGaveUpNote(opts: { name: string; language: string; reason: string; attempts: number; paused?: boolean }): string {
  const lang = opts.language === "hi" ? "Hindi" : "English";
  if (opts.paused) {
    return `⚠️ WhatsApp has *paused* the "${opts.name}" template (${lang}) because of low quality feedback from parents. Messages that need it are being held. Please review it in Masters → WhatsApp templates.`;
  }
  return [
    `⚠️ WhatsApp rejected the "${opts.name}" template (${lang})${opts.attempts ? ` ${opts.attempts} time${opts.attempts === 1 ? "" : "s"} after automatic rewrites` : ""}.`,
    opts.reason ? `Meta's reason: ${opts.reason}` : "",
    "Messages that need it are being held. Please look at it in Masters → WhatsApp templates.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ── One truth for "is it approved" ───────────────────────────────────── */

type MetaOwned = {
  metaName: string;
  language: string;
  status: string;
  paused: boolean;
  metaTemplateId: string;
  rejectionReason: string;
  syncedAt: string;
  /**
   * Meta's category, not the one the template was submitted as: Meta
   * re-classes on its own (bhb_exam_tomorrow went in as UTILITY and is
   * billed as MARKETING in English), and the bill follows Meta's.
   */
  category?: string;
};

/**
 * The templates as the office edited them, with what Meta last said about
 * each laid over the top.
 *
 * Two copies exist: the office's desk (wordings, edited in Masters) and the
 * registry the hourly Meta sync and the status webhook keep current. On 30
 * Sep 2026 the desk copy had not changed since 21 Sep while the registry
 * was an hour old — so a template Meta approved after the 21st would have
 * been refused by every sender that read the desk. Meta's own fields come
 * from whichever copy heard from Meta last; the wording stays the office's.
 */
export function overlayMetaFields<D extends MetaOwned>(desk: D[], registry: MetaOwned[]): D[] {
  const key = (t: { metaName: string; language: string }) => `${t.metaName}|${t.language}`;
  const fresh = new Map(registry.filter((r) => r.metaName).map((r) => [key(r), r]));
  return desk.map((d) => {
    const r = fresh.get(key(d));
    if (!r) return d;
    const rAt = Date.parse(r.syncedAt || "") || 0;
    const dAt = Date.parse(d.syncedAt || "") || 0;
    if (rAt <= dAt) return d;
    return {
      ...d,
      status: r.status,
      paused: r.paused,
      metaTemplateId: r.metaTemplateId || d.metaTemplateId,
      rejectionReason: r.rejectionReason,
      syncedAt: r.syncedAt,
      ...(r.category ? { category: r.category } : {}),
    };
  });
}
