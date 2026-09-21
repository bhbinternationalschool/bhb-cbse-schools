/**
 * Self-test: the job desk (job seekers in, "koi maths ka CV hai?" out) and
 * the family card found by a parent's name.
 * Run: npx tsx src/lib/jobDesk.selftest.ts
 *
 * What must hold:
 *  - a job seeker is told where to send the CV, including the job email;
 *  - what a CV did not say is asked for, and the typed answer is read;
 *  - the school's questions, the way they are actually asked, find the list;
 *  - a leave or fee "application" is never read as a job one;
 *  - a parent's name finds the family, never half the school by surname.
 */

import assert from "node:assert/strict";

import {
  classWordsIn,
  composeJobAsk,
  composeJobWelcome,
  filterJobApplicants,
  formatJobApplicantsReply,
  jobApplicantPicks,
  jobCvArchiveFileName,
  jobCvArchiveFolder,
  jobDetailsFound,
  jobMissingFields,
  parseJobApplicantsQuery,
  parseJobDetailsReply,
  qualificationIn,
  subjectWordsIn,
} from "./jobDesk";
import { matchClassWords } from "./jobApplications";
import type { JobApplication } from "./jobApplications";
import type { SchoolClass } from "./masters";
import {
  familyCardPicks,
  familyNameMatches,
  formatFamilyCard,
  formatFamilyChoice,
  parseErpCommandLocal,
  parseFamilyQuery,
} from "./erpCommands";

console.log("jobDesk.selftest.ts");

/* ── A job seeker's typed details ────────────────────────────────── */
{
  const r = parseJobDetailsReply("Maths, class 6-8, M.Sc B.Ed, 5 saal");
  assert.deepEqual(r, { subjectWords: ["Maths"], classWords: ["6-8"], qualification: "M.Sc, B.Ed", experienceYears: "5" });
  assert.deepEqual(parseJobDetailsReply("गणित कक्षा 1 से 5 बी.एड").classWords, ["1-5"]);
  assert.equal(parseJobDetailsReply("गणित कक्षा 1 से 5 बी.एड").qualification, "बी.एड");
  assert.deepEqual(parseJobDetailsReply("English PRT, BA B.Ed CTET"), { subjectWords: ["English"], classWords: ["Primary"], qualification: "BA, B.Ed, CTET", experienceYears: "" });
  assert.deepEqual(classWordsIn("TGT science"), ["6-10"], "TGT is VI–X");
  assert.deepEqual(classWordsIn("PGT physics"), ["Senior secondary"], "kept as words; the school has no XI–XII to map it onto");
  assert.deepEqual(classWordsIn("nursery and KG teacher"), ["Pre-primary"]);
  assert.deepEqual(classWordsIn("upper primary"), ["Middle"], "not also Primary");
  assert.deepEqual(classWordsIn("10 years experience"), [], "years are not classes");
  assert.deepEqual(subjectWordsIn("science and social science"), ["Science", "Social Science"]);
  assert.deepEqual(subjectWordsIn("social science only"), ["Social Science"], "the longer reading");
  assert.equal(qualificationIn("ma math ka teacher hu"), "", "Hinglish 'ma' is not an M.A.");
  assert.equal(qualificationIn("MA English, B.Ed"), "MA, B.Ed");
  assert.equal(jobDetailsFound(parseJobDetailsReply("ok thank you")), false);
  assert.equal(jobDetailsFound(parseJobDetailsReply("hindi")), true);
}

/* ── What to ask, and how the bot greets a job seeker ────────────── */
{
  const app = { subjectWords: ["Maths"], classWords: [], qualification: "" };
  assert.deepEqual(jobMissingFields(app), ["classes", "qualification"]);
  const hi = composeJobAsk(["classes", "qualification"], true, true);
  assert.match(hi, /बायोडाटा मिल गया/);
  assert.match(hi, /कक्षाओं/);
  assert.match(hi, /योग्यता/);
  assert.doesNotMatch(hi, /विषय\*/, "only what is missing is asked");
  const en = composeJobAsk(["subjects"], false, false);
  assert.match(en, /^Please send these in one message/);

  const w = composeJobWelcome("Neha", "jobs@example.school", "BHB International", false);
  assert.match(w, /CV \/ resume here/);
  assert.match(w, /email it to \*jobs@example\.school\*/, "the job email is in the first reply");
  const wh = composeJobWelcome("नेहा", "jobs@example.school", "BHB International", true);
  assert.match(wh, /ईमेल करें: \*jobs@example\.school\*/);
  assert.doesNotMatch(composeJobWelcome("Neha", "", "BHB", false), /email it/, "no address, no line");
}

/* ── The school asking ───────────────────────────────────────────── */
{
  const q = (t: string) => parseJobApplicantsQuery(t);
  assert.deepEqual(q("kya koi math ke liye apply kiya hai")?.subjectWords, ["Maths"]);
  assert.ok(q("koi resume hai"));
  assert.deepEqual(q("primary ke liye cv")?.classWords, ["Primary"]);
  assert.deepEqual(q("kya koi primary ke liye cv hai")?.classWords, ["Primary"]);
  assert.deepEqual(q("english teacher applications")?.subjectWords, ["English"]);
  assert.ok(q("job applications"));
  assert.deepEqual(q("naye biodata")?.statuses, ["new"]);
  assert.deepEqual(q("shortlisted candidates")?.statuses, ["shortlisted"]);
  assert.deepEqual(q("hindi ke liye koi aavedan aaya")?.subjectWords, ["Hindi"]);
  assert.equal(q("cv job_abc123")?.cvFor, "job_abc123", "a picked number sends that CV");
  // Not job applications.
  assert.equal(q("leave application"), null);
  assert.equal(q("apply leave"), null);
  assert.equal(q("Aarav ki fees"), null);
  assert.equal(q("admission application status"), null);

  // The desk routes them, before the report parse reads "list" as a PDF.
  assert.equal(parseErpCommandLocal("kya koi primary ke liye cv hai")?.commandId, "job_applicants");
  assert.equal(parseErpCommandLocal("cv list")?.commandId, "job_applicants");
  assert.equal(parseErpCommandLocal("leave application")?.commandId === "job_applicants", false);

  const classes = [
    { id: "c1", name: "I", groupCode: "PRIMARY" },
    { id: "c5", name: "V", groupCode: "PRIMARY" },
    { id: "c6", name: "VI", groupCode: "MIDDLE" },
    { id: "c8", name: "VIII", groupCode: "MIDDLE" },
    { id: "cn", name: "Nursery", groupCode: "PRE_PRIMARY" },
  ].map((c, i) => ({ ...c, isActive: true, sortOrder: i })) as unknown as SchoolClass[];
  assert.deepEqual(matchClassWords(["Primary"], classes).ids, ["c1", "c5"]);

  const app = (id: string, over: Partial<JobApplication>): JobApplication => ({
    id, source: "whatsapp", applicantName: id, mobile: "9876543210", email: "", cvPath: "careers/x.pdf", cvMime: "application/pdf",
    subjectWords: [], classWords: [], subjectIds: [], classIds: [], qualification: "", experienceYears: "", currentEmployer: "",
    ocrStatus: "ok", ocrNotes: "", status: "new", createdAt: "2026-09-20T10:00:00Z", reviewedBy: "", reviewedAt: "", ...over,
  });
  const apps = [
    app("neha", { subjectWords: ["Maths"], subjectIds: ["s_math"], classIds: ["c1", "c5"], createdAt: "2026-09-21T05:00:00Z" }),
    app("ravi", { subjectWords: ["Maths", "Science"], subjectIds: ["s_math", "s_sci"], classIds: ["c6", "c8"] }),
    app("anu", { subjectWords: ["Robotics"], classIds: [] }),
    app("old", { subjectWords: ["Maths"], subjectIds: ["s_math"], status: "rejected" }),
    app("nocls", { subjectWords: ["Maths"], subjectIds: ["s_math"], classIds: [] }),
  ];
  const f = (o: Partial<Parameters<typeof filterJobApplicants>[1]>) =>
    filterJobApplicants(apps, { subjectIds: [], subjectWords: [], classIds: [], statuses: [], ...o });
  assert.deepEqual(f({ subjectIds: ["s_math"], subjectWords: ["Maths"] }).rows.map((a) => a.id), ["neha", "ravi", "nocls"], "newest first; rejected left out");
  const primaryMaths = f({ subjectIds: ["s_math"], subjectWords: ["Maths"], classIds: ["c1", "c5"] });
  assert.deepEqual(primaryMaths.rows.map((a) => a.id), ["neha"]);
  assert.equal(primaryMaths.classUnknown, 1, "the one who didn't say their classes is counted, not hidden");
  assert.deepEqual(f({ subjectWords: ["Robotics"] }).rows.map((a) => a.id), ["anu"], "a subject the school has no master for is still findable");
  assert.deepEqual(f({ statuses: ["rejected"] }).rows.map((a) => a.id), ["old"]);

  const rows = [
    { id: "job_1", name: "Neha Verma", subjects: "Maths", classes: "I–V", qualification: "M.Sc, B.Ed", experienceYears: "4", mobile: "919876543210", appliedOn: "2026-09-21T05:00:00Z", status: "new" as const, hasCv: true, driveUrl: "" },
    { id: "job_2", name: "", subjects: "", classes: "", qualification: "", experienceYears: "", mobile: "", appliedOn: "", status: "shortlisted" as const, hasCv: false, driveUrl: "" },
  ];
  const text = formatJobApplicantsReply({ title: "Maths · Primary", rows, total: 2, classUnknown: 1, careersEmail: "jobs@x" });
  assert.match(text, /^\*Job applicants · Maths · Primary\* — 2 found/);
  assert.match(text, /\*1\.\* Neha Verma — Maths · I–V\n   M\.Sc, B\.Ed · 4 yr · applied 21 Sep\n   📞 \+91 98765 43210 · CV ✓/);
  assert.match(text, /\*2\.\* Name not given — subject not stated\n   shortlisted\n   📞 no number · no CV yet/);
  assert.match(text, /1 more didn't say which classes/);
  assert.match(text, /Send a number to get that CV here/);
  assert.deepEqual(jobApplicantPicks(rows).map((p) => [p.n, p.rerunText]), [[1, "cv job_1"], [2, "cv job_2"]]);
  const none = formatJobApplicantsReply({ title: "Urdu", rows: [], total: 0, classUnknown: 0, careersEmail: "jobs@x" });
  assert.match(none, /Nobody has applied for this yet/);
  assert.match(none, /jobs@x/);

  // Drive: one folder per job seeker.
  const at = new Date("2026-09-21T10:00:00Z");
  assert.deepEqual(jobCvArchiveFolder("Neha / Verma", "9876543210", at), ["Careers", "2026", "Neha Verma – 9876543210"]);
  assert.equal(jobCvArchiveFileName("Neha Verma", "application/pdf", at), "Neha Verma CV 2026-09-21.pdf");
  assert.equal(jobCvArchiveFileName("", "image/jpeg", at), "CV CV 2026-09-21.jpg");
}

/* ── A family by a parent's name ─────────────────────────────────── */
{
  assert.equal(parseFamilyQuery("Ramesh Singh ke bachche"), "Ramesh Singh");
  assert.equal(parseFamilyQuery("Ramesh Singh ka parivar"), "Ramesh Singh");
  assert.equal(parseFamilyQuery("parent Ramesh Singh"), "Ramesh Singh");
  assert.equal(parseFamilyQuery("father Mr. Ramesh Singh"), "Ramesh Singh");
  assert.equal(parseFamilyQuery("पिता रमेश सिंह"), "रमेश सिंह");
  assert.equal(parseFamilyQuery("रमेश सिंह के बच्चे"), "रमेश सिंह");
  assert.equal(parseFamilyQuery("Ramesh Singh family"), "Ramesh Singh");
  assert.equal(parseFamilyQuery("family hh:ahh_1"), "hh:ahh_1", "a picked number opens that household");
  assert.equal(parseFamilyQuery("class 5 ke bachche"), null, "a class, not a parent");
  assert.equal(parseFamilyQuery("Ramesh Singh"), null, "a bare name is the server's call, after the children");
  assert.equal(parseErpCommandLocal("Ramesh Singh ke bachche")?.commandId, "family_card");
  assert.equal(parseErpCommandLocal("class 3 ke bachche")?.commandId, "class_roster");

  const AY = "2026-27";
  const kid = (id: string, fullName: string, householdId: string, fatherName: string, motherName = "", over = {}) => ({
    id, fullName, householdId, fatherName, motherName, rollNo: "", classId: "c", sectionId: "s", status: "active", academicYearCode: AY, ...over,
  });
  const roster = [
    kid("a", "Aarav Singh", "h1", "Ramesh Singh", "Sita Singh"),
    kid("b", "Riya Singh", "h1", "Ramesh Singh", "Sita Singh"),
    kid("c", "Om Yadav", "h2", "Ramesh Yadav"),
    kid("d", "Kiran Singh", "h3", "Ramesh Kumar Singh"),
    kid("e", "Old Row", "h1", "Ramesh Singh", "", { academicYearCode: "2025-26" }),
    kid("f", "Vaibhav Pandey", "h4", "Rakesh Pandey"),
  ];
  const m = (name: string, allowSingleWord = false) =>
    familyNameMatches(name, roster, { academicYearCode: AY, guardianOf: (id) => (id === "h2" ? "Sunita Yadav" : ""), allowSingleWord });
  const ramesh = m("Ramesh Singh");
  assert.deepEqual(ramesh.map((x) => x.householdId).sort(), ["h1", "h3"], "Ramesh Singh and Ramesh Kumar Singh — the desk asks which");
  assert.deepEqual(ramesh.find((x) => x.householdId === "h1")!.childIds, ["a", "b"], "both children, this year's rows only");
  assert.equal(ramesh.find((x) => x.householdId === "h1")!.asWho, "Father Ramesh Singh");
  assert.deepEqual(m("Sita Singh").map((x) => x.asWho), ["Mother Sita Singh"]);
  assert.deepEqual(m("Sunita Yadav").map((x) => x.asWho), ["Guardian Sunita Yadav"]);
  assert.deepEqual(m("राकेश पांडे").map((x) => x.householdId), ["h4"], "typed in Hindi, found by sound");
  assert.deepEqual(m("Singh"), [], "one surname is half the school");
  assert.deepEqual(m("Ramesh", true).length, 3, "…unless the asker said it is a parent");
  assert.deepEqual(m("good morning"), []);

  const card = formatFamilyCard({
    asWho: "Father Ramesh Singh",
    locality: "Ayar, Varanasi",
    contacts: [
      { label: "Guardian Ramesh Singh", mobile: "9876543210" },
      { label: "Father Ramesh Singh", mobile: "+91 98765 43210" },
      { label: "Mother Sita Singh", mobile: "9123456789" },
    ],
    callable: true,
    showDues: true,
    storeUnread: false,
    formatInr: (p) => `₹${p / 100}`,
    children: [
      { studentId: "a", name: "Aarav Singh", classLabel: "V A", rollNo: "3", admissionNo: "A12", feesPaise: 3_300_00, transportPaise: 1_200_00, storePaise: 0, aheadPaise: 19_800_00 },
      { studentId: "b", name: "Riya Singh", classLabel: "II A", rollNo: "", admissionNo: "", feesPaise: 0, transportPaise: 0, storePaise: 0, aheadPaise: 0 },
    ],
  });
  assert.match(card, /^\*Family\* · Father Ramesh Singh\nAyar, Varanasi\n📞 Guardian Ramesh Singh: \+91 98765 43210\n📞 Mother Sita Singh: \+91 91234 56789\n/);
  assert.match(card, /\*1\.\* Aarav Singh · V A · Roll 3 · Adm A12\n   Due now \*₹4500\* \(fees ₹3300 \+ bus ₹1200\)/);
  assert.match(card, /\*2\.\* Riya Singh · II A\n   Nothing due ✅/);
  assert.match(card, /Family total due now: \*₹4500\*/);
  assert.match(card, /Not yet due \(later months\): ₹19800/);
  const masked = formatFamilyCard({
    asWho: "Father Ramesh Singh", locality: "", contacts: [{ label: "Family", mobile: "9876543210" }],
    callable: false, showDues: false, storeUnread: false, formatInr: (p) => `₹${p}`,
    children: [{ studentId: "a", name: "Aarav Singh", classLabel: "V A", rollNo: "", admissionNo: "", feesPaise: 100, transportPaise: 0, storePaise: 0, aheadPaise: 0 }],
  });
  assert.match(masked, /📞 Family: 98xxxxxx10/, "masked for a teacher of none of these children");
  assert.doesNotMatch(masked, /Due now|total/, "dues only with fees · view");
  assert.deepEqual(familyCardPicks([{ studentId: "a", name: "Aarav", classLabel: "", rollNo: "", admissionNo: "", feesPaise: 0, transportPaise: 0, storePaise: 0, aheadPaise: 0 }]).map((p) => [p.n, p.commandId, p.studentId]), [[1, "student_fees", "a"]]);
  assert.match(formatFamilyChoice("Ramesh Singh", [{ asWho: "Father Ramesh Singh", childNames: ["Aarav", "Riya"] }, { asWho: "Father Ramesh Kumar Singh", childNames: ["Kiran"] }]), /\*1\.\* Father Ramesh Singh — Aarav, Riya\n\*2\.\* Father Ramesh Kumar Singh — Kiran/);
}

console.log("  ok");
