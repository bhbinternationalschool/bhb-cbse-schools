/**
 * The standing decisions and the policy, held where a gate can read them
 * without awaiting anything.
 *
 * `checkHold` is called from render paths — once per rider on the transport
 * desk, once per child on the admit-card screen. It has always been
 * synchronous and the call sites depend on that. So the server's answer is
 * fetched once and kept in memory, and the gates read the snapshot.
 *
 * NOT LOADED IS NOT THE SAME AS NONE
 * The snapshot says which it is. A gate asked before the fetch lands gets
 * `known: false` and does not invent a block — see the reasoning in
 * `holdResolve.ts`. What it must never do is return an empty list that reads
 * like "nobody is blocked", which is the defect class this project keeps
 * writing down.
 *
 * MEMORY ONLY, DELIBERATELY
 * This is not stashed in localStorage like the desk modules. A block is
 * server truth and it changes when somebody else applies a round; a stale
 * copy surviving a page reload would let one browser carry yesterday's
 * answer all day. Re-fetching on load costs one request.
 */

import {
  defaultDefaulterPolicy,
  gateFor,
  type DefaulterPolicy,
  type HoldGate,
} from "@/lib/defaulterHoldPolicy";
import {
  indexStandingDecisions,
  standingKey,
  type StandingDecision,
} from "@/lib/holdResolve";
import type { HoldCode } from "@/lib/types";

type Snapshot = {
  known: boolean;
  policy: DefaulterPolicy;
  byKey: Map<string, StandingDecision>;
  decisions: StandingDecision[];
  loadedAt: string | null;
  error: string;
};

const EMPTY: Snapshot = {
  known: false,
  policy: defaultDefaulterPolicy(),
  byKey: new Map(),
  decisions: [],
  loadedAt: null,
  error: "",
};

let snapshot: Snapshot = EMPTY;
let inflight: Promise<Snapshot> | null = null;

export function holdDecisionsSnapshot(): Snapshot {
  return snapshot;
}

export function standingDecisionFor(
  studentId: string,
  holdCode: HoldCode,
): StandingDecision | null | undefined {
  // undefined = we do not know; null = we know there is none. The callers
  // treat these differently and collapsing them would hide the difference.
  if (!snapshot.known) return undefined;
  return snapshot.byKey.get(standingKey(studentId, holdCode)) ?? null;
}

export function gateForHold(holdCode: HoldCode): HoldGate | null {
  return gateFor(snapshot.policy, holdCode);
}

/**
 * Load once. Concurrent callers share the same request, so eight panels
 * mounting together do not make eight round trips.
 */
export async function ensureHoldDecisionsHydrated(
  opts: { force?: boolean } = {},
): Promise<Snapshot> {
  if (!opts.force && snapshot.known) return snapshot;
  if (!opts.force && inflight) return inflight;

  inflight = (async () => {
    try {
      const r = await fetch("/api/fees/hold-decisions", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      const decisions = (j.decisions ?? []) as StandingDecision[];
      snapshot = {
        known: true,
        policy: (j.policy ?? defaultDefaulterPolicy()) as DefaulterPolicy,
        byKey: indexStandingDecisions(decisions),
        decisions,
        loadedAt: new Date().toISOString(),
        error: "",
      };
    } catch (e) {
      // Stay "not known". A failed load must not look like an empty list.
      snapshot = {
        ...EMPTY,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      inflight = null;
    }
    return snapshot;
  })();

  return inflight;
}

/** After applying a round or releasing a block, the snapshot is stale. */
export function invalidateHoldDecisions(): void {
  snapshot = EMPTY;
  inflight = null;
}
