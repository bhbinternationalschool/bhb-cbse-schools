import assert from "node:assert/strict";

import {
  admissionsKbChunks,
  kbEntriesFromFeeMasters,
  kbEntryIsLive,
  mergeFeeEntries,
  normalizeAdmissionsKb,
  removeKbEntry,
  upsertKbEntry,
} from "./admissionsKb";
import type { MastersState } from "./masters";

console.log("admissionsKb.selftest.ts");

// Normalize: garbage kinds → other, blanks dropped, duplicate ids dropped, publicSafe defaults true.
{
  const s = normalizeAdmissionsKb({
    entries: [
      { id: "a", kind: "fee", title: "Fees", body: "x" },
      { id: "a", kind: "fee", title: "dup", body: "y" },
      { id: "b", kind: "bogus", title: "", body: "" },
      { id: "c", kind: "bogus", title: "T", body: "B", validTill: "31-03-2027", publicSafe: false },
    ],
  });
  assert.equal(s.entries.length, 2);
  assert.equal(s.entries[0].title, "Fees");
  assert.equal(s.entries[0].publicSafe, true);
  assert.equal(s.entries[1].kind, "other", "unknown kind → other, never guessed");
  assert.equal(s.entries[1].validTill, "", "bad date → no expiry, not a guessed one");
  assert.equal(s.entries[1].publicSafe, false);
}

// Upsert requires title + body; update keeps id.
{
  const base = normalizeAdmissionsKb({});
  const bad = upsertKbEntry(base, { title: "", body: "", by: "t" });
  assert.equal(bad.ok, false);
  const r1 = upsertKbEntry(base, { kind: "process", title: "Steps", body: "1. Enquire 2. Register", by: "t" });
  assert.ok(r1.ok);
  if (!r1.ok) throw new Error();
  const r2 = upsertKbEntry(r1.state, { id: r1.entry.id, kind: "process", title: "Steps", body: "changed", by: "t" });
  assert.ok(r2.ok);
  if (!r2.ok) throw new Error();
  assert.equal(r2.state.entries.length, 1);
  assert.equal(r2.state.entries[0].body, "changed");
  assert.equal(removeKbEntry(r2.state, r1.entry.id).entries.length, 0);
}

// Live = public + not expired; chunks only from live entries and carry scope/validity.
{
  const today = "2026-08-19";
  const s = normalizeAdmissionsKb({
    entries: [
      { id: "live", kind: "dates", title: "Last date", body: "30 Sep", validTill: "2026-09-30", classScope: "Nursery–5" },
      { id: "expired", kind: "dates", title: "Old date", body: "gone", validTill: "2026-01-01" },
      { id: "private", kind: "usp", title: "Internal", body: "staff only", publicSafe: false },
    ],
  });
  assert.equal(kbEntryIsLive(s.entries[0], today), true);
  assert.equal(kbEntryIsLive(s.entries[1], today), false);
  assert.equal(kbEntryIsLive(s.entries[2], today), false);
  const chunks = admissionsKbChunks(s, today);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].id, "live");
  assert.match(chunks[0].title, /^Dates & deadlines: Last date$/);
  assert.match(chunks[0].content, /Applies to: Nursery–5/);
  assert.match(chunks[0].content, /Valid till: 2026-09-30/);
  assert.match(chunks[0].content, /30 Sep$/);
}

// Fee import: verbatim from published NEW-admission lines; no structure → no entries; replaces only fee_masters entries.
{
  const masters = {
    classes: [
      { id: "c1", name: "Class 1", isActive: true, sortOrder: 1 },
      { id: "c2", name: "Class 2", isActive: true, sortOrder: 2 },
    ],
    feeGroups: [
      { id: "g1", name: "New admission 2026-27", academicYearCode: "2026-27", classIds: ["c1"], studentType: "NEW", isActive: true, structurePublishedAt: "2026-04-01" },
    ],
    feeHeads: [
      { id: "h1", nameEn: "Admission fee", sortOrder: 1 },
      { id: "h2", nameEn: "Tuition (Q1)", sortOrder: 2 },
    ],
    installments: [{ id: "i1", label: "Apr–Jun" }],
    feeStructureLines: [
      { feeGroupId: "g1", feeHeadId: "h1", classId: null, installmentId: null, amountPaise: 500000 },
      { feeGroupId: "g1", feeHeadId: "h2", classId: "c1", installmentId: "i1", amountPaise: 1200000 },
    ],
  } as unknown as MastersState;
  const fees = kbEntriesFromFeeMasters(masters, "2026-27", "tester");
  assert.equal(fees.length, 1, "only the class with a structure");
  assert.equal(fees[0].kind, "fee");
  assert.equal(fees[0].source, "fee_masters");
  assert.match(fees[0].body, /Admission fee: ₹5,000/);
  assert.match(fees[0].body, /Tuition \(Q1\): ₹12,000 \(Apr–Jun\)/);
  assert.match(fees[0].body, /Total: ₹17,000/);
  assert.equal(kbEntriesFromFeeMasters(masters, "2027-28", "t").length, 0, "no structure → nothing invented");

  const manual = normalizeAdmissionsKb({ entries: [{ id: "m", kind: "fee", title: "Manual fee note", body: "x", source: "manual" }, { ...fees[0], body: "old" }] });
  const merged = mergeFeeEntries(manual, fees);
  assert.equal(merged.entries.length, 2);
  assert.ok(merged.entries.some((e) => e.id === "m"), "manual entry kept");
  assert.equal(merged.entries.find((e) => e.source === "fee_masters")?.body, fees[0].body, "fee_masters entry replaced");
}

console.log("OK — admissionsKb.selftest.ts");
