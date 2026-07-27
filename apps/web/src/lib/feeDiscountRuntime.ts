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
  let concessions = [...masters.concessions];
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

/** Approved grants for a student — persisted first, then Excel seed by admission no. */
export function resolvedConcessionGrantsForStudent(
  masters: MastersState,
  student: { id: string; admissionNo: string },
  asOf: string,
): ConcessionGrant[] {
  const persisted = (masters.concessionGrants ?? []).filter(
    (g) =>
      g.studentId === student.id &&
      g.status === "approved" &&
      g.effectiveFrom <= asOf &&
      (g.effectiveTo == null || g.effectiveTo >= asOf),
  );
  if (persisted.length > 0) return persisted;

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
