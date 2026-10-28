/**
 * Linking a parent's unknown phone number by asking about the child on
 * WhatsApp (director, 14 Oct 2026).
 *
 * Someone tries to log in to the parent app with a number the school does not
 * have. The ERP writes to that number on WhatsApp (template
 * parent_number_check) and, if they answer, asks five questions:
 *
 *   1. the child's full name      3. the child's class      5. the mother's name
 *   2. the child's date of birth  4. the father's name
 *
 * Only ACTIVE children on roll count — a child who has left is never matched,
 * so a number is never linked to a family through an inactive student.
 *
 * VERIFIED only when exactly one child on roll has that date of birth and
 * name, is in that class, and the father's OR mother's name agrees with the
 * record. Then the number is linked to the family, the parent is told they
 * can log in, and the family's REGISTERED number is told a new number was
 * added — so if somebody who knows a child's details links themselves, the
 * real family hears about it the same minute.
 *
 * Every question is asked whatever the earlier answers were, and a failed
 * check never says which answer was wrong: otherwise the questions become a
 * way to test guesses about a child one detail at a time. Details that do not
 * match (after one more try), a reply that is not an answer, or anything odd
 * goes to the office with everything the person said.
 *
 * Pure: the server half is lib/waNumberVerify.server.ts.
 */

import { matchChild, namesAgree } from "@/lib/parentNumberLink";
import type { SisStudent } from "@/lib/sis";

export type WaVerifyStep =
  | "invited"
  | "name"
  | "dob"
  | "class"
  | "father"
  | "mother"
  | "linked"
  | "office"
  | "declined"
  | "expired";

export type WaVerifyAnswers = {
  childName: string;
  dob: string;
  className: string;
  fatherName: string;
  motherName: string;
};

export type WaVerifySession = {
  mobile10: string;
  step: WaVerifyStep;
  answers: WaVerifyAnswers;
  /** Full rounds of questions that did not match (one retry, then the office). */
  rounds: number;
  /** Unreadable replies in a row at the current question. */
  reasks: number;
  source: "login" | "office";
  invitedAt: string;
  updatedAt: string;
  /** What happened, for the office: "linked to …", "sent to office: …". */
  result: string;
};

export type WaVerifyState = { version: 1; sessions: WaVerifySession[] };

export const TERMINAL_STEPS: ReadonlySet<WaVerifyStep> = new Set(["linked", "office", "declined", "expired"]);
/** An invitation stays answerable this long; a conversation in progress, this long since the last reply. */
export const INVITE_TTL_MS = 7 * 86_400_000;
export const STEP_TTL_MS = 2 * 86_400_000;
/** No second invitation to the same number within this time (a parent retrying the app is not spammed). */
export const REINVITE_AFTER_MS = 3 * 86_400_000;

const emptyAnswers = (): WaVerifyAnswers => ({ childName: "", dob: "", className: "", fatherName: "", motherName: "" });

export function emptyWaVerifyState(): WaVerifyState {
  return { version: 1, sessions: [] };
}

const STEPS = new Set<WaVerifyStep>(["invited", "name", "dob", "class", "father", "mother", "linked", "office", "declined", "expired"]);
const s = (v: unknown, max = 160) => String(v ?? "").slice(0, max);

export function normalizeWaVerifyState(raw: unknown): WaVerifyState {
  const r = (raw ?? {}) as Partial<WaVerifyState>;
  return {
    version: 1,
    sessions: (Array.isArray(r.sessions) ? r.sessions : [])
      .filter((x) => /^\d{10}$/.test(String(x?.mobile10 ?? "")) && STEPS.has(x?.step as WaVerifyStep))
      .map((x) => ({
        mobile10: String(x.mobile10),
        step: x.step as WaVerifyStep,
        answers: {
          childName: s(x.answers?.childName),
          dob: s(x.answers?.dob, 10),
          className: s(x.answers?.className, 20),
          fatherName: s(x.answers?.fatherName),
          motherName: s(x.answers?.motherName),
        },
        rounds: Math.max(0, Math.min(5, Number(x.rounds) || 0)),
        reasks: Math.max(0, Math.min(5, Number(x.reasks) || 0)),
        source: (x.source === "office" ? "office" : "login") as WaVerifySession["source"],
        invitedAt: s(x.invitedAt, 40),
        updatedAt: s(x.updatedAt, 40),
        result: s(x.result, 400),
      }))
      .slice(0, 1000),
  };
}

/** The live (answerable) session for a number, if any. */
export function liveSession(state: WaVerifyState, mobile10: string, nowMs: number): WaVerifySession | null {
  const x = state.sessions.find((v) => v.mobile10 === mobile10);
  if (!x || TERMINAL_STEPS.has(x.step)) return null;
  const ttl = x.step === "invited" ? INVITE_TTL_MS : STEP_TTL_MS;
  return nowMs - Date.parse(x.updatedAt || x.invitedAt) <= ttl ? x : null;
}

/** May this number be invited now? (Not mid-conversation, not invited in the last few days, not finished.) */
export function canInvite(state: WaVerifyState, mobile10: string, nowMs: number, force = false): { ok: boolean; reason: string } {
  if (!/^[6-9]\d{9}$/.test(mobile10)) return { ok: false, reason: "not a valid Indian mobile number" };
  const x = state.sessions.find((v) => v.mobile10 === mobile10);
  if (!x) return { ok: true, reason: "" };
  if (x.step === "linked") return { ok: false, reason: "already linked" };
  if (liveSession(state, mobile10, nowMs)) return { ok: false, reason: "already in conversation" };
  if (!force && nowMs - Date.parse(x.invitedAt) < REINVITE_AFTER_MS) return { ok: false, reason: "asked recently" };
  if (!force && x.step === "declined") return { ok: false, reason: "said it was not them" };
  return { ok: true, reason: "" };
}

export function withSession(state: WaVerifyState, session: WaVerifySession): WaVerifyState {
  return { version: 1, sessions: [session, ...state.sessions.filter((v) => v.mobile10 !== session.mobile10)].slice(0, 1000) };
}

export function newInvite(mobile10: string, source: "login" | "office", nowIso: string): WaVerifySession {
  return { mobile10, step: "invited", answers: emptyAnswers(), rounds: 0, reasks: 0, source, invitedAt: nowIso, updatedAt: nowIso, result: "" };
}

/* ── reading answers ─────────────────────────────────────────── */

const DEVANAGARI = "०१२३४५६७८९";
const toAsciiDigits = (t: string) => t.replace(/[०-९]/g, (d) => String(DEVANAGARI.indexOf(d)));

/** Words of a reply, any script, punctuation and emoji dropped (JS \b does not work on Devanagari). */
const words = (text: string) =>
  String(text ?? "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
const startsWithAny = (text: string, options: string[]) => {
  const w = words(text).join(" ");
  return options.some((o) => w === o || w.startsWith(`${o} `));
};

export function isYes(text: string): boolean {
  return startsWithAny(text, ["haan", "haa", "han", "ha", "yes", "y", "ok", "okay", "ji", "हाँ", "हां", "हा", "जी", "ठीक"]);
}

export function isNo(text: string): boolean {
  return startsWithAny(text, ["no", "nahi", "nahin", "nhi", "n", "नहीं", "नही", "ना", "not me", "wrong number", "galat", "गलत"]);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  जनवरी: 1, फरवरी: 2, फ़रवरी: 2, मार्च: 3, अप्रैल: 4, मई: 5, जून: 6, जुलाई: 7, अगस्त: 8, सितंबर: 9, सितम्बर: 9, अक्टूबर: 10, नवंबर: 11, नवम्बर: 11, दिसंबर: 12, दिसम्बर: 12,
};

/** "12-11-2020", "12/11/20", "12.11.2020", "12 Nov 2020", "१२-११-२०२०" → "2020-11-12"; "" if unreadable or impossible. */
export function parseDob(text: string, nowYear = new Date().getUTCFullYear()): string {
  const t = toAsciiDigits(String(text ?? "")).trim().toLowerCase();
  let d = 0, m = 0, y = 0;
  const num = /^(\d{1,2})\s*[-/.\s]\s*(\d{1,2})\s*[-/.\s]\s*(\d{2}|\d{4})$/.exec(t);
  const word = /^(\d{1,2})\s*[-/.\s]?\s*([a-zऀ-ॿ]+)\s*[-/.\s,]?\s*(\d{2}|\d{4})$/.exec(t);
  if (num) {
    d = Number(num[1]); m = Number(num[2]); y = Number(num[3]);
  } else if (word) {
    const key = Object.keys(MONTHS).find((k) => word[2]!.startsWith(k));
    if (!key) return "";
    d = Number(word[1]); m = MONTHS[key]!; y = Number(word[3]);
  } else return "";
  if (y < 100) y += y <= nowYear % 100 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < nowYear - 25 || y > nowYear) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const HINDI_ORDINAL: Record<string, number> = { पहली: 1, दूसरी: 2, तीसरी: 3, चौथी: 4, पांचवी: 5, पाँचवीं: 5, पांचवीं: 5, छठी: 6, सातवीं: 7, आठवीं: 8, नौवीं: 9, दसवीं: 10 };

/** "class 3", "3rd", "III", "कक्षा ३", "UKG", "नर्सरी" → the school's own class names ("III", "UKG", "Nursery"); "" if unreadable. */
export function parseClassName(text: string): string {
  const raw = toAsciiDigits(String(text ?? ""));
  const w = words(raw);
  const has = (...opts: string[]) => opts.some((o) => w.includes(o));
  if (has("nur", "nursery", "नर्सरी", "pg", "playgroup") || /play\s*group/i.test(raw)) return "Nursery";
  if (has("lkg", "एलकेजी") || /l\.?\s*k\.?\s*g/i.test(raw)) return "LKG";
  if (has("ukg", "यूकेजी") || /u\.?\s*k\.?\s*g/i.test(raw)) return "UKG";
  const n = /(\d{1,2})/.exec(raw);
  if (n && Number(n[1]) >= 1 && Number(n[1]) <= 12) return ROMAN[Number(n[1])]!;
  const roman = w.find((x) => ROMAN.includes(x.toUpperCase()) && x !== "");
  if (roman) return roman.toUpperCase();
  const h = Object.keys(HINDI_ORDINAL).find((k) => raw.includes(k));
  return h ? ROMAN[HINDI_ORDINAL[h]!]! : "";
}

/** A name answer: letters (any script), 2–60 characters, not a number or a sentence. */
export function looksLikeName(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.length < 2 || t.length > 60) return false;
  if (/\d/.test(toAsciiDigits(t))) return false;
  if (t.split(/\s+/).length > 6) return false;
  return /\p{L}/u.test(t);
}

/* ── the check ───────────────────────────────────────────────── */

export type VerifyOutcome =
  | { kind: "verified"; student: SisStudent }
  | { kind: "no_match"; why: string; candidate: SisStudent | null };

/** Exact DOB + child's name + class, and the father's OR mother's name. */
export function verifyAnswers(onRoll: SisStudent[], a: WaVerifyAnswers, classNameOf: (classId: string) => string, guardianOf?: (s: SisStudent) => string): VerifyOutcome {
  // Director, 14 Oct 2026: never link a number to an inactive student. The
  // caller passes children on roll already (current-year row active); this
  // second guard keeps it true if a caller ever passes the raw roster.
  const active = onRoll.filter((s) => s.status === "active");
  const match = matchChild(active, { childName: a.childName, dob: a.dob, className: a.className }, classNameOf);
  if (match.kind === "none") return { kind: "no_match", why: "no child on roll with that name and date of birth", candidate: null };
  if (match.kind === "many") return { kind: "no_match", why: `several children match (${match.classes.join(", ")})`, candidate: null };
  const st = match.student;
  if (classNameOf(st.classId).trim().toLowerCase() !== a.className.trim().toLowerCase()) {
    return { kind: "no_match", why: `class given ${a.className || "—"}, record says ${classNameOf(st.classId) || "—"}`, candidate: st };
  }
  const father = !!a.fatherName && (namesAgree(a.fatherName, st.fatherName) || (!!guardianOf && namesAgree(a.fatherName, guardianOf(st))));
  const mother = !!a.motherName && namesAgree(a.motherName, st.motherName);
  if (!father && !mother) {
    return { kind: "no_match", why: `parents' names do not agree with the record (father on record: ${st.fatherName || "—"}, mother: ${st.motherName || "—"})`, candidate: st };
  }
  return { kind: "verified", student: st };
}

/* ── the conversation ────────────────────────────────────────── */

export const Q = {
  name: "1/5 — बच्चे का *पूरा नाम* लिखें।\n(Child's full name)",
  dob: "2/5 — बच्चे की *जन्म तिथि* लिखें, जैसे 05-08-2018।\n(Child's date of birth, e.g. 05-08-2018)",
  cls: "3/5 — बच्चा किस *कक्षा* में है? जैसे LKG, UKG, 3, 5।\n(Child's class)",
  father: "4/5 — बच्चे के *पिता का नाम* लिखें।\n(Father's name)",
  mother: "5/5 — बच्चे की *माता का नाम* लिखें।\n(Mother's name)",
};

const REASK: Record<"name" | "dob" | "class" | "father" | "mother", string> = {
  name: "कृपया केवल बच्चे का नाम लिखें। (Please write only the child's name.)",
  dob: "जन्म तिथि इस तरह लिखें: दिन-महीना-साल, जैसे 05-08-2018। (Date of birth as DD-MM-YYYY.)",
  class: "कृपया कक्षा लिखें, जैसे Nursery, LKG, UKG, 1, 2 … 10। (Please write the class.)",
  father: "कृपया केवल पिता का नाम लिखें। (Please write only the father's name.)",
  mother: "कृपया केवल माता का नाम लिखें। (Please write only the mother's name.)",
};

export const REPLY = {
  declined: "ठीक है, धन्यवाद। यह नंबर नहीं जोड़ा जाएगा। अगर यह गलती से हुआ हो, तो स्कूल कार्यालय से संपर्क करें।\n(Okay — this number will not be added.)",
  retry:
    "दी गई जानकारी स्कूल के रिकॉर्ड से मेल नहीं खाई। कृपया एक बार फिर ध्यान से लिखें — वही जानकारी जो स्कूल में भरी गई थी।\n(The details did not match the school's records. Please try once more.)",
  office:
    "धन्यवाद 🙏 आपकी जानकारी स्कूल कार्यालय को भेज दी गई है। जाँच के बाद आपको इसी नंबर पर संदेश मिलेगा।\n(Thank you — the office will check and message you here.)",
};

/** Two unreadable replies in a row at one question → the office takes over. */
const MAX_REASKS = 2;

export type StepResult = {
  session: WaVerifySession;
  /** Text to send back now (always set while the conversation continues). */
  reply: string;
  /** "verify": all five answers are in — the server checks them. "office": hand over with `officeNote`. */
  action: "none" | "verify" | "office";
  officeNote?: string;
};

/** One inbound message → the next question (pure; the server does the checking and linking). */
export function advance(session: WaVerifySession, text: string, nowIso: string): StepResult {
  const t = String(text ?? "").trim();
  const base = { ...session, updatedAt: nowIso };
  const reask = (step: keyof typeof REASK): StepResult => {
    const reasks = session.reasks + 1;
    if (reasks > MAX_REASKS) {
      return {
        session: { ...base, step: "office", reasks, result: `sent to office: could not read the answer to the ${step} question ("${t.slice(0, 80)}")` },
        reply: REPLY.office,
        action: "office",
        officeNote: `Could not read the answer to "${step}" after ${MAX_REASKS} tries. Last reply: "${t.slice(0, 120)}".`,
      };
    }
    return { session: { ...base, reasks }, reply: REASK[step], action: "none" };
  };
  const next = (patch: Partial<WaVerifySession>, reply: string): StepResult => ({
    session: { ...base, reasks: 0, ...patch },
    reply,
    action: "none",
  });

  switch (session.step) {
    case "invited":
      if (isNo(t)) return { session: { ...base, step: "declined", result: "said it was not them" }, reply: REPLY.declined, action: "none" };
      // Anything else — "हाँ", the button, or straight into a name — starts the questions.
      if (!isYes(t) && looksLikeName(t)) {
        return next({ step: "dob", answers: { ...session.answers, childName: t } }, Q.dob);
      }
      return next({ step: "name" }, `धन्यवाद 🙏 पाँच छोटे सवाल हैं।\n(Five short questions.)\n\n${Q.name}`);
    case "name":
      return looksLikeName(t) ? next({ step: "dob", answers: { ...session.answers, childName: t } }, Q.dob) : reask("name");
    case "dob": {
      const dob = parseDob(t);
      return dob ? next({ step: "class", answers: { ...session.answers, dob } }, Q.cls) : reask("dob");
    }
    case "class": {
      const className = parseClassName(t);
      return className ? next({ step: "father", answers: { ...session.answers, className } }, Q.father) : reask("class");
    }
    case "father":
      return looksLikeName(t) ? next({ step: "mother", answers: { ...session.answers, fatherName: t } }, Q.mother) : reask("father");
    case "mother":
      if (!looksLikeName(t)) return reask("mother");
      return { session: { ...base, reasks: 0, answers: { ...session.answers, motherName: t } }, reply: "", action: "verify" };
    default:
      return { session, reply: "", action: "none" };
  }
}

/** After the server's check failed: one more round, then the office. */
export function afterFailedCheck(session: WaVerifySession, why: string, nowIso: string): StepResult {
  if (session.rounds < 1) {
    return {
      session: { ...session, step: "name", rounds: session.rounds + 1, reasks: 0, answers: emptyAnswers(), updatedAt: nowIso },
      reply: `${REPLY.retry}\n\n${Q.name}`,
      action: "none",
    };
  }
  return {
    session: { ...session, step: "office", updatedAt: nowIso, result: `sent to office: ${why}` },
    reply: REPLY.office,
    action: "office",
    officeNote: `WhatsApp check did not match twice: ${why}.`,
  };
}

export function answersSummary(a: WaVerifyAnswers): string {
  return [
    `child: ${a.childName || "—"}`,
    `DOB: ${a.dob || "—"}`,
    `class: ${a.className || "—"}`,
    `father: ${a.fatherName || "—"}`,
    `mother: ${a.motherName || "—"}`,
  ].join(" · ");
}

export function linkedReply(childFirstName: string, appUrl: string): string {
  return (
    `✅ धन्यवाद! आपका नंबर ${childFirstName ? `*${childFirstName}* के` : "बच्चे के"} रिकॉर्ड से जोड़ दिया गया है।\n` +
    `अब आप इसी नंबर से स्कूल के पैरेंट ऐप में लॉग-इन कर सकते हैं: ${appUrl}\n\n` +
    `(Your number is now linked — you can log in to the parent app with it.)`
  );
}
