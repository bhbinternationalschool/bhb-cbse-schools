/**
 * Wipe transactional ERP data for one tenant — desk tables + jsonb blobs.
 * Preserves migration foundation (tenant, roles, classes, fee_heads, profiles).
 *
 * Usage (from apps/web):
 *   npx tsx scripts/clear-tenant-data.ts --dry-run
 *   npx tsx scripts/clear-tenant-data.ts --confirm
 *   npx tsx scripts/clear-tenant-data.ts --confirm --preserve-masters
 *   npx tsx scripts/clear-tenant-data.ts --confirm --super-admin-only
 *   npx tsx scripts/clear-tenant-data.ts --confirm --clear-storage
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (+ DATABASE_URL recommended for bulk SQL).
 */

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./lib/loadEnvLocal";
import { emptyBlobState } from "./lib/clearTenantBlobStates";
import {
  buildBlobTables,
  buildTenantDeleteTables,
  FOUNDATION_DELETE_ORDER,
  foundationDeleteSql,
  protectedSuperAdminEmailsFromEnv,
  specialDeleteSql,
  staffDeleteSql,
  type BlobTableName,
  type ClearPreserveOptions,
} from "./lib/clearTenantDataTables";

loadEnvLocal();

type Options = ClearPreserveOptions & {
  confirm: boolean;
  dryRun: boolean;
  clearStorage: boolean;
  tenantSlug: string;
};

function parseArgs(): Options {
  const argv = process.argv.slice(2);
  const superAdminOnly = argv.includes("--super-admin-only");
  return {
    confirm: argv.includes("--confirm"),
    dryRun: argv.includes("--dry-run"),
    preserveMasters: argv.includes("--preserve-masters"),
    preserveAdmissions:
      !superAdminOnly && argv.includes("--preserve-admissions"),
    preserveSis: !superAdminOnly && argv.includes("--preserve-sis"),
    preserveSuperAdminStaff:
      !superAdminOnly && argv.includes("--preserve-super-admin-staff"),
    superAdminOnly,
    clearStorage: argv.includes("--clear-storage"),
    tenantSlug:
      argv.find((a) => a.startsWith("--tenant="))?.split("=")[1] ??
      "bhb-international",
  };
}

function databaseUrl(): string | null {
  const raw = process.env.DATABASE_URL?.trim();
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

function buildDeleteSql(
  tenantId: string,
  tables: string[],
  opts: ClearPreserveOptions,
): string {
  return [
    "BEGIN;",
    ...specialDeleteSql(tenantId, opts),
    ...tables.map(
      (t) =>
        `DELETE FROM public.${t} WHERE tenant_id = '${tenantId}'::uuid;`,
    ),
    "COMMIT;",
  ].join("\n");
}

async function runStaffCleanup(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  opts: ClearPreserveOptions,
  dbUrl: string | null,
): Promise<void> {
  if (!opts.preserveSis) return;
  const staffSql = staffDeleteSql(tenantId, Boolean(opts.preserveSuperAdminStaff));
  if (!staffSql) return;
  const deptSql = `DELETE FROM public.sis_departments WHERE tenant_id = '${tenantId}'::uuid;`;
  const desSql = `DELETE FROM public.sis_designations WHERE tenant_id = '${tenantId}'::uuid;`;
  if (dbUrl) {
    runPsql(dbUrl, `BEGIN; ${staffSql} ${deptSql} ${desSql} COMMIT;`);
    console.log("  staff roster cleanup complete");
    return;
  }
  if (opts.preserveSuperAdminStaff) {
    const emails = new Set(
      (process.env.PROTECTED_SUPER_ADMIN_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    for (const e of [
      "director@bhbinternational.school",
      "ashishsingh80@gmail.com",
      "ashu.dube21@gmail.com",
    ]) {
      emails.add(e);
    }
    const { data: rows } = await sb
      .from("sis_staff")
      .select("id,email")
      .eq("tenant_id", tenantId);
    const toDelete = (rows ?? []).filter(
      (r) => !emails.has(String(r.email || "").trim().toLowerCase()),
    );
    for (const row of toDelete) {
      await sb.from("sis_staff").delete().eq("id", row.id);
    }
  } else {
    await sb.from("sis_staff").delete().eq("tenant_id", tenantId);
  }
  await sb.from("sis_departments").delete().eq("tenant_id", tenantId);
  await sb.from("sis_designations").delete().eq("tenant_id", tenantId);
  console.log("  staff roster cleanup complete (API)");
}

async function pruneToSuperAdminsOnly(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  dbUrl: string | null,
  dryRun: boolean,
): Promise<void> {
  const keepEmails = protectedSuperAdminEmailsFromEnv();
  const foundationSql = foundationDeleteSql(tenantId, keepEmails);

  if (dryRun) {
    const { data: profiles } = await sb
      .from("profiles")
      .select("id,email,full_name")
      .eq("tenant_id", tenantId);
    const remove = (profiles ?? []).filter(
      (p) => !keepEmails.includes(String(p.email || "").trim().toLowerCase()),
    );
    console.log(`  [dry-run] remove ${remove.length} non-super-admin profile(s)`);
    for (const p of remove) console.log(`    - ${p.email || p.full_name}`);
    console.log("  [dry-run] clear sections via class cascade");
    for (const t of FOUNDATION_DELETE_ORDER) {
      const n = await countRows(sb, t, tenantId);
      if (n && n > 0) console.log(`  [dry-run] clear ${t}: ${n} rows`);
    }
    return;
  }

  if (dbUrl) {
    runPsql(dbUrl, foundationSql);
  } else {
    const { data: profiles } = await sb
      .from("profiles")
      .select("id,email")
      .eq("tenant_id", tenantId);
    const removeIds = (profiles ?? [])
      .filter(
        (p) =>
          !keepEmails.includes(String(p.email || "").trim().toLowerCase()),
      )
      .map((p) => p.id as string);
    if (removeIds.length) {
      await sb.from("user_role_assignments").delete().in("profile_id", removeIds);
      await sb.from("profiles").delete().in("id", removeIds);
    }
    const { data: classRows } = await sb
      .from("classes")
      .select("id")
      .eq("tenant_id", tenantId);
    const classIds = (classRows ?? []).map((c) => c.id as string);
    if (classIds.length) {
      await sb.from("sections").delete().in("class_id", classIds);
    }
    for (const table of FOUNDATION_DELETE_ORDER) {
      await sb.from(table).delete().eq("tenant_id", tenantId);
    }
  }

  const { data: authUsers } = await sb.auth.admin.listUsers({ perPage: 1000 });
  let removedAuth = 0;
  for (const user of authUsers?.users ?? []) {
    const email = (user.email || "").trim().toLowerCase();
    if (!email || keepEmails.includes(email)) continue;
    const { error } = await sb.auth.admin.deleteUser(user.id);
    if (!error) removedAuth += 1;
    else console.warn(`  auth delete ${email}: ${error.message}`);
  }
  console.log(
    `  kept super-admin profiles (${keepEmails.join(", ")}) · removed ${removedAuth} auth user(s)`,
  );
}

async function countRows(
  sb: ReturnType<typeof createClient>,
  table: string,
  tenantId: string,
): Promise<number | null> {
  const { count, error } = await sb
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) return null;
  return count ?? 0;
}

async function deleteViaSupabase(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  tables: string[],
): Promise<{ table: string; deleted: boolean; error?: string }[]> {
  const results: { table: string; deleted: boolean; error?: string }[] = [];
  for (const table of tables) {
    const { error } = await sb.from(table).delete().eq("tenant_id", tenantId);
    results.push({
      table,
      deleted: !error,
      error: error?.message,
    });
  }
  return results;
}

async function resetBlobs(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  tables: BlobTableName[],
  dryRun: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  for (const table of tables) {
    if (dryRun) {
      console.log(`  [dry-run] reset blob ${table}`);
      continue;
    }
    const state = emptyBlobState(table);
    const { error } = await sb.from(table).upsert(
      { tenant_id: tenantId, state, updated_at: now },
      { onConflict: "tenant_id" },
    );
    if (error) {
      console.warn(`  blob ${table}: ${error.message}`);
    } else {
      console.log(`  reset blob ${table}`);
    }
  }
}

async function clearStoragePrefix(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  dryRun: boolean,
): Promise<void> {
  const bucket = "school-files";
  const queue = [tenantId];
  let removed = 0;

  while (queue.length > 0) {
    const prefix = queue.pop()!;
    const { data, error } = await sb.storage.from(bucket).list(prefix, {
      limit: 100,
    });
    if (error) {
      console.warn(`  storage list ${prefix}: ${error.message}`);
      continue;
    }
    for (const item of data ?? []) {
      const itemPath = `${prefix}/${item.name}`;
      if (item.id == null) {
        queue.push(itemPath);
        continue;
      }
      if (dryRun) {
        console.log(`  [dry-run] remove storage://${bucket}/${itemPath}`);
      } else {
        const { error: delErr } = await sb.storage
          .from(bucket)
          .remove([itemPath]);
        if (delErr) console.warn(`  storage remove ${itemPath}: ${delErr.message}`);
        else removed += 1;
      }
    }
  }
  console.log(
    dryRun
      ? "  [dry-run] storage sweep complete"
      : `  removed ${removed} storage object(s) under ${tenantId}/`,
  );
}

async function writeWipeSignals(root: string, wipedAt: string) {
  const feesDir = path.join(root, "public", "fees");
  await fs.mkdir(feesDir, { recursive: true });
  const collectionsSignal = {
    wipedAt,
    note: "All fee collections cleared with tenant wipe — refresh Fee Take.",
  };
  await fs.writeFile(
    path.join(feesDir, "collections_wiped.json"),
    JSON.stringify(collectionsSignal, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "public", "tenant_data_wiped.json"),
    JSON.stringify(
      {
        wipedAt,
        note: "Full tenant transactional wipe — hard-refresh browsers and clear localStorage if stale.",
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function main() {
  const opts = parseArgs();
  if (!opts.confirm && !opts.dryRun) {
    console.error(
      "Refusing to run without --confirm or --dry-run.\n" +
        "  npx tsx scripts/clear-tenant-data.ts --dry-run\n" +
        "  npx tsx scripts/clear-tenant-data.ts --confirm",
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: tenant, error: tErr } = await sb
    .from("tenants")
    .select("id, slug, name")
    .eq("slug", opts.tenantSlug)
    .single();
  if (tErr || !tenant?.id) {
    console.error(`Tenant not found: ${opts.tenantSlug}`, tErr?.message);
    process.exit(1);
  }
  const tenantId = tenant.id as string;

  const tables = buildTenantDeleteTables(opts);
  const blobTables = buildBlobTables(opts);

  console.log(
    opts.dryRun ? "DRY RUN — tenant transactional wipe" : "WIPING tenant transactional data",
  );
  console.log(`Tenant: ${tenant.name} (${tenant.slug}) ${tenantId}`);
  console.log(`Desk tables: ${tables.length} · Blob tables: ${blobTables.length}`);
  if (opts.superAdminOnly) console.log("Mode: super-admin-only (wipe all ERP data)");
  if (opts.preserveMasters) console.log("Preserving masters_desk_*");
  if (opts.preserveAdmissions) console.log("Preserving admission_desk_* + admissions_state");
  if (opts.preserveSis) console.log("Preserving sis_students/households + school_mirror_state");
  if (opts.preserveSuperAdminStaff) console.log("Preserving super-admin sis_staff rows");
  console.log("");

  const dbUrl = databaseUrl();

  if (opts.dryRun) {
    console.log("Row counts (non-zero only):");
    for (const table of tables) {
      const n = await countRows(sb, table, tenantId);
      if (n && n > 0) console.log(`  ${table}: ${n}`);
    }
    for (const table of blobTables) {
      const { data } = await sb
        .from(table)
        .select("state")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (data?.state) {
        const json = JSON.stringify(data.state);
        if (json.length > 80) {
          console.log(`  ${table}: blob ${json.length} chars`);
        } else if (json !== "{}" && json !== '{"version":1}') {
          console.log(`  ${table}: ${json}`);
        }
      }
    }
    if (opts.clearStorage) {
      await clearStoragePrefix(sb, tenantId, true);
    }
    if (opts.superAdminOnly) {
      await pruneToSuperAdminsOnly(sb, tenantId, dbUrl ?? null, true);
    }
    console.log("\nRe-run with --confirm to execute.");
    return;
  }

  if (dbUrl) {
    console.log("Deleting desk rows via SQL transaction…");
    try {
      runPsql(dbUrl, buildDeleteSql(tenantId, tables, opts));
      console.log("  SQL delete complete");
    } catch (err) {
      console.warn("  SQL delete failed, falling back to Supabase API:", err);
      const results = await deleteViaSupabase(sb, tenantId, tables);
      const failed = results.filter((r) => !r.deleted);
      for (const r of failed) {
        console.warn(`  ${r.table}: ${r.error}`);
      }
    }
  } else {
    console.log("DATABASE_URL not set — deleting via Supabase API…");
    const results = await deleteViaSupabase(sb, tenantId, tables);
    const failed = results.filter((r) => !r.deleted);
    for (const r of results.filter((x) => x.deleted)) {
      console.log(`  cleared ${r.table}`);
    }
    for (const r of failed) {
      console.warn(`  ${r.table}: ${r.error}`);
    }
    if (failed.length > 0) {
      console.warn(
        "\nSome tables failed — set DATABASE_URL in .env.local for transactional SQL wipe.",
      );
    }
  }

  if (opts.preserveSis) {
    console.log("\nCleaning staff roster (preserve super-admins)…");
    await runStaffCleanup(sb, tenantId, opts, dbUrl ?? null);
  }

  if (opts.superAdminOnly) {
    console.log("\nPruning to super-admin accounts only…");
    await pruneToSuperAdminsOnly(sb, tenantId, dbUrl ?? null, false);
  }

  console.log("\nResetting jsonb blobs…");
  await resetBlobs(sb, tenantId, blobTables, false);

  if (opts.clearStorage) {
    console.log("\nClearing Supabase Storage…");
    await clearStoragePrefix(sb, tenantId, false);
  }

  const wipedAt = new Date().toISOString();
  await writeWipeSignals(process.cwd(), wipedAt);

  console.log("\nDone. Next steps:");
  console.log("  1) npx tsx scripts/seed-masters-desk.ts   (if masters were wiped)");
  console.log("  2) Import real SIS → fees → admissions (see docs/GO_LIVE_DATA_RESET.md)");
  console.log("  3) npm run bootstrap:go-live -- --skip-desk   (RBAC + director profile only)");
  console.log("  4) npm run validate:desk-cutover");
  console.log("  5) Hard-refresh all browsers / clear localStorage");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
