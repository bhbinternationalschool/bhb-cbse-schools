/**
 * Run: npx tsx src/lib/reportsCenterHub.selftest.ts
 *
 * The Reports Center as a hub (audit step 4, 14 Oct 2026):
 *  - every entry's link lands where it says: the route exists and, for
 *    ?tab=, the page's workspace knows that tab (exams and certificates
 *    ignored ?tab=, /store dropped it, /accounts?tab=reports opened the
 *    server book while the entries were the desk registers);
 *  - "Run here" only where the Reports Center runs the report, and every
 *    such module has a panel (PTM, student leave, vault, RTE and the store
 *    were a sentence and a link; events and purchase were empty tabs);
 *  - each panel tags its report rows (data-report-id) so "Run here" can
 *    open the one asked for, and the store entries use the store's own ids;
 *  - the news register shows to someone who can open news (it never did);
 *  - reports that live on module screens are indexed ("Open").
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allowedEntryRbac,
  filterReportsCenterEntries,
  listReportsCenterEntries,
  REPORTS_CENTER_MODULES,
} from "./reportsCenterCatalog";
import { ACCOUNTS_REPORTS } from "./accountsReportCatalog";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const entries = listReportsCenterEntries();

/** The workspace files a route's page renders. */
function workspaceSources(route: string): string[] {
  const page = join(SRC, "app/(erp)", route, "page.tsx");
  if (!existsSync(page)) return [];
  const src = readFileSync(page, "utf8");
  return [...src.matchAll(/from "@\/components\/([^"]+)"/g)].map((m) => {
    const base = join(SRC, "components", m[1]!);
    return readFileSync(existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`, "utf8");
  });
}

check("every link lands on a real page and a tab that page opens", () => {
  const hrefs = new Set([...entries.map((e) => e.href), ...REPORTS_CENTER_MODULES.map((m) => m.href)]);
  for (const href of hrefs) {
    const url = new URL(href, "https://x.test");
    const route = url.pathname.replace(/^\//, "");
    if (route === "reports") {
      const mod = url.searchParams.get("module");
      assert.ok(REPORTS_CENTER_MODULES.some((m) => m.id === mod), `${href}: module tab exists`);
      const rep = url.searchParams.get("report");
      if (mod === "accounts") assert.ok(ACCOUNTS_REPORTS.some((r) => r.id === rep), `${href}: report exists`);
      continue;
    }
    const pageFile = join(SRC, "app/(erp)", route, "page.tsx");
    assert.ok(existsSync(pageFile), `${href}: page exists`);
    const tab = url.searchParams.get("tab");
    if (!tab) continue;
    const ws = workspaceSources(route).join("\n");
    assert.ok(ws.includes(`"${tab}"`), `${href}: the page's workspace knows tab "${tab}"`);
  }
});

check("no link through /store (its redirect dropped the tab)", () => {
  assert.ok(!entries.some((e) => e.href.startsWith("/store")));
  assert.ok(!REPORTS_CENTER_MODULES.some((m) => m.href.startsWith("/store")));
});

check("exams and certificates open the tab the link names", () => {
  const exams = read("components/exams/ExamsWorkspace.tsx");
  assert.match(exams, /\["result_reports", "results", "reports"\][\s\S]{0,80}urlAsksForTab/);
  const certs = read("components/certificates/CertificatesWorkspace.tsx");
  assert.match(certs, /get\("tab"\)[\s\S]{0,80}asked === "reports"/);
});

check("no empty tabs: every module has a panel or linked reports", () => {
  const rc = read("components/reports/ReportsCenterWorkspace.tsx");
  for (const m of REPORTS_CENTER_MODULES) {
    const hasCase = new RegExp(`case "${m.id}":\\s*(\\/\\/[^\\n]*\\n\\s*)*(return|if)`).test(rc);
    const hasLinked = entries.some((e) => e.moduleId === m.id && !e.runHere);
    assert.ok(hasCase || hasLinked, `${m.id}: a runner or linked reports`);
  }
  assert.ok(!REPORTS_CENTER_MODULES.some((m) => m.id === "events" || m.id === "purchase"), "events / purchase tabs offered nothing");
});

check("'Run here' only for modules the Reports Center runs", () => {
  const rc = read("components/reports/ReportsCenterWorkspace.tsx");
  for (const e of entries.filter((x) => x.runHere)) {
    assert.ok(new RegExp(`case "${e.moduleId}":`).test(rc), `${e.key}: module ${e.moduleId} has a runner`);
  }
  for (const id of ["ptm", "student_leave", "vault", "rte"]) {
    assert.ok(!new RegExp(`case "${id}":\\s*return \\(\\s*<p`).test(rc), `${id}: a runner, not a sentence and a link`);
  }
});

check("panels tag report rows so 'Run here' can open the one asked for", () => {
  for (const f of [
    "components/fees/FeeFinancePanels.tsx",
    "components/students/SisReportsPanel.tsx",
    "components/admissions/AdmissionReportsPanel.tsx",
    "components/staff/StaffLeaveReportsPanel.tsx",
    "components/attendance/StudentAttendanceReportsPanel.tsx",
    "components/payroll/PayrollReportsPanel.tsx",
    "components/reports/ModuleReportRunners.tsx",
    "components/inventory/ReportsTab.tsx",
  ]) {
    assert.match(read(f), /data-report-id=\{/, `${f} tags its rows`);
  }
  const rc = read("components/reports/ReportsCenterWorkspace.tsx");
  assert.match(rc, /querySelector<HTMLElement>\(`\[data-report-id=/);
  assert.match(rc, /setFocusReport\(e\.reportId\)/);
});

check("store entries use the store Reports tab's own ids", () => {
  const tab = read("components/inventory/ReportsTab.tsx");
  const ids = [...tab.matchAll(/\{ id: "([a-z]+)", label: "/g)].map((m) => m[1]);
  const store = entries.filter((e) => e.moduleId === "store");
  assert.ok(store.length >= 4);
  for (const e of store) assert.ok(ids.includes(e.reportId), `store:${e.reportId} is a ReportsTab id`);
});

check("news register shows to someone who can open news — and not otherwise", () => {
  const comms = REPORTS_CENTER_MODULES.filter((m) => m.id === "comms");
  const withNews = allowedEntryRbac(comms, entries, (m) => m === "notices" || m === "news");
  const keysWith = filterReportsCenterEntries(entries, { allowedRbac: withNews }).map((e) => e.key);
  assert.ok(keysWith.includes("comms:news_register"));
  const noNews = allowedEntryRbac(comms, entries, (m) => m === "notices");
  const keysWithout = filterReportsCenterEntries(entries, { allowedRbac: noNews }).map((e) => e.key);
  assert.ok(!keysWithout.includes("comms:news_register"));
});

check("reports on module screens are indexed, with 'Open'", () => {
  const keys = new Set(entries.map((e) => e.key));
  for (const k of [
    "accounts:trial_balance",
    "accounts:balance_sheet",
    "payroll:salary_register",
    "payroll:pf_esic_ecr",
    "fees:defaulters_playbook",
    "attendance:month_register",
    "students:udise_exports",
    "transport:bus_register",
    "visitors:visitor_log",
  ]) {
    assert.ok(keys.has(k), k);
    assert.equal(entries.find((e) => e.key === k)!.runHere, false, `${k} opens its module`);
  }
  assert.equal(new Set(entries.map((e) => e.key)).size, entries.length, "keys are unique");
});

if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("  all ok");
