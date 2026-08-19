/**
 * Salary increment policy — annual / anniversary cycles,
 * % or fixed on basic, stream-wise defaults, draft → approve → apply
 * (updates staff basicOverride so % heads recompute from new basic).
 */

import type { StaffStream } from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";
import {
  computeStructureAmounts,
  loadSalarySetup,
  resolveStructureForStaff,
  saveSalarySetup,
  type SalarySetupState,
  type StaffSalaryLink,
} from "@/lib/salarySetup";

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
export type IncrementCycle = "april" | "anniversary" | "hold_month";
export type IncrementMode = "percent" | "fixed";

export type IncrementPolicy = {
  enabled: boolean;
  cycle: IncrementCycle;
  /** Used when cycle = hold_month (1–12); often same as June hold */
  cycleMonth: number;
  defaultMode: IncrementMode;
  defaultPercent: number;
  defaultFixed: number;
  /** Min completed months of service before eligible */
  minServiceMonths: number;
  teachingPercent: number;
  nonTeachingPercent: number;
  teachingFixed: number;
  nonTeachingFixed: number;
  requireApproval: boolean;
  note: string;
};

export type IncrementLineStatus = "included" | "excluded" | "skipped";

export type IncrementLine = {
  staffId: string;
  empCode: string;
  fullName: string;
  stream: StaffStream;
  joiningDate: string;
  structureId: string;
  structureName: string;
  oldBasic: number;
  mode: IncrementMode;
  value: number;
  newBasic: number;
  status: IncrementLineStatus;
  skipReason: string;
};

export type IncrementBatchStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "applied";

export type IncrementBatchKind = "batch" | "individual";

export type IncrementBatch = {
  id: string;
  kind: IncrementBatchKind;
  label: string;
  academicYearCode: string;
  /** YYYY-MM-DD from which new basic applies */
  effectiveFrom: string;
  status: IncrementBatchStatus;
  lines: IncrementLine[];
  createdBy: string;
  createdAt: string;
  submittedBy: string;
  submittedAt: string;
  approvedBy: string;
  approvedAt: string;
  appliedBy: string;
  appliedAt: string;
  note: string;
};

export type IncrementState = {
  version: 1;
  policy: IncrementPolicy;
  batches: IncrementBatch[];
};

const STORAGE_KEY = "bhb_salary_increment_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultIncrementPolicy(): IncrementPolicy {
  return {
    enabled: true,
    cycle: "april",
    cycleMonth: 4,
    defaultMode: "percent",
    defaultPercent: 5,
    defaultFixed: 1000,
    minServiceMonths: 6,
    teachingPercent: 5,
    nonTeachingPercent: 4,
    teachingFixed: 1000,
    nonTeachingFixed: 500,
    requireApproval: true,
    note: "Annual increment on basic; allowances % of basic follow automatically",
  };
}

export function normalizeIncrementPolicy(
  p?: Partial<IncrementPolicy> | null,
): IncrementPolicy {
  const d = defaultIncrementPolicy();
  const cycle: IncrementCycle =
    p?.cycle === "anniversary" || p?.cycle === "hold_month"
      ? p.cycle
      : "april";
  const mode: IncrementMode = p?.defaultMode === "fixed" ? "fixed" : "percent";
  const cycleMonth = Number(p?.cycleMonth);
  const clamp = (n: number, fallback: number, min = 0, max = 100) =>
    Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  return {
    enabled: p?.enabled !== false,
    cycle,
    cycleMonth:
      Number.isFinite(cycleMonth) && cycleMonth >= 1 && cycleMonth <= 12
        ? Math.round(cycleMonth)
        : d.cycleMonth,
    defaultMode: mode,
    defaultPercent: clamp(Number(p?.defaultPercent), d.defaultPercent, 0, 50),
    defaultFixed: Math.max(0, Number(p?.defaultFixed) || d.defaultFixed),
    minServiceMonths: Math.max(
      0,
      Math.min(60, Math.round(Number(p?.minServiceMonths) || d.minServiceMonths)),
    ),
    teachingPercent: clamp(Number(p?.teachingPercent), d.teachingPercent, 0, 50),
    nonTeachingPercent: clamp(
      Number(p?.nonTeachingPercent),
      d.nonTeachingPercent,
      0,
      50,
    ),
    teachingFixed: Math.max(0, Number(p?.teachingFixed) || d.teachingFixed),
    nonTeachingFixed: Math.max(
      0,
      Number(p?.nonTeachingFixed) || d.nonTeachingFixed,
    ),
    requireApproval: p?.requireApproval !== false,
    note: String(p?.note ?? d.note),
  };
}

export function loadIncrementState(): IncrementState {
  if (typeof window === "undefined") {
    return { version: 1, policy: defaultIncrementPolicy(), batches: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed: IncrementState = {
        version: 1,
        policy: defaultIncrementPolicy(),
        batches: [],
      };
      writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as Partial<IncrementState>;
    return {
      version: 1,
      policy: normalizeIncrementPolicy(parsed.policy),
      batches: Array.isArray(parsed.batches)
        ? parsed.batches.map(normalizeBatch)
        : [],
    };
  } catch {
    return { version: 1, policy: defaultIncrementPolicy(), batches: [] };
  }
}

function normalizeBatch(b: Partial<IncrementBatch>): IncrementBatch {
  return {
    id: String(b.id || nid("inc")),
    kind: b.kind === "individual" ? "individual" : "batch",
    label: String(b.label || "Increment"),
    academicYearCode: String(b.academicYearCode || ""),
    effectiveFrom: String(b.effectiveFrom || "").slice(0, 10),
    status:
      b.status === "pending_approval" ||
      b.status === "approved" ||
      b.status === "applied"
        ? b.status
        : "draft",
    lines: Array.isArray(b.lines) ? b.lines : [],
    createdBy: String(b.createdBy || ""),
    createdAt: String(b.createdAt || ""),
    submittedBy: String(b.submittedBy || ""),
    submittedAt: String(b.submittedAt || ""),
    approvedBy: String(b.approvedBy || ""),
    approvedAt: String(b.approvedAt || ""),
    appliedBy: String(b.appliedBy || ""),
    appliedAt: String(b.appliedAt || ""),
    note: String(b.note || ""),
  };
}

export function saveIncrementState(state: IncrementState) {
  if (!assertModulePermission("payroll", "edit", "saveIncrementState")) return;
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("salary_increment", state));
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeIncrementStateLocalRaw(state: IncrementState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
}

export function monthsOfService(joiningDate: string, asOf: string): number {
  const j = joiningDate?.slice(0, 10);
  const a = asOf?.slice(0, 10);
  if (!j || !a || a < j) return 0;
  const jd = new Date(`${j}T12:00:00`);
  const ad = new Date(`${a}T12:00:00`);
  if (Number.isNaN(jd.getTime()) || Number.isNaN(ad.getTime())) return 0;
  let months =
    (ad.getFullYear() - jd.getFullYear()) * 12 +
    (ad.getMonth() - jd.getMonth());
  if (ad.getDate() < jd.getDate()) months -= 1;
  return Math.max(0, months);
}

export function defaultEffectiveFrom(
  policy: IncrementPolicy,
  ref = new Date(),
): string {
  const p = normalizeIncrementPolicy(policy);
  const y = ref.getFullYear();
  if (p.cycle === "april") {
    return `${y}-04-01`;
  }
  if (p.cycle === "hold_month") {
    return `${y}-${String(p.cycleMonth).padStart(2, "0")}-01`;
  }
  // anniversary — batch effective date is “today” or start of month; per-staff
  // anniversary handled at build time via joining month
  return ref.toISOString().slice(0, 10);
}

function streamDefaults(
  policy: IncrementPolicy,
  stream: StaffStream,
): { mode: IncrementMode; value: number } {
  const p = normalizeIncrementPolicy(policy);
  if (p.defaultMode === "fixed") {
    return {
      mode: "fixed",
      value:
        stream === "teaching" ? p.teachingFixed : p.nonTeachingFixed,
    };
  }
  return {
    mode: "percent",
    value:
      stream === "teaching" ? p.teachingPercent : p.nonTeachingPercent,
  };
}

export function computeNewBasic(
  oldBasic: number,
  mode: IncrementMode,
  value: number,
): number {
  if (oldBasic <= 0) return 0;
  if (mode === "fixed") return Math.round(oldBasic + Math.max(0, value));
  return Math.round(oldBasic * (1 + Math.max(0, value) / 100));
}

export function buildIncrementDraft(input: {
  masters: MastersState;
  salary?: SalarySetupState;
  policy?: IncrementPolicy;
  academicYearCode: string;
  effectiveFrom: string;
  createdBy: string;
  label?: string;
  /** Only include staff whose joining month matches (anniversary cycle) */
  anniversaryOnly?: boolean;
}): IncrementBatch {
  const salary = input.salary || loadSalarySetup();
  const policy = normalizeIncrementPolicy(
    input.policy ?? loadIncrementState().policy,
  );
  const effectiveFrom = input.effectiveFrom.slice(0, 10);
  const anniversaryOnly =
    input.anniversaryOnly ?? policy.cycle === "anniversary";
  const effMonth = Number(effectiveFrom.slice(5, 7));

  const roster = (input.masters.staff ?? []).filter(
    (s) => s.status === "active",
  );
  const lines: IncrementLine[] = [];

  for (const staff of roster) {
    const structure = resolveStructureForStaff(salary, staff);
    if (!structure) {
      lines.push({
        staffId: staff.id,
        empCode: staff.empCode,
        fullName: staff.fullName,
        stream: staff.stream,
        joiningDate: staff.joiningDate,
        structureId: "",
        structureName: "",
        oldBasic: 0,
        mode: "percent",
        value: 0,
        newBasic: 0,
        status: "skipped",
        skipReason: "No salary structure",
      });
      continue;
    }

    const link = salary.staffLinks.find((l) => l.staffId === staff.id);
    const amounts = computeStructureAmounts(
      salary,
      structure,
      link?.basicOverride || 0,
      link?.statutoryCover || "both",
      input.masters.statutoryConfig,
    );
    const oldBasic = amounts.basic;
    const service = monthsOfService(staff.joiningDate, effectiveFrom);
    const defaults = streamDefaults(policy, staff.stream);

    if (anniversaryOnly) {
      const joinMonth = Number((staff.joiningDate || "").slice(5, 7));
      if (!joinMonth || joinMonth !== effMonth) {
        lines.push({
          staffId: staff.id,
          empCode: staff.empCode,
          fullName: staff.fullName,
          stream: staff.stream,
          joiningDate: staff.joiningDate,
          structureId: structure.id,
          structureName: structure.name,
          oldBasic,
          mode: defaults.mode,
          value: defaults.value,
          newBasic: oldBasic,
          status: "skipped",
          skipReason: "Not anniversary month",
        });
        continue;
      }
    }

    if (service < policy.minServiceMonths) {
      lines.push({
        staffId: staff.id,
        empCode: staff.empCode,
        fullName: staff.fullName,
        stream: staff.stream,
        joiningDate: staff.joiningDate,
        structureId: structure.id,
        structureName: structure.name,
        oldBasic,
        mode: defaults.mode,
        value: defaults.value,
        newBasic: oldBasic,
        status: "skipped",
        skipReason: `Service ${service} mo < ${policy.minServiceMonths} mo`,
      });
      continue;
    }

    if (oldBasic <= 0) {
      lines.push({
        staffId: staff.id,
        empCode: staff.empCode,
        fullName: staff.fullName,
        stream: staff.stream,
        joiningDate: staff.joiningDate,
        structureId: structure.id,
        structureName: structure.name,
        oldBasic: 0,
        mode: defaults.mode,
        value: defaults.value,
        newBasic: 0,
        status: "skipped",
        skipReason: "Basic is zero",
      });
      continue;
    }

    const newBasic = computeNewBasic(oldBasic, defaults.mode, defaults.value);
    lines.push({
      staffId: staff.id,
      empCode: staff.empCode,
      fullName: staff.fullName,
      stream: staff.stream,
      joiningDate: staff.joiningDate,
      structureId: structure.id,
      structureName: structure.name,
      oldBasic,
      mode: defaults.mode,
      value: defaults.value,
      newBasic,
      status: "included",
      skipReason: "",
    });
  }

  lines.sort((a, b) => a.empCode.localeCompare(b.empCode));

  return {
    id: nid("inc"),
    kind: "batch",
    label:
      input.label?.trim() ||
      `Increment ${effectiveFrom.slice(0, 7)}`,
    academicYearCode: input.academicYearCode,
    effectiveFrom,
    status: "draft",
    lines,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    submittedBy: "",
    submittedAt: "",
    approvedBy: "",
    approvedAt: "",
    appliedBy: "",
    appliedAt: "",
    note: policy.note,
  };
}

export type StaffIncrementPreview = {
  staffId: string;
  empCode: string;
  fullName: string;
  stream: StaffStream;
  joiningDate: string;
  structureId: string;
  structureName: string;
  oldBasic: number;
  mode: IncrementMode;
  value: number;
  newBasic: number;
  error: string;
};

/** Preview current basic and suggested increment for one staff. */
export function previewStaffIncrement(input: {
  masters: MastersState;
  staffId: string;
  salary?: SalarySetupState;
  policy?: IncrementPolicy;
  mode?: IncrementMode;
  value?: number;
}): StaffIncrementPreview | null {
  const staff = (input.masters.staff ?? []).find((s) => s.id === input.staffId);
  if (!staff) return null;
  const salary = input.salary || loadSalarySetup();
  const policy = normalizeIncrementPolicy(
    input.policy ?? loadIncrementState().policy,
  );
  const defaults = streamDefaults(policy, staff.stream);
  const mode = input.mode ?? defaults.mode;
  const value = input.value !== undefined ? input.value : defaults.value;
  const structure = resolveStructureForStaff(salary, staff);
  if (!structure) {
    return {
      staffId: staff.id,
      empCode: staff.empCode,
      fullName: staff.fullName,
      stream: staff.stream,
      joiningDate: staff.joiningDate,
      structureId: "",
      structureName: "",
      oldBasic: 0,
      mode,
      value,
      newBasic: 0,
      error: "No salary structure assigned",
    };
  }
  const link = salary.staffLinks.find((l) => l.staffId === staff.id);
  const amounts = computeStructureAmounts(
    salary,
    structure,
    link?.basicOverride || 0,
    link?.statutoryCover || "both",
    input.masters.statutoryConfig,
  );
  const oldBasic = amounts.basic;
  if (oldBasic <= 0) {
    return {
      staffId: staff.id,
      empCode: staff.empCode,
      fullName: staff.fullName,
      stream: staff.stream,
      joiningDate: staff.joiningDate,
      structureId: structure.id,
      structureName: structure.name,
      oldBasic: 0,
      mode,
      value,
      newBasic: 0,
      error: "Basic is zero",
    };
  }
  return {
    staffId: staff.id,
    empCode: staff.empCode,
    fullName: staff.fullName,
    stream: staff.stream,
    joiningDate: staff.joiningDate,
    structureId: structure.id,
    structureName: structure.name,
    oldBasic,
    mode,
    value,
    newBasic: computeNewBasic(oldBasic, mode, value),
    error: "",
  };
}

/**
 * Ad-hoc increment for one staff (ignores anniversary / min-service filters).
 * action: draft | submit | apply
 * - apply: writes basic immediately if approval not required; else pending approval
 */
export function createIndividualIncrement(input: {
  masters: MastersState;
  staffId: string;
  academicYearCode: string;
  effectiveFrom: string;
  createdBy: string;
  mode: IncrementMode;
  value: number;
  note?: string;
  action: "draft" | "submit" | "apply";
}):
  | { ok: true; batch: IncrementBatch; applied: boolean }
  | { ok: false; error: string } {
  const preview = previewStaffIncrement({
    masters: input.masters,
    staffId: input.staffId,
    mode: input.mode,
    value: input.value,
  });
  if (!preview) return { ok: false, error: "Staff not found" };
  if (preview.error) return { ok: false, error: preview.error };
  if (input.value < 0) return { ok: false, error: "Increment value cannot be negative" };

  const policy = normalizeIncrementPolicy(loadIncrementState().policy);
  const effectiveFrom = input.effectiveFrom.slice(0, 10) || defaultEffectiveFrom(policy);
  const now = new Date().toISOString();

  const line: IncrementLine = {
    staffId: preview.staffId,
    empCode: preview.empCode,
    fullName: preview.fullName,
    stream: preview.stream,
    joiningDate: preview.joiningDate,
    structureId: preview.structureId,
    structureName: preview.structureName,
    oldBasic: preview.oldBasic,
    mode: input.mode,
    value: input.value,
    newBasic: computeNewBasic(preview.oldBasic, input.mode, input.value),
    status: "included",
    skipReason: "",
  };

  let status: IncrementBatchStatus = "draft";
  let submittedBy = "";
  let submittedAt = "";
  let approvedBy = "";
  let approvedAt = "";

  if (input.action === "submit" || input.action === "apply") {
    submittedBy = input.createdBy;
    submittedAt = now;
    if (policy.requireApproval && input.action === "apply") {
      status = "pending_approval";
    } else if (policy.requireApproval) {
      status = "pending_approval";
    } else {
      status = "approved";
      approvedBy = input.createdBy;
      approvedAt = now;
    }
  }

  const batch: IncrementBatch = {
    id: nid("inc"),
    kind: "individual",
    label: `Individual · ${preview.empCode} · ${effectiveFrom.slice(0, 7)}`,
    academicYearCode: input.academicYearCode,
    effectiveFrom,
    status,
    lines: [line],
    createdBy: input.createdBy,
    createdAt: now,
    submittedBy,
    submittedAt,
    approvedBy,
    approvedAt,
    appliedBy: "",
    appliedAt: "",
    note: (input.note || "").trim() || `Ad-hoc increment for ${preview.fullName}`,
  };

  upsertIncrementBatch(batch);

  if (input.action === "apply" && batch.status === "approved") {
    const r = applyIncrementBatch(batch.id, input.createdBy);
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      batch: loadIncrementState().batches.find((b) => b.id === batch.id)!,
      applied: true,
    };
  }

  return { ok: true, batch, applied: false };
}

export function upsertIncrementBatch(batch: IncrementBatch): IncrementState {
  const state = loadIncrementState();
  const idx = state.batches.findIndex((b) => b.id === batch.id);
  const batches =
    idx >= 0
      ? state.batches.map((b, i) => (i === idx ? batch : b))
      : [batch, ...state.batches];
  const next = { ...state, batches };
  saveIncrementState(next);
  return next;
}

export function updateIncrementLine(
  batchId: string,
  staffId: string,
  patch: Partial<Pick<IncrementLine, "mode" | "value" | "status">>,
): IncrementState | null {
  const state = loadIncrementState();
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch || batch.status !== "draft") return null;
  const lines = batch.lines.map((l) => {
    if (l.staffId !== staffId) return l;
    if (l.status === "skipped") return l;
    const mode = patch.mode ?? l.mode;
    const value = patch.value !== undefined ? patch.value : l.value;
    const status = patch.status ?? l.status;
    const newBasic =
      status === "excluded"
        ? l.oldBasic
        : computeNewBasic(l.oldBasic, mode, value);
    return { ...l, mode, value, status, newBasic };
  });
  return upsertIncrementBatch({ ...batch, lines });
}

export function submitIncrementBatch(
  batchId: string,
  by: string,
): { ok: true; batch: IncrementBatch } | { ok: false; error: string } {
  const state = loadIncrementState();
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.status !== "draft") {
    return { ok: false, error: "Only draft batches can be submitted" };
  }
  const included = batch.lines.filter((l) => l.status === "included");
  if (included.length === 0) {
    return { ok: false, error: "No staff included in this batch" };
  }
  const policy = normalizeIncrementPolicy(state.policy);
  const next: IncrementBatch = {
    ...batch,
    status: policy.requireApproval ? "pending_approval" : "approved",
    submittedBy: by,
    submittedAt: new Date().toISOString(),
    approvedBy: policy.requireApproval ? "" : by,
    approvedAt: policy.requireApproval ? "" : new Date().toISOString(),
  };
  upsertIncrementBatch(next);
  return { ok: true, batch: next };
}

export function approveIncrementBatch(
  batchId: string,
  by: string,
): { ok: true; batch: IncrementBatch } | { ok: false; error: string } {
  const state = loadIncrementState();
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.status !== "pending_approval" && batch.status !== "draft") {
    return { ok: false, error: "Batch is not awaiting approval" };
  }
  const next: IncrementBatch = {
    ...batch,
    status: "approved",
    approvedBy: by,
    approvedAt: new Date().toISOString(),
    submittedBy: batch.submittedBy || by,
    submittedAt: batch.submittedAt || new Date().toISOString(),
  };
  upsertIncrementBatch(next);
  return { ok: true, batch: next };
}

/** Reject pending increment — back to draft with reason in note. */
export function rejectIncrementBatch(
  batchId: string,
  by: string,
  reason: string,
): { ok: true; batch: IncrementBatch } | { ok: false; error: string } {
  const state = loadIncrementState();
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.status !== "pending_approval") {
    return { ok: false, error: "Only pending batches can be rejected" };
  }
  const note = (reason || "").trim();
  if (!note) {
    return { ok: false, error: "Rejection reason is required" };
  }
  const next: IncrementBatch = {
    ...batch,
    status: "draft",
    submittedBy: "",
    submittedAt: "",
    approvedBy: "",
    approvedAt: "",
    note: [batch.note, `Rejected by ${by}: ${note}`].filter(Boolean).join(" · "),
  };
  upsertIncrementBatch(next);
  return { ok: true, batch: next };
}

/**
 * Apply approved increment: set/update staff basicOverride to newBasic.
 * Percent-based DA/HRA/PF then follow from the new basic.
 */
export function applyIncrementBatch(
  batchId: string,
  by: string,
): { ok: true; applied: number } | { ok: false; error: string } {
  const state = loadIncrementState();
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.status !== "approved") {
    return { ok: false, error: "Approve the batch before applying" };
  }

  const salary = loadSalarySetup();
  const included = batch.lines.filter((l) => l.status === "included");
  let links = [...salary.staffLinks];

  for (const line of included) {
    const existing = links.find((l) => l.staffId === line.staffId);
    const row: StaffSalaryLink = {
      staffId: line.staffId,
      structureId: existing?.structureId || line.structureId,
      basicOverride: line.newBasic,
      statutoryCover: existing?.statutoryCover || "both",
      effectiveFrom: batch.effectiveFrom,
      salaryAccountNote: existing?.salaryAccountNote || "",
    };
    links = [...links.filter((l) => l.staffId !== line.staffId), row];
  }

  saveSalarySetup({ ...salary, staffLinks: links });
  upsertIncrementBatch({
    ...batch,
    status: "applied",
    appliedBy: by,
    appliedAt: new Date().toISOString(),
  });
  return { ok: true, applied: included.length };
}

export function deleteIncrementBatch(batchId: string): boolean {
  const state = loadIncrementState();
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch || (batch.status !== "draft" && batch.status !== "pending_approval")) {
    return false;
  }
  saveIncrementState({
    ...state,
    batches: state.batches.filter((b) => b.id !== batchId),
  });
  return true;
}

export function incrementBatchStatusLabel(s: IncrementBatchStatus): string {
  switch (s) {
    case "draft":
      return "Draft";
    case "pending_approval":
      return "Pending approval";
    case "approved":
      return "Approved";
    case "applied":
      return "Applied";
    default:
      return s;
  }
}

export function describeIncrementPolicy(policy: IncrementPolicy): string {
  const p = normalizeIncrementPolicy(policy);
  if (!p.enabled) return "Increment policy disabled";
  const cycle =
    p.cycle === "april"
      ? "Every April"
      : p.cycle === "hold_month"
        ? `Month ${p.cycleMonth}`
        : "Joining anniversary";
  return `${cycle} · teach ${p.teachingPercent}% / non-teach ${p.nonTeachingPercent}% · min ${p.minServiceMonths} mo service`;
}
