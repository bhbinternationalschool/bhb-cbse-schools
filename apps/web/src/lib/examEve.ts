/**
 * "कल का पेपर" — the evening before each exam day, one message per family.
 *
 * WHY (2026-09-16): the half-yearly exam runs 16–26 Sep, and parents could
 * not see the date sheet anywhere — not in the app, not on WhatsApp. At the
 * same time the AI tutor sat unused. The night before a paper is the one
 * moment a parent is guaranteed to want help, so this message does three
 * things with one button:
 *
 *   1. tells the family which paper each child sits tomorrow;
 *   2. a tap is an INBOUND message, which is the only thing that opens
 *      Meta's 24-hour window — the school cannot open it by sending;
 *   3. the tap starts the tutor on exactly tomorrow's subject, at the child's
 *      class, with a free first day of the full tutor (the owner's decision)
 *      so the habit forms when it matters most.
 *
 * THE TEMPLATE CARRIES NO OFFER. Meta reclassifies a template containing a
 * sales pitch as MARKETING, which costs more and is blocked more. So the
 * template is a pure exam reminder (UTILITY); anything about a pass appears
 * only inside the conversation, after the parent has chosen to tap.
 *
 * Nursery, LKG and UKG get tips for the parent instead of the tutor: a
 * four-year-old revising rhymes needs a parent beside them, not a chatbot.
 *
 * Every template value here is ONE line — Meta refuses a parameter with a
 * newline, a tab or four consecutive spaces.
 */

import { nameSoundKey } from "@/lib/nameSound";

export const PRACTICE_BUTTON_EN = "Start practice";
export const PRACTICE_BUTTON_HI = "अभ्यास शुरू करें";

export type EveSlot = {
  date: string;
  classId: string;
  subjectId: string;
  note: string;
  startTime: string;
};

export type EveChild = {
  studentId: string;
  name: string;
  classId: string;
  className: string;
};

export type EveFamily = {
  householdId: string;
  guardianName: string;
  mobile: string;
  hindi: boolean;
  children: EveChild[];
};

const PRE_PRIMARY = new Set(["NURSERY", "LKG", "UKG", "PRE-NURSERY", "PLAYGROUP"]);

export function isPrePrimary(className: string): boolean {
  return PRE_PRIMARY.has((className || "").trim().toUpperCase());
}

/** Hindi subject names — the school writes to families in Hindi by default. */
const SUBJECT_HI: Record<string, string> = {
  English: "अंग्रेज़ी",
  Hindi: "हिंदी",
  Mathematics: "गणित",
  Maths: "गणित",
  Science: "विज्ञान",
  "Social Science": "सामाजिक विज्ञान",
  Computer: "कंप्यूटर",
  Sanskrit: "संस्कृत",
  "Art Education": "चित्रकला",
  "General Knowledge": "सामान्य ज्ञान",
  "Artificial Intelligence": "कृत्रिम बुद्धिमत्ता (AI)",
  "Health & Physical Education": "शारीरिक शिक्षा",
  // Classes I–II sit EVS, not Science. Their date-sheet rows said "Science"
  // until 18 Sep 2026, and 24 Class I families were told विज्ञान the evening
  // before an EVS paper. The data was corrected; this line is why the
  // corrected row reads as Hindi rather than as nine English words in the
  // middle of a Hindi message.
  "Environmental Studies / World Around Us": "पर्यावरण अध्ययन",
  "Environmental Studies": "पर्यावरण अध्ययन",
  "World Around Us": "पर्यावरण अध्ययन",
};

/** The printed paper names, in Hindi, for the ones that are not one subject. */
const NOTE_HI: Record<string, string> = {
  "English — Oral & Written": "अंग्रेज़ी — मौखिक व लिखित",
  "Hindi — Oral & Written": "हिंदी — मौखिक व लिखित",
  "Maths — Oral & Written": "गणित — मौखिक व लिखित",
  "English Rhymes": "अंग्रेज़ी कविताएँ",
  "Hindi Rhymes": "हिंदी कविताएँ",
  "G.K. — Oral": "सामान्य ज्ञान — मौखिक",
  "G.K. / Computer Practical": "सामान्य ज्ञान / कंप्यूटर प्रैक्टिकल",
  "A.I. Theory / Practical": "AI थ्योरी / प्रैक्टिकल",
  "Drawing & A.I. Theory / Practical": "चित्रकला व AI थ्योरी / प्रैक्टिकल",
  Drawing: "चित्रकला",
  "Physical Education": "शारीरिक शिक्षा",
};

/**
 * What the paper is called on the printed timetable, in the family's
 * language. The note wins because it IS the printed name ("English Rhymes"
 * is not "English").
 */
export function paperLabel(slot: EveSlot, subjectName: string, hindi: boolean): string {
  const note = (slot.note || "").trim();
  if (note) return hindi ? NOTE_HI[note] ?? note : note;
  return hindi ? SUBJECT_HI[subjectName] ?? subjectName : subjectName;
}

/** The next date AFTER `todayIso` that has any paper at all. */
export function nextExamDate(slots: EveSlot[], todayIso: string): string | null {
  const dates = [...new Set(slots.map((s) => s.date))].filter((d) => d > todayIso).sort();
  return dates[0] ?? null;
}

/**
 * The first date a "still to come" list may show.
 *
 * WHY (22 Sep 2026): a father wrote "Time table" at 19:37 IST and was shown
 *
 *   📅 *अर्धवार्षिक परीक्षा — बचे हुए पेपर*
 *   मंगलवार, 22 सितंबर — गणित
 *   बुधवार, 23 सितंबर — कंप्यूटर
 *
 * The Maths paper had been written that morning, 8:30 to 11:30. Listing a
 * finished paper under "papers still to come" is how a family ends up
 * revising the wrong subject the night before.
 *
 * Papers start at 8:30, so today counts as still to come until 9 — a parent
 * asking at 7 am means today's paper, one asking at 7 pm does not. This is
 * the same rule the practice tap already used inline; both now share it.
 */
export function papersFromDate(todayIso: string, istHour: number): string {
  return istHour < 9 ? todayIso : tomorrowIso(todayIso);
}

/** The day after `todayIso`, as YYYY-MM-DD. */
export function tomorrowIso(todayIso: string): string {
  const d = new Date(`${todayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const DAYS_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "शुक्रवार, 18 सितंबर" / "Friday, 18 Sep". */
export function examDayLabel(dateIso: string, hindi: boolean): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = (hindi ? DAYS_HI : DAYS_EN)[d.getUTCDay()]!;
  const month = (hindi ? MONTHS_HI : MONTHS_EN)[d.getUTCMonth()]!;
  return `${day}, ${d.getUTCDate()} ${month}`;
}

function oneLine(parts: string[], join: string): string {
  return parts
    .filter((p) => p && p.trim())
    .join(join)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\t/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
}

export type EvePaper = {
  child: EveChild;
  slot: EveSlot;
  label: string;
};

/** Each child's paper on `date`, in family order. Children with none are left out. */
export function familyPapersOn(
  family: EveFamily,
  slots: EveSlot[],
  subjectNames: Map<string, string>,
  date: string,
): EvePaper[] {
  const out: EvePaper[] = [];
  for (const child of family.children) {
    const slot = slots.find((s) => s.date === date && s.classId === child.classId);
    if (!slot) continue;
    out.push({
      child,
      slot,
      label: paperLabel(slot, subjectNames.get(slot.subjectId) ?? "", family.hindi),
    });
  }
  return out;
}

/** How this send differs from the ordinary evening one. */
export type EveSendOptions = {
  /**
   * This family was already told something wrong for this date, so say so.
   * Without it a parent holding two messages cannot tell which is current.
   */
  correction?: boolean;
};

export type EveVariables = {
  guardianName: string;
  examDay: string;
  childPapers: string;
  /** No child of this family sits a paper that day — send nothing. */
  empty: boolean;
};

/** Template variables, all single-line. */
export function examEveVariables(
  family: EveFamily,
  slots: EveSlot[],
  subjectNames: Map<string, string>,
  date: string,
  opts: EveSendOptions = {},
): EveVariables {
  const papers = familyPapersOn(family, slots, subjectNames, date);
  const childPapers = oneLine(
    [
      // A family that has already been told the wrong paper must be able to
      // see which of the two messages to believe. The template's own words
      // are fixed and approved, so the correction has to live in a variable.
      opts.correction ? (family.hindi ? "सुधार —" : "Correction —") : "",
      ...papers.map((p) => `${p.child.name} (${p.child.className}) — ${p.label}`),
    ],
    "  |  ",
  );
  return {
    guardianName:
      (family.guardianName || "").trim() || (family.hindi ? "अभिभावक" : "Parent"),
    examDay: examDayLabel(date, family.hindi),
    childPapers,
    empty: papers.length === 0,
  };
}

/** The same, as free text for a family already inside the 24-hour window. */
export function examEveFreeText(
  family: EveFamily,
  slots: EveSlot[],
  subjectNames: Map<string, string>,
  date: string,
  opts: EveSendOptions = {},
): string {
  const papers = familyPapersOn(family, slots, subjectNames, date);
  if (papers.length === 0) return "";
  const hindi = family.hindi;
  const day = examDayLabel(date, hindi);
  const anySchoolAge = papers.some((p) => !isPrePrimary(p.child.className));
  return [
    opts.correction
      ? hindi
        ? "⚠️ *सुधार* — पहले भेजे गए संदेश में विषय गलत था। सही जानकारी:"
        : "⚠️ *Correction* — the earlier message named the wrong paper. The right one:"
      : "",
    hindi ? `📝 *कल के पेपर* · ${day}, सुबह 8:30 बजे` : `📝 *Tomorrow's papers* · ${day}, 8:30 AM`,
    "",
    ...papers.map((p) => `• ${p.child.name} (${p.child.className}) — *${p.label}*`),
    "",
    anySchoolAge
      ? hindi
        ? `आज रात 20 मिनट का अभ्यास बहुत मदद करेगा — *${PRACTICE_BUTTON_HI}* लिखें।`
        : `Twenty minutes of practice tonight helps — reply *${PRACTICE_BUTTON_EN}*.`
      : hindi
        ? `बच्चे के साथ थोड़ा अभ्यास करने के सुझाव चाहिए? *${PRACTICE_BUTTON_HI}* लिखें।`
        : `Want a few ideas to practise together? Reply *${PRACTICE_BUTTON_EN}*.`,
    hindi ? "पूरी समय-सारणी के लिए *TIMETABLE* लिखें।" : "Reply *TIMETABLE* for the full date sheet.",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n")
    .replace(/^\n+/, "");
}

/** Did the parent tap (or type) the practice button? */
/**
 * The button, or a parent typing what the button says.
 *
 * On 21 Sep 2026 five families typed it instead of tapping — "Abhyas shuru
 * Karen", "Abhyas suru kre", "करो शुरू", "SST ka rivision kare" — and every
 * one was told "इसकी जानकारी मेरे पास नहीं है" and handed to the office. A
 * start word is required alongside the practice word, so "practice karwao
 * maths ka" (a request to the tutor) still goes to the tutor.
 */
export function isPracticeTap(text: string): boolean {
  const t = (text || "").trim().toLowerCase().replace(/[.!।?]+$/g, "").trim();
  if (
    t === PRACTICE_BUTTON_EN.toLowerCase() ||
    t === PRACTICE_BUTTON_HI ||
    t === "practice" ||
    t === "abhyas" ||
    t === "अभ्यास"
  ) {
    return true;
  }
  if (t.split(/\s+/).length > 7) return false;
  if (/karwao|karvao|krwao|करवाओ|करवाइए|करवा दो/.test(t)) return false;
  if (/^(?:karo|kro|करो)\s+(?:shuru|suru|शुरू)$|^(?:shuru|suru|शुरू)\s+(?:karo|kro|kare|karen|करो|करें)$|^start$/.test(t)) return true;
  const practiceWord = /abh?yaa?s|practi[cs]e|re?vi[sz]ion|rivi[sz]ion|revise|अभ्यास|रिवीजन|रिविजन|रिवीज़न|तैयारी|taiyy?ari/.test(t);
  const startWord = /shuru|suru|start|\bkare\b|\bkaren\b|\bkarein\b|\bkre\b|\bkrein\b|\bkaro\b|\bkro\b|करें|करे\b|करो|शुरू/.test(t);
  return practiceWord && startWord;
}

/** Is the parent asking for the date sheet? */
export function isTimetableRequest(text: string): boolean {
  const raw = (text || "").trim();
  const t = raw.toLowerCase();
  if (!t) return false;
  // A question about results, marks, fees or an admit card is not a
  // question about WHEN — those have their own answers.
  if (/\b(result|marks?|number|fee|fees|admit|roll)\b|रिजल्ट|परिणाम|अंक|फीस|प्रवेश ?पत्र/.test(raw.toLowerCase())) return false;
  return (
    /^(time ?table|date ?sheet|timetable|datesheet)$/.test(t) ||
    /\b(exam|exams|paper|papers|pariksha|test)\b.*\b(time ?table|date ?sheet|schedule|kab|date|dates|when)\b/.test(t) ||
    /\b(time ?table|date ?sheet)\b/.test(t) ||
    // "Next exam" (21 Sep 2026: a parent wrote exactly that and was handed
    // to the office), "agla paper", "kal ka paper", "when is the exam".
    /\b(next|upcoming|agla|agle|agli|kal|tomorrow|aaj|today)\b.{0,20}\b(exam|exams|paper|papers|pariksha)\b/.test(t) ||
    /\b(when|kab)\b.{0,20}\b(exam|exams|paper|papers|pariksha)\b/.test(t) ||
    /^(exam|exams|paper|pariksha)\s*\??$/.test(t) ||
    /समय.?सारणी|टाइम ?टेबल|डेट ?शीट|परीक्षा.*(कब|कार्यक्रम)|पेपर कब|(अगला|अगली|अगले|कल|आज).{0,15}(पेपर|परीक्षा|एग्जाम)|कौन ?सा पेपर/.test(raw) ||
    // HALF IN EACH SCRIPT (22 Sep 2026). A father wrote "यार आज क्या मेरा
    // SST का paper कल है" and then "कल मेरा SST का paper है". Both branches
    // above missed it: the Latin one wants "kal", the Devanagari one wants
    // "पेपर", and he had typed one of each — the phone's keyboard switches
    // mid-sentence, the words do not. He was mid-drill, so the chapter
    // question answered him instead: "यह समझ नहीं आया" three times running.
    // The day word may come before the paper word or after it.
    /(?:अगला|अगली|अगले|कल|आज|कब)[\s\S]{0,25}\b(?:paper|papers|exam|exams|pariksha|test)\b/i.test(raw) ||
    /\b(?:paper|papers|exam|exams|pariksha|test)\b[\s\S]{0,25}(?:कब|कल|आज)/i.test(raw) ||
    // WHICH SUBJECT tomorrow (23 Sep 2026). MR. GHANSHYAM MAURYA, mid-way
    // through RUDRA's Maths practice, asked "कल अभिषेक मौर्य का कौन सा विषय
    // है" — which subject does his other son have tomorrow. No paper word,
    // so nothing above saw it; the drill's tutor answered instead and told
    // him to ask the office for a date sheet this bot holds.
    /(?:अगला|अगली|अगले|कल|आज)[\s\S]{0,40}(?:कौन|कोन)\s?(?:सा|से|सी)\s?(?:विषय|सब्जेक्ट|पेपर)/.test(raw) ||
    /\b(?:kal|aaj|agla|agle|tomorrow|today)\b.{0,40}\b(?:kaun ?sa|kon ?sa|konsa|which)\s+(?:subject|vishay|paper)\b/.test(t)
  );
}

/* ── which child a message is about ──────────────────────────────── */

/**
 * Words that can sit around a child's name without changing what is asked:
 * "Jayash ka", "अब जयश", "for Jayash".
 */
const NAME_FILLER = new Set(
  [
    "ab", "ka", "ke", "ki", "ko", "liye", "bhi", "ji", "for", "now", "and", "also",
    "अब", "का", "के", "की", "को", "लिए", "भी", "जी",
  ].map((w) => w.toLowerCase()),
);

export type ChildNamed = {
  studentId: string;
  /**
   * The message is ONLY the name (and filler). On its own that is not a
   * request for anything — "KRIYANSH YADAV" typed after KIDS is the parent
   * picking a child to ask about — so the caller decides whether the context
   * makes it one.
   */
  bare: boolean;
};

/**
 * "PRACTICE JAYASH", "Jayash ka abhyas shuru karein", or just "Jayash" —
 * which of these children does the parent want to practise?
 *
 * WHY (23 Sep 2026, 21:27 IST): MR. VIKAL KUMAR GUPTA has two children
 * sitting papers, SHREYASH (I) and JAYASH (IV). The practice button only
 * ever opened the first child's drill. When Shreyash was done his father
 * typed one word — "Jayash" — and the drill, still waiting on Shreyash,
 * took it as an answer and sent a lesson on joysticks.
 *
 * Matched on the first name by how it sounds (nameSoundKey), so "जयश" and
 * "Jayas" find JAYASH. Nothing is returned when two children share a first
 * name — the parent is asked by the ordinary flow rather than guessed for.
 */
export function childNamedForPractice(
  text: string,
  children: { studentId: string; name: string }[],
): ChildNamed | null {
  const raw = String(text || "").trim();
  if (!raw || children.length === 0) return null;
  const words = raw.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  if (words.length === 0 || words.length > 8) return null;

  const firstKeys = new Map<string, string[]>();
  for (const c of children) {
    const first = (c.name || "").trim().split(/\s+/)[0] ?? "";
    const key = nameSoundKey(first);
    // Two letters is an initial, not a name.
    if (key.length < 3) continue;
    firstKeys.set(key, [...(firstKeys.get(key) ?? []), c.studentId]);
  }

  let hit: { studentId: string; child: { name: string } } | null = null;
  for (const w of words) {
    const ids = firstKeys.get(nameSoundKey(w));
    if (!ids) continue;
    if (ids.length > 1) return null;
    const child = children.find((c) => c.studentId === ids[0])!;
    if (hit && hit.studentId !== child.studentId) return null; // two children named
    hit = { studentId: child.studentId, child };
  }
  if (!hit) return null;

  // What is left once the child's own name words are taken out.
  const nameKeys = new Set(hit.child.name.split(/\s+/).map(nameSoundKey).filter(Boolean));
  const rest = words.filter((w) => !nameKeys.has(nameSoundKey(w)));
  const restText = rest.join(" ");
  if (rest.every((w) => NAME_FILLER.has(w.toLowerCase()))) {
    return { studentId: hit.studentId, bare: true };
  }
  if (isPracticeTap(restText)) return { studentId: hit.studentId, bare: false };
  return null;
}

/**
 * Every remaining paper for each child, from `fromIso` on.
 *
 * Free text, so it is only ever sent inside an open window — it is the
 * answer to a parent who just wrote TIMETABLE.
 */
export function timetableReply(
  family: EveFamily,
  slots: EveSlot[],
  subjectNames: Map<string, string>,
  fromIso: string,
): string {
  const hindi = family.hindi;
  const blocks: string[] = [];
  for (const child of family.children) {
    const mine = slots
      .filter((s) => s.classId === child.classId && s.date >= fromIso)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (mine.length === 0) continue;
    blocks.push(
      [
        `*${child.name} (${child.className})*`,
        ...mine.map(
          (s) =>
            `${examDayLabel(s.date, hindi)} — ${paperLabel(s, subjectNames.get(s.subjectId) ?? "", hindi)}`,
        ),
      ].join("\n"),
    );
  }
  if (blocks.length === 0) {
    return hindi
      ? "इस परीक्षा के सभी पेपर हो चुके हैं। शुभकामनाएँ! 🙏"
      : "All papers of this exam are done. Well done! 🙏";
  }
  return [
    hindi ? "📅 *अर्धवार्षिक परीक्षा — बचे हुए पेपर*" : "📅 *Half-yearly exam — papers still to come*",
    hindi ? "सुबह 8:30 से 11:30 बजे" : "8:30 AM to 11:30 AM",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

/**
 * What the tutor is asked to do when a school-age child's family taps.
 *
 * One question at a time, easy first — a child who gets the first one right
 * keeps going; a wall of ten questions at 9 pm the night before a paper
 * closes the chat.
 */
export function practicePrompt(
  child: EveChild,
  label: string,
  hindi: boolean,
  /** The paper is TODAY, not tomorrow — see `papersFromDate`. */
  isToday: boolean,
): string {
  return hindi
    ? `${isToday ? "आज" : "कल"} कक्षा ${child.className} का ${label} का अर्धवार्षिक पेपर है। कक्षा ${child.className} के स्तर के 5 अभ्यास प्रश्न पूछिए — एक बार में एक, पहला आसान। हर उत्तर के बाद बताइए सही है या नहीं, और क्यों।`
    : `${isToday ? "Today" : "Tomorrow"} is the Class ${child.className} ${label} half-yearly paper. Ask 5 practice questions at Class ${child.className} level — one at a time, easiest first. After each answer, say whether it is right and why.`;
}

/**
 * Tips for a parent of a Nursery, LKG or UKG child — no tutor, a parent
 * beside them.
 */
export function prePrimaryTips(
  child: EveChild,
  label: string,
  hindi: boolean,
  /** The paper is TODAY, not tomorrow — see `papersFromDate`. */
  isToday: boolean,
): string {
  const lower = label.toLowerCase();
  const rhymes = /rhyme|कविता/.test(lower);
  const drawing = /drawing|चित्र/.test(lower);
  const oral = /oral|मौखिक/.test(lower);

  const tipsHi = rhymes
    ? ["दो-तीन कविताएँ हाव-भाव के साथ साथ में गाइए।", "बच्चे को पहली पंक्ति बताइए, आगे वह पूरी करे।", "गाते समय तालियाँ बजाइए — याद जल्दी होता है।"]
    : drawing
      ? ["सेब, घर, सूरज जैसी आसान आकृतियाँ साथ बनाइए।", "रेखा के अंदर रंग भरने का अभ्यास कराइए।", "गलती पर टोकिए नहीं — बनाते रहने को कहिए।"]
      : oral
        ? ["अक्षर/अंक दिखाकर बोलने को कहिए।", "रोज़ की चीज़ों के नाम पूछिए — फल, रंग, जानवर।", "सही उत्तर पर ज़रूर शाबाशी दीजिए।"]
        : ["10–15 मिनट ही अभ्यास कराइए, ज़्यादा नहीं।", "खेल-खेल में पूछिए, परीक्षा जैसा नहीं।", "समय पर सुलाइए — अच्छी नींद सबसे ज़रूरी है।"];
  const tipsEn = rhymes
    ? ["Sing two or three rhymes together, with actions.", "Say the first line and let your child finish it.", "Clap along — it helps the words stick."]
    : drawing
      ? ["Draw simple shapes together — an apple, a house, the sun.", "Practise colouring inside the lines.", "Don't correct mistakes — just keep them drawing."]
      : oral
        ? ["Show letters or numbers and ask your child to say them.", "Ask the names of everyday things — fruits, colours, animals.", "Praise every right answer."]
        : ["Keep practice to 10–15 minutes.", "Make it a game, not a test.", "An early night matters most."];

  const tips = hindi ? tipsHi : tipsEn;
  return [
    hindi
      ? `🌱 *${child.name} (${child.className})* — ${isToday ? "आज" : "कल"}: *${label}*`
      : `🌱 *${child.name} (${child.className})* — ${isToday ? "today" : "tomorrow"}: *${label}*`,
    "",
    ...tips.map((t) => `• ${t}`),
  ].join("\n");
}
