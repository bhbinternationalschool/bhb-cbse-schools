import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SurveyAttendance, SurveyTeamMember, SurveyWorkSession } from "./admissions";
import { mergeFieldOps, type FieldOpsLists } from "./admissionsFieldOpsMerge";

console.log("admissionsFieldOpsMerge.selftest.ts");

/**
 * The admissions survey lists are one JSON row every admissions save wrote
 * whole. A copy read before a field agent checked in, or a session started
 * on the staff app, deleted it; an older copy put an ended session back to
 * running. Now each list merges by id onto the stored one.
 */

const empty: FieldOpsLists = {
  surveyBeats: [], surveyAttendance: [], surveyExternals: [], surveyTeam: [], surveySessions: [], leadCallerStaffIds: [],
};
const att = (id: string, checkOutAt = ""): SurveyAttendance =>
  ({ id, date: "2026-10-10", agentName: "A", checkInAt: "09:00", checkOutAt, beatId: "b1", note: "" }) as SurveyAttendance;
const ses = (id: string, status: SurveyWorkSession["status"], breaks = 0): SurveyWorkSession =>
  ({ id, date: "2026-10-10", memberId: "m", agentName: "A", staffId: "", beatId: "b1", startedAt: "09:00", endedAt: status === "ended" ? "13:00" : "", startGeo: null, endGeo: null, breaks: Array.from({ length: breaks }, () => ({})), status }) as unknown as SurveyWorkSession;
const member = (id: string) => ({ id, kind: "staff", fullName: id }) as SurveyTeamMember;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

// An office tab's copy (read at 08:00) saves after the field agents started.
const stored: FieldOpsLists = {
  ...empty,
  surveyAttendance: [att("a1", "13:05"), att("a2")],
  surveySessions: [ses("s1", "ended", 2), ses("s2", "on_break", 1)],
  surveyTeam: [member("m1"), member("m2")],
  leadCallerStaffIds: ["st1", "st2"],
};
const office: FieldOpsLists = {
  ...empty,
  surveyAttendance: [att("a1")], // stale: no check-out yet
  surveySessions: [ses("s1", "active", 1), ses("s3", "active")], // stale s1; new s3
  surveyTeam: [member("m1"), member("m3")], // never had m2; added m3
  leadCallerStaffIds: ["st1"],
};
{
  const out = mergeFieldOps(stored, office);
  assert.deepEqual(ids(out.surveyAttendance), ["a1", "a2"], "a check-in this copy never saw is kept");
  assert.equal(out.surveyAttendance.find((a) => a.id === "a1")!.checkOutAt, "13:05", "a check-out is never blanked");
  assert.deepEqual(ids(out.surveySessions), ["s1", "s2", "s3"]);
  assert.equal(out.surveySessions.find((s) => s.id === "s1")!.status, "ended", "an ended session stays ended");
  assert.deepEqual(ids(out.surveyTeam), ["m1", "m2", "m3"], "nothing leaves for being absent");
  assert.deepEqual(out.leadCallerStaffIds.sort(), ["st1", "st2"]);
}
// Named removals do remove; one undone by the same copy does not.
{
  const out = mergeFieldOps(stored, { ...office, leadCallerStaffIds: ["st1"] }, {
    admission_survey_team: ["m2"],
    admission_lead_callers: ["st2", "st1"], // st1 removed then re-added here
  });
  assert.deepEqual(ids(out.surveyTeam), ["m1", "m3"]);
  assert.deepEqual(out.leadCallerStaffIds, ["st1"]);
}
// A newer edit of a row still lands; nothing stored → the copy as is.
{
  const out = mergeFieldOps(stored, { ...empty, surveySessions: [ses("s2", "ended", 1)] });
  assert.equal(out.surveySessions.find((s) => s.id === "s2")!.status, "ended");
  assert.deepEqual(mergeFieldOps(null, office).surveyTeam.length, 2);
}

// ── Wiring ─────────────────────────────────────────────────────────────────
{
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const push = read("admissionsNormalized.server.ts");
  assert.ok(/\.select\("ops_json, sequences_json"\)/.test(push) && /if \(opsErr\) return/.test(push), "the stored lists are read first; a failed read writes nothing");
  assert.ok(/ops_json: lists,/.test(push) && /mergeFieldOps\(/.test(push));
  const route = read("../app/api/school-data/admissions-desk/route.ts");
  assert.ok(/readNamedDeletes\(body\.deletes, FIELD_OPS_DELETABLE\)/.test(route) && /pushAdmissionDeskToDb\(normalized, \{ stamps, deletes \}\)/.test(route));
  assert.ok(/featureAuthorizedDeletes\(/.test(route), "a function holder's removal must be one their functions made");
  const client = read("admissionsNormalizedClient.ts");
  assert.ok(/deletes: sentDeletes/.test(client) && /confirmDeskDeletes\(ADMISSIONS_DESK, sentDeletes\)/.test(client));
  assert.ok(/recordDeskDeletion\("admissions", "admission_survey_team", \[memberId\]\)/.test(read("fieldSurvey.ts")));
  assert.ok(/recordDeskDeletion\("admissions", "admission_lead_callers", \[id\]\)/.test(read("admissions.ts")));
}

console.log("admissionsFieldOpsMerge.selftest: all assertions passed");
