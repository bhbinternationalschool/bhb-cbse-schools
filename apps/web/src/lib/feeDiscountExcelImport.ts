/**
 * Import fee_discount_report.xlsx → Masters concessions + approved grants.
 *
 * Discount name without "transport" → tuition head.
 * Name contains "transport" → transport head.
 */

import {
  DEFAULT_AY,
  normalizeConcessionGrant,
  normalizeConcessionRule,
  type ConcessionGrant,
  type ConcessionRule,
  type MastersState,
} from "@/lib/masters";
import { normAdmissionNo } from "@/lib/dailyCollectionReportImport";
import type { SisState, SisStudent } from "@/lib/sis";

export type FeeDiscountExcelRow = {
  admissionNo: string;
  studentName: string;
  classSection: string;
  rollNo: string;
  discountLabel: string;
  discountType: string;
  createdBy: string;
};

export type ParsedDiscountSpec = {
  label: string;
  head: "tuition" | "transport";
  mode: "percent" | "fixed";
  /** Whole percent (10 = 10%) */
  percent?: number;
  /** Rupees for flat discounts */
  rupees?: number;
  kind: string;
  /** Reuse built-in rule code (e.g. RTE) */
  existingCode?: string;
  /** Sibling grants: child ordinal on rule tiers */
  siblingChildNo?: number;
};

export type FeeDiscountImportSeed = {
  version: 1;
  importedAt: string;
  sourceFile: string;
  academicYearCode: string;
  rules: Array<{
    code: string;
    name: string;
    kind: string;
    mode: "percent" | "fixed";
    value: number;
    feeHeadCodes: string[];
    siblingTiers?: { childNo: number; mode: "percent" | "fixed"; value: number }[];
    notes?: string;
  }>;
  grants: Array<{
    admissionNo: string;
    studentName: string;
    concessionCode: string;
    discountLabel: string;
    siblingChildNo: number | null;
    reason: string;
  }>;
};

export type FeeDiscountImportResult = {
  masters: MastersState;
  seed: FeeDiscountImportSeed;
  stats: {
    rows: number;
    rulesCreated: number;
    rulesReused: number;
    grantsCreated: number;
    grantsSkipped: number;
    unmatched: string[];
  };
};

const IMPORT_CODE_PREFIX = "IMP_";

function rupeesToPaise(n: number): number {
  return Math.round(n * 100);
}

function headCode(spec: ParsedDiscountSpec): "TUITION" | "TRANSPORT" {
  return spec.head === "transport" ? "TRANSPORT" : "TUITION";
}

function ruleCodeForSpec(spec: ParsedDiscountSpec): string {
  if (spec.existingCode) return spec.existingCode;
  const head = spec.head === "transport" ? "TR" : "TUIT";
  if (spec.kind === "sibling" && spec.siblingChildNo != null) {
    return `${IMPORT_CODE_PREFIX}SIB${spec.siblingChildNo}_${spec.percent ?? 0}PCT`;
  }
  if (spec.mode === "percent") {
    return `${IMPORT_CODE_PREFIX}${head}_${spec.percent ?? 0}PCT`;
  }
  return `${IMPORT_CODE_PREFIX}${head}_FLAT_${spec.rupees ?? 0}`;
}

export function parseDiscountLabel(
  label: string,
  discountType: string,
): ParsedDiscountSpec | null {
  const t = label.trim();
  if (!t) return null;
  const type = discountType.trim().toLowerCase();

  const transport = t.match(/^transport\s+(\d+(?:\.\d+)?)$/i);
  if (transport) {
    return {
      label: t,
      head: "transport",
      mode: "fixed",
      rupees: Number(transport[1]),
      kind: "transport",
    };
  }

  if (/^rte$/i.test(t)) {
    return {
      label: t,
      head: "tuition",
      mode: "percent",
      percent: 100,
      kind: "rte_ews",
      existingCode: "RTE",
    };
  }

  const sibling = t.match(/^4\s*&\s*more\s+sibling\s*(\d+(?:\.\d+)?)\s*%$/i);
  if (sibling) {
    return {
      label: t,
      head: "tuition",
      mode: "percent",
      percent: Number(sibling[1]),
      kind: "sibling",
      siblingChildNo: 4,
    };
  }

  const pct = t.match(/^discount\s*(\d+(?:\.\d+)?)\s*%$/i);
  if (pct || type === "%" || t.includes("%")) {
    const n = pct
      ? Number(pct[1])
      : Number(t.replace(/discount/i, "").replace(/%/g, "").trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    return {
      label: t,
      head: "tuition",
      mode: "percent",
      percent: n,
      kind: "hardship",
    };
  }

  const flat = t.match(/^discount\s*(\d+(?:\.\d+)?)$/i);
  if (flat) {
    return {
      label: t,
      head: "tuition",
      mode: "fixed",
      rupees: Number(flat[1]),
      kind: "hardship",
    };
  }

  return null;
}

export function parseFeeDiscountExcelRows(
  raw: Record<string, unknown>[],
): FeeDiscountExcelRow[] {
  const out: FeeDiscountExcelRow[] = [];
  for (const row of raw) {
    const admissionNo = String(
      row["Admission Number"] ?? row["Admission No"] ?? row["Admission No."] ?? "",
    ).trim();
    if (!admissionNo) continue;
    out.push({
      admissionNo,
      studentName: String(row["Student Name"] ?? "").trim(),
      classSection: String(row["Class"] ?? "").trim(),
      rollNo: String(row["Roll No"] ?? row["Roll No."] ?? "").trim(),
      discountLabel: String(row["Discount"] ?? "").trim(),
      discountType: String(row["Discount Type"] ?? "").trim(),
      createdBy: String(row["Created By"] ?? "").trim(),
    });
  }
  return out;
}

/** Normalize BHB-008/2026 and BHB-8/2026 to the same key. */
export function canonicalAdmissionNo(raw: string): string {
  const s = normAdmissionNo(raw).replace(/\s+/g, "");
  const bhb = s.match(/^BHB-0*(\d+)\/(\d{4})$/i);
  if (bhb) return `BHB-${Number(bhb[1])}/${bhb[2]}`;
  const plain = s.match(/^0*(\d+)\/(\d{4})$/);
  if (plain) return `BHB-${Number(plain[1])}/${plain[2]}`;
  if (/^\d+$/.test(s)) return s;
  return s.toUpperCase();
}

function normStudentName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

export function findStudentByAdmission(
  sis: SisState,
  admissionNo: string,
  studentName?: string,
): SisStudent | undefined {
  const key = canonicalAdmissionNo(admissionNo);
  if (!key) return undefined;

  const exact = sis.students.find(
    (s) => canonicalAdmissionNo(s.admissionNo) === key,
  );
  if (exact) return exact;

  const tail = key.replace(/^BHB-/, "");
  const byTail = sis.students.find((s) => {
    const adm = canonicalAdmissionNo(s.admissionNo);
    return adm === key || adm.endsWith(tail) || adm.replace(/^BHB-/, "") === tail;
  });
  if (byTail) return byTail;

  const nameKey = studentName ? normStudentName(studentName) : "";
  if (!nameKey) return undefined;
  const byName = sis.students.filter(
    (s) => normStudentName(s.fullName) === nameKey,
  );
  return byName.length === 1 ? byName[0] : undefined;
}

function feeHeadIdForCode(masters: MastersState, code: string): string | null {
  return masters.feeHeads.find((h) => h.code === code)?.id ?? null;
}

function buildRuleFromSpec(
  spec: ParsedDiscountSpec,
  masters: MastersState,
  code: string,
): ConcessionRule | null {
  const tuitionId = feeHeadIdForCode(masters, "TUITION");
  const transportId = feeHeadIdForCode(masters, "TRANSPORT");
  const headId = spec.head === "transport" ? transportId : tuitionId;
  if (!headId) return null;

  const mode = spec.mode;
  const value =
    mode === "percent"
      ? Math.round(spec.percent ?? 0)
      : rupeesToPaise(spec.rupees ?? 0);

  const siblingTiers =
    spec.kind === "sibling" && spec.siblingChildNo != null
      ? [
          {
            childNo: spec.siblingChildNo,
            mode: "percent" as const,
            value: Math.round(spec.percent ?? 0),
          },
        ]
      : [];

  return normalizeConcessionRule({
    id: `cnc_${code.toLowerCase()}`,
    code,
    name: spec.label,
    kind: spec.kind,
    academicYearCode: DEFAULT_AY,
    mode,
    value,
    siblingTiers,
    feeHeadIds: [headId],
    autoApproveMaxPaise: mode === "fixed" ? value * 12 : rupeesToPaise(50000),
    documentationRequired: false,
    incompatibleCodes: [],
    notes: `Imported from fee discount report · ${spec.label}`,
    isActive: true,
  });
}

function ensureImportRule(
  masters: MastersState,
  spec: ParsedDiscountSpec,
): { masters: MastersState; rule: ConcessionRule; created: boolean } {
  const code = ruleCodeForSpec(spec);
  const existing = masters.concessions.find(
    (c) => c.code.toUpperCase() === code.toUpperCase(),
  );
  if (existing) {
    return { masters, rule: existing, created: false };
  }

  const built = buildRuleFromSpec(spec, masters, code);
  if (!built) {
    throw new Error(`Could not build concession rule for ${spec.label}`);
  }
  return {
    masters: {
      ...masters,
      concessions: [...masters.concessions, built],
    },
    rule: built,
    created: true,
  };
}

function isImportRule(rule: ConcessionRule): boolean {
  return (
    rule.code.startsWith(IMPORT_CODE_PREFIX) ||
    ["RTE"].includes(rule.code.toUpperCase())
  );
}

function headIdsForRule(rule: ConcessionRule): Set<string> {
  return new Set(rule.feeHeadIds ?? []);
}

function grantId(admissionNo: string, concessionId: string): string {
  const adm = normAdmissionNo(admissionNo).replace(/[^\w]+/g, "_");
  return `cg_imp_${adm}_${concessionId.slice(-8)}`;
}

export function applyFeeDiscountImport(input: {
  masters: MastersState;
  sis: SisState;
  rows: FeeDiscountExcelRow[];
  sourceFile: string;
  importedBy?: string;
}): FeeDiscountImportResult {
  let masters = input.masters;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const importedBy = input.importedBy ?? `Excel · ${input.sourceFile}`;

  let rulesCreated = 0;
  let rulesReused = 0;
  let grantsCreated = 0;
  let grantsSkipped = 0;
  const unmatched: string[] = [];

  const seedRules = new Map<string, FeeDiscountImportSeed["rules"][number]>();
  const seedGrants: FeeDiscountImportSeed["grants"] = [];

  const specByLabel = new Map<string, ParsedDiscountSpec>();
  for (const row of input.rows) {
    const spec = parseDiscountLabel(row.discountLabel, row.discountType);
    if (spec) specByLabel.set(row.discountLabel, spec);
  }

  const ruleByCode = new Map<string, ConcessionRule>();
  for (const spec of specByLabel.values()) {
    const ensured = ensureImportRule(masters, spec);
    masters = ensured.masters;
    if (ensured.created) rulesCreated += 1;
    else rulesReused += 1;
    ruleByCode.set(ensured.rule.code, ensured.rule);

    if (!seedRules.has(ensured.rule.code)) {
      seedRules.set(ensured.rule.code, {
        code: ensured.rule.code,
        name: ensured.rule.name,
        kind: ensured.rule.kind,
        mode: ensured.rule.mode,
        value: ensured.rule.value,
        feeHeadCodes: ensured.rule.feeHeadIds
          .map((id) => masters.feeHeads.find((h) => h.id === id)?.code ?? "")
          .filter(Boolean),
        siblingTiers: ensured.rule.siblingTiers,
        notes: ensured.rule.notes,
      });
    }
  }

  const importRuleIds = new Set(
    [...ruleByCode.values()].map((r) => r.id),
  );
  const importRuleById = new Map(
    masters.concessions
      .filter((c) => importRuleIds.has(c.id) || isImportRule(c))
      .map((c) => [c.id, c]),
  );

  let grants = [...(masters.concessionGrants ?? [])];

  for (const row of input.rows) {
    const spec = parseDiscountLabel(row.discountLabel, row.discountType);
    if (!spec) {
      unmatched.push(`${row.admissionNo}: unknown discount "${row.discountLabel}"`);
      continue;
    }

    const code = ruleCodeForSpec(spec);
    const rule = ruleByCode.get(code) ?? masters.concessions.find((c) => c.code === code);
    if (!rule) {
      unmatched.push(`${row.admissionNo}: no rule for ${row.discountLabel}`);
      continue;
    }

    seedGrants.push({
      admissionNo: normAdmissionNo(row.admissionNo),
      studentName: row.studentName,
      concessionCode: code,
      discountLabel: row.discountLabel,
      siblingChildNo:
        spec.kind === "sibling" ? (spec.siblingChildNo ?? null) : null,
      reason: `${row.discountLabel} · ${importedBy}`,
    });

    const student = findStudentByAdmission(
      input.sis,
      row.admissionNo,
      row.studentName,
    );
    if (!student) {
      unmatched.push(`${row.admissionNo} (${row.studentName})`);
      continue;
    }

    const targetHeadIds = headIdsForRule(rule);

    grants = grants.filter((g) => {
      if (g.studentId !== student.id || g.status !== "approved") return true;
      const existingRule = importRuleById.get(g.concessionId);
      if (!existingRule || !isImportRule(existingRule)) return true;
      const overlap = existingRule.feeHeadIds.some((id) => targetHeadIds.has(id));
      return !overlap;
    });

    const gid = grantId(row.admissionNo, rule.id);
    if (grants.some((g) => g.id === gid)) {
      grantsSkipped += 1;
      continue;
    }

    const grant = normalizeConcessionGrant({
      id: gid,
      concessionId: rule.id,
      studentId: student.id,
      status: "approved",
      reason: `${row.discountLabel} · ${importedBy}`,
      effectiveFrom: today,
      effectiveTo: null,
      createdAt: now,
      siblingChildNo:
        spec.kind === "sibling" ? (spec.siblingChildNo ?? null) : null,
    });
    grants.push(grant);
    grantsCreated += 1;
  }

  masters = { ...masters, concessionGrants: grants };

  const seed: FeeDiscountImportSeed = {
    version: 1,
    importedAt: now,
    sourceFile: input.sourceFile,
    academicYearCode: DEFAULT_AY,
    rules: [...seedRules.values()],
    grants: seedGrants,
  };

  return {
    masters,
    seed,
    stats: {
      rows: input.rows.length,
      rulesCreated,
      rulesReused,
      grantsCreated,
      grantsSkipped,
      unmatched: [...new Set(unmatched)],
    },
  };
}

/** Apply seed grants when SIS students are available (browser hydrate). */
export function mergeFeeDiscountSeedGrants(
  masters: MastersState,
  sis: SisState,
  seed: FeeDiscountImportSeed,
): { masters: MastersState; applied: number; pending: number } {
  if (!seed?.grants?.length) {
    return { masters, applied: 0, pending: 0 };
  }

  const ruleByCode = new Map(
    masters.concessions.map((c) => [c.code.toUpperCase(), c]),
  );
  for (const r of seed.rules) {
    if (!ruleByCode.has(r.code.toUpperCase())) {
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

      const built = normalizeConcessionRule({
        id: `cnc_${r.code.toLowerCase()}`,
        code: r.code,
        name: r.name,
        kind: r.kind,
        academicYearCode: seed.academicYearCode || DEFAULT_AY,
        mode: r.mode,
        value: r.value,
        siblingTiers: r.siblingTiers ?? [],
        feeHeadIds,
        autoApproveMaxPaise: r.mode === "fixed" ? r.value * 12 : rupeesToPaise(50000),
        documentationRequired: false,
        incompatibleCodes: [],
        notes: r.notes ?? "Imported fee discount",
        isActive: true,
      });
      masters = {
        ...masters,
        concessions: [...masters.concessions, built],
      };
      ruleByCode.set(r.code.toUpperCase(), built);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  let grants = [...(masters.concessionGrants ?? [])];
  let applied = 0;
  let pending = 0;

  for (const row of seed.grants) {
    const rule = ruleByCode.get(row.concessionCode.toUpperCase());
    if (!rule) {
      pending += 1;
      continue;
    }
    const student = findStudentByAdmission(sis, row.admissionNo, row.studentName);
    if (!student) {
      pending += 1;
      continue;
    }
    const gid = grantId(row.admissionNo, rule.id);
    if (grants.some((g) => g.id === gid)) continue;

    const targetHeadIds = headIdsForRule(rule);
    grants = grants.filter((g) => {
      if (g.studentId !== student.id || g.status !== "approved") return true;
      const existingRule = masters.concessions.find((c) => c.id === g.concessionId);
      if (!existingRule || !isImportRule(existingRule)) return true;
      const overlap = existingRule.feeHeadIds.some((id) =>
        targetHeadIds.has(id),
      );
      return !overlap;
    });

    grants.push(
      normalizeConcessionGrant({
        id: gid,
        concessionId: rule.id,
        studentId: student.id,
        status: "approved",
        reason: row.reason,
        effectiveFrom: today,
        effectiveTo: null,
        createdAt: now,
        siblingChildNo: row.siblingChildNo,
      }),
    );
    applied += 1;
  }

  return {
    masters: { ...masters, concessionGrants: grants },
    applied,
    pending,
  };
}
