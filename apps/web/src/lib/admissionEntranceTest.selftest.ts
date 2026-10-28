import assert from "node:assert/strict";

import {
  ENTRANCE_INVITE_FAMILY,
  ENTRANCE_RESULT_FAMILY,
  SEND_CLAIM_MS,
  absentConflict,
  candidateScore,
  recomputeRuleResults,
  ruleInputsChanged,
  sendClaimBlock,
  classSummary,
  cleanMarks,
  entranceMessageVars,
  fillTemplateBody,
  formatTestDate,
  formatTestTime,
  nextRollNumbers,
  normalizeSubjects,
  parseMarkInput,
  rankCandidates,
  resultLines,
  ruleStatusChanges,
  subjectChangeProblem,
  suggestedStatus,
  tenDigitMobile,
  validateSessionInput,
  type EntranceCandidate,
  type EntranceSession,
} from "./admissionEntranceTest";
import { seedTemplateText } from "./waTemplates";

console.log("admissionEntranceTest.selftest.ts");

const SUBJECTS = [
  { id: "en", name: "English", maxMarks: 25 },
  { id: "ma", name: "Maths", maxMarks: 25 },
];

const SESSION: EntranceSession = {
  id: "sess1",
  academicYearCode: "2027-28",
  name: "April test",
  testDate: "2026-11-14",
  startTime: "10:00",
  venue: "Room 4",
  classIds: ["c6", "c7"],
  subjects: SUBJECTS,
  passPercent: 40,
  waitlistPercent: 30,
  notes: "",
  updatedAt: "2026-10-11T10:00:00+00:00",
};

function cand(over: Partial<EntranceCandidate>): EntranceCandidate {
  return {
    id: "x",
    sessionId: "sess1",
    leadId: "lead",
    rollNo: "001",
    childName: "Aarav",
    guardianName: "Priya",
    mobile: "9876543210",
    classId: "c6",
    applicationNo: "",
    enquiryNo: "",
    absent: false,
    marks: {},
    resultStatus: "",
    statusSource: "",
    statusSetBy: "",
    statusSetAt: "",
    inviteSentAt: "",
    resultSentAt: "",
    inviteClaimedAt: "",
    resultClaimedAt: "",
    updatedAt: "t",
    ...over,
  };
}

// Session input: refuse rather than guess — no year is an error, never a fallback.
{
  const base = {
    name: "Test",
    academicYearCode: "2027-28",
    testDate: "2026-11-14",
    startTime: "10:00",
    classIds: ["c6"],
    subjects: SUBJECTS,
    passPercent: 40,
  };
  assert.equal(validateSessionInput(base).ok, true);
  assert.equal(validateSessionInput({ ...base, academicYearCode: "" }).ok, false, "unknown year refused");
  assert.equal(validateSessionInput({ ...base, testDate: "" }).ok, false, "no date is not today");
  assert.equal(validateSessionInput({ ...base, classIds: [] }).ok, false);
  assert.equal(validateSessionInput({ ...base, startTime: "25:00" }).ok, false);
  assert.equal(validateSessionInput({ ...base, passPercent: 140 }).ok, false);
  assert.equal(validateSessionInput({ ...base, waitlistPercent: 40 }).ok, false, "waitlist must sit below pass");
  const v = validateSessionInput({ ...base, waitlistPercent: "" });
  assert.ok(v.ok && v.draft.waitlistPercent === null, "blank waitlist = no band");
}

// Subjects: names required, duplicates refused, ids minted stable and unique.
{
  assert.equal(normalizeSubjects([]).ok, false);
  assert.equal(normalizeSubjects([{ name: "A", maxMarks: 0 }]).ok, false);
  assert.equal(normalizeSubjects([{ name: "A", maxMarks: 10 }, { name: "a", maxMarks: 10 }]).ok, false);
  const r = normalizeSubjects([{ name: "A", maxMarks: 10 }, { id: "keep", name: "B", maxMarks: 5 }]);
  assert.ok(r.ok);
  assert.deepEqual(r.subjects.map((s) => s.id), ["s1", "keep"]);
}

// Marks: blank = not entered; over-max is an error, never clamped.
{
  assert.deepEqual(parseMarkInput("", 25), { ok: true, value: null });
  assert.deepEqual(parseMarkInput("18.5", 25), { ok: true, value: 18.5 });
  assert.equal(parseMarkInput("26", 25).ok, false);
  assert.equal(parseMarkInput("-1", 25).ok, false);
  assert.equal(parseMarkInput("ab", 25).ok, false);

  const ok = cleanMarks({ en: 20, ma: null }, SUBJECTS);
  assert.ok(ok.ok && ok.marks.en === 20 && !("ma" in ok.marks), "null = not entered, not 0");
  assert.equal(cleanMarks({ zz: 3 }, SUBJECTS).ok, false, "unknown subject refused, not dropped");
  assert.equal(cleanMarks({ en: 30 }, SUBJECTS).ok, false);
}

// Score: a blank subject means no total and no result — never a zero.
{
  const half = cand({ marks: { en: 20 } });
  const s = candidateScore(SESSION, half);
  assert.equal(s.complete, false);
  assert.equal(s.total, null);
  assert.equal(s.percent, null);
  assert.equal(s.entered, 20);
  assert.deepEqual(s.missing, ["ma"]);
  assert.equal(suggestedStatus(SESSION, half), null, "incomplete → no suggestion");

  assert.equal(suggestedStatus(SESSION, cand({ marks: { en: 10, ma: 10 } })), "selected", "40% = pass mark → selected");
  assert.equal(suggestedStatus(SESSION, cand({ marks: { en: 8, ma: 8 } })), "waitlisted", "32% in band");
  assert.equal(suggestedStatus(SESSION, cand({ marks: { en: 5, ma: 5 } })), "not_selected");
  assert.equal(suggestedStatus(SESSION, cand({ absent: true, marks: { en: 25, ma: 25 } })), "absent");
  assert.equal(
    suggestedStatus({ ...SESSION, waitlistPercent: null }, cand({ marks: { en: 8, ma: 8 } })),
    "not_selected",
    "no band → below pass is not selected",
  );
  assert.equal(candidateScore(SESSION, cand({ marks: { en: 10, ma: 7 } })).percent, 34);
}

// Bulk rule: manual decisions kept, incomplete skipped and counted.
{
  const list = [
    cand({ id: "a", marks: { en: 20, ma: 20 } }),
    cand({ id: "b", marks: { en: 1, ma: 1 }, resultStatus: "selected", statusSource: "manual" }),
    cand({ id: "c", marks: { en: 1 } }),
    cand({ id: "d", marks: { en: 20, ma: 20 }, resultStatus: "selected", statusSource: "rule" }),
  ];
  const r = ruleStatusChanges(SESSION, list);
  assert.deepEqual(r.changes, [{ id: "a", status: "selected", source: "rule" }]);
  assert.equal(r.skippedManual, 1);
  assert.equal(r.skippedIncomplete, 1);
  const all = ruleStatusChanges(SESSION, list, { includeManual: true });
  assert.ok(all.changes.some((c) => c.id === "b" && c.status === "not_selected"), "override only when asked");

  const ranked = rankCandidates(SESSION, list).map((c) => c.id);
  assert.equal(ranked[ranked.length - 1], "c", "incomplete ranks last");
}

// Subjects may not change under entered marks.
{
  const withMarks = [cand({ marks: { en: 20, ma: 10 } })];
  assert.ok(subjectChangeProblem([SUBJECTS[0]!], withMarks), "dropping a subject with marks refused");
  assert.ok(subjectChangeProblem([{ id: "en", name: "English", maxMarks: 15 }, SUBJECTS[1]!], withMarks), "max below a mark refused");
  assert.equal(subjectChangeProblem([...SUBJECTS, { id: "gk", name: "GK", maxMarks: 10 }], withMarks), null);
}

// Roll numbers continue after the highest; gaps are not reused.
{
  assert.deepEqual(nextRollNumbers([], 2), ["001", "002"]);
  assert.deepEqual(nextRollNumbers(["001", "003"], 2), ["004", "005"]);
}

// Summary: absent ≠ appeared; undecided ≠ not selected.
{
  const rows = classSummary(
    [SESSION],
    [
      cand({ id: "1", classId: "c6", marks: { en: 20, ma: 20 }, resultStatus: "selected" }),
      cand({ id: "2", classId: "c6", absent: true, resultStatus: "absent" }),
      cand({ id: "3", classId: "c6", marks: { en: 9, ma: 9 }, resultStatus: "waitlisted" }),
      cand({ id: "4", classId: "c7", marks: { en: 3 } }),
    ],
    (id) => ({ c6: "VI", c7: "VII" })[id] ?? "",
  );
  const vi = rows.find((r) => r.classId === "c6")!;
  assert.equal(vi.onRoll, 3);
  assert.equal(vi.appeared, 2);
  assert.equal(vi.absent, 1);
  assert.equal(vi.selected, 1);
  assert.equal(vi.waitlisted, 1);
  assert.equal(vi.topPercent, 80);
  assert.equal(vi.averagePercent, 58);
  const vii = rows.find((r) => r.classId === "c7")!;
  assert.equal(vii.undecided, 1);
  assert.equal(vii.notSelected, 0);
  assert.equal(vii.averagePercent, null);
}

// Dates/times in both languages, computed without a time zone.
{
  assert.equal(formatTestDate("2026-11-14", "en"), "Sat, 14 Nov 2026");
  assert.equal(formatTestDate("2026-11-14", "hi"), "शनिवार, 14 नवंबर 2026");
  assert.equal(formatTestTime("10:00", "en"), "10:00 AM");
  assert.equal(formatTestTime("14:30", "en"), "2:30 PM");
  assert.equal(formatTestTime("10:00", "hi"), "सुबह 10:00");
  assert.equal(formatTestTime("", "en"), "");
  assert.equal(tenDigitMobile("+91 98765 43210"), "9876543210");
  assert.equal(tenDigitMobile("12345"), null);
}

// Family messages: both templates exist in both languages, every variable is
// filled, and the facts survive in Hindi as well as English.
{
  for (const fam of [ENTRANCE_INVITE_FAMILY, ENTRANCE_RESULT_FAMILY]) {
    for (const lang of ["en", "hi"] as const) {
      assert.ok(seedTemplateText(fam, lang), `${fam}/${lang} seed exists`);
    }
  }
  const c = cand({ rollNo: "014", resultStatus: "selected" });
  for (const lang of ["en", "hi"] as const) {
    const inv = entranceMessageVars("invite", SESSION, c, { lang, className: "VI", schoolName: "BHB" });
    assert.ok(inv.ok);
    const text = fillTemplateBody(seedTemplateText(ENTRANCE_INVITE_FAMILY, lang)!.body, inv.vars);
    assert.ok(!/\{\{/.test(text), `invite ${lang} fully filled: ${text}`);
    for (const fact of ["Aarav", "014", "Room 4", "14", "VI"]) assert.ok(text.includes(fact), `invite ${lang} keeps ${fact}`);

    const res = entranceMessageVars("result", SESSION, c, { lang, className: "VI", schoolName: "BHB" });
    assert.ok(res.ok);
    const rtext = fillTemplateBody(seedTemplateText(ENTRANCE_RESULT_FAMILY, lang)!.body, res.vars);
    assert.ok(!/\{\{/.test(rtext), `result ${lang} fully filled`);
    assert.ok(rtext.includes(resultLines("selected", lang).testResult));
  }
  assert.ok(/[ऀ-ॿ]/.test(resultLines("not_selected", "hi").testResult), "Hindi result is Hindi");
  // No result yet → nothing to say; no venue → no invitation.
  assert.equal(entranceMessageVars("result", SESSION, cand({}), { lang: "hi", className: "VI", schoolName: "BHB" }).ok, false);
  assert.equal(
    entranceMessageVars("invite", { ...SESSION, venue: " " }, c, { lang: "hi", className: "VI", schoolName: "BHB" }).ok,
    false,
  );
  // Absent with no result recorded still reads as absent.
  const ab = entranceMessageVars("result", SESSION, cand({ absent: true }), { lang: "en", className: "VI", schoolName: "BHB" });
  assert.ok(ab.ok && ab.vars.testResult === resultLines("absent", "en").testResult);
  // A gap stays visible in a preview rather than vanishing.
  assert.equal(fillTemplateBody("Hi {{a}} {{b}}", { a: "x" }), "Hi x {{b}}");
}

// Changing the rule re-works rule results only; hand decisions stay.
{
  const list = [
    cand({ id: "r1", marks: { en: 10, ma: 10 }, resultStatus: "selected", statusSource: "rule" }),
    cand({ id: "m1", marks: { en: 10, ma: 10 }, resultStatus: "selected", statusSource: "manual" }),
    cand({ id: "r2", marks: { en: 25, ma: 25 }, resultStatus: "selected", statusSource: "rule" }),
    cand({ id: "u1", marks: { en: 10, ma: 10 } }),
  ];
  const stricter = { ...SESSION, passPercent: 60, waitlistPercent: null };
  assert.ok(ruleInputsChanged(SESSION, stricter));
  assert.equal(ruleInputsChanged(SESSION, { ...SESSION, subjects: [...SUBJECTS].reverse() }), false, "order is not a change");
  assert.ok(ruleInputsChanged(SESSION, { ...SESSION, subjects: [SUBJECTS[0]!, { ...SUBJECTS[1]!, maxMarks: 30 }] }));
  assert.deepEqual(recomputeRuleResults(stricter, list), [{ id: "r1", status: "not_selected", source: "rule" }]);
  const withNewSubject = { ...SESSION, subjects: [...SUBJECTS, { id: "gk", name: "GK", maxMarks: 10 }] };
  assert.deepEqual(
    recomputeRuleResults(withNewSubject, list).map((x) => [x.id, x.status, x.source]),
    [["r1", "", ""], ["r2", "", ""]],
    "a new blank subject makes rule results undecided, never stale",
  );
}

// Absent over a hand-set result is refused; over a rule result it is fine.
{
  const manual = cand({ resultStatus: "selected", statusSource: "manual" });
  assert.ok(absentConflict(manual, true)?.includes("Selected"));
  assert.equal(absentConflict(manual, false), null);
  assert.equal(absentConflict(cand({ resultStatus: "selected", statusSource: "rule" }), true), null);
  assert.equal(absentConflict(cand({ resultStatus: "absent", statusSource: "manual" }), true), null);
  assert.equal(absentConflict(cand({ absent: true, resultStatus: "selected", statusSource: "manual" }), true), null, "already absent");
}

// Send claims: a live claim blocks everyone; a stale one lapses; sent blocks unless re-sending.
{
  const now = Date.parse("2026-11-14T10:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  assert.equal(sendClaimBlock(cand({}), "invite", false, now), null);
  assert.ok(sendClaimBlock(cand({ inviteClaimedAt: iso(now - 60_000) }), "invite", false, now)?.includes("in progress"));
  assert.ok(sendClaimBlock(cand({ inviteClaimedAt: iso(now - 60_000) }), "invite", true, now), "re-send also waits for a live claim");
  assert.equal(sendClaimBlock(cand({ inviteClaimedAt: iso(now - SEND_CLAIM_MS - 1) }), "invite", false, now), null, "stale claim lapses");
  assert.ok(sendClaimBlock(cand({ inviteSentAt: iso(now - 86_400_000) }), "invite", false, now)?.startsWith("Already sent"));
  assert.equal(sendClaimBlock(cand({ inviteSentAt: iso(now - 86_400_000) }), "invite", true, now), null);
  assert.ok(
    sendClaimBlock(cand({ resultSentAt: iso(now - 30_000), resultClaimedAt: iso(now - 40_000) }), "result", true, now)?.includes("wait"),
    "double-clicked re-send refused",
  );
  assert.equal(sendClaimBlock(cand({ inviteClaimedAt: iso(now - 1000) }), "result", false, now), null, "kinds are independent");
}

console.log("  ok");
