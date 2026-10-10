import assert from "node:assert/strict";
import {
  isPublisherFileUrl,
  planNucleusCapture,
  readNucleusManifest,
  syntheticPaperPath,
} from "./nucleusManifest";
import { defaultImportMappings, type ImportCatalog } from "./examPaperImport";

console.log("nucleusManifest.selftest.ts");

const PDF = "https://question-bank-assets.s3.amazonaws.com/pdf-service/pdfs/PUBLISHED/prod/ASM_BUILDER_AK_ANSWER_KEY_853132_a.pdf";
const DOC = "https://question-bank-assets.s3.amazonaws.com/doc-service/doc/PUBLISHED/prod/ASM_BUILDER_DOCX_853132_b.docx";

// The paste decides what the server downloads, so only the publisher's own
// file store counts.
assert.equal(isPublisherFileUrl(PDF), true);
assert.equal(isPublisherFileUrl(DOC), true);
assert.equal(isPublisherFileUrl("http://question-bank-assets.s3.amazonaws.com/x.pdf"), false, "https only");
assert.equal(isPublisherFileUrl("https://evil.example.com/x.pdf"), false);
assert.equal(
  isPublisherFileUrl("https://question-bank-assets.s3.amazonaws.com.evil.com/x.pdf"),
  false,
  "a host that merely starts with the right name is not the right host",
);
assert.equal(isPublisherFileUrl("file:///etc/passwd"), false);
assert.equal(isPublisherFileUrl("not a url"), false);

{
  const r = readNucleusManifest(
    JSON.stringify({
      capturedOn: "2026-09-18",
      rows: [
        { paperId: "853132", classLabel: "Nursery", division: "A", subject: "Hindi",
          title: "Formative Assessment 1 - Set 1", unit: "Assessment 1",
          questionPaperDocxUrl: DOC, answerKeyUrl: PDF },
        // No class — cannot be filed, and says so by name.
        { paperId: "1", classLabel: "", subject: "Hindi", title: "Something", questionPaperDocxUrl: DOC },
        // A link somewhere else entirely.
        { paperId: "2", classLabel: "Class6", subject: "Math", title: "Set 1",
          questionPaperDocxUrl: "https://evil.example.com/paper.docx", answerKeyUrl: "" },
        // Key only: the paper is already on the desk, the key is not.
        { paperId: "3", classLabel: "Class6", subject: "Math", title: "Set 2", answerKeyUrl: PDF },
      ],
    }),
  );
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");
  assert.equal(r.rows.length, 2, "two usable rows");
  assert.equal(r.capturedOn, "2026-09-18");
  assert.equal(r.rows[1]!.questionPaperDocxUrl, "", "an unusable link is dropped, not kept");
  assert.equal(r.rows[1]!.answerKeyUrl, PDF);
  assert.equal(r.ignored.length, 2);
  assert.match(r.ignored[0]!, /missing class, subject or title/);
  assert.match(r.ignored[1]!, /Class6 Math Set 1 — no usable publisher link/);
}

// A person pasting the wrong thing gets told what to do, not a stack trace.
{
  const r = readNucleusManifest("the whole page text I copied");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Click the bookmark/);
}
assert.equal(readNucleusManifest("").ok, false);
assert.equal(readNucleusManifest('{"rows":[]}').ok, false);
assert.equal(readNucleusManifest('{"nope":1}').ok, false);

// The path the folder importer would have seen — same rules, one code path.
{
  const path = syntheticPaperPath({
    paperId: "853132", classLabel: "Class6", division: "A", subject: "Math",
    title: "Summative Assessment 1 - Set 1", unit: "MOY",
    questionPaperDocxUrl: DOC, answerKeyUrl: PDF,
  });
  assert.equal(
    path,
    "Class6/Division A/Math/Editable/MOY/Summative Assessment 1 - Set 1/Summative Assessment 1 - Set 1_Question Paper_paper_doc.docx",
  );
}

// A slash in a publisher's own label must not invent a folder level.
{
  const path = syntheticPaperPath({
    paperId: "1", classLabel: "UKG", division: "", subject: "Understanding Our World",
    title: "Half Yearly / Annual", unit: "",
    questionPaperDocxUrl: DOC, answerKeyUrl: "",
  });
  assert.equal(path.split("/").length, 7, "seven levels, whatever the label contains");
  assert.match(path, /Division A/, "a missing division still reads as A");
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

const catalog: ImportCatalog = {
  academicYearCode: "2026-27",
  classes: [{ id: "cls_6", name: "VI" }, { id: "cls_nur", name: "Nursery" }],
  subjects: [
    { id: "sub_mat", code: "MAT", nameEn: "Mathematics" },
    { id: "sub_hin", code: "HIN", nameEn: "Hindi" },
  ],
  terms: [
    { id: "term_ut1", code: "UT1", label: "Unit Test 1", academicYearCode: "2026-27", maxMarks: 40 },
    { id: "term_hy", code: "HY", label: "Half-yearly", academicYearCode: "2026-27", maxMarks: 80 },
  ],
};

const row = (over: Partial<Parameters<typeof planNucleusCapture>[0]["rows"][number]>) => ({
  paperId: "1", classLabel: "Class6", division: "A", subject: "Math",
  title: "Summative Assessment 1 - Set 1", unit: "MOY",
  questionPaperDocxUrl: DOC, answerKeyUrl: PDF, ...over,
});

{
  const plan = planNucleusCapture({
    rows: [
      row({}),
      // Already on the desk — the office should not fetch it twice.
      row({ paperId: "2", title: "Formative Assessment 1 - Set 1", unit: "Assessment 1" }),
      // A subject the school has never mapped.
      row({ paperId: "3", subject: "Moral Science" }),
      // A class masters does not have.
      row({ paperId: "4", classLabel: "Class9" }),
      // Key but no paper: nothing to fetch and file.
      row({ paperId: "5", title: "Summative Assessment 1 - Set 2", questionPaperDocxUrl: "" }),
    ],
    catalog,
    mappings: defaultImportMappings(),
    existing: [
      { academicYearCode: "2026-27", examTermId: "term_ut1", classId: "cls_6",
        subjectId: "sub_mat", publisherLabel: "Formative Assessment 1 - Set 1" },
    ],
  });

  assert.deepEqual(plan.counts, { fetch: 1, already_here: 1, needs_mapping: 1, rejected: 2 });
  assert.deepEqual(plan.unmapped, ["subject:Moral Science"]);

  const [first, second, third, fourth, fifth] = plan.rows;
  assert.equal(first!.verdict, "fetch");
  assert.equal(first!.className, "VI", "Class6 maps to the school's own name");
  assert.equal(first!.examTermCode, "HY");
  assert.equal(first!.setCode, "A");
  assert.equal(second!.verdict, "already_here");
  assert.equal(third!.verdict, "needs_mapping");
  assert.match(fourth!.reason, /masters has no class "IX"/);
  assert.match(fifth!.reason, /no question paper/);
}

{
  // Set 3 of a paper already here as Set 1 is still new work.
  const plan = planNucleusCapture({
    rows: [row({ title: "Summative Assessment 1 - Set 3" })],
    catalog,
    mappings: defaultImportMappings(),
    existing: [
      { academicYearCode: "2026-27", examTermId: "term_hy", classId: "cls_6",
        subjectId: "sub_mat", publisherLabel: "Summative Assessment 1 - Set 1" },
    ],
  });
  assert.equal(plan.counts.fetch, 1);
  assert.equal(plan.rows[0]!.setCode, "C", "the publisher's set number decides the letter");
}

console.log("OK — nucleusManifest.selftest.ts");
