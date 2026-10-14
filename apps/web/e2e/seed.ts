/**
 * Seed the local test stack with the fixture school (apps/web/e2e/fixture.ts).
 *
 * Every write goes through the app's own server write path — the same
 * functions the API routes call — so the slices, the derived row tables and
 * every *_sync_meta row are exactly what the app itself would have written:
 *
 *   masters            pushMastersDeskToDb  (masters-desk POST, whole-desk save)
 *   staff roster       pushStaffRemoteServer (staff-roster POST)
 *   rbac, registry     pushDeskSliceToDb     (desk-slice POST)
 *   timetable          pushTimetableDeskToDb (timetable-desk POST)
 *   students, families pushSisToDb → sis_push_guarded (sis-roster POST)
 *
 * Then it reads everything back through the app's own read functions and
 * checks the counts. Refuses to run unless the process is configured for the
 * 127.0.0.1 stack, and refuses a database that already holds a school.
 *
 * Run by scripts/e2e-stack.sh up (via scripts/e2e-seed.ts). Never by hand
 * against anything else.
 */

import { assertLocalStack } from "./session";
import { AY_CURRENT, buildFixture, E2E_TENANT_SLUG } from "./fixture";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchMastersDeskFromDb, pushMastersDeskToDb } from "@/lib/mastersNormalized.server";
import { fetchStaffRemoteServer, pushStaffRemoteServer } from "@/lib/staffPersistence";
import { fetchDeskSliceFromDb, pushDeskSliceToDb } from "@/lib/deskSliceNormalized.server";
import { fetchTimetableDeskFromDb, pushTimetableDeskToDb } from "@/lib/timetableNormalized.server";
import { fetchSisFromDb, pushSisToDb } from "@/lib/sisNormalized.server";
import { fetchPayrollDeskFromDb, pushPayrollDeskToDb } from "@/lib/payrollNormalized.server";
import { TENANT } from "@/lib/types";

function check(what: string, actual: number, expected: number): void {
  if (actual !== expected) throw new Error(`seed read-back: ${what} = ${actual}, expected ${expected}`);
  console.log(`  ok  ${what} = ${actual}`);
}

function must<T extends { ok: boolean; error?: string }>(what: string, r: T): T {
  if (!r.ok) throw new Error(`seed: ${what} failed: ${r.error ?? "(no error text)"}`);
  return r;
}

export async function runSeed(): Promise<void> {
  assertLocalStack();
  if (TENANT.slug !== E2E_TENANT_SLUG) throw new Error(`TENANT.slug is ${TENANT.slug}`);

  // The tenants row. Migration 20260711000000_phase0_foundation inserts it on
  // a fresh database; create it only if that ever stops being true.
  let ctx = await getServerTenantContext();
  if (!ctx) {
    const { createServiceSupabase } = await import("@/lib/supabase/server");
    const sb = createServiceSupabase();
    if (!sb) throw new Error("seed: no Supabase client — is .env.e2e loaded?");
    const { error } = await sb.from("tenants").insert({ slug: E2E_TENANT_SLUG, name: TENANT.name });
    if (error) throw new Error(`seed: tenants insert failed: ${error.message}`);
    ctx = await getServerTenantContext();
    if (!ctx) throw new Error("seed: tenant still unresolvable after insert");
  }
  const { sb, tenantId } = ctx;
  console.log(`tenant ${E2E_TENANT_SLUG} = ${tenantId}`);

  const { data: existing, error: existingErr } = await sb
    .from("masters_desk_sync_meta")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existingErr) throw new Error(`seed: cannot read masters_desk_sync_meta: ${existingErr.message}`);
  if (existing) throw new Error("seed: this database already holds a school — run `e2e-stack.sh down` then `up`");

  const fx = buildFixture();

  // Masters: a desk never written accepts its first save without a revision.
  must("masters", await pushMastersDeskToDb(fx.masters, { baseUpdatedAt: null }));
  console.log("masters written");

  // Staff: an unstamped save adds rows; nothing is stored yet, so all land.
  const staffPush = must(
    "staff roster",
    await pushStaffRemoteServer({ ...fx.masters, ...fx.staff }),
  );
  if (staffPush.kept) throw new Error(`seed: staff push kept ${staffPush.kept} stored row(s) on a fresh database`);
  console.log("staff written");

  must("rbac", await pushDeskSliceToDb("rbac", { ...fx.rbac }));
  must("module registry", await pushDeskSliceToDb("module_registry", { ...fx.moduleRegistry }));
  must("timetable", await pushTimetableDeskToDb(fx.timetable));
  console.log("rbac, module registry, timetable written");

  const sisPush = must("sis roster", await pushSisToDb(fx.sis));
  if (!sisPush.guarded) throw new Error("seed: SIS was written by the legacy fallback, not sis_push_guarded");
  if (sisPush.conflicts?.length) throw new Error(`seed: sis_push_guarded reported ${sisPush.conflicts.length} conflicts`);
  console.log(`students written through sis_push_guarded (${sisPush.studentCount} students, ${sisPush.householdCount} households applied)`);

  // Growing lists for the month-grouped screens.
  must("payroll runs", await pushPayrollDeskToDb(fx.payroll));
  must("automation runs", await pushDeskSliceToDb("automation", { ...fx.automation }));
  console.log(`payroll runs (${fx.payroll.runs.length}) and automation runs (${fx.automation.runs.length}) written`);

  // Read back through the app's own readers.
  const e = fx.expected;
  console.log("read-back:");
  const m = await fetchMastersDeskFromDb();
  if (m.readFailed) throw new Error("seed read-back: masters read failed");
  check("masters classes", m.bundle.classes.length, e.classes);
  check("masters sections", m.bundle.sections.length, e.sections);
  check("masters subjects", m.bundle.subjects.length, e.subjects);
  check("masters classSubjects", m.bundle.classSubjects.length, e.classSubjects);
  check("masters_desk_sync_meta.class_count", m.meta?.classCount ?? -1, e.classes);
  check("masters_desk_sync_meta.subject_count", m.meta?.subjectCount ?? -1, e.subjects);

  const st = await fetchStaffRemoteServer();
  if (!st) throw new Error("seed read-back: staff read failed");
  check("staff", st.staff.length, e.staff);
  check("active staff", st.staff.filter((s) => s.status === "active").length, e.activeStaff);
  check("departments", st.departments.length, fx.staff.departments.length);
  check("designations", st.designations.length, fx.staff.designations.length);

  const rb = await fetchDeskSliceFromDb("rbac");
  if (!rb.ok) throw new Error(`seed read-back: rbac read failed: ${rb.error}`);
  check("rbac roles", Array.isArray(rb.bundle.roles) ? rb.bundle.roles.length : -1, fx.rbac.roles.length);
  check("rbac assignments", Array.isArray(rb.bundle.assignments) ? rb.bundle.assignments.length : -1, 1);
  const mr = await fetchDeskSliceFromDb("module_registry");
  if (!mr.ok) throw new Error(`seed read-back: module registry read failed: ${mr.error}`);
  check(
    "module registry entries",
    Object.keys((mr.bundle.enabled as Record<string, boolean> | undefined) ?? {}).length,
    Object.keys(fx.moduleRegistry.enabled).length,
  );

  const tt = await fetchTimetableDeskFromDb();
  if (!tt.ok) throw new Error("seed read-back: timetable read failed");
  check("timetable published grids", tt.bundle.publishedGrids.length, fx.timetable.publishedGrids.length);

  const pr = await fetchPayrollDeskFromDb();
  check("payroll runs", pr.ok ? pr.bundle.runs.length : -1, fx.payroll.runs.length);
  const au = await fetchDeskSliceFromDb("automation");
  if (!au.ok) throw new Error(`seed read-back: automation read failed: ${au.error}`);
  check("automation runs", Array.isArray(au.bundle.runs) ? au.bundle.runs.length : -1, fx.automation.runs.length);

  const sis = await fetchSisFromDb();
  if (!sis.ok) throw new Error("seed read-back: SIS read failed");
  check("sis households", sis.bundle.households.length, e.households);
  check("sis student rows", sis.bundle.students.length, e.studentRows);
  check(
    `sis ${AY_CURRENT} active children`,
    sis.bundle.students.filter((s) => s.academicYearCode === AY_CURRENT && s.status === "active").length,
    e.currentYearActiveChildren,
  );
  check("sis rows with blank academic year", sis.bundle.students.filter((s) => !s.academicYearCode).length, e.rowsWithBlankYear);

  console.log(
    `seeded: ${e.classes} classes, ${e.sections} sections, ${e.subjects} subjects, ${e.staff} staff ` +
      `(${e.activeStaff} active), ${e.households} households, ${e.studentRows} student rows ` +
      `(${e.currentYearActiveChildren} active children in ${AY_CURRENT}; ${e.childrenWithExtraRows} children ` +
      `with 2–4 rows; ${e.rowsWithBlankYear} rows with no year)`,
  );
}
