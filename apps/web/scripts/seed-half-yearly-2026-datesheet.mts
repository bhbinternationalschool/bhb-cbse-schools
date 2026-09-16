/**
 * Half-yearly examination 2026-27 — the date sheet, as the school printed it.
 *
 *   npx tsx scripts/seed-half-yearly-2026-datesheet.mts            # dry run
 *   ALLOW_LOCAL_PROD_WRITES=1 npx tsx scripts/seed-half-yearly-2026-datesheet.mts --apply
 *
 * SOURCE: the printed "HALF YEARLY EXAMINATION — TIME TABLE (2026-27)",
 * 08:30–11:30 daily, 16–26 September 2026, Nursery to Class X. Transcribed
 * cell by cell on 2026-09-16; each class was checked to sit every one of
 * its papers exactly once.
 *
 * WHY A SCRIPT AND NOT THE SCREEN: 103 slots across 13 classes. The date-sheet
 * screen takes one slot at a time.
 *
 * WHY IT IS WRITTEN THIS WAY — `pushExamDeskToDb` REPLACES the setup tables:
 * any term, subject or slot whose id is not in the payload is DELETED. So this
 * fetches the whole live setup first, adds to it, and pushes everything back.
 * Nothing already in the database can be lost by running it, and every id is
 * stable, so running it twice changes nothing the second time.
 *
 * What it changes, and only this:
 *   1. term_hy ("Half-yearly") gets its dates: 2026-09-16 → 2026-09-26.
 *   2. Two exam subjects are added: General Knowledge (GK) and Artificial
 *      Intelligence (AI). Both are papers on the printed timetable with no
 *      subject to hang them on.
 *   3. Sanskrit, Art Education and Health & Physical Education have their
 *      class list WIDENED to the classes that sit them. Classes are only ever
 *      added — removing one could hide marks already entered for it.
 *   4. 103 date-sheet slots.
 *
 * Papers that combine things ("English Oral & Written", "G.K. / Computer
 * Practical", "Drawing & A.I. Theory / Practical") go on their main subject
 * with the rest in the slot's note, which is shown on the admit card. Making
 * each a subject of its own would have put "English Oral & Written" into
 * mark entry as a separate subject.
 *
 * AFTER RUNNING: any office tab with the Exams desk open must be RELOADED
 * before it saves anything. A setup save from a tab that has not re-read the
 * database sends its older copy, and the push deletes whatever that copy
 * does not have — including everything this script added.
 */

import { fetchExamDeskFromDb, pushExamDeskToDb } from "../src/lib/examsNormalized.server";
import type { ExamDateSheetEntry, ExamSubject, ExamTerm } from "../src/lib/exams";

const APPLY = process.argv.includes("--apply");
const AY = "2026-27";
const TERM_ID = "term_hy";
const START = "08:30";
const DURATION = 180;

const CLASS: Record<string, string> = {
  NUR: "cls_p7bw8cpc",
  LKG: "cls_2hwxqq84",
  UKG: "cls_oobr6iej",
  I: "cls_6is1if73",
  II: "cls_ftr21cbn",
  III: "cls_v9rhf3s1",
  IV: "cls_lk7msg00",
  V: "cls_groi80bm",
  VI: "cls_z9nznh2i",
  VII: "cls_ennua5pg",
  VIII: "cls_56ebo5ph",
  IX: "cls_5j9i0bwh",
  X: "cls_18weuxoi",
};
const ORDER = ["NUR", "LKG", "UKG", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const GK_ID = "esub_gk";
const AI_ID = "esub_ai";

/** Printed paper → exam subject + what goes in the note. */
const PAPER: Record<string, { subjectId: string; note: string }> = {
  EOW: { subjectId: "sub_eng", note: "English — Oral & Written" },
  HOW: { subjectId: "sub_hin", note: "Hindi — Oral & Written" },
  MOW: { subjectId: "sub_mat", note: "Maths — Oral & Written" },
  ERH: { subjectId: "sub_eng", note: "English Rhymes" },
  HRH: { subjectId: "sub_hin", note: "Hindi Rhymes" },
  GKO: { subjectId: GK_ID, note: "G.K. — Oral" },
  ENG: { subjectId: "sub_eng", note: "" },
  HIN: { subjectId: "sub_hin", note: "" },
  MAT: { subjectId: "sub_mat", note: "" },
  SCI: { subjectId: "sub_sci", note: "" },
  SST: { subjectId: "sub_sst", note: "" },
  CS: { subjectId: "sub_cs", note: "" },
  SKT: { subjectId: "esub_973wzz7p", note: "" },
  DRW: { subjectId: "esub_nooczqf9", note: "Drawing" },
  DAI: { subjectId: "esub_nooczqf9", note: "Drawing & A.I. Theory / Practical" },
  AI: { subjectId: AI_ID, note: "A.I. Theory / Practical" },
  GKCP: { subjectId: GK_ID, note: "G.K. / Computer Practical" },
  PE: { subjectId: "esub_9g5wwitd", note: "Physical Education" },
};

/** One row per date, one cell per class in ORDER. "-" = no paper that day. */
const TIMETABLE: [string, string[]][] = [
  ["2026-09-16", ["EOW", "EOW", "EOW", "ENG", "HIN", "ENG", "CS", "ENG", "HIN", "CS", "SCI", "ENG", "ENG"]],
  ["2026-09-18", ["HOW", "HOW", "HOW", "HIN", "ENG", "CS", "MAT", "SCI", "CS", "HIN", "MAT", "SCI", "SCI"]],
  ["2026-09-19", ["MOW", "MOW", "MOW", "SCI", "MAT", "HIN", "ENG", "HIN", "ENG", "ENG", "ENG", "PE", "PE"]],
  ["2026-09-21", ["DRW", "DRW", "DRW", "SST", "SCI", "SCI", "DRW", "DAI", "DAI", "DAI", "DAI", "-", "-"]],
  ["2026-09-22", ["ERH", "ERH", "ERH", "MAT", "SST", "SST", "HIN", "MAT", "SST", "SCI", "HIN", "SST", "SST"]],
  ["2026-09-23", ["HRH", "HRH", "HRH", "CS", "CS", "MAT", "SCI", "SST", "SKT", "SKT", "CS", "-", "-"]],
  ["2026-09-24", ["-", "-", "-", "GKCP", "GKCP", "AI", "AI", "SKT", "SCI", "MAT", "SST", "MAT", "MAT"]],
  ["2026-09-25", ["GKO", "GKO", "GKO", "DRW", "DRW", "DRW", "SST", "CS", "MAT", "SST", "SKT", "-", "-"]],
  ["2026-09-26", ["-", "-", "-", "-", "-", "GKCP", "GKCP", "GKCP", "GKCP", "GKCP", "GKCP", "HIN", "HIN"]],
];

function fail(msg: string): never {
  console.error(`\nREFUSING: ${msg}`);
  process.exit(1);
}

async function main() {
  console.log(APPLY ? "== APPLY (writes to the database) ==" : "== DRY RUN (nothing written) ==");

  const { bundle } = await fetchExamDeskFromDb();
  const before = {
    terms: bundle.terms.length,
    subjects: bundle.subjects.length,
    dateSheet: bundle.dateSheet.length,
    promotions: bundle.promotions.length,
  };
  console.log("live setup before:", before);

  /* ── 1. The term ─────────────────────────────────────────────────── */
  const term = bundle.terms.find((t) => t.id === TERM_ID);
  if (!term) fail(`term ${TERM_ID} not found — expected the existing "Half-yearly" term`);
  if (term.academicYearCode !== AY) fail(`term ${TERM_ID} is for ${term.academicYearCode}, not ${AY}`);
  const terms: ExamTerm[] = bundle.terms.map((t) =>
    t.id === TERM_ID
      ? {
          ...t,
          startsOn: "2026-09-16",
          endsOn: "2026-09-26",
          note: t.note || "Half Yearly Examination 2026-27 · 08:30–11:30 daily",
        }
      : t,
  );

  /* ── 2 & 3. Subjects: add GK and AI, widen three class lists ──────── */
  const byId = new Map(bundle.subjects.map((s) => [s.id, s]));
  const byCode = new Map(bundle.subjects.map((s) => [s.code.toUpperCase(), s]));

  const needClasses = new Map<string, Set<string>>();
  for (const [, cells] of TIMETABLE) {
    cells.forEach((code, i) => {
      if (code === "-") return;
      const paper = PAPER[code];
      if (!paper) fail(`unknown paper code ${code}`);
      const set = needClasses.get(paper.subjectId) ?? new Set<string>();
      set.add(CLASS[ORDER[i]!]!);
      needClasses.set(paper.subjectId, set);
    });
  }

  const subjects: ExamSubject[] = bundle.subjects.map((s) => {
    const need = needClasses.get(s.id);
    // Empty classIds already means "every class"; nothing to widen.
    if (!need || s.classIds.length === 0) return s;
    const merged = [...new Set([...s.classIds, ...need])];
    if (merged.length !== s.classIds.length) {
      console.log(`  widen ${s.name}: ${s.classIds.length} → ${merged.length} classes`);
    }
    return { ...s, classIds: merged };
  });

  const maxSort = Math.max(0, ...subjects.map((s) => s.sortOrder));
  for (const [id, code, name] of [
    [GK_ID, "GK", "General Knowledge"],
    [AI_ID, "AI", "Artificial Intelligence"],
  ] as const) {
    if (byId.has(id)) continue;
    const clash = byCode.get(code);
    if (clash) fail(`code ${code} is already used by subject ${clash.id} (${clash.name}) — unique per tenant`);
    subjects.push({
      id,
      code,
      name,
      classIds: [...(needClasses.get(id) ?? [])],
      maxMarks: 100,
      sortOrder: maxSort + (id === GK_ID ? 1 : 2),
      isActive: true,
    });
    console.log(`  add subject ${name} (${code}) for ${needClasses.get(id)?.size ?? 0} classes`);
  }

  const subjectIds = new Set(subjects.map((s) => s.id));

  /* ── 4. The slots ────────────────────────────────────────────────── */
  const now = new Date().toISOString();
  const slots: ExamDateSheetEntry[] = [];
  const seen = new Set<string>();
  for (const [date, cells] of TIMETABLE) {
    if (cells.length !== ORDER.length) fail(`${date} has ${cells.length} cells, expected ${ORDER.length}`);
    cells.forEach((code, i) => {
      if (code === "-") return;
      const cls = ORDER[i]!;
      const classId = CLASS[cls]!;
      const paper = PAPER[code]!;
      if (!subjectIds.has(paper.subjectId)) fail(`subject ${paper.subjectId} does not exist (${cls} ${date})`);
      const key = `${classId}|${date}`;
      if (seen.has(key)) fail(`two papers for ${cls} on ${date}`);
      seen.add(key);
      slots.push({
        id: `exam_slot_hy2026_${cls.toLowerCase()}_${date}`,
        academicYearCode: AY,
        examTermId: TERM_ID,
        classId,
        subjectId: paper.subjectId,
        date,
        startTime: START,
        durationMinutes: DURATION,
        note: paper.note,
        updatedAt: now,
      });
    });
  }

  // Every class sits each of its papers once — a transcription slip shows up
  // here as a subject appearing twice in one class.
  for (const cls of ORDER) {
    const mine = slots.filter((s) => s.classId === CLASS[cls]);
    const bySubjectNote = new Map<string, number>();
    for (const s of mine) {
      const k = `${s.subjectId}|${s.note}`;
      bySubjectNote.set(k, (bySubjectNote.get(k) ?? 0) + 1);
    }
    for (const [k, n] of bySubjectNote) {
      if (n > 1) fail(`${cls}: paper ${k} appears ${n} times`);
    }
  }

  const ours = new Set(slots.map((s) => s.id));
  const dateSheet = [
    ...bundle.dateSheet.filter((d) => !ours.has(d.id)),
    ...slots,
  ];

  console.log(`slots built: ${slots.length}`);
  for (const [date, cells] of TIMETABLE) {
    console.log(`  ${date}: ${cells.filter((c) => c !== "-").length} papers`);
  }

  const after = {
    terms: terms.length,
    subjects: subjects.length,
    dateSheet: dateSheet.length,
    promotions: bundle.promotions.length,
  };
  // Nothing may shrink. The push deletes what it is not given.
  for (const k of Object.keys(before) as (keyof typeof before)[]) {
    if (after[k] < before[k]) fail(`${k} would shrink ${before[k]} → ${after[k]}`);
  }
  console.log("setup after:", after);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with ALLOW_LOCAL_PROD_WRITES=1 and --apply to write.");
    return;
  }

  const res = await pushExamDeskToDb({
    version: 1,
    ...bundle,
    terms,
    subjects,
    dateSheet,
    sheets: [],
  } as Parameters<typeof pushExamDeskToDb>[0]);
  if (!res.ok) fail(`push failed: ${res.error}`);

  const { bundle: check } = await fetchExamDeskFromDb();
  const verified = {
    terms: check.terms.length,
    subjects: check.subjects.length,
    dateSheet: check.dateSheet.length,
    promotions: check.promotions.length,
    hySlots: check.dateSheet.filter((d) => d.examTermId === TERM_ID).length,
    hyDates: (() => {
      const t = check.terms.find((x) => x.id === TERM_ID);
      return t ? `${t.startsOn} → ${t.endsOn}` : "missing";
    })(),
  };
  console.log("\nverified in the database:", verified);
  if (verified.dateSheet !== after.dateSheet) fail("date sheet count does not match what was pushed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
