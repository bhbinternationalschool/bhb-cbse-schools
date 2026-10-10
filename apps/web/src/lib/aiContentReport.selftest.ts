/**
 * Reporting an AI reply.
 *
 * The rule under test is not "does it validate" but "does it refuse to lose
 * a report". A parent flagging an unsafe answer from a tutor that talks to
 * their child is the one message in this system that must never be dropped
 * on a technicality — so an over-long reply is truncated rather than
 * rejected, an unrecognised generation id is discarded rather than refused,
 * and an unknown category falls back to "other" instead of a 400.
 *
 * The single thing that IS refused is a report with no reply text, because
 * there is then nothing for a human to look at.
 *
 * Run: npx tsx src/lib/aiContentReport.selftest.ts
 */
import assert from "node:assert/strict";

import {
  AI_REPORT_REASON_MAX,
  AI_REPORT_TEXT_MAX,
  parseAiContentReport,
  reportSummary,
} from "./aiContentReports";

console.log("aiContentReport.selftest.ts");

// A plain, well-formed report survives intact.
{
  const r = parseAiContentReport({
    generationId: "aig_1234567890abcdef",
    studentId: "stu_1",
    category: "inappropriate",
    reason: "Used a word I would not want my daughter reading",
    question: "Teach photosynthesis",
    reply: "Some reply",
  });
  assert.ok(r.ok, "a well-formed report parses");
  assert.equal(r.value.generationId, "aig_1234567890abcdef");
  assert.equal(r.value.category, "inappropriate");
  assert.equal(r.value.studentId, "stu_1");
}

// The only refusal: nothing to look at.
{
  const r = parseAiContentReport({ reply: "   ", reason: "bad" });
  assert.ok(!r.ok, "a report with no reply text is refused");
}

// A very long answer is TRUNCATED, not rejected. Losing a safety report
// because the tutor was verbose would be the wrong failure.
{
  const long = "x".repeat(AI_REPORT_TEXT_MAX + 5000);
  const r = parseAiContentReport({ reply: long, question: long, reason: long });
  assert.ok(r.ok, "an over-long report is still accepted");
  assert.equal(r.value.reply.length, AI_REPORT_TEXT_MAX, "reply is capped");
  assert.equal(r.value.question.length, AI_REPORT_TEXT_MAX, "question is capped");
  assert.equal(r.value.reason.length, AI_REPORT_REASON_MAX, "reason is capped");
}

// A malformed generation id is dropped, not fatal — the text is what a
// human judges, and a client that lost the id still has something to say.
{
  for (const bad of ["", "nonsense", "aig_", "gen_123456789", "aig_$$$$$$$$"]) {
    const r = parseAiContentReport({ generationId: bad, reply: "Some reply" });
    assert.ok(r.ok, `a report with generationId ${JSON.stringify(bad)} is accepted`);
    assert.equal(r.value.generationId, "", "and the unusable id is dropped");
  }
}

// An unknown category degrades to "other" rather than refusing.
{
  const r = parseAiContentReport({ category: "nonsense", reply: "Some reply" });
  assert.ok(r.ok);
  assert.equal(r.value.category, "other");
}

// Nothing is widened: a client cannot smuggle extra columns through.
{
  const r = parseAiContentReport({
    reply: "Some reply",
    status: "reviewed",
    tenant_id: "someone-elses-tenant",
    reviewed_by: "principal",
  });
  assert.ok(r.ok);
  assert.deepEqual(
    Object.keys(r.value).sort(),
    ["category", "generationId", "question", "reason", "reply", "studentId"],
    "the parsed report carries only the fields the route means to store",
  );
}

// The queue line reads as something, even when the parent typed nothing.
{
  assert.equal(reportSummary({ category: "wrong" }), "Wrong answer");
  assert.equal(
    reportSummary({ category: "wrong", reason: "It said 8x7=54" }),
    "Wrong answer — It said 8x7=54",
  );
  assert.equal(reportSummary({}), "Reported", "an empty report still has a label");
}

console.log("OK");
