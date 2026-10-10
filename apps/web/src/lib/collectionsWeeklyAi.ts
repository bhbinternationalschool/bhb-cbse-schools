/**
 * The director's weekly collections note — facts, prompt, parser.
 *
 * Follows the ledger brief exactly: deterministic code computes what moved
 * this week, the model writes a handful of sentences connecting it, and the
 * model NEVER writes a digit. Every figure the director needs is rendered by
 * the facts block that travels with the note (and, on WhatsApp, is printed
 * above it), so a sentence with a number in it is a number nobody computed.
 *
 * What counts as "what moved" is limited to what the ERP actually records:
 *   - receipts this week against the same week before;
 *   - the ageing of what is still owed (over ninety days, one to three
 *     months, this month, not yet due), with how many children sit in each;
 *   - parent meetings the fee desk scheduled and how they ended.
 * Reminders sent and promises made are not recorded as facts today, so they
 * are passed as "not available" and the prompt forbids commenting on them.
 * When the school starts recording them the note gets better; it does not
 * pretend to know them now.
 */

import { formatInr } from "@/lib/masters";

export type CollectionsWeeklyLanguage = "en" | "hi";

const CONTAINS_DIGIT = /\d/;

export type AgeingBand = "over90" | "d31to90" | "d0to30" | "notDue";

export const AGEING_BAND_LABEL: Record<AgeingBand, string> = {
  over90: "Over 90 days",
  d31to90: "31–90 days",
  d0to30: "0–30 days",
  notDue: "Not yet due",
};

export type AgeingBandFacts = { band: AgeingBand; amountPaise: number; children: number };

export type CollectionsWeeklyFacts = {
  schoolName: string;
  academicYearCode: string;
  /** ISO dates, inclusive. */
  weekFrom: string;
  weekTo: string;
  receipts: {
    thisWeek: { count: number; amountPaise: number };
    lastWeek: { count: number; amountPaise: number };
    /** Session to date. */
    sessionAmountPaise: number;
    sessionBilledPaise: number | null;
  };
  ageing: AgeingBandFacts[];
  totalOpenPaise: number;
  childrenOwing: number;
  /** Fee-desk parent meetings whose date fell in the week. */
  meetings: { scheduled: number; done: number; noShow: number; cancelled: number } | null;
};

export type CollectionsWeeklyDraft = {
  /** One sentence. No digits. */
  headline: string;
  /** Three to six sentences. No digits. */
  note: string;
};

export const COLLECTIONS_WEEKLY_PROMPT_VERSION = "v1";

/** Which band a due sits in, by its due date relative to today. */
export function ageingBandFor(dueOn: string, todayIso: string): AgeingBand {
  const due = new Date(dueOn);
  const today = new Date(todayIso);
  if (Number.isNaN(due.getTime())) return "d0to30";
  const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  if (days < 0) return "notDue";
  if (days > 90) return "over90";
  if (days > 30) return "d31to90";
  return "d0to30";
}

/**
 * Fold open dues into the four bands. Children are counted per band by the
 * student id, so a child with three overdue months counts once in a band.
 */
export function buildAgeing(
  dues: { studentId: string; dueOn: string; balancePaise: number }[],
  todayIso: string,
): { ageing: AgeingBandFacts[]; totalOpenPaise: number; childrenOwing: number } {
  const bands: Record<AgeingBand, { amountPaise: number; students: Set<string> }> = {
    over90: { amountPaise: 0, students: new Set() },
    d31to90: { amountPaise: 0, students: new Set() },
    d0to30: { amountPaise: 0, students: new Set() },
    notDue: { amountPaise: 0, students: new Set() },
  };
  const all = new Set<string>();
  let total = 0;
  for (const d of dues) {
    if (d.balancePaise <= 0) continue;
    const b = ageingBandFor(d.dueOn, todayIso);
    bands[b].amountPaise += d.balancePaise;
    bands[b].students.add(d.studentId);
    all.add(d.studentId);
    total += d.balancePaise;
  }
  const order: AgeingBand[] = ["over90", "d31to90", "d0to30", "notDue"];
  return {
    ageing: order.map((band) => ({ band, amountPaise: bands[band].amountPaise, children: bands[band].students.size })),
    totalOpenPaise: total,
    childrenOwing: all.size,
  };
}

/** Receipts by collection date, split into this week and the week before. */
export function buildReceiptWeeks(
  vouchers: { collectionDate: string; totalPaise: number; voidedAt?: string | null }[],
  weekFrom: string,
  weekTo: string,
): CollectionsWeeklyFacts["receipts"] {
  const from = new Date(weekFrom);
  const prevFrom = new Date(from);
  prevFrom.setDate(prevFrom.getDate() - 7);
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const inRange = (day: string, a: string, b: string) => day >= a && day <= b;
  const thisWeek = { count: 0, amountPaise: 0 };
  const lastWeek = { count: 0, amountPaise: 0 };
  let session = 0;
  for (const v of vouchers) {
    if (v.voidedAt) continue;
    const day = (v.collectionDate || "").slice(0, 10);
    session += v.totalPaise;
    if (inRange(day, weekFrom, weekTo)) {
      thisWeek.count += 1;
      thisWeek.amountPaise += v.totalPaise;
    } else if (inRange(day, iso(prevFrom), iso(prevTo))) {
      lastWeek.count += 1;
      lastWeek.amountPaise += v.totalPaise;
    }
  }
  return { thisWeek, lastWeek, sessionAmountPaise: session, sessionBilledPaise: null };
}

/** The Monday-to-Sunday week that ended before `todayIso` (school runs Mon–Sat). */
export function lastCompleteWeek(todayIso: string): { weekFrom: string; weekTo: string } {
  const today = new Date(todayIso);
  const dow = today.getUTCDay(); // 0 = Sunday
  const to = new Date(today);
  // Back to the most recent Sunday strictly before today (a Monday run reports last week).
  to.setUTCDate(today.getUTCDate() - (dow === 0 ? 7 : dow));
  const from = new Date(to);
  from.setUTCDate(to.getUTCDate() - 6);
  return { weekFrom: from.toISOString().slice(0, 10), weekTo: to.toISOString().slice(0, 10) };
}

/** The figures block that always accompanies the note — on screen and on WhatsApp. */
export function renderCollectionsWeeklyFigures(f: CollectionsWeeklyFacts): string {
  const r = f.receipts;
  const delta = r.thisWeek.amountPaise - r.lastWeek.amountPaise;
  const deltaLabel = delta === 0 ? "level with" : delta > 0 ? `${formatInr(delta)} more than` : `${formatInr(-delta)} less than`;
  const lines = [
    `*Fee collections · ${f.weekFrom} to ${f.weekTo}*`,
    `💰 Collected this week: *${formatInr(r.thisWeek.amountPaise)}* (${r.thisWeek.count} receipts) — ${deltaLabel} the week before (${formatInr(r.lastWeek.amountPaise)})`,
    `📅 Session so far: ${formatInr(r.sessionAmountPaise)}${r.sessionBilledPaise != null ? ` of ${formatInr(r.sessionBilledPaise)} billed` : ""}`,
    `📋 Still owed: *${formatInr(f.totalOpenPaise)}* across ${f.childrenOwing} children`,
  ];
  for (const b of f.ageing) {
    if (b.amountPaise <= 0) continue;
    lines.push(`   • ${AGEING_BAND_LABEL[b.band]}: ${formatInr(b.amountPaise)} · ${b.children} children`);
  }
  if (f.meetings) {
    lines.push(
      `🤝 Parent meetings this week: ${f.meetings.scheduled} scheduled · ${f.meetings.done} held · ${f.meetings.noShow} no-show${f.meetings.cancelled ? ` · ${f.meetings.cancelled} cancelled` : ""}`,
    );
  }
  return lines.join("\n");
}

export function buildCollectionsWeeklySystemPrompt(opts: {
  language: CollectionsWeeklyLanguage;
  schoolName: string;
}): string {
  const lang = opts.language === "hi" ? "Write in simple Hindi (Devanagari)." : "Write in plain English.";
  return [
    `You write the Monday note on fee collections for the director of ${opts.schoolName}.`,
    lang,
    "",
    "You are given this week's figures, ALREADY computed: what was collected against the",
    "week before, how the money still owed is aged, and how parent meetings went. Your job",
    "is to say what it means in a few sentences a busy person can act on — is the old debt",
    "shrinking or growing, is collection ahead of or behind the previous week, what deserves",
    "a call this week.",
    "",
    "ABSOLUTE RULES:",
    "1. NEVER write a digit. Not an amount, a count, a date or a percentage. The figures are",
    "   printed above your note. Use words: 'well above last week', 'most of what is owed'.",
    "2. Use only the facts given. Anything marked 'not available' must not be mentioned or",
    "   guessed at — do not speak of reminders or promises unless they appear as facts.",
    "3. Do not name, judge or single out any family. Speak of bands and totals only.",
    "4. If nothing moved, say so plainly. Do not manufacture concern or praise.",
    "",
    'Reply with JSON only: {"headline":"...","note":"..."}',
    "headline: one sentence. note: three to six sentences.",
  ].join("\n");
}

export function buildCollectionsWeeklyUserPrompt(f: CollectionsWeeklyFacts): string {
  const r = f.receipts;
  const lines: string[] = [
    `Session ${f.academicYearCode} · week ${f.weekFrom} to ${f.weekTo}`,
    "",
    `Collected this week: ${formatInr(r.thisWeek.amountPaise)} in ${r.thisWeek.count} receipts.`,
    `Collected the week before: ${formatInr(r.lastWeek.amountPaise)} in ${r.lastWeek.count} receipts.`,
    `Session to date: ${formatInr(r.sessionAmountPaise)}${r.sessionBilledPaise != null ? ` of ${formatInr(r.sessionBilledPaise)} billed` : ""}.`,
    "",
    `Still owed: ${formatInr(f.totalOpenPaise)} across ${f.childrenOwing} children, aged:`,
  ];
  for (const b of f.ageing) {
    lines.push(`- ${AGEING_BAND_LABEL[b.band]}: ${formatInr(b.amountPaise)} · ${b.children} children`);
  }
  lines.push(
    "",
    f.meetings
      ? `Parent meetings dated this week: ${f.meetings.scheduled} scheduled, ${f.meetings.done} held, ${f.meetings.noShow} no-show, ${f.meetings.cancelled} cancelled.`
      : "Parent meetings: not available. Do not comment on them.",
    "Reminders sent and promises to pay: not available. Do not comment on them.",
    "How the ageing bands moved since last week: not available. Speak only of where the money sits now.",
  );
  return lines.join("\n");
}

export function parseCollectionsWeeklyJson(text: string): CollectionsWeeklyDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const headline = typeof o.headline === "string" ? o.headline.trim() : "";
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (!headline || !note) return null;
  if (CONTAINS_DIGIT.test(headline) || CONTAINS_DIGIT.test(note)) return null;
  return { headline, note };
}
