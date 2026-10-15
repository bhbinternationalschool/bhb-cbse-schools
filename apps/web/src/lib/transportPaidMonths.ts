/**
 * Transport money follows the child and the month, not the assignment id.
 *
 * THE DEFECT (production, 15 Oct 2026)
 * A transport due is keyed `transport:<student>:<assignment>:<YYYY-MM>`, and
 * "is this month paid" was answered by looking up exactly that key. Change a
 * rider's stop and backdate the new assignment over a month the family has
 * already paid, and the month is re-billed under the NEW assignment id: the
 * receipt line, still keyed to the old id, matches nothing, and the paid
 * month shows as owing. Anvi Yadav's September (₹500, paid 10 Sep) did
 * exactly that after a 14 Sep stop change backdated to 1 Sep.
 *
 * THE RULE
 * A transport month for a student is paid by every non-voided receipt line
 * that paid THAT student's transport for THAT month, whatever assignment id
 * it was collected under. Each receipt line is counted once — the sum is over
 * distinct due keys, and a month has one transport charge (the dues engine
 * already keeps one assignment per month), so nothing is counted twice.
 *
 * Partial payment and a fee change fall out of the sum: ₹500 paid under the
 * old stop against a new ₹600 month leaves ₹100 owing — not ₹600, not ₹0.
 *
 * Pure. No imports from the fee or transport stores, so every caller (fee
 * counter, open-dues rebuild, pay links, defaulters, reports, compliance
 * alerts) uses the one definition.
 */

export type ParsedTransportDueKey = {
  studentId: string;
  assignmentId: string;
  periodKey: string;
};

const PERIOD_RE = /^\d{4}-\d{2}$/;

/**
 * `transport:<student>:<assignment>:<YYYY-MM>` → its parts, or null for any
 * other shape. Strict on purpose: a key that does not parse is never folded
 * into anybody's month. (Production, 15 Oct: all 758 transport lines parse.)
 */
export function parseTransportDueKey(key: string): ParsedTransportDueKey | null {
  if (!key || !key.startsWith("transport:")) return null;
  const parts = key.split(":");
  if (parts.length !== 4) return null;
  const [, studentId, assignmentId, periodKey] = parts;
  if (!studentId || !assignmentId || !periodKey || !PERIOD_RE.test(periodKey)) {
    return null;
  }
  return { studentId, assignmentId, periodKey };
}

function monthKey(studentId: string, periodKey: string): string {
  return `${studentId}|${periodKey}`;
}

/**
 * One pass over an amount-by-due-key map (paid, or waived), summing every
 * transport key by student + month.
 */
export function transportAmountByStudentMonth(
  byDueKey: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, amount] of byDueKey) {
    if (!amount) continue;
    const p = parseTransportDueKey(key);
    if (!p) continue;
    const k = monthKey(p.studentId, p.periodKey);
    out.set(k, (out.get(k) ?? 0) + amount);
  }
  return out;
}

/**
 * The indexes are derived from the map they were built from and remembered
 * against that map object, so the fee counter — which reuses one paid map for
 * up to 80 students per keystroke — scans it once, not once per student. The
 * map's size is checked on every read and the indexes rebuilt if it changed;
 * the paid maps are built whole by `paidByDueKey` and never edited afterwards.
 */
type StudentMonths = Map<string, { amountPaise: number; dueKeys: string[] }>;
type Indexes = { size: number; byMonth: Map<string, number>; byStudent: Map<string, StudentMonths> };
const indexCache = new WeakMap<ReadonlyMap<string, number>, Indexes>();

function indexFor(byDueKey: ReadonlyMap<string, number>): Indexes {
  const hit = indexCache.get(byDueKey);
  if (hit && hit.size === byDueKey.size) return hit;
  const byMonth = new Map<string, number>();
  const byStudent = new Map<string, StudentMonths>();
  for (const [key, amount] of byDueKey) {
    if (!amount) continue;
    const p = parseTransportDueKey(key);
    if (!p) continue;
    const k = monthKey(p.studentId, p.periodKey);
    byMonth.set(k, (byMonth.get(k) ?? 0) + amount);
    let months = byStudent.get(p.studentId);
    if (!months) byStudent.set(p.studentId, (months = new Map()));
    const cur = months.get(p.periodKey) ?? { amountPaise: 0, dueKeys: [] };
    cur.amountPaise += amount;
    cur.dueKeys.push(key);
    months.set(p.periodKey, cur);
  }
  for (const months of byStudent.values()) {
    for (const v of months.values()) v.dueKeys.sort();
  }
  const built = { size: byDueKey.size, byMonth, byStudent };
  indexCache.set(byDueKey, built);
  return built;
}

/**
 * How much has been paid (or waived — pass that map) towards one student's
 * transport for one month, across every assignment id it was collected under.
 */
export function transportMonthAmount(
  byDueKey: ReadonlyMap<string, number>,
  studentId: string,
  periodKey: string,
): number {
  return indexFor(byDueKey).byMonth.get(monthKey(studentId, periodKey)) ?? 0;
}

/**
 * Every month this student has transport money against, with the keys it sits
 * under — used to show a paid month whose assignment no longer bills it.
 * Read-only: the result is shared with later callers.
 */
export function transportMonthsForStudent(
  byDueKey: ReadonlyMap<string, number>,
  studentId: string,
): ReadonlyMap<string, { amountPaise: number; dueKeys: readonly string[] }> {
  return indexFor(byDueKey).byStudent.get(studentId) ?? new Map();
}

/**
 * Months a new assignment starting `effectiveFrom` would cover that already
 * have money against them. The editor shows these as a warning — the payment
 * carries over to the new stop, nothing is rewritten, nothing is blocked.
 */
export function paidMonthsCoveredByNewStart(
  months: { periodKey: string; paidPaise: number }[],
  effectiveFrom: string,
): string[] {
  const from = (effectiveFrom || "").slice(0, 7);
  if (!PERIOD_RE.test(from)) return [];
  return [
    ...new Set(
      months.filter((m) => m.paidPaise > 0 && m.periodKey >= from).map((m) => m.periodKey),
    ),
  ].sort();
}
