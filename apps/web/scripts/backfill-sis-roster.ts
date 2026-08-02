#!/usr/bin/env npx tsx
/**
 * Backfill sis_households / sis_students from school mirror blob or file.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-sis-roster.ts
 *   cd apps/web && npx tsx scripts/backfill-sis-roster.ts --from-mirror=.data/school_mirror.json
 */

import { readFile } from "fs/promises";
import path from "path";
import type { SisState } from "../src/lib/sis";
import { fetchSisFromDb, pushSisToDb } from "../src/lib/sisNormalized.server";

async function loadFromFile(file: string): Promise<SisState | null> {
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw) as { sis?: SisState };
  return parsed.sis ?? null;
}

async function loadFromMirrorBlob(): Promise<SisState | null> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<{ sis?: SisState }>("school_mirror_state");
  return blob.state?.sis ?? null;
}

async function resolveSis(): Promise<{ sis: SisState; source: string }> {
  const fromArg = process.argv.find((a) => a.startsWith("--from-mirror="));
  if (fromArg) {
    const file = fromArg.split("=")[1]!;
    const sis = await loadFromFile(path.resolve(file));
    if (!sis?.students?.length && !sis?.households?.length) {
      throw new Error(`No SIS data in ${file}`);
    }
    return { sis: sis!, source: file };
  }

  const mirrorPath = path.join(process.cwd(), ".data", "school_mirror.json");
  try {
    const local = await loadFromFile(mirrorPath);
    if ((local?.students?.length ?? 0) > 0 || (local?.households?.length ?? 0) > 0) {
      return { sis: local!, source: mirrorPath };
    }
  } catch {
    /* fall through */
  }

  const blob = await loadFromMirrorBlob();
  if ((blob?.students?.length ?? 0) > 0 || (blob?.households?.length ?? 0) > 0) {
    return { sis: blob!, source: "school_mirror_state blob" };
  }

  throw new Error(
    "No SIS roster found in local mirror or school_mirror_state blob. Import students in ERP first.",
  );
}

async function main() {
  const { sis, source } = await resolveSis();
  console.log(`Loaded from ${source}:`, {
    households: sis.households.length,
    students: sis.students.length,
  });

  const before = await fetchSisFromDb();
  console.log(
    `DB before: ${before.bundle.households.length} households, ${before.bundle.students.length} students`,
  );

  const result = await pushSisToDb(sis);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchSisFromDb();
  console.log(
    `Backfill OK — wrote ${result.householdCount} households, ${result.studentCount} students`,
  );
  console.log(
    `DB now: ${after.bundle.households.length} households, ${after.bundle.students.length} students (${after.meta?.activeStudentCount ?? 0} active)`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
