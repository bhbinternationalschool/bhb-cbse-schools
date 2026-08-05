#!/usr/bin/env npx tsx
/**
 * Wipe Masters desk + foundation tables for one tenant (clean slate).
 *
 * Usage: cd apps/web && npx tsx scripts/clear-masters-slate.ts
 */

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./lib/loadEnvLocal";
import { foundationMastersDeleteSql } from "./lib/clearTenantDataTables";
import { defaultMasters } from "../src/lib/masters";

loadEnvLocal();

function databaseUrl(): string | null {
  const raw =
    process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  const u = new URL(raw);
  u.port = "5432";
  u.search = "";
  return u.toString();
}

function runPsql(url: string, sql: string): void {
  execSync(`psql "${url}" -v ON_ERROR_STOP=1 -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Empty masters — one campus shell only; no classes/fee setup. */
function emptyMastersState() {
  const base = defaultMasters();
  return {
    ...base,
    version: 2 as const,
    classes: [],
    sections: [],
    feeHeads: [],
    feeGroups: [],
    feeStructureLines: [],
    installments: [],
    lateFeeRules: [],
    concessions: [],
    concessionGrants: [],
    specialFees: [],
    specialFeeAssignments: [],
    subjects: [],
    classSubjects: [],
    students: [],
    staff: [],
    departments: [],
    designations: [],
    teacherRoster: [],
    numberingRules: [],
    holidays: [],
    academicTerms: [],
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: tenant, error: tErr } = await sb
    .from("tenants")
    .select("id, slug, name")
    .eq("slug", "bhb-international")
    .single();
  if (tErr || !tenant?.id) {
    console.error("Tenant not found", tErr?.message);
    process.exit(1);
  }
  const tenantId = tenant.id as string;

  console.log(`Clearing Masters slate for ${tenant.name} (${tenantId})`);

  const { error: sliceErr } = await sb
    .from("masters_desk_slices")
    .delete()
    .eq("tenant_id", tenantId);
  if (sliceErr) console.warn("masters_desk_slices:", sliceErr.message);
  else console.log("  cleared masters_desk_slices");

  await sb.from("masters_desk_sync_meta").delete().eq("tenant_id", tenantId);
  console.log("  cleared masters_desk_sync_meta");

  const dbUrl = databaseUrl();
  if (dbUrl) {
    runPsql(dbUrl, foundationMastersDeleteSql(tenantId));
    console.log("  cleared foundation tables (classes, fee_heads, fee_groups, …)");
  } else {
    console.warn("  DATABASE_URL not set — skipped foundation SQL");
  }

  const emptyMasters = emptyMastersState();
  const { data: mirrorRow } = await sb
    .from("school_mirror_state")
    .select("state")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const now = new Date().toISOString();
  const mirror = {
    ...(mirrorRow?.state ?? {
      version: 1,
      sis: null,
      fees: null,
      payments: null,
      admissions: null,
    }),
    version: 1,
    updatedAt: now,
    masters: emptyMasters,
  };
  const { error: mirrorErr } = await sb.from("school_mirror_state").upsert(
    { tenant_id: tenantId, state: mirror, updated_at: now },
    { onConflict: "tenant_id" },
  );
  if (mirrorErr) console.warn("school_mirror_state:", mirrorErr.message);
  else console.log("  reset school_mirror_state.masters (empty shell)");

  const wipedAt = now;
  const publicDir = path.join(process.cwd(), "public");
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(
    path.join(publicDir, "tenant_data_wiped.json"),
    JSON.stringify(
      {
        wipedAt,
        note: "Masters desk cleared — clear browser site data and hard-refresh.",
      },
      null,
      2,
    ),
    "utf8",
  );

  const { count } = await sb
    .from("masters_desk_slices")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  console.log(`\nDone. masters_desk_slices rows: ${count ?? 0}`);
  console.log("Next: clear site data for bhbinternational.school, then log in.");
  console.log("Optional seed: npx tsx scripts/seed-masters-desk.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
