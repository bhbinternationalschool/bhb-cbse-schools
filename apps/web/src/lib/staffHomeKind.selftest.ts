/**
 * staffHomeKind — the live roster's designations must land on the right home.
 * Run: npx tsx src/lib/staffHomeKind.selftest.ts
 */
import { staffHomeKind, staffHomePath, isSchoolWideKind } from "./staffHomeKind";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (got !== want) {
    failed += 1;
    console.error(`FAIL ${label}: got ${String(got)}, want ${String(want)}`);
  }
}

const base = { roleCode: "teacher", designation: "", stream: "", teachesClasses: false };

// Every designation on the 2026-09 roster, with the role code login mints.
const cases: [string, string, string, boolean, string][] = [
  ["Teacher", "teacher", "teaching", false, "teaching"],
  ["TGT", "teacher", "teaching", true, "teaching"],
  ["PPRT", "teacher", "teaching", false, "teaching"],
  ["Sports Teacher", "teacher", "teaching", false, "teaching"],
  ["Driver", "driver", "non_teaching", false, "crew"],
  ["Transport Attendent", "transport", "non_teaching", false, "crew"],
  ["VEHICLE PROVIDER", "teacher", "non_teaching", false, "crew"],
  ["Director", "teacher", "", false, "leadership"],
  ["Principal", "principal", "teaching", false, "leadership"],
  ["Accountant", "accounts", "non_teaching", false, "office"],
  ["Counsellor", "teacher", "non_teaching", false, "office"],
  ["Computer Operator", "teacher", "non_teaching", false, "office"],
  ["Sweeper", "teacher", "non_teaching", false, "support"],
  ["Gardner", "teacher", "non_teaching", false, "support"],
  ["Peon", "teacher", "non_teaching", false, "support"],
  ["", "teacher", "", false, "support"],
  ["", "teacher", "teaching", false, "teaching"],
  ["", "teacher", "", true, "teaching"],
  ["", "owner", "", false, "leadership"],
  ["", "admin", "", false, "leadership"],
  ["Office Clerk", "office", "non_teaching", false, "office"],
  ["Transport Incharge", "transport", "non_teaching", false, "office"],
];
for (const [designation, roleCode, stream, teaches, want] of cases) {
  expect(
    `kind(${designation || "(none)"}/${roleCode}/${stream || "-"}/${teaches})`,
    staffHomeKind({ ...base, designation, roleCode, stream, teachesClasses: teaches }),
    want,
  );
}

expect("path leadership", staffHomePath("leadership"), "/principal");
expect("path crew", staffHomePath("crew"), "/driver");
expect("path teaching", staffHomePath("teaching"), "/staff");
expect("path office", staffHomePath("office"), "/desk");
expect("path support", staffHomePath("support"), "/desk");
expect("school-wide leadership", isSchoolWideKind("leadership"), true);
expect("school-wide office", isSchoolWideKind("office"), true);
expect("school-wide teaching", isSchoolWideKind("teaching"), false);

if (failed) {
  console.error(`staffHomeKind selftest: ${failed} failure(s)`);
  process.exit(1);
}
console.log("staffHomeKind selftest: ok");
