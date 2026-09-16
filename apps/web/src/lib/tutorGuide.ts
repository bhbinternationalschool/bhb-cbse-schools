/**
 * How to use the AI tutor — the guide a family gets the first time they
 * open it.
 *
 * WHEN (owner's decision, 2026-09-16): straight after the exam-eve message,
 * on the parent's first tap of "अभ्यास शुरू करें". That tap is the first
 * moment the guide CAN be sent: it opens Meta's 24-hour window, and free
 * text is only allowed inside that window. Sending it with the evening
 * message itself would need a second template to every family — a message
 * charge each, and a long how-to is exactly what Meta reads as marketing.
 *
 * WHY NOW, NOT LATER: the family has just started a free day of the full
 * tutor. A day nobody knows how to use builds no habit, and the habit is
 * the whole point of giving the day away.
 *
 * WHAT IT MAY CLAIM — only what exists, checked 2026-09-16:
 *  - the WhatsApp keywords, exactly as waTutorBotEngine parses them;
 *  - answers name the child's NCERT book and chapter (Classes 1–8, from the
 *    DIKSHA chapter index, PR #235);
 *  - "Watch videos" in the school app plays DIKSHA's NCERT/CBSE lessons
 *    first (PR #233) — the app, not WhatsApp, which has no video command;
 *  - the free hints per day and the passes, read from the live plan list,
 *    never hardcoded, because the school can change both.
 *
 * Plain words, short lines, family's language. A guide a parent scrolls
 * past teaches nothing.
 */

import type { TutorPlan } from "@/lib/tutorPlans";

function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

export function composeTutorGuide(opts: {
  hindi: boolean;
  /** The children whose free day just started. */
  childNames: string[];
  freeHintsPerDay: number;
  plans: TutorPlan[];
  /** More than one school-age child — say how to switch. */
  multipleChildren: boolean;
}): string {
  const names = opts.childNames.filter(Boolean).join(", ");
  const sellable = opts.plans.filter((p) => p.pricePaise > 0);
  // The live plan labels are English ("7 days"); a Hindi guide says the
  // number of days in Hindi rather than mixing the two in one line.
  const passes = sellable
    .map((p) =>
      opts.hindi
        ? `${p.days} दिन ${rupees(p.pricePaise)}`
        : `${p.label} ${rupees(p.pricePaise)}`,
    )
    .join(" · ");

  if (opts.hindi) {
    return [
      "📘 *AI शिक्षक — कैसे इस्तेमाल करें*",
      names ? `(${names} के लिए)` : null,
      "",
      "*1. सीधे सवाल लिखिए*",
      "जैसे: _भिन्न क्या होती है?_ या _प्रकाश संश्लेषण समझाइए_",
      "उत्तर में बच्चे की *NCERT किताब और पाठ का नाम* भी आएगा, ताकि वही पाठ खोलकर पढ़ सकें।",
      "",
      "*2. ये शब्द लिखकर शुरू कीजिए*",
      "• *TEACH* भिन्न — आसान भाषा में समझाना",
      "• *EXAMPLES* भिन्न — हल किए हुए उदाहरण",
      "• *PRACTICE* भिन्न — अभ्यास प्रश्न, एक-एक करके",
      "• *CHECK* — बच्चे का उत्तर जाँचना",
      "• *HOMEWORK* — होमवर्क में मदद (उत्तर नहीं, तरीका)",
      "• *EXAM* गणित — परीक्षा की तैयारी",
      "• *HINT* — सिर्फ़ एक इशारा, पूरा उत्तर नहीं",
      "",
      opts.multipleChildren ? "*3. दूसरे बच्चे के लिए* — *TUTOR* लिखिए, सूची से बच्चे का नंबर चुनिए (जैसे *TUTOR 2*)" : null,
      opts.multipleChildren ? "" : null,
      `*${opts.multipleChildren ? "4" : "3"}. वीडियो* — विद्यालय ऐप में AI शिक्षक → हर उत्तर के नीचे *वीडियो देखें*। NCERT/CBSE (DIKSHA) के सरकारी पाठ पहले आते हैं, हिंदी या अंग्रेज़ी में।`,
      "",
      "*अच्छे तरीके*",
      "• उत्तर बच्चे को ख़ुद लिखने दीजिए — तभी याद रहता है।",
      "• परीक्षा से पहले की शाम 20 मिनट काफ़ी हैं।",
      "• जो पाठ कठिन लगे, *TEACH* से शुरू कीजिए, फिर *PRACTICE*।",
      "",
      "*मुफ़्त दिन के बाद*",
      `• *HINT* हमेशा मुफ़्त — हर दिन ${opts.freeHintsPerDay} इशारे।`,
      passes ? `• पूरा AI शिक्षक: ${passes} — *PASS* लिखिए।` : null,
      "",
      "बंद करने के लिए *TUTOR OFF* · सब कुछ के लिए *MENU*",
    ]
      .filter((l): l is string => l !== null)
      .join("\n");
  }

  return [
    "📘 *AI tutor — how to use it*",
    names ? `(for ${names})` : null,
    "",
    "*1. Just type the question*",
    "e.g. _What is a fraction?_ or _Explain photosynthesis_",
    "Answers name your child's *NCERT book and chapter*, so you can open that very lesson.",
    "",
    "*2. Or start with a word*",
    "• *TEACH* fractions — explained simply",
    "• *EXAMPLES* fractions — worked examples",
    "• *PRACTICE* fractions — questions, one at a time",
    "• *CHECK* — checks your child's answer",
    "• *HOMEWORK* — help with homework (the method, not the answer)",
    "• *EXAM* maths — exam preparation",
    "• *HINT* — a nudge, not the full answer",
    "",
    opts.multipleChildren ? "*3. For your other child* — type *TUTOR*, then the child's number from the list (e.g. *TUTOR 2*)" : null,
    opts.multipleChildren ? "" : null,
    `*${opts.multipleChildren ? "4" : "3"}. Videos* — in the school app, AI tutor → *Watch videos* under any answer. NCERT/CBSE lessons from DIKSHA come first, in Hindi or English.`,
    "",
    "*What works best*",
    "• Let your child type the answers — that is what makes it stick.",
    "• Twenty minutes the evening before a paper is plenty.",
    "• If a chapter feels hard, start with *TEACH*, then *PRACTICE*.",
    "",
    "*After the free day*",
    `• *HINT* stays free — ${opts.freeHintsPerDay} hints every day.`,
    passes ? `• The full tutor: ${passes} — type *PASS*.` : null,
    "",
    "*TUTOR OFF* to stop · *MENU* for everything else",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}
