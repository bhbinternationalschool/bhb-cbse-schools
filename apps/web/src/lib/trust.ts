/**
 * Trust Infrastructure & Construction (§6j) — projects, BOQ, materials,
 * labour, allotments, contractor bills, CWIP cost sheet (localStorage).
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  capitaliseTrustProject,
  postTrustCostLineToCwip,
} from "@/lib/accounts";

/* ─── Types ─────────────────────────────────────────────────── */

export type ProjectType =
  | "new_build"
  | "renovation"
  | "repair_major"
  | "boundary"
  | "lab"
  | "toilet_wash"
  | "playground"
  | "electrical"
  | "furniture_fitout"
  | "other";

export type ProjectStatus =
  | "planned"
  | "in_progress"
  | "on_hold"
  | "completed"
  | "cancelled";

export type TrustProject = {
  id: string;
  code: string;
  name: string;
  campus: string;
  type: ProjectType;
  budgetPaise: number;
  startDate: string;
  targetEndDate: string;
  status: ProjectStatus;
  managerName: string;
  linkedOwnerLoanId: string;
  physicalPct: number;
  note: string;
  createdAt: string;
};

export type WorkCategory =
  | "civil"
  | "electrical"
  | "plumbing"
  | "painting"
  | "fabrication"
  | "other";

export type WorkItemStatus =
  | "not_started"
  | "allotted"
  | "in_progress"
  | "done"
  | "verified";

export type TrustWorkItem = {
  id: string;
  projectId: string;
  code: string;
  name: string;
  category: WorkCategory;
  unit: string;
  qtyPlanned: number;
  ratePaise: number;
  amountPaise: number;
  specNote: string;
  status: WorkItemStatus;
};

export type TrustMaterialLine = {
  id: string;
  projectId: string;
  workItemId: string;
  name: string;
  unit: string;
  requiredQty: number;
  orderedQty: number;
  receivedQty: number;
  issuedQty: number;
  ratePaise: number;
};

export type LabourPaidStatus = "unpaid" | "paid";

export type TrustLabourEntry = {
  id: string;
  projectId: string;
  workItemId: string;
  labourType: string;
  headcount: number;
  days: number;
  ratePaise: number;
  amountPaise: number;
  entryDate: string;
  paidStatus: LabourPaidStatus;
  note: string;
};

export type AllotmentPartyType = "staff" | "contractor" | "gang" | "external";

export type AllotmentStatus =
  | "allotted"
  | "accepted"
  | "in_progress"
  | "submitted"
  | "verified"
  | "closed";

export type TrustAllotment = {
  id: string;
  code: string;
  projectId: string;
  workItemIds: string[];
  partyType: AllotmentPartyType;
  partyName: string;
  partyPhone: string;
  targetStart: string;
  targetEnd: string;
  agreedPaise: number;
  priority: "normal" | "urgent";
  status: AllotmentStatus;
  progressPct: number;
  verifiedBy: string;
  note: string;
};

export type TrustContractor = {
  id: string;
  name: string;
  gstin: string;
  phone: string;
  isActive: boolean;
};

export type WorkOrderStatus = "open" | "closed";

export type TrustWorkOrder = {
  id: string;
  projectId: string;
  contractorId: string;
  woNo: string;
  scope: string;
  valuePaise: number;
  retentionPct: number;
  status: WorkOrderStatus;
  issuedOn: string;
};

export type RaBillStatus = "draft" | "submitted" | "approved" | "paid";

export type TrustRaBill = {
  id: string;
  projectId: string;
  workOrderId: string;
  billNo: string;
  billDate: string;
  amountPaise: number;
  retentionPaise: number;
  paidPaise: number;
  status: RaBillStatus;
  note: string;
};

export type CostLineType =
  | "material"
  | "labour"
  | "ra"
  | "professional"
  | "statutory"
  | "transport"
  | "contingency"
  | "other";

export type CostPaymentStatus = "open" | "paid";

export type TrustCostLine = {
  id: string;
  projectId: string;
  workItemId: string;
  costType: CostLineType;
  sourceType: string;
  sourceId: string;
  date: string;
  vendorName: string;
  amountPaise: number;
  gstPaise: number;
  narration: string;
  paymentStatus: CostPaymentStatus;
  paidOn: string;
  retentionPaise: number;
};

export type TrustRateCardRow = {
  id: string;
  category: WorkCategory;
  unit: string;
  workName: string;
  ratePaise: number;
  locality: string;
};

export type TrustState = {
  version: 1;
  projects: TrustProject[];
  workItems: TrustWorkItem[];
  materials: TrustMaterialLine[];
  labourEntries: TrustLabourEntry[];
  allotments: TrustAllotment[];
  contractors: TrustContractor[];
  workOrders: TrustWorkOrder[];
  raBills: TrustRaBill[];
  costLines: TrustCostLine[];
  rateCard: TrustRateCardRow[];
};

export type ProjectKpis = {
  budgetPaise: number;
  spentPaise: number;
  committedPaise: number;
  remainingPaise: number;
  physicalPct: number;
};

export type TrustDashboardSnapshot = {
  activeProjects: number;
  totalBudgetPaise: number;
  totalSpentPaise: number;
  overdueAllotments: number;
};

const STORAGE_KEY = "bhb_trust_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function emptyTrust(): TrustState {
  return {
    version: 1,
    projects: [],
    workItems: [],
    materials: [],
    labourEntries: [],
    allotments: [],
    contractors: [],
    workOrders: [],
    raBills: [],
    costLines: [],
    rateCard: [],
  };
}

function normalizeProject(p: Partial<TrustProject>): TrustProject {
  return {
    id: p.id ?? nid("prj"),
    code: p.code ?? `CAP/${todayIso().slice(0, 4)}/001`,
    name: p.name ?? "Project",
    campus: p.campus ?? "Main campus",
    type: (p.type as ProjectType) ?? "renovation",
    budgetPaise: Math.max(0, Math.round(Number(p.budgetPaise) || 0)),
    startDate: p.startDate ?? todayIso(),
    targetEndDate: p.targetEndDate ?? todayIso(),
    status: (p.status as ProjectStatus) ?? "planned",
    managerName: p.managerName ?? "",
    linkedOwnerLoanId: p.linkedOwnerLoanId ?? "",
    physicalPct: Math.min(100, Math.max(0, Math.round(Number(p.physicalPct) || 0))),
    note: p.note ?? "",
    createdAt: p.createdAt ?? new Date().toISOString(),
  };
}

function normalizeWorkItem(w: Partial<TrustWorkItem>): TrustWorkItem {
  const qty = Math.max(0, Number(w.qtyPlanned) || 0);
  const rate = Math.max(0, Math.round(Number(w.ratePaise) || 0));
  return {
    id: w.id ?? nid("wrk"),
    projectId: w.projectId ?? "",
    code: w.code ?? "",
    name: w.name ?? "Work item",
    category: (w.category as WorkCategory) ?? "civil",
    unit: w.unit ?? "lump sum",
    qtyPlanned: qty,
    ratePaise: rate,
    amountPaise: w.amountPaise ?? Math.round(qty * rate),
    specNote: w.specNote ?? "",
    status: (w.status as WorkItemStatus) ?? "not_started",
  };
}

function normalizeMaterial(m: Partial<TrustMaterialLine>): TrustMaterialLine {
  return {
    id: m.id ?? nid("mat"),
    projectId: m.projectId ?? "",
    workItemId: m.workItemId ?? "",
    name: m.name ?? "Material",
    unit: m.unit ?? "bag",
    requiredQty: Math.max(0, Number(m.requiredQty) || 0),
    orderedQty: Math.max(0, Number(m.orderedQty) || 0),
    receivedQty: Math.max(0, Number(m.receivedQty) || 0),
    issuedQty: Math.max(0, Number(m.issuedQty) || 0),
    ratePaise: Math.max(0, Math.round(Number(m.ratePaise) || 0)),
  };
}

function normalizeLabour(l: Partial<TrustLabourEntry>): TrustLabourEntry {
  const days = Math.max(0, Number(l.days) || 0);
  const rate = Math.max(0, Math.round(Number(l.ratePaise) || 0));
  const headcount = Math.max(1, Math.round(Number(l.headcount) || 1));
  return {
    id: l.id ?? nid("lab"),
    projectId: l.projectId ?? "",
    workItemId: l.workItemId ?? "",
    labourType: l.labourType ?? "Mason",
    headcount,
    days,
    ratePaise: rate,
    amountPaise: l.amountPaise ?? Math.round(days * rate * headcount),
    entryDate: l.entryDate ?? todayIso(),
    paidStatus: (l.paidStatus as LabourPaidStatus) ?? "unpaid",
    note: l.note ?? "",
  };
}

function normalizeAllotment(a: Partial<TrustAllotment>): TrustAllotment {
  return {
    id: a.id ?? nid("alt"),
    code: a.code ?? `WA/${todayIso().slice(2, 4)}-${String(Math.floor(Math.random() * 900) + 100)}`,
    projectId: a.projectId ?? "",
    workItemIds: Array.isArray(a.workItemIds) ? a.workItemIds : [],
    partyType: (a.partyType as AllotmentPartyType) ?? "contractor",
    partyName: a.partyName ?? "",
    partyPhone: a.partyPhone ?? "",
    targetStart: a.targetStart ?? todayIso(),
    targetEnd: a.targetEnd ?? todayIso(),
    agreedPaise: Math.max(0, Math.round(Number(a.agreedPaise) || 0)),
    priority: a.priority === "urgent" ? "urgent" : "normal",
    status: (a.status as AllotmentStatus) ?? "allotted",
    progressPct: Math.min(100, Math.max(0, Math.round(Number(a.progressPct) || 0))),
    verifiedBy: a.verifiedBy ?? "",
    note: a.note ?? "",
  };
}

function normalizeContractor(c: Partial<TrustContractor>): TrustContractor {
  return {
    id: c.id ?? nid("con"),
    name: c.name ?? "Contractor",
    gstin: c.gstin ?? "",
    phone: c.phone ?? "",
    isActive: c.isActive !== false,
  };
}

function normalizeWorkOrder(w: Partial<TrustWorkOrder>): TrustWorkOrder {
  return {
    id: w.id ?? nid("wo"),
    projectId: w.projectId ?? "",
    contractorId: w.contractorId ?? "",
    woNo: w.woNo ?? "",
    scope: w.scope ?? "",
    valuePaise: Math.max(0, Math.round(Number(w.valuePaise) || 0)),
    retentionPct: Math.min(100, Math.max(0, Number(w.retentionPct) || 5)),
    status: (w.status as WorkOrderStatus) ?? "open",
    issuedOn: w.issuedOn ?? todayIso(),
  };
}

function normalizeRaBill(r: Partial<TrustRaBill>): TrustRaBill {
  return {
    id: r.id ?? nid("ra"),
    projectId: r.projectId ?? "",
    workOrderId: r.workOrderId ?? "",
    billNo: r.billNo ?? "",
    billDate: r.billDate ?? todayIso(),
    amountPaise: Math.max(0, Math.round(Number(r.amountPaise) || 0)),
    retentionPaise: Math.max(0, Math.round(Number(r.retentionPaise) || 0)),
    paidPaise: Math.max(0, Math.round(Number(r.paidPaise) || 0)),
    status: (r.status as RaBillStatus) ?? "draft",
    note: r.note ?? "",
  };
}

function normalizeCostLine(c: Partial<TrustCostLine>): TrustCostLine {
  return {
    id: c.id ?? nid("cst"),
    projectId: c.projectId ?? "",
    workItemId: c.workItemId ?? "",
    costType: (c.costType as CostLineType) ?? "other",
    sourceType: c.sourceType ?? "manual",
    sourceId: c.sourceId ?? "",
    date: c.date ?? todayIso(),
    vendorName: c.vendorName ?? "",
    amountPaise: Math.max(0, Math.round(Number(c.amountPaise) || 0)),
    gstPaise: Math.max(0, Math.round(Number(c.gstPaise) || 0)),
    narration: c.narration ?? "",
    paymentStatus: (c.paymentStatus as CostPaymentStatus) ?? "open",
    paidOn: c.paidOn ?? "",
    retentionPaise: Math.max(0, Math.round(Number(c.retentionPaise) || 0)),
  };
}

export function loadTrust(): TrustState {
  if (typeof window === "undefined") return emptyTrust();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTrust();
    const parsed = JSON.parse(raw) as Partial<TrustState>;
    return {
      version: 1,
      projects: Array.isArray(parsed.projects)
        ? parsed.projects.map(normalizeProject)
        : [],
      workItems: Array.isArray(parsed.workItems)
        ? parsed.workItems.map(normalizeWorkItem)
        : [],
      materials: Array.isArray(parsed.materials)
        ? parsed.materials.map(normalizeMaterial)
        : [],
      labourEntries: Array.isArray(parsed.labourEntries)
        ? parsed.labourEntries.map(normalizeLabour)
        : [],
      allotments: Array.isArray(parsed.allotments)
        ? parsed.allotments.map(normalizeAllotment)
        : [],
      contractors: Array.isArray(parsed.contractors)
        ? parsed.contractors.map(normalizeContractor)
        : [],
      workOrders: Array.isArray(parsed.workOrders)
        ? parsed.workOrders.map(normalizeWorkOrder)
        : [],
      raBills: Array.isArray(parsed.raBills)
        ? parsed.raBills.map(normalizeRaBill)
        : [],
      costLines: Array.isArray(parsed.costLines)
        ? parsed.costLines.map(normalizeCostLine)
        : [],
      rateCard: Array.isArray(parsed.rateCard) ? parsed.rateCard : [],
    };
  } catch {
    return emptyTrust();
  }
}

export function saveTrust(state: TrustState): void {
  if (!assertModulePermission("trust", "edit", "saveTrust")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: 1 }));
  void import("@/lib/trustPersistence").then(({ scheduleTrustSync }) => {
    scheduleTrustSync(state);
  });

}

export function writeTrustLocalRaw(state: TrustState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: 1 }));
}

export function trustStateIsEmpty(state: TrustState): boolean {
  return (state.projects?.length ?? 0) === 0 && (state.costLines?.length ?? 0) === 0;
}


export function projectTypeLabel(t: ProjectType): string {
  const map: Record<ProjectType, string> = {
    new_build: "New build",
    renovation: "Renovation",
    repair_major: "Major repair",
    boundary: "Boundary",
    lab: "Lab",
    toilet_wash: "Toilet / wash",
    playground: "Playground",
    electrical: "Electrical",
    furniture_fitout: "Furniture fit-out",
    other: "Other",
  };
  return map[t] ?? t;
}

export function getProject(projectId: string, state?: TrustState): TrustProject | undefined {
  const s = state ?? loadTrust();
  return s.projects.find((p) => p.id === projectId);
}

export function listActiveProjects(state?: TrustState): TrustProject[] {
  const s = state ?? loadTrust();
  return s.projects.filter(
    (p) => p.status === "planned" || p.status === "in_progress" || p.status === "on_hold",
  );
}

export function projectSpentPaise(projectId: string, state?: TrustState): number {
  const s = state ?? loadTrust();
  const costPaid = s.costLines
    .filter((c) => c.projectId === projectId && c.paymentStatus === "paid")
    .reduce((n, c) => n + c.amountPaise, 0);
  const raPaid = s.raBills
    .filter((r) => r.projectId === projectId && r.status === "paid")
    .reduce((n, r) => n + r.paidPaise, 0);
  return costPaid + raPaid;
}

export function projectCommittedPaise(projectId: string, state?: TrustState): number {
  const s = state ?? loadTrust();
  const openCost = s.costLines
    .filter((c) => c.projectId === projectId && c.paymentStatus === "open")
    .reduce((n, c) => n + c.amountPaise, 0);
  const openRa = s.raBills
    .filter(
      (r) =>
        r.projectId === projectId &&
        r.status !== "paid" &&
        r.status !== "draft",
    )
    .reduce((n, r) => n + Math.max(0, r.amountPaise - r.paidPaise), 0);
  const openWo = s.workOrders
    .filter((w) => w.projectId === projectId && w.status === "open")
    .reduce((n, w) => n + w.valuePaise, 0);
  return openCost + openRa + openWo;
}

export function projectKpis(projectId: string, state?: TrustState): ProjectKpis {
  const s = state ?? loadTrust();
  const p = getProject(projectId, s);
  const budgetPaise = p?.budgetPaise ?? 0;
  const spentPaise = projectSpentPaise(projectId, s);
  const committedPaise = projectCommittedPaise(projectId, s);
  return {
    budgetPaise,
    spentPaise,
    committedPaise,
    remainingPaise: Math.max(0, budgetPaise - spentPaise - committedPaise),
    physicalPct: p?.physicalPct ?? 0,
  };
}

export function dashboardSnapshot(state?: TrustState): TrustDashboardSnapshot {
  const s = state ?? loadTrust();
  const active = listActiveProjects(s);
  const today = todayIso();
  const overdueAllotments = s.allotments.filter(
    (a) =>
      a.status !== "verified" &&
      a.status !== "closed" &&
      a.targetEnd < today,
  ).length;
  return {
    activeProjects: active.length,
    totalBudgetPaise: active.reduce((n, p) => n + p.budgetPaise, 0),
    totalSpentPaise: active.reduce((n, p) => n + projectSpentPaise(p.id, s), 0),
    overdueAllotments,
  };
}

export function suggestRate(
  category: WorkCategory,
  unit: string,
  state?: TrustState,
): number {
  const s = state ?? loadTrust();
  const row = s.rateCard.find(
    (r) => r.category === category && r.unit === unit,
  );
  return row?.ratePaise ?? 0;
}

export function seedTrustIfEmpty(): TrustState {
  const state = loadTrust();
  if (state.projects.length > 0) return state;

  const project = normalizeProject({
    code: "CAP/25-26/001",
    name: "New Primary Wing — Block B",
    campus: "Main campus",
    type: "new_build",
    budgetPaise: 120_000_000_00,
    startDate: todayIso(),
    targetEndDate: `${new Date().getFullYear() + 1}-03-31`,
    status: "in_progress",
    managerName: "Site engineer",
    physicalPct: 15,
    note: "Demo seed project",
  });

  const work = normalizeWorkItem({
    projectId: project.id,
    code: "WRK-01",
    name: "Classroom flooring — GF",
    category: "civil",
    unit: "sq.ft",
    qtyPlanned: 2500,
    ratePaise: 8500,
    status: "in_progress",
  });

  const contractor = normalizeContractor({
    name: "Sharma Civil Contractors",
    gstin: "09AABCS1234A1Z5",
    phone: "9876543210",
  });

  const rateCard: TrustRateCardRow[] = [
    {
      id: nid("rc"),
      category: "civil",
      unit: "sq.ft",
      workName: "Vitrified tile flooring",
      ratePaise: 8500,
      locality: "Lucknow",
    },
    {
      id: nid("rc"),
      category: "electrical",
      unit: "point",
      workName: "Electrical point",
      ratePaise: 45000,
      locality: "Lucknow",
    },
  ];

  const next: TrustState = {
    ...emptyTrust(),
    projects: [project],
    workItems: [work],
    contractors: [contractor],
    rateCard,
  };
  saveTrust(next);
  return next;
}

/* ─── Projects ──────────────────────────────────────────────── */

export function upsertProject(
  patch: Partial<TrustProject> & { name: string },
): { ok: true; project: TrustProject } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Project name required");
  const state = loadTrust();
  const existing = patch.id
    ? state.projects.find((p) => p.id === patch.id)
    : undefined;
  const project = normalizeProject({
    ...existing,
    ...patch,
    name,
    id: existing?.id ?? patch.id ?? nid("prj"),
  });
  const projects = existing
    ? state.projects.map((p) => (p.id === project.id ? project : p))
    : [project, ...state.projects];
  saveTrust({ ...state, projects });
  return { ok: true, project };
}

/* ─── Works BOQ ───────────────────────────────────────────── */

export function upsertWorkItem(
  patch: Partial<TrustWorkItem> & { projectId: string; name: string },
): { ok: true; item: TrustWorkItem } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Work name required");
  const state = loadTrust();
  if (!state.projects.some((p) => p.id === patch.projectId)) {
    return fail("Project not found");
  }
  const existing = patch.id
    ? state.workItems.find((w) => w.id === patch.id)
    : undefined;
  const qty = Math.max(0, Number(patch.qtyPlanned ?? existing?.qtyPlanned) || 0);
  const rate = Math.max(0, Math.round(Number(patch.ratePaise ?? existing?.ratePaise) || 0));
  const item = normalizeWorkItem({
    ...existing,
    ...patch,
    name,
    qtyPlanned: qty,
    ratePaise: rate,
    amountPaise: Math.round(qty * rate),
    id: existing?.id ?? patch.id ?? nid("wrk"),
  });
  const workItems = existing
    ? state.workItems.map((w) => (w.id === item.id ? item : w))
    : [item, ...state.workItems];
  saveTrust({ ...state, workItems });
  return { ok: true, item };
}

/* ─── Materials ───────────────────────────────────────────── */

export function upsertMaterialLine(
  patch: Partial<TrustMaterialLine> & { projectId: string; name: string },
): { ok: true; line: TrustMaterialLine } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Material name required");
  const state = loadTrust();
  const existing = patch.id
    ? state.materials.find((m) => m.id === patch.id)
    : undefined;
  const line = normalizeMaterial({
    ...existing,
    ...patch,
    name,
    id: existing?.id ?? patch.id ?? nid("mat"),
  });
  const materials = existing
    ? state.materials.map((m) => (m.id === line.id ? line : m))
    : [line, ...state.materials];
  saveTrust({ ...state, materials });
  return { ok: true, line };
}

export function materialBalance(line: TrustMaterialLine): number {
  return Math.max(0, line.receivedQty - line.issuedQty);
}

export function listMaterialShortfalls(state?: TrustState): TrustMaterialLine[] {
  const s = state ?? loadTrust();
  return s.materials.filter((m) => materialBalance(m) < m.requiredQty - m.issuedQty);
}

/* ─── Labour ──────────────────────────────────────────────── */

export function upsertLabourEntry(
  patch: Partial<TrustLabourEntry> & { projectId: string; labourType: string },
): { ok: true; entry: TrustLabourEntry } | { ok: false; error: string } {
  const state = loadTrust();
  const existing = patch.id
    ? state.labourEntries.find((l) => l.id === patch.id)
    : undefined;
  const days = Math.max(0, Number(patch.days ?? existing?.days) || 0);
  const rate = Math.max(0, Math.round(Number(patch.ratePaise ?? existing?.ratePaise) || 0));
  const headcount = Math.max(1, Math.round(Number(patch.headcount ?? existing?.headcount) || 1));
  const entry = normalizeLabour({
    ...existing,
    ...patch,
    days,
    ratePaise: rate,
    headcount,
    amountPaise: Math.round(days * rate * headcount),
    id: existing?.id ?? patch.id ?? nid("lab"),
  });
  const labourEntries = existing
    ? state.labourEntries.map((l) => (l.id === entry.id ? entry : l))
    : [entry, ...state.labourEntries];
  saveTrust({ ...state, labourEntries });
  return { ok: true, entry };
}

export function payLabourEntry(
  labourId: string,
  input: { poolId?: string; bankId?: string; date?: string } = {},
): { ok: true } | { ok: false; error: string } {
  const state = loadTrust();
  const entry = state.labourEntries.find((l) => l.id === labourId);
  if (!entry) return fail("Labour entry not found");
  if (entry.paidStatus === "paid") return fail("Already paid");

  const costRes = createCostLine({
    projectId: entry.projectId,
    workItemId: entry.workItemId,
    costType: "labour",
    sourceType: "labour_entry",
    sourceId: entry.id,
    date: input.date || entry.entryDate,
    vendorName: entry.labourType,
    amountPaise: entry.amountPaise,
    narration: `Labour · ${entry.labourType} · ${entry.days} day(s)`,
  });
  if (!costRes.ok) return costRes;

  const payRes = payCostLine(costRes.line.id, {
    date: input.date,
    poolId: input.poolId,
    bankId: input.bankId,
  });
  if (!payRes.ok) return payRes;

  const s2 = loadTrust();
  saveTrust({
    ...s2,
    labourEntries: s2.labourEntries.map((l) =>
      l.id === labourId ? { ...l, paidStatus: "paid" } : l,
    ),
  });
  return { ok: true };
}

/* ─── Allotments ──────────────────────────────────────────── */

export function upsertAllotment(
  patch: Partial<TrustAllotment> & { projectId: string; partyName: string },
): { ok: true; allotment: TrustAllotment } | { ok: false; error: string } {
  const partyName = patch.partyName.trim();
  if (!partyName) return fail("Assignee name required");
  const state = loadTrust();
  const existing = patch.id
    ? state.allotments.find((a) => a.id === patch.id)
    : undefined;
  const allotment = normalizeAllotment({
    ...existing,
    ...patch,
    partyName,
    id: existing?.id ?? patch.id ?? nid("alt"),
  });
  const allotments = existing
    ? state.allotments.map((a) => (a.id === allotment.id ? allotment : a))
    : [allotment, ...state.allotments];
  saveTrust({ ...state, allotments });
  return { ok: true, allotment };
}

export function updateAllotmentProgress(
  allotmentId: string,
  progressPct: number,
  status?: AllotmentStatus,
): { ok: true; allotment: TrustAllotment } | { ok: false; error: string } {
  const state = loadTrust();
  const row = state.allotments.find((a) => a.id === allotmentId);
  if (!row) return fail("Allotment not found");
  const updated = normalizeAllotment({
    ...row,
    progressPct,
    status: status ?? (progressPct >= 100 ? "submitted" : "in_progress"),
  });
  saveTrust({
    ...state,
    allotments: state.allotments.map((a) =>
      a.id === allotmentId ? updated : a,
    ),
  });
  return { ok: true, allotment: updated };
}

export function verifyAllotment(
  allotmentId: string,
  verifiedBy: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadTrust();
  const row = state.allotments.find((a) => a.id === allotmentId);
  if (!row) return fail("Allotment not found");
  saveTrust({
    ...state,
    allotments: state.allotments.map((a) =>
      a.id === allotmentId
        ? { ...a, status: "verified" as const, verifiedBy, progressPct: 100 }
        : a,
    ),
  });
  return { ok: true };
}

export function listOverdueAllotments(state?: TrustState): TrustAllotment[] {
  const s = state ?? loadTrust();
  const today = todayIso();
  return s.allotments.filter(
    (a) =>
      a.status !== "verified" &&
      a.status !== "closed" &&
      a.targetEnd < today,
  );
}

/* ─── Contractors / WO / RA ─────────────────────────────────── */

export function upsertContractor(
  patch: Partial<TrustContractor> & { name: string },
): { ok: true; contractor: TrustContractor } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Contractor name required");
  const state = loadTrust();
  const existing = patch.id
    ? state.contractors.find((c) => c.id === patch.id)
    : undefined;
  const contractor = normalizeContractor({
    ...existing,
    ...patch,
    name,
    id: existing?.id ?? patch.id ?? nid("con"),
  });
  const contractors = existing
    ? state.contractors.map((c) => (c.id === contractor.id ? contractor : c))
    : [contractor, ...state.contractors];
  saveTrust({ ...state, contractors });
  return { ok: true, contractor };
}

export function createWorkOrder(input: {
  projectId: string;
  contractorId: string;
  scope: string;
  valuePaise: number;
  retentionPct?: number;
  woNo?: string;
}): { ok: true; wo: TrustWorkOrder } | { ok: false; error: string } {
  const state = loadTrust();
  const wo = normalizeWorkOrder({
    projectId: input.projectId,
    contractorId: input.contractorId,
    scope: input.scope,
    valuePaise: input.valuePaise,
    retentionPct: input.retentionPct ?? 5,
    woNo: input.woNo ?? `WO-${state.workOrders.length + 1}`,
  });
  saveTrust({ ...state, workOrders: [wo, ...state.workOrders] });
  return { ok: true, wo };
}

export function createRaBill(input: {
  projectId: string;
  workOrderId: string;
  billNo: string;
  billDate?: string;
  amountPaise: number;
  note?: string;
}): { ok: true; bill: TrustRaBill } | { ok: false; error: string } {
  const state = loadTrust();
  const wo = state.workOrders.find((w) => w.id === input.workOrderId);
  if (!wo) return fail("Work order not found");
  const retentionPaise = Math.round(
    input.amountPaise * (wo.retentionPct / 100),
  );
  const bill = normalizeRaBill({
    projectId: input.projectId,
    workOrderId: input.workOrderId,
    billNo: input.billNo,
    billDate: input.billDate ?? todayIso(),
    amountPaise: input.amountPaise,
    retentionPaise,
    status: "submitted",
    note: input.note ?? "",
  });
  saveTrust({ ...state, raBills: [bill, ...state.raBills] });
  return { ok: true, bill };
}

export function approveRaBill(
  billId: string,
): { ok: true; bill: TrustRaBill } | { ok: false; error: string } {
  const state = loadTrust();
  const bill = state.raBills.find((b) => b.id === billId);
  if (!bill) return fail("RA bill not found");
  const updated = { ...bill, status: "approved" as const };
  saveTrust({
    ...state,
    raBills: state.raBills.map((b) => (b.id === billId ? updated : b)),
  });
  return { ok: true, bill: updated };
}

export function payRaBill(
  billId: string,
  input: { poolId?: string; bankId?: string; date?: string } = {},
): { ok: true } | { ok: false; error: string } {
  const state = loadTrust();
  const bill = state.raBills.find((b) => b.id === billId);
  if (!bill) return fail("RA bill not found");
  if (bill.status !== "approved" && bill.status !== "submitted") {
    return fail("Bill must be approved before payment");
  }
  const netPay = bill.amountPaise - bill.retentionPaise;
  const costRes = createCostLine({
    projectId: bill.projectId,
    costType: "ra",
    sourceType: "ra_bill",
    sourceId: bill.id,
    date: input.date || bill.billDate,
    vendorName: state.contractors.find(
      (c) =>
        c.id ===
        state.workOrders.find((w) => w.id === bill.workOrderId)?.contractorId,
    )?.name ?? "Contractor",
    amountPaise: netPay,
    retentionPaise: bill.retentionPaise,
    narration: `RA ${bill.billNo}`,
  });
  if (!costRes.ok) return costRes;
  const payRes = payCostLine(costRes.line.id, {
    date: input.date,
    poolId: input.poolId,
    bankId: input.bankId,
    retentionPaise: bill.retentionPaise,
  });
  if (!payRes.ok) return payRes;
  const s2 = loadTrust();
  saveTrust({
    ...s2,
    raBills: s2.raBills.map((b) =>
      b.id === billId
        ? { ...b, status: "paid" as const, paidPaise: netPay }
        : b,
    ),
  });
  return { ok: true };
}

/* ─── Cost sheet ────────────────────────────────────────────── */

export function createCostLine(
  input: Partial<TrustCostLine> & {
    projectId: string;
    amountPaise: number;
  },
): { ok: true; line: TrustCostLine } | { ok: false; error: string } {
  const state = loadTrust();
  const line = normalizeCostLine({
    id: nid("cst"),
    date: input.date ?? todayIso(),
    paymentStatus: "open",
    ...input,
  });
  saveTrust({ ...state, costLines: [line, ...state.costLines] });
  return { ok: true, line };
}

export function payCostLine(
  costLineId: string,
  input: {
    date?: string;
    poolId?: string;
    bankId?: string;
    retentionPaise?: number;
  } = {},
): { ok: true } | { ok: false; error: string } {
  const state = loadTrust();
  const line = state.costLines.find((c) => c.id === costLineId);
  if (!line) return fail("Cost line not found");
  if (line.paymentStatus === "paid") return fail("Already paid");

  const project = getProject(line.projectId, state);
  const cwipRes = postTrustCostLineToCwip({
    costLineId: line.id,
    projectCode: project?.code ?? line.projectId,
    projectName: project?.name ?? "Project",
    amountPaise: line.amountPaise,
    retentionPaise: input.retentionPaise ?? line.retentionPaise,
    date: input.date || line.date,
    narration: line.narration || line.costType,
    poolId: input.poolId,
    bankId: input.bankId,
  });
  if (!cwipRes.ok) return cwipRes;

  const s2 = loadTrust();
  saveTrust({
    ...s2,
    costLines: s2.costLines.map((c) =>
      c.id === costLineId
        ? {
            ...c,
            paymentStatus: "paid" as const,
            paidOn: input.date || todayIso(),
            retentionPaise: input.retentionPaise ?? c.retentionPaise,
          }
        : c,
    ),
  });
  return { ok: true };
}

export function listProjectCostLines(
  projectId: string,
  state?: TrustState,
): TrustCostLine[] {
  const s = state ?? loadTrust();
  return s.costLines
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function capitaliseProject(
  projectId: string,
  input?: { date?: string; assetName?: string },
): { ok: true } | { ok: false; error: string } {
  const state = loadTrust();
  const project = getProject(projectId, state);
  if (!project) return fail("Project not found");
  if (project.status === "completed") return fail("Project already completed");

  const spent = projectSpentPaise(projectId, state);
  if (spent <= 0) return fail("No spent amount to capitalise");

  const capRes = capitaliseTrustProject({
    projectId,
    projectCode: project.code,
    projectName: project.name,
    amountPaise: spent,
    date: input?.date,
    assetName: input?.assetName,
  });
  if (!capRes.ok) return capRes;

  saveTrust({
    ...state,
    projects: state.projects.map((p) =>
      p.id === projectId
        ? { ...p, status: "completed" as const, physicalPct: 100 }
        : p,
    ),
  });
  return { ok: true };
}
