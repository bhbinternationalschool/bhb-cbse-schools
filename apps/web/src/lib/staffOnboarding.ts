/**
 * How staff are walked through their day on the school WhatsApp — pure.
 *
 * Written after 29 Sep 2026, the first day staff used the bot, at the
 * director's request:
 *
 *   - the first message of each working morning asks them to mark their own
 *     attendance first (a location pin), and then answers what they asked;
 *   - after the punch, it shows what they teach — class teacher of which
 *     section, subject teacher of which, separately — and exactly what to
 *     type for each job, step by step;
 *   - someone in the middle of a job (a punch waiting for its pin, a register
 *     waiting for its absentees, a draft waiting for YES) who asks something
 *     else is told to finish first, and the question is answered after;
 *   - a teacher who is also a parent is told they have two roles, and how
 *     to switch between them at any time;
 *   - staff can send a suggestion, a requirement or a complaint to the
 *     director;
 *   - a staff member writing from a number not on their record can find
 *     their record, and ask for the number to be added to it.
 *
 * Everything here is text in, text or data out. The server wiring is in
 * waUnifiedBotServer.ts.
 */

import type { MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";

/* ── The class-channel posts ─────────────────────────────────────────── */

/**
 * "HW 6A Maths: …", "CW …", "Notice 8A: …" — a teacher's post for the class
 * channel. 29 Sep 2026: the teacher menu's own example, "HW 8A Maths: …",
 * was read by the command desk as a FEE lookup ("due" reads as dues) and
 * answered "I couldn't find an active student". A post with one of these in
 * front is the class channel's, and the desk steps aside for it.
 */
export const CLASS_POST_PREFIX =
  /^\s*(hw|h\.w\.?|homework|home\s*work|cw|c\.w\.?|classwork|class\s*work|diary|notice|circular|announcement)(?![\p{L}\p{M}\p{N}])/iu;

export function isClassChannelPostPrefix(text: string): boolean {
  return CLASS_POST_PREFIX.test(text || "");
}

/* ── Morning: your own attendance first ──────────────────────────────── */

/** Earliest and latest IST hour the morning question is asked in. */
export const MORNING_ASK_FROM_HOUR = 5;
export const MORNING_ASK_UNTIL_HOUR = 15;

/**
 * Should this message be answered with "mark your attendance first"?
 *
 * Once a day, on a working day, during school hours, to a teacher or office
 * staff member (not the director) who has not punched in. Everything else
 * about it — what they asked — is answered after the punch.
 */
export function shouldAskMorningAttendance(opts: {
  flow: string;
  todayIso: string;
  istHour: number;
  lastAskedOn: string;
  punchedIn: boolean;
  workingDay: boolean;
}): boolean {
  if (opts.flow !== "teacher" && opts.flow !== "staff") return false;
  if (!opts.workingDay || opts.punchedIn) return false;
  if (opts.lastAskedOn === opts.todayIso) return false;
  return opts.istHour >= MORNING_ASK_FROM_HOUR && opts.istHour < MORNING_ASK_UNTIL_HOUR;
}

/** "SKIP", "later", "on leave", "baad me" — not marking it here today. */
export function parseSkipOwnAttendance(text: string): boolean {
  const t = (text || "").trim().toLowerCase().replace(/[.!।]+$/u, "");
  return /^(skip|later|baad\s*me(in)?|bad\s*me|on\s+leave|leave\s+today|chutti\s+(par|pe)|already\s+(marked|done|punched)|marked\s+at\s+(gate|biometric)|biometric|not\s+now|abhi\s+nahi|छोड़ें|बाद\s*में)$/iu.test(t);
}

export function composeMorningAttendanceAsk(opts: { firstName: string; deferredText?: string; hindi?: boolean }): string {
  const q = (opts.deferredText || "").replace(/\s+/g, " ").trim();
  const echo = q && q.length <= 80 ? q : q ? `${q.slice(0, 77)}…` : "";
  if (opts.hindi) {
    return [
      `सुप्रभात ${opts.firstName} 🙏`,
      "",
      "*पहले आज की अपनी उपस्थिति लगाएँ:*",
      "1. नीचे 📎 (या +) पर टैप करें",
      "2. *Location* चुनें",
      "3. *Send your current location* पर टैप करें",
      "(*Share live location* नहीं — स्कूल में रहते हुए भेजें)",
      "",
      echo ? `उसके बाद मैं आपके सवाल का जवाब दूँगा: "${echo}"` : "उसके बाद आपकी कक्षाएँ और काम दिखाऊँगा।",
      "",
      "छुट्टी पर हैं या गेट पर लग चुकी है? *SKIP* लिखें।",
    ].join("\n");
  }
  return [
    `Good morning ${opts.firstName} 🙏`,
    "",
    "*First, mark your attendance for today:*",
    "1. Tap 📎 (or +) next to the message box",
    "2. Choose *Location*",
    "3. Tap *Send your current location*",
    "(Not *Share live location* — and send it while you are at school.)",
    "",
    echo ? `Then I'll answer what you asked: "${echo}"` : "Then I'll show your classes and what you can do today.",
    "",
    "On leave, or already marked at the gate? Reply *SKIP*.",
  ].join("\n");
}

/* ── What you teach, and what to type ────────────────────────────────── */

export type StaffWorkProfile = {
  /** Sections this person is class teacher of — "VIII A". */
  classTeacherOf: string[];
  /** Subjects taught, each with its sections — { subject: "Maths", sections: ["VI A", "VII A"] }. */
  subjects: { subject: string; sections: string[] }[];
};

function sectionLabelFor(masters: MastersState, classId: string, sectionId: string): string {
  const cls = (masters.classes ?? []).find((c) => c.id === classId);
  const sec = (masters.sections ?? []).find((s) => s.id === sectionId);
  return `${cls?.name ?? ""} ${sec?.name ?? ""}`.trim();
}

function rankOfClassName(name: string): number {
  const n = (name || "").trim().toUpperCase();
  const pre = ["PLAYGROUP", "PRE NURSERY", "PRENURSERY", "NURSERY", "LKG", "UKG"].indexOf(n.split(" ")[0] === "PRE" ? "PRE NURSERY" : n.split(" ")[0]!);
  if (pre >= 0) return pre;
  const roman: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
  const head = n.split(" ")[0]!;
  if (roman[head]) return 10 + roman[head]!;
  const num = parseInt(head.replace(/\D/g, ""), 10);
  return Number.isFinite(num) ? 10 + num : 99;
}

function sortSections(labels: string[]): string[] {
  return [...new Set(labels.filter(Boolean))].sort((a, b) => {
    const r = rankOfClassName(a) - rankOfClassName(b);
    return r || a.localeCompare(b);
  });
}

/**
 * What a staff record says this person teaches, this session. A subject link
 * with no section covers every active section of that class.
 */
export function staffWorkProfile(staff: StaffRecord, masters: MastersState, academicYearCode: string): StaffWorkProfile {
  const inYear = (code: string) => !code || code === academicYearCode;
  const classTeacherOf = sortSections(
    (staff.classTeacherLinks ?? [])
      .filter((l) => inYear(l.academicYearCode) && l.sectionId)
      .map((l) => sectionLabelFor(masters, l.classId, l.sectionId)),
  );
  const bySubject = new Map<string, string[]>();
  for (const l of staff.subjectTeachingLinks ?? []) {
    if (!inYear(l.academicYearCode)) continue;
    const subject = (masters.subjects ?? []).find((s) => s.id === l.subjectId);
    const name = subject?.nameEn || subject?.code || "Subject";
    const sections = l.sectionId
      ? [sectionLabelFor(masters, l.classId, l.sectionId)]
      : (masters.sections ?? [])
          .filter((s) => s.classId === l.classId && s.isActive !== false)
          .map((s) => sectionLabelFor(masters, l.classId, s.id));
    bySubject.set(name, [...(bySubject.get(name) ?? []), ...sections]);
  }
  const subjects = [...bySubject.entries()]
    .map(([subject, sections]) => ({ subject, sections: sortSections(sections) }))
    .filter((s) => s.sections.length)
    .sort((a, b) => a.subject.localeCompare(b.subject));
  return { classTeacherOf, subjects };
}

/** "VIII A" → "8A", the way the desk's own examples are typed. */
export function shortSection(label: string): string {
  const [cls = "", sec = ""] = (label || "").trim().split(/\s+/);
  const roman: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8", IX: "9", X: "10", XI: "11", XII: "12" };
  const c = roman[cls.toUpperCase()] ?? cls;
  return `${c}${sec}`.trim() || label;
}

export type StaffRoleNote = { kind: string; label: string; switchWord: string };

/**
 * The guide shown after the morning punch (and on "my classes"): what this
 * person teaches — class teacher and subject teacher, separately — and for
 * each, the exact words to type, step by step.
 */
export function composeStaffWorkGuide(input: {
  firstName: string;
  profile: StaffWorkProfile;
  /** Office / leadership work, for staff who are not teaching. */
  office: boolean;
  /** Every role this number holds, when it holds more than one. */
  roles?: StaffRoleNote[];
  currentKind?: string;
  punchedJustNow?: boolean;
}): string {
  const { profile } = input;
  const lines: string[] = [];
  lines.push(
    input.punchedJustNow
      ? `Here is your day, ${input.firstName}:`
      : `${input.firstName}, here is what you can do on WhatsApp:`,
  );

  if (profile.classTeacherOf.length) {
    const ct = profile.classTeacherOf[0]!;
    const s = shortSection(ct);
    lines.push(
      "",
      `👩‍🏫 *Class teacher of:* ${profile.classTeacherOf.join(", ")}`,
      `• *Take attendance* — send _Take ${s} attendance_ → I show the class by roll number → reply the absent roll numbers, e.g. _4, 11_ (or _all present_) → check → reply *YES*`,
      `• *Class list* — _${s}_`,
      `• *Who is absent* — _${s} attendance_`,
      `• *One student* — the name, e.g. _Riya Verma details_`,
      `• *Leave requests* — _leave requests_`,
      `• *Notice to ${s} parents* — _Notice ${s}: PTM on Saturday at 10 am_ → check the draft → reply *YES*`,
    );
  }

  if (profile.subjects.length) {
    const first = profile.subjects[0]!;
    const s = shortSection(first.sections[0] ?? "");
    lines.push("", "📚 *Subject teacher:*");
    for (const sub of profile.subjects) lines.push(`• ${sub.subject} — ${sub.sections.join(", ")}`);
    lines.push(
      `• *Homework* — _HW ${s} ${first.subject}: Ex 5.2 Q1-5, due tomorrow_ → check the draft → reply *YES*`,
      `• *Classwork* — _CW ${s} ${first.subject}: Ex 5.1 done in class_ → reply *YES*`,
      `• *Notice to a class* — _Notice ${s}: bring the geometry box tomorrow_ → reply *YES*`,
      "_Nothing reaches parents until you reply YES. Reply NO to drop a draft._",
    );
  }

  if (!profile.classTeacherOf.length && !profile.subjects.length) {
    if (input.office) {
      lines.push(
        "",
        "🗂️ *Office work:*",
        "• *Today's attendance* — _attendance summary_",
        "• *Fee collected today* — _collection today_",
        "• *A class's dues* — _5A defaulters_",
        "• *A student's fees* — _Riya Verma fees_",
        "• *Admissions* — _admissions this week_",
        "• *Leave requests* — _leave requests_",
      );
    } else {
      lines.push("", "No classes are linked to you yet — ask the office to add them in *Staff → Duties*.");
    }
  }

  lines.push(
    "",
    "📨 *To the Director / Principal (privately):*",
    "• _Suggestion: …_ · _Requirement: …_ · _Complaint: …_ — you choose who receives it",
    "",
    "🗓️ *Leave:* _CL tomorrow_ · _ML 2 Oct to 4 Oct fever_ · _my leave_ for your balance",
    "",
    "⏱️ *Your own attendance:* _My attendance_ · to punch, send your location (📎 → Location → Send your current location)",
    "",
    "Anytime: *help* — everything I can do · *HUMAN* — message the office",
  );

  const footer = input.roles ? composeRolesFooter(input.roles, input.currentKind || "") : "";
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

/* ── More than one role ──────────────────────────────────────────────── */

/**
 * "You have 2 roles here…", and how to move between them. Shown under help
 * and the guide for anyone whose number carries more than one role — a
 * teacher whose child studies here above all.
 */
export function composeRolesFooter(allRoles: StaffRoleNote[], currentKind: string): string {
  const roles = switchableRoles(allRoles);
  if (roles.length < 2) return "";
  const lines = [`🔁 *You have ${roles.length} roles on this number:*`];
  for (const r of roles) {
    lines.push(`• *${r.switchWord}* — ${r.label}${r.kind === currentKind ? " _(now using)_" : ""}`);
  }
  lines.push(
    "",
    `To switch, send the word on its own at any time — e.g. *${roles.find((r) => r.kind !== currentKind)?.switchWord ?? roles[0]!.switchWord}*.`,
    "Everything you then send is answered in that role until you switch back.",
  );
  return lines.join("\n");
}

const ROLE_SWITCH_WORDS: { kind: string; re: RegExp }[] = [
  { kind: "parent", re: /^(parent|parents|as\s+parent|parent\s+mode|switch\s+(to\s+)?parent|abhibhavak|अभिभावक|पेरेंट)$/i },
  { kind: "teacher", re: /^(teacher|as\s+teacher|teacher\s+mode|switch\s+(to\s+)?teacher|class\s+teacher|shikshak|शिक्षक|टीचर)$/i },
  { kind: "staff", re: /^(staff|as\s+staff|staff\s+mode|switch\s+(to\s+)?staff)$/i },
  { kind: "owner", re: /^(director|owner|as\s+director|director\s+mode|switch\s+(to\s+)?director)$/i },
  { kind: "transport", re: /^(driver|as\s+driver|driver\s+mode|switch\s+(to\s+)?driver)$/i },
  { kind: "survey", re: /^(survey|as\s+survey|survey\s+mode|switch\s+(to\s+)?survey)$/i },
];

/**
 * Roles worth switching between. An admission enquiry left on a teacher's
 * number from years ago is a record, not a role anybody works in — it is
 * left out of "you have N roles" and of switching.
 */
export function switchableRoles(roles: StaffRoleNote[]): StaffRoleNote[] {
  const seen = new Set<string>();
  return roles.filter((r) => r.kind !== "admission_lead" && r.kind !== "admission" && !seen.has(r.kind) && seen.add(r.kind));
}

/**
 * A role switch: the role's word on its own ("PARENT", "teacher", "switch to
 * parent", or exactly the word the roles list shows), for a number that
 * holds that role and is not already in it. Null otherwise — so for a staff
 * member with one role, "STAFF" is still the staff snapshot.
 */
export function parseRoleSwitch(text: string, roles: StaffRoleNote[], currentKind: string): string | null {
  const t = (text || "").trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  const held = switchableRoles(roles);
  if (!t || held.length < 2) return null;
  const upper = t.toUpperCase();
  for (const r of held) {
    if (r.kind === currentKind) continue;
    if (upper === r.switchWord.toUpperCase()) return r.kind;
    const w = ROLE_SWITCH_WORDS.find((x) => x.kind === r.kind);
    if (w?.re.test(t)) return r.kind;
  }
  return null;
}

/** "ROLE", "my roles", "switch" — show the roles and how to switch. */
export function isRolesAsk(text: string): boolean {
  return /^(role|roles|my\s+roles?|switch|switch\s+role|change\s+role|profile|profiles)$/i.test((text || "").trim().replace(/[.!?]+$/, ""));
}

/* ── Finish what is open first ───────────────────────────────────────── */

export type OpenWork = {
  kind:
    | "punch"
    | "morning_attendance"
    | "confirm_card"
    | "register"
    | "class_draft"
    | "feedback_recipient"
    | "leave_application";
  /** What is open, in a few words: "your punch IN — waiting for your location". */
  what: string;
  /** How to finish it: "send your location (📎 → Location → Send your current location)". */
  how: string;
};

export const DEFERRED_MAX = 3;

/**
 * Said when someone in the middle of a job asks something else. Their
 * question is kept and answered as soon as the job is finished or dropped.
 */
export function composeOpenWorkReminder(work: OpenWork, deferredText: string): string {
  const q = (deferredText || "").replace(/\s+/g, " ").trim();
  const echo = q.length > 80 ? `${q.slice(0, 77)}…` : q;
  return [
    `⏳ First, let's finish what is open: *${work.what}*.`,
    "",
    `To finish: ${work.how}`,
    "To drop it instead: reply *CANCEL*.",
    "",
    echo ? `Then I'll answer: "${echo}"` : "",
  ]
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join("\n")
    .trim();
}

/** "CANCEL", "stop", "chhodo" — drop whatever job is open. */
export function isCancelOpenWork(text: string): boolean {
  return /^(cancel|stop|drop|chhodo|chodo|rehne\s+do|रद्द|छोड़ो)$/i.test((text || "").trim().replace(/[.!]+$/, ""));
}

/* ── To the director ─────────────────────────────────────────────────── */

export type StaffFeedback = { kind: "suggestion" | "requirement" | "complaint"; body: string };

const FEEDBACK_RE =
  /^\s*(suggestion|suggest|sujhav|sujhaav|सुझाव|requirement|require|need|requirment|jarurat|zarurat|jaroorat|zaroorat|zarurat\s+hai|आवश्यकता|जरूरत|ज़रूरत|complaint|complain|shikayat|shikaayat|शिकायत)\s*(?:to\s+(?:the\s+)?(?:director|owner|principal))?\s*[:：\-–—]\s*([\s\S]{3,})$/iu;

/**
 * "Suggestion: …", "Requirement: …", "Complaint: …" (and the Hindi words),
 * with a colon — the colon is what makes it a message for the director and
 * not a sentence that merely starts with "need".
 */
export function parseStaffFeedback(text: string): StaffFeedback | null {
  const m = FEEDBACK_RE.exec(text || "");
  if (!m) return null;
  const word = m[1]!.toLowerCase();
  const body = m[2]!.trim();
  if (body.length < 3) return null;
  const kind: StaffFeedback["kind"] = /sugg|sujh|सुझाव/.test(word)
    ? "suggestion"
    : /compl|shik|शिकायत/.test(word)
      ? "complaint"
      : "requirement";
  return { kind, body };
}

export type FeedbackRecipient = "director" | "principal" | "both";

/**
 * Who a staff member's suggestion, requirement or complaint goes to. Asked
 * every time, because some of it is about the principal — and a complaint
 * about the principal must reach the director without the principal ever
 * seeing it. Director's brief, 29 Sep 2026.
 */
export function composeFeedbackRecipientAsk(kind: StaffFeedback["kind"]): string {
  return [
    `Who should receive your ${kind}?`,
    "",
    "*1* — Director only",
    "*2* — Principal only",
    "*3* — Both",
    "",
    "_It goes only to the person you choose — nobody else sees it._",
    "Reply 1, 2 or 3 · *CANCEL* to drop it.",
  ].join("\n");
}

export function parseFeedbackRecipient(text: string): FeedbackRecipient | null {
  const t = (text || "").trim().toLowerCase().replace(/[.!]+$/, "");
  if (/^(1|director|director only|owner|d)$/.test(t)) return "director";
  if (/^(2|principal|principal only|p)$/.test(t)) return "principal";
  if (/^(3|both|dono|all|director and principal|principal and director)$/.test(t)) return "both";
  return null;
}

export function composeStaffFeedbackAck(kind: StaffFeedback["kind"], to: FeedbackRecipient, delivered: boolean): string {
  const who = to === "director" ? "the Director" : to === "principal" ? "the Principal" : "the Director and the Principal";
  return delivered
    ? `✅ Your ${kind} has been sent to ${who} only.`
    : `Your ${kind} could not be delivered to ${who} just now. Please try again in a while, or speak to them directly.`;
}

/** What the office inbox shows instead of a private message's words. */
export const PRIVATE_FEEDBACK_LOG_TEXT = "[private message for the Director / Principal — not shown]";

/* ── A number that is not on the staff record ────────────────────────── */

/** "••••6519" — enough to recognise your own number, not enough to use it. */
export function maskMobile10(m: string): string {
  const d = (m || "").replace(/\D/g, "");
  return d.length >= 4 ? `••••${d.slice(-4)}` : "—";
}

function normName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/^(mr|mrs|ms|miss|dr|shri|smt|sri)\.?\s+/i, "")
    .replace(/[^\p{L}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The staff record someone means by "Ravindra Yadav" or "STF-007". Exact
 * employee code first; then a name every word of which is in the record's
 * name, both ways. Several matches mean ask for the code — never a guess,
 * because the next step shows that record's details.
 */
export function matchStaffForLink<T extends Pick<StaffRecord, "id" | "empCode" | "fullName" | "status">>(
  query: string,
  staff: T[],
): { match: T | null; ambiguous: number } {
  const active = staff.filter((s) => s.status === "active");
  const q = (query || "").trim();
  const codeKey = (c: string) => (c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z]+)0+(\d)/, "$1$2");
  const byCode = active.filter((s) => s.empCode && codeKey(s.empCode) === codeKey(q));
  if (byCode.length === 1) return { match: byCode[0]!, ambiguous: 0 };
  const want = normName(q).split(" ").filter((w) => w.length >= 2);
  if (want.length < 2) return { match: null, ambiguous: 0 };
  const hits = active.filter((s) => {
    const have = normName(s.fullName).split(" ");
    return want.every((w) => have.includes(w)) && have.filter((w) => w.length >= 2).every((w) => want.includes(w));
  });
  if (hits.length === 1) return { match: hits[0]!, ambiguous: 0 };
  return { match: null, ambiguous: hits.length };
}

export function composeStaffLinkIntro(): string {
  return [
    "This number is not on the school's staff record, so staff features (class lists, attendance, homework) cannot open on it yet.",
    "",
    "*If you work at the school*, reply with your *full name* as on the staff record, or your *employee code* (e.g. STF-007). I'll find your record so this number can be added to it.",
    "",
    "यह नंबर स्टाफ रिकॉर्ड में नहीं है। अगर आप स्कूल स्टाफ हैं, तो अपना *पूरा नाम* या *कर्मचारी कोड* (जैसे STF-007) भेजें।",
  ].join("\n");
}

export function composeStaffLinkFound(opts: {
  fullName: string;
  empCode: string;
  designation: string;
  registeredMobile: string;
  thisMobile: string;
}): string {
  return [
    "I found this staff record:",
    "",
    `👤 *${opts.fullName}*`,
    `🆔 ${opts.empCode || "—"}${opts.designation ? ` · ${opts.designation}` : ""}`,
    `📱 Registered mobile: ${maskMobile10(opts.registeredMobile)}`,
    "",
    `Is this you, and do you want *this number (${opts.thisMobile})* added to your record as well?`,
    "",
    "Reply *YES* to add it, or *NO* if this is not you.",
  ].join("\n");
}

export function composeStaffLinkRequested(code: string): string {
  return [
    "✅ Request sent. For everyone's safety a number is added to a staff record only after the director or principal approves it.",
    "",
    `Your request number is *${code}*. You'll get a message here as soon as it is approved — then send *hi* and your staff menu will open.`,
  ].join("\n");
}

/** "LINK OK 4821", "link yes 4821", "LINK NO 4821" — from the director or the office. */
export function parseStaffLinkDecision(text: string): { approve: boolean; code: string } | null {
  const m = /^\s*link\s+(ok|yes|approve|approved|no|reject|rejected|deny)\s*#?\s*(\d{4})\s*$/i.exec(text || "");
  if (!m) return null;
  return { approve: /^(ok|yes|approve|approved)$/i.test(m[1]!), code: m[2]! };
}

export function makeStaffLinkCode(random: () => number = Math.random): string {
  return String(1000 + Math.floor(random() * 9000));
}
