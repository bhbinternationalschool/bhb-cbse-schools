/**
 * The document type chosen while verifying, and where the document goes.
 * Run: npx tsx src/lib/studentDocTypes.selftest.ts
 */
import assert from "node:assert/strict";
import { emptyStudentDocs, normalizeDocFile, type StudentDocFile, type StudentDocs } from "./sis";
import {
  addCustomDocType,
  applyDocTypePlan,
  BUILT_IN_DOC_TYPES,
  docTypeCatalogue,
  emptyStudentDocTypesState,
  filedEntryFor,
  findDocType,
  normalizeStudentDocTypesState,
  planDocType,
} from "./studentDocTypes";
import { docSlotFor } from "./udiseDocIntakeAi";

const proxy = (slot: string) => `/api/documents/student/s1/${slot}`;
const pending = (slot: string): StudentDocFile => ({
  status: "pending",
  fileName: "card.jpg",
  mimeType: "image/jpeg",
  size: 1000,
  fileUrl: proxy(slot),
  driveFileId: "drv_1",
  uploadedAt: "2026-10-20T04:00:00.000Z",
  submittedBy: "Parent",
  submittedAt: "2026-10-20T04:00:00.000Z",
  reviewedBy: "",
  reviewedAt: "",
  reviewNote: "",
});
const docsWith = (slot: keyof StudentDocs, extra: Partial<StudentDocs> = {}): StudentDocs => ({
  ...emptyStudentDocs(),
  [slot]: pending(slot),
  ...extra,
});
const type = (id: string) => findDocType(emptyStudentDocTypesState(), id)!;
const apply = (docs: StudentDocs, plan: Parameters<typeof applyDocTypePlan>[0]["plan"], id: string) =>
  applyDocTypePlan({ docs, plan, type: type(id), reviewedBy: "Shipra", reviewedAt: "2026-10-20T05:00:00.000Z", note: "", proxyUrl: proxy });

// The catalogue agrees with the WhatsApp intake about where a child's document lives.
assert.equal(type("aadhaar").slot, docSlotFor("aadhaar"));
assert.equal(type("birthCert").slot, docSlotFor("birth_certificate"));
assert.equal(type("addressProof").slot, docSlotFor("address_proof"));
// …and a parent's Aadhaar has no slot of its own, as in the intake.
assert.equal(type("fatherAadhaar").slot, null);
assert.equal(type("motherAadhaar").aadhaarOf, "mother");
assert.equal(new Set(BUILT_IN_DOC_TYPES.map((t) => t.id)).size, BUILT_IN_DOC_TYPES.length);

// Same slot: verified in place, the type saved with it.
{
  const docs = docsWith("birthCert");
  const p = planDocType({ fromSlot: "birthCert", type: type("birthCert"), docs });
  assert.ok(p.ok);
  if (p.ok) {
    assert.deepEqual(p.plan, { kind: "same_slot", slot: "birthCert" });
    const out = apply(docs, p.plan, "birthCert");
    assert.equal(out.birthCert.status, "verified");
    assert.equal(out.birthCert.docType, "birthCert");
    assert.equal(out.birthCert.docTypeLabel, "Birth certificate");
  }
}

// Wrong slot: a TC uploaded as address proof moves to the TC slot, with the TC slot's URL.
{
  const docs = docsWith("addressProof");
  const p = planDocType({ fromSlot: "addressProof", type: type("tc"), docs });
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.plan.kind, "move");
    const out = apply(docs, p.plan, "tc");
    assert.equal(out.tc.status, "verified");
    assert.equal(out.tc.fileUrl, proxy("tc"));
    assert.equal(out.tc.driveFileId, "drv_1");
    assert.equal(out.addressProof.status, "missing");
    assert.equal(out.addressProof.fileUrl, "");
  }
}

// Never over somebody's document: a TC slot holding a received / verified file refuses the move.
for (const status of ["received", "verified", "pending"] as const) {
  const docs = docsWith("addressProof", { tc: { ...pending("tc"), status } });
  const p = planDocType({ fromSlot: "addressProof", type: type("tc"), docs });
  assert.equal(p.ok, false, `target ${status}`);
}
// A rejected file in the target may be replaced.
{
  const docs = docsWith("addressProof", { tc: { ...pending("tc"), status: "rejected" } });
  assert.equal(planDocType({ fromSlot: "addressProof", type: type("tc"), docs }).ok, true);
}

// The mother's Aadhaar uploaded in the child's Aadhaar slot leaves the child's slot.
{
  const docs = docsWith("aadhaar");
  const p = planDocType({ fromSlot: "aadhaar", type: type("motherAadhaar"), docs });
  assert.ok(p.ok);
  if (p.ok) {
    assert.deepEqual(p.plan, { kind: "file_off_slot", from: "aadhaar" });
    const out = apply(docs, p.plan, "motherAadhaar");
    assert.equal(out.aadhaar.status, "missing", "the child's Aadhaar is NOT verified by the mother's card");
    const f = filedEntryFor({ id: "f1", studentId: "s1", householdId: "h1", fromSlot: "aadhaar", doc: docs.aadhaar, type: type("motherAadhaar"), verifiedBy: "Shipra", verifiedAt: "t", note: "" });
    assert.equal(f.driveFileId, "drv_1", "the file is still on record");
    assert.equal(f.typeLabel, "Mother's Aadhaar");
  }
}

// A photo stays a photo.
assert.equal(planDocType({ fromSlot: "photo", type: type("aadhaar"), docs: docsWith("photo") }).ok, false);
assert.equal(planDocType({ fromSlot: "tc", type: type("photo"), docs: docsWith("tc") }).ok, false);

// Custom types: created once, matched by name, listed after the built-ins.
{
  let s = emptyStudentDocTypesState();
  const a = addCustomDocType(s, "  Ration   card ", "Shipra", "t", () => "x1");
  assert.ok(a.ok && a.created);
  if (a.ok) s = a.state;
  const b = addCustomDocType(s, "ration card", "Beena", "t", () => "x2");
  assert.ok(b.ok && !b.created && b.type.id === "cdt_x1");
  const c = addCustomDocType(s, "Birth Certificate", "Beena", "t", () => "x3");
  assert.ok(c.ok && !c.created && c.type.id === "birthCert", "a built-in name is the built-in");
  assert.equal(addCustomDocType(s, "x", "B", "t", () => "x4").ok, false);
  const cat = docTypeCatalogue(s);
  assert.equal(cat[cat.length - 1]!.label, "Ration card");
  assert.equal(cat[cat.length - 1]!.slot, null);
  const p = planDocType({ fromSlot: "incomeCert", type: cat[cat.length - 1]!, docs: docsWith("incomeCert") });
  assert.ok(p.ok && p.plan.kind === "file_off_slot");
  // Round trip through the stored shape.
  assert.deepEqual(normalizeStudentDocTypesState(JSON.parse(JSON.stringify(s))).custom, s.custom);
}
assert.deepEqual(normalizeStudentDocTypesState(null), emptyStudentDocTypesState());

// The chosen type survives the SIS normalizer (it would be dropped silently otherwise).
{
  const f = normalizeDocFile({ ...pending("tc"), status: "verified", docType: "tc", docTypeLabel: "Transfer certificate" });
  assert.equal(f.docType, "tc");
  assert.equal(f.docTypeLabel, "Transfer certificate");
  assert.equal("docType" in normalizeDocFile(pending("tc")), false, "an untyped document stays untyped");
}

console.log("studentDocTypes: ok");
