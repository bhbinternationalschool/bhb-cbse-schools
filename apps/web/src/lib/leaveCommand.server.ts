/**
 * Deciding leave from WhatsApp.
 *
 * The gate is the SAME rule the leave API uses — assertLeaveApprover lets
 * leadership through and refuses everyone else — resolved here from the
 * sender's designation via staffHomeKind, because a WhatsApp number has no
 * login session to carry RBAC. Reusing the rule rather than writing a
 * second one is the point: two rules for who may grant leave is one rule
 * that will drift.
 *
 * Seeing the queue is not deciding it, so LEAVE lists for any staff member
 * and only LEAVE OK / LEAVE NO need the authority.
 *
 * Leave lives in the Staff HR desk (loadStaffHrServer / saveStaffHrServer),
 * the same state the ERP's Staff → Leave screen and "LEAVE OK 4821" decide.
 * The staff_leave_requests table this used to read is empty on the live
 * tenant, so the list always said nothing was waiting.
 */

import "server-only";

import { loadServerMasters } from "@/lib/api/v1/auth";
import { readStaffHrServer, saveStaffHrServer } from "@/lib/api/v1/staffLeave";
import { decideLeave, type StaffHrState } from "@/lib/staffHr";
import { markApprovedLeaveOnRegisters } from "@/lib/staffAttendance.server";
import { claimSendOnce, releaseSendClaim } from "@/lib/waSendClaim.server";
import { istToday } from "@/lib/dailyBrief.server";
import { leaveDecisionOpen } from "@/lib/staffLeaveWa";
import { staffHomeKind } from "@/lib/staffHomeKind";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  buildLeaveQueue,
  composeLeaveAlreadyDecided,
  composeLeaveDayPassed,
  composeLeaveDecisionReply,
  composeLeaveList,
  composeLeaveListFirst,
  composeLeaveNeedsIndex,
  composeLeaveNotAllowed,
  composeLeaveOwn,
  composeLeaveUnreadable,
  isUndecidedLeave,
  parseLeaveCommand,
  resolveShownLeave,
  runLeaveDecision,
  type ShownLeaveList,
} from "@/lib/leaveCommandEngine";

export type LeaveCommandOutcome =
  | { handled: false }
  | {
      handled: true;
      text: string;
      /** The list this reply showed, for the caller to remember on the session. */
      shown?: ShownLeaveList;
    };

async function readQueue(): Promise<
  | {
      ok: true;
      state: StaffHrState;
      queue: ReturnType<typeof buildLeaveQueue>;
      nameOf: (staffId: string) => string;
      typeLabelOf: (typeCode: string) => string;
    }
  | { ok: false }
> {
  const read = await readStaffHrServer();
  if (!read.ok) return { ok: false };
  const masters = await loadServerMasters();
  const names = new Map((masters.staff ?? []).map((s) => [s.id, s.fullName || s.id]));
  const types = new Map(read.state.leaveTypes.map((t) => [t.code, t.name || t.code]));
  const nameOf = (id: string) => names.get(id) || id;
  const typeLabelOf = (code: string) => types.get(code) || code;
  return {
    ok: true,
    state: read.state,
    queue: buildLeaveQueue(read.state.leaveRequests, nameOf, typeLabelOf),
    nameOf,
    typeLabelOf,
  };
}

async function mayDecide(staff: StaffRecord | null): Promise<boolean> {
  if (!staff) return false;
  const masters = await loadServerMasters();
  const designation =
    (masters.designations ?? []).find((d) => d.id === (staff.designationId || ""))
      ?.name || "";
  return (
    staffHomeKind({
      roleCode: "",
      designation,
      stream: staff.stream || "",
      teachesClasses: false,
    }) === "leadership"
  );
}

export async function handleLeaveCommand(opts: {
  text: string;
  staff: StaffRecord | null;
  by: string;
  /** The list this sender was last shown (from their WhatsApp session). */
  shown?: ShownLeaveList | null;
}): Promise<LeaveCommandOutcome> {
  const cmd = parseLeaveCommand(opts.text);
  if (cmd.kind === "not_a_command") return { handled: false };

  const read = await readQueue();
  if (!read.ok) return { handled: true, text: composeLeaveUnreadable() };
  const { state, queue, nameOf, typeLabelOf } = read;
  const listNow = () => ({
    text: composeLeaveList(queue.map((q) => q.line)),
    shown: { ids: queue.map((q) => q.requestId), at: new Date().toISOString() },
  });

  if (cmd.kind === "list") {
    return { handled: true, ...listNow() };
  }
  if (cmd.kind === "needs_index") {
    return {
      handled: true,
      text: composeLeaveNeedsIndex(cmd.decision, queue.length),
    };
  }

  if (!(await mayDecide(opts.staff))) {
    return { handled: true, text: composeLeaveNotAllowed() };
  }

  // The number means the request at that place on the list THEY were shown,
  // not on the queue as it stands now.
  const picked = resolveShownLeave(opts.shown, cmd.index);
  if (picked.kind === "no_list") {
    if (queue.length === 0) return { handled: true, ...listNow() };
    const now = listNow();
    return { handled: true, text: composeLeaveListFirst(now.text), shown: now.shown };
  }
  if (picked.kind === "out_of_range") {
    return { handled: true, text: composeLeaveNeedsIndex(cmd.decision, picked.count) };
  }

  const req = state.leaveRequests.find((r) => r.id === picked.requestId);
  if (!req) {
    return {
      handled: true,
      text: "That leave request is no longer in the ERP. Reply *LEAVE* for the list as it is now.",
    };
  }
  const line = {
    name: nameOf(req.staffId),
    typeLabel: typeLabelOf(req.typeCode),
    fromDate: req.fromDate,
    toDate: req.toDate,
  };
  if (!isUndecidedLeave(req.status)) {
    return {
      handled: true,
      text: composeLeaveAlreadyDecided({ ...line, status: req.status, by: req.decidedBy }),
    };
  }
  if (opts.staff && opts.staff.id === req.staffId) {
    return { handled: true, text: composeLeaveOwn() };
  }
  // Same window as "LEAVE OK 4821": once the first day is over, the day's
  // register holds what really happened and the ERP is the place to decide.
  if (!leaveDecisionOpen(req.fromDate, istToday())) {
    return { handled: true, text: composeLeaveDayPassed() };
  }

  const by = opts.staff?.fullName || opts.by || "Leadership";
  const result = await runLeaveDecision(req, cmd.decision, by, {
    claim: async (key, claimBy, note) => {
      const c = await claimSendOnce(key, claimBy, note);
      if (c.ok) return { ok: true };
      return c.reason === "held"
        ? { ok: false, reason: "held", claimedBy: c.claimedBy }
        : { ok: false, reason: "unavailable" };
    },
    release: async (key) => {
      await releaseSendClaim(key);
    },
    decide: decideLeave,
    save: saveStaffHrServer,
    markRegisters: (r, markBy) =>
      markApprovedLeaveOnRegisters({
        staffId: r.staffId,
        fromDate: r.fromDate,
        toDate: r.toDate,
        halfDay: r.halfDay,
        typeCode: r.typeCode,
        by: markBy,
      }),
  });

  if (result.kind === "already_decided") {
    return {
      handled: true,
      text: composeLeaveAlreadyDecided({ ...line, status: "decided", by: result.by }),
    };
  }
  return {
    handled: true,
    text: composeLeaveDecisionReply({
      ok: result.kind === "decided",
      decision: cmd.decision,
      ...line,
      firstLevelOnly: result.kind === "decided" && result.status === "pending_l2",
      error: result.kind === "failed" ? result.error : "",
    }),
  };
}
