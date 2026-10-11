/**
 * Concession templates — named, reusable discounts ("Staff ward 50% tuition",
 * "Sibling 2nd child ₹500/month") applied to one or many children at once.
 *
 * A template is a server row (fee_concession_templates). It is NOT a second
 * concession engine: applying it creates ordinary Masters concession grants,
 * under one ordinary Masters concession rule that the template owns (code
 * TPL-…), so the fee counter, receipts and dues price them exactly like any
 * other grant. The rule is minted on first use and kept in step with the
 * template's rate.
 *
 * What the existing grant flow requires, this keeps:
 *  - Ground recorded on every grant (the template carries it; required).
 *  - Grant vs approve authority: concessionGrantStatus(canApprove,
 *    amountAllowsAuto) — an assigned user's grant is pending however small;
 *    the template's auto-approve ceiling can only keep a grant pending.
 *  - Counter-style session end: a template set to end with the session gets
 *    effectiveTo = 31 March; if the session's end cannot be read the apply is
 *    refused rather than left open-ended.
 *  - A child who already holds a live grant under this template is skipped,
 *    never granted twice.
 *
 * Pure: no IO. The route reads Masters, calls this, and writes the result
 * through the all-or-none Masters section save.
 */

import type {
  ConcessionGrant,
  ConcessionGround,
  ConcessionRule,
  ConcessionValueMode,
} from "@/lib/masters";
import { concessionGrantStatus } from "@/lib/rbac";

export const TEMPLATE_GROUNDS: ConcessionGround[] = [
  "sibling",
  "staff_ward",
  "hardship",
  "merit",
  "rte_ews",
  "director",
  "correction",
  "other",
];

/** Kinds Masters knows that a ground maps to directly. */
const KIND_FOR_GROUND: Partial<Record<ConcessionGround, string>> = {
  sibling: "sibling",
  staff_ward: "staff_ward",
  hardship: "hardship",
  merit: "merit",
  rte_ews: "rte_ews",
};

export type ConcessionTemplate = {
  id: string;
  name: string;
  ground: ConcessionGround;
  mode: ConcessionValueMode;
  /** percent → whole percent; fixed → paise per billed due. */
  value: number;
  /** Empty = every fee head. */
  feeHeadIds: string[];
  /** Sibling templates: which child this is for (2 = 2nd child). */
  siblingChildNo: number | null;
  /** "session_end" → grants end 31 March of the session; "open" → no end. */
  endPolicy: "session_end" | "open";
  /** Grants estimated at or under this per due may be approved at once (by an approver). null = always pending. */
  autoApproveMaxPaise: number | null;
  defaultReason: string;
  isActive: boolean;
  /** The Masters rule code this template owns. */
  ruleCode: string;
};

export type TemplateInput = Omit<ConcessionTemplate, "id" | "ruleCode" | "isActive"> & {
  isActive?: boolean;
};

export function templateRuleCode(templateId: string): string {
  const tail = templateId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase();
  return `TPL-${tail}`;
}

export function templateInputProblem(t: TemplateInput, knownHeadIds: Set<string>): string | null {
  if (!t.name.trim()) return "Give the template a name";
  if (t.name.trim().length > 80) return "Keep the name under 80 characters";
  if (!TEMPLATE_GROUNDS.includes(t.ground)) return "Choose the ground (why families qualify)";
  if (t.mode !== "percent" && t.mode !== "fixed") return "Choose percent or a fixed amount";
  const v = Number(t.value);
  if (!Number.isFinite(v) || v <= 0) return "Enter the discount";
  if (t.mode === "percent" && (v > 100 || Math.floor(v) !== v)) return "A percent must be a whole number from 1 to 100";
  if (t.mode === "fixed" && Math.floor(v) !== v) return "Amount must be in whole paise";
  for (const h of t.feeHeadIds) {
    if (!knownHeadIds.has(h)) return "One of the fee heads no longer exists — pick again";
  }
  if (t.siblingChildNo != null) {
    if (t.ground !== "sibling") return "A child number only applies to a sibling template";
    if (!Number.isInteger(t.siblingChildNo) || t.siblingChildNo < 2 || t.siblingChildNo > 9) {
      return "Sibling child number must be 2 or more";
    }
  }
  if (t.endPolicy !== "session_end" && t.endPolicy !== "open") return "Choose when the discount ends";
  if (t.autoApproveMaxPaise != null && (!Number.isFinite(t.autoApproveMaxPaise) || t.autoApproveMaxPaise < 0)) {
    return "Auto-approve limit must be zero or more";
  }
  return null;
}

/**
 * The Masters concession rule a template stands for. `existingId` keeps the
 * rule's id when it already exists (grants point at it).
 */
export function templateToRule(t: ConcessionTemplate, ruleId: string): ConcessionRule {
  const sibling = t.ground === "sibling" && t.siblingChildNo != null;
  return {
    id: ruleId,
    code: t.ruleCode,
    name: t.name.trim(),
    kind: sibling ? "sibling" : (KIND_FOR_GROUND[t.ground] ?? "other"),
    academicYearCode: "*",
    mode: t.mode,
    value: t.value,
    siblingTiers: sibling ? [{ childNo: t.siblingChildNo as number, mode: t.mode, value: t.value }] : [],
    feeHeadIds: [...t.feeHeadIds],
    autoApproveMaxPaise: t.autoApproveMaxPaise,
    documentationRequired: false,
    incompatibleCodes: [],
    notes: `From concession template "${t.name.trim()}" (Fees → Bulk & PDC → Templates)`,
    isActive: true,
  };
}

/** Does the stored rule still say what the template says? */
export function ruleMatchesTemplate(rule: ConcessionRule, t: ConcessionTemplate): boolean {
  const want = templateToRule(t, rule.id);
  return (
    rule.isActive &&
    rule.name === want.name &&
    rule.kind === want.kind &&
    rule.mode === want.mode &&
    rule.value === want.value &&
    rule.autoApproveMaxPaise === want.autoApproveMaxPaise &&
    JSON.stringify([...rule.feeHeadIds].sort()) === JSON.stringify([...want.feeHeadIds].sort()) &&
    JSON.stringify(rule.siblingTiers) === JSON.stringify(want.siblingTiers)
  );
}

/**
 * Estimated discount per billed due for one child, from what that child is
 * billed on each head the template covers (`billedByHead`: headId → paise of
 * one due). Capped at the bill, as concessionForHead caps.
 */
export function estimateTemplatePaise(
  t: Pick<ConcessionTemplate, "mode" | "value" | "feeHeadIds">,
  billedByHead: Record<string, number>,
): number {
  let total = 0;
  for (const [head, billed] of Object.entries(billedByHead)) {
    if (t.feeHeadIds.length > 0 && !t.feeHeadIds.includes(head)) continue;
    const b = Math.max(0, Math.round(billed));
    const amt = t.mode === "percent" ? Math.round((b * t.value) / 100) : t.value;
    total += Math.min(amt, b);
  }
  return total;
}

export type TemplatePlanStudent = {
  studentId: string;
  studentName: string;
  billedByHead: Record<string, number>;
};

export type TemplatePlanRow = {
  studentId: string;
  studentName: string;
  action: "grant" | "skip";
  why: string;
  estPaise: number;
  status: "approved" | "pending" | null;
};

export type TemplatePlan =
  | { ok: true; rows: TemplatePlanRow[]; grants: ConcessionGrant[] }
  | { ok: false; error: string };

/** Grants live on or after `onDate` (not rejected, not ended before it). */
function liveOn(g: ConcessionGrant, onDate: string): boolean {
  if (g.status === "rejected") return false;
  return !g.effectiveTo || g.effectiveTo >= onDate;
}

export function planTemplateApplication(input: {
  template: ConcessionTemplate;
  students: TemplatePlanStudent[];
  /** Ids of every Masters rule carrying the template's code. */
  ruleIds: Set<string>;
  /** The rule id new grants point at. */
  ruleId: string;
  existingGrants: ConcessionGrant[];
  canGrant: boolean;
  canApprove: boolean;
  /** YYYY-MM — the first month the discount applies to. */
  fromMonth: string;
  /** 31 March of the session, or null if it could not be read. */
  sessionEndOn: string | null;
  reason: string;
  nowIso: string;
  newId: () => string;
}): TemplatePlan {
  const t = input.template;
  if (!input.canGrant) return { ok: false, error: "You do not have permission to record concessions" };
  if (!t.isActive) return { ok: false, error: "This template is switched off" };
  if (!/^\d{4}-\d{2}$/.test(input.fromMonth)) return { ok: false, error: "Choose the month the discount starts" };
  if (input.students.length === 0) return { ok: false, error: "Choose at least one student" };
  if (input.students.length > 200) return { ok: false, error: "At most 200 students at a time" };
  const effectiveFrom = `${input.fromMonth}-01`;
  let effectiveTo: string | null = null;
  if (t.endPolicy === "session_end") {
    if (!input.sessionEndOn) {
      return { ok: false, error: "Could not read when this session ends — nothing was granted. Check the session in the header." };
    }
    if (input.sessionEndOn < effectiveFrom) {
      return { ok: false, error: "The start month is after this session ends" };
    }
    effectiveTo = input.sessionEndOn;
  }

  const reason = input.reason.trim() || t.defaultReason.trim() || t.name.trim();
  const rows: TemplatePlanRow[] = [];
  const grants: ConcessionGrant[] = [];
  const seen = new Set<string>();
  for (const s of input.students) {
    if (seen.has(s.studentId)) continue;
    seen.add(s.studentId);
    const already = input.existingGrants.some(
      (g) => g.studentId === s.studentId && input.ruleIds.has(g.concessionId) && liveOn(g, effectiveFrom),
    );
    const est = estimateTemplatePaise(t, s.billedByHead);
    if (already) {
      rows.push({ studentId: s.studentId, studentName: s.studentName, action: "skip", why: "Already has this template's discount", estPaise: est, status: null });
      continue;
    }
    if (est <= 0) {
      rows.push({ studentId: s.studentId, studentName: s.studentName, action: "skip", why: "Not billed on the heads this template covers", estPaise: 0, status: null });
      continue;
    }
    const amountAllowsAuto = t.autoApproveMaxPaise != null && est <= t.autoApproveMaxPaise;
    const status = concessionGrantStatus(input.canApprove, amountAllowsAuto);
    rows.push({
      studentId: s.studentId,
      studentName: s.studentName,
      action: "grant",
      why: status === "approved" ? "Granted and approved" : input.canApprove ? "Granted — waiting for approval (above the auto limit)" : "Sent for approval",
      estPaise: est,
      status,
    });
    grants.push({
      id: input.newId(),
      concessionId: input.ruleId,
      studentId: s.studentId,
      status,
      ground: t.ground,
      reason,
      effectiveFrom,
      effectiveTo,
      createdAt: input.nowIso,
      siblingChildNo: t.ground === "sibling" ? t.siblingChildNo : null,
    });
  }
  return { ok: true, rows, grants };
}
