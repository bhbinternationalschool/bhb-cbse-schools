/**
 * A round: the list the office reads before anybody loses anything.
 *
 * The holds engine used to answer "is this child blocked?" by recomputing
 * today's dues on the spot. That is fine for a report card, which is printed
 * on request and can be printed again an hour later. It is wrong for a bus
 * seat and an admit card, where somebody has to tell a family in advance and
 * a child who is turned away at the gate cannot be un-turned-away.
 *
 * So for those gates the policy proposes and a person decides. A round is
 * that decision, written down:
 *
 *   built     the engine listed everyone the gate catches today
 *   decided   the office ticked allow or disallow against each name
 *   applied   a person with the authority signed it off, and only now does
 *             anything change for a child
 *
 * THE FACTS ARE FROZEN AT BUILD TIME
 * Each item copies the stage, days and amount as they stood when the round
 * was built. A family who pays on Tuesday must not silently vanish from a
 * list the office approved on Monday — the round still names them, and
 * `staleItems` says their bill has moved so the office can drop them. The
 * alternative, recomputing on apply, means approving one list and applying a
 * different one.
 *
 * A ROUND NEVER BLOCKS BY ITSELF
 * Applying writes decisions. Enforcement reads them. Nothing here calls into
 * transport or exams, so a half-finished round cannot strand a child.
 */

import type { HoldCode, OverdueStage } from "@/lib/types";
import {
  type DefaulterFacts,
  type HoldGate,
  evaluateGate,
  isBlockableHold,
} from "@/lib/defaulterHoldPolicy";

export type HoldDecision = "undecided" | "disallow" | "allow";

export type HoldRoundItem = {
  studentId: string;
  decision: HoldDecision;
  /** Facts as they stood when the round was built. Never recomputed. */
  stage: OverdueStage;
  overdueDays: number;
  overdueAmountPaise: number;
  /**
   * Why this child is being allowed through, when they are. Required for an
   * allow, because "we let them off" with no reason is the thing that makes a
   * policy unenforceable six months later. Empty for a disallow, where the
   * reason is the policy itself.
   */
  reason: string;
};

export type HoldRoundStatus = "draft" | "applied" | "cancelled";

export type HoldRound = {
  id: string;
  holdCode: HoldCode;
  status: HoldRoundStatus;
  /** ISO date the facts were read. */
  asOf: string;
  createdAt: string;
  createdBy: string;
  appliedAt: string | null;
  appliedBy: string | null;
  note: string;
  items: HoldRoundItem[];
};

export function buildHoldRound(input: {
  id: string;
  holdCode: HoldCode;
  gate: HoldGate;
  population: DefaulterFacts[];
  asOf: string;
  createdBy: string;
  now?: string;
}): HoldRound {
  const { caught } = evaluateGate(input.gate, input.population);
  return {
    id: input.id,
    holdCode: input.holdCode,
    status: "draft",
    asOf: input.asOf,
    createdAt: input.now ?? new Date().toISOString(),
    createdBy: input.createdBy,
    appliedAt: null,
    appliedBy: null,
    note: "",
    items: caught.map((f) => ({
      studentId: f.studentId,
      decision: "undecided" as HoldDecision,
      stage: f.stage,
      overdueDays: f.overdueDays,
      overdueAmountPaise: f.overdueAmountPaise,
      reason: "",
    })),
  };
}

/**
 * Set the same decision on many children at once.
 *
 * This is the bulk action the office actually performs: tick forty names,
 * press one button. Unknown ids are ignored rather than appended — a round is
 * a closed list, and letting a caller add a child by id would bypass the gate
 * that put everyone else there.
 */
export function decideMany(
  round: HoldRound,
  studentIds: string[],
  decision: HoldDecision,
  reason = "",
): HoldRound {
  if (round.status !== "draft") return round;
  const wanted = new Set(studentIds);
  const cleanReason = reason.trim().slice(0, 300);
  return {
    ...round,
    items: round.items.map((item) =>
      wanted.has(item.studentId)
        ? {
            ...item,
            decision,
            // A disallow carries no reason: the policy is the reason. Keep any
            // note the office typed while the row was an allow, so flipping
            // back and forth does not lose their words.
            reason: decision === "allow" ? cleanReason || item.reason : item.reason,
          }
        : item,
    ),
  };
}

export type RoundCounts = {
  total: number;
  disallow: number;
  allow: number;
  undecided: number;
};

export function countRound(round: HoldRound): RoundCounts {
  let disallow = 0;
  let allow = 0;
  let undecided = 0;
  for (const i of round.items) {
    if (i.decision === "disallow") disallow += 1;
    else if (i.decision === "allow") allow += 1;
    else undecided += 1;
  }
  return { total: round.items.length, disallow, allow, undecided };
}

export type RoundBlocker = { code: string; message: string };

/**
 * What stops this round being applied.
 *
 * Returns every blocker rather than the first, so the office fixes the list
 * in one pass instead of discovering problems one press at a time.
 */
export function roundBlockers(round: HoldRound): RoundBlocker[] {
  const out: RoundBlocker[] = [];
  if (round.status !== "draft") {
    out.push({
      code: "not_draft",
      message:
        round.status === "applied"
          ? "This round has already been applied"
          : "This round was cancelled",
    });
    return out;
  }
  if (!isBlockableHold(round.holdCode)) {
    out.push({
      code: "not_blockable",
      message: `${round.holdCode} is not a service a defaulter policy may withhold`,
    });
  }
  if (round.items.length === 0) {
    out.push({ code: "empty", message: "Nobody qualifies — nothing to apply" });
  }
  const counts = countRound(round);
  if (counts.undecided > 0) {
    out.push({
      code: "undecided",
      message: `${counts.undecided} ${
        counts.undecided === 1 ? "child has" : "children have"
      } no decision yet`,
    });
  }
  const allowNoReason = round.items.filter(
    (i) => i.decision === "allow" && !i.reason.trim(),
  );
  if (allowNoReason.length > 0) {
    out.push({
      code: "allow_without_reason",
      message: `${allowNoReason.length} allowed ${
        allowNoReason.length === 1 ? "child needs" : "children need"
      } a reason`,
    });
  }
  return out;
}

export function canApplyRound(round: HoldRound): boolean {
  return roundBlockers(round).length === 0;
}

/**
 * Children whose bill has moved since the round was built.
 *
 * Paying is the case that matters: a family who cleared their dues on
 * Tuesday must not lose a bus seat on Wednesday because Monday's list still
 * names them. Reported, never auto-dropped — removing a name from a list
 * somebody already approved is its own surprise.
 */
export function staleItems(
  round: HoldRound,
  current: DefaulterFacts[],
): { studentId: string; was: number; now: number; cleared: boolean }[] {
  const byId = new Map(current.map((f) => [f.studentId, f]));
  const out: { studentId: string; was: number; now: number; cleared: boolean }[] =
    [];
  for (const item of round.items) {
    if (item.decision !== "disallow") continue;
    const now = byId.get(item.studentId);
    const nowAmount = now ? now.overdueAmountPaise : 0;
    if (nowAmount < item.overdueAmountPaise) {
      out.push({
        studentId: item.studentId,
        was: item.overdueAmountPaise,
        now: nowAmount,
        cleared: nowAmount <= 0,
      });
    }
  }
  return out;
}

/**
 * The effective record a round leaves behind.
 *
 * One row per child the office actually decided about. An "allow" is kept,
 * not dropped, because next month's round must know this family was
 * considered and spared, and by whom.
 */
export type HoldDecisionRecord = {
  studentId: string;
  holdCode: HoldCode;
  decision: "disallow" | "allow";
  reason: string;
  roundId: string;
  stage: OverdueStage;
  overdueAmountPaise: number;
  decidedAt: string;
  decidedBy: string;
};

export function applyRound(
  round: HoldRound,
  appliedBy: string,
  now = new Date().toISOString(),
): { round: HoldRound; records: HoldDecisionRecord[] } | { error: string } {
  const blockers = roundBlockers(round);
  if (blockers.length > 0) return { error: blockers[0]!.message };

  const records: HoldDecisionRecord[] = round.items
    .filter((i) => i.decision === "disallow" || i.decision === "allow")
    .map((i) => ({
      studentId: i.studentId,
      holdCode: round.holdCode,
      decision: i.decision as "disallow" | "allow",
      reason: i.reason,
      roundId: round.id,
      stage: i.stage,
      overdueAmountPaise: i.overdueAmountPaise,
      decidedAt: now,
      decidedBy: appliedBy,
    }));

  return {
    round: { ...round, status: "applied", appliedAt: now, appliedBy },
    records,
  };
}
