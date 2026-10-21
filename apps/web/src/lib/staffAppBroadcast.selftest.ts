/**
 * Run: npx tsx src/lib/staffAppBroadcast.selftest.ts
 *
 * The staff app's Broadcast screen (requests mr_mva0gr5aop3y,
 * mr_mva0ik2uqmoy): who may aim where, how a custom message splits between
 * free text and the approved template, and the transport-route audience.
 */
import assert from "node:assert/strict";
import {
  authorizeBroadcastAudience,
  broadcastClaimKey,
  customFreeText,
  customTemplateVariables,
  estimateBroadcastPaise,
  splitCustomMessage,
  type BroadcastAuthority,
} from "./staffAppBroadcast";
import { parseWaAudienceSpec, isWholeSchoolAudience, type WaAudienceSpec } from "./waAudienceSpec";
import { routeRiderStudentIds } from "./waAudienceHouseholds";
import { DEFAULT_WA_RATES } from "./waUsageCost";

console.log("staffAppBroadcast.selftest.ts");

const spec = (raw: unknown): WaAudienceSpec => {
  const r = parseWaAudienceSpec(raw);
  assert.ok(r.ok, `spec should parse: ${JSON.stringify(raw)}`);
  return r.spec;
};

// A teacher of 5-A (sec_5a) only. Class 5 has sections 5-A and 5-B.
const teacher: BroadcastAuthority = {
  schoolWide: false,
  mayMessageSection: (id) => id === "sec_5a",
  sectionsOfClass: (c) => (c === "cls_5" ? ["sec_5a", "sec_5b"] : c === "cls_9" ? [] : []),
  sectionLabel: (id) => ({ sec_5a: "5-A", sec_5b: "5-B" })[id] || id,
};
const principal: BroadcastAuthority = { ...teacher, schoolWide: true };

// --- a teacher's own section is allowed --------------------------------
{
  const r = authorizeBroadcastAudience(spec({ kind: "parents", sectionIds: ["sec_5a"] }), teacher);
  assert.equal(r.ok, true);
}

// --- a teacher choosing ANOTHER section is refused, whole send ---------
{
  const r = authorizeBroadcastAudience(spec({ kind: "parents", sectionIds: ["sec_5b"] }), teacher);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.status === 403 && /5-B/.test(r.error), "refusal names the foreign section");

  // Mixed with their own: still refused — never quietly narrowed.
  const mixed = authorizeBroadcastAudience(
    spec({ kind: "parents", sectionIds: ["sec_5a", "sec_5b"] }),
    teacher,
  );
  assert.equal(mixed.ok, false);

  // A whole class reaches 5-B too.
  const cls = authorizeBroadcastAudience(spec({ kind: "parents", classIds: ["cls_5"] }), teacher);
  assert.equal(cls.ok, false, "whole class includes a section the teacher does not teach");

  // A class with no sections on record cannot be checked.
  assert.equal(
    authorizeBroadcastAudience(spec({ kind: "parents", classIds: ["cls_9"] }), teacher).ok,
    false,
  );
}

// --- school-wide audiences need the broadcast permission ---------------
{
  const wide: unknown[] = [
    { kind: "parents" },
    { kind: "parents", languageUnset: true },
    { kind: "staff" },
    { kind: "staff", stream: "teaching" },
    { kind: "fee_stage", stages: ["S3"] },
    { kind: "transport_route", routeIds: ["r1"] },
  ];
  for (const raw of wide) {
    const s = spec(raw);
    assert.equal(authorizeBroadcastAudience(s, teacher).ok, false, `teacher refused ${JSON.stringify(raw)}`);
    assert.equal(authorizeBroadcastAudience(s, principal).ok, true, `principal allowed ${JSON.stringify(raw)}`);
  }
  // Hand-picked students are a web screen, for everyone.
  assert.equal(
    authorizeBroadcastAudience(spec({ kind: "students", studentIds: ["s1"] }), principal).ok,
    false,
  );
}

// --- transport_route spec ----------------------------------------------
{
  assert.equal(parseWaAudienceSpec({ kind: "transport_route", routeIds: [] }).ok, false);
  const s = spec({ kind: "transport_route", routeIds: ["r1", "r1", " r2 "] });
  assert.deepEqual(s.kind === "transport_route" && s.routeIds, ["r1", "r2"]);
  assert.equal(isWholeSchoolAudience(s), false);
}

// --- route riders: live, latest year, not suspended ---------------------
{
  const a = (studentId: string, routeId: string, ay: string, to: string | null, susp = false) => ({
    studentId,
    routeId,
    academicYearCode: ay,
    effectiveTo: to,
    boardingSuspended: susp,
  });
  const riders = routeRiderStudentIds(
    [
      a("s1", "r1", "2026-27", null),
      a("s2", "r1", "2026-27", "2026-10-01"), // ended
      a("s3", "r1", "2025-26", null), // last year's row left open
      a("s4", "r1", "2026-27", null, true), // suspended
      a("s5", "r2", "2026-27", "2027-03-31"), // ends later — still riding
      a("s6", "r3", "2026-27", null), // another route
    ],
    ["r1", "r2"],
    "2026-10-20T10:00:00Z",
  );
  assert.deepEqual([...riders].sort(), ["s1", "s5"]);
}

// --- custom message: free text inside the window, template outside -----
{
  const open = new Set(["919800000001", "919800000003"]);
  const rs = [
    { mobile: "9800000001", refId: "h1" },
    { mobile: "9800000002", refId: "h2" },
    { mobile: "9800000003", refId: "h3", fallbackMobile: "9800000009" },
    { mobile: "9800000004", refId: "h4", fallbackMobile: "9800000001" },
  ];
  const { freeText, viaTemplate } = splitCustomMessage(rs, open);
  assert.deepEqual(freeText.map((r) => r.refId), ["h1", "h3"]);
  assert.deepEqual(viaTemplate.map((r) => r.refId), ["h2", "h4"]);
  // h3's fallback is outside the window: free text there would be refused.
  assert.equal(freeText.find((r) => r.refId === "h3")?.fallbackMobile, undefined);
  // Nobody in the window → everyone via the template (never dropped).
  const none = splitCustomMessage(rs, new Set());
  assert.equal(none.freeText.length, 0);
  assert.equal(none.viaTemplate.length, rs.length);
}

// --- template variables are one line; free text keeps the lines --------
{
  const v = customTemplateVariables("Holiday tomorrow\n\nSchool   closed\tfor Diwali", "", "Mrs Rao");
  assert.ok(!/[\n\t]/.test(v.noticeBody), "Meta refuses new lines in a parameter");
  assert.ok(!/ {5}/.test(v.noticeBody));
  assert.equal(v.noticeTitle, "Holiday tomorrow");
  assert.ok(v.noticeBody.endsWith("— Mrs Rao"));
  assert.equal(customTemplateVariables("x", "PTM on Saturday", "").noticeTitle, "PTM on Saturday");
  assert.ok(customFreeText("Line 1\nLine 2", "Mrs Rao").includes("\n"));
}

// --- cost estimate ------------------------------------------------------
{
  const rates = { ...DEFAULT_WA_RATES, service: 11.5, utility: 11.5, marketing: 78.46 };
  assert.equal(
    estimateBroadcastPaise({ freeText: 10, viaTemplate: 100, templateCategory: "utility", rates }),
    Math.round(10 * 11.5 + 100 * 11.5),
  );
  // Unknown category is priced at the dearest rate.
  assert.equal(
    estimateBroadcastPaise({ freeText: 0, viaTemplate: 2, templateCategory: "unknown", rates }),
    Math.round(2 * 78.46),
  );
}

// --- send-once key ------------------------------------------------------
{
  assert.equal(broadcastClaimKey(""), null);
  assert.equal(broadcastClaimKey("short"), null);
  assert.equal(broadcastClaimKey("bad id with spaces"), null);
  assert.equal(broadcastClaimKey("app_lzx91_ab12cd"), "staff_app_broadcast:app_lzx91_ab12cd");
}

console.log("  ok");
