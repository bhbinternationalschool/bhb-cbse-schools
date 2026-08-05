/**
 * Audit live Supabase public schema vs repo migrations + ERP sync tables.
 *
 * Run from apps/web (needs DATABASE_URL or Supabase creds in .env.local):
 *   npm run audit:supabase
 *   npx tsx scripts/audit-supabase-schema.mts
 *   npx tsx scripts/audit-supabase-schema.mts --json
 */
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";

type ModuleAudit = {
  module: string;
  ok: boolean;
  present: number;
  expected: number;
  missing: string[];
  criticalMissing: string[];
};

type AuditReport = {
  ok: boolean;
  liveTableCount: number;
  expectedMigrationTableCount: number;
  missingMigrationTables: string[];
  missingSyncCriticalTables: string[];
  modules: ModuleAudit[];
  samples: {
    admissionsLeadCount: number | null;
    mirrorLeadCount: number | null;
  };
};

const SYNC_CRITICAL = new Set([
  "tenants",
  "profiles",
  "admissions_state",
  "school_mirror_state",
  "wa_bot_threads_state",
  "fees_state",
  "payments_state",
  "attendance_state",
  "exams_state",
  "payroll_state",
  "accounts_state",
  "store_state",
  "purchase_state",
  "staff_attendance_state",
  "staff_hr_state",
  "staff_advances_state",
  "staff_agreements_state",
  "rbac_state",
  "module_registry_state",
  "trust_state",
  "transport_state",
  "homework_state",
  "timetable_state",
  "exam_papers_state",
  "ptm_state",
  "certificates_state",
  "vault_state",
  "rte_state",
  "fee_recovery_tasks_state",
  "school_comms_state",
  "notifications_state",
  "staff_chat_state",
  "erp_chat_state",
  "wa_templates_state",
  "automation_state",
  "sis_households",
  "sis_students",
  "sis_departments",
  "sis_designations",
  "sis_staff",
  "student_curriculum",
  "curriculum_requests",
  "class_curriculum_templates",
  "erp_chat_threads",
  "erp_chat_messages",
]);

const MODULE_MAP: Record<string, string[]> = {
  "Foundation / Auth": [
    "tenants",
    "profiles",
    "roles",
    "user_role_assignments",
    "campuses",
    "classes",
    "sections",
    "students",
    "student_enrollments",
    "academic_years",
    "tenant_modules",
    "school_profiles",
  ],
  "Masters / Fee setup": [
    "fee_heads",
    "fee_groups",
    "fee_group_classes",
    "fee_installments",
    "fee_structure_lines",
    "late_fee_rules",
    "concession_kinds",
    "concession_rules",
    "special_fees",
    "number_series",
    "holidays",
    "subjects",
    "class_subjects",
    "departments",
    "designations",
    "staff_records",
    "academic_terms",
    "senior_streams",
  ],
  "Students (SIS)": [
    "sis_households",
    "sis_students",
    "households",
    "student_documents",
    "student_curriculum",
    "curriculum_requests",
    "class_curriculum_templates",
  ],
  Staff: [
    "sis_departments",
    "sis_designations",
    "sis_staff",
    "staff_leave_types",
    "staff_leave_requests",
    "staff_leave_balances",
    "staff_appraisals",
  ],
  "Admissions / CRM": ["admissions_state", "school_mirror_state"],
  "Fees & Payments": [
    "fees_state",
    "payments_state",
    "fee_collection_vouchers",
    "fee_voucher_lines",
    "payment_links",
    "fee_day_closes",
    "fee_manual_books",
    "fee_cheque_instruments",
    "fee_installment_plans",
    "fee_hold_overrides",
    "fee_recovery_policies",
  ],
  Attendance: ["attendance_state", "attendance_registers", "attendance_marks"],
  Exams: [
    "exams_state",
    "exam_terms",
    "exam_subjects",
    "exam_marks",
    "exam_papers_state",
    "exam_promotions",
    "exam_policy",
  ],
  Certificates: ["certificates_state", "certificate_issues"],
  Payroll: ["payroll_state"],
  Accounts: [
    "accounts_state",
    "accounts_cash_pools",
    "accounts_bank_accounts",
    "accounts_journal_entries",
    "accounts_coa",
  ],
  "Store / Purchase": [
    "store_state",
    "store_items",
    "purchase_state",
    "purchase_orders",
    "purchase_indents",
  ],
  Transport: [
    "transport_state",
    "transport_routes",
    "transport_stops",
    "transport_assignments",
    "transport_vehicles",
  ],
  "Homework / Timetable": [
    "homework_state",
    "homework_posts",
    "diary_entries",
    "timetable_state",
  ],
  "PTM / Leave / Vault": [
    "ptm_state",
    "ptm_events",
    "student_leave_requests",
    "vault_state",
    "vault_documents",
  ],
  "Trust / Construction": [
    "trust_state",
    "trust_projects",
    "trust_work_orders",
  ],
  "RTE / EWS": [
    "rte_state",
    "rte_quota_seats",
    "rte_settings",
    "tenant_module_registry",
  ],
  "Comms / Notifications": ["school_comms_state", "notifications_state"],
  "WhatsApp / Automation": [
    "wa_templates_state",
    "automation_state",
    "wa_bot_threads_state",
  ],
  "Staff / ERP Chat": [
    "staff_chat_state",
    "erp_chat_state",
    "erp_chat_threads",
    "erp_chat_messages",
  ],
  "Reports / RBAC": [
    "fee_recovery_tasks_state",
    "report_export_audit",
    "rbac_state",
    "module_registry_state",
  ],
};

function loadEnv(): Record<string, string> {
  const envPath = resolve(process.cwd(), ".env.local");
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      env[t.slice(0, i)] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    console.error("Missing apps/web/.env.local with DATABASE_URL");
    process.exit(1);
  }
  return env;
}

function databaseUrl(env: Record<string, string>): string {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) {
    console.error("DATABASE_URL not set in .env.local");
    process.exit(1);
  }
  const u = new URL(raw);
  u.port = "5432";
  u.search = "";
  return u.toString();
}

function psqlQuery(url: string, sql: string): string {
  return execSync(`psql "${url}" -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
  }).trim();
}

function expectedTablesFromMigrations(): Set<string> {
  const migDir = resolve(process.cwd(), "../../supabase/migrations");
  const expected = new Set<string>();
  for (const file of readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(migDir, file), "utf8");
    for (const m of sql.matchAll(
      /create table if not exists public\.([a-z0-9_]+)/gi,
    )) {
      expected.add(m[1]!);
    }
  }
  return expected;
}

function liveTables(url: string): Set<string> {
  const out = psqlQuery(
    url,
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1",
  );
  return new Set(out.split("\n").filter(Boolean));
}

function scalar(url: string, sql: string): string | null {
  try {
    const v = psqlQuery(url, sql);
    return v || null;
  } catch {
    return null;
  }
}

function buildReport(
  url: string,
  live: Set<string>,
  expected: Set<string>,
): AuditReport {
  const missingMigrationTables = [...expected]
    .filter((t) => !live.has(t))
    .sort();
  const missingSyncCriticalTables = [...SYNC_CRITICAL]
    .filter((t) => !live.has(t))
    .sort();

  const modules: ModuleAudit[] = [];
  for (const [module, tables] of Object.entries(MODULE_MAP)) {
    const unique = [...new Set(tables)];
    const missing = unique.filter((t) => !live.has(t));
    const criticalMissing = missing.filter((t) => SYNC_CRITICAL.has(t));
    modules.push({
      module,
      ok: missing.length === 0,
      present: unique.length - missing.length,
      expected: unique.length,
      missing,
      criticalMissing,
    });
  }

  const admissionsLeadCount = live.has("admissions_state")
    ? Number(
        scalar(
          url,
          "select coalesce(jsonb_array_length(state->'leads'),0) from admissions_state limit 1",
        ) ?? "NaN",
      )
    : null;
  const mirrorLeadCount = live.has("school_mirror_state")
    ? Number(
        scalar(
          url,
          "select coalesce(jsonb_array_length(state->'admissions'->'leads'),0) from school_mirror_state limit 1",
        ) ?? "NaN",
      )
    : null;

  return {
    ok:
      missingMigrationTables.length === 0 &&
      missingSyncCriticalTables.length === 0,
    liveTableCount: live.size,
    expectedMigrationTableCount: expected.size,
    missingMigrationTables,
    missingSyncCriticalTables,
    modules,
    samples: {
      admissionsLeadCount: Number.isFinite(admissionsLeadCount)
        ? admissionsLeadCount
        : null,
      mirrorLeadCount: Number.isFinite(mirrorLeadCount)
        ? mirrorLeadCount
        : null,
    },
  };
}

function printReport(report: AuditReport) {
  console.log("Supabase schema audit\n");
  console.log(
    `Tables: ${report.liveTableCount} live / ${report.expectedMigrationTableCount} expected from migrations`,
  );
  console.log(
    `Sync-critical missing: ${report.missingSyncCriticalTables.length === 0 ? "none" : report.missingSyncCriticalTables.join(", ")}`,
  );
  if (report.samples.admissionsLeadCount != null) {
    console.log(
      `CRM leads: admissions_state=${report.samples.admissionsLeadCount}, school_mirror=${report.samples.mirrorLeadCount ?? "—"}`,
    );
  }
  console.log("");

  for (const m of report.modules) {
    if (m.ok) {
      console.log(`✅ ${m.module} (${m.present}/${m.expected})`);
      continue;
    }
    const crit =
      m.criticalMissing.length > 0
        ? ` · CRITICAL: ${m.criticalMissing.join(", ")}`
        : "";
    console.log(
      `❌ ${m.module} (${m.present}/${m.expected}) missing: ${m.missing.join(", ")}${crit}`,
    );
  }

  if (report.missingMigrationTables.length > 0) {
    console.log("\nAll missing migration tables:");
    console.log(report.missingMigrationTables.join(", "));
    console.log(
      "\nFix: from repo root run pending migrations (e.g. supabase db push or psql each file in supabase/migrations/).",
    );
  }

  console.log(`\nOverall: ${report.ok ? "PASS" : "FAIL"}`);
}

function main() {
  const json = process.argv.includes("--json");
  const env = loadEnv();
  const url = databaseUrl(env);
  const expected = expectedTablesFromMigrations();
  const live = liveTables(url);
  const report = buildReport(url, live, expected);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (!report.ok) process.exit(1);
}

main();
