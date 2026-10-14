/**
 * Vehicle costs & papers from the kept stores (fuel register, vehicle
 * documents, ledger loans) — and no reader left on the desk's dead lists.
 * Run: npx tsx src/lib/transportVehicleCosts.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateFleetAlerts } from "./fleetLive";
import { summarizeLoan, type VehicleDoc } from "./transportFinance";
import { accountsStatus } from "./transportFuelRegister";
import {
  complianceCalendarRows,
  emiRegisterRows,
  fuelByVehicle,
  papersAsCompliance,
  recentFills,
  tcoPartText,
  tcoTotalText,
  toCostFill,
  toCostLoan,
  vehiclePapers,
  vehicleTco,
  type CostFill,
  type CostLoan,
} from "./transportVehicleCosts";

console.log("transportVehicleCosts.selftest.ts");

const inr = (p: number) => `₹${p / 100}`;

function doc(p: Partial<VehicleDoc> & Pick<VehicleDoc, "id" | "vehicleId" | "type" | "expiresOn">): VehicleDoc {
  return {
    number: "",
    issuedOn: "",
    feePaise: 0,
    insurer: "",
    policyNo: "",
    fileUrl: "",
    fileName: "",
    note: "",
    status: "active",
    voidReason: "",
    fee: null,
    createdAt: "2026-10-01T00:00:00Z",
    createdBy: "office",
    updatedAt: "2026-10-01T00:00:00Z",
    updatedBy: "office",
    ...p,
  };
}

const docs: VehicleDoc[] = [
  doc({ id: "d1", vehicleId: "veh_a", type: "puc", expiresOn: "2026-04-30", feePaise: 10000 }), // renewed below
  doc({ id: "d2", vehicleId: "veh_a", type: "puc", expiresOn: "2026-10-20", feePaise: 10000, number: "PUC-2" }),
  doc({ id: "d3", vehicleId: "veh_a", type: "insurance", expiresOn: "2027-03-01", feePaise: 4_500_000, insurer: "ICICI", policyNo: "P-9" }),
  doc({ id: "d4", vehicleId: "veh_a", type: "fitness", expiresOn: "2026-10-01", status: "void", voidReason: "typo" }),
  doc({ id: "d5", vehicleId: "veh_a", type: "permit", expiresOn: "2026-10-10" }), // no fee entered
  doc({ id: "d6", vehicleId: "veh_b", type: "puc", expiresOn: "2026-12-31", feePaise: 12000 }),
];

/* ─── papers ─── */
{
  const p = vehiclePapers(docs, "veh_a");
  assert.deepEqual(
    p.map((x) => [x.label, x.expiresOn]),
    [
      ["Permit", "2026-10-10"],
      ["PUC", "2026-10-20"],
      ["Insurance", "2027-03-01"],
    ],
    "one paper in force per type, the void fitness and the superseded PUC left out, soonest first",
  );
  assert.deepEqual(papersAsCompliance(docs, "veh_b"), [{ certType: "PUC", expiryDate: "2026-12-31" }]);
  assert.deepEqual(papersAsCompliance(docs, "veh_none"), []);
}

/* ─── the fleet WhatsApp alert, fed from the papers register ─── */
{
  const T0 = Date.parse("2026-10-14T06:30:00.000Z"); // 12:00 IST, Wednesday
  const vehicles = [
    { id: "veh_a", registrationNo: "UP65RT9825", name: "Magic-2", isActive: true, status: "active", serviceSchedule: [], compliance: papersAsCompliance(docs, "veh_a") },
    { id: "veh_b", registrationNo: "UP65AB1111", name: "Bus B", isActive: true, status: "active", serviceSchedule: [], compliance: papersAsCompliance(docs, "veh_b") },
  ];
  const alerts = evaluateFleetAlerts({ vehicles, positions: [], nowMs: T0, lastSent: {} });
  assert.deepEqual(alerts.map((a) => a.key), ["compliance_due:veh_a"], "PUC/permit within 15 days on A; B's PUC is far off");
  assert.match(alerts[0]!.detail, /Permit expired 2026-10-10/);
  assert.match(alerts[0]!.detail, /PUC expires 2026-10-20/);
  assert.doesNotMatch(alerts[0]!.detail, /Fitness/, "a voided paper never alerts");
  // Cooldown rule unchanged: sent 2 h ago → held.
  const held = evaluateFleetAlerts({
    vehicles,
    positions: [],
    nowMs: T0,
    lastSent: { "compliance_due:veh_a": new Date(T0 - 2 * 3600_000).toISOString() },
  });
  assert.equal(held.length, 0, "24 h cooldown still applies");
}

/* ─── compliance calendar ─── */
{
  const rows = complianceCalendarRows(docs, ["veh_a"], "2026-10-14");
  assert.equal(rows.length, 8, "every paper type is listed for the bus");
  assert.deepEqual(rows[0], {
    vehicleId: "veh_a", paper: "Permit", number: "", issuedOn: "", expiresOn: "2026-10-10", daysLeft: -4, status: "Expired", feePaise: 0, insurer: "", note: "",
  });
  assert.equal(rows[1]!.status, "Due soon");
  assert.equal(rows[1]!.paper, "PUC");
  assert.equal(rows[2]!.status, "OK");
  assert.equal(rows[2]!.insurer, "ICICI");
  const fitness = rows.find((r) => r.paper === "Fitness")!;
  assert.equal(fitness.status, "Not recorded", "a voided fitness is not a fitness certificate");
  assert.equal(fitness.daysLeft, null);
  assert.ok(rows.slice(3).every((r) => r.status === "Not recorded"), "not-recorded rows come last");
}

/* ─── fuel ─── */
const baseFill = {
  createdAt: "2026-10-01T00:00:00Z",
  fuelType: "cng",
  voucherId: null as string | null,
  voucherNo: "",
  voucherOrigin: "" as const,
  paymentMode: "cash" as const,
  entrySource: "web" as const,
  reversalVoucherNo: "",
  unit: "kg" as const,
  voided: false,
};
const fills: CostFill[] = [
  toCostFill({ ...baseFill, id: "f1", vehicleId: "veh_a", fillDate: "2026-10-01", quantity: 20, amountPaise: 180000, odometerKm: 1000, voucherId: "v1", voucherNo: "PV/1", voucherOrigin: "posted" }),
  toCostFill({ ...baseFill, id: "f2", vehicleId: "veh_a", fillDate: "2026-10-05", quantity: 20, amountPaise: 180000, odometerKm: 1300 }),
  toCostFill({ ...baseFill, id: "f3", vehicleId: "veh_a", fillDate: "2026-10-06", quantity: 99, amountPaise: 999900, odometerKm: 1400, voided: true }),
  toCostFill({ ...baseFill, id: "f4", vehicleId: "veh_a", fillDate: "2026-10-09", quantity: 10, amountPaise: 90000, odometerKm: null, paymentMode: "", entrySource: "app" }),
  toCostFill({ ...baseFill, id: "f5", vehicleId: "veh_b", fillDate: "2026-10-02", quantity: 30, amountPaise: 270000, odometerKm: null }),
];
{
  assert.equal(fills[0]!.status.kind, "in_accounts");
  assert.equal(fills[3]!.status.kind, "awaiting_office");
  assert.deepEqual(fills[2]!.status, accountsStatus({ ...baseFill, voided: true }));
  const [a, b] = fuelByVehicle(fills, ["veh_a", "veh_b"]);
  assert.deepEqual(a, {
    vehicleId: "veh_a",
    fills: 3,
    litres: 0,
    kg: 50,
    amountPaise: 450000,
    km: 300,
    fillsWithKm: 1,
    rupeesPerKm: 15,
    kmPerUnit: 6,
    kmPerUnitUnit: "kg",
    inAccounts: 1,
    notInAccounts: 1,
    awaitingOffice: 1,
    voided: 1,
  }, "voided fill out of every figure; km only from the 1000→1300 pair");
  assert.equal(b!.km, null, "no odometer pair → km unknown, not 0");
  assert.equal(b!.rupeesPerKm, null);
  assert.equal(b!.kmPerUnit, null);
  assert.deepEqual(recentFills(fills, "veh_a", 2).map((f) => f.id), ["f4", "f3"], "newest first, voided shown");
}

/* ─── loans: all-time EMI figures from the ledger summary ─── */
const loanSummary = summarizeLoan({
  today: "2026-10-14",
  dueDay: 10,
  rows: [
    { voucherId: "o", voucherNo: "OB/1", voucherType: "opening", date: "2026-03-31", debitPaise: 0, creditPaise: 50_000_00, interestPaise: 0, cancelled: false },
    { voucherId: "e1", voucherNo: "PV/10", voucherType: "payment", date: "2026-04-10", debitPaise: 10_000_00, creditPaise: 0, interestPaise: 2_000_00, cancelled: false },
    { voucherId: "e2", voucherNo: "PV/11", voucherType: "payment", date: "2026-05-10", debitPaise: 10_000_00, creditPaise: 0, interestPaise: 1_800_00, cancelled: false },
    { voucherId: "x", voucherNo: "PV/12", voucherType: "payment", date: "2026-06-10", debitPaise: 10_000_00, creditPaise: 0, interestPaise: 0, cancelled: true },
  ],
});
assert.equal(loanSummary.principalPaidPaise, 20_000_00);
assert.equal(loanSummary.interestPaidPaise, 3_800_00);
assert.deepEqual(loanSummary.emis.map((e) => e.voucherNo), ["PV/10", "PV/11"], "a cancelled voucher is not an EMI");

const loanA: CostLoan = toCostLoan({
  code: "2150",
  name: "Mahindra loan A",
  link: { vehicleId: "veh_a", emiDueDay: 5 },
  vehicleLabel: "Magic-2 · UP65RT9825",
  summary: loanSummary,
});
const loanFree: CostLoan = { ...loanA, code: "2151", name: "Mahindra loan B", vehicleId: "", vehicleLabel: "", principalPaidPaise: 7, interestPaidPaise: 1, emis: [], missingMonths: [], nextDueOn: "" };

/* ─── TCO ─── */
{
  const all = vehicleTco({ vehicleId: "veh_a", fills, docs, loans: { known: true, loans: [loanA] }, jobsPaise: 5000 });
  assert.equal(all.fuel.paise, 450000, "voided fill not in TCO");
  assert.equal(all.emiPrincipal.paise, 20_000_00);
  assert.equal(all.interest.paise, 3_800_00);
  assert.equal(all.insurance.paise, 4_500_000);
  assert.equal(all.papers.paise, 10000 + 10000, "both PUCs paid (renewal history), permit fee missing");
  assert.equal(all.papers.partial, true, "a paper with no fee entered makes the part a floor");
  assert.equal(all.complete, false);
  assert.deepEqual(all.gaps, ["papers"]);
  assert.equal(tcoPartText(all.papers, inr), "₹200+");
  assert.equal(all.knownTotalPaise, 450000 + 20_000_00 + 3_800_00 + 4_500_000 + 20000 + 5000);

  const noAccess = vehicleTco({ vehicleId: "veh_a", fills, docs, loans: { known: false, reason: "no access" }, jobsPaise: 0 });
  assert.equal(noAccess.emiPrincipal.paise, null, "a reader who may not see loans gets unknown, not ₹0");
  assert.equal(tcoPartText(noAccess.emiPrincipal, inr), "unknown");
  assert.match(tcoTotalText(noAccess, inr), /\+ unknown \(EMI, interest, papers\)$/);

  const unlinkedOnly = vehicleTco({ vehicleId: "veh_b", fills, docs, loans: { known: true, loans: [loanA, loanFree] }, jobsPaise: 0 });
  assert.equal(unlinkedOnly.emiPrincipal.paise, null, "B has no linked loan but one loan is linked to no bus → unknown");
  assert.match(unlinkedOnly.emiPrincipal.note, /1 loan account not linked/);

  const linkedPlusUnlinked = vehicleTco({ vehicleId: "veh_a", fills, docs, loans: { known: true, loans: [loanA, loanFree] }, jobsPaise: 0 });
  assert.equal(linkedPlusUnlinked.emiPrincipal.paise, 20_000_00);
  assert.equal(linkedPlusUnlinked.emiPrincipal.partial, true, "the unlinked loan may be this bus's too");

  const allLinked = vehicleTco({ vehicleId: "veh_b", fills, docs, loans: { known: true, loans: [loanA] }, jobsPaise: 0 });
  assert.equal(allLinked.emiPrincipal.paise, 0, "every loan linked elsewhere → this bus truly has none");
  assert.equal(allLinked.emiPrincipal.partial, false);

  const unread = vehicleTco({ vehicleId: "veh_a", fills: null, docs: null, loans: { known: true, loans: [] }, jobsPaise: 0 });
  assert.equal(unread.fuel.paise, null, "an unread register is unknown");
  assert.equal(unread.insurance.paise, null);
  assert.equal(unread.papers.paise, null);
}

/* ─── EMI register ─── */
{
  const rows = emiRegisterRows([loanA]);
  assert.deepEqual(
    rows.map((r) => [r.date, r.status, r.voucherNo, r.principalPaise]),
    [
      ["2026-04-10", "Posted", "PV/10", 10_000_00],
      ["2026-05-10", "Posted", "PV/11", 10_000_00],
      ...loanA.missingMonths.map((m) => [`${m}-05`, "Not posted", "", null]),
      [loanA.nextDueOn, "Next due", "", null],
    ],
    "posted EMIs, then each unposted month on the link's EMI day (no invented amount), then the next due",
  );
  assert.ok(loanA.missingMonths.includes("2026-06"), "the cancelled June EMI leaves June unposted");
}

/* ─── no reader left on the desk's dead lists ─── */
{
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const catalog = read("lib/transportReportCatalog.ts");
  for (const dead of ["transport.fuelRefillLogs", "transport.emiSchedule", "transport.insurancePolicies", "transport.certificateRenewals", "v.compliance", "vehicleTcoPaise("]) {
    assert.ok(!catalog.includes(dead), `transportReportCatalog no longer reads ${dead}`);
  }
  const panels = read("components/transport/TransportOpsPanels.tsx");
  const v360 = panels.slice(panels.indexOf("function Vehicle360("));
  for (const dead of ["state.fuelRefillLogs", "vehicle.compliance", "vehicleTcoPaise("]) {
    assert.ok(!v360.includes(dead), `Vehicle 360 no longer reads ${dead}`);
  }
  const live = read("lib/fleetLive.server.ts");
  assert.match(live, /papersAsCompliance\(papers\.state\.docs, v\.id\)/, "fleet alert papers come from transport_vehicle_docs");
  assert.ok(!read("lib/transport.ts").includes("export function vehicleTcoPaise"), "the desk TCO is gone");
  const route = read("app/api/transport/vehicle-costs/route.ts");
  assert.match(route, /requireStaffPermission\(req, "transport", "view"\)/);
  assert.match(route, /"accounts_position", "view"/, "loan figures need the position grant, as on vehicle-loans");
}

console.log("transportVehicleCosts.selftest.ts — ok");
