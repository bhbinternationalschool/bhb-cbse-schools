/**
 * Run: npx tsx src/lib/leaveCommandEngine.selftest.ts
 *
 * Two ways this goes wrong, and both grant or refuse somebody's leave
 * without them knowing: reading a teacher's leave APPLICATION as a
 * principal's DECISION, and acting on "LEAVE OK" with no number.
 */
import assert from "node:assert/strict";
import {
  composeLeaveDecisionReply,
  composeLeaveList,
  composeLeaveNeedsIndex,
  composeLeaveNotAllowed,
  leaveCommandNeedsAuthority,
  parseLeaveCommand,
} from "./leaveCommandEngine";

console.log("leaveCommandEngine.selftest.ts");

// --- the list ---------------------------------------------------------
{
  assert.deepEqual(parseLeaveCommand("LEAVE"), { kind: "list" });
  assert.deepEqual(parseLeaveCommand("leave"), { kind: "list" });
  assert.deepEqual(parseLeaveCommand("  Leave  "), { kind: "list" });
  // A bare number is ambiguous — approve or reject? — so it shows the list
  // rather than picking one.
  assert.deepEqual(parseLeaveCommand("LEAVE 2"), { kind: "list" });
}

// --- deciding one -----------------------------------------------------
{
  assert.deepEqual(parseLeaveCommand("LEAVE OK 1"), {
    kind: "decide",
    decision: "approved",
    index: 1,
  });
  assert.deepEqual(parseLeaveCommand("leave no 3"), {
    kind: "decide",
    decision: "rejected",
    index: 3,
  });
  // The verb is generous; the decision never is.
  for (const yes of ["ok", "y", "yes", "approve", "approved", "grant", "haan", "han"]) {
    const c = parseLeaveCommand(`LEAVE ${yes} 2`);
    assert.equal(c.kind, "decide");
    if (c.kind === "decide") assert.equal(c.decision, "approved");
  }
  for (const no of ["no", "n", "reject", "refuse", "deny", "nahi", "nahin"]) {
    const c = parseLeaveCommand(`LEAVE ${no} 2`);
    assert.equal(c.kind, "decide");
    if (c.kind === "decide") assert.equal(c.decision, "rejected");
  }
}

// --- "LEAVE OK" with no number decides NOTHING ------------------------
{
  // The failure this prevents: approving whatever happens to be first.
  assert.deepEqual(parseLeaveCommand("LEAVE OK"), {
    kind: "needs_index",
    decision: "approved",
  });
  assert.deepEqual(parseLeaveCommand("LEAVE NO"), {
    kind: "needs_index",
    decision: "rejected",
  });
  // Out of range is a typo, not "the first one".
  assert.equal(parseLeaveCommand("LEAVE OK 0").kind, "needs_index");
  assert.equal(parseLeaveCommand("LEAVE OK 100").kind, "needs_index");
  assert.equal(parseLeaveCommand("LEAVE OK -1").kind, "needs_index");
  assert.equal(parseLeaveCommand("LEAVE OK two").kind, "needs_index");
}

// --- a teacher applying for leave is NOT a decision -------------------
{
  // These arrive from staff every week. Reading any of them as a command
  // would silently decide somebody's leave.
  for (const text of [
    "leave application for tomorrow",
    "Leave chahiye kal",
    "I need leave on Friday please",
    "leave rules kya hai",
    "casual leave balance?",
  ]) {
    assert.deepEqual(
      parseLeaveCommand(text),
      { kind: "not_a_command" },
      `"${text}" must fall through to the ordinary bot`,
    );
  }
  // And nothing that does not start with the word at all.
  assert.deepEqual(parseLeaveCommand(""), { kind: "not_a_command" });
  assert.deepEqual(parseLeaveCommand("DUES"), { kind: "not_a_command" });
  assert.deepEqual(parseLeaveCommand("ok 1"), { kind: "not_a_command" });
}

// --- only a decision needs authority ---------------------------------
{
  assert.equal(leaveCommandNeedsAuthority({ kind: "list" }), false);
  assert.equal(
    leaveCommandNeedsAuthority({ kind: "decide", decision: "approved", index: 1 }),
    true,
    "seeing the queue is not the same as deciding it",
  );
  assert.equal(
    leaveCommandNeedsAuthority({ kind: "needs_index", decision: "approved" }),
    false,
  );
}

// --- what the replies say --------------------------------------------
{
  const list = composeLeaveList([
    { index: 1, name: "Ramesh Yadav", typeLabel: "Casual", fromDate: "2026-09-11", toDate: "2026-09-11", days: 1 },
    { index: 2, name: "Priya Nair", typeLabel: "Earned", fromDate: "2026-09-15", toDate: "2026-09-18", days: 4 },
  ]);
  assert.match(list, /2 leave requests waiting/);
  assert.match(list, /\*1\.\* Ramesh Yadav — Casual, 2026-09-11 \(1 day\)/);
  assert.match(list, /\*2\.\* Priya Nair — Earned, 2026-09-15 to 2026-09-18 \(4 days\)/);
  assert.match(list, /LEAVE OK 1/);

  assert.match(composeLeaveList([]), /No leave request is waiting/);

  assert.match(
    composeLeaveDecisionReply({
      ok: true, decision: "approved", name: "Ramesh Yadav",
      typeLabel: "Casual", fromDate: "2026-09-11", toDate: "2026-09-11",
    }),
    /✅ Approved — Ramesh Yadav, Casual, 2026-09-11\. Recorded in the ERP; they are not messaged automatically\./,
  );
  assert.match(
    composeLeaveDecisionReply({
      ok: false, decision: "approved", name: "X", typeLabel: "Casual",
      fromDate: "a", toDate: "b", error: "already decided",
    }),
    /Could not record that — already decided/,
  );
  assert.match(composeLeaveNeedsIndex("approved", 3), /LEAVE OK 1.*LEAVE OK 3/);
  // The reply must not promise a notification nobody sends: the staff
  // member's 24-hour window is shut by the evening and there is no
  // leave-decision template.
  assert.doesNotMatch(
    composeLeaveDecisionReply({
      ok: true, decision: "approved", name: "X", typeLabel: "Casual",
      fromDate: "a", toDate: "a",
    }),
    /have been told|notified/,
  );
  assert.match(composeLeaveNeedsIndex("rejected", 0), /No leave request is waiting/);
  assert.match(composeLeaveNotAllowed(), /HR rights/);
}

console.log("  ok");
