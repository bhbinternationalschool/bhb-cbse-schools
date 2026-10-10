import assert from "node:assert/strict";
import type { ClassSubjectLink, Subject } from "./foundationMasters";
import type { SchoolClass } from "./masters";
import { applySubjectRequest, subjectRequestError, suggestSubjectCode, type SubjectRequest } from "./subjectRequests";
import type { SubjectsSlice } from "./subjectMasters";

console.log("subjectRequests.selftest.ts");

const sub = (id: string, code: string, nameEn: string, parentId: string | null = null, isActive = true): Subject =>
  ({ id, code, nameEn, category: "scholastic", coScholasticArea: "", parentId, isElective: false, isActive, sortOrder: 1, ncfTagId: "A" }) as unknown as Subject;
const cls = (id: string, name: string): SchoolClass => ({ id, name, sortOrder: 1, isActive: true }) as SchoolClass;
const lnk = (id: string, classId: string, subjectId: string): ClassSubjectLink => ({ id, classId, subjectId, periodsPerWeek: 5, isActive: true });

const slice: SubjectsSlice = {
  classes: [cls("c7", "VII"), cls("c8", "VIII")],
  subjects: [sub("eng", "ENG", "English"), sub("engo", "ENG-ORAL", "English — Oral", "eng"), sub("hin", "HIN", "Hindi"), sub("sans", "SANS", "Sanskrit"), sub("old", "OLD", "Old subject", null, false)],
  classSubjects: [lnk("l1", "c7", "eng"), lnk("l2", "c7", "engo"), lnk("l3", "c7", "hin")],
};
const opts = { allowedClassIds: new Set(["c7"]), pending: [] as SubjectRequest[] };

// Filing.
assert.equal(subjectRequestError(slice, { classId: "c7", action: "add", subjectId: "sans" }, opts), null);
assert.match(subjectRequestError(slice, { classId: "c8", action: "add", subjectId: "sans" }, opts)!, /classes you teach/);
assert.match(subjectRequestError(slice, { classId: "c7", action: "add", subjectId: "hin" }, opts)!, /already studies Hindi/);
assert.match(subjectRequestError(slice, { classId: "c7", action: "add", subjectId: "old" }, opts)!, /switched off/);
assert.match(subjectRequestError(slice, { classId: "c7", action: "remove", subjectId: "sans" }, opts)!, /does not study Sanskrit/);
assert.match(subjectRequestError(slice, { classId: "c7", action: "new", subjectName: "sanskrit" }, opts)!, /already a school subject/);
assert.equal(subjectRequestError(slice, { classId: "c7", action: "new", subjectName: "Computer" }, opts), null);
const pending = { allowedClassIds: "all" as const, pending: [{ status: "pending", classId: "c7", action: "add", subjectId: "sans", subjectName: "Sanskrit", staffName: "NEHA" } as SubjectRequest] };
assert.match(subjectRequestError(slice, { classId: "c7", action: "add", subjectId: "sans" }, pending)!, /already waiting.*NEHA/);

const req = (over: Partial<SubjectRequest>): SubjectRequest =>
  ({ id: "r", staffId: "s", staffName: "T", classId: "c7", className: "VII", action: "add", subjectId: "", subjectName: "", reason: "", status: "pending", decidedBy: "", decidedAt: "", decisionNote: "", createdAt: "" , ...over });

// Approving: remove takes the component's link too; nothing else moves.
const rm = applySubjectRequest(slice, req({ action: "remove", subjectId: "eng" }));
assert.ok(rm.ok);
assert.deepEqual(rm.ok && rm.classSubjects.map((l) => l.id), ["l3"]);
assert.equal(rm.ok && rm.subjects, slice.subjects, "subjects untouched");

// Add a component to a class without its subject → the subject comes too.
const add = applySubjectRequest(slice, req({ classId: "c8", action: "add", subjectId: "engo" }));
assert.ok(add.ok);
assert.deepEqual(add.ok && add.classSubjects.filter((l) => l.classId === "c8").map((l) => l.subjectId), ["eng", "engo"]);

// New subject: needs a valid unique code, then exists and is linked.
assert.equal(applySubjectRequest(slice, req({ action: "new", subjectName: "Computer" }), { newCode: "ENG" }).ok, false, "code clash");
const nw = applySubjectRequest(slice, req({ action: "new", subjectName: "Computer" }), { newCode: "COMP" });
assert.ok(nw.ok);
const created = nw.ok ? nw.subjects.find((s) => s.code === "COMP") : undefined;
assert.ok(created && nw.ok && nw.classSubjects.some((l) => l.classId === "c7" && l.subjectId === created.id));

// Masters changed since the request: re-checked, not applied twice.
assert.equal(applySubjectRequest(slice, req({ action: "add", subjectId: "hin" })).ok, false);

assert.equal(suggestSubjectCode(slice.subjects, "Computer Science"), "COMPUTER-SCIENCE");
assert.equal(suggestSubjectCode(slice.subjects, "English"), "ENGLISH");
assert.equal(suggestSubjectCode([...slice.subjects, sub("x", "ENGLISH", "x")], "English"), "ENGLISH-2");

console.log("subjectRequests.selftest: all assertions passed");
