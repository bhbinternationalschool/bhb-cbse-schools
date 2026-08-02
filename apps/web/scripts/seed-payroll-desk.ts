#!/usr/bin/env npx tsx
/**
 * Seed payroll_desk_* — one draft bulk run for the current month from staff roster.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-payroll-desk.ts
 */

import { DEFAULT_AY } from "../src/lib/masters";
import type {
  PayrollAuditEntry,
  PayrollRun,
  PayrollStaffLine,
  PayrollState,
} from "../src/lib/payroll";
import { fetchStaffRemoteServer } from "../src/lib/staffPersistence";
import {
  fetchPayrollDeskFromDb,
  pushPayrollDeskToDb,
} from "../src/lib/payrollNormalized.server";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sampleLine(staff: {
  id: string;
  empCode?: string;
  fullName?: string;
  stream?: string;
}): PayrollStaffLine {
  return {
    staffId: staff.id,
    empCode: staff.empCode || staff.id,
    fullName: staff.fullName || "Staff",
    stream: staff.stream || "teaching",
    structureId: "struct_seed",
    structureName: "Default structure",
    daysPresent: 26,
    daysAbsent: 0,
    daysHalf: 0,
    daysLeavePaid: 2,
    daysLwp: 0,
    daysHoliday: 2,
    latePenalty: 0,
    lwpDeduction: 0,
    components: [
      {
        headId: "head_basic",
        headCode: "BASIC",
        headName: "Basic",
        kind: "earning",
        amount: 25000,
      },
      {
        headId: "head_pf",
        headCode: "PF",
        headName: "PF",
        kind: "deduction",
        amount: 1800,
      },
    ],
    gross: 25000,
    totalDeductions: 1800,
    employerCost: 2000,
    netPay: 23200,
    juneHold: false,
    eligibleForJuneDraw: true,
    amountPayable: 23200,
    holdNote: "",
    statutoryCover: "both",
    pfGovtDeposit: 3600,
    esicGovtDeposit: 0,
    bonus: 0,
    specialDeduction: 0,
    specialDeductionLabel: "",
    advanceTaken: 0,
    advanceDeduct: 0,
    advanceNewWithSalary: 0,
    paymentDate: "",
    paymentMode: "bank_transfer",
    note: "",
  };
}

async function main() {
  const month = currentMonth();
  const ay = DEFAULT_AY;
  const staffRemote = await fetchStaffRemoteServer();
  const staffList = staffRemote?.staff?.filter((s) => s.status === "active") ?? [];
  if (!staffList.length) {
    throw new Error("No active staff — seed staff desk first.");
  }

  const lines = staffList.slice(0, 3).map(sampleLine);
  const runId = "prun_seed_draft";
  const run: PayrollRun = {
    id: runId,
    academicYearCode: ay,
    month,
    dayCount: 30,
    kind: "bulk",
    status: "draft",
    lines,
    createdBy: "seed-payroll-desk",
    createdAt: nowIso(),
    submittedBy: "",
    submittedAt: "",
    approvedBy: "",
    approvedAt: "",
    postedBy: "",
    postedAt: "",
    paidBy: "",
    paidAt: "",
    remark: "Seeded draft payroll run for desk cutover",
    submissionNote: "",
    rejectionNote: "",
    rejectedBy: "",
    rejectedAt: "",
    lockVersion: 0,
  };

  const audit: PayrollAuditEntry[] = [
    {
      id: "paud_seed_create",
      at: nowIso(),
      by: "seed-payroll-desk",
      action: "draft_created",
      runId,
      month,
      academicYearCode: ay,
      detail: `Draft bulk run for ${lines.length} staff`,
    },
  ];

  const state: PayrollState = { version: 2, runs: [run], audit };

  console.log(`Seeding 1 draft run (${month}) with ${lines.length} staff lines`);

  const before = await fetchPayrollDeskFromDb();
  console.log(`DB before: ${before.bundle.runs.length} runs`);

  const result = await pushPayrollDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchPayrollDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.runs.length} runs, ${after.meta?.lineCount ?? 0} lines, ${after.meta?.draftCount ?? 0} drafts`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
