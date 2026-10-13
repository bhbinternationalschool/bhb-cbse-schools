/**
 * Run: npx tsx src/lib/reportDataGuard.selftest.ts
 *
 * Reports are never made from a copy this page has not loaded (14 Oct 2026).
 * Until then a fresh page exported 0 rows / ₹0.00 as the school's figure.
 *  - a run before load is refused with a message naming what is loading,
 *    and the missing stores are asked to load;
 *  - once loaded the report runs (the guard's message is gone);
 *  - a store that loads only for one report (the fee book for transport's
 *    unpaid riders) is required for that report alone;
 *  - loadReportData: loads what is missing; a store that cannot be read is
 *    named, never treated as empty;
 *  - no window / no database (server, tests, offline build) → no guard;
 *  - wiring: every run…Report starts with the guard; the Reports Center
 *    gates each module panel; its runners no longer seed or migrate data.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}

void (async () => {
  console.log("reportDataGuard.selftest.ts");
  const guard = await import("./deskHydrateGuard");
  const rdg = await import("./reportDataGuard");
  const { reportDesksFor } = await import("./reportDesks");

  await check("no window: the guard stands aside (server, self-tests, offline)", () => {
    assert.equal(rdg.refuseReportBeforeLoad(["fees"]), null);
    assert.deepEqual(rdg.missingReportDesks(["fees"]), []);
  });

  // From here: a browser with a database — the case the guard exists for.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  (globalThis as unknown as { window: unknown }).window = { dispatchEvent: () => true };
  (globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
    constructor(public type: string) {}
  };
  const asked: string[] = [];
  let failing = new Set<string>();
  rdg.setReportDataLoaderForTests(async (desk) => {
    asked.push(desk);
    if (!failing.has(desk)) guard.markDeskHydrated(desk);
  });

  await check("before load: refused, names the stores, asks them to load", async () => {
    const msg = rdg.refuseReportBeforeLoad(reportDesksFor("fees", "daily_collection"));
    assert.ok(msg, "refused");
    assert.match(msg!, /NOT made/);
    assert.match(msg!, /the fee book/);
    assert.match(msg!, /student records/);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual([...asked].sort(), ["fees", "masters", "payments", "sis"]);
  });

  await check("after load: the same report runs", () => {
    assert.equal(rdg.refuseReportBeforeLoad(reportDesksFor("fees", "daily_collection")), null);
  });

  await check("a real catalog run refuses before load and runs after", async () => {
    const { runTimetableReport } = await import("./timetableReportCatalog");
    const before = runTimetableReport("teacher_load", { format: "excel" } as never);
    assert.equal(before.ok, false);
    assert.match((before as { error: string }).error, /the timetable/);
    guard.markDeskHydrated("timetable");
    const after = runTimetableReport("teacher_load", { format: "excel", timetable: { grids: [], publishedGrids: [] } } as never);
    if (!after.ok) assert.doesNotMatch(after.error, /NOT made/, "past the guard");
  });

  await check("per-report stores: the fee book only for reports that read it", () => {
    assert.ok(reportDesksFor("transport", "unpaid_riders").includes("fees"));
    assert.ok(reportDesksFor("transport", "compliance_calendar").includes("fees"));
    assert.ok(!reportDesksFor("transport", "rider_roster").includes("fees"));
    assert.ok(reportDesksFor("accounts", "day_book").includes("fees"));
    assert.ok(!reportDesksFor("accounts", "ledger").includes("fees"));
    assert.ok(reportDesksFor("transport").includes("fees"), "the whole catalog: superset");
    assert.ok(reportDesksFor("sis", "udise_compliance").includes("module_state:udise_compliance"));
  });

  await check("loadReportData: loads what is missing", async () => {
    asked.length = 0;
    const r = await rdg.loadReportData(["homework", "masters"]);
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(asked, ["homework"], "masters was already loaded");
  });

  await check("loadReportData: an unreadable store is named, not empty", async () => {
    failing = new Set(["library"]);
    const r = await rdg.loadReportData(["library"]);
    assert.equal(r.ok, false);
    assert.deepEqual((r as { missing: string[] }).missing, ["library"]);
    assert.match((r as { error: string }).error, /Could not load the library/);
    assert.ok(rdg.refuseReportBeforeLoad(["library"]), "and its reports stay refused");
  });

  await check("a reset (conflict reload) makes the guard ask again", () => {
    guard.markDeskHydrated("vault");
    assert.equal(rdg.refuseReportBeforeLoad(["vault"]), null);
    guard.resetDeskHydrated("vault");
    assert.ok(rdg.refuseReportBeforeLoad(["vault"]));
  });

  await check("wiring: every run…Report starts with the guard", () => {
    const files: [string, string, string][] = [
      ["accountsReportCatalog.ts", "runAccountsReport", "accounts"],
      ["admissionReportCatalog.ts", "runAdmissionReport", "admissions"],
      ["certificatesReportCatalog.ts", "runCertificatesReport", "certificates"],
      ["commsReportCatalog.ts", "runCommsReport", "comms"],
      ["examReportCatalog.ts", "runExamReport", "exams"],
      ["feeReportCatalog.ts", "runFeeReport", "fees"],
      ["homework.ts", "runHomeworkReport", "homework"],
      ["library.ts", "runLibraryReport", "library"],
      ["payrollReportCatalog.ts", "runPayrollReport", "payroll"],
      ["ptm.ts", "runPtmReport", "ptm"],
      ["rteEws.ts", "runRteReport", "rte"],
      ["sisReportCatalog.ts", "runSisReport", "sis"],
      ["staffLeaveReportCatalog.ts", "runStaffLeaveReport", "staff_leave"],
      ["studentAttendanceReportCatalog.ts", "runStudentAttReport", "student_attendance"],
      ["studentLeave.ts", "runStudentLeaveReport", "student_leave"],
      ["timetableReportCatalog.ts", "runTimetableReport", "timetable"],
      ["transportReportCatalog.ts", "runTransportReport", "transport"],
      ["trustReportCatalog.ts", "runTrustReport", "trust"],
      ["vault.ts", "runVaultReport", "vault"],
    ];
    for (const [file, fn, cat] of files) {
      const src = readFileSync(join(__dirname, file), "utf8");
      const start = src.indexOf(`export function ${fn}(`);
      assert.ok(start >= 0, `${fn} found`);
      const body = src.slice(start, start + 1200);
      const guardAt = body.indexOf(`refuseReportBeforeLoad(reportDesksFor("${cat}"`);
      assert.ok(guardAt > 0, `${fn} is guarded with its own catalog`);
      const firstLoad = body.search(/\bload[A-Z][A-Za-z]*\(/);
      assert.ok(firstLoad < 0 || firstLoad > guardAt, `${fn}: the guard runs before any store is read`);
    }
  });

  await check("wiring: Reports Center gates module panels; runners never write", () => {
    const rc = readFileSync(join(__dirname, "../components/reports/ReportsCenterWorkspace.tsx"), "utf8");
    // The runner sits inside the gate (other wrappers, e.g. FocusReport, may sit between).
    assert.match(rc, /<ReportDataGate key=\{tab\} desks=\{moduleReportDesks\(tab, hideStaffRecords\)\}>[\s\S]{0,300}<ModuleRunner[\s\S]{0,300}<\/ReportDataGate>/);
    const runners = readFileSync(join(__dirname, "../components/reports/ModuleReportRunners.tsx"), "utf8");
    for (const w of ["seedTransportIfEmpty(", "migrateDemoFleetToReal(", "ensureAccountsSeeded(", "seedTrustIfEmpty("]) {
      assert.ok(!runners.includes(w), `report runners do not call ${w}`);
    }
  });

  rdg.setReportDataLoaderForTests(null);
  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("  all ok");
})();
