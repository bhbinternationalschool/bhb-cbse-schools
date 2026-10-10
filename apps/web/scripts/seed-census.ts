#!/usr/bin/env npx tsx
/**
 * Seed village_demographics from a Census 2011 PCA CSV.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/seed-census.ts --file ~/Downloads/PCA_CDB-0966-F-Census.xlsx --dry-run
 *   npx tsx scripts/seed-census.ts --file ./data/pca-varanasi.csv
 *
 * Flags:
 *   --file <path>              .csv or .xlsx to read (required)
 *   --sheet <name>             XLSX sheet to use (default: the first)
 *   --levels village,town      Which Level rows to keep in a hierarchical
 *                              export (default village — DISTRICT / CD BLOCK
 *                              lines are aggregates and are always skipped)
 *   --district <name>          Keep only these district rows; also fills a
 *                              missing district column
 *   --block <name>             Same, for the sub-district / block
 *   --state <name>             Fills a missing state column (default Uttar Pradesh)
 *   --tru rural|urban|all      PCA TRU filter (default rural — a "Total" row
 *                              is Rural+Urban and would double count)
 *   --growth <n>               Growth multiplier per row (default 1.19)
 *   --child-ratio <n>          0-6 share per row (default 0.14)
 *   --observed-child-ratio     Use each village's OWN published 0-6 share
 *                              instead of the flat default, where the CSV
 *                              has it and the value is plausible
 *   --chunk <n>                Rows per upsert call (default 500)
 *   --limit <n>                Stop after n villages (smoke tests)
 *   --dry-run                  Parse, validate and report; write nothing
 *
 * Parsing and column mapping live in src/lib/censusPca.ts so they are type
 * checked and self-tested. This file is the CLI, the file read and the write.
 *
 * The script never writes estimated_current_total_pop /
 * estimated_current_child_pop — the database trigger derives those from the
 * baseline and the assumptions written here.
 */

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import * as XLSX from "xlsx";
import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

import {
  buildCensusRowsFromTable,
  parseCsv,
  type CensusBuildOptions,
} from "../src/lib/censusPca";
import { getServerTenantContext } from "../src/lib/serverTenant";
import {
  DEFAULT_CHILD_RATIO,
  DEFAULT_GROWTH_MULTIPLIER,
} from "../src/lib/villageMarket";

const LOG = "[seed-census]";

type Args = CensusBuildOptions & {
  file: string;
  sheet: string;
  chunk: number;
  dryRun: boolean;
};

/**
 * Read a .csv or .xlsx into a row/column matrix.
 *
 * `raw: false` keeps every cell as the string the sheet displays — census
 * codes like "000000" and "083501" are text, and letting the XLSX reader
 * coerce them to numbers would strip the leading zeros and break the
 * identity the upsert matches on.
 */
function readTable(path: string, sheetName: string): string[][] {
  const ext = extname(path).toLowerCase();
  if (ext !== ".xlsx" && ext !== ".xls" && ext !== ".xlsm") {
    return parseCsv(readFileSync(path, "utf8"));
  }
  const wb = XLSX.readFile(path, { raw: false });
  const name = sheetName || wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) {
    throw new Error(
      `Sheet "${name}" not found. Sheets in this file: ${wb.SheetNames.join(", ")}`,
    );
  }
  console.info(`${LOG} reading sheet "${name}"`);
  return XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const num = (flag: string, dflt: number): number => {
    const raw = get(flag);
    if (raw === null) return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${flag} must be a number, got "${raw}"`);
    return n;
  };

  const file = get("--file") || "";
  if (!file) throw new Error("--file <path-to-csv> is required");

  const tru = (get("--tru") || "rural").toLowerCase();
  if (tru !== "rural" && tru !== "urban" && tru !== "all") {
    throw new Error(`--tru must be rural, urban or all (got "${tru}")`);
  }

  const levelsRaw = (get("--levels") || "").trim();

  return {
    file,
    sheet: (get("--sheet") || "").trim(),
    ...(levelsRaw
      ? { levels: levelsRaw.split(",").map((l) => l.trim()).filter(Boolean) }
      : {}),
    district: (get("--district") || "").trim(),
    block: (get("--block") || "").trim(),
    state: (get("--state") || "Uttar Pradesh").trim(),
    tru,
    growth: num("--growth", DEFAULT_GROWTH_MULTIPLIER),
    childRatio: num("--child-ratio", DEFAULT_CHILD_RATIO),
    observedChildRatio: argv.includes("--observed-child-ratio"),
    limit: num("--limit", 0),
    chunk: Math.max(1, Math.min(2000, num("--chunk", 500))),
    dryRun: argv.includes("--dry-run"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const path = resolve(process.cwd(), args.file);

  console.info(`${LOG} reading ${path}`);
  const { rows, skipped } = buildCensusRowsFromTable(readTable(path, args.sheet), args);

  console.info(`${LOG} parsed ${rows.length} village row(s)`);
  for (const s of skipped) console.info(`${LOG}   skipped ${s.count}× — ${s.reason}`);

  if (!rows.length) {
    console.warn(`${LOG} nothing to write — check --district / --block / --tru`);
    process.exit(1);
  }

  // A visible sample so a column-mapping mistake is caught before thousands
  // of rows of wrong numbers land in the table.
  const s0 = rows[0];
  console.info(
    `${LOG} sample: ${s0.village_name} (${s0.block_name || "no block"}) ` +
      `pop2011=${s0.pop_total_2011} child06=${s0.child_0_6_total_2011} ` +
      `growth=${s0.growth_multiplier} childRatio=${s0.child_ratio} ` +
      `→ projected pop ≈ ${Math.round(s0.pop_total_2011 * s0.growth_multiplier)}`,
  );

  if (args.dryRun) {
    console.info(`${LOG} --dry-run: nothing written`);
    return;
  }

  const tenant = await getServerTenantContext();
  if (!tenant) {
    throw new Error(
      "Supabase service-role context unavailable — need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local",
    );
  }

  let inserted = 0;
  let updated = 0;
  let failedChunks = 0;

  for (let i = 0; i < rows.length; i += args.chunk) {
    const chunk = rows.slice(i, i + args.chunk);
    const label = `${i + 1}-${i + chunk.length}/${rows.length}`;
    const { data, error } = await tenant.sb.rpc("village_demographics_upsert", {
      p_tenant_id: tenant.tenantId,
      p_rows: chunk,
    });
    if (error) {
      failedChunks += 1;
      console.error(`${LOG} chunk ${label} FAILED: ${error.message}`);
      continue;
    }
    const result = (data as { inserted_count: number; updated_count: number }[] | null)?.[0];
    inserted += result?.inserted_count ?? 0;
    updated += result?.updated_count ?? 0;
    console.info(
      `${LOG} chunk ${label} ok (+${result?.inserted_count ?? 0} new, ~${result?.updated_count ?? 0} updated)`,
    );
  }

  console.info(
    `${LOG} done: ${inserted} inserted, ${updated} updated, ${failedChunks} chunk(s) failed`,
  );
  // A partial write must not exit 0 — a green run that lost half the file is
  // exactly how a seeding bug goes unnoticed.
  if (failedChunks > 0) process.exit(1);
}

main().catch((e) => {
  console.error(`${LOG} ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
