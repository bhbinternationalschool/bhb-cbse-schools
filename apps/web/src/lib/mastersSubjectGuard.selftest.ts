import assert from "node:assert/strict";
import { guardSubjectsOverwrite } from "./mastersWriteGuard";

console.log("mastersSubjectGuard.selftest.ts");
const ids = (n: number, p = "sub_") => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));

// 10 Oct 2026: 35 subjects replaced by 35 others under new ids — refused.
assert.equal(guardSubjectsOverwrite({ subjects: ids(35) }, { subjects: ids(35, "new_") }).allow, false);
// Deleting one subject, or adding some, is an edit.
assert.equal(guardSubjectsOverwrite({ subjects: ids(35) }, { subjects: ids(34) }).allow, true);
assert.equal(guardSubjectsOverwrite({ subjects: ids(35) }, { subjects: [...ids(35), { id: "x" }] }).allow, true);
// Class links: 140 cut to 30 — refused; removing a class's few links — fine.
assert.equal(guardSubjectsOverwrite({ classSubjects: ids(140, "c") }, { classSubjects: ids(30, "c") }).allow, false);
assert.equal(guardSubjectsOverwrite({ classSubjects: ids(140, "c") }, { classSubjects: ids(132, "c") }).allow, true);
// A save that does not carry the list is not judged on it.
assert.equal(guardSubjectsOverwrite({ subjects: ids(35) }, {}).allow, true);
console.log("mastersSubjectGuard.selftest: all assertions passed");
