#!/usr/bin/env npx tsx
/**
 * Backfill sis_departments / sis_designations / sis_staff from school mirror.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-staff-roster.ts
 *   cd apps/web && npx tsx scripts/backfill-staff-roster.ts --from-mirror=.data/school_mirror.json
 */

import { readFile } from "fs/promises";
import path from "path";
import type { MastersState } from "../src/lib/masters";
import {
  fetchStaffRemoteServer,
  pushStaffRemoteServer,
} from "../src/lib/staffPersistence";

async function loadFromFile(file: string): Promise<MastersState | null> {
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw) as { masters?: MastersState };
  return parsed.masters ?? null;
}

async function loadFromMirrorBlob(): Promise<MastersState | null> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<{ masters?: MastersState }>(
    "school_mirror_state",
  );
  return blob.state?.masters ?? null;
}

function hasStaffSlice(masters: MastersState | null): boolean {
  if (!masters) return false;
  return (
    (masters.staff?.length ?? 0) > 0 ||
    (masters.departments?.length ?? 0) > 0 ||
    (masters.designations?.length ?? 0) > 0
  );
}

async function resolveMasters(): Promise<{ masters: MastersState; source: string }> {
  const fromArg = process.argv.find((a) => a.startsWith("--from-mirror="));
  if (fromArg) {
    const file = fromArg.split("=")[1]!;
    const masters = await loadFromFile(path.resolve(file));
    if (!hasStaffSlice(masters)) {
      throw new Error(`No staff slice in mirror file: ${file}`);
    }
    return { masters: masters!, source: file };
  }

  const mirrorPath = path.join(process.cwd(), ".data", "school_mirror.json");
  try {
    const local = await loadFromFile(mirrorPath);
    if (hasStaffSlice(local)) {
      return { masters: local!, source: mirrorPath };
    }
  } catch {
    /* fall through */
  }

  const blob = await loadFromMirrorBlob();
  if (hasStaffSlice(blob)) {
    return { masters: blob!, source: "school_mirror_state blob" };
  }

  throw new Error(
    "No staff roster found in local mirror or school_mirror_state blob. Add staff in ERP first.",
  );
}

async function main() {
  const { masters, source } = await resolveMasters();
  console.log(`Loaded from ${source}:`, {
    departments: masters.departments?.length ?? 0,
    designations: masters.designations?.length ?? 0,
    staff: masters.staff?.length ?? 0,
  });

  const before = await fetchStaffRemoteServer();
  console.log(
    `DB before: ${before?.departments.length ?? 0} departments, ${before?.designations.length ?? 0} designations, ${before?.staff.length ?? 0} staff`,
  );

  const result = await pushStaffRemoteServer(masters);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchStaffRemoteServer();
  console.log(
    `Backfill OK — DB now: ${after?.departments.length ?? 0} departments, ${after?.designations.length ?? 0} designations, ${after?.staff.length ?? 0} staff`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
