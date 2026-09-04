/**
 * Runtime fee-discount resolution — shows concessions in Fee Take even before
 * grants are persisted to masters.concessionGrants.
 */

import feeDiscountSeedJson from "@/lib/data/fee_discount_import_seed.json";
import {
  canonicalAdmissionNo,
  type FeeDiscountImportSeed,
} from "@/lib/feeDiscountExcelImport";
import {
  listConcessionPolicies,
  normalizeConcessionGrant,
  normalizeConcessionRule,
  type ConcessionGrant,
  type MastersState,
} from "@/lib/masters";

const bundledSeed = feeDiscountSeedJson as FeeDiscountImportSeed;

const seedByAdmission = new Map(
  bundledSeed.grants.map((g) => [canonicalAdmissionNo(g.admissionNo), g]),
);

function feeHeadIdForCode(masters: MastersState, code: string): string | null {
  return masters.feeHeads.find((h) => h.code === code)?.id ?? null;
}

function grantId(admissionNo: string, concessionId: string): string {
  const adm = canonicalAdmissionNo(admissionNo).replace(/[^\w]+/g, "_");
  return `cg_imp_${adm}_${concessionId.slice(-8)}`;
}

/** Ensure import concession rules from the Excel seed exist on masters. */
export function mergeDiscountRulesFromSeed(masters: MastersState): MastersState {
  const ruleByCode = new Map(
    masters.concessions.map((c) => [c.code.toUpperCase(), c]),
  );
  const concessions = [...masters.concessions];
  let changed = false;

  for (const r of bundledSeed.rules) {
    if (ruleByCode.has(r.code.toUpperCase())) continue;
    const tuitionId = feeHeadIdForCode(masters, "TUITION");
    const transportId = feeHeadIdForCode(masters, "TRANSPORT");
    const headIds = r.feeHeadCodes
      .map((code) => feeHeadIdForCode(masters, code))
      .filter((id): id is string => !!id);
    const feeHeadIds =
      headIds.length > 0
        ? headIds
        : r.feeHeadCodes.includes("TRANSPORT") && transportId
          ? [transportId]
          : tuitionId
            ? [tuitionId]
            : [];

    if (!feeHeadIds.length) continue;

    const built = normalizeConcessionRule({
      id: `cnc_${r.code.toLowerCase()}`,
      code: r.code,
      name: r.name,
      kind: r.kind,
      academicYearCode: bundledSeed.academicYearCode,
      mode: r.mode,
      value: r.value,
      siblingTiers: r.siblingTiers ?? [],
      feeHeadIds,
      autoApproveMaxPaise:
        r.mode === "fixed" ? r.value * 12 : Math.round(50000 * 100),
      documentationRequired: false,
      incompatibleCodes: [],
      notes: r.notes ?? "Imported fee discount",
      isActive: true,
    });
    concessions.push(built);
    ruleByCode.set(r.code.toUpperCase(), built);
    changed = true;
  }

  return changed ? { ...masters, concessions } : masters;
}

/**
 * Approved grants for a student — persisted first, then Excel seed by
 * admission no.
 *
 * `aliasStudentIds` are the SAME child's row ids from other sessions: a
 * student gets a new row id every session, so a grant given last year points
 * at last year's id and would silently stop applying after promotion. The
 * aliases keep the concession with the child, not the row. When the same
 * rule is granted on more than one of the child's rows, the current row's
 * grant wins — a concession never stacks with itself.
 */
export function resolvedConcessionGrantsForStudent(
  masters: MastersState,
  student: { id: string; admissionNo: string },
  asOf: string,
  aliasStudentIds: string[] = [],
): ConcessionGrant[] {
  const ids = new Set([student.id, ...aliasStudentIds]);
  const matched = (masters.concessionGrants ?? []).filter(
    (g) =>
      ids.has(g.studentId) &&
      g.status === "approved" &&
      g.effectiveFrom <= asOf &&
      (g.effectiveTo == null || g.effectiveTo >= asOf),
  );
  if (matched.length > 0) {
    const byRule = new Map<string, ConcessionGrant>();
    for (const g of matched) {
      const prev = byRule.get(g.concessionId);
      if (!prev || (g.studentId === student.id && prev.studentId !== student.id)) {
        byRule.set(g.concessionId, g);
      }
    }
    return [...byRule.values()];
  }
  const seedRow = seedByAdmission.get(
    canonicalAdmissionNo(student.admissionNo),
  );
  if (!seedRow) return [];

  const rule =
    listConcessionPolicies(masters).find(
      (c) => c.code.toUpperCase() === seedRow.concessionCode.toUpperCase(),
    ) ??
    masters.concessions.find(
      (c) => c.code.toUpperCase() === seedRow.concessionCode.toUpperCase(),
    );
  if (!rule || !rule.isActive) return [];

  const today = asOf || new Date().toISOString().slice(0, 10);
  return [
    normalizeConcessionGrant({
      id: grantId(student.admissionNo, rule.id),
      concessionId: rule.id,
      studentId: student.id,
      status: "approved",
      reason: seedRow.reason,
      effectiveFrom: today,
      effectiveTo: null,
      createdAt: bundledSeed.importedAt,
      siblingChildNo: seedRow.siblingChildNo,
    }),
  ];
}

export function bundledFeeDiscountSeed(): FeeDiscountImportSeed {
  return bundledSeed;
}
