/**
 * School store / books — catalog + issue-on-credit (demo localStorage).
 * Unpaid issues become Fee Take dues (kind: store).
 */

import { DEFAULT_AY } from "@/lib/masters";
import { checkHold } from "@/lib/holds";

export type StoreCategory = "book" | "uniform" | "stationery" | "other";

export type StoreItem = {
  id: string;
  sku: string;
  name: string;
  category: StoreCategory;
  /** Optional size / variant label (e.g. 32, Class 6) */
  sizeLabel: string;
  unitPricePaise: number;
  isActive: boolean;
};

export type StoreIssueLine = {
  itemId: string;
  sku: string;
  name: string;
  sizeLabel: string;
  qty: number;
  unitPricePaise: number;
  linePaise: number;
};

export type StoreIssue = {
  id: string;
  issueNo: string;
  studentId: string;
  householdId: string;
  academicYearCode: string;
  /** Issue / due date YYYY-MM-DD */
  issuedOn: string;
  lines: StoreIssueLine[];
  totalPaise: number;
  note: string;
  createdAt: string;
  voidedAt: string | null;
};

export type StoreState = {
  version: 1;
  items: StoreItem[];
  issues: StoreIssue[];
};

const STORAGE_KEY = "bhb_store_v1";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultCatalog(): StoreItem[] {
  return [
    {
      id: "si_nb_eng6",
      sku: "BK-ENG-6",
      name: "English Coursebook Class 6",
      category: "book",
      sizeLabel: "",
      unitPricePaise: 385_00,
      isActive: true,
    },
    {
      id: "si_nb_math6",
      sku: "BK-MATH-6",
      name: "Mathematics Class 6",
      category: "book",
      sizeLabel: "",
      unitPricePaise: 420_00,
      isActive: true,
    },
    {
      id: "si_nb_hin6",
      sku: "BK-HIN-6",
      name: "Hindi Vasant Class 6",
      category: "book",
      sizeLabel: "",
      unitPricePaise: 295_00,
      isActive: true,
    },
    {
      id: "si_nb_diary",
      sku: "BK-DIARY",
      name: "School diary",
      category: "book",
      sizeLabel: "",
      unitPricePaise: 120_00,
      isActive: true,
    },
    {
      id: "si_un_shirt",
      sku: "UN-SHIRT",
      name: "Uniform shirt",
      category: "uniform",
      sizeLabel: "32",
      unitPricePaise: 450_00,
      isActive: true,
    },
    {
      id: "si_un_tie",
      sku: "UN-TIE",
      name: "School tie",
      category: "uniform",
      sizeLabel: "",
      unitPricePaise: 150_00,
      isActive: true,
    },
    {
      id: "si_st_geo",
      sku: "ST-GEO",
      name: "Geometry box",
      category: "stationery",
      sizeLabel: "",
      unitPricePaise: 180_00,
      isActive: true,
    },
  ];
}

function normalizeItem(i: Partial<StoreItem>): StoreItem {
  return {
    id: i.id ?? id("si"),
    sku: (i.sku ?? "").trim().toUpperCase() || "SKU",
    name: i.name ?? "Item",
    category: i.category ?? "other",
    sizeLabel: i.sizeLabel ?? "",
    unitPricePaise: Math.max(0, i.unitPricePaise ?? 0),
    isActive: i.isActive !== false,
  };
}

function normalizeIssue(iss: Partial<StoreIssue>): StoreIssue {
  const lines = Array.isArray(iss.lines)
    ? iss.lines.map((l) => ({
        itemId: l.itemId ?? "",
        sku: l.sku ?? "",
        name: l.name ?? "",
        sizeLabel: l.sizeLabel ?? "",
        qty: Math.max(1, Math.floor(l.qty ?? 1)),
        unitPricePaise: Math.max(0, l.unitPricePaise ?? 0),
        linePaise:
          l.linePaise ??
          Math.max(0, l.unitPricePaise ?? 0) * Math.max(1, Math.floor(l.qty ?? 1)),
      }))
    : [];
  const total =
    iss.totalPaise ?? lines.reduce((s, l) => s + l.linePaise, 0);
  return {
    id: iss.id ?? id("iss"),
    issueNo: iss.issueNo ?? "",
    studentId: iss.studentId ?? "",
    householdId: iss.householdId ?? "",
    academicYearCode: iss.academicYearCode ?? DEFAULT_AY,
    issuedOn:
      iss.issuedOn ?? new Date().toISOString().slice(0, 10),
    lines,
    totalPaise: total,
    note: iss.note ?? "",
    createdAt: iss.createdAt ?? new Date().toISOString(),
    voidedAt: iss.voidedAt ?? null,
  };
}

function emptyStore(): StoreState {
  return { version: 1, items: defaultCatalog(), issues: [] };
}

export function loadStore(): StoreState {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as StoreState;
    const items =
      Array.isArray(parsed.items) && parsed.items.length > 0
        ? parsed.items.map(normalizeItem)
        : defaultCatalog();
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(normalizeIssue)
      : [];
    return { version: 1, items, issues };
  } catch {
    return emptyStore();
  }
}

export function saveStore(state: StoreState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function listActiveStoreItems(store?: StoreState): StoreItem[] {
  const s = store ?? loadStore();
  return s.items.filter((i) => i.isActive);
}

export function nextStoreIssueNo(
  store?: StoreState,
  ayCode = DEFAULT_AY,
): string {
  const s = store ?? loadStore();
  const prefix = `ISS/${ayCode}/`;
  let max = 0;
  for (const iss of s.issues) {
    if (!iss.issueNo.startsWith(prefix)) continue;
    const n = Number(iss.issueNo.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export function storeDueKey(studentId: string, issueId: string): string {
  return `store:${studentId}:${issueId}`;
}

export function createStoreIssue(input: {
  studentId: string;
  householdId: string;
  issuedOn: string;
  lines: {
    itemId: string;
    qty: number;
    /** Override catalog unit price (paise); optional */
    unitPricePaise?: number;
    sizeLabel?: string;
  }[];
  note?: string;
  academicYearCode?: string;
}):
  | { ok: true; issue: StoreIssue }
  | { ok: false; error: string } {
  const store = loadStore();
  if (!input.studentId || !input.householdId) {
    return { ok: false, error: "Student is required" };
  }
  if (!input.issuedOn) {
    return { ok: false, error: "Issue date is required" };
  }
  if (!input.lines.length) {
    return { ok: false, error: "Add at least one item" };
  }

  const hold = checkHold(input.studentId, "HOLD_STORE_CREDIT");
  if (!hold.allowed) {
    return { ok: false, error: hold.message };
  }

  const lines: StoreIssueLine[] = [];
  for (const row of input.lines) {
    const item = store.items.find((i) => i.id === row.itemId && i.isActive);
    if (!item) {
      return { ok: false, error: "Unknown or inactive catalog item" };
    }
    const qty = Math.max(1, Math.floor(row.qty));
    const unit = row.unitPricePaise ?? item.unitPricePaise;
    if (unit <= 0) {
      return { ok: false, error: `${item.name}: price must be positive` };
    }
    lines.push({
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      sizeLabel: (row.sizeLabel ?? item.sizeLabel).trim(),
      qty,
      unitPricePaise: unit,
      linePaise: unit * qty,
    });
  }

  const totalPaise = lines.reduce((s, l) => s + l.linePaise, 0);
  const issue = normalizeIssue({
    id: id("iss"),
    issueNo: nextStoreIssueNo(store, input.academicYearCode ?? DEFAULT_AY),
    studentId: input.studentId,
    householdId: input.householdId,
    academicYearCode: input.academicYearCode ?? DEFAULT_AY,
    issuedOn: input.issuedOn,
    lines,
    totalPaise,
    note: input.note?.trim() ?? "",
    createdAt: new Date().toISOString(),
    voidedAt: null,
  });

  saveStore({
    ...store,
    issues: [issue, ...store.issues],
  });
  return { ok: true, issue };
}

export function voidStoreIssue(issueId: string): boolean {
  const store = loadStore();
  const issue = store.issues.find((i) => i.id === issueId);
  if (!issue || issue.voidedAt) return false;
  const now = new Date().toISOString();
  saveStore({
    ...store,
    issues: store.issues.map((i) =>
      i.id === issueId ? { ...i, voidedAt: now } : i,
    ),
  });
  return true;
}

export function listStoreIssuesForStudent(
  studentId: string,
  store?: StoreState,
): StoreIssue[] {
  const s = store ?? loadStore();
  return s.issues
    .filter((i) => i.studentId === studentId && !i.voidedAt)
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
}

export function categoryLabel(cat: StoreCategory): string {
  switch (cat) {
    case "book":
      return "Books";
    case "uniform":
      return "Uniform";
    case "stationery":
      return "Stationery";
    default:
      return "Other";
  }
}

export function formatStoreItemLine(line: StoreIssueLine): string {
  const size = line.sizeLabel ? ` ${line.sizeLabel}` : "";
  return `${line.name}${size} ×${line.qty} @ ₹${(line.unitPricePaise / 100).toFixed(0)}`;
}
