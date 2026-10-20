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
import { fetchFeeDeskFromDb, pushFeeDeskToDb } from "@/lib/feesNormalized.server";
import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import { pushStaffHrRemoteServer } from "@/lib/staffHrPersistence";
import { fetchStaffAttendanceOutdoorDutyFromDb, pushStaffAttendanceOutdoorDutyToDb } from "@/lib/staffAttendanceOutdoorDuty.server";
import { fetchStaffAttendanceDeskFromDb } from "@/lib/staffAttendanceNormalized.server";
import { pushStaffAttendanceSettingsToDb } from "@/lib/staffAttendanceDeskAncillary.server";
import { defaultAttendanceSettings } from "@/lib/staffAttendance";
import { saveItem, saveVendor } from "@/lib/inventory/catalogue.server";
import {
  listGoodsReceipts,
  listPurchaseOrders,
  listPurchaseReturns,
  listVendorBills,
  postGoodsReceipt,
  postPurchaseReturn,
  savePurchaseOrder,
} from "@/lib/inventory/procurement.server";
import { listSales, postSale } from "@/lib/inventory/sales.server";
import { STORE_PLAN } from "./growingLists";

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

  const g = fx.growing;
  must(
    "fee desk (receipts + charge vouchers)",
    await pushFeeDeskToDb(
      {
        vouchers: g.receipts,
        cheques: [],
        manualBooks: [],
        dayCloses: [],
        installmentPlans: [],
        planAllocations: [],
        carriedForwardDues: [],
        chargeVouchers: g.chargeVouchers,
      },
      { academicYearCode: AY_CURRENT, rebuildOpenDues: false },
    ),
  );
  const adj = await writeModuleLocalState("fee_adjustments", { rows: g.feeAdjustments });
  if (!adj.ok) throw new Error(`seed: fee adjustments failed: ${adj.error}`);
  must("staff HR (leave + requests)", await pushStaffHrRemoteServer(g.staffHr));
  // The staff attendance desk refuses to load (503) until its settings row
  // exists — every real school has one; a fresh database does not.
  must("staff attendance settings", await pushStaffAttendanceSettingsToDb(defaultAttendanceSettings()));
  must("outdoor duty", await pushStaffAttendanceOutdoorDutyToDb(g.outdoorDuty));
  must("certificates", await pushDeskSliceToDb("certificates", { ...g.certificates }));
  {
    const { pushServerBlob } = await import("@/lib/serverBlob");
    must("certificates blob", await pushServerBlob("certificates_state", g.certificates));
  }

  // Store: through the procurement functions, which mint their own numbers.
  const actor = "E2E seed";
  const vendor = await saveVendor({ name: STORE_PLAN.vendor.name }, actor);
  const item = await saveItem({ name: STORE_PLAN.item.name, sku: STORE_PLAN.item.sku }, actor);
  for (const o of STORE_PLAN.orders) {
    await savePurchaseOrder(
      { vendorId: vendor.id, orderDate: o.date, lines: [{ itemId: item.id, qty: o.qty, ratePaise: o.ratePaise }] },
      actor,
      AY_CURRENT,
    );
  }
  const grns: Record<string, string> = {};
  for (const r of STORE_PLAN.receipts) {
    const posted = await postGoodsReceipt(
      {
        vendorId: vendor.id,
        receiptDate: r.date,
        supplierInvoiceNo: `E2E-INV-${r.date}`,
        supplierInvoiceDate: r.date,
        createBill: true,
        lines: [{ itemId: item.id, qtyReceived: r.qty, ratePaise: r.ratePaise }],
      },
      actor,
      AY_CURRENT,
    );
    grns[r.date.slice(0, 7)] = posted.grnId;
  }
  for (const ret of STORE_PLAN.returns) {
    await postPurchaseReturn(
      {
        grnId: grns[ret.date.slice(0, 7)],
        vendorId: vendor.id,
        returnDate: ret.date,
        reason: "Damaged in transit (E2E)",
        lines: [{ itemId: item.id, qty: ret.qty, ratePaise: ret.ratePaise }],
      },
      actor,
      AY_CURRENT,
    );
  }
  // Counter sales through the counter's own posting function (inv_post_sale).
  for (const sale of STORE_PLAN.counterSales) {
    await postSale(
      {
        buyerKind: "walkin",
        buyerName: sale.buyerName,
        saleDate: sale.date,
        lines: [{ itemId: item.id, qty: 1, unitPricePaise: sale.unitPricePaise }],
        payments: sale.paidPaise > 0 ? [{ amountPaise: sale.paidPaise, mode: "cash" }] : [],
      },
      actor,
      AY_CURRENT,
    );
  }
  console.log("receipts, charge vouchers, adjustments, staff HR, outdoor duty, certificates, store documents and counter sales written");

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

  check("payroll audit entries", pr.ok ? pr.bundle.audit.length : -1, fx.payroll.audit.length);
  const fees = await fetchFeeDeskFromDb();
  check("fee receipts", fees.vouchers?.length ?? -1, fx.growing.receipts.length);
  check("charge vouchers", fees.ancillary?.chargeVouchers?.length ?? -1, fx.growing.chargeVouchers.length);
  const adjRead = await readModuleLocalState<{ rows?: unknown[] }>("fee_adjustments");
  check("fee adjustments", adjRead?.state?.rows?.length ?? -1, fx.growing.feeAdjustments.length);
  const hr = await fetchDeskSliceFromDb("staff_hr");
  if (!hr.ok) throw new Error(`seed read-back: staff HR read failed: ${hr.error}`);
  check("leave requests", Array.isArray(hr.bundle.leaveRequests) ? hr.bundle.leaveRequests.length : -1, fx.growing.staffHr.leaveRequests.length);
  // Staff requests are NOT seeded: with STAFF_HR read-from-db on (production
  // and this stack) they are neither a desk slice nor pushed to the blob, so
  // no server write path holds them — they live only in the browser that
  // raised them (production staff_hr_state: 0 requests, last written 5 Aug).
  const od = await fetchStaffAttendanceOutdoorDutyFromDb();
  check("outdoor duty trips", od.ok ? od.outdoorDuty.length : -1, fx.growing.outdoorDuty.length);
  const sad = await fetchStaffAttendanceDeskFromDb();
  check("staff attendance desk readable (outdoor duty through it)", sad.ok ? sad.ancillary.outdoorDuty.length : -1, fx.growing.outdoorDuty.length);
  const certs = await fetchDeskSliceFromDb("certificates");
  if (!certs.ok) throw new Error(`seed read-back: certificates read failed: ${certs.error}`);
  check("certificates", Array.isArray(certs.bundle.issues) ? certs.bundle.issues.length : -1, fx.growing.certificates.issues.length);
  check("purchase orders", (await listPurchaseOrders({ status: "all" })).length, STORE_PLAN.orders.length);
  check("goods receipts", (await listGoodsReceipts({})).length, STORE_PLAN.receipts.length);
  check("vendor bills", (await listVendorBills({ status: "all" })).length, STORE_PLAN.receipts.length);
  check("purchase returns", (await listPurchaseReturns({})).length, STORE_PLAN.returns.length);
  check("counter sales", (await listSales({ status: "all", pageSize: 5 })).total, STORE_PLAN.counterSales.length);
  check(
    "unpaid counter sales",
    (await listSales({ status: "unpaid", pageSize: 5 })).total,
    STORE_PLAN.counterSales.filter((x) => x.paidPaise === 0).length,
  );

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
