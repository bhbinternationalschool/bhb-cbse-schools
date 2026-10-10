/**
 * The school's defaulter policy — which service a family loses, from when,
 * and who decides.
 *
 * WHAT WAS ALREADY HERE, AND WHY THIS EXISTS ANYWAY
 * The holds engine in `holds.ts` has blocked things since July: nine hold
 * codes, a stage ladder, a Principal PIN override. Three things were missing,
 * and each of them is a reason a head teacher could not actually use it.
 *
 *  1. THE POLICY WAS A CONSTANT. `HOLD_FROM_STAGE` is frozen in the source.
 *     The school could change exactly one hold — report cards — from a select
 *     buried in the exams policy tab. Everything else needed a developer.
 *
 *  2. THE STAGE IGNORED THE AMOUNT. `resolveStage` reads only days past due.
 *     `fee_recovery_policies` has said since July that S3 needs ₹1,000 as
 *     well as sixteen days, and nothing has ever read that column. A child
 *     fifty rupees short for a fortnight sat at "S3 Serious" beside a family
 *     owing forty thousand, and `HOLD_TRANSPORT` fires at S3. Measured
 *     against production on 13 Sep 2026, the existing settings would take the
 *     bus from 102 of 155 riders — two thirds of the children on it. A policy
 *     that catches two thirds of the school is not a policy, it is an outage.
 *
 *  3. NOBODY CONFIRMED ANYTHING. A hold was a pure function of today's dues,
 *     so it appeared and vanished on its own. The office could not see who
 *     was about to lose a seat, and there was no moment at which a person
 *     agreed to it.
 *
 * So the policy becomes data the school edits, it carries a money floor as
 * well as a day count, and — for the gates that turn a child away at a gate
 * or a bus door — it proposes rather than acts. A round is a list a human
 * reads and approves. Nothing in here blocks anybody on its own.
 *
 * WHAT MAY NEVER BE WITHHELD
 * `buildPlaybook` has always published a `stillAllowed` list: class
 * attendance, homework and learning access, emergency medical, child pickup
 * safety. `BLOCKABLE_HOLD_CODES` below is the enforcement of that promise —
 * a gate can only ever be created for a code on it, so no future screen can
 * quietly add "attendance" as a lever.
 */

import type { HoldCode, OverdueStage } from "@/lib/types";

/** Stage order, lowest first. Exported so callers need not re-derive it. */
export const STAGE_ORDER: OverdueStage[] = ["S0", "S1", "S2", "S3", "S4"];

export function stageRank(stage: OverdueStage): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? 0 : i;
}

/**
 * The only services a defaulter policy may withhold.
 *
 * Deliberately narrower than `HoldCode`. Attendance, homework and anything
 * safety-shaped are absent by construction rather than by discipline.
 */
export const BLOCKABLE_HOLD_CODES: HoldCode[] = [
  "HOLD_TRANSPORT",
  "HOLD_ADMIT_CARD",
  "HOLD_REPORT_CARD",
  "HOLD_CERT",
  "HOLD_TC",
  "HOLD_STORE_CREDIT",
  "HOLD_LIBRARY",
  "HOLD_TRIP",
  "HOLD_NEXT_AY",
];

export function isBlockableHold(code: string): code is HoldCode {
  return (BLOCKABLE_HOLD_CODES as string[]).includes(code);
}

/**
 * How a gate behaves once a child qualifies.
 *
 * "off"     the gate is not in use at all.
 * "propose" the child joins a round for the office to approve. Nothing is
 *           withheld until a person applies that round.
 * "auto"    qualifying withholds the service immediately, as the engine has
 *           always behaved. Kept because report cards and certificates have
 *           worked this way for two months and switching them silently would
 *           be its own surprise.
 */
export type HoldGateMode = "off" | "propose" | "auto";

export type HoldGate = {
  holdCode: HoldCode;
  mode: HoldGateMode;
  /** Stage at or above which the gate may fire. */
  fromStage: OverdueStage;
  /**
   * Money floor, in paise. A child below it never qualifies however long the
   * bill has been open. Zero means no floor, which is what the engine did
   * before this existed.
   */
  minAmountPaise: number;
  /**
   * Day floor, counted from the earliest unpaid due. Applied on top of the
   * stage so a school can say "S3, but never before three weeks".
   */
  minOverdueDays: number;
};

export type DefaulterPolicy = {
  version: 1;
  gates: HoldGate[];
  /**
   * Free text the office sees on the round screen and, where a gate produces
   * a parent message, in that message. Not used for any decision.
   */
  note: string;
};

/**
 * Defaults that reproduce today's behaviour rather than improve on it.
 *
 * Every stage matches the `HOLD_FROM_STAGE` constant the engine already uses,
 * and every floor is zero, so installing this policy changes nothing until
 * somebody edits it. The two gates the school asked to run by approval —
 * transport and admit cards — are the ones set to "propose"; the rest keep
 * the mode the July seed gave them.
 */
export function defaultDefaulterPolicy(): DefaulterPolicy {
  return {
    version: 1,
    note: "",
    gates: [
      gate("HOLD_TRANSPORT", "propose", "S3"),
      gate("HOLD_ADMIT_CARD", "propose", "S3"),
      gate("HOLD_REPORT_CARD", "auto", "S2"),
      gate("HOLD_CERT", "auto", "S3"),
      gate("HOLD_TC", "auto", "S4"),
      gate("HOLD_STORE_CREDIT", "off", "S1"),
      gate("HOLD_LIBRARY", "off", "S2"),
      gate("HOLD_TRIP", "off", "S3"),
      gate("HOLD_NEXT_AY", "off", "S4"),
    ],
  };
}

function gate(
  holdCode: HoldCode,
  mode: HoldGateMode,
  fromStage: OverdueStage,
): HoldGate {
  return {
    holdCode,
    mode,
    fromStage,
    minAmountPaise: 0,
    minOverdueDays: 0,
  };
}

function clampStage(v: unknown): OverdueStage {
  return STAGE_ORDER.includes(v as OverdueStage) ? (v as OverdueStage) : "S3";
}

function clampMode(v: unknown): HoldGateMode {
  return v === "off" || v === "propose" || v === "auto" ? v : "off";
}

function clampNonNegative(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * A stored gate is untrusted input, so the parameter is deliberately loose.
 * Typing it as `Partial<HoldGate>` would be a promise the caller cannot keep:
 * the value comes out of a jsonb column or a PostgREST row, and the whole
 * point of this function is that it may be anything at all.
 */
export function normalizeHoldGate(input: unknown): HoldGate | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const code = String(raw.holdCode ?? "");
  if (!isBlockableHold(code)) return null;
  return {
    holdCode: code,
    mode: clampMode(raw.mode),
    fromStage: clampStage(raw.fromStage),
    minAmountPaise: clampNonNegative(raw.minAmountPaise),
    minOverdueDays: clampNonNegative(raw.minOverdueDays),
  };
}

/** What a stored policy looks like before anybody has checked it. */
export type StoredDefaulterPolicy = {
  version?: unknown;
  note?: unknown;
  gates?: unknown;
};

/**
 * Read a stored policy back into something safe to act on.
 *
 * A gate for an unknown or unblockable code is dropped rather than repaired —
 * if a future rename leaves "HOLD_ATTENDANCE" in the blob, the right outcome
 * is that nothing is withheld, not that a best guess is made.
 */
export function normalizeDefaulterPolicy(
  input: StoredDefaulterPolicy | DefaulterPolicy | null | undefined,
): DefaulterPolicy {
  const fallback = defaultDefaulterPolicy();
  if (!input || typeof input !== "object") return fallback;

  const seen = new Set<HoldCode>();
  const gates: HoldGate[] = [];
  for (const raw of Array.isArray(input.gates) ? input.gates : []) {
    const g = normalizeHoldGate(raw);
    if (!g || seen.has(g.holdCode)) continue;
    seen.add(g.holdCode);
    gates.push(g);
  }
  // A code the stored policy never mentioned keeps its default, so adding a
  // hold code in a later release does not silently arrive switched on.
  for (const d of fallback.gates) {
    if (!seen.has(d.holdCode)) gates.push({ ...d, mode: "off" });
  }

  return {
    version: 1,
    note: typeof input.note === "string" ? input.note.slice(0, 500) : "",
    gates,
  };
}

export function gateFor(
  policy: DefaulterPolicy,
  holdCode: HoldCode,
): HoldGate | null {
  return policy.gates.find((g) => g.holdCode === holdCode) ?? null;
}

/** What the engine knows about one child's bill, as far as a gate cares. */
export type DefaulterFacts = {
  studentId: string;
  stage: OverdueStage;
  overdueDays: number;
  overdueAmountPaise: number;
};

export type QualifyResult =
  | { qualifies: true }
  | {
      qualifies: false;
      /** Why not, in words the office screen can show verbatim. */
      reason: string;
    };

/**
 * Does this child meet the gate?
 *
 * All three tests must pass. They are separate rather than folded into the
 * stage because a school reasons about them separately: "serious cases only"
 * is a stage, "not for small change" is a rupee figure, and "give them three
 * weeks" is a day count.
 */
export function qualifiesForGate(
  gate: HoldGate,
  facts: DefaulterFacts,
): QualifyResult {
  if (gate.mode === "off") {
    return { qualifies: false, reason: "This gate is switched off" };
  }
  if (stageRank(facts.stage) < stageRank(gate.fromStage)) {
    return {
      qualifies: false,
      reason: `At ${facts.stage}, below the gate's ${gate.fromStage}`,
    };
  }
  if (facts.overdueDays < gate.minOverdueDays) {
    return {
      qualifies: false,
      reason: `${facts.overdueDays} days overdue, below the ${gate.minOverdueDays} day floor`,
    };
  }
  if (facts.overdueAmountPaise < gate.minAmountPaise) {
    return {
      qualifies: false,
      reason: `Below the ₹${Math.round(gate.minAmountPaise / 100)} floor`,
    };
  }
  return { qualifies: true };
}

/**
 * Everyone a gate would catch today, with the ones it would not and why.
 *
 * Returns both halves on purpose. A head teacher asking "why is this family
 * not on the list" is the commonest question about any rule, and answering it
 * from the same computation that built the list is the only way the answer
 * stays true.
 */
export function evaluateGate(
  gate: HoldGate,
  population: DefaulterFacts[],
): {
  caught: DefaulterFacts[];
  spared: { facts: DefaulterFacts; reason: string }[];
} {
  const caught: DefaulterFacts[] = [];
  const spared: { facts: DefaulterFacts; reason: string }[] = [];
  for (const facts of population) {
    const r = qualifiesForGate(gate, facts);
    if (r.qualifies) caught.push(facts);
    else spared.push({ facts, reason: r.reason });
  }
  caught.sort(
    (a, b) =>
      b.overdueAmountPaise - a.overdueAmountPaise ||
      b.overdueDays - a.overdueDays ||
      a.studentId.localeCompare(b.studentId),
  );
  return { caught, spared };
}
