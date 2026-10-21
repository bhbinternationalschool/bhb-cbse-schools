/**
 * Which staff signature goes on which signing line (lib/printSignatures),
 * and that a missing or doubtful one is a blank line — never someone
 * else's.
 *
 * Run: npx tsx src/lib/printSignatures.selftest.ts
 */
import assert from "node:assert/strict";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  certificateSignatureRequest,
  parsePrintSignatureQuery,
  printSignatureQuery,
  reportCardSignatureRequest,
  resolvePrintSignatories,
  resultSheetSignatureRequest,
  shareSignatureImages,
  signatoryRoleForLabel,
  signatureForLabel,
  signatureSource,
  withSignatureImages,
  type PrintSignatureSet,
} from "@/lib/printSignatures";
import { loadPrintSignaturesWith, signatureDataUrl } from "@/lib/printSignaturesLoad";

console.log("printSignatures.selftest.ts");

const AY = "2026-27";

function staff(id: string, fullName: string, extra: Partial<StaffRecord> = {}): StaffRecord {
  return {
    id,
    fullName,
    status: "active",
    designationId: null,
    classTeacherLinks: [],
    subjectTeachingLinks: [],
    vehicleLinks: [],
    dutyLinks: [],
    signatureUrl: `/api/file/staff/${id}/signature-1.png`,
    ...extra,
  } as unknown as StaffRecord;
}

const designations = [
  { id: "d_prin", code: "PRIN", name: "Principal", isActive: true },
  { id: "d_vp", code: "VP", name: "Vice Principal", isActive: true },
  { id: "d_tgt", code: "TGT", name: "TGT", isActive: true },
];

const ct = (classId: string, sectionId: string, isPrimary = true, academicYearCode = AY) => ({
  id: `l_${classId}_${sectionId}_${Math.random()}`,
  classId,
  sectionId,
  academicYearCode,
  isPrimary,
});

const PRINCIPAL = staff("s_prin", "Meera Rao", { designationId: "d_prin" });
const VICE = staff("s_vp", "Arun Vice", { designationId: "d_vp" });
const T5A = staff("s_t5a", "Kavita Sharma", { designationId: "d_tgt", classTeacherLinks: [ct("c5", "s5a")] });
const T5B = staff("s_t5b", "Ravi Kumar", { designationId: "d_tgt", classTeacherLinks: [ct("c5", "s5b")] });
const OFFICE = staff("s_off", "Sunil Clerk");

const book = { staff: [PRINCIPAL, VICE, T5A, T5B, OFFICE], designations };

/* ── which line is whose ─────────────────────────────────────────────── */

assert.equal(signatoryRoleForLabel("Principal"), "principal");
assert.equal(signatoryRoleForLabel("Signature of Principal"), "principal");
assert.equal(signatoryRoleForLabel("Principal / authorised"), "principal");
assert.equal(signatoryRoleForLabel("Vice Principal"), "none", "a Vice Principal line is never the principal's");
assert.equal(signatoryRoleForLabel("Vice-Principal"), "none");
assert.equal(signatoryRoleForLabel("Class teacher"), "class_teacher");
assert.equal(signatoryRoleForLabel("Signature of Class Teacher"), "class_teacher");
assert.equal(signatoryRoleForLabel("Examination in-charge"), "none", "nobody's signature on the exam in-charge line");
assert.equal(signatoryRoleForLabel("Parent / guardian"), "none");
assert.equal(signatoryRoleForLabel("Authorised signatory"), "none");
assert.equal(signatoryRoleForLabel(""), "none");

const set: PrintSignatureSet = {
  principal: { staffId: "s_prin", name: "Meera Rao", src: "data:image/png;base64,AAAA" },
  classTeacher: { staffId: "s_t5a", name: "Kavita Sharma", src: "data:image/png;base64,BBBB" },
  checkedBy: null,
};
assert.equal(signatureForLabel("Principal", set)?.staffId, "s_prin");
assert.equal(signatureForLabel("Class teacher", set)?.staffId, "s_t5a");
assert.equal(signatureForLabel("Examination in-charge", set), null);
assert.equal(signatureForLabel("Principal", null), null);

/* ── who: the principal ──────────────────────────────────────────────── */

const want = { principal: true, classTeacher: true, checkedBy: true };
let who = resolvePrintSignatories(book, { doc: "report_card", classId: "c5", sectionId: "s5a", academicYearCode: AY, want });
assert.equal(who.principal?.id, "s_prin", "the Principal designation holder signs the Principal line");
assert.notEqual(who.principal?.id, "s_vp");

// Only a Vice Principal on the roll → nobody (the loose resolvePrincipal would pick the VP).
who = resolvePrintSignatories({ staff: [VICE, T5A], designations }, { doc: "admit_card", want: { principal: true } });
assert.equal(who.principal, null, "a Vice Principal never signs as Principal");
// Vice listed first in designations must not matter either.
who = resolvePrintSignatories(
  { staff: [VICE, PRINCIPAL], designations: [designations[1]!, designations[0]!] },
  { doc: "admit_card", want: { principal: true } },
);
assert.equal(who.principal?.id, "s_prin");
// Two principals → ambiguous → blank.
who = resolvePrintSignatories(
  { staff: [PRINCIPAL, staff("s_prin2", "Second Head", { designationId: "d_prin" })], designations },
  { doc: "admit_card", want: { principal: true } },
);
assert.equal(who.principal, null, "two principals: the line stays blank");
// An inactive principal does not sign.
who = resolvePrintSignatories(
  { staff: [staff("s_old", "Old Head", { designationId: "d_prin", status: "inactive" } as Partial<StaffRecord>)], designations },
  { doc: "admit_card", want: { principal: true } },
);
assert.equal(who.principal, null);

/* ── who: the class teacher of THAT section ──────────────────────────── */

who = resolvePrintSignatories(book, { doc: "report_card", classId: "c5", sectionId: "s5b", academicYearCode: AY, want });
assert.equal(who.classTeacher?.id, "s_t5b", "5-B's card gets 5-B's class teacher");
who = resolvePrintSignatories(book, { doc: "report_card", classId: "c6", sectionId: "s6a", academicYearCode: AY, want });
assert.equal(who.classTeacher, null, "a section with no class teacher: blank, never another section's");
who = resolvePrintSignatories(book, { doc: "report_card", classId: "c5", sectionId: "s5a", academicYearCode: "2025-26", want });
assert.equal(who.classTeacher, null, "last year's card is not signed by this year's class teacher");
// Primary wins over a co-class teacher; two primaries → blank.
const CO = staff("s_co", "Co Teacher", { classTeacherLinks: [ct("c5", "s5a", false)] });
who = resolvePrintSignatories({ staff: [CO, T5A], designations }, { doc: "report_card", classId: "c5", sectionId: "s5a", academicYearCode: AY, want });
assert.equal(who.classTeacher?.id, "s_t5a", "the primary class teacher signs");
const T5A2 = staff("s_t5a2", "Another Primary", { classTeacherLinks: [ct("c5", "s5a", true)] });
who = resolvePrintSignatories({ staff: [T5A, T5A2], designations }, { doc: "report_card", classId: "c5", sectionId: "s5a", academicYearCode: AY, want });
assert.equal(who.classTeacher, null, "two primary class teachers: blank");
// A named class teacher (certificate printed under a name) must be that teacher.
who = resolvePrintSignatories(book, { doc: "report_card", classId: "c5", sectionId: "s5a", academicYearCode: AY, classTeacherName: "Ravi Kumar", want });
assert.equal(who.classTeacher, null, "the section's teacher is not the person the document names: blank");

/* ── certificates ────────────────────────────────────────────────────── */

const issue = {
  kind: "bonafide",
  voidedAt: null as string | null,
  issuedBy: "Meera Rao",
  classTeacherName: "Kavita Sharma",
  tc: null as { checkedByName?: string } | null,
};
let req = certificateSignatureRequest(issue)!;
who = resolvePrintSignatories(book, req);
assert.equal(who.principal?.id, "s_prin", "issued by the principal: the principal signs");
assert.equal(who.classTeacher?.id, "s_t5a", "the class teacher the certificate names signs");
assert.equal(who.checkedBy, null, "only a TC has a Checked by line");

// Issued by someone else (no principal at issue time / an old principal) → no principal's signature.
who = resolvePrintSignatories(book, certificateSignatureRequest({ ...issue, issuedBy: "Sunil Clerk" })!);
assert.equal(who.principal, null, "a certificate issued by the clerk is never signed by the principal");
who = resolvePrintSignatories(book, certificateSignatureRequest({ ...issue, issuedBy: "Arun Vice" })!);
assert.equal(who.principal, null, "issued by the Vice Principal: not the principal's signature");
assert.equal(certificateSignatureRequest({ ...issue, issuedBy: "" })!.want.principal, false);
who = resolvePrintSignatories(book, { doc: "certificate", want: { principal: true } });
assert.equal(who.principal, null, "a certificate with no 'issued by' name: blank");

// Void: nothing at all.
assert.equal(certificateSignatureRequest({ ...issue, voidedAt: "2026-10-01" }), null, "a void certificate is never signed");

// TC: Checked by is the named member of staff, when the name is unique.
req = certificateSignatureRequest({ ...issue, kind: "tc", tc: { checkedByName: "Sunil Clerk" } })!;
who = resolvePrintSignatories(book, req);
assert.equal(who.checkedBy?.id, "s_off");
who = resolvePrintSignatories(
  { staff: [...book.staff, staff("s_off2", "Sunil Clerk")], designations },
  req,
);
assert.equal(who.checkedBy, null, "two staff with the name: blank, never a guess");
who = resolvePrintSignatories(book, certificateSignatureRequest({ ...issue, kind: "tc", tc: { checkedByName: "Somebody Outside" } })!);
assert.equal(who.checkedBy, null);
// A named person is only for certificates.
who = resolvePrintSignatories(book, { doc: "report_card", checkedByName: "Sunil Clerk", want: { checkedBy: true } });
assert.equal(who.checkedBy, null, "no named lookups outside certificates");

/* ── report cards & result sheets ────────────────────────────────────── */

const card = (labels: string[], show = true) => ({
  student: { classId: "c5", sectionId: "s5b" },
  academicYearCode: AY,
  presentation: { showSignatures: show, signatureLabels: labels },
});
const rc = reportCardSignatureRequest(card(["Class teacher", "Examination in-charge", "Principal"]))!;
assert.deepEqual(rc.want, { principal: true, classTeacher: true });
assert.equal(rc.sectionId, "s5b");
assert.equal(reportCardSignatureRequest(card(["Class teacher"], false)), null, "a card that prints no signatures asks for none");
assert.deepEqual(reportCardSignatureRequest(card(["Examination in-charge"]))!.want, { principal: false, classTeacher: false });
const rs = resultSheetSignatureRequest({ classId: "c5", sectionId: "s5a", academicYearCode: AY });
assert.deepEqual(rs.want, { principal: true, classTeacher: true });

// The query round-trips; unknown docs are refused.
const back = parsePrintSignatureQuery(new URLSearchParams(printSignatureQuery(req)))!;
assert.deepEqual(back.want, req.want);
assert.equal(back.checkedByName, "Sunil Clerk");
assert.equal(parsePrintSignatureQuery(new URLSearchParams("doc=payslip&want=principal")), null);

/* ── where the image may come from ───────────────────────────────────── */

assert.deepEqual(signatureSource("/api/file/staff/E01/signature-1.png"), { kind: "file", path: "staff/E01/signature-1.png" });
assert.equal(signatureSource("/api/file/reports/2026-10/x.pdf"), null, "only staff/ files");
assert.equal(signatureSource("/api/file/staff/../reports/x.png"), null, "no climbing out of staff/");
assert.equal(signatureSource("https://x.supabase.co/storage/v1/object/sign/a.png?token=1"), null, "an (expiring) link is not printed");
assert.equal(signatureSource("data:image/svg+xml;base64,PHN2Zz4="), null, "never an SVG");
assert.equal(signatureSource(""), null);
assert.equal(signatureSource("data:image/png;base64,iVBORw0KGgo=")?.kind, "data");

/* ── loading: bytes are checked, failures are blank lines ─────────────── */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const SVG = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");

async function main() {
  const files: Record<string, Uint8Array> = {
    "staff/s_prin/signature-1.png": PNG,
    "staff/s_t5b/signature-1.png": SVG,
  };
  const reads: string[] = [];
  const download = async (path: string) => {
    reads.push(path);
    return files[path] ?? null;
  };

  assert.match((await signatureDataUrl("/api/file/staff/s_prin/signature-1.png", download))!, /^data:image\/png;base64,/);
  assert.equal(await signatureDataUrl("/api/file/staff/s_t5b/signature-1.png", download), null, "an SVG renamed .png is not printed");
  assert.equal(await signatureDataUrl("/api/file/staff/missing.png", download), null);
  const big = new Uint8Array(1024 * 1024 + 1);
  big.set(PNG);
  assert.equal(await signatureDataUrl("/api/file/staff/big.png", async () => big), null, "over 1 MB is not printed");
  assert.equal(await signatureDataUrl("/api/file/staff/x.png", async () => { throw new Error("storage down"); }), null);

  const memo = new Map<string, Promise<string | null>>();
  const got = await loadPrintSignaturesWith(
    book,
    { doc: "report_card", classId: "c5", sectionId: "s5b", academicYearCode: AY, want: { principal: true, classTeacher: true } },
    { download, memo },
  );
  assert.equal(got.principal?.staffId, "s_prin");
  assert.equal(got.classTeacher, null, "unreadable image: the class teacher line is blank, not someone else's");
  assert.equal(got.checkedBy, null);
  // Without a signature on file: blank.
  const noSig = { staff: [{ ...PRINCIPAL, signatureUrl: "" } as StaffRecord], designations };
  const none = await loadPrintSignaturesWith(noSig, { doc: "admit_card", want: { principal: true } }, { download });
  assert.equal(none.principal, null);
  // memo: the principal's image is read once for many cards.
  reads.length = 0;
  for (let i = 0; i < 5; i++) {
    await loadPrintSignaturesWith(book, { doc: "admit_card", want: { principal: true } }, { download, memo });
  }
  assert.equal(reads.length, 0, "memoised across cards");

  // A parent's answer carries each image once; the card gets it back.
  const images: Record<string, string> = {};
  const shared = shareSignatureImages(set, images);
  assert.equal(shared.principal?.src, "");
  assert.equal(Object.keys(images).length, 2);
  const filled = withSignatureImages(shared, images)!;
  assert.equal(filled.principal?.src, set.principal!.src);
  assert.equal(withSignatureImages(shared, {})!.principal, null, "no image in the answer: blank");
  assert.equal(withSignatureImages(null, images), null);

  console.log("printSignatures.selftest.ts: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
