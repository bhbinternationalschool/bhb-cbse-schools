/**
 * Question-paper print layout: page size, single / two-up / folded booklet,
 * duplex imposition, typography by class band and the paper's language
 * (the header, labels and subject name follow it).
 *
 * Pure functions only — the sheet component measures and places, this file
 * decides. Everything here is a per-paper setting with an "auto" default so
 * a teacher never has to think about it unless the office wants a specific
 * format (A4 folded booklet, A5 for a primary class, large print…).
 */

export type PaperPageSize = "A4" | "A5" | "Legal" | "Letter";
export type PaperLayout = "single" | "two_up" | "booklet";
export type PaperDuplexFlip = "short" | "long";
export type PaperFontScale = "auto" | "small" | "normal" | "large";
export type PaperLanguage = "auto" | "en" | "hi" | "sa";
export type ResolvedLanguage = Exclude<PaperLanguage, "auto">;
export type ResolvedFontScale = Exclude<PaperFontScale, "auto">;

export type ExamPaperPrintSettings = {
  pageSize: PaperPageSize;
  layout: PaperLayout;
  /** Which edge the printer flips on for the back side (booklet only). */
  duplexFlip: PaperDuplexFlip;
  fontScale: PaperFontScale;
  language: PaperLanguage;
  /** Header lines in the paper's script; blank = the school's English defaults. */
  header: { schoolName: string; address: string; examName: string; title: string };
};

export const DEFAULT_PRINT_SETTINGS: ExamPaperPrintSettings = {
  pageSize: "A4",
  layout: "single",
  duplexFlip: "short",
  fontScale: "auto",
  language: "auto",
  header: { schoolName: "", address: "", examName: "", title: "" },
};

export const PAGE_SIZES: { code: PaperPageSize; label: string; widthMm: number; heightMm: number }[] = [
  { code: "A4", label: "A4 · 210 × 297 mm", widthMm: 210, heightMm: 297 },
  { code: "A5", label: "A5 · 148 × 210 mm", widthMm: 148, heightMm: 210 },
  { code: "Legal", label: "Legal · 8½ × 14 in", widthMm: 215.9, heightMm: 355.6 },
  { code: "Letter", label: "Letter · 8½ × 11 in", widthMm: 215.9, heightMm: 279.4 },
];

export const PAPER_LAYOUTS: { code: PaperLayout; label: string; hint: string }[] = [
  { code: "single", label: "One page per side (portrait)", hint: "The usual paper: prints top to bottom, front and back." },
  {
    code: "two_up",
    label: "Two pages per side, open flat (landscape)",
    hint: "Sheet turned sideways, two half-size pages side by side, read left → right then flip. No folding.",
  },
  {
    code: "booklet",
    label: "Folded booklet (landscape, fold in half)",
    hint: "Pages are re-ordered so that after printing both sides and folding down the middle, the booklet reads 1, 2, 3, 4… Cover is page 1.",
  },
];

export const FONT_SCALES: { code: PaperFontScale; label: string }[] = [
  { code: "auto", label: "Auto by class (large for Nursery–II, medium for III–V, standard above)" },
  { code: "large", label: "Large · ~14 pt body (primary)" },
  { code: "normal", label: "Medium · ~12 pt body" },
  { code: "small", label: "Standard · ~11 pt body (secondary, fits more)" },
];

/** Screen/print zoom applied to the sheet; "normal" is the sheet's native size. */
export const FONT_SCALE_ZOOM: Record<ResolvedFontScale, number> = { small: 0.92, normal: 1.05, large: 1.28 };

export const PAPER_LANGUAGES: { code: PaperLanguage; label: string }[] = [
  { code: "auto", label: "Auto by subject (Hindi paper → हिंदी, Sanskrit → संस्कृत, else English)" },
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "sa", label: "संस्कृतम्" },
];

export function normalizePrintSettings(raw: unknown): ExamPaperPrintSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<ExamPaperPrintSettings>;
  const h = (o.header && typeof o.header === "object" ? o.header : {}) as Partial<ExamPaperPrintSettings["header"]>;
  return {
    pageSize: PAGE_SIZES.some((p) => p.code === o.pageSize) ? (o.pageSize as PaperPageSize) : "A4",
    layout: PAPER_LAYOUTS.some((l) => l.code === o.layout) ? (o.layout as PaperLayout) : "single",
    duplexFlip: o.duplexFlip === "long" ? "long" : "short",
    fontScale: FONT_SCALES.some((f) => f.code === o.fontScale) ? (o.fontScale as PaperFontScale) : "auto",
    language: PAPER_LANGUAGES.some((l) => l.code === o.language) ? (o.language as PaperLanguage) : "auto",
    header: {
      schoolName: String(h.schoolName ?? "").trim(),
      address: String(h.address ?? "").trim(),
      examName: String(h.examName ?? "").trim(),
      title: String(h.title ?? "").trim(),
    },
  };
}

/* ─── Geometry ───────────────────────────────────────────────────── */

export const MM_PER_INCH = 25.4;
export const PX_PER_MM = 96 / MM_PER_INCH;

export type SheetGeometry = {
  /** The physical sheet as the printer sees it. */
  sheetWidthMm: number;
  sheetHeightMm: number;
  orientation: "portrait" | "landscape";
  /** Pages laid on one side of the sheet: 1 or 2. */
  pagesPerSide: 1 | 2;
  /** One printed page (half the sheet when two-up). */
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: { top: number; right: number; bottom: number; left: number };
  /** Space for the running footer inside the bottom margin area. */
  footerMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
};

export function sheetGeometry(s: ExamPaperPrintSettings): SheetGeometry {
  const size = PAGE_SIZES.find((p) => p.code === s.pageSize) ?? PAGE_SIZES[0]!;
  const imposed = s.layout !== "single";
  const sheetWidthMm = imposed ? size.heightMm : size.widthMm;
  const sheetHeightMm = imposed ? size.widthMm : size.heightMm;
  const pageWidthMm = imposed ? sheetWidthMm / 2 : sheetWidthMm;
  const pageHeightMm = sheetHeightMm;
  const small = pageWidthMm < 160;
  const marginMm = small
    ? { top: 9, right: 9, bottom: 9, left: 9 }
    : { top: 12, right: 12, bottom: 12, left: 12 };
  const footerMm = 7;
  return {
    sheetWidthMm,
    sheetHeightMm,
    orientation: imposed ? "landscape" : "portrait",
    pagesPerSide: imposed ? 2 : 1,
    pageWidthMm,
    pageHeightMm,
    marginMm,
    footerMm,
    contentWidthMm: pageWidthMm - marginMm.left - marginMm.right,
    contentHeightMm: pageHeightMm - marginMm.top - marginMm.bottom - footerMm,
  };
}

/* ─── Imposition ─────────────────────────────────────────────────── */

/** One physical sheet: page numbers (1-based) at [left, right] on each side; 0 = blank. */
export type ImposedSheet = { front: [number, number]; back: [number, number] };

/**
 * Folded booklet order. n pages are padded to a multiple of 4; sheet k
 * carries pages (n−2k, 2k+1) on the front and (2k+2, n−2k−1) on the back,
 * so a 4-page booklet is [4|1] / [2|3]: fold with page 1 outside and it
 * reads in order. That back-side order assumes the printer flips on the
 * short edge (the usual "flip on short edge" duplex choice for a landscape
 * sheet); a long-edge flip mirrors the back, so its halves swap.
 */
export function imposeBooklet(pageCount: number, flip: PaperDuplexFlip = "short"): ImposedSheet[] {
  const n = Math.max(4, Math.ceil(Math.max(0, pageCount) / 4) * 4);
  const page = (p: number) => (p >= 1 && p <= pageCount ? p : 0);
  const sheets: ImposedSheet[] = [];
  for (let k = 0; k < n / 4; k++) {
    const front: [number, number] = [page(n - 2 * k), page(2 * k + 1)];
    const backShort: [number, number] = [page(2 * k + 2), page(n - 2 * k - 1)];
    sheets.push({ front, back: flip === "long" ? [backShort[1], backShort[0]] : backShort });
  }
  return sheets;
}

/** Two pages per side, in reading order: [1|2] on the front, [3|4] on the back. */
export function imposeTwoUp(pageCount: number): ImposedSheet[] {
  const n = Math.max(4, Math.ceil(Math.max(0, pageCount) / 4) * 4);
  const page = (p: number) => (p >= 1 && p <= pageCount ? p : 0);
  const sheets: ImposedSheet[] = [];
  for (let k = 0; k < n / 4; k++) {
    sheets.push({ front: [page(4 * k + 1), page(4 * k + 2)], back: [page(4 * k + 3), page(4 * k + 4)] });
  }
  return sheets;
}

export function imposeSheets(layout: PaperLayout, pageCount: number, flip: PaperDuplexFlip): ImposedSheet[] {
  return layout === "booklet" ? imposeBooklet(pageCount, flip) : imposeTwoUp(pageCount);
}

/**
 * Greedy block pagination: fill each page top to bottom, never split a
 * block, keep a `keepWithNext` block (a section heading) on the same page as
 * the block after it, and give an over-tall block a page of its own.
 * Returns block indices per page.
 */
export function paginateBlocks(
  heights: number[],
  keepWithNext: boolean[],
  pageHeight: number,
  gap: number,
): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  const groupHeight = (from: number, to: number) => {
    let h = 0;
    for (let i = from; i <= to; i++) h += (heights[i] ?? 0) + (i > from ? gap : 0);
    return h;
  };
  let i = 0;
  while (i < heights.length) {
    // A heading travels with the next block; two headings in a row travel together.
    let j = i;
    while (keepWithNext[j] && j + 1 < heights.length) j++;
    const h = groupHeight(i, j);
    let need = (cur.length ? gap : 0) + h;
    if (cur.length && used + need > pageHeight) {
      pages.push(cur);
      cur = [];
      used = 0;
      need = h;
    }
    for (let k = i; k <= j; k++) cur.push(k);
    used += need;
    i = j + 1;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

/* ─── Typography ─────────────────────────────────────────────────── */

/**
 * Font size by class band. Nursery–II read large print (≈14 pt); III–V a
 * medium size; VI upwards the standard ≈11 pt that fits a CBSE paper on
 * two sides. Bold is reserved for what the eye must find first: the school
 * name, the exam name, section titles and question numbers; marks sit in
 * brackets at the right edge in a lighter weight; instructions are set
 * smaller and, in Latin script, italic.
 */
export function fontScaleForClass(className: string): ResolvedFontScale {
  const c = className.trim().toUpperCase();
  if (/^(NUR|NURSERY|PRE|PLAY|LKG|UKG|KG|I|II|1|2)(\b|$)/.test(c)) return "large";
  if (/^(III|IV|V|3|4|5)(\b|$)/.test(c)) return "normal";
  return "small";
}

export function resolveFontScale(s: ExamPaperPrintSettings, className: string): ResolvedFontScale {
  return s.fontScale === "auto" ? fontScaleForClass(className) : s.fontScale;
}

/* ─── Language ───────────────────────────────────────────────────── */

export function languageForSubject(subjectName: string): ResolvedLanguage {
  const s = subjectName.trim().toLowerCase();
  if (/sanskrit|संस्कृत/.test(s)) return "sa";
  if (/hindi|हिंदी|हिन्दी/.test(s)) return "hi";
  return "en";
}

export function resolveLanguage(s: ExamPaperPrintSettings, subjectName: string): ResolvedLanguage {
  return s.language === "auto" ? languageForSubject(subjectName) : s.language;
}

export type PrintLabels = {
  class: string;
  subject: string;
  duration: string;
  minutes: string;
  maxMarks: string;
  set: string;
  paperCode: string;
  affiliation: string;
  schoolCode: string;
  examination: string;
  generalInstructions: string;
  marks: string;
  attemptAny: (n: number, m: number) => string;
  columnA: string;
  columnB: string;
  trueFalse: string;
  answer: string;
  wordBank: string;
  showWorking: string;
  page: string;
  of: string;
  key: string;
  attachedDiagram: string;
};

const LABELS: Record<ResolvedLanguage, PrintLabels> = {
  en: {
    class: "Class",
    subject: "Subject",
    duration: "Duration",
    minutes: "min",
    maxMarks: "Max marks",
    set: "Set",
    paperCode: "Paper code",
    affiliation: "Aff.",
    schoolCode: "School code",
    examination: "Examination",
    generalInstructions: "General instructions",
    marks: "marks",
    attemptAny: (n, m) => `Attempt any ${n} of the following ${m}.`,
    columnA: "Column A",
    columnB: "Column B",
    trueFalse: "(True / False)",
    answer: "Answer",
    wordBank: "Word bank",
    showWorking: "Show your working.",
    page: "Page",
    of: "of",
    key: "Key",
    attachedDiagram: "Label the parts",
  },
  hi: {
    class: "कक्षा",
    subject: "विषय",
    duration: "समय",
    minutes: "मिनट",
    maxMarks: "पूर्णांक",
    set: "सेट",
    paperCode: "प्रश्नपत्र कोड",
    affiliation: "संबद्धता क्र.",
    schoolCode: "विद्यालय कोड",
    examination: "परीक्षा",
    generalInstructions: "सामान्य निर्देश",
    marks: "अंक",
    attemptAny: (n, m) => `निम्नलिखित ${m} में से किन्हीं ${n} के उत्तर दीजिए।`,
    columnA: "स्तम्भ 'अ'",
    columnB: "स्तम्भ 'ब'",
    trueFalse: "(सत्य / असत्य)",
    answer: "उत्तर",
    wordBank: "शब्द-सूची",
    showWorking: "हल दिखाइए।",
    page: "पृष्ठ",
    of: "/",
    key: "कुंजी",
    attachedDiagram: "भागों के नाम लिखिए",
  },
  sa: {
    class: "कक्षा",
    subject: "विषयः",
    duration: "समयः",
    minutes: "निमेषाः",
    maxMarks: "पूर्णाङ्काः",
    set: "सेट",
    paperCode: "प्रश्नपत्र-सङ्केतः",
    affiliation: "सम्बद्धता-सङ्ख्या",
    schoolCode: "विद्यालय-सङ्केतः",
    examination: "परीक्षा",
    generalInstructions: "सामान्यनिर्देशाः",
    marks: "अङ्काः",
    attemptAny: (n, m) => `अधोलिखितेषु ${m} प्रश्नेषु केषाञ्चित् ${n} प्रश्नानाम् उत्तराणि लिखत।`,
    columnA: "स्तम्भः 'अ'",
    columnB: "स्तम्भः 'ब'",
    trueFalse: "(सत्यम् / असत्यम्)",
    answer: "उत्तरम्",
    wordBank: "शब्दसूची",
    showWorking: "प्रक्रियां दर्शयत।",
    page: "पृष्ठम्",
    of: "/",
    key: "कुञ्जी",
    attachedDiagram: "अङ्गानां नामानि लिखत",
  },
};

export function printLabels(lang: ResolvedLanguage): PrintLabels {
  return LABELS[lang];
}

const SUBJECT_NAMES: Record<Exclude<ResolvedLanguage, "en">, [RegExp, string][]> = {
  hi: [
    [/^english/i, "अंग्रेज़ी"],
    [/^hindi/i, "हिंदी"],
    [/^sanskrit/i, "संस्कृत"],
    [/^urdu/i, "उर्दू"],
    [/^math|^early numeracy/i, "गणित"],
    [/^applied math/i, "व्यावहारिक गणित"],
    [/^science$/i, "विज्ञान"],
    [/^social/i, "सामाजिक विज्ञान"],
    [/^environmental studies|^evs|world around us/i, "पर्यावरण अध्ययन"],
    [/^environmental education/i, "पर्यावरण शिक्षा"],
    [/^physics/i, "भौतिक विज्ञान"],
    [/^chemistry/i, "रसायन विज्ञान"],
    [/^biology/i, "जीव विज्ञान"],
    [/^history/i, "इतिहास"],
    [/^geography/i, "भूगोल"],
    [/^political/i, "राजनीति विज्ञान"],
    [/^economics/i, "अर्थशास्त्र"],
    [/^accountancy/i, "लेखाशास्त्र"],
    [/^business/i, "व्यवसाय अध्ययन"],
    [/^psychology/i, "मनोविज्ञान"],
    [/^sociology/i, "समाजशास्त्र"],
    [/computer|information technology|^ict|computational/i, "कंप्यूटर"],
    [/artificial intelligence/i, "कृत्रिम बुद्धिमत्ता"],
    [/^art/i, "कला"],
    [/physical education|^health/i, "शारीरिक शिक्षा"],
    [/^work education/i, "कार्य शिक्षा"],
    [/general knowledge|^gk/i, "सामान्य ज्ञान"],
    [/moral|ethics|value/i, "नैतिक शिक्षा"],
    [/music|rhymes/i, "संगीत"],
  ],
  sa: [
    [/^english/i, "आङ्ग्लभाषा"],
    [/^hindi/i, "हिन्दी"],
    [/^sanskrit/i, "संस्कृतम्"],
    [/^math/i, "गणितम्"],
    [/^science$/i, "विज्ञानम्"],
    [/^social/i, "सामाजिकविज्ञानम्"],
    [/^environmental/i, "पर्यावरणम्"],
    [/^history/i, "इतिहासः"],
    [/^geography/i, "भूगोलः"],
    [/computer/i, "सङ्गणकम्"],
    [/^art/i, "कला"],
    [/general knowledge|^gk/i, "सामान्यज्ञानम्"],
  ],
};

/** The subject's name in the paper's script; unknown subjects keep their English name. */
export function subjectNameIn(lang: ResolvedLanguage, englishName: string): string {
  if (lang === "en") return englishName;
  const name = englishName.trim();
  const hit = SUBJECT_NAMES[lang].find(([re]) => re.test(name));
  return hit ? hit[1] : name;
}
