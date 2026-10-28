/**
 * What a class teacher may change, and the checks.
 * Run: npx tsx src/lib/sisClassTeacher.selftest.ts
 */
import { cleanClassTeacherPatch, mobile10 } from "./sisClassTeacher";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const today = "2026-09-29";
const ok = (kind: "student" | "household", p: Record<string, unknown>) => {
  const r = cleanClassTeacherPatch(kind, p, today);
  return r.ok ? r.values : `ERR ${r.error}`;
};

// Numbers are normalised to 10 digits; +91 / 0 prefixes accepted.
expect("mobile +91", mobile10("+91 98765-43210"), "9876543210");
expect("mobile 0", mobile10("09876543210"), "9876543210");
expect("mobile bad", mobile10("12345"), null);
expect("wa number", ok("household", { whatsappMobile: "+91 98391 24567" }), { whatsappMobile: "9839124567" });
// A placeholder is never a family's number (PR #377), on any mobile field.
for (const ph of ["0000000000", "9999999999", "+91 99999 99999", "9876543210", "1234567890", "6666666666"]) {
  expect(`wa placeholder ${ph}`, String(ok("household", { whatsappMobile: ph })).startsWith("ERR"), true);
}
expect("father placeholder", String(ok("student", { fatherMobile: "8888888888" })).startsWith("ERR"), true);
expect("wa not a number", typeof ok("household", { whatsappMobile: "98765" }), "string");
expect("wa cleared refused", String(ok("household", { whatsappMobile: "" })).startsWith("ERR"), true);

// Office-owned fields cannot be sent at all.
for (const k of ["classId", "sectionId", "status", "admissionNo", "feeGroupId", "aadhaarLast4", "pen", "apaarId", "docs", "photoUrl"]) {
  expect(`office field ${k}`, String(ok("student", { [k]: "x" })).includes("office"), true);
}

// Date of birth: ISO, real, school age.
expect("dob ok", ok("student", { dob: "2016-05-14" }), { dob: "2016-05-14" });
expect("dob swapped day/month", String(ok("student", { dob: "2016-14-05" })).startsWith("ERR"), true);
expect("dob 31 Feb", String(ok("student", { dob: "2016-02-31" })).startsWith("ERR"), true);
expect("dob adult", String(ok("student", { dob: "1990-01-01" })).startsWith("ERR"), true);
expect("dob blank allowed", ok("student", { dob: "" }), { dob: "" });

// Other fields.
expect("name trimmed", ok("student", { fullName: "  Arushi   Yadav " }), { fullName: "Arushi Yadav" });
expect("name empty", String(ok("student", { fullName: " " })).startsWith("ERR"), true);
expect("gender", String(ok("student", { gender: "X" })).startsWith("ERR"), true);
expect("blood group", ok("student", { bloodGroup: "B+" }), { bloodGroup: "B+" });
expect("pincode", String(ok("household", { pincode: "22100" })).startsWith("ERR"), true);
expect("father mobile", ok("student", { fatherMobile: "9839124567" }), { fatherMobile: "9839124567" });
expect("nothing", String(ok("student", {})).startsWith("ERR"), true);

if (failed) {
  console.error(`sisClassTeacher: ${failed} failure(s)`);
  process.exit(1);
}
console.log("sisClassTeacher: ok");
