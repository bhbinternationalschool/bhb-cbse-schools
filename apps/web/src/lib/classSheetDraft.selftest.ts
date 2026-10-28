/**
 * Run: npx tsx src/lib/classSheetDraft.selftest.ts
 */
import assert from "node:assert/strict";
import {
  editEntry,
  freshEntries,
  reconcileEntries,
  rowState,
  saveRows,
  type SheetRecordRow,
} from "@/lib/classSheetDraft";
import type { SheetGroup } from "@/lib/classDetailsSheet";

function rec(id: string, revisionAt: string, over: Partial<{
  heightCm: string;
  weightKg: string;
  bloodGroup: string;
  motherTongue: string;
  religion: string;
  category: string;
  fatherQualification: string;
  motherQualification: string;
  isCwsn: boolean;
}> = {}): SheetRecordRow {
  return {
    id,
    revisionAt,
    fields: {
      fullName: id,
      bloodGroup: over.bloodGroup ?? "",
      motherTongue: over.motherTongue ?? "",
      religion: over.religion ?? "",
      category: over.category ?? "",
    },
    measure: { heightCm: over.heightCm ?? "", weightKg: over.weightKg ?? "", measuredOn: "" },
    sheet: {
      fatherQualification: over.fatherQualification ?? "",
      motherQualification: over.motherQualification ?? "",
      isCwsn: over.isCwsn ?? false,
    },
  };
}

const ALL: SheetGroup[] = ["measure", "blood", "family", "education", "cwsn"];
const states = (rows: SheetRecordRow[], e: ReturnType<typeof freshEntries>, g: SheetGroup[] = ALL) =>
  rows.map((r) => rowState(r, e[r.id], g));

// ── Opening the sheet changes nothing; "B(+)" shows as B+ and is not a change.
{
  const rows = [rec("a", "r1", { bloodGroup: "B(+)", religion: "HINDU" })];
  const e = freshEntries(rows);
  assert.equal(e.a.draft.bloodGroup, "B+");
  assert.deepEqual(saveRows(states(rows, e)), [], "nothing typed → nothing sent");
}

// ── Only changed keys are sent.
{
  const rows = [rec("a", "r1", { religion: "HINDU", category: "OBC", motherTongue: "HINDI" })];
  let e = freshEntries(rows);
  e = { ...e, a: editEntry(e.a, { category: "SC" }) };
  assert.deepEqual(saveRows(states(rows, e)), [{ id: "a", revisionAt: "r1", values: { category: "SC" } }]);
  // A group not chosen is not sent even when typed in.
  assert.deepEqual(saveRows(states(rows, e, ["measure", "blood"])), []);
}

// ── Height and weight travel together.
{
  const rows = [rec("a", "r1", { heightCm: "110", weightKg: "18" })];
  let e = freshEntries(rows);
  e = { ...e, a: editEntry(e.a, { heightCm: "112" }) };
  assert.deepEqual(saveRows(states(rows, e)), [
    { id: "a", revisionAt: "r1", values: { heightCm: "112", weightKg: "18" } },
  ]);
}

// ── Each child carries its own revisionAt; another child's values never travel with it.
{
  const rows = [rec("a", "rev-a"), rec("b", "rev-b"), rec("c", "rev-c")];
  let e = freshEntries(rows);
  e = { ...e, a: editEntry(e.a, { bloodGroup: "O+" }), c: editEntry(e.c, { religion: "SIKH" }) };
  assert.deepEqual(saveRows(states(rows, e)), [
    { id: "a", revisionAt: "rev-a", values: { bloodGroup: "O+" } },
    { id: "c", revisionAt: "rev-c", values: { religion: "SIKH" } },
  ]);
}

// ── Refusal: someone else saved the child in between. The teacher chose
//    family + blood, typed only the category. The other person changed the
//    religion and blood group. After the re-read the untouched boxes take
//    the newer record; the typed category is kept; the second Save sends
//    only the category, with the NEW revisionAt.
{
  const before = [rec("a", "r1", { religion: "HINDU", category: "GEN", motherTongue: "HINDI", bloodGroup: "" })];
  let e = freshEntries(before);
  e = { ...e, a: editEntry(e.a, { category: "OBC" }) };
  // Server said conflict; the list is re-read.
  const after = [rec("a", "r2", { religion: "MUSLIM", category: "GEN", motherTongue: "URDU", bloodGroup: "A+" })];
  e = reconcileEntries(e, after);
  assert.equal(e.a.draft.religion, "MUSLIM", "untouched field takes the newer value");
  assert.equal(e.a.draft.motherTongue, "URDU", "untouched field takes the newer value");
  assert.equal(e.a.draft.bloodGroup, "A+", "untouched field takes the newer value");
  assert.equal(e.a.draft.category, "OBC", "touched field kept");
  assert.deepEqual(e.a.conflicts, {}, "category did not change underneath — no conflict");
  assert.deepEqual(saveRows(states(after, e, ["family", "blood"])), [
    { id: "a", revisionAt: "r2", values: { category: "OBC" } },
  ], "never resends the stale religion / mother tongue / blood group");
}

// ── The stale-measure trap: the teacher typed only weight; someone else saved
//    a newer height. The pair goes together — with the NEWER height.
{
  const before = [rec("a", "r1", { heightCm: "110", weightKg: "18" })];
  let e = freshEntries(before);
  e = { ...e, a: editEntry(e.a, { weightKg: "19" }) };
  const after = [rec("a", "r2", { heightCm: "115", weightKg: "18" })];
  e = reconcileEntries(e, after);
  assert.deepEqual(saveRows(states(after, e)), [
    { id: "a", revisionAt: "r2", values: { heightCm: "115", weightKg: "19" } },
  ]);
}

// ── A typed value whose record changed underneath is kept and flagged.
{
  const before = [rec("a", "r1", { religion: "HINDU" })];
  let e = freshEntries(before);
  e = { ...e, a: editEntry(e.a, { religion: "JAIN" }) };
  const after = [rec("a", "r2", { religion: "SIKH" })];
  e = reconcileEntries(e, after);
  assert.equal(e.a.draft.religion, "JAIN", "the teacher's typed value is kept");
  assert.deepEqual(e.a.conflicts, { religion: "SIKH" }, "shown as conflicting, with the newer value");
  const s = states(after, e);
  assert.deepEqual(s[0].conflicts, { religion: "SIKH" });
  // Typing again settles it.
  e = { ...e, a: editEntry(e.a, { religion: "JAIN" }) };
  assert.deepEqual(e.a.conflicts, {});
}

// ── The other person saved the same value the teacher typed: nothing left to send.
{
  const before = [rec("a", "r1", { bloodGroup: "" })];
  let e = freshEntries(before);
  e = { ...e, a: editEntry(e.a, { bloodGroup: "O+" }) };
  const after = [rec("a", "r2", { bloodGroup: "O+" })];
  e = reconcileEntries(e, after);
  assert.deepEqual(e.a.conflicts, {});
  assert.deepEqual(saveRows(states(after, e)), []);
}

// ── A child refused twice: each re-read folds in the newer record again;
//    the conflict and the typed value survive; the last revisionAt is sent.
{
  const r1 = [rec("a", "r1", { religion: "HINDU", category: "GEN", fatherQualification: "" })];
  let e = freshEntries(r1);
  e = { ...e, a: editEntry(e.a, { religion: "JAIN", fatherQualification: "GRADUATE" }) };
  const r2 = [rec("a", "r2", { religion: "SIKH", category: "OBC", fatherQualification: "" })];
  e = reconcileEntries(e, r2);
  assert.deepEqual(e.a.conflicts, { religion: "SIKH" });
  const r3 = [rec("a", "r3", { religion: "SIKH", category: "SC", fatherQualification: "POST GRADUATE" })];
  e = reconcileEntries(e, r3);
  assert.equal(e.a.draft.category, "SC", "untouched follows the newest record, not the middle one");
  assert.equal(e.a.draft.religion, "JAIN");
  assert.equal(e.a.draft.fatherQualification, "GRADUATE");
  assert.deepEqual(e.a.conflicts, { religion: "SIKH", fatherQualification: "POST GRADUATE" });
  assert.deepEqual(saveRows(states(r3, e)), [
    { id: "a", revisionAt: "r3", values: { religion: "JAIN", fatherQualification: "GRADUATE" } },
  ]);
}

// ── Saved: the record's normalised value replaces what was typed ("b+" → "B+",
//    "112.0" → "112"), so a saved child is not left "changed" for ever. A
//    refused sibling in the same round keeps its draft.
{
  const before = [rec("a", "r1", { heightCm: "", weightKg: "" }), rec("b", "r1", { bloodGroup: "" })];
  let e = freshEntries(before);
  e = { ...e, a: editEntry(e.a, { heightCm: "112.0", weightKg: "19", bloodGroup: "b+" }), b: editEntry(e.b, { bloodGroup: "AB-" }) };
  const sent = saveRows(states(before, e));
  const savedA = sent.find((x) => x.id === "a")!.values;
  const after = [rec("a", "r2", { heightCm: "112", weightKg: "19", bloodGroup: "B+" }), rec("b", "r9", { bloodGroup: "" })];
  e = reconcileEntries(e, after, { a: savedA });
  assert.deepEqual(saveRows(states(after, e)), [{ id: "b", revisionAt: "r9", values: { bloodGroup: "AB-" } }]);
  assert.deepEqual(e.a.conflicts, {});
}

// ── A child new to the list starts from its record; a child gone is dropped.
{
  const e = reconcileEntries(freshEntries([rec("a", "r1")]), [rec("b", "r1", { religion: "HINDU" })]);
  assert.deepEqual(Object.keys(e), ["b"]);
  assert.equal(e.b.draft.religion, "HINDU");
}

console.log("classSheetDraft selftest: ok");
