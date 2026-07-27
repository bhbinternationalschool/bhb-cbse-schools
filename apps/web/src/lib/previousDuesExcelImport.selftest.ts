/**
 * Self-test: Student Wise Fee Details parser.
 * Run: npx tsx apps/web/src/lib/previousDuesExcelImport.selftest.ts
 */

import assert from "node:assert/strict";
import {
  parseStudentWiseFeeSummaryRows,
  summarizePreviousDueRows,
} from "@/lib/previousDuesExcelImport";

const raw: unknown[][] = [
  ["BHB International School"],
  ["Student Wise Summary"],
  [
    "S.no.",
    "Admission No.",
    "Students Name",
    "Class/Section",
    "Student Type",
    "Previous Fee Due",
    "Previous Fee Discount",
    "Previous Fee Received",
    "Previous Fee Pending",
    "Total Previous Fee Pending",
  ],
  [
    "",
    "",
    "",
    "",
    "",
    "Previous Due-2025",
    "Previous Due-2025",
    "Previous Due-2025",
    "Previous Due-2025",
    "",
  ],
  [
    1,
    "BHB-96/2023",
    "AARAV SINGH ",
    "I A",
    "DayScholar",
    19950,
    0,
    0,
    19950,
    19950,
  ],
  [99, "002/2026", "ZERO DUE", "Nursery A", "DayScholar", 0, 0, 0, 0, 0],
];

const rows = parseStudentWiseFeeSummaryRows(raw);
assert.equal(rows.length, 2);
assert.equal(rows[0]!.admissionNo, "BHB-96/2023");
assert.equal(rows[0]!.previousPendingRupees, 19950);
assert.equal(rows[0]!.sourceLabel, "Previous Due-2025");

const summary = summarizePreviousDueRows(rows);
assert.equal(summary.withPending, 1);
assert.equal(summary.totalPendingRupees, 19950);

console.log("previousDuesExcelImport.selftest: ok");
