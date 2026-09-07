/**
 * A CV becomes a routable application, or it says why it could not.
 *
 * The risk in this feature is not the upload and not the OCR call — it is
 * the mapping. A model returns "PGT Maths, VI-VIII"; the school has its
 * own subject rows and its own class names, and if the mapping is loose
 * a Physics teacher gets filed under a subject the school does not teach
 * and the record LOOKS complete. So the mapping is tested hard, in both
 * directions: what must match, and what must not.
 *
 * Run: npx tsx src/lib/jobApplications.selftest.ts
 */
import assert from "node:assert/strict";

import {
  classLabelsFor,
  jobApplicationInputMessage,
  jobApplicationSummary,
  matchClassWords,
  matchSubjectWords,
  readJobApplicationInput,
  shortClassRange,
  sortJobApplications,
  subjectLabelsFor,
  type JobApplication,
} from "./jobApplications";
import { jobCvExtractIsUsable, parseJobCvExtract } from "./jobCvExtractAi";
import type { SchoolClass } from "./masters";
import type { Subject } from "./foundationMasters";

console.log("jobApplications.selftest.ts");

// BHB's real shape: Roman-numeral classes, one section each.
const CLASS_NAMES = [
  "Nursery", "LKG", "UKG", "I", "II", "III", "IV", "V",
  "VI", "VII", "VIII", "IX", "X",
];
const GROUPS: Record<string, string> = {
  Nursery: "PRE_PRIMARY", LKG: "PRE_PRIMARY", UKG: "PRE_PRIMARY",
  I: "PRIMARY", II: "PRIMARY", III: "PRIMARY", IV: "PRIMARY", V: "PRIMARY",
  VI: "MIDDLE", VII: "MIDDLE", VIII: "MIDDLE",
  IX: "SECONDARY", X: "SECONDARY",
};
const classes: SchoolClass[] = CLASS_NAMES.map((name, i) => ({
  id: `cls_${name.toLowerCase()}`,
  name,
  sortOrder: i + 1,
  isActive: true,
  groupCode: GROUPS[name] as SchoolClass["groupCode"],
}));

const sub = (id: string, nameEn: string, extra?: Partial<Subject>): Subject =>
  ({
    id,
    code: nameEn.slice(0, 3).toUpperCase(),
    nameEn,
    category: "scholastic",
    coScholasticArea: "",
    parentId: null,
    isElective: false,
    isActive: true,
    sortOrder: 1,
    ncfTagId: "A",
    ...extra,
  }) as Subject;

const subjects: Subject[] = [
  sub("sub_eng", "English"),
  sub("sub_hin", "Hindi"),
  sub("sub_math", "Mathematics"),
  sub("sub_sci", "Science"),
  sub("sub_sst", "Social Science"),
  sub("sub_comp", "Computer Science"),
  sub("sub_skt", "Sanskrit"),
  // A parent group: a folder, not something a person teaches.
  sub("sub_lang", "Languages"),
  sub("sub_eng2", "English Literature", { parentId: "sub_lang" }),
  sub("sub_old", "Astronomy", { isActive: false }),
];

// ── Subjects: their words → the school's rows ─────────────────────────
{
  const ids = (words: string[]) => matchSubjectWords(words, subjects).ids;

  assert.deepEqual(ids(["Mathematics"]), ["sub_math"]);
  assert.deepEqual(ids(["Maths"]), ["sub_math"], "the CV's word, the school's row");
  assert.deepEqual(ids(["maths"]), ["sub_math"]);
  assert.deepEqual(ids(["Math"]), ["sub_math"]);
  assert.deepEqual(ids(["गणित"]), ["sub_math"], "Hindi for maths");
  // A grade band is not a subject. "PGT Physics" is Physics; "PGT" alone
  // is nothing, and must not match by accident.
  assert.deepEqual(ids(["TGT Mathematics"]), ["sub_math"]);
  assert.deepEqual(ids(["PRT"]), [], "a grade band on its own names no subject");
  assert.deepEqual(ids(["Maths Teacher"]), ["sub_math"]);
  assert.deepEqual(ids(["SST"]), ["sub_sst"]);
  assert.deepEqual(ids(["Social Studies"]), ["sub_sst"]);
  assert.deepEqual(ids(["Computers"]), ["sub_comp"]);
  assert.deepEqual(ids(["IT"]), ["sub_comp"]);
  // A phone-typed slip.
  assert.deepEqual(ids(["Mathmatics"]), ["sub_math"]);
  assert.deepEqual(ids(["Sanskrt"]), ["sub_skt"]);

  // Two subjects, deduped, order kept.
  assert.deepEqual(ids(["Maths", "Science", "maths"]), ["sub_math", "sub_sci"]);

  // A group row is a folder. Nobody teaches "Languages".
  assert.equal(ids(["Languages"]).includes("sub_lang"), false);
  // An archived subject is not offered either.
  assert.deepEqual(ids(["Astronomy"]), []);

  // The important negative: a subject the school does NOT teach must not
  // be forced onto the nearest row. It is kept as a word instead.
  const robotics = matchSubjectWords(["Robotics"], subjects);
  assert.deepEqual(robotics.ids, [], "no row, no id");
  assert.deepEqual(robotics.unmatched, ["Robotics"], "and the word survives");
  const german = matchSubjectWords(["German"], subjects);
  assert.deepEqual(german.ids, []);
  // "Art" must not be swallowed by a longer unrelated name.
  assert.deepEqual(matchSubjectWords(["Art"], subjects).ids, []);
  assert.deepEqual(matchSubjectWords([""], subjects).ids, []);
}

// ── Classes: "VI-VIII", "9 and 10", "Primary" ────────────────────────
{
  const ids = (words: string[]) => matchClassWords(words, classes).ids;
  const names = (words: string[]) =>
    classLabelsFor(matchClassWords(words, classes).ids, classes);

  assert.deepEqual(names(["VI-VIII"]), ["VI", "VII", "VIII"], "a Roman range");
  assert.deepEqual(names(["6 to 8"]), ["VI", "VII", "VIII"], "digits reach Roman rows");
  assert.deepEqual(names(["IX–X"]), ["IX", "X"], "an en dash is a dash");
  assert.deepEqual(names(["9 and 10"]), ["IX", "X"]);
  assert.deepEqual(names(["Class 5"]), ["V"]);
  assert.deepEqual(names(["Std. VIII"]), ["VIII"]);
  assert.deepEqual(names(["I, II, III"]), ["I", "II", "III"]);

  // Bands, as teachers actually write them.
  assert.deepEqual(names(["Primary"]), ["I", "II", "III", "IV", "V"]);
  assert.deepEqual(names(["Pre-Primary"]), ["Nursery", "LKG", "UKG"]);
  assert.deepEqual(names(["Middle school"]), ["VI", "VII", "VIII"]);

  // The important negative: a school that stops at X must not acquire XI
  // and XII because a CV offered them.
  const senior = matchClassWords(["XI-XII"], classes);
  assert.deepEqual(senior.ids, [], "classes the school does not run are not invented");
  assert.deepEqual(senior.unmatched, ["XI-XII"], "and the words survive");
  assert.deepEqual(ids(["Senior Secondary"]), [], "no senior band at this school");

  // Nonsense stays nonsense.
  assert.deepEqual(ids(["Class 47"]), []);
  assert.deepEqual(ids(["whatever"]), []);
  // A range so wide it is a misread, not an offer.
  assert.deepEqual(ids(["1-99"]), []);
}

// ── What a public form is allowed to send ────────────────────────────
{
  const ok = (raw: Record<string, unknown>) => {
    const r = readJobApplicationInput(raw);
    assert.equal(r.ok, true, `${JSON.stringify(raw)} should be accepted`);
    return r.ok ? r.value : null;
  };
  assert.equal(ok({ applicantName: "  Priya   Sharma ", mobile: "9919101755" })!.applicantName, "Priya Sharma");
  assert.equal(ok({ applicantName: "Priya", mobile: "+91 99191 01755" })!.mobile, "9919101755");
  assert.equal(ok({ applicantName: "Priya", mobile: "09919101755" })!.mobile, "9919101755");
  assert.equal(ok({ applicantName: "सुनीता शर्मा", mobile: "9919101755" })!.applicantName, "सुनीता शर्मा");

  const bad = (raw: Record<string, unknown>, error: string) => {
    const r = readJobApplicationInput(raw);
    assert.equal(r.ok, false, `${JSON.stringify(raw)} must be refused`);
    if (!r.ok) assert.equal(r.error, error);
  };
  bad({ applicantName: "P", mobile: "9919101755" }, "name_required");
  bad({ applicantName: "", mobile: "9919101755" }, "name_required");
  bad({ applicantName: "x".repeat(81), mobile: "9919101755" }, "name_too_long");
  // A landline or a typo. WhatsApp will never reach it, so the office
  // would have a row it cannot act on.
  bad({ applicantName: "Priya", mobile: "1234567890" }, "mobile_invalid");
  bad({ applicantName: "Priya", mobile: "5919101755" }, "mobile_invalid");
  bad({ applicantName: "Priya", mobile: "99191017" }, "mobile_invalid");
  bad({ applicantName: "Priya", mobile: "" }, "mobile_invalid");
  bad({ applicantName: "Priya", mobile: "9919101755", email: "not-an-email" }, "email_invalid");
  // Optional means optional.
  assert.equal(ok({ applicantName: "Priya", mobile: "9919101755", email: "" })!.email, "");

  for (const e of ["name_required", "name_too_long", "mobile_invalid", "email_invalid"] as const) {
    assert.ok(jobApplicationInputMessage(e).length > 10, `${e} has a real message`);
  }
}

// ── What the model is allowed to hand back ───────────────────────────
{
  const x = parseJobCvExtract(
    JSON.stringify({
      fullName: "Priya Sharma",
      mobile: "+91-99191-01755",
      email: "priya@example.com",
      subjects: ["Maths", "maths", "Science"],
      classes: ["VI-VIII"],
      qualification: "M.Sc Mathematics, B.Ed",
      experienceYears: "7",
      currentEmployer: "Sunrise Public School",
      notes: "",
      missing: [],
    }),
  );
  assert.ok(x);
  assert.equal(x!.mobile, "9919101755");
  assert.deepEqual(x!.subjects, ["Maths", "Science"], "deduped, case-insensitively");
  assert.equal(x!.experienceYears, "7");
  assert.ok(jobCvExtractIsUsable(x));

  // A model that returns rubbish must not write rubbish into a record.
  const junk = parseJobCvExtract(
    JSON.stringify({
      fullName: "X",
      mobile: "12",
      email: "not an email",
      subjects: "Maths",
      classes: null,
      experienceYears: "99",
    }),
  );
  assert.ok(junk);
  assert.equal(junk!.mobile, "", "a 2-digit mobile is not a mobile");
  assert.equal(junk!.email, "", "a line that is not an address is not an address");
  assert.deepEqual(junk!.subjects, [], "a string is not a list");
  assert.deepEqual(junk!.classes, []);
  assert.equal(junk!.experienceYears, "", "99 years of teaching is a misread");
  assert.equal(jobCvExtractIsUsable(junk), false, "nothing to route on");

  assert.equal(parseJobCvExtract("not json"), null);
  assert.equal(parseJobCvExtract("[]"), null);
  assert.equal(jobCvExtractIsUsable(null), false);

  // Usable means the office can DO something: a number to ring, or a
  // subject to match. A name alone is not.
  assert.equal(
    jobCvExtractIsUsable(parseJobCvExtract(JSON.stringify({ fullName: "Priya" }))),
    false,
  );
  assert.equal(
    jobCvExtractIsUsable(parseJobCvExtract(JSON.stringify({ subjects: ["Maths"] }))),
    true,
  );
}

// ── The line the principal actually reads ────────────────────────────
{
  const app = (over: Partial<JobApplication> = {}): JobApplication => ({
    id: "job_1",
    source: "careers_page",
    applicantName: "Priya Sharma",
    mobile: "9919101755",
    email: "",
    cvPath: "careers/2026/x.pdf",
    cvMime: "application/pdf",
    subjectWords: ["Maths"],
    classWords: ["VI-VIII"],
    subjectIds: ["sub_math"],
    classIds: ["cls_vi", "cls_vii", "cls_viii"],
    qualification: "M.Sc, B.Ed",
    experienceYears: "7",
    currentEmployer: "",
    ocrStatus: "ok",
    ocrNotes: "",
    status: "new",
    createdAt: "2026-09-08T04:00:00.000Z",
    reviewedBy: "",
    reviewedAt: "",
    ...over,
  });

  const masters = { classes, subjects };
  assert.equal(
    jobApplicationSummary(app(), masters),
    "Priya Sharma — Mathematics · VI–VIII · 7 yr",
  );
  // Nothing matched: the applicant's own words carry the line rather than
  // it going blank, because a blank line tells the principal nothing.
  assert.match(
    jobApplicationSummary(
      app({ subjectIds: [], classIds: [], subjectWords: ["Robotics"], classWords: ["XI-XII"] }),
      masters,
    ),
    /Robotics/,
  );
  assert.match(
    jobApplicationSummary(app({ subjectIds: [], subjectWords: [] }), masters),
    /subject not stated/,
  );

  assert.equal(shortClassRange(["VI", "VII", "VIII"]), "VI–VIII");
  assert.equal(shortClassRange(["IX", "X"]), "IX, X");
  assert.equal(shortClassRange([]), "");
  assert.deepEqual(subjectLabelsFor(["sub_math", "nope"], subjects), ["Mathematics"]);

  // Order: an unreadable CV comes first however old it is, because it is
  // the one that otherwise looks empty rather than urgent and is never
  // opened. Handled applications sink.
  const sorted = sortJobApplications([
    app({ id: "a", createdAt: "2026-09-08T10:00:00Z" }),
    app({ id: "b", createdAt: "2026-09-01T10:00:00Z", ocrStatus: "failed" }),
    app({ id: "c", createdAt: "2026-09-09T10:00:00Z", status: "rejected" }),
    app({ id: "d", createdAt: "2026-09-07T10:00:00Z" }),
  ]);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["b", "a", "d", "c"],
    "unreadable first, then newest new, then anything already handled",
  );
}

console.log("OK");
