/**
 * Which open dues are "ahead" — months the family may pay in advance but is
 * not yet being asked for. Pure, so the split is pinned by a self-test: a
 * due that lands in the wrong bucket is either a nag for money not yet
 * owed, or a hidden option to pay early.
 */
import { isAfterRunningSessionMonth } from "@/lib/fees";

export type FutureFlagged<T extends { dueOn: string | null }> = T & { future: boolean };

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Tag each due as current or future relative to the running session month. */
export function flagFutureDues<T extends { dueOn: string | null }>(
  dues: T[],
  asOf: string,
): FutureFlagged<T>[] {
  return dues.map((d) => ({
    ...d,
    future: !!d.dueOn && isAfterRunningSessionMonth(d.dueOn, asOf),
  }));
}

/**
 * Merge the current list (what the family is asked for now) with the full
 * list (current + ahead): anything in the full list that the current list
 * lacks is a future due. Keyed by dueKey; current wins on overlap.
 */
export function mergeCurrentAndFuture<T extends { dueKey: string; dueOn: string | null }>(
  current: T[],
  full: T[],
  asOf: string,
): FutureFlagged<T>[] {
  const have = new Set(current.map((d) => d.dueKey));
  const ahead = full.filter((d) => !have.has(d.dueKey));
  return [
    ...current.map((d) => ({ ...d, future: false })),
    ...flagFutureDues(ahead, asOf).filter((d) => d.future),
  ];
}
