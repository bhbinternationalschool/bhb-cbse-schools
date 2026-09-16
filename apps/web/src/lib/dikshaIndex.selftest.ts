/**
 * Self-test: the NCERT chapter index — which DIKSHA books count, how a
 * book's hierarchy becomes chapters and resources, when to refetch and
 * when a book may be retired. Shapes are taken from DIKSHA's live answers
 * (September 2026).
 * Run: npx tsx apps/web/src/lib/dikshaIndex.selftest.ts
 */
import assert from "node:assert/strict";
import {
  dikshaDate,
  needsRefetch,
  NCERT_CHANNEL,
  parseTextbookHierarchy,
  selectCurrentTextbooks,
  textbookSearchBody,
  textbooksToRetire,
  type DikshaTextbookHit,
  type HierarchyNode,
  type IndexTextbook,
  type StoredTextbook,
} from "@/lib/dikshaIndex";

const COLLECTION = "application/vnd.ekstep.content-collection";

// ── Dates and the search request ────────────────────────────────────────
{
  assert.equal(dikshaDate("2026-09-08T10:12:33.123+0000"), "2026-09-08T10:12:33.123Z", "DIKSHA's +0000 offset");
  assert.equal(dikshaDate("2026-09-08T15:42:33.123+0530"), "2026-09-08T10:12:33.123Z");
  assert.equal(dikshaDate(""), null);
  assert.equal(dikshaDate("not a date"), null);

  const body = textbookSearchBody(200);
  assert.equal(body.request.offset, 200);
  assert.deepEqual(body.request.filters.channel, [NCERT_CHANNEL]);
  assert.deepEqual(body.request.filters.gradeLevel, ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8"]);
  assert.deepEqual(body.request.sort_by, { identifier: "asc" }, "a stable order, so pages never overlap or skip");
}

// ── Which books count ───────────────────────────────────────────────────
{
  const hit = (over: Partial<DikshaTextbookHit>): DikshaTextbookHit => ({
    identifier: "do_1",
    name: "Ganita Prakash",
    channel: NCERT_CHANNEL,
    gradeLevel: ["Class 6"],
    medium: ["English"],
    subject: ["Mathematics"],
    year: "2024",
    lastPublishedOn: "2026-09-08T10:12:33.123+0000",
    ...over,
  });
  const picked = selectCurrentTextbooks([
    hit({ identifier: "do_ganita" }),
    hit({ identifier: "do_ganita" }),
    hit({ identifier: "do_malhar", name: "  मल्हार ", medium: ["Hindi"], subject: ["Hindi"] }),
    hit({ identifier: "do_deepakam", name: "दीपकम्", medium: ["Sanskrit"], subject: ["Sanskrit"] }),
    hit({ identifier: "do_mridang", name: "Mridang", gradeLevel: ["Class 1"], year: 2023 }),
    // Seen live and rightly refused:
    hit({ identifier: "do_ourpast", name: "(NEW) Our Past II", gradeLevel: ["Class 7"], year: undefined, copyrightYear: 2020 }),
    hit({ identifier: "do_cur_sa", name: "Curiosity(Sanskrit)", medium: ["Sanskrit"], subject: ["Science"] }),
    hit({ identifier: "do_cbse", name: "(NEW) Honeysuckle", channel: "01241974041332940818" }),
    hit({ identifier: "do_workbook", name: "Workbook", gradeLevel: ["Class 6", "Class 7"] }),
    hit({ identifier: "do_c9", name: "Class 9 book", gradeLevel: ["Class 9"] }),
    hit({ identifier: "do_odia", name: "Joyful Mathematics (Oriya)", medium: ["Oriya"] }),
    hit({ identifier: "do_two_media", name: "Marigold", medium: ["Hindi", "English"] }),
    hit({ identifier: "", name: "no id" }),
  ]);
  assert.deepEqual(
    picked.map((b) => b.id),
    ["do_mridang", "do_ganita", "do_malhar", "do_deepakam"],
    "current NCERT editions, Classes 1–8, English/Hindi and Sanskrit-the-subject only; sorted by class",
  );
  const malhar = picked.find((b) => b.id === "do_malhar")!;
  assert.equal(malhar.name, "मल्हार");
  assert.equal(malhar.grade, 6);
  assert.equal(malhar.medium, "Hindi");
  assert.equal(malhar.editionYear, 2024);
  assert.equal(malhar.publishedAt, "2026-09-08T10:12:33.123Z");
}

// ── A book's hierarchy → rows ───────────────────────────────────────────
const book: IndexTextbook = {
  id: "do_book",
  grade: 6,
  medium: "English",
  subjects: ["Mathematics"],
  name: "Ganita Prakash",
  editionYear: 2024,
  publishedAt: "2026-09-08T10:12:33.123Z",
};
{
  const leaf = (id: string, over: Partial<HierarchyNode> = {}): HierarchyNode => ({
    identifier: id,
    name: `Leaf ${id}`,
    mimeType: "video/mp4",
    primaryCategory: "Explanation Content",
    license: "CC BY 4.0",
    artifactUrl: `https://obj.diksha.gov.in/${id}.mp4`,
    size: 1000,
    ...over,
  });
  const folder = (name: string, children: HierarchyNode[], index = 1): HierarchyNode => ({ identifier: `u_${name}`, name, mimeType: COLLECTION, index, children });
  const content: HierarchyNode = {
    license: "CC BY-NC-ND 4.0",
    copyright: "ncert",
    children: [
      {
        identifier: "ch_7",
        name: "  Chapter 7:   Fractions ",
        mimeType: COLLECTION,
        index: 2,
        dialcodes: ["0674CH07"],
        description: "Enter description for TextBook",
        keywords: ["Fractions", " fractions ", "Fractions", ""],
        children: [
          folder("e-Textbook", [leaf("pdf7", { mimeType: "application/pdf", primaryCategory: "eTextbook", license: "CC BY-NC-ND 4.0", copyright: "NCERT" })], 1),
          folder("Video Content", [leaf("v1"), leaf("v2", { artifactUrl: "http://insecure/v2.mp4" }), leaf("v1")], 2),
          folder("Audio Content", [leaf("a1", { mimeType: "audio/mp3", organisation: ["NCERT"] })], 3),
          folder("Practice Set", [leaf("p1", { mimeType: "application/vnd.ekstep.ecml-archive", primaryCategory: "Practice Question Set" })], 4),
          folder("Virtual Lab Content", [folder("Adding fractions", [leaf("sim1", { mimeType: "application/vnd.ekstep.html-archive" })])], 5),
        ],
      },
      {
        identifier: "ch_1",
        name: "Chapter 1: Patterns in Mathematics",
        mimeType: COLLECTION,
        index: 1,
        dialcodes: [],
        description: "पैटर्न की समझ",
        children: [
          // Seen live: the chapter PDF filed as a Learning Resource.
          folder("e-Textbook", [leaf("pdf1", { mimeType: "application/pdf", primaryCategory: "Learning Resource" })]),
          // A PDF elsewhere is not the chapter's pages.
          folder("Teacher Resources", [leaf("tr1", { mimeType: "application/pdf", primaryCategory: "Teacher Resource" })], 2),
        ],
      },
      { identifier: "ch_warmup", name: "Warm-up and Cool-down", mimeType: COLLECTION, index: 3, children: [folder("Audio Content", [leaf("a9", { mimeType: "audio/mp3" })])] },
      // Loose file at the top of the book: belongs to no chapter.
      leaf("loose", { index: 0 }),
      // A unit without an id cannot be keyed.
      { name: "Broken unit", mimeType: COLLECTION, index: 4, children: [] },
    ],
  };
  const p = parseTextbookHierarchy(book, content);

  assert.deepEqual(p.chapters.map((c) => [c.position, c.id]), [[1, "ch_1"], [2, "ch_7"], [3, "ch_warmup"]], "book order by DIKSHA's index");
  const ch7 = p.chapters.find((c) => c.id === "ch_7")!;
  assert.equal(ch7.name, "Chapter 7: Fractions");
  assert.equal(ch7.chapter_code, "0674CH07");
  assert.equal(ch7.description, "", "DIKSHA's form placeholder is not a description");
  assert.deepEqual(ch7.keywords, ["Fractions"], "trimmed, blank dropped, repeats dropped");
  assert.equal(ch7.textbook_pdf_url, "https://obj.diksha.gov.in/pdf7.mp4");
  assert.equal(ch7.textbook_pdf_license, "CC BY-NC-ND 4.0");
  assert.equal(ch7.video_count, 2, "v1 counted once; v2 kept though its link is not https");
  assert.equal(ch7.audio_count, 1);
  assert.equal(ch7.practice_count, 1);

  const r7 = p.resources.filter((r) => r.chapter_id === "ch_7");
  assert.deepEqual(r7.map((r) => r.id), ["pdf7", "v1", "v2", "a1", "p1", "sim1"], "every leaf under the chapter, each once, in order");
  assert.deepEqual(r7.map((r) => r.position), [1, 2, 3, 4, 5, 6]);
  assert.equal(r7.find((r) => r.id === "sim1")!.folder, "Virtual Lab Content", "filed under the first-level folder, however deep");
  assert.equal(r7.find((r) => r.id === "v2")!.url, "", "a non-https link is not stored");
  assert.equal(r7.find((r) => r.id === "a1")!.copyright, "NCERT", "organisation stands in for a missing copyright");
  assert.equal(r7.find((r) => r.id === "pdf7")!.size_bytes, 1000);

  const ch1 = p.chapters.find((c) => c.id === "ch_1")!;
  assert.equal(ch1.textbook_pdf_url, "https://obj.diksha.gov.in/pdf1.mp4", "a PDF in the e-Textbook folder is the chapter's pages whatever its label");
  assert.equal(ch1.chapter_code, "");
  assert.equal(ch1.description, "पैटर्न की समझ");
  assert.equal(p.chapters.find((c) => c.id === "ch_warmup")!.textbook_pdf_url, "", "no PDF → an empty link, not a guess");
  assert.ok(!p.resources.some((r) => r.id === "loose"), "a loose file belongs to no chapter");

  assert.deepEqual(p.textbook, {
    id: "do_book",
    grade: 6,
    medium: "English",
    subjects: ["Mathematics"],
    name: "Ganita Prakash",
    edition_year: 2024,
    license: "CC BY-NC-ND 4.0",
    copyright: "ncert",
    published_at: "2026-09-08T10:12:33.123Z",
  });

  const repeatAcrossChapters = parseTextbookHierarchy(book, {
    children: [
      { identifier: "c1", name: "A", mimeType: COLLECTION, index: 1, children: [leaf("shared")] },
      { identifier: "c2", name: "B", mimeType: COLLECTION, index: 2, children: [leaf("shared")] },
    ],
  });
  assert.equal(repeatAcrossChapters.resources.length, 2, "one resource filed in two chapters is a row in each");
}

// ── Refetch ─────────────────────────────────────────────────────────────
{
  const stored: StoredTextbook = { id: "do_book", published_at: "2026-09-08T10:12:33.123+00:00", chapter_count: 10, retired_at: null };
  assert.equal(needsRefetch(stored, book), false, "same publish date (Postgres spelling) → skip");
  assert.equal(needsRefetch(stored, book, true), true, "force");
  assert.equal(needsRefetch(undefined, book), true, "not stored yet");
  assert.equal(needsRefetch({ ...stored, published_at: "2026-08-01T00:00:00+00:00" }, book), true, "republished");
  assert.equal(needsRefetch({ ...stored, chapter_count: 0 }, book), true, "stored with no chapters");
  assert.equal(needsRefetch({ ...stored, retired_at: "2026-09-01T00:00:00+00:00" }, book), true, "came back after retiring");
  assert.equal(needsRefetch(stored, { ...book, publishedAt: null }), true, "no date to compare");
}

// ── Retiring ────────────────────────────────────────────────────────────
{
  const s = (id: string, retired = false): StoredTextbook => ({ id, published_at: null, chapter_count: 5, retired_at: retired ? "2026-01-01T00:00:00Z" : null });
  const b = (id: string): IndexTextbook => ({ ...book, id });
  const stored = [s("a"), s("b"), s("c"), s("d"), s("old", true)];

  assert.deepEqual(textbooksToRetire(stored, [b("a"), b("b"), b("c")], true), { ids: ["d"], refused: null });
  assert.deepEqual(textbooksToRetire(stored, [b("a"), b("b"), b("c"), b("d")], true).ids, [], "nothing withdrawn");
  assert.deepEqual(textbooksToRetire(stored, [b("a"), b("b")], true).ids, ["c", "d"], "half at once is still believable");
  const tooMany = textbooksToRetire(stored, [b("a")], true);
  assert.deepEqual(tooMany.ids, [], "three of four at once reads as a broken search");
  assert.match(tooMany.refused ?? "", /3 of 4/);
  const partial = textbooksToRetire(stored, [b("a")], false);
  assert.deepEqual(partial.ids, []);
  assert.match(partial.refused ?? "", /not read to the end/);
  assert.deepEqual(textbooksToRetire([], [b("a")], true), { ids: [], refused: null }, "first run");
}

console.log("dikshaIndex.selftest: ok");
