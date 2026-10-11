import assert from "node:assert/strict";
import {
  diffCustomValues,
  isoToDdMmYyyy,
  isoToLongDate,
  matchCustomImportHeaders,
  missingRequiredOnNew,
  normalizeCustomValue,
  parseCustomDate,
  planCustomImport,
  resolveEntityValues,
  studentAliasIds,
  validateDefInput,
  valueForExport,
  valueForInput,
  type CustomFieldDef,
} from "./customFields";

console.log("customFields.selftest.ts");

const def = (over: Partial<CustomFieldDef>): CustomFieldDef => ({
  id: "f1",
  entityType: "student",
  labelEn: "Field",
  labelHi: "",
  fieldType: "text",
  options: [],
  requiredOnNew: false,
  active: true,
  sortOrder: 0,
  updatedAt: "2026-10-11T10:00:00.000000+00:00",
  valueCount: 0,
  ...over,
});

// ── Dates: day first, always; never a guess (erp-dob-parser-corruption) ──
assert.equal(parseCustomDate("08/04/2020"), "2020-04-08", "8 April, not 4 August");
assert.equal(parseCustomDate("8/4/2020"), "2020-04-08");
assert.equal(parseCustomDate("08-04-2020"), "2020-04-08");
assert.equal(parseCustomDate("08.04.2020"), "2020-04-08");
assert.equal(parseCustomDate("2020-04-08"), "2020-04-08", "ISO passes through");
assert.equal(parseCustomDate("04-August-2020"), "2020-08-04", "our own export form reads back");
assert.equal(parseCustomDate("4 Aug 2020"), "2020-08-04");
assert.equal(parseCustomDate("31/12/2019"), "2019-12-31");
assert.equal(parseCustomDate("12/31/2019"), null, "month-first is refused, not swapped");
assert.equal(parseCustomDate("31/02/2020"), null, "no 31 February");
assert.equal(parseCustomDate("29/02/2021"), null, "2021 is not a leap year");
assert.equal(parseCustomDate("29/02/2020"), "2020-02-29");
assert.equal(parseCustomDate("08/04/20"), null, "two-digit year refused");
assert.equal(parseCustomDate(""), null);
assert.equal(parseCustomDate("tomorrow"), null);
// Every ambiguous day/month pair keeps BOTH numbers (the old bug returned day == month).
for (let d = 1; d <= 12; d++) {
  for (let m = 1; m <= 12; m++) {
    const iso = parseCustomDate(`${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/2020`)!;
    assert.equal(iso, `2020-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
}
assert.equal(isoToDdMmYyyy("2020-04-08"), "08/04/2020");
assert.equal(isoToLongDate("2020-04-08"), "08-April-2020");
// Round trips: input form and export form both parse back to the same ISO.
for (const iso of ["2020-04-08", "2019-12-31", "2024-02-29"]) {
  assert.equal(parseCustomDate(isoToDdMmYyyy(iso)), iso);
  assert.equal(parseCustomDate(isoToLongDate(iso)), iso);
}

// ── Values by type ──
const date = def({ fieldType: "date", labelEn: "Joined club" });
assert.deepEqual(normalizeCustomValue(date, "08/04/2020"), { ok: true, value: "2020-04-08" });
assert.equal(normalizeCustomValue(date, "13/13/2020").ok, false);
assert.deepEqual(normalizeCustomValue(date, "  "), { ok: true, value: "" }, "blank is an answer");
const num = def({ fieldType: "number", labelEn: "Locker" });
assert.deepEqual(normalizeCustomValue(num, "1,200"), { ok: true, value: "1200" });
assert.deepEqual(normalizeCustomValue(num, "3.50"), { ok: true, value: "3.5" });
assert.equal(normalizeCustomValue(num, "12a").ok, false);
assert.equal(normalizeCustomValue(num, "1e5").ok, false, "no exponent sneaking through");
const choice = def({ fieldType: "choice", labelEn: "House", options: ["Red", "Blue"] });
assert.deepEqual(normalizeCustomValue(choice, " red "), { ok: true, value: "Red" }, "stored as the option's own spelling");
const bad = normalizeCustomValue(choice, "Green");
assert.ok(!bad.ok && /not one of Red, Blue/.test(bad.error));
const yn = def({ fieldType: "yes_no", labelEn: "Hostel" });
assert.deepEqual(normalizeCustomValue(yn, "Y"), { ok: true, value: "yes" });
assert.deepEqual(normalizeCustomValue(yn, "नहीं"), { ok: true, value: "no" });
assert.equal(normalizeCustomValue(yn, "maybe").ok, false);
const text = def({ fieldType: "text" });
assert.deepEqual(normalizeCustomValue(text, "  two   words "), { ok: true, value: "two words" });
assert.equal(normalizeCustomValue(text, "x".repeat(501)).ok, false);

assert.equal(valueForInput(date, "2020-04-08"), "08/04/2020");
assert.equal(valueForExport(date, "2020-04-08"), "08-April-2020");
assert.equal(valueForExport(yn, "yes"), "Yes");
assert.equal(valueForExport(yn, ""), "");

// ── Required on new ──
const req = def({ id: "r", requiredOnNew: true, labelEn: "Req" });
const reqOff = def({ id: "r2", requiredOnNew: true, active: false });
assert.deepEqual(missingRequiredOnNew([req, reqOff], {}).map((d) => d.id), ["r"], "an inactive field is never demanded");
assert.deepEqual(missingRequiredOnNew([req], { r: " x " }), []);

// ── Definitions ──
const others = [def({ id: "h", labelEn: "House", labelHi: "सदन" })];
assert.ok(validateDefInput({ entityType: "student", labelEn: "Locker no", fieldType: "number" }, others).ok);
assert.match(
  (validateDefInput({ entityType: "student", labelEn: " house ", fieldType: "text" }, others) as { error: string }).error,
  /already uses that name/,
);
assert.match(
  (validateDefInput({ entityType: "student", labelEn: "Hostel", labelHi: "सदन", fieldType: "text" }, others) as { error: string }).error,
  /already uses that name/,
  "Hindi labels clash too (the import matches either)",
);
assert.ok(validateDefInput({ entityType: "staff", labelEn: "House", fieldType: "text" }, others).ok, "staff and students are separate");
assert.ok(validateDefInput({ entityType: "student", labelEn: "House", fieldType: "text" }, others, { id: "h", fieldType: "text", valueCount: 3, entityType: "student" }).ok, "renaming itself is fine");
assert.match(
  (validateDefInput({ entityType: "student", labelEn: "House", fieldType: "number" }, others, { id: "h", fieldType: "text", valueCount: 3, entityType: "student" }) as { error: string }).error,
  /type cannot change/,
);
assert.match(
  (validateDefInput({ entityType: "student", labelEn: "House", fieldType: "number" }, others, { id: "h", fieldType: "text", valueCount: -1, entityType: "student" }) as { error: string }).error,
  /Could not check/,
  "unknown count is not zero",
);
assert.ok(validateDefInput({ entityType: "student", labelEn: "House", fieldType: "number" }, others, { id: "h", fieldType: "text", valueCount: 0, entityType: "student" }).ok);
assert.match((validateDefInput({ entityType: "student", labelEn: "Bus", fieldType: "choice", options: [" ", ""] }, []) as { error: string }).error, /at least one choice/);
const c = validateDefInput({ entityType: "student", labelEn: "Bus", fieldType: "choice", options: ["A", " a ", "B"] }, []);
assert.ok(c.ok && c.def.options.join() === "A,B", "duplicate choices collapse");
const t = validateDefInput({ entityType: "student", labelEn: "Note", fieldType: "text", options: ["x"] }, []);
assert.ok(t.ok && t.def.options.length === 0, "options only for single choice");
assert.match(
  (validateDefInput({ entityType: "student", labelEn: "Admission no", fieldType: "text" }, [], null, (l) => l.toLowerCase() === "admission no") as { error: string }).error,
  /built-in column/,
);
assert.equal(validateDefInput({ entityType: "student", labelEn: "", fieldType: "text" }, []).ok, false);

// ── A child's yearly rows ──
const roster = [
  { id: "s26", admissionNo: "A-101", fullName: "Riya Singh" },
  { id: "s25", admissionNo: "a-101 ", fullName: "RIYA  SINGH" },
  { id: "x", admissionNo: "A-101", fullName: "Other Child" },
];
assert.deepEqual(studentAliasIds(roster, roster[0]!), ["s26", "s25"], "same number AND name; a shared number alone is not the same child");
assert.deepEqual(studentAliasIds(roster, { id: "n", admissionNo: "", fullName: "Riya Singh" }), ["n"]);

const rows = [
  { entityId: "s25", fieldId: "house", value: "Red", updatedAt: "2026-04-01T00:00:00Z" },
  { entityId: "s25", fieldId: "bus", value: "B2", updatedAt: "2026-04-01T00:00:00Z" },
  { entityId: "s26", fieldId: "bus", value: "", updatedAt: "2026-09-01T00:00:00Z" },
];
const resolved = resolveEntityValues(rows, ["s26", "s25"]);
assert.deepEqual(resolved.get("house"), { value: "Red", fromEntityId: "s25", ownStamp: "" }, "last year's answer shows this year");
assert.deepEqual(resolved.get("bus"), { value: "", fromEntityId: "s26", ownStamp: "2026-09-01T00:00:00Z" }, "a blank the office saved on this row is an answer");

// ── Diff: only what changed, with this row's own stamp ──
const defs = [def({ id: "house", labelEn: "House", fieldType: "choice", options: ["Red", "Blue"] }), def({ id: "bus", labelEn: "Bus" }), def({ id: "d", labelEn: "Date", fieldType: "date" })];
let d1 = diffCustomValues("s26", defs, resolved, { house: "Red", bus: "", d: "" });
assert.ok(d1.ok && d1.changes.length === 0, "nothing edited → nothing sent; an inherited value is not copied");
d1 = diffCustomValues("s26", defs, resolved, { house: "blue", bus: "B3", d: "08/04/2020" });
assert.ok(d1.ok);
assert.deepEqual(d1.ok && d1.changes, [
  { entityId: "s26", fieldId: "house", value: "Blue", base: "" },
  { entityId: "s26", fieldId: "bus", value: "B3", base: "2026-09-01T00:00:00Z" },
  { entityId: "s26", fieldId: "d", value: "2020-04-08", base: "" },
]);
const d2 = diffCustomValues("s26", defs, resolved, { house: "Green", d: "31/02/2020" });
assert.ok(!d2.ok && d2.errors.length === 2, "bad values refuse the save");
const d3 = diffCustomValues("s26", defs, resolved, { house: "" });
assert.deepEqual(d3.ok && d3.changes, [{ entityId: "s26", fieldId: "house", value: "", base: "" }], "clearing an inherited value is an explicit blank on this row");

// ── Import ──
const imp = matchCustomImportHeaders(
  ["Admission no", "Student name", "house", "सदन", "Bus", "Unknown"],
  [def({ id: "house", labelEn: "House", labelHi: "सदन" }), def({ id: "bus", labelEn: "Bus" })],
  (h) => ["admission no", "student name", "bus"].includes(h.toLowerCase()),
);
assert.deepEqual(imp.columns.map((c) => [c.index, c.def.id]), [[2, "house"]], "first matching column wins; Hindi duplicate ignored");
assert.deepEqual(imp.shadowed, ["Bus"], "a built-in header is never taken by a custom field");

const houseDef = def({ id: "house", labelEn: "House", fieldType: "choice", options: ["Red", "Blue"] });
const plan = planCustomImport(
  [
    { lineNo: 2, entityId: "s26", cells: [{ def: houseDef, raw: "blue" }] },
    { lineNo: 3, entityId: "s27", cells: [{ def: houseDef, raw: "" }] },
    { lineNo: 4, entityId: "s28", cells: [{ def: houseDef, raw: "Red" }] },
    { lineNo: 5, entityId: "s29", cells: [{ def: houseDef, raw: "Green" }] },
    { lineNo: 6, entityId: null, cells: [{ def: houseDef, raw: "Red" }] },
  ],
  new Map([
    ["s26|house", { value: "Red", updatedAt: "T1" }],
    ["s28|house", { value: "Red", updatedAt: "T2" }],
  ]),
);
assert.deepEqual(plan.changes, [{ entityId: "s26", fieldId: "house", value: "Blue", base: "T1" }], "blank cells and unchanged values send nothing");
assert.deepEqual(plan.errors.map((e) => e.lineNo), [5, 6]);

console.log("customFields.selftest.ts: all assertions passed");
