/**
 * Run: npx tsx src/lib/leaveCommandEngine.selftest.ts
 *
 * Two ways this goes wrong, and both grant or refuse somebody's leave
 * without them knowing: reading a teacher's leave APPLICATION as a
 * principal's DECISION, and acting on "LEAVE OK" with no number.
 */
import assert from "node:assert/strict";
import {
  buildLeaveQueue,
  composeLeaveAlreadyDecided,
  composeLeaveDecisionReply,
  composeLeaveList,
  composeLeaveListFirst,
  composeLeaveNeedsIndex,
  composeLeaveNotAllowed,
  composeLeaveUnreadable,
  isUndecidedLeave,
  leaveCommandNeedsAuthority,
  leaveDecisionClaimKey,
  parseLeaveCommand,
  resolveShownLeave,
  runLeaveDecision,
  SHOWN_LEAVE_LIST_TTL_MS,
  type DeskLeave,
} from "./leaveCommandEngine";

console.log("leaveCommandEngine.selftest.ts");

async function main() {

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

// --- the queue comes from the Staff HR desk ----------------------------
const desk = (over: Partial<DeskLeave> & { id: string }): DeskLeave => ({
  staffId: "st_1",
  typeCode: "CL",
  fromDate: "2026-10-01",
  toDate: "2026-10-01",
  days: 1,
  halfDay: false,
  status: "pending",
  appliedAt: "2026-09-29T08:00:00Z",
  decidedBy: "",
  ...over,
});
{
  const names: Record<string, string> = { st_1: "Ramesh Yadav", st_2: "Priya Nair" };
  const queue = buildLeaveQueue(
    [
      desk({ id: "lr_late", staffId: "st_2", fromDate: "2026-10-05", toDate: "2026-10-06", days: 2 }),
      desk({ id: "lr_done", status: "approved" }),
      desk({ id: "lr_no", status: "rejected" }),
      // Cleared level one, still undecided — must be on the list.
      desk({ id: "lr_l2", fromDate: "2026-10-03", toDate: "2026-10-03", status: "pending_l2" }),
      desk({ id: "lr_early", typeCode: "SL" }),
    ],
    (id) => names[id] || "",
    (code) => ({ CL: "Casual", SL: "Sick" })[code] || "",
  );
  assert.deepEqual(
    queue.map((q) => q.requestId),
    ["lr_early", "lr_l2", "lr_late"],
    "undecided only, oldest start first",
  );
  assert.deepEqual(queue[0]!.line, {
    index: 1, name: "Ramesh Yadav", typeLabel: "Sick",
    fromDate: "2026-10-01", toDate: "2026-10-01", days: 1,
  });
  assert.equal(queue[2]!.line.name, "Priya Nair");
  // An unknown staff id or type still shows something a person can act on.
  const bare = buildLeaveQueue([desk({ id: "x", staffId: "st_9", typeCode: "ZZ" })], () => "", () => "");
  assert.equal(bare[0]!.line.name, "st_9");
  assert.equal(bare[0]!.line.typeLabel, "ZZ");
  // The same start date orders by who applied first, so two reads agree.
  const tie = buildLeaveQueue(
    [desk({ id: "b", appliedAt: "2026-09-29T09:00:00Z" }), desk({ id: "a", appliedAt: "2026-09-29T07:00:00Z" })],
    () => "N", () => "T",
  );
  assert.deepEqual(tie.map((q) => q.requestId), ["a", "b"]);
  assert.equal(isUndecidedLeave("pending"), true);
  assert.equal(isUndecidedLeave("pending_l2"), true);
  assert.equal(isUndecidedLeave("approved"), false);
  assert.equal(isUndecidedLeave("rejected"), false);
}

// --- the number means the list THEY were shown ------------------------
{
  const now = Date.parse("2026-09-29T13:00:00Z");
  const shown = { ids: ["lr_a", "lr_b"], at: "2026-09-29T12:30:00Z" };
  assert.deepEqual(resolveShownLeave(shown, 1, now), { kind: "ok", requestId: "lr_a" });
  assert.deepEqual(resolveShownLeave(shown, 2, now), { kind: "ok", requestId: "lr_b" });
  assert.deepEqual(resolveShownLeave(shown, 3, now), { kind: "out_of_range", count: 2 });
  // Never shown a list: no number can mean anything yet.
  assert.deepEqual(resolveShownLeave(null, 1, now), { kind: "no_list" });
  assert.deepEqual(resolveShownLeave(undefined, 1, now), { kind: "no_list" });
  assert.deepEqual(resolveShownLeave({ ids: ["lr_a"], at: "" }, 1, now), { kind: "no_list" });
  // Yesterday's list is not what they are looking at.
  assert.deepEqual(
    resolveShownLeave({ ids: ["lr_a"], at: new Date(now - SHOWN_LEAVE_LIST_TTL_MS - 1).toISOString() }, 1, now),
    { kind: "no_list" },
  );
  assert.match(composeLeaveListFirst("LIST"), /numbers change[\s\S]*LIST$/);
}

// --- deciding: claim, decide, save, mark ------------------------------
type FakeState = { leaveRequests: DeskLeave[] };
function fakeDesk(initial: DeskLeave[]) {
  const claims = new Map<string, string>();
  const log: string[] = [];
  let saved: DeskLeave[] = initial.map((r) => ({ ...r }));
  const opts = { twoLevel: false, decideError: "", saveThrows: false, claimDown: false };
  const deps = {
    claim: async (key: string, by: string) => {
      log.push(`claim ${key}`);
      if (opts.claimDown) return { ok: false as const, reason: "unavailable" as const };
      const holder = claims.get(key);
      if (holder !== undefined) return { ok: false as const, reason: "held" as const, claimedBy: holder };
      claims.set(key, by);
      return { ok: true as const };
    },
    release: async (key: string) => {
      log.push(`release ${key}`);
      claims.delete(key);
    },
    decide: (input: { requestId: string; decision: "approved" | "rejected"; decidedBy: string }) => {
      log.push(`decide ${input.requestId} ${input.decision} by ${input.decidedBy}`);
      if (opts.decideError) return { ok: false as const, error: opts.decideError };
      const status =
        input.decision === "rejected" ? "rejected" : opts.twoLevel ? "pending_l2" : "approved";
      const state: FakeState = {
        leaveRequests: saved.map((r) =>
          r.id === input.requestId ? { ...r, status, decidedBy: input.decidedBy } : r,
        ),
      };
      return { ok: true as const, state };
    },
    save: async (state: FakeState) => {
      if (opts.saveThrows) throw new Error("503");
      log.push("save");
      saved = state.leaveRequests;
    },
    markRegisters: async (r: DeskLeave, by: string) => {
      log.push(`mark ${r.staffId} ${r.fromDate}..${r.toDate} (${by})`);
      return 1;
    },
  };
  return { deps, log, opts, claims, get saved() { return saved; } };
}

{
  // Approval: claimed under the same key the LEAVE OK 4821 path uses, saved
  // to the desk, and only THEN the registers marked.
  const req = desk({ id: "lr_1" });
  const f = fakeDesk([req]);
  const r = await runLeaveDecision(req, "approved", "Principal P", f.deps);
  assert.deepEqual(r, { kind: "decided", status: "approved", marked: 1 });
  assert.equal(leaveDecisionClaimKey("lr_1", "pending"), "leave-decision:lr_1:pending");
  assert.deepEqual(f.log, [
    "claim leave-decision:lr_1:pending",
    "decide lr_1 approved by Principal P",
    "save",
    "mark st_1 2026-10-01..2026-10-01 (Leave approved by Principal P)",
  ]);
  assert.equal(f.saved[0]!.status, "approved");
}

{
  // Two approvers reply at the same moment: both read it pending, only the
  // first decides, and the second is told who did.
  const req = desk({ id: "lr_2" });
  const f = fakeDesk([req]);
  const [a, b] = await Promise.all([
    runLeaveDecision(req, "approved", "Principal P", f.deps),
    runLeaveDecision(req, "rejected", "Director D", f.deps),
  ]);
  assert.deepEqual(a, { kind: "decided", status: "approved", marked: 1 });
  assert.deepEqual(b, { kind: "already_decided", by: "Principal P" });
  assert.equal(f.log.filter((l) => l.startsWith("decide")).length, 1, "decided once");
  assert.equal(f.log.filter((l) => l === "save").length, 1, "saved once");
  assert.equal(f.saved[0]!.status, "approved", "the second reply did not overwrite the first");
  assert.match(
    composeLeaveAlreadyDecided({ name: "Ramesh Yadav", typeLabel: "Casual", status: "decided", by: b.kind === "already_decided" ? b.by : "" }),
    /Ramesh Yadav's Casual was already decided by Principal P\. Nothing more to do/,
  );
  assert.match(
    composeLeaveAlreadyDecided({ name: "R", typeLabel: "Casual", status: "approved", by: "" }),
    /was already approved\. Nothing more/,
  );
}

{
  // A rejection is saved but marks no register.
  const req = desk({ id: "lr_3" });
  const f = fakeDesk([req]);
  const r = await runLeaveDecision(req, "rejected", "P", f.deps);
  assert.deepEqual(r, { kind: "decided", status: "rejected", marked: 0 });
  assert.equal(f.log.some((l) => l.startsWith("mark")), false);
}

{
  // Two-level approval: the first yes is pending_l2, not leave — no mark,
  // and the reply says it still needs the final approval.
  const req = desk({ id: "lr_4" });
  const f = fakeDesk([req]);
  f.opts.twoLevel = true;
  const r = await runLeaveDecision(req, "approved", "P", f.deps);
  assert.deepEqual(r, { kind: "decided", status: "pending_l2", marked: 0 });
  assert.equal(f.log.some((l) => l.startsWith("mark")), false);
  // The final approval is a different claim, so level one does not block it.
  const l2 = { ...req, status: "pending_l2" };
  f.opts.twoLevel = false;
  const r2 = await runLeaveDecision(l2, "approved", "D", f.deps);
  assert.deepEqual(r2, { kind: "decided", status: "approved", marked: 1 });
  assert.ok(f.log.includes("claim leave-decision:lr_4:pending_l2"));
  assert.match(
    composeLeaveDecisionReply({
      ok: true, decision: "approved", name: "R", typeLabel: "Casual",
      fromDate: "2026-10-01", toDate: "2026-10-01", firstLevelOnly: true,
    }),
    /first level[\s\S]*final approval/,
  );
}

{
  // The desk refuses (balance, rules): the claim is given back so the ERP
  // or a second try can still decide it, and nothing is saved or marked.
  const req = desk({ id: "lr_5" });
  const f = fakeDesk([req]);
  f.opts.decideError = "Cannot approve — insufficient balance (remaining 0)";
  const r = await runLeaveDecision(req, "approved", "P", f.deps);
  assert.deepEqual(r, { kind: "failed", error: "Cannot approve — insufficient balance (remaining 0)" });
  assert.ok(f.log.includes("release leave-decision:lr_5:pending"));
  assert.equal(f.claims.size, 0);
  assert.equal(f.log.some((l) => l === "save" || l.startsWith("mark")), false);
}

{
  // The save fails: claim released, registers NOT marked — marking leave
  // that the desk does not hold would be a day off nobody granted.
  const req = desk({ id: "lr_6" });
  const f = fakeDesk([req]);
  f.opts.saveThrows = true;
  const r = await runLeaveDecision(req, "approved", "P", f.deps);
  assert.equal(r.kind, "failed");
  assert.ok(f.log.includes("release leave-decision:lr_6:pending"));
  assert.equal(f.log.some((l) => l.startsWith("mark")), false);
  // And a retry after the outage goes through.
  f.opts.saveThrows = false;
  assert.equal((await runLeaveDecision(req, "approved", "P", f.deps)).kind, "decided");
}

{
  // No lock, no decision: an unreachable claim table must not fall back to
  // deciding unlocked.
  const req = desk({ id: "lr_7" });
  const f = fakeDesk([req]);
  f.opts.claimDown = true;
  const r = await runLeaveDecision(req, "approved", "P", f.deps);
  assert.equal(r.kind, "failed");
  assert.equal(f.log.some((l) => l.startsWith("decide")), false);
}

// --- a desk that could not be read is not an empty queue ---------------
{
  assert.doesNotMatch(composeLeaveUnreadable(), /No leave request is waiting/);
  assert.match(composeLeaveUnreadable(), /Could not read/);
}

console.log("  ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
