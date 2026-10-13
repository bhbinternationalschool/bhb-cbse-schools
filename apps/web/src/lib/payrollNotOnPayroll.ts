/**
 * "Not on payroll" — a staff member who works here but draws no salary
 * through payroll (director, 14 Oct 2026).
 *
 * Until now the only ways to keep someone out of a salary run were removing
 * their line from every draft by hand, or making them inactive in Masters →
 * Staff — which also takes them off attendance, the staff app and RBAC. The
 * July 2026 draft carried six such people (the owner, trustees, honorary
 * staff) as ₹1 lines: a ₹1 basic override on their salary setup was the only
 * way to say "no salary" at all.
 *
 * The switch lives on the staff member's salary setup link
 * (salary_setup_state.staffLinks) and is read by payroll alone: drafts skip
 * them, the process result lists them as left out, an open draft offers to
 * remove them. Nothing else keys off it — they stay active staff everywhere
 * else. Posted and paid runs are never touched.
 *
 * Pure: no storage, no React.
 */

import type { StaffSalaryLink } from "@/lib/salarySetup";

export const NOT_ON_PAYROLL_PRESETS = [
  "Owner / trustee",
  "Unpaid / honorary",
  "Paid outside payroll",
] as const;

const REASON_MAX = 120;

/** The switch's fields on a link — all optional, so old blobs read unchanged. */
export type NotOnPayrollFields = {
  /** true = payroll leaves this person out of every new run. */
  notOnPayroll?: boolean;
  notOnPayrollReason?: string;
  /** Who last flipped the switch, and when (ISO) — kept when switched back. */
  notOnPayrollSetBy?: string;
  notOnPayrollSetAt?: string;
  /**
   * The link exists only to carry this switch: no structure, override or PF
   * decision was ever made for this person. Switching back on payroll drops
   * such a link, so they return to "no salary setup", exactly as before.
   */
  notOnPayrollOnly?: boolean;
};

type LinkLike = (NotOnPayrollFields & { staffId: string }) | null | undefined;

export function isOnPayroll(link: LinkLike): boolean {
  return link?.notOnPayroll !== true;
}

/** Normalise the switch's fields — only those set, so the blob stays small. */
export function normalizeNotOnPayroll(l: Partial<NotOnPayrollFields> | null | undefined): NotOnPayrollFields {
  const out: NotOnPayrollFields = {};
  if (!l) return out;
  if (l.notOnPayroll === true) {
    out.notOnPayroll = true;
    const reason = String(l.notOnPayrollReason || "").trim().slice(0, REASON_MAX);
    if (reason) out.notOnPayrollReason = reason;
    if (l.notOnPayrollOnly === true) out.notOnPayrollOnly = true;
  }
  const by = String(l.notOnPayrollSetBy || "").trim();
  const at = String(l.notOnPayrollSetAt || "").trim();
  if (by) out.notOnPayrollSetBy = by;
  if (at) out.notOnPayrollSetAt = at;
  return out;
}

/**
 * The switch's fields to keep when a link is rebuilt for another reason
 * (Assign, increment). The rebuilt link carries a real assignment, so it is
 * no longer a switch-only link.
 */
export function carryNotOnPayroll(existing: Partial<NotOnPayrollFields> | null | undefined): NotOnPayrollFields {
  const kept = normalizeNotOnPayroll(existing);
  delete kept.notOnPayrollOnly;
  return kept;
}

/** True when the link records a real salary assignment (not only the switch). */
export function hasSalaryAssignment(link: (NotOnPayrollFields & { structureId?: string }) | null | undefined): boolean {
  return !!link && link.notOnPayrollOnly !== true;
}

export function notOnPayrollLabel(link: LinkLike): string {
  const reason = link?.notOnPayrollReason?.trim();
  return reason ? `Not on payroll — ${reason}` : "Not on payroll";
}

/** A link carrying only the switch: no structure, no override, no PF/ESI. */
export function minimalNotOnPayrollLink(staffId: string): StaffSalaryLink {
  return {
    staffId,
    structureId: "",
    basicOverride: 0,
    statutoryCover: "none",
    additionalAmount: 0,
    additionalLabel: "",
    statutoryGrossUp: false,
    effectiveFrom: "",
    salaryAccountNote: "",
    notOnPayrollOnly: true,
  };
}

/**
 * Flip the switch for one staff member. Staff with no link get a switch-only
 * link; switching such a link back on payroll removes it again.
 */
export function setNotOnPayroll(
  links: StaffSalaryLink[],
  staffId: string,
  change: { on: boolean; reason?: string; by: string; at: string },
): { links: StaffSalaryLink[]; before: NotOnPayrollFields; after: NotOnPayrollFields | null } {
  const existing = links.find((l) => l.staffId === staffId);
  const before = normalizeNotOnPayroll(existing);
  const others = links.filter((l) => l.staffId !== staffId);
  if (!change.on) {
    if (!existing) return { links, before, after: null };
    if (existing.notOnPayrollOnly) return { links: others, before, after: null };
    const next: StaffSalaryLink = {
      ...stripNotOnPayroll(existing),
      notOnPayrollSetBy: change.by,
      notOnPayrollSetAt: change.at,
    };
    return { links: [...others, next], before, after: normalizeNotOnPayroll(next) };
  }
  const base = existing ?? minimalNotOnPayrollLink(staffId);
  const next: StaffSalaryLink = {
    ...stripNotOnPayroll(base),
    ...normalizeNotOnPayroll({
      notOnPayroll: true,
      notOnPayrollReason: change.reason,
      notOnPayrollSetBy: change.by,
      notOnPayrollSetAt: change.at,
      notOnPayrollOnly: base.notOnPayrollOnly === true,
    }),
  };
  return { links: [...others, next], before, after: normalizeNotOnPayroll(next) };
}

function stripNotOnPayroll(l: StaffSalaryLink): StaffSalaryLink {
  const out = { ...l };
  delete out.notOnPayroll;
  delete out.notOnPayrollReason;
  delete out.notOnPayrollSetBy;
  delete out.notOnPayrollSetAt;
  delete out.notOnPayrollOnly;
  return out;
}

/**
 * Clear a staff member's salary assignment ("Auto (by stream)", or their
 * structure removed). A not-on-payroll person keeps the switch on a
 * switch-only link; anyone else's link goes, as before.
 */
export function clearSalaryAssignment(links: StaffSalaryLink[], test: (l: StaffSalaryLink) => boolean): StaffSalaryLink[] {
  return links.flatMap((l) => {
    if (!test(l)) return [l];
    if (!l.notOnPayroll) return [];
    return [{ ...minimalNotOnPayrollLink(l.staffId), ...normalizeNotOnPayroll(l), notOnPayrollOnly: true }];
  });
}

export type NotOnPayrollEntry = {
  staffId: string;
  fullName: string;
  empCode: string;
  reason: string;
};

type StaffLike = { id: string; fullName: string; empCode: string };

/** Split due staff into those payroll builds and those left out by the switch. */
export function partitionDueStaff<T extends StaffLike>(
  staff: T[],
  links: LinkLike[],
): { onPayroll: T[]; leftOut: NotOnPayrollEntry[] } {
  const byId = new Map(links.filter(Boolean).map((l) => [l!.staffId, l]));
  const onPayroll: T[] = [];
  const leftOut: NotOnPayrollEntry[] = [];
  for (const s of staff) {
    const link = byId.get(s.id);
    if (isOnPayroll(link)) onPayroll.push(s);
    else
      leftOut.push({
        staffId: s.id,
        fullName: s.fullName,
        empCode: s.empCode,
        reason: link?.notOnPayrollReason?.trim() || "",
      });
  }
  return { onPayroll, leftOut };
}

/** Lines of a draft whose staff are now marked not on payroll. */
export function notOnPayrollLines(
  lines: { staffId: string; fullName: string; empCode: string }[],
  links: LinkLike[],
): NotOnPayrollEntry[] {
  return partitionDueStaff(
    lines.map((l) => ({ id: l.staffId, fullName: l.fullName, empCode: l.empCode })),
    links,
  ).leftOut;
}
