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
export function isPracticeTap(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  return (
    t === PRACTICE_BUTTON_EN.toLowerCase() ||
    t === PRACTICE_BUTTON_HI ||
    t === "practice" ||
    t === "abhyas" ||
    t === "अभ्यास"
  );
}

/** Is the parent asking for the date sheet? */
export function isTimetableRequest(text: string): boolean {
  const raw = (text || "").trim();
  const t = raw.toLowerCase();
  if (!t) return false;
  return (
    /^(time ?table|date ?sheet|timetable|datesheet)$/.test(t) ||
    /\b(exam|paper|pariksha)\b.*\b(time ?table|date ?sheet|schedule|kab)\b/.test(t) ||
    /\b(time ?table|date ?sheet)\b/.test(t) ||
    /समय.?सारणी|टाइम ?टेबल|डेट ?शीट|परीक्षा.*(कब|कार्यक्रम)|पेपर कब/.test(raw)
  );
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
export function practicePrompt(child: EveChild, label: string, hindi: boolean): string {
  return hindi
    ? `कल कक्षा ${child.className} का ${label} का अर्धवार्षिक पेपर है। कक्षा ${child.className} के स्तर के 5 अभ्यास प्रश्न पूछिए — एक बार में एक, पहला आसान। हर उत्तर के बाद बताइए सही है या नहीं, और क्यों।`
    : `Tomorrow is the Class ${child.className} ${label} half-yearly paper. Ask 5 practice questions at Class ${child.className} level — one at a time, easiest first. After each answer, say whether it is right and why.`;
}

/**
 * Tips for a parent of a Nursery, LKG or UKG child — no tutor, a parent
 * beside them.
 */
export function prePrimaryTips(child: EveChild, label: string, hindi: boolean): string {
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
      ? `🌱 *${child.name} (${child.className})* — कल: *${label}*`
      : `🌱 *${child.name} (${child.className})* — tomorrow: *${label}*`,
    "",
    ...tips.map((t) => `• ${t}`),
  ].join("\n");
}
