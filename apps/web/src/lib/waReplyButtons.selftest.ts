/**
 * Reply buttons on the dispatch route — the contract the AI staff room
 * (automation/n8n) relies on when it asks the director to approve a draft
 * with a tap instead of typing "APPROVE 9".
 *
 * What must hold:
 *   - Meta's limits are errors, not silent cuts: a cut title could lose the
 *     draft number the poller reads;
 *   - the approval pair for draft n is "Approve n" / "Reject n" with ids
 *     "approve-n" / "reject-n", and BOTH match the poller's regex (the
 *     webhook logs the title as body and the id as button_id);
 *   - the Cloud API payload is exactly the interactive "button" shape;
 *   - a template's quick-reply payloads become button components in order;
 *   - a closed 24-hour window is recognised from the sender's error text.
 *
 * Run: npx tsx src/lib/waReplyButtons.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildReplyButtonsMessage,
  buildTemplateQuickReplyComponents,
  buttonIdFromTitle,
  isWindowClosedError,
  normalizeReplyButtons,
  officeApprovalButtons,
} from "./waReplyButtons";

console.log("waReplyButtons.selftest.ts");

/* ── The poller's regexes, copied from automation/n8n/scripts/build-workflows.mjs ── */
const APPROVE = /^\s*(approve|approved|ok|okay|yes|send|haan|ha|हाँ|हां|ठीक|भेज)(?![a-z])[^0-9]*#?\s*(\d+)?/i;
const REJECT = /^\s*(reject|rejected|no|cancel|nahi|nahin|नहीं|रद्द)(?![a-z])[^0-9]*#?\s*(\d+)?/i;

/* ── Approval pair ── */
{
  const [approve, reject] = officeApprovalButtons(9);
  assert.deepEqual(approve, { id: "approve-9", title: "Approve 9" });
  assert.deepEqual(reject, { id: "reject-9", title: "Reject 9" });
  for (const s of [approve.title, approve.id]) {
    const m = s.match(APPROVE);
    assert.ok(m, `"${s}" must read as an approval`);
    assert.equal(m[2], "9", `"${s}" must name draft 9`);
    assert.equal(s.match(REJECT), null, `"${s}" is not a rejection`);
  }
  for (const s of [reject.title, reject.id]) {
    const m = s.match(REJECT);
    assert.ok(m, `"${s}" must read as a rejection`);
    assert.equal(m[2], "9");
  }
  // A big id still fits the 20-character title limit (ids are bigint).
  const big = officeApprovalButtons(123456789012);
  assert.ok(big.every((b) => b.title.length <= 20), "titles stay within Meta's 20 characters");
  assert.equal(officeApprovalButtons("#42")[0].title, "Approve 42", "a '#42' label is just draft 42");
  // Meta's "no leading/trailing spaces" rule on ids.
  for (const b of [...officeApprovalButtons(7), ...big]) assert.equal(b.id, b.id.trim());
}

/* ── Validation: errors, never silent cuts ── */
{
  const ok = normalizeReplyButtons([{ title: "Approve 9" }, { id: "reject-9", title: " Reject 9 " }]);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.buttons, [
      { id: "approve-9", title: "Approve 9" },
      { id: "reject-9", title: "Reject 9" },
    ]);
  }
  const tooMany = normalizeReplyButtons([{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }]);
  assert.equal(tooMany.ok, false);
  const tooLong = normalizeReplyButtons([{ title: "Approve this draft now please" }]);
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.match(tooLong.error, /20/);
  assert.equal(normalizeReplyButtons([]).ok, false);
  assert.equal(normalizeReplyButtons("Approve 9").ok, false);
  assert.equal(normalizeReplyButtons([{ title: "   " }]).ok, false);
  const dup = normalizeReplyButtons([{ id: "x", title: "One" }, { id: "x", title: "Two" }]);
  assert.equal(dup.ok, false);
  // Hindi titles count characters, not bytes.
  const hi = normalizeReplyButtons([{ title: "✅ स्वीकृत" }, { title: "❌ अस्वीकृत" }]);
  assert.ok(hi.ok);
  if (hi.ok) assert.ok(hi.buttons[0].id.length > 0, "a derived id is never empty");
  assert.equal(buttonIdFromTitle("Approve 9"), "approve-9");
}

/* ── The Cloud API payload ── */
{
  const msg = buildReplyButtonsMessage({
    to: "919876543210",
    body: "✉️ Draft #9 needs your decision.",
    footer: "AI staff room",
    buttons: officeApprovalButtons(9),
  });
  assert.deepEqual(msg, {
    messaging_product: "whatsapp",
    to: "919876543210",
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "✉️ Draft #9 needs your decision." },
      footer: { text: "AI staff room" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "approve-9", title: "Approve 9" } },
          { type: "reply", reply: { id: "reject-9", title: "Reject 9" } },
        ],
      },
    },
  });
  const noFooter = buildReplyButtonsMessage({ to: "91", body: "x", buttons: officeApprovalButtons(1) }) as {
    interactive: Record<string, unknown>;
  };
  assert.equal("footer" in noFooter.interactive, false, "no empty footer object — Meta rejects it");
  const long = buildReplyButtonsMessage({ to: "91", body: "y".repeat(2000), buttons: officeApprovalButtons(1) }) as {
    interactive: { body: { text: string } };
  };
  assert.equal(long.interactive.body.text.length, 1024, "body is capped at Meta's 1024");
}

/* ── Template quick replies carry the draft number in their payload ── */
{
  const comps = buildTemplateQuickReplyComponents(["Approve 9", "Reject 9"]);
  assert.deepEqual(comps, [
    { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "Approve 9" }] },
    { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "Reject 9" }] },
  ]);
  assert.equal(buildTemplateQuickReplyComponents(["a", "b", "c", "d"]).length, 3, "three buttons at most");
  assert.deepEqual(buildTemplateQuickReplyComponents([]), []);
  // The payload of each is what the webhook parser hands on as text, and it
  // must satisfy the same poller regex as a typed reply.
  for (const c of comps) assert.ok(APPROVE.test(c.parameters[0].payload) || REJECT.test(c.parameters[0].payload));
}

/* ── A closed window is the one failure a template mends ── */
{
  assert.equal(isWindowClosedError("Outside Meta's 24h session window — send an approved template instead"), true);
  assert.equal(isWindowClosedError("(#131047) Re-engagement message"), true);
  assert.equal(isWindowClosedError("Invalid destination"), false);
  assert.equal(isWindowClosedError("opted out"), false);
  assert.equal(isWindowClosedError(undefined), false);
}

console.log("ok");
