/**
 * Four active staff have no salary assignment at all, so payroll cannot run for
 * them. This adds the four links.
 *
 * Where the numbers come from: NOT the old ERP's salary master, which the
 * Aug-2026 EPFO return showed is stale for four of thirteen people. They come
 * from the money the school actually paid, in the old ERP's ACCOUNTS module —
 *
 *   /Inventory/GetPaymentVoucharReport?skip=0&take=5000
 *     &startDate=01-Apr-2026&endDate=20-Sep-2026&ledgerId=&paymentType=Payment
 *
 * — whose salary vouchers carry a full head-by-head breakdown. For all four the
 * breakdown is "Basic(Earning)" and nothing else: no EPF line, no ESI line. None
 * of the four appears in the Aug-2026 EPFO return either. Two independent
 * sources agreeing is why statutoryCover is "none" here rather than a guess.
 *
 * Their joining dates on the staff record corroborate the vouchers: Nihal Rajak
 * joined 22-Jul-2026 and his July voucher reads "9 days month of July".
 *
 * Dry run unless --commit.
 */
import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

const { createClient } = await import("@supabase/supabase-js");
const { computeStructureAmounts, resolveStructureForStaff } = await import("../src/lib/salarySetup");

const commit = process.argv.includes("--commit");

/**
 * name → the full-month pay the vouchers show, and the voucher(s) it came from.
 * `expectedNet` is a guard, not an input: the structure must already produce it.
 */
const FROM_VOUCHERS: Record<
  string,
  { basic: number; expectedNet: number; evidence: string }
> = {
  "RANDHIR SINGH": {
    basic: 12000,
    expectedNet: 12000,
    evidence: "voucher 592 (12-Sep-2026, UPI, Aug 2026) Basic 12,000, no deductions; voucher 568 (Jul, cash) 12,000",
  },
  "NIHAL RAJAK": {
    basic: 13000,
    expectedNet: 13000,
    evidence: "voucher 593 (12-Sep-2026, UPI, Aug 2026) Basic 13,000, no deductions",
  },
  "SANJAY PRATAP": {
    basic: 13000,
    expectedNet: 13000,
    evidence: "voucher 595 (12-Sep-2026, UPI, Aug 2026) Basic 13,000 less 1,300 absent",
  },
  "SHREYA SHARMA": {
    basic: 13000,
    expectedNet: 13000,
    evidence: "voucher 596 (12-Sep-2026, UPI, Aug 2026) Basic 13,000 less advance and absent",
  },
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Supabase tenant not configured — check .env.local");
  process.exit(1);
}
const sb = createClient(url, key);

const staffRes = await sb.from("sis_staff").select("*").limit(2000);
if (staffRes.error) throw staffRes.error;

const stateRes = await sb.from("salary_setup_state").select("tenant_id,state,updated_at").limit(10);
if (stateRes.error) throw stateRes.error;
if ((stateRes.data ?? []).length !== 1) {
  console.error(`Expected exactly one salary_setup_state row, found ${(stateRes.data ?? []).length}.`);
  process.exit(1);
}
const row = stateRes.data![0] as { tenant_id: string; state: Record<string, unknown>; updated_at: string };
const state = row.state as { structures: { id: string; name: string }[]; staffLinks: Record<string, unknown>[]; statutory?: unknown };

console.log(`tenant ${row.tenant_id} · state last written ${row.updated_at}`);
console.log(commit ? "COMMIT\n" : "dry run\n");

const linked = new Set(state.staffLinks.map((l) => String(l.staffId)));
const nextLinks = [...state.staffLinks];
const added: string[] = [];
const blocked: string[] = [];

for (const s of staffRes.data ?? []) {
  const staff = s as Record<string, unknown>;
  const name = String(staff.full_name ?? "").toUpperCase();
  const plan = FROM_VOUCHERS[name];
  if (!plan) continue;

  if (linked.has(String(staff.id))) {
    blocked.push(`${name}: already has a salary assignment — not touched`);
    continue;
  }
  if (staff.status !== "active") {
    blocked.push(`${name}: not active (${String(staff.status)})`);
    continue;
  }

  // Let the app pick the structure exactly as payroll would, rather than
  // hard-coding an id that could be renamed or deactivated later.
  const profile = (staff.profile ?? {}) as Record<string, unknown>;
  const structure = resolveStructureForStaff(state as never, {
    id: String(staff.id),
    empCode: String(staff.emp_code ?? ""),
    fullName: String(staff.full_name ?? ""),
    stream: String(staff.stream ?? ""),
  } as never);
  if (!structure) {
    blocked.push(`${name}: no active structure for stream "${String(staff.stream)}"`);
    continue;
  }

  const joining = String(profile.joiningDate ?? profile.dateOfJoining ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joining)) {
    blocked.push(`${name}: no joining date on the staff record — the office must supply one`);
    continue;
  }

  // The vouchers say what a full month pays. If the structure would produce
  // something else, the structure is wrong for this person and a human should
  // look — this script will not paper over it with an override.
  const amounts = computeStructureAmounts(
    state as never,
    structure as never,
    plan.basic,
    "none",
    state.statutory as never,
    null,
    false,
  );
  const net = amounts.gross - amounts.totalDeductions;
  if (net !== plan.expectedNet) {
    blocked.push(
      `${name}: structure "${structure.name}" would pay ₹${net.toLocaleString("en-IN")} but the vouchers show ₹${plan.expectedNet.toLocaleString("en-IN")} — check the structure`,
    );
    continue;
  }

  nextLinks.push({
    staffId: String(staff.id),
    structureId: structure.id,
    basicOverride: plan.basic,
    statutoryCover: "none",
    additionalAmount: 0,
    additionalLabel: "",
    statutoryGrossUp: false,
    effectiveFrom: joining,
    salaryAccountNote: "",
  });
  added.push(
    `${name.padEnd(16)} ${String(staff.emp_code).padEnd(8)} ${String(staff.stream).padEnd(13)} basic ₹${String(plan.basic).padStart(6)}  from ${joining}  ${structure.name}\n${"".padEnd(17)}${plan.evidence}`,
  );
}

if (added.length) {
  console.log(`adding ${added.length} salary assignment(s):\n`);
  for (const a of added) console.log(`  ${a}\n`);
} else {
  console.log("nothing to add.\n");
}
if (blocked.length) {
  console.log(`not touched (${blocked.length}):`);
  for (const b of blocked) console.log(`  · ${b}`);
  console.log();
}

if (!commit) {
  console.log("Dry run — nothing written. Re-run with --commit to apply.");
  process.exit(0);
}
if (!added.length) process.exit(0);

const updatedAt = new Date().toISOString();
const write = await sb
  .from("salary_setup_state")
  .update({ state: { ...state, staffLinks: nextLinks }, updated_at: updatedAt })
  .eq("tenant_id", row.tenant_id)
  .eq("updated_at", row.updated_at) // refuse if someone saved while we planned
  .select("tenant_id");
if (write.error) throw write.error;
if (!write.data?.length) {
  console.error("\nRefused: the salary setup changed while this script was planning. Re-run it.");
  process.exit(1);
}
console.log(`\nWritten. salary_setup_state.updated_at = ${updatedAt}`);
console.log("Reload Masters → Salary in every open browser to pull the new state.");
