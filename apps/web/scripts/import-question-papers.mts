#!/usr/bin/env npx tsx
/**
 * Import a publisher's folder of question papers straight into the desk.
 *
 * The Question Papers tab does this from the office's own machine, and that
 * is how it should normally be done. This script exists for the first load —
 * a term's whole download, 88 files and 50 MB, run once by someone who can
 * watch the output — and for re-running it after a correction without asking
 * the office to sit through 88 uploads again.
 *
 * It shares every decision with the screen: the same planner says what each
 * file is, and the same `storeImportedPaper` stores it. What it adds is the
 * catalogue read (classes, subjects and exams come from the database rather
 * than the browser's copy) and writing the desk slice at the end.
 *
 * Nothing is written without `--commit`. A run without it reads every file,
 * prints exactly what would be filed, and stops.
 *
 *   cd apps/web
 *   npx tsx scripts/import-question-papers.mts "~/Downloads/Lead Assessments 2"
 *   ALLOW_LOCAL_PROD_WRITES=1 npx tsx scripts/import-question-papers.mts \
 *     "~/Downloads/Lead Assessments 2" --commit \
 *     --map 'exam:BHB INTERNATIONAL SCHOOL=HY'
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadEnvLocal } from "./lib/loadEnvLocal";
import { DEFAULT_AY } from "../src/lib/masters";
import { getServerTenantContext } from "../src/lib/serverTenant";
import {
  fetchDeskSliceFromDb,
  pushDeskSliceToDb,
} from "../src/lib/deskSliceNormalized.server";
import {
  mergeImportMappings,
  planPaperImport,
  type ImportCatalog,
  type ImportFileFacts,
  type ImportMappings,
} from "../src/lib/examPaperImport";
import { readPaperFile } from "../src/lib/examPaperRead";
import { storeImportedPaper } from "../src/lib/examPaperImportStore.server";
import {
  applyImportedSets,
  bankImportedQuestions,
  existingPaperFacts,
  normalizeExamPapersState,
  type ExamPaperSet,
  type ExamPapersState,
  type ImportedPaperInput,
} from "../src/lib/examPapers";

// Env before anything asks for a Supabase key: `tsx` does not read .env.local.
loadEnvLocal();

type Args = {
  folder: string;
  commit: boolean;
  year: string;
  actor: string;
  /** Put every imported question in the bank too; --no-bank turns it off. */
  bank: boolean;
  /** `--map 'subject:Numeracy=NUM'` */
  maps: { kind: string; word: string; value: string }[];
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    folder: "",
    commit: false,
    year: DEFAULT_AY,
    actor: "Import script",
    bank: true,
    maps: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--commit") out.commit = true;
    else if (a === "--no-bank") out.bank = false;
    else if (a === "--year") out.year = argv[++i] ?? out.year;
    else if (a === "--actor") out.actor = argv[++i] ?? out.actor;
    else if (a === "--map") {
      const raw = argv[++i] ?? "";
      const at = raw.indexOf("=");
      const head = raw.slice(0, at);
      const colon = head.indexOf(":");
      if (at > 0 && colon > 0) {
        out.maps.push({
          kind: head.slice(0, colon).trim(),
          word: head.slice(colon + 1).trim(),
          value: raw.slice(at + 1).trim(),
        });
      }
    } else if (!a.startsWith("--")) out.folder = a;
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.toLowerCase().endsWith(".docx")) out.push(p);
  }
  return out;
}

async function loadCatalog(year: string): Promise<ImportCatalog> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Supabase service role not configured");
  const { sb, tenantId } = ctx;

  const [classes, subjects, terms] = await Promise.all([
    sb
      .from("masters_desk_classes")
      .select("id,name,is_active")
      .eq("tenant_id", tenantId),
    sb
      .from("masters_desk_subjects")
      .select("id,code,name_en")
      .eq("tenant_id", tenantId),
    sb
      .from("exam_desk_terms")
      .select("id,code,label,academic_year_code,max_marks")
      .eq("tenant_id", tenantId),
  ]);

  if (classes.error) throw new Error(`classes: ${classes.error.message}`);
  if (subjects.error) throw new Error(`subjects: ${subjects.error.message}`);
  if (terms.error) throw new Error(`terms: ${terms.error.message}`);

  return {
    academicYearCode: year,
    classes: (classes.data ?? [])
      .filter((c) => c.is_active !== false)
      .map((c) => ({ id: String(c.id), name: String(c.name) })),
    subjects: (subjects.data ?? []).map((s) => ({
      id: String(s.id),
      code: String(s.code ?? ""),
      nameEn: String(s.name_en ?? s.code ?? ""),
    })),
    terms: (terms.data ?? []).map((t) => ({
      id: String(t.id),
      code: String(t.code ?? ""),
      label: String(t.label ?? t.code ?? ""),
      academicYearCode: String(t.academic_year_code ?? ""),
      maxMarks: Number(t.max_marks ?? 0),
    })),
  };
}

async function loadDeskState(): Promise<ExamPapersState> {
  const desk = await fetchDeskSliceFromDb("exam_papers");
  if (!desk.ok) throw new Error(`Could not read the papers desk: ${desk.error}`);
  return normalizeExamPapersState({ version: 1, ...desk.bundle });
}

function mappingsFrom(state: ExamPapersState, args: Args): ImportMappings {
  const learned: Partial<ImportMappings> = {
    classes: { ...state.importMappings?.classes },
    subjects: { ...state.importMappings?.subjects },
    exams: { ...state.importMappings?.exams },
  };
  for (const m of args.maps) {
    const table =
      m.kind === "subject" || m.kind === "subjects"
        ? learned.subjects!
        : m.kind === "class" || m.kind === "classes"
          ? learned.classes!
          : learned.exams!;
    table[m.word.toLowerCase()] = m.value;
  }
  return mergeImportMappings(learned);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.folder) {
    console.error("Usage: import-question-papers.mts <folder> [--commit]");
    process.exit(1);
  }

  const files = walk(args.folder);
  console.log(`${files.length} .docx under ${args.folder}`);
  if (!files.length) process.exit(1);

  const [catalog, state] = await Promise.all([loadCatalog(args.year), loadDeskState()]);
  console.log(
    `catalogue: ${catalog.classes.length} classes, ${catalog.subjects.length} subjects, ` +
      `${catalog.terms.filter((t) => t.academicYearCode === args.year).length} exams in ${args.year}`,
  );
  console.log(`desk already holds ${state.papers.length} paper(s)`);

  const mappings = mappingsFrom(state, args);

  const facts: ImportFileFacts[] = [];
  const bytesByPath = new Map<string, Uint8Array>();
  for (const full of files) {
    const relPath = relative(args.folder, full);
    const bytes = new Uint8Array(readFileSync(full));
    bytesByPath.set(relPath, bytes);
    facts.push((await readPaperFile(relPath, bytes)).facts);
  }

  const plan = planPaperImport({
    files: facts,
    catalog,
    mappings,
    existing: existingPaperFacts(state),
  });

  console.log(
    `\nplan: ${plan.counts.import} to import · ${plan.counts.duplicate} already here · ` +
      `${plan.counts.needs_mapping} need mapping · ${plan.counts.rejected} cannot import ` +
      `→ ${plan.groups.length} paper(s)`,
  );
  for (const row of plan.rows) {
    if (row.verdict === "import") continue;
    console.log(
      `  ${row.verdict.padEnd(14)} ${row.relPath}\n      ${[...row.reasons, ...row.unmapped].join(" | ")}`,
    );
  }
  if (plan.unmapped.length) {
    console.log(`\n  unmapped words: ${plan.unmapped.join(", ")}`);
    console.log(`  add e.g. --map 'exam:${plan.unmapped[0]!.split(":").slice(1).join(":")}=HY'`);
  }

  if (!args.commit) {
    console.log("\nDry run — nothing written. Re-run with --commit.");
    return;
  }

  const rows = plan.rows.filter((r) => r.verdict === "import");
  const setsByGroup = new Map<string, ExamPaperSet[]>();
  const failures: string[] = [];
  let stored = 0;
  let images = 0;

  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Supabase service role not configured");

  for (const row of rows) {
    const bytes = bytesByPath.get(row.relPath);
    if (!bytes) {
      failures.push(`${row.relPath}: file went missing`);
      continue;
    }
    const result = await storeImportedPaper({
      sb: ctx.sb,
      bytes,
      fileName: row.fileName,
      meta: {
        relPath: row.relPath,
        academicYearCode: args.year,
        examTermCode: row.examTermCode,
        className: row.className,
        subjectCode: row.subjectCode,
        setCode: row.setCode,
        publisherLabel: row.publisherLabel,
        fileHash: row.fileHash,
        importedBy: args.actor,
      },
    });
    if (!result.ok) {
      failures.push(`${row.relPath}: ${result.error}`);
      continue;
    }
    stored += 1;
    images += result.facts.imagesStored;
    if (result.facts.imagesFailed.length) {
      failures.push(
        `${row.relPath}: ${result.facts.imagesFailed.length} picture(s) not stored — ${result.facts.imagesFailed.join("; ")}`,
      );
    }
    const list = setsByGroup.get(row.groupKey) ?? [];
    list.push(result.set);
    setsByGroup.set(row.groupKey, list);
    process.stdout.write(
      `\r  stored ${stored}/${rows.length} (${images} pictures)        `,
    );
  }
  process.stdout.write("\n");

  const inputs: ImportedPaperInput[] = [];
  for (const group of plan.groups) {
    const sets = setsByGroup.get(group.groupKey);
    if (!sets?.length) continue;
    const first = group.rows[0]!;
    const term = catalog.terms.find((t) => t.id === group.examTermId);
    inputs.push({
      targetPaperId: group.targetPaperId,
      academicYearCode: args.year,
      examTermId: group.examTermId,
      classId: group.classId,
      subjectId: group.subjectId,
      examCode: term?.code || "",
      examName: term ? `${term.code} · ${term.label}` : group.examTermLabel,
      className: group.className,
      subjectCode: first.subjectCode,
      title: `${group.examTermLabel} · ${group.className} · ${group.subjectName}`,
      maxMarks: first.header.maxMarks,
      durationMinutes: first.header.durationMinutes,
      sets: sets.sort((a, b) => a.setCode.localeCompare(b.setCode)),
    });
  }

  const outcome = applyImportedSets(state, inputs, args.actor);
  const banked = args.bank
    ? bankImportedQuestions(outcome.state, inputs, args.actor)
    : { state: outcome.state, added: 0 };
  const next: ExamPapersState = {
    ...banked.state,
    importMappings: {
      classes: { ...state.importMappings?.classes },
      subjects: { ...state.importMappings?.subjects },
      exams: {
        ...state.importMappings?.exams,
        ...Object.fromEntries(
          args.maps
            .filter((m) => m.kind.startsWith("exam"))
            .map((m) => [m.word.toLowerCase(), m.value]),
        ),
      },
    },
  };

  const push = await pushDeskSliceToDb("exam_papers", next);
  if (!push.ok) {
    console.error(`\nSTORED ${stored} file(s) but the desk write failed: ${push.error}`);
    process.exit(1);
  }

  console.log(
    `\ndesk: ${outcome.created} paper(s) created, ${outcome.updated} updated, ` +
      `${outcome.addedSets} set(s) added, ${outcome.skippedSets} already present ` +
      `→ ${next.papers.length} paper(s) total`,
  );
  console.log(
    `bank: ${banked.added} question(s) added → ${next.bank.length} in the bank`,
  );
  if (failures.length) {
    console.log(`\n${failures.length} problem(s):`);
    for (const f of failures) console.log(`  ${f}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
