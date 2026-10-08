/**
 * Run: npx tsx src/lib/udiseStudentsCheck.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeStudent, type SisStudent } from "@/lib/sis";
import { checkPageChildren } from "@/lib/udiseStudentsCheck";

const st = (p: Partial<SisStudent>) => normalizeStudent({ id: "x", admissionNo: "A", fullName: "X", status: "active", ...p } as SisStudent);
const all = [
  st({ id: "1", fullName: "RIYA SINGH", pen: "11111111111", academicYearCode: "2026-27", dob: "2018-02-01" }),
  st({ id: "2a", fullName: "MOHAN LAL", pen: "22222222222", academicYearCode: "2024-25" }),
  st({ id: "2b", fullName: "MOHAN LAL", pen: "22222222222", academicYearCode: "2025-26", status: "inactive" }),
  st({ id: "3", fullName: "ANU DEVI", pen: "", academicYearCode: "2026-27", dob: "2019-05-05" }),
  st({ id: "4", fullName: "ANU KUMARI", pen: "", academicYearCode: "2025-26", dob: "2019-05-05" }),
];
const cls = () => "III A";
const [a, b, c, d, e] = checkPageChildren(
  [{ pen: "11111111111" }, { pen: "22222222222" }, { pen: "99999999999" }, { name: "Anu", dob: "05/05/2019" }, { name: "ANU DEVI", dob: "05/05/2019" }],
  all,
  "2026-27",
  cls,
);
assert.equal(a!.verdict, "studying_here", "active this session = do not release");
assert.equal(b!.verdict, "left");
assert.match(b!.detail, /2025-26/);
assert.equal(c!.verdict, "not_in_erp");
assert.equal(d!.verdict, "unsure", "two ERP children fit a bare first name + birth date");
assert.equal(e!.verdict, "unsure", "first-name match still finds both; never a guess");
console.log("udiseStudentsCheck selftest: ok");
