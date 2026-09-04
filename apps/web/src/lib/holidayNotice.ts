/**
 * A holiday announcement to families, built from the Masters holiday
 * record — pure, so the office's preview and the send use one text.
 *
 * Two shapes: a planned holiday (from the calendar) and an unplanned
 * closure ordered by the local administration for weather or another
 * cause. The closure text names the reason and who ordered it, states
 * that buses will not run, and gives the reopening date, so no parent
 * has to ring the office to ask.
 */

export type ClosureReasonCode =
  | "heat_wave"
  | "cold_wave"
  | "heavy_rain"
  | "flood"
  | "air_pollution"
  | "election"
  | "law_and_order"
  | "bandh"
  | "other";

export const CLOSURE_REASONS: { code: ClosureReasonCode; en: string; hi: string }[] = [
  { code: "heat_wave", en: "the heat wave", hi: "भीषण गर्मी (लू)" },
  { code: "cold_wave", en: "the cold wave", hi: "शीतलहर" },
  { code: "heavy_rain", en: "heavy rain", hi: "भारी बारिश" },
  { code: "flood", en: "flooding in the area", hi: "क्षेत्र में बाढ़" },
  { code: "air_pollution", en: "severe air pollution", hi: "गंभीर वायु प्रदूषण" },
  { code: "election", en: "election duty at the school", hi: "विद्यालय में चुनाव ड्यूटी" },
  { code: "law_and_order", en: "a law-and-order advisory", hi: "कानून-व्यवस्था संबंधी निर्देश" },
  { code: "bandh", en: "a local bandh", hi: "स्थानीय बंद" },
  { code: "other", en: "unavoidable circumstances", hi: "अपरिहार्य परिस्थितियों" },
];

const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_HI = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_HI = ["जन", "फ़र", "मार्च", "अप्रै", "मई", "जून", "जुला", "अग", "सित", "अक्टू", "नव", "दिस"];

/** "Mon 8 Sep" / "सोम 8 सित" from YYYY-MM-DD. Year only when it is not this year. */
export function holidayDateLabel(iso: string, lang: "en" | "hi", now = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dow = lang === "hi" ? DAYS_HI[d.getUTCDay()] : DAYS_EN[d.getUTCDay()];
  const mon = lang === "hi" ? MONTHS_HI[d.getUTCMonth()] : MONTHS_EN[d.getUTCMonth()];
  const year = d.getUTCFullYear() === now.getUTCFullYear() ? "" : ` ${d.getUTCFullYear()}`;
  return `${dow} ${d.getUTCDate()} ${mon}${year}`;
}

export function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** The day after the holiday, skipping Sunday — the school's weekly off. */
export function defaultReopenDate(endsOn: string): string {
  let next = addDays(endsOn, 1);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(next);
  if (m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() === 0) {
    next = addDays(next, 1);
  }
  return next;
}

export type HolidayNoticeInput = {
  schoolName: string;
  title: string;
  startsOn: string;
  endsOn: string;
  /** "emergency" and "other" are closures; everything else is a planned holiday. */
  kind: string;
  note?: string;
  /** Closure only */
  reason?: ClosureReasonCode;
  orderedBy?: string;
  reopenDate?: string;
};

export type HolidayNotice = {
  family: "holiday_notice" | "holiday_emergency";
  variables: Record<string, string>;
  variablesHi: Record<string, string>;
  textEn: string;
  textHi: string;
};

export function isClosureKind(kind: string): boolean {
  return kind === "emergency" || kind === "other";
}

export function buildHolidayNotice(input: HolidayNoticeInput, now = new Date()): HolidayNotice {
  const closure = isClosureKind(input.kind);
  const reopen = input.reopenDate || defaultReopenDate(input.endsOn);
  const reason = CLOSURE_REASONS.find((r) => r.code === (input.reason ?? "other")) ?? CLOSURE_REASONS[CLOSURE_REASONS.length - 1]!;
  const orderedBy = (input.orderedBy || "").trim() || "the local administration";
  const orderedByHi = (input.orderedBy || "").trim() || "स्थानीय प्रशासन";
  const note = (input.note || "").trim();
  const noteEn = note || (closure ? "Homework for these days is in the parent app; the AI tutor is open as usual." : "The calendar in the parent app has all holiday dates.");
  const noteHi = note || (closure ? "इन दिनों का गृहकार्य पैरेंट ऐप में है; AI ट्यूटर सदा की तरह उपलब्ध है।" : "पैरेंट ऐप के कैलेंडर में सभी अवकाश की तारीखें हैं।");
  const common = {
    schoolName: input.schoolName,
    holidayFrom: holidayDateLabel(input.startsOn, "en", now),
    holidayTo: holidayDateLabel(input.endsOn, "en", now),
    reopenDate: holidayDateLabel(reopen, "en", now),
    holidayNote: noteEn,
  };
  const commonHi = {
    schoolName: input.schoolName,
    holidayFrom: holidayDateLabel(input.startsOn, "hi", now),
    holidayTo: holidayDateLabel(input.endsOn, "hi", now),
    reopenDate: holidayDateLabel(reopen, "hi", now),
    holidayNote: noteHi,
  };
  if (closure) {
    const variables = { ...common, holidayReason: reason.en, orderedBy };
    const variablesHi = { ...commonHi, holidayReason: reason.hi, orderedBy: orderedByHi };
    return {
      family: "holiday_emergency",
      variables,
      variablesHi,
      textEn: `⚠️ *${input.schoolName}* — school CLOSED due to ${reason.en}, as ordered by ${orderedBy}.\n📅 ${common.holidayFrom} to ${common.holidayTo}\n🏫 Reopens ${common.reopenDate}\n🚌 Buses will not run.\n📝 ${noteEn}\nPlease keep your child safe at home. 🙏`,
      textHi: `⚠️ *${input.schoolName}* — ${reason.hi} के कारण, ${orderedByHi} के आदेश पर विद्यालय बंद रहेगा।\n📅 ${commonHi.holidayFrom} से ${commonHi.holidayTo} तक\n🏫 फिर खुलेगा ${commonHi.reopenDate}\n🚌 बसें नहीं चलेंगी।\n📝 ${noteHi}\nकृपया बच्चे को घर पर सुरक्षित रखें। 🙏`,
    };
  }
  const variables = { ...common, holidayTitle: input.title };
  const variablesHi = { ...commonHi, holidayTitle: input.title };
  return {
    family: "holiday_notice",
    variables,
    variablesHi,
    textEn: `🎉 *${input.schoolName}* — holiday: *${input.title}*\n📅 ${common.holidayFrom} to ${common.holidayTo}\n🏫 School reopens ${common.reopenDate}\n📝 ${noteEn}\nEnjoy the break! 🌼`,
    textHi: `🎉 *${input.schoolName}* — अवकाश: *${input.title}*\n📅 ${commonHi.holidayFrom} से ${commonHi.holidayTo} तक\n🏫 विद्यालय फिर खुलेगा ${commonHi.reopenDate}\n📝 ${noteHi}\nअवकाश का आनंद लें! 🌼`,
  };
}
