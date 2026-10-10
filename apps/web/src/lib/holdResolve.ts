/**
 * The one question every gate asks: may this child do this thing today?
 *
 * Pure, so it can be argued with in a test rather than in production. The
 * callers — the admit card printer, the transport desk, the certificate
 * counter — supply what they know and get back a verdict with its reason.
 *
 * THREE SOURCES, IN THIS ORDER
 *
 *  1. A STANDING DECISION beats everything. Somebody looked at this child,
 *     in a round, and said withhold or let through. That is a human act and
 *     no arithmetic overrides it.
 *  2. THE GATE'S MODE decides what silence means. Under "propose", silence
 *     means allowed: blocks are the exception and they are written down, so
 *     a child with no decision has not been blocked by anyone. Under "auto",
 *     silence means the old behaviour — qualify and you are held.
 *  3. THE PRINCIPAL PIN OVERRIDE, which has always been the escape hatch and
 *     still is.
 *
 * WHY "PROPOSE" INVERTS THE DEFAULT
 * This is the whole point of the change and worth being explicit about. Under
 * the old engine a gate at S3 blocked everyone at S3, immediately, with no
 * list and no approval. Switching transport to "propose" means it blocks
 * nobody until a round says so. Two thirds of the bus stops being at the
 * mercy of an arithmetic nobody reviewed.
 *
 * WHAT HAPPENS WHEN WE DO NOT KNOW
 * The standing decisions live on the server. A screen that has not loaded
 * them yet knows nothing, and the verdict says so with `decisionsKnown:
 * false`. It does NOT invent a block: refusing a child at a bus door because
 * a fetch was slow is a worse failure than carrying one who owes money for a
 * morning. The flag exists so the screen can say "not checked yet" instead of
 * quietly implying it was.
 */

import type { HoldCode, OverdueStage } from "@/lib/types";
import {
  qualifiesForGate,
  type DefaulterFacts,
  type HoldGate,
} from "@/lib/defaulterHoldPolicy";

/** A decision somebody made about this child, still in force. */
export type StandingDecision = {
  studentId: string;
  holdCode: HoldCode;
  decision: "disallow" | "allow";
  reason: string;
  decidedAt: string;
  decidedBy: string;
};

export type HoldVerdict = {
  allowed: boolean;
  /**
   * Which of the three sources settled it. Shown to the office, because
   * "held by the rule" and "held because the principal said so last Tuesday"
   * are different conversations with a parent.
   */
  basis:
    | "no_gate"
    | "standing_disallow"
    | "standing_allow"
    | "auto_qualified"
    | "auto_below_gate"
    | "awaiting_round"
    | "pin_override";
  message: string;
  /** False when the standing decisions had not loaded when this was asked. */
  decisionsKnown: boolean;
};

export function resolveHold(input: {
  holdCode: HoldCode;
  label: string;
  gate: HoldGate | null;
  facts: DefaulterFacts;
  /** Undefined means "not loaded", which is not the same as "none". */
  standing: StandingDecision | null | undefined;
  decisionsKnown: boolean;
  /** A live Principal PIN override from the old engine, if any. */
  pinOverrideUntil?: string | null;
  stageText?: string;
  amountText?: string;
}): HoldVerdict {
  const {
    gate,
    label,
    facts,
    standing,
    decisionsKnown,
    pinOverrideUntil,
  } = input;

  if (!gate || gate.mode === "off") {
    return {
      allowed: true,
      basis: "no_gate",
      message: "",
      decisionsKnown,
    };
  }

  // A human decision, first and last.
  if (standing?.decision === "disallow") {
    return {
      allowed: false,
      basis: "standing_disallow",
      message:
        `${label} withheld — decided ${shortDate(standing.decidedAt)}` +
        (standing.decidedBy ? ` by ${standing.decidedBy}` : "") +
        (standing.reason ? `. ${standing.reason}` : "") +
        ". Clear the dues or lift it from the defaulter policy screen.",
      decisionsKnown,
    };
  }
  if (standing?.decision === "allow") {
    return {
      allowed: true,
      basis: "standing_allow",
      message: standing.reason
        ? `Let through: ${standing.reason}`
        : "Let through by the office",
      decisionsKnown,
    };
  }

  // The PIN override the old engine has always had. Checked after a standing
  // decision so a round cannot be quietly undone by a week-old PIN, and
  // before the rule so it still rescues an automatic hold.
  if (pinOverrideUntil) {
    return {
      allowed: true,
      basis: "pin_override",
      message: `Principal override in force until ${pinOverrideUntil}`,
      decisionsKnown,
    };
  }

  if (gate.mode === "propose") {
    // Silence means allowed. Nobody has put this child on a list.
    return {
      allowed: true,
      basis: "awaiting_round",
      message: decisionsKnown
        ? ""
        : `${label}: standing decisions not loaded — not checked.`,
      decisionsKnown,
    };
  }

  // mode === "auto": the rule decides, floors included.
  const q = qualifiesForGate(gate, facts);
  if (!q.qualifies) {
    return {
      allowed: true,
      basis: "auto_below_gate",
      message: "",
      decisionsKnown,
    };
  }

  const amount = input.amountText ? ` · ${input.amountText} overdue` : "";
  const stage = input.stageText || facts.stage;
  const days =
    facts.overdueDays < 0 ? "upcoming" : `${facts.overdueDays}d overdue`;
  return {
    allowed: false,
    basis: "auto_qualified",
    message: `${label} held at ${stage} (${days}${amount}). Principal PIN override required.`,
    decisionsKnown,
  };
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Index standing decisions for lookup.
 *
 * Returns a Map rather than a find() over an array because the transport
 * desk asks this once per rider per render, and 155 riders times a linear
 * scan is the kind of thing that turns into "the fees counter is slow".
 */
export function indexStandingDecisions(
  decisions: StandingDecision[],
): Map<string, StandingDecision> {
  const m = new Map<string, StandingDecision>();
  for (const d of decisions) m.set(`${d.studentId}::${d.holdCode}`, d);
  return m;
}

export function standingKey(studentId: string, holdCode: HoldCode): string {
  return `${studentId}::${holdCode}`;
}

/** Convenience for callers that hold a stage but no full facts. */
export function factsFrom(
  studentId: string,
  stage: OverdueStage,
  overdueDays: number,
  overdueAmountPaise: number,
): DefaulterFacts {
  return { studentId, stage, overdueDays, overdueAmountPaise };
}
