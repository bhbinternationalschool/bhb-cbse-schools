/**
 * When a counter discount is given on a recurring fee head, optionally create
 * a Masters concession rule + student grant for future installments.
 */

import {
  activeGrantOnHead,
  isStudentAlreadyGranted,
} from "@/lib/concessionSuggest";
import type { CounterDiscountSlice } from "@/lib/feeAdjustments";
import { FEE_ADJUST_AUTO_LIMIT_PAISE } from "@/lib/feeAdjustments";
import type { FeeDueLine } from "@/lib/fees";
import {
  formatInr,
  loadMasters,
  newId,
  saveMasters,
  type ConcessionGrant,
  type ConcessionRule,
  type MastersState,
} from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";

export type FutureConcessionCandidate = {
  /** Stable key for UI selection */
  key: string;
  dueKey: string;
  studentId: string;
  studentName: string;
  feeHeadId: string;
  feeHeadName: string;
  discountPaise: number;
  billedPaise: number;
  installmentCount: number;
  currentDueOn: string;
  futureEffectiveFrom: string;
  dueLabel: string;
  /**
   * Standing Masters concessions this student ALREADY holds on this head.
   * The office must see these before adding another — two concessions on
   * one head stack, and a clerk who cannot see the first will not expect
   * the second to double the discount from next month on.
   */
  existing: {
    grantId: string;
    ruleName: string;
    rateLabel: string;
    /** What this rule takes off THIS line today, for a concrete comparison. */
    currentAmountPaise: number;
  }[];
};

function candidateKey(
  studentId: string,
  feeHeadId: string,
  discountPaise: number,
): string {
  return `${studentId}:${feeHeadId}:${discountPaise}`;
}

/** How many structure lines bill this head for the student's fee group. */
export function structureLineCountForHead(
  masters: MastersState,
  feeGroupId: string | null | undefined,
  feeHeadId: string,
  academicYearCode: string,
): number {
  if (!feeGroupId || !feeHeadId) return 0;
  return masters.feeStructureLines.filter((sl) => {
    if (sl.feeGroupId !== feeGroupId || sl.feeHeadId !== feeHeadId) return false;
    if (!sl.installmentId) return true;
    const inst = masters.installments.find((i) => i.id === sl.installmentId);
    return (
      !!inst &&
      inst.isActive &&
      inst.academicYearCode === academicYearCode
    );
  }).length;
}

export function isRecurringAcademicFeeHead(
  masters: MastersState,
  student: SisStudent,
  feeHeadId: string,
  academicYearCode: string,
): boolean {
  return (
    structureLineCountForHead(
      masters,
      student.feeGroupId,
      feeHeadId,
      academicYearCode,
    ) >= 2
  );
}

function nextInstallmentDueOn(
  masters: MastersState,
  student: SisStudent,
  feeHeadId: string,
  afterDueOn: string,
): string {
  const dates = masters.feeStructureLines
    .filter(
      (sl) =>
        sl.feeGroupId === student.feeGroupId && sl.feeHeadId === feeHeadId,
    )
    .map((sl) => {
      if (!sl.installmentId) return afterDueOn;
      return (
        masters.installments.find((i) => i.id === sl.installmentId)?.dueOn ??
        afterDueOn
      );
    })
    .filter((d) => d > afterDueOn)
    .sort();
  if (dates.length > 0) return dates[0]!;
  const y = afterDueOn.slice(0, 4);
  return `${y}-12-31`;
}

/**
 * The latest due date for this student+head that the current transaction is
 * already dealing with. Falls back to the clicked line when it is the only one.
 */
function lastHandledDueOnFor(
  dues: FeeDueLine[],
  studentId: string,
  feeHeadId: string,
  fallbackDueOn: string,
  isTransport = false,
): string {
  let latest = fallbackDueOn;
  for (const d of dues) {
    if (d.studentId !== studentId) continue;
    if (isTransport) {
      if (d.kind !== "transport") continue;
    } else if (d.kind !== "academic" || d.feeHeadId !== feeHeadId) {
      continue;
    }
    if (d.dueOn > latest) latest = d.dueOn;
  }
  return latest;
}

/** First of the month after `dueOn` — transport is billed by the month. */
function firstOfNextMonth(dueOn: string): string {
  const [y, m] = dueOn.split("-").map(Number);
  if (!y || !m) return dueOn;
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function listFutureConcessionCandidates(
  slices: CounterDiscountSlice[],
  dues: FeeDueLine[],
  masters: MastersState,
  students: SisStudent[],
  academicYearCode: string,
): FutureConcessionCandidate[] {
  const dueByKey = new Map(dues.map((d) => [d.dueKey, d]));
  const studentById = new Map(students.map((s) => [s.id, s]));
  const out: FutureConcessionCandidate[] = [];
  const seen = new Set<string>();

  for (const slice of slices) {
    const due = dueByKey.get(slice.dueKey);
    // Transport joins academic here. A route is billed every month it runs,
    // so a discount on it is exactly the kind that should be able to stand —
    // the office was granting one month at a time and re-entering it.
    if (!due || (due.kind !== "academic" && due.kind !== "transport")) continue;
    if (!due.feeHeadId) continue;
    const isTransport = due.kind === "transport";
    const student = studentById.get(slice.studentId);
    if (!student) continue;

    const key = candidateKey(slice.studentId, due.feeHeadId, slice.amountPaise);
    if (seen.has(key)) continue;

    // Only RECURRING heads may become a standing concession. A one-time or
    // as-needed head (admission fee, security deposit, a single event
    // charge) is discounted once and must never leave a rule behind that
    // silently discounts some future charge nobody was thinking about.
    const head = masters.feeHeads.find((h) => h.id === due.feeHeadId);
    if (
      !isTransport &&
      head &&
      (head.frequency === "one_time" || head.frequency === "as_needed")
    ) {
      continue;
    }

    /**
     * Recurrence, per kind.
     *
     * An academic head is recurring when the fee structure bills it more
     * than once. Transport has no structure lines at all — it is priced off
     * the route — so that test returns 0 and would refuse every transport
     * discount. A route is recurring by nature, so it qualifies on its own
     * terms, and the count shown is the transport months this receipt can
     * actually see rather than a structure figure that does not exist.
     */
    const installmentCount = isTransport
      ? dues.filter(
          (d) => d.kind === "transport" && d.studentId === slice.studentId,
        ).length
      : structureLineCountForHead(
          masters,
          student.feeGroupId,
          due.feeHeadId,
          academicYearCode,
        );
    if (!isTransport && installmentCount < 2) continue;

    seen.add(key);
    out.push({
      key,
      dueKey: slice.dueKey,
      studentId: slice.studentId,
      studentName: student.fullName,
      feeHeadId: due.feeHeadId,
      feeHeadName: due.feeHeadName,
      discountPaise: slice.amountPaise,
      billedPaise: due.billedPaise,
      installmentCount,
      currentDueOn: due.dueOn,
      /**
       * Starts after the LAST month this transaction already handles for
       * this student and head — not after the line the clerk happened to
       * click.
       *
       * The counter takes April and May together, the clerk discounts April
       * and ticks "apply to future months". Keyed off April alone, the
       * standing grant began in May — the very month sitting in the same
       * basket. May was then discounted by hand as well, because on screen
       * it still showed the full amount, and at the next billing May carried
       * BOTH: the counter waiver and the standing grant, double the discount
       * anyone intended. `applyPostedWaiver` subtracts the waiver on top of
       * whatever `concessionForHead` already took off, so nothing downstream
       * catches it.
       *
       * Basing it on the last month in the basket means the standing
       * discount can never overlap a month this receipt has already dealt
       * with. April and May on the receipt → the grant runs from June.
       */
      futureEffectiveFrom: (() => {
        const lastHandled = lastHandledDueOnFor(
          dues,
          slice.studentId,
          due.feeHeadId,
          due.dueOn,
          isTransport,
        );
        return isTransport
          ? firstOfNextMonth(lastHandled)
          : nextInstallmentDueOn(masters, student, due.feeHeadId, lastHandled);
      })(),
      dueLabel: due.label,
      existing: existingHeadConcessions(masters, due),
    });
  }
  return out;
}

/**
 * What this line's own concession detail already says — the dues engine has
 * done the resolution, so the modal can name the rules and amounts exactly
 * as Fee Take is charging them today.
 */
function existingHeadConcessions(
  masters: MastersState,
  due: FeeDueLine,
): FutureConcessionCandidate["existing"] {
  return (due.concessionDetails ?? [])
    .filter((d) => d.amountPaise > 0)
    .map((d) => ({
      grantId: d.grantId,
      ruleName: d.name || d.code || "Concession",
      rateLabel: d.rateLabel || formatInr(d.amountPaise),
      currentAmountPaise: d.amountPaise,
    }));
}

function counterRuleCode(feeHeadCode: string, discountPaise: number): string {
  const safe = (feeHeadCode || "HEAD").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `CTR-${safe}-${discountPaise}`;
}

function findMatchingCounterRule(
  masters: MastersState,
  academicYearCode: string,
  feeHeadId: string,
  discountPaise: number,
  feeHeadCode: string,
): ConcessionRule | undefined {
  const code = counterRuleCode(feeHeadCode, discountPaise);
  return masters.concessions.find(
    (c) =>
      c.isActive &&
      c.academicYearCode === academicYearCode &&
      (c.code === code ||
        (c.mode === "fixed" &&
          c.value === discountPaise &&
          c.feeHeadIds.length === 1 &&
          c.feeHeadIds[0] === feeHeadId &&
          c.kind === "other" &&
          c.notes.includes("Fee Take counter"))),
  );
}

function ensureCounterConcessionRule(
  masters: MastersState,
  input: {
    academicYearCode: string;
    feeHeadId: string;
    feeHeadCode: string;
    feeHeadName: string;
    discountPaise: number;
    reason: string;
  },
): { state: MastersState; rule: ConcessionRule; created: boolean } {
  const existing = findMatchingCounterRule(
    masters,
    input.academicYearCode,
    input.feeHeadId,
    input.discountPaise,
    input.feeHeadCode,
  );
  if (existing) {
    return { state: masters, rule: existing, created: false };
  }

  const rule: ConcessionRule = {
    id: newId("cnc"),
    code: counterRuleCode(input.feeHeadCode, input.discountPaise),
    name: `${input.feeHeadName} · ${formatInr(input.discountPaise)} off`,
    kind: "other",
    academicYearCode: input.academicYearCode,
    mode: "fixed",
    value: input.discountPaise,
    siblingTiers: [],
    feeHeadIds: [input.feeHeadId],
    autoApproveMaxPaise: FEE_ADJUST_AUTO_LIMIT_PAISE,
    documentationRequired: false,
    incompatibleCodes: [],
    notes: `Fee Take counter · recurring discount · ${input.reason.trim() || "Management approval"}`,
    isActive: true,
  };

  return {
    state: {
      ...masters,
      concessions: [...masters.concessions, rule],
    },
    rule,
    created: true,
  };
}

function grantNeedsPrincipal(rule: ConcessionRule, discountPaise: number): boolean {
  if (rule.autoApproveMaxPaise == null) return true;
  return discountPaise > rule.autoApproveMaxPaise;
}

export function applyFutureConcessionsFromCounter(input: {
  candidates: FutureConcessionCandidate[];
  applyKeys: Set<string>;
  reason: string;
  academicYearCode: string;
  /**
   * The receipt this discount rode in on. Stamped into each grant's reason
   * (`[v:<voucherId>]`) so voiding that receipt can auto-revoke the grants
   * it created — a dead receipt must not leave its concession running.
   */
  sourceVoucherId?: string;
  sourceReceiptNo?: string;
  /**
   * Whether the person at the counter may approve a concession.
   *
   * The fee counter creates standing grants exactly like Masters does, so
   * the same rule has to hold here: an assigned user's recurring discount is
   * PENDING until owner, admin or principal approves it. Without this a
   * clerk who cannot approve a ₹500 grant in Masters could approve the same
   * ₹500 by ticking a box at the counter.
   *
   * Defaults to false — the safe reading. A caller that does not say who is
   * collecting gets a grant that must be approved.
   */
  canApprove?: boolean;
}):
  | {
      ok: true;
      granted: number;
      skipped: number;
      pending: number;
      ruleLabels: string[];
      /** Heads refused because a discount is already on them. */
      blocked: string[];
    }
  | { ok: false; error: string } {
  if (input.applyKeys.size === 0) {
    return {
      ok: true, granted: 0, skipped: 0, pending: 0, ruleLabels: [], blocked: [],
    };
  }

  let masters = loadMasters();
  const grants = [...(masters.concessionGrants ?? [])];
  const reason = input.reason.trim() || "Counter discount at Fee Take";
  let granted = 0;
  let skipped = 0;
  let pending = 0;
  const ruleLabels: string[] = [];
  const blocked: string[] = [];

  for (const item of input.candidates) {
    if (!input.applyKeys.has(item.key)) continue;

    const head = masters.feeHeads.find((h) => h.id === item.feeHeadId);
    const ensured = ensureCounterConcessionRule(masters, {
      academicYearCode: input.academicYearCode,
      feeHeadId: item.feeHeadId,
      feeHeadCode: head?.code ?? item.feeHeadName,
      feeHeadName: item.feeHeadName,
      discountPaise: item.discountPaise,
      reason,
    });
    masters = ensured.state;
    const rule = ensured.rule;
    if (ensured.created) {
      ruleLabels.push(rule.name);
    }

    if (isStudentAlreadyGranted(item.studentId, rule, grants, masters)) {
      skipped += 1;
      continue;
    }

    // One discount per head. A second rule on the same head stacks silently —
    // an imported ₹150 off tuition and a counter ₹150 off tuition both apply
    // and the parent is charged ₹300 less than the school believes. The
    // office's rule is that the first discount must be removed before a new
    // one is given, so this refuses rather than adds, and names what is
    // already there so the clerk can go and remove it.
    const clash = activeGrantOnHead(masters, item.studentId, item.feeHeadId, grants);
    if (clash) {
      blocked.push(
        `${item.studentName} · ${item.feeHeadName} already has ${clash.rule.name}` +
          ` — remove it in Masters → Concessions before granting another`,
      );
      skipped += 1;
      continue;
    }

    // The amount can only keep it pending; it can never approve one for
    // somebody without the authority.
    const needsPrincipal =
      input.canApprove === false ||
      grantNeedsPrincipal(rule, item.discountPaise);
    const now = new Date().toISOString();
    const row: ConcessionGrant = {
      id: newId("cg"),
      concessionId: rule.id,
      studentId: item.studentId,
      status: needsPrincipal ? "pending" : "approved",
      reason:
        `Fee Take · ${reason} · from ${item.dueLabel}` +
        (input.sourceReceiptNo
          ? ` · receipt ${input.sourceReceiptNo} [v:${input.sourceVoucherId ?? ""}]`
          : ""),
      effectiveFrom: item.futureEffectiveFrom,
      effectiveTo: null,
      createdAt: now,
      siblingChildNo: null,
    };
    grants.push(row);
    if (needsPrincipal) pending += 1;
    else granted += 1;
  }

  saveMasters({ ...masters, concessionGrants: grants });

  return { ok: true, granted, skipped, pending, ruleLabels, blocked };
}

/**
 * Change a standing discount from the counter, taking effect this month.
 *
 * The office reads a discount on the head in Fee Take and wants to change it
 * there, not go hunting in Masters. What must NOT happen is a silent rewrite
 * of history: months already billed and collected at the old rate stay at the
 * old rate, or every paid receipt in the session quietly disagrees with the
 * money that was taken.
 *
 * So the old grant is ENDED the day before the new rate starts and a new one
 * begins — two grants, each true for its own months, which is also what makes
 * the change legible later. Nothing is edited in place.
 *
 * `fromDueOn` is the due date of the month the change takes effect from, which
 * the caller reads off the line the clerk is looking at.
 */
export function changeStandingDiscount(input: {
  studentId: string;
  studentName: string;
  feeHeadId: string;
  feeHeadName: string;
  newDiscountPaise: number;
  fromDueOn: string;
  academicYearCode: string;
  reason: string;
  by: string;
}):
  | { ok: true; endedGrantId: string | null; newGrantId: string | null }
  | { ok: false; error: string } {
  if (!input.fromDueOn) {
    return { ok: false, error: "No month to start the change from" };
  }
  if (input.newDiscountPaise < 0) {
    return { ok: false, error: "A discount cannot be negative" };
  }

  let masters = loadMasters();
  const grants = [...(masters.concessionGrants ?? [])];

  // Every grant still in force on or after the month we are changing from —
  // not merely the first one found.
  //
  // Taking only the first is how a second change stacked: after ₹150 was
  // changed to ₹200, the ₹150 row (already ended) still matched the search,
  // so it was "ended" a second time while the live ₹200 was left untouched.
  // Changing back to ₹150 then left ₹200 AND ₹150 both running from the same
  // month — ₹350 off a head that should have had ₹150.
  //
  // A grant already ended before this month is history and must not be
  // touched; the months it covered keep the rate they were billed at.
  const dayBefore = new Date(`${input.fromDueOn}T12:00:00`);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const endOn = dayBefore.toISOString().slice(0, 10);

  const inForce = grants
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => {
      if (g.studentId !== input.studentId) return false;
      if (g.status === "rejected") return false;
      if (g.effectiveTo != null && g.effectiveTo < input.fromDueOn) return false;
      const rule = (masters.concessions ?? []).find(
        (c) => c.id === g.concessionId,
      );
      if (!rule || !rule.isActive || rule.kind === "rte") return false;
      return (
        rule.feeHeadIds.length === 0 || rule.feeHeadIds.includes(input.feeHeadId)
      );
    });

  let endedGrantId: string | null = null;
  for (const { g, i } of inForce) {
    if (endOn < g.effectiveFrom) {
      // The change starts before this grant did: it never covered a month
      // that survives, so retire it rather than leave a backwards date.
      grants[i] = {
        ...g,
        status: "rejected",
        reason: `${g.reason} · replaced from ${input.fromDueOn} by ${input.by}`,
      };
    } else {
      grants[i] = {
        ...g,
        effectiveTo: endOn,
        reason: `${g.reason} · ended ${endOn}, replaced from ${input.fromDueOn} by ${input.by}`,
      };
    }
    endedGrantId = g.id;
  }

  // Zero means "remove the discount" — the old grant is closed and nothing
  // replaces it.
  if (input.newDiscountPaise === 0) {
    saveMasters({ ...masters, concessionGrants: grants });
    return { ok: true, endedGrantId, newGrantId: null };
  }

  const head = masters.feeHeads.find((h) => h.id === input.feeHeadId);
  const ensured = ensureCounterConcessionRule(masters, {
    academicYearCode: input.academicYearCode,
    feeHeadId: input.feeHeadId,
    feeHeadCode: head?.code ?? input.feeHeadName,
    feeHeadName: input.feeHeadName,
    discountPaise: input.newDiscountPaise,
    reason: input.reason,
  });
  masters = ensured.state;

  const row: ConcessionGrant = {
    id: newId("cg"),
    concessionId: ensured.rule.id,
    studentId: input.studentId,
    status: "approved",
    reason:
      `Fee Take · discount changed to ${formatInr(input.newDiscountPaise)} ` +
      `on ${input.feeHeadName} from ${input.fromDueOn} by ${input.by}` +
      (input.reason ? ` · ${input.reason}` : ""),
    effectiveFrom: input.fromDueOn,
    effectiveTo: null,
    createdAt: new Date().toISOString(),
    siblingChildNo: null,
  };
  grants.push(row);

  saveMasters({ ...masters, concessionGrants: grants });
  return { ok: true, endedGrantId, newGrantId: row.id };
}

/**
 * The lines a recurring discount should fill in, within the same basket.
 *
 * Ticking "include future months" on April used to change nothing on screen:
 * May sat in the same basket at full price, so the clerk discounted it by
 * hand, and that month then carried both the counter waiver and the standing
 * grant. Filling those lines in at the moment of the tick is what stops the
 * second entry being made at all.
 *
 * LATER months only, and the same head for the same child. A discount made
 * recurring from April is a statement about April onward; quietly rewriting a
 * March line in the same basket would be a different decision from the one
 * the clerk made.
 */
export function laterSameHeadDueKeys(
  dues: readonly FeeDueLine[],
  sourceDueKey: string,
): string[] {
  const source = dues.find((d) => d.dueKey === sourceDueKey);
  if (!source) return [];
  return dues
    .filter(
      (d) =>
        d.dueKey !== source.dueKey &&
        d.studentId === source.studentId &&
        d.kind === source.kind &&
        d.feeHeadId === source.feeHeadId &&
        d.dueOn > source.dueOn,
    )
    .map((d) => d.dueKey);
}
