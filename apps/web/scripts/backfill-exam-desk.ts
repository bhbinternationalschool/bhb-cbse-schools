#!/usr/bin/env npx tsx
/**
 * Backfill exam_desk_* from exams_state blob or local mirror.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-exam-desk.ts
 */

import { readFile } from "fs/promises";
import path from "path";
import type { ExamsState } from "../src/lib/exams";
import {
  fetchExamDeskFromDb,
  pushExamDeskToDb,
} from "../src/lib/examsNormalized.server";

async function loadFromFile(file: string): Promise<ExamsState | null> {
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw) as ExamsState | { exams?: ExamsState };
  if ("version" in parsed && parsed.version === 1) return parsed as ExamsState;
  return (parsed as { exams?: ExamsState }).exams ?? null;
}

async function loadFromExamsBlob(): Promise<ExamsState | null> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<ExamsState>("exams_state");
  return blob.state ?? null;
}

async function resolveExams(): Promise<{ state: ExamsState; source: string }> {
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  if (fromArg) {
    const file = fromArg.split("=")[1]!;
    const state = await loadFromFile(path.resolve(file));
    if (!state) throw new Error(`No exams data in ${file}`);
    return { state, source: file };
  }

  const localPath = path.join(process.cwd(), ".data", "exams_state.json");
  try {
    const local = await loadFromFile(localPath);
    if (local) return { state: local, source: localPath };
  } catch {
    /* fall through */
  }

  const blob = await loadFromExamsBlob();
  if (blob) return { state: blob, source: "exams_state blob" };

  throw new Error(
    "No exams data found in local file or exams_state blob. Enter marks in ERP first.",
  );
}

async function main() {
  const { state, source } = await resolveExams();
  console.log(`Loaded from ${source}:`, {
    terms: state.terms.length,
    subjects: state.subjects.length,
    sheets: state.sheets.length,
    promotions: state.promotions.length,
  });

  const before = await fetchExamDeskFromDb();
  console.log(`DB before: ${before.bundle.sheets.length} sheets`);

  const result = await pushExamDeskToDb(state);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchExamDeskFromDb();
  console.log("Backfill OK");
  console.log(
    `DB after: ${after.bundle.sheets.length} sheets, ${after.meta?.markCount ?? 0} marks`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
