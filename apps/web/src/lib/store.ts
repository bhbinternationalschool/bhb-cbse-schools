/**
 * School store / books — catalog, stock, cash/credit issue (demo localStorage).
 * Credit issues → Fee Take dues (kind: store). Cash issues settle at counter.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { DEFAULT_AY } from "@/lib/masters";
import { checkHold } from "@/lib/holds";

/** Legacy fixed codes — still accepted on import / migration. */
export type StoreCategoryCode = "book" | "uniform" | "stationery" | "other";

export type StoreAudience = "student" | "staff" | "both";

export type StoreIssuePolicy =
  | "once_per_ay"
  | "once_ever"
  | "unlimited"
  | "max_qty_per_ay";

export type StorePaymentMode = "cash" | "credit";
export type StorePaymentStatus = "paid" | "due" | "void";

export type StoreIssueKind =
  | "first"
  | "replacement_lost"
  | "replacement_damaged"
  | "size_exchange"
  | "extra_optional";

export type StoreStockMoveKind =
  | "opening"
  | "purchase_in"
  | "purchase_return_out"
  | "adjust"
  | "issue_out"
  | "void_in"
  | "exchange_in"
  | "sell_return_in"
  | "production"
  | "consumption";

/** Inventory classification (Stock Group). */
export type StoreCategoryDef = {
  id: string;
  name: string;
  /** Stable slug for CSV (optional) */
  code: string;
  isActive: boolean;
  sortOrder: number;
};

/** Counter / POS grouping (Sale Group). */
export type StoreSaleGroup = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  sortOrder: number;
};

/** Unit of measurement master. */
export type StoreUom = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  sortOrder: number;
};

/** Infra / location level for stock (store, lab, mess, etc.). */
export type StoreInfraLevel = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  sortOrder: number;
};

/** Source / vendor for procured items. */
export type StoreSource = {
  id: string;
  name: string;
  code: string;
  phone: string;
  isActive: boolean;
  sortOrder: number;
};

export type StoreItem = {
  id: string;
  sku: string;
  name: string;
  /** Custom / editable category id (Stock Group). */
  categoryId: string;
  /** Optional Sale Group id. */
  saleGroupId: string;
  /** Unit of measurement id. */
  uomId: string;
  /** Source / vendor id. */
  sourceId: string;
  /** Infra / location level id. */
  infraLevelId: string;
  /** Optional size / variant label (e.g. 32, Class 6) */
  sizeLabel: string;
  /** Cost to school */
  purchasePricePaise: number;
  /** Selling / list price to buyer */
  salePricePaise: number;
  /**
   * Alias of salePricePaise (Fee Take / receipts / legacy callers).
   * Always kept in sync with salePricePaise.
   */
  unitPricePaise: number;
  /** Max discount allowed as % of this item's line total (0–100). Locked at counter. */
  maxDiscountPct: number;
  /** Who may receive this item */
  audience: StoreAudience;
  /** Empty = all classes; otherwise only listed class ids (students). */
  applicableClassIds: string[];
  isActive: boolean;
  stockOnHand: number;
  reorderLevel: number;
  openingQty: number;
  issuePolicy: StoreIssuePolicy;
  maxQtyPerAy: number;
  barcode: string;
};

export type StoreIssueLine = {
  itemId: string;
  sku: string;
  name: string;
  sizeLabel: string;
  qty: number;
  unitPricePaise: number;
  linePaise: number;
  /** Max discount % snapshotted from catalog at issue time */
  maxDiscountPct: number;
};

export type StoreIssue = {
  id: string;
  issueNo: string;
  recipientKind: "student" | "staff";
  studentId: string;
  staffId: string;
  householdId: string;
  academicYearCode: string;
  /** Issue / due date YYYY-MM-DD */
  issuedOn: string;
  lines: StoreIssueLine[];
  totalPaise: number;
  saleDiscountPaise: number;
  note: string;
  createdAt: string;
  voidedAt: string | null;
  paymentMode: StorePaymentMode;
  paymentStatus: StorePaymentStatus;
  issueKind: StoreIssueKind;
  replacesIssueId: string;
  replacementReason: string;
  issuedBy: string;
  storeLocation: string;
  /** Size exchange: return old qty usable to stock */
  returnToStock: boolean;
  /** Cumulative paise credited back via sell returns (reduces Fee Take billed). */
  returnedPaise: number;
};

export type StoreSellReturnLine = {
  itemId: string;
  sku: string;
  name: string;
  sizeLabel: string;
  qty: number;
  unitPricePaise: number;
  linePaise: number;
};

/** Student / staff returns sold items to school. */
export type StoreSellReturn = {
  id: string;
  returnNo: string;
  issueId: string;
  studentId: string;
  staffId: string;
  returnedOn: string;
  lines: StoreSellReturnLine[];
  totalPaise: number;
  note: string;
  createdAt: string;
  createdBy: string;
};

export type StoreStockMovement = {
  id: string;
  itemId: string;
  at: string;
  kind: StoreStockMoveKind;
  qtyDelta: number;
  note: string;
  refIssueId: string;
  by: string;
};

/** Qty allocated from central store stock to an infra / location level. */
export type StoreInventoryAllocation = {
  id: string;
  itemId: string;
  infraLevelId: string;
  qty: number;
  note: string;
  updatedAt: string;
};

/** Fixed asset tagged and assigned to staff or location. */
export type StoreAssetAllocation = {
  id: string;
  itemId: string;
  assetTag: string;
  assignedTo: string;
  location: string;
  qty: number;
  note: string;
  updatedAt: string;
};

export type StoreState = {
  version: 1;
  categories: StoreCategoryDef[];
  saleGroups: StoreSaleGroup[];
  uoms: StoreUom[];
  infraLevels: StoreInfraLevel[];
  sources: StoreSource[];
  items: StoreItem[];
  issues: StoreIssue[];
  movements: StoreStockMovement[];
  inventoryAllocations: StoreInventoryAllocation[];
  assetAllocations: StoreAssetAllocation[];
  sellReturns: StoreSellReturn[];
};

const STORAGE_KEY = "bhb_store_v1";

let serverStoreCache: StoreState | null = null;

const DEFAULT_CATEGORY_SEEDS: { code: StoreCategoryCode; name: string }[] = [
  { code: "book", name: "Books" },
  { code: "uniform", name: "Uniform" },
  { code: "stationery", name: "Stationery" },
  { code: "other", name: "Other" },
];

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeCategory(c: Partial<StoreCategoryDef>): StoreCategoryDef {
  const name = (c.name || "").trim() || "Category";
  const code = (c.code || name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return {
    id: c.id || nid("scat"),
    name,
    code: code || nid("c"),
    isActive: c.isActive !== false,
    sortOrder: Math.max(0, Math.floor(Number(c.sortOrder) || 0)),
  };
}

function normalizeNamedMaster<
  T extends { id: string; name: string; code: string; isActive: boolean; sortOrder: number },
>(
  c: Partial<T>,
  prefix: string,
  fallbackName: string,
): T {
  const name = (c.name || "").trim() || fallbackName;
  const code = (c.code || name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return {
    id: c.id || nid(prefix),
    name,
    code: code || nid("m"),
    isActive: c.isActive !== false,
    sortOrder: Math.max(0, Math.floor(Number(c.sortOrder) || 0)),
  } as T;
}

function normalizeSaleGroup(c: Partial<StoreSaleGroup>): StoreSaleGroup {
  return normalizeNamedMaster(c, "ssg", "Sale group");
}

function normalizeUom(c: Partial<StoreUom>): StoreUom {
  return normalizeNamedMaster(c, "suom", "Unit");
}

function normalizeInfraLevel(c: Partial<StoreInfraLevel>): StoreInfraLevel {
  return normalizeNamedMaster(c, "sinf", "Infra level");
}

function normalizeSource(c: Partial<StoreSource>): StoreSource {
  const base = normalizeNamedMaster(c, "ssrc", "Source");
  return { ...base, phone: (c.phone ?? "").trim() };
}

export function defaultStoreCategories(): StoreCategoryDef[] {
  return DEFAULT_CATEGORY_SEEDS.map((s, i) =>
    normalizeCategory({
      id: `scat_${s.code}`,
      code: s.code,
      name: s.name,
      sortOrder: i + 1,
      isActive: true,
    }),
  );
}

export function defaultStoreUoms(): StoreUom[] {
  return ["Nos", "Pack", "Dozen", "Kg", "Litre", "Set"].map((name, i) =>
    normalizeUom({ id: `suom_${name.toLowerCase()}`, name, sortOrder: i + 1 }),
  );
}

export function defaultStoreInfraLevels(): StoreInfraLevel[] {
  return ["Main store", "Library", "Lab", "Mess", "Office"].map((name, i) =>
    normalizeInfraLevel({
      id: `sinf_${i + 1}`,
      name,
      sortOrder: i + 1,
    }),
  );
}

function ensureCategories(
  categories: StoreCategoryDef[],
  items: StoreItem[],
): StoreCategoryDef[] {
  let cats =
    categories.length > 0 ? categories.map(normalizeCategory) : defaultStoreCategories();
  const byId = new Map(cats.map((c) => [c.id, c]));
  const byCode = new Map(cats.map((c) => [c.code, c]));
  for (const item of items) {
    if (item.categoryId && !byId.has(item.categoryId)) {
      const code = item.categoryId.replace(/^scat_/, "");
      const fallback =
        byCode.get(code) ||
        byCode.get(item.categoryId) ||
        null;
      if (!fallback) {
        const extra = normalizeCategory({
          id: item.categoryId.startsWith("scat_")
            ? item.categoryId
            : nid("scat"),
          name: code || "Other",
          code: code || "other",
          sortOrder: cats.length + 1,
        });
        cats = [...cats, extra];
        byId.set(extra.id, extra);
      }
    }
  }
  return cats.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function resolveCategoryId(
  raw: string | undefined,
  categories: StoreCategoryDef[],
): string {
  const t = (raw || "").trim();
  if (!t) {
    return (
      categories.find((c) => c.code === "other")?.id ||
      categories[0]?.id ||
      "scat_other"
    );
  }
  const byId = categories.find((c) => c.id === t);
  if (byId) return byId.id;
  const low = t.toLowerCase();
  const byCode = categories.find(
    (c) => c.code === low || c.name.toLowerCase() === low,
  );
  if (byCode) return byCode.id;
  // legacy enum on old items
  const legacy = categories.find((c) => c.code === low);
  if (legacy) return legacy.id;
  return (
    categories.find((c) => c.code === "other")?.id ||
    categories[0]?.id ||
    "scat_other"
  );
}

export function seedStoreCatalog(categories?: StoreCategoryDef[]): StoreItem[] {
  const cats = categories?.length ? categories : defaultStoreCategories();
  const idOf = (code: string) =>
    cats.find((c) => c.code === code)?.id || cats[0]!.id;
  return [
    normalizeItem({
      sku: "BK-ENG-6",
      name: "English Coursebook Class 6",
      categoryId: idOf("book"),
      purchasePricePaise: 28000,
      salePricePaise: 38500,
      stockOnHand: 80,
      openingQty: 80,
      reorderLevel: 10,
      issuePolicy: "once_per_ay",
      maxDiscountPct: 5,
      audience: "student",
    }),
    normalizeItem({
      sku: "BK-MATH-6",
      name: "Mathematics Class 6",
      categoryId: idOf("book"),
      purchasePricePaise: 31000,
      salePricePaise: 42000,
      stockOnHand: 80,
      openingQty: 80,
      reorderLevel: 10,
      issuePolicy: "once_per_ay",
      maxDiscountPct: 5,
      audience: "student",
    }),
    normalizeItem({
      sku: "UN-SHIRT",
      name: "Uniform shirt",
      categoryId: idOf("uniform"),
      sizeLabel: "32",
      purchasePricePaise: 32000,
      salePricePaise: 45000,
      stockOnHand: 60,
      openingQty: 60,
      reorderLevel: 8,
      issuePolicy: "once_per_ay",
      maxDiscountPct: 0,
      audience: "student",
    }),
    normalizeItem({
      sku: "UN-TROUSER",
      name: "Uniform trouser",
      categoryId: idOf("uniform"),
      sizeLabel: "28",
      purchasePricePaise: 38000,
      salePricePaise: 55000,
      stockOnHand: 50,
      openingQty: 50,
      reorderLevel: 8,
      issuePolicy: "once_per_ay",
      maxDiscountPct: 0,
      audience: "student",
    }),
    normalizeItem({
      sku: "ST-NOTE-96",
      name: "Notebook 96 pages",
      categoryId: idOf("stationery"),
      purchasePricePaise: 2500,
      salePricePaise: 4500,
      stockOnHand: 200,
      openingQty: 200,
      reorderLevel: 40,
      issuePolicy: "unlimited",
      maxDiscountPct: 10,
      audience: "both",
    }),
  ];
}

function normalizeAudience(a: unknown): StoreAudience {
  if (a === "staff" || a === "student" || a === "both") return a;
  return "student";
}

function normalizeItem(
  i: Partial<StoreItem> & { category?: string },
  categories?: StoreCategoryDef[],
): StoreItem {
  const cats = categories?.length ? categories : defaultStoreCategories();
  const opening = Math.max(0, Math.floor(Number(i.openingQty) || 0));
  const stockRaw = i.stockOnHand;
  const stockOnHand =
    stockRaw != null && Number.isFinite(Number(stockRaw))
      ? Math.max(0, Math.floor(Number(stockRaw)))
      : opening;
  const categoryId = resolveCategoryId(
    i.categoryId || i.category,
    cats,
  );
  const catCode = cats.find((c) => c.id === categoryId)?.code || "";
  const policy = (i.issuePolicy ||
    (catCode === "stationery" ? "unlimited" : "once_per_ay")) as StoreIssuePolicy;
  const sale =
    i.salePricePaise != null
      ? Math.max(0, Math.round(Number(i.salePricePaise) || 0))
      : Math.max(0, Math.round(Number(i.unitPricePaise) || 0));
  const purchase = Math.max(
    0,
    Math.round(
      Number(
        i.purchasePricePaise != null ? i.purchasePricePaise : Math.round(sale * 0.7),
      ) || 0,
    ),
  );
  const maxDiscountPct = Math.min(
    100,
    Math.max(0, Math.round(Number(i.maxDiscountPct) || 0)),
  );
  const applicableClassIds = Array.isArray(i.applicableClassIds)
    ? i.applicableClassIds.map(String).filter(Boolean)
    : [];
  return {
    id: i.id ?? nid("si"),
    sku: (i.sku ?? "").trim().toUpperCase() || "SKU",
    name: (i.name ?? "Item").trim() || "Item",
    categoryId,
    saleGroupId: (i.saleGroupId ?? "").trim(),
    uomId: (i.uomId ?? "").trim(),
    sourceId: (i.sourceId ?? "").trim(),
    infraLevelId: (i.infraLevelId ?? "").trim(),
    sizeLabel: i.sizeLabel ?? "",
    purchasePricePaise: purchase,
    salePricePaise: sale,
    unitPricePaise: sale,
    maxDiscountPct,
    audience: normalizeAudience(i.audience),
    applicableClassIds,
    isActive: i.isActive !== false,
    stockOnHand,
    reorderLevel: Math.max(0, Math.floor(Number(i.reorderLevel) || 0)),
    openingQty: opening,
    issuePolicy: [
      "once_per_ay",
      "once_ever",
      "unlimited",
      "max_qty_per_ay",
    ].includes(policy)
      ? policy
      : "once_per_ay",
    maxQtyPerAy: Math.max(1, Math.floor(Number(i.maxQtyPerAy) || 1)),
    barcode: (i.barcode ?? "").trim(),
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
          Math.max(0, l.unitPricePaise ?? 0) *
            Math.max(1, Math.floor(l.qty ?? 1)),
        maxDiscountPct: Math.min(
          100,
          Math.max(0, Math.round(Number(l.maxDiscountPct) || 0)),
        ),
      }))
    : [];
  const discount = Math.max(0, Math.round(Number(iss.saleDiscountPaise) || 0));
  const linesTotal = lines.reduce((s, l) => s + l.linePaise, 0);
  const total =
    iss.totalPaise != null
      ? Math.max(0, Math.round(Number(iss.totalPaise)))
      : Math.max(0, linesTotal - discount);
  const voided = iss.voidedAt ?? null;
  const paymentMode: StorePaymentMode =
    iss.paymentMode === "cash" ? "cash" : "credit";
  let paymentStatus: StorePaymentStatus =
    iss.paymentStatus === "paid" ||
    iss.paymentStatus === "due" ||
    iss.paymentStatus === "void"
      ? iss.paymentStatus
      : paymentMode === "cash"
        ? "paid"
        : "due";
  if (voided) paymentStatus = "void";
  const issueKind = (iss.issueKind || "first") as StoreIssueKind;
  const recipientKind: "student" | "staff" =
    iss.recipientKind === "staff" || (!!iss.staffId && !iss.studentId)
      ? "staff"
      : "student";
  return {
    id: iss.id ?? nid("iss"),
    issueNo: iss.issueNo ?? "",
    recipientKind,
    studentId: iss.studentId ?? "",
    staffId: iss.staffId ?? "",
    householdId: iss.householdId ?? "",
    academicYearCode: iss.academicYearCode ?? DEFAULT_AY,
    issuedOn: iss.issuedOn ?? new Date().toISOString().slice(0, 10),
    lines,
    totalPaise: total,
    saleDiscountPaise: discount,
    note: iss.note ?? "",
    createdAt: iss.createdAt ?? nowIso(),
    voidedAt: voided,
    paymentMode,
    paymentStatus,
    issueKind: [
      "first",
      "replacement_lost",
      "replacement_damaged",
      "size_exchange",
      "extra_optional",
    ].includes(issueKind)
      ? issueKind
      : "first",
    replacesIssueId: iss.replacesIssueId ?? "",
    replacementReason: iss.replacementReason ?? "",
    issuedBy: iss.issuedBy ?? "",
    storeLocation: iss.storeLocation || "main",
    returnToStock: !!iss.returnToStock,
    returnedPaise: Math.max(0, Math.round(Number(iss.returnedPaise) || 0)),
  };
}

function normalizeMovement(
  m: Partial<StoreStockMovement>,
): StoreStockMovement {
  return {
    id: m.id ?? nid("smv"),
    itemId: m.itemId ?? "",
    at: m.at ?? nowIso(),
    kind: (m.kind || "adjust") as StoreStockMoveKind,
    qtyDelta: Math.round(Number(m.qtyDelta) || 0),
    note: m.note ?? "",
    refIssueId: m.refIssueId ?? "",
    by: m.by ?? "",
  };
}

function normalizeInventoryAllocation(
  a: Partial<StoreInventoryAllocation>,
): StoreInventoryAllocation {
  return {
    id: a.id ?? nid("sia"),
    itemId: a.itemId ?? "",
    infraLevelId: a.infraLevelId ?? "",
    qty: Math.max(0, Math.floor(Number(a.qty) || 0)),
    note: a.note ?? "",
    updatedAt: a.updatedAt ?? nowIso(),
  };
}

function normalizeAssetAllocation(
  a: Partial<StoreAssetAllocation>,
): StoreAssetAllocation {
  return {
    id: a.id ?? nid("saa"),
    itemId: a.itemId ?? "",
    assetTag: a.assetTag ?? "",
    assignedTo: a.assignedTo ?? "",
    location: a.location ?? "",
    qty: Math.max(1, Math.floor(Number(a.qty) || 1)),
    note: a.note ?? "",
    updatedAt: a.updatedAt ?? nowIso(),
  };
}

function normalizeSellReturn(r: Partial<StoreSellReturn>): StoreSellReturn {
  const lines = Array.isArray(r.lines)
    ? r.lines.map((l) => ({
        itemId: l.itemId ?? "",
        sku: l.sku ?? "",
        name: l.name ?? "",
        sizeLabel: l.sizeLabel ?? "",
        qty: Math.max(1, Math.floor(Number(l.qty) || 1)),
        unitPricePaise: Math.max(0, Math.round(Number(l.unitPricePaise) || 0)),
        linePaise: Math.max(0, Math.round(Number(l.linePaise) || 0)),
      }))
    : [];
  const total =
    r.totalPaise != null
      ? Math.max(0, Math.round(Number(r.totalPaise)))
      : lines.reduce((s, l) => s + l.linePaise, 0);
  return {
    id: r.id ?? nid("sret"),
    returnNo: r.returnNo ?? "",
    issueId: r.issueId ?? "",
    studentId: r.studentId ?? "",
    staffId: r.staffId ?? "",
    returnedOn: r.returnedOn ?? nowIso().slice(0, 10),
    lines,
    totalPaise: total,
    note: r.note ?? "",
    createdAt: r.createdAt ?? nowIso(),
    createdBy: r.createdBy ?? "",
  };
}

function emptyStore(): StoreState {
  return {
    version: 1,
    categories: defaultStoreCategories(),
    saleGroups: [],
    uoms: defaultStoreUoms(),
    infraLevels: defaultStoreInfraLevels(),
    sources: [],
    items: [],
    issues: [],
    movements: [],
    inventoryAllocations: [],
    assetAllocations: [],
    sellReturns: [],
  };
}

export function loadStore(): StoreState {
  if (typeof window === "undefined") {
    if (serverStoreCache) return serverStoreCache;
    return emptyStore();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as StoreState & {
      items?: Array<Partial<StoreItem> & { category?: string }>;
    };
    const rawCats = Array.isArray(parsed.categories)
      ? parsed.categories.map(normalizeCategory)
      : [];
    // First pass items with temp categories for migration
    const tempCats =
      rawCats.length > 0 ? rawCats : defaultStoreCategories();
    const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
    const items = itemsRaw.map((i) => normalizeItem(i, tempCats));
    const categories = ensureCategories(tempCats, items);
    const saleGroups = Array.isArray(parsed.saleGroups)
      ? parsed.saleGroups.map(normalizeSaleGroup)
      : [];
    const uoms = Array.isArray(parsed.uoms) && parsed.uoms.length
      ? parsed.uoms.map(normalizeUom)
      : defaultStoreUoms();
    const infraLevels =
      Array.isArray(parsed.infraLevels) && parsed.infraLevels.length
        ? parsed.infraLevels.map(normalizeInfraLevel)
        : defaultStoreInfraLevels();
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.map(normalizeSource)
      : [];
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(normalizeIssue)
      : [];
    const movements = Array.isArray(parsed.movements)
      ? parsed.movements.map(normalizeMovement)
      : [];
    const inventoryAllocations = Array.isArray(parsed.inventoryAllocations)
      ? parsed.inventoryAllocations.map(normalizeInventoryAllocation)
      : [];
    const assetAllocations = Array.isArray(parsed.assetAllocations)
      ? parsed.assetAllocations.map(normalizeAssetAllocation)
      : [];
    const sellReturns = Array.isArray(
      (parsed as StoreState).sellReturns,
    )
      ? (parsed as StoreState).sellReturns.map(normalizeSellReturn)
      : [];
    return {
      version: 1,
      categories,
      saleGroups,
      uoms,
      infraLevels,
      sources,
      items: items.map((i) => normalizeItem(i, categories)),
      issues,
      movements,
      inventoryAllocations,
      assetAllocations,
      sellReturns,
    };
  } catch {
    return emptyStore();
  }
}

export function saveStore(state: StoreState) {
  if (!assertModulePermission("store", "edit", "saveStore")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/storePersistence").then(({ scheduleStoreSync }) => {
    scheduleStoreSync(state);
  });
}

export function writeStoreLocalRaw(state: StoreState) {
  if (typeof window === "undefined") {
    serverStoreCache = state;
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function storeStateIsEmpty(state: StoreState): boolean {
  return (
    (state.items?.length ?? 0) === 0 &&
    (state.issues?.length ?? 0) === 0 &&
    (state.movements?.length ?? 0) === 0
  );
}

export function listActiveStoreCategories(store?: StoreState): StoreCategoryDef[] {
  const s = store ?? loadStore();
  return s.categories
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function categoryLabel(
  categoryIdOrCode: string,
  store?: StoreState,
): string {
  const s = store ?? loadStore();
  const hit =
    s.categories.find((c) => c.id === categoryIdOrCode) ||
    s.categories.find((c) => c.code === categoryIdOrCode) ||
    s.categories.find(
      (c) => c.name.toLowerCase() === categoryIdOrCode.toLowerCase(),
    );
  if (hit) return hit.name;
  // legacy
  switch (categoryIdOrCode) {
    case "book":
      return "Books";
    case "uniform":
      return "Uniform";
    case "stationery":
      return "Stationery";
    default:
      return categoryIdOrCode || "Other";
  }
}

export function infraLevelLabel(
  infraLevelId: string,
  store?: StoreState,
): string {
  const s = store ?? loadStore();
  const hit = s.infraLevels.find((l) => l.id === infraLevelId);
  return hit?.name || infraLevelId || "—";
}

export function upsertStoreCategory(input: {
  id?: string;
  name: string;
  code?: string;
  isActive?: boolean;
  sortOrder?: number;
}):
  | { ok: true; state: StoreState; category: StoreCategoryDef }
  | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Category name is required" };
  const store = loadStore();
  const existing = input.id
    ? store.categories.find((c) => c.id === input.id)
    : store.categories.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );
  if (existing && input.id && existing.id !== input.id) {
    /* fallthrough */
  }
  if (existing) {
    const next = normalizeCategory({
      ...existing,
      name,
      code: input.code ?? existing.code,
      isActive: input.isActive ?? existing.isActive,
      sortOrder: input.sortOrder ?? existing.sortOrder,
    });
    const dupName = store.categories.find(
      (c) =>
        c.id !== existing.id &&
        c.name.toLowerCase() === next.name.toLowerCase(),
    );
    if (dupName) return { ok: false, error: "Category name already exists" };
    const state = {
      ...store,
      categories: store.categories.map((c) =>
        c.id === existing.id ? next : c,
      ),
    };
    saveStore(state);
    return { ok: true, state, category: next };
  }
  const sortOrder =
    input.sortOrder ??
    (store.categories.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1);
  const category = normalizeCategory({
    id: nid("scat"),
    name,
    code: input.code,
    sortOrder,
    isActive: input.isActive !== false,
  });
  const dup = store.categories.find(
    (c) => c.name.toLowerCase() === category.name.toLowerCase(),
  );
  if (dup) return { ok: false, error: "Category name already exists" };
  const state = {
    ...store,
    categories: [...store.categories, category],
  };
  saveStore(state);
  return { ok: true, state, category };
}

export function deactivateStoreCategory(categoryId: string): boolean {
  const store = loadStore();
  if (!store.categories.some((c) => c.id === categoryId)) return false;
  const inUse = store.items.some(
    (i) => i.categoryId === categoryId && i.isActive,
  );
  if (inUse) {
    // soft-deactivate anyway; items keep the id
  }
  saveStore({
    ...store,
    categories: store.categories.map((c) =>
      c.id === categoryId ? { ...c, isActive: false } : c,
    ),
  });
  return true;
}

function upsertSimpleMaster<
  T extends { id: string; name: string; code: string; isActive: boolean; sortOrder: number },
>(
  store: StoreState,
  key: "saleGroups" | "uoms" | "infraLevels" | "sources",
  input: { id?: string; name: string; code?: string; isActive?: boolean; sortOrder?: number },
  normalize: (c: Partial<T>) => T,
  prefix: string,
  fallback: string,
):
  | { ok: true; state: StoreState; row: T }
  | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required" };
  const list = store[key] as T[];
  const existing = input.id
    ? list.find((c) => c.id === input.id)
    : list.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    const next = normalize({
      ...existing,
      ...input,
      name,
      id: existing.id,
    });
    const state = {
      ...store,
      [key]: list.map((c) => (c.id === existing.id ? next : c)),
    } as StoreState;
    saveStore(state);
    return { ok: true, state, row: next };
  }
  const sortOrder =
    input.sortOrder ?? list.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1;
  const row = normalize({
    id: nid(prefix),
    name,
    code: input.code,
    sortOrder,
    isActive: input.isActive !== false,
  } as Partial<T>);
  const dup = list.find((c) => c.name.toLowerCase() === row.name.toLowerCase());
  if (dup) return { ok: false, error: "Name already exists" };
  const state = { ...store, [key]: [...list, row] } as StoreState;
  saveStore(state);
  return { ok: true, state, row };
}

export function upsertStoreSaleGroup(input: {
  id?: string;
  name: string;
  code?: string;
  isActive?: boolean;
  sortOrder?: number;
}) {
  return upsertSimpleMaster(
    loadStore(),
    "saleGroups",
    input,
    normalizeSaleGroup,
    "ssg",
    "Sale group",
  );
}

export function upsertStoreUom(input: {
  id?: string;
  name: string;
  code?: string;
  isActive?: boolean;
  sortOrder?: number;
}) {
  return upsertSimpleMaster(
    loadStore(),
    "uoms",
    input,
    normalizeUom,
    "suom",
    "Unit",
  );
}

export function upsertStoreInfraLevel(input: {
  id?: string;
  name: string;
  code?: string;
  isActive?: boolean;
  sortOrder?: number;
}) {
  return upsertSimpleMaster(
    loadStore(),
    "infraLevels",
    input,
    normalizeInfraLevel,
    "sinf",
    "Infra level",
  );
}

export function upsertStoreSource(input: {
  id?: string;
  name: string;
  code?: string;
  phone?: string;
  isActive?: boolean;
  sortOrder?: number;
}) {
  const store = loadStore();
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name is required" };
  const existing = input.id
    ? store.sources.find((c) => c.id === input.id)
    : store.sources.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    const next = normalizeSource({ ...existing, ...input, name, id: existing.id });
    const state = {
      ...store,
      sources: store.sources.map((c) => (c.id === existing.id ? next : c)),
    };
    saveStore(state);
    return { ok: true as const, state, row: next };
  }
  const sortOrder =
    input.sortOrder ??
    store.sources.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1;
  const row = normalizeSource({
    id: nid("ssrc"),
    name,
    code: input.code,
    phone: input.phone,
    sortOrder,
    isActive: input.isActive !== false,
  });
  const state = { ...store, sources: [...store.sources, row] };
  saveStore(state);
  return { ok: true as const, state, row };
}

export function masterLabel(
  list: Array<{ id: string; name: string }>,
  id: string,
): string {
  if (!id) return "—";
  return list.find((x) => x.id === id)?.name ?? "—";
}

export function bulkSetOpeningStock(
  updates: Array<{ itemId: string; openingQty: number }>,
  by = "Stock Master",
): { ok: true; updated: number } | { ok: false; error: string } {
  if (!updates.length) return { ok: false, error: "No rows to update" };
  let store = loadStore();
  let updated = 0;
  for (const row of updates) {
    const item = store.items.find((i) => i.id === row.itemId);
    if (!item) continue;
    const openingQty = Math.max(0, Math.floor(Number(row.openingQty) || 0));
    const delta = openingQty - item.openingQty;
    if (!delta && item.stockOnHand === openingQty) continue;
    const r = upsertStoreItem({
      id: item.id,
      sku: item.sku,
      name: item.name,
      categoryId: item.categoryId,
      openingQty,
      stockOnHand: openingQty,
    });
    if (r.ok) {
      updated += 1;
      store = r.state;
      if (delta) {
        store = {
          ...store,
          movements: [
            normalizeMovement({
              itemId: item.id,
              kind: "opening",
              qtyDelta: delta,
              note: "Set opening stock",
              by,
            }),
            ...store.movements,
          ],
        };
        saveStore(store);
      }
    }
  }
  if (!updated) return { ok: false, error: "Nothing changed" };
  return { ok: true, updated };
}

export function bulkSetSalePrice(
  updates: Array<{ itemId: string; salePricePaise: number }>,
): { ok: true; updated: number } | { ok: false; error: string } {
  if (!updates.length) return { ok: false, error: "No rows to update" };
  let updated = 0;
  for (const row of updates) {
    const store = loadStore();
    const item = store.items.find((i) => i.id === row.itemId);
    if (!item) continue;
    const salePricePaise = Math.max(
      0,
      Math.round(Number(row.salePricePaise) || 0),
    );
    if (salePricePaise === item.salePricePaise) continue;
    const r = upsertStoreItem({
      id: item.id,
      sku: item.sku,
      name: item.name,
      categoryId: item.categoryId,
      salePricePaise,
      unitPricePaise: salePricePaise,
    });
    if (r.ok) updated += 1;
  }
  if (!updated) return { ok: false, error: "Nothing changed" };
  return { ok: true, updated };
}

/** Max discount paise allowed for a set of lines (from catalog maxDiscountPct). */
export function maxAllowedDiscountPaise(
  lines: { linePaise: number; maxDiscountPct: number }[],
): number {
  return lines.reduce(
    (s, l) =>
      s + Math.floor((l.linePaise * Math.min(100, Math.max(0, l.maxDiscountPct))) / 100),
    0,
  );
}

/** Whether item can be sold to this audience / class. */
export function itemAppliesToRecipient(
  item: StoreItem,
  opts: { audience: "student" | "staff"; classId?: string },
): boolean {
  if (opts.audience === "student") {
    if (item.audience === "staff") return false;
    if (
      item.applicableClassIds.length > 0 &&
      opts.classId &&
      !item.applicableClassIds.includes(opts.classId)
    ) {
      return false;
    }
    if (item.applicableClassIds.length > 0 && !opts.classId) return false;
    return true;
  }
  // staff
  return item.audience === "staff" || item.audience === "both";
}

export function listActiveStoreItems(store?: StoreState): StoreItem[] {
  const s = store ?? loadStore();
  return s.items.filter((i) => i.isActive);
}

export function listLowStockItems(store?: StoreState): StoreItem[] {
  const s = store ?? loadStore();
  return s.items
    .filter((i) => i.isActive && i.reorderLevel > 0 && i.stockOnHand <= i.reorderLevel)
    .sort((a, b) => a.stockOnHand - b.stockOnHand);
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

/** Whether a credit issue should appear as a Fee Take due. */
export function isStoreIssueDueOnFeeTake(iss: StoreIssue): boolean {
  if (iss.voidedAt || iss.paymentStatus === "void") return false;
  if (iss.recipientKind === "staff" || !iss.studentId) return false;
  if (iss.paymentMode === "cash" || iss.paymentStatus === "paid") return false;
  return iss.paymentStatus === "due";
}

export type PriorIssueHit = {
  issue: StoreIssue;
  line: StoreIssueLine;
  qtyIssued: number;
};

/** Qty already issued to recipient for SKU. */
export function qtyIssuedForStudentItem(
  store: StoreState,
  studentId: string,
  itemId: string,
  opts?: { academicYearCode?: string; onceEver?: boolean; staffId?: string },
): { qty: number; hits: PriorIssueHit[] } {
  const hits: PriorIssueHit[] = [];
  let qty = 0;
  for (const iss of store.issues) {
    if (iss.voidedAt) continue;
    if (opts?.staffId) {
      if (iss.staffId !== opts.staffId) continue;
    } else if (iss.studentId !== studentId) {
      continue;
    }
    if (
      !opts?.onceEver &&
      opts?.academicYearCode &&
      iss.academicYearCode !== opts.academicYearCode
    ) {
      continue;
    }
    for (const line of iss.lines) {
      if (line.itemId !== itemId) continue;
      qty += line.qty;
      hits.push({ issue: iss, line, qtyIssued: line.qty });
    }
  }
  return { qty, hits };
}

export function checkItemIssuePolicy(
  store: StoreState,
  studentId: string,
  item: StoreItem,
  qty: number,
  academicYearCode: string,
  issueKind: StoreIssueKind,
  staffId?: string,
): { ok: true } | { ok: false; error: string; prior?: PriorIssueHit } {
  // Replacements and size exchange bypass once_* block
  if (
    issueKind === "replacement_lost" ||
    issueKind === "replacement_damaged" ||
    issueKind === "size_exchange"
  ) {
    return { ok: true };
  }
  if (issueKind === "extra_optional" || item.issuePolicy === "unlimited") {
    return { ok: true };
  }

  const keyOpts = staffId
    ? { staffId, academicYearCode }
    : { academicYearCode };

  if (item.issuePolicy === "once_ever") {
    const { qty: prior, hits } = qtyIssuedForStudentItem(
      store,
      studentId,
      item.id,
      { onceEver: true, staffId },
    );
    if (prior > 0) {
      return {
        ok: false,
        error: `Already issued ${hits[0]?.issue.issueNo || ""} — policy once ever.`,
        prior: hits[0],
      };
    }
  }

  if (item.issuePolicy === "once_per_ay") {
    const { qty: prior, hits } = qtyIssuedForStudentItem(
      store,
      studentId,
      item.id,
      keyOpts,
    );
    if (prior > 0) {
      return {
        ok: false,
        error: `Already issued ${hits[0]?.issue.issuedOn || ""} ${hits[0]?.issue.issueNo || ""} — cannot sell again this year. Use Replacement if lost.`,
        prior: hits[0],
      };
    }
  }

  if (item.issuePolicy === "max_qty_per_ay") {
    const { qty: prior, hits } = qtyIssuedForStudentItem(
      store,
      studentId,
      item.id,
      keyOpts,
    );
    if (prior + qty > item.maxQtyPerAy) {
      return {
        ok: false,
        error: `Max ${item.maxQtyPerAy} per year — already issued ${prior}.`,
        prior: hits[0],
      };
    }
  }

  return { ok: true };
}

function bumpStock(
  items: StoreItem[],
  itemId: string,
  delta: number,
): StoreItem[] {
  return items.map((i) =>
    i.id === itemId
      ? { ...i, stockOnHand: Math.max(0, i.stockOnHand + delta) }
      : i,
  );
}

export function upsertStoreItem(
  patch: Partial<StoreItem> & { name: string; sku: string },
):
  | { ok: true; state: StoreState; item: StoreItem }
  | { ok: false; error: string } {
  const store = loadStore();
  const sku = patch.sku.trim().toUpperCase();
  if (!sku || !patch.name.trim()) {
    return { ok: false, error: "SKU and name are required" };
  }
  if (!patch.categoryId && !(patch as { category?: string }).category) {
    return { ok: false, error: "Category is required" };
  }
  const existing = patch.id
    ? store.items.find((i) => i.id === patch.id)
    : store.items.find((i) => i.sku === sku);
  if (existing) {
    const dup = store.items.find(
      (i) => i.sku === sku && i.id !== existing.id,
    );
    if (dup) return { ok: false, error: "SKU already used by another item" };
    const wasOpening = existing.openingQty;
    const next = normalizeItem(
      {
        ...existing,
        ...patch,
        id: existing.id,
        sku,
      },
      store.categories,
    );
    let movements = store.movements;
    let items = store.items.map((i) => (i.id === existing.id ? next : i));
    if (next.openingQty !== wasOpening && existing.stockOnHand === wasOpening) {
      const delta = next.openingQty - wasOpening;
      items = bumpStock(
        items.map((i) =>
          i.id === existing.id ? { ...i, stockOnHand: wasOpening } : i,
        ),
        existing.id,
        delta,
      );
      const bumped = items.find((i) => i.id === existing.id)!;
      items = items.map((i) =>
        i.id === existing.id
          ? { ...next, stockOnHand: bumped.stockOnHand }
          : i,
      );
      movements = [
        normalizeMovement({
          itemId: existing.id,
          kind: "opening",
          qtyDelta: delta,
          note: "Opening qty update",
          by: patch.name,
        }),
        ...movements,
      ];
    }
    const state = { ...store, items, movements };
    saveStore(state);
    return {
      ok: true,
      state,
      item: items.find((i) => i.id === existing.id)!,
    };
  }
  const item = normalizeItem(
    {
      ...patch,
      id: nid("si"),
      sku,
      stockOnHand:
        patch.stockOnHand != null
          ? patch.stockOnHand
          : patch.openingQty != null
            ? patch.openingQty
            : 0,
    },
    store.categories,
  );
  const movements =
    item.openingQty > 0
      ? [
          normalizeMovement({
            itemId: item.id,
            kind: "opening",
            qtyDelta: item.openingQty,
            note: "Opening stock",
            by: "",
          }),
          ...store.movements,
        ]
      : store.movements;
  const state = {
    ...store,
    items: [item, ...store.items],
    movements,
  };
  saveStore(state);
  return { ok: true, state, item };
}

export function deactivateStoreItem(itemId: string): boolean {
  const store = loadStore();
  if (!store.items.some((i) => i.id === itemId)) return false;
  saveStore({
    ...store,
    items: store.items.map((i) =>
      i.id === itemId ? { ...i, isActive: false } : i,
    ),
  });
  return true;
}

export function adjustStock(input: {
  itemId: string;
  qtyDelta: number;
  kind?: Extract<
    StoreStockMoveKind,
    | "purchase_in"
    | "purchase_return_out"
    | "adjust"
    | "opening"
    | "production"
    | "consumption"
    | "sell_return_in"
  >;
  note?: string;
  by?: string;
  refIssueId?: string;
}):
  | { ok: true; state: StoreState; item: StoreItem }
  | { ok: false; error: string } {
  const store = loadStore();
  const item = store.items.find((i) => i.id === input.itemId);
  if (!item) return { ok: false, error: "Item not found" };
  const delta = Math.round(Number(input.qtyDelta) || 0);
  if (!delta) return { ok: false, error: "Enter a non-zero quantity" };
  if (item.stockOnHand + delta < 0) {
    return { ok: false, error: "Stock cannot go below zero" };
  }
  const kind =
    input.kind ||
    (delta > 0 ? "purchase_in" : "adjust");
  const items = bumpStock(store.items, item.id, delta);
  const next = items.find((i) => i.id === item.id)!;
  const state: StoreState = {
    ...store,
    items,
    movements: [
      normalizeMovement({
        itemId: item.id,
        kind,
        qtyDelta: delta,
        note: input.note?.trim() || "",
        by: input.by || "",
        refIssueId: input.refIssueId || "",
      }),
      ...store.movements,
    ],
  };
  saveStore(state);
  return { ok: true, state, item: next };
}

export function seedStoreIfEmpty(): StoreState {
  const store = loadStore();
  if (store.items.length > 0) return store;
  const categories =
    store.categories.length > 0 ? store.categories : defaultStoreCategories();
  const items = seedStoreCatalog(categories);
  const movements = items
    .filter((i) => i.openingQty > 0)
    .map((i) =>
      normalizeMovement({
        itemId: i.id,
        kind: "opening",
        qtyDelta: i.openingQty,
        note: "Seed catalog",
        by: "system",
      }),
    );
  const state = {
    ...store,
    categories,
    saleGroups: store.saleGroups.length ? store.saleGroups : [],
    uoms: store.uoms.length ? store.uoms : defaultStoreUoms(),
    infraLevels: store.infraLevels.length ? store.infraLevels : defaultStoreInfraLevels(),
    sources: store.sources,
    items,
    movements,
  };
  saveStore(state);
  return state;
}

export function createStoreIssue(input: {
  recipientKind?: "student" | "staff";
  studentId?: string;
  householdId?: string;
  staffId?: string;
  classId?: string;
  issuedOn: string;
  lines: {
    itemId: string;
    qty: number;
    /** Override catalog sale price (paise); optional */
    unitPricePaise?: number;
    sizeLabel?: string;
  }[];
  note?: string;
  academicYearCode?: string;
  paymentMode?: StorePaymentMode;
  saleDiscountPaise?: number;
  issueKind?: StoreIssueKind;
  replacesIssueId?: string;
  replacementReason?: string;
  issuedBy?: string;
  storeLocation?: string;
  returnToStock?: boolean;
  returnLines?: { itemId: string; qty: number }[];
  skipHoldCheck?: boolean;
}):
  | { ok: true; issue: StoreIssue; state: StoreState }
  | { ok: false; error: string; prior?: PriorIssueHit } {
  const store = loadStore();
  const recipientKind =
    input.recipientKind || (input.staffId && !input.studentId ? "staff" : "student");

  if (recipientKind === "student") {
    if (!input.studentId || !input.householdId) {
      return { ok: false, error: "Student is required" };
    }
  } else if (!input.staffId) {
    return { ok: false, error: "Staff is required" };
  }

  if (!input.issuedOn) {
    return { ok: false, error: "Issue date is required" };
  }
  if (!input.lines.length) {
    return { ok: false, error: "Add at least one item" };
  }

  const paymentMode: StorePaymentMode =
    input.paymentMode === "cash" ? "cash" : "credit";
  const issueKind: StoreIssueKind = input.issueKind || "first";
  const ay = input.academicYearCode ?? DEFAULT_AY;
  const studentId = input.studentId || "";
  const staffId = input.staffId || "";

  if (
    recipientKind === "student" &&
    paymentMode === "credit" &&
    !input.skipHoldCheck
  ) {
    const hold = checkHold(studentId, "HOLD_STORE_CREDIT");
    if (!hold.allowed) {
      return { ok: false, error: hold.message };
    }
  }

  const lines: StoreIssueLine[] = [];
  for (const row of input.lines) {
    const item = store.items.find((i) => i.id === row.itemId && i.isActive);
    if (!item) {
      return { ok: false, error: "Unknown or inactive catalog item" };
    }
    if (
      !itemAppliesToRecipient(item, {
        audience: recipientKind,
        classId: input.classId,
      })
    ) {
      return {
        ok: false,
        error: `${item.name}: not applicable for this ${recipientKind}${
          recipientKind === "student" ? " / class" : ""
        }`,
      };
    }
    const qty = Math.max(1, Math.floor(row.qty));
    const policy = checkItemIssuePolicy(
      store,
      studentId,
      item,
      qty,
      ay,
      issueKind,
      recipientKind === "staff" ? staffId : undefined,
    );
    if (!policy.ok) {
      return { ok: false, error: policy.error, prior: policy.prior };
    }
    if (item.stockOnHand < qty) {
      return {
        ok: false,
        error: `${item.name}: only ${item.stockOnHand} in stock`,
      };
    }
    const unit = row.unitPricePaise ?? item.salePricePaise;
    if (unit < 0) {
      return { ok: false, error: `${item.name}: invalid price` };
    }
    lines.push({
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      sizeLabel: (row.sizeLabel ?? item.sizeLabel).trim(),
      qty,
      unitPricePaise: unit,
      linePaise: unit * qty,
      maxDiscountPct: item.maxDiscountPct,
    });
  }

  if (
    (issueKind === "replacement_lost" ||
      issueKind === "replacement_damaged" ||
      issueKind === "size_exchange") &&
    !input.replacesIssueId
  ) {
    return { ok: false, error: "Link the original issue for replacement" };
  }

  const discount = Math.max(0, Math.round(Number(input.saleDiscountPaise) || 0));
  const linesTotal = lines.reduce((s, l) => s + l.linePaise, 0);
  if (discount > linesTotal) {
    return { ok: false, error: "Discount cannot exceed line total" };
  }
  const maxDisc = maxAllowedDiscountPaise(lines);
  if (discount > maxDisc) {
    return {
      ok: false,
      error: `Discount locked — max allowed is ₹${(maxDisc / 100).toFixed(0)} for these items`,
    };
  }
  const totalPaise = linesTotal - discount;

  const issue = normalizeIssue({
    id: nid("iss"),
    issueNo: nextStoreIssueNo(store, ay),
    recipientKind,
    studentId,
    staffId,
    householdId: input.householdId || "",
    academicYearCode: ay,
    issuedOn: input.issuedOn,
    lines,
    totalPaise,
    saleDiscountPaise: discount,
    note: input.note?.trim() ?? "",
    createdAt: nowIso(),
    voidedAt: null,
    paymentMode,
    paymentStatus: paymentMode === "cash" ? "paid" : "due",
    issueKind,
    replacesIssueId: input.replacesIssueId || "",
    replacementReason: input.replacementReason || "",
    issuedBy: input.issuedBy || "",
    storeLocation: input.storeLocation || "main",
    returnToStock: !!input.returnToStock,
    returnedPaise: 0,
  });

  let items = store.items;
  const movements: StoreStockMovement[] = [];

  for (const line of lines) {
    items = bumpStock(items, line.itemId, -line.qty);
    movements.push(
      normalizeMovement({
        itemId: line.itemId,
        kind: "issue_out",
        qtyDelta: -line.qty,
        note: `${issue.issueNo} · ${issueKind}`,
        refIssueId: issue.id,
        by: input.issuedBy || "",
      }),
    );
  }

  if (issueKind === "size_exchange" && input.returnToStock && input.returnLines) {
    for (const ret of input.returnLines) {
      const q = Math.max(0, Math.floor(ret.qty));
      if (!q) continue;
      items = bumpStock(items, ret.itemId, q);
      movements.push(
        normalizeMovement({
          itemId: ret.itemId,
          kind: "exchange_in",
          qtyDelta: q,
          note: `Size exchange return · ${issue.issueNo}`,
          refIssueId: issue.id,
          by: input.issuedBy || "",
        }),
      );
    }
  }

  const state: StoreState = {
    ...store,
    items,
    issues: [issue, ...store.issues],
    movements: [...movements, ...store.movements],
  };
  saveStore(state);

  // Post to Accounts (cashbook / daybook / BS) — non-blocking if accounts unavailable
  void import("@/lib/accounts")
    .then((m) => {
      m.postStoreSaleToAccounts({
        issueId: issue.id,
        issueNo: issue.issueNo,
        issuedOn: issue.issuedOn,
        amountPaise: issue.totalPaise,
        paymentMode: issue.paymentMode,
      });
    })
    .catch(() => {
      /* accounts optional */
    });

  return { ok: true, issue, state };
}

/** Optional Fee Take paid map to refuse void after collections. */
export function voidStoreIssue(
  issueId: string,
  opts?: {
    by?: string;
    /** Amount already collected against store due key */
    collectedPaise?: number;
  },
): { ok: true; state: StoreState } | { ok: false; error: string } {
  const store = loadStore();
  const issue = store.issues.find((i) => i.id === issueId);
  if (!issue || issue.voidedAt) {
    return { ok: false, error: "Issue not found or already void" };
  }
  if ((opts?.collectedPaise ?? 0) > 0) {
    return {
      ok: false,
      error: "Cannot void — Fee Take already has collections on this issue",
    };
  }
  const now = nowIso();
  let items = store.items;
  const movements: StoreStockMovement[] = [];
  for (const line of issue.lines) {
    items = bumpStock(items, line.itemId, line.qty);
    movements.push(
      normalizeMovement({
        itemId: line.itemId,
        kind: "void_in",
        qtyDelta: line.qty,
        note: `Void ${issue.issueNo}`,
        refIssueId: issue.id,
        by: opts?.by || "",
      }),
    );
  }
  // Reverse prior exchange_in if any
  if (issue.returnToStock) {
    for (const m of store.movements) {
      if (m.refIssueId === issue.id && m.kind === "exchange_in") {
        items = bumpStock(items, m.itemId, -m.qtyDelta);
        movements.push(
          normalizeMovement({
            itemId: m.itemId,
            kind: "adjust",
            qtyDelta: -m.qtyDelta,
            note: `Void exchange return · ${issue.issueNo}`,
            refIssueId: issue.id,
            by: opts?.by || "",
          }),
        );
      }
    }
  }

  const state: StoreState = {
    ...store,
    items,
    movements: [...movements, ...store.movements],
    issues: store.issues.map((i) =>
      i.id === issueId
        ? { ...i, voidedAt: now, paymentStatus: "void" as const }
        : i,
    ),
  };
  saveStore(state);

  const netBilled = Math.max(0, issue.totalPaise - (issue.returnedPaise || 0));
  if (netBilled > 0) {
    void import("@/lib/accounts")
      .then((m) => {
        m.postStoreSellReturnToAccounts({
          returnId: `void_${issue.id}`,
          returnNo: `VOID-${issue.issueNo}`,
          returnedOn: now.slice(0, 10),
          amountPaise: netBilled,
          paymentMode: issue.paymentMode,
          narration: `Void store issue ${issue.issueNo}`,
        });
      })
      .catch(() => {
        /* accounts optional */
      });
  }

  return { ok: true, state };
}

export function listStoreIssuesForStudent(
  studentId: string,
  store?: StoreState,
): StoreIssue[] {
  const s = store ?? loadStore();
  return s.issues
    .filter(
      (i) =>
        i.studentId === studentId &&
        !i.voidedAt &&
        i.recipientKind !== "staff",
    )
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
}

export function issuePolicyLabel(p: StoreIssuePolicy): string {
  switch (p) {
    case "once_per_ay":
      return "Once per year";
    case "once_ever":
      return "Once ever";
    case "max_qty_per_ay":
      return "Max qty / year";
    default:
      return "Unlimited";
  }
}

export function audienceLabel(a: StoreAudience): string {
  if (a === "staff") return "Staff";
  if (a === "both") return "Students & staff";
  return "Students";
}

export function formatStoreItemLine(line: StoreIssueLine): string {
  const size = line.sizeLabel ? ` ${line.sizeLabel}` : "";
  return `${line.name}${size} ×${line.qty} @ ₹${(line.unitPricePaise / 100).toFixed(0)}`;
}

/** Stock card aggregates for one item. */
export function stockCardForItem(
  itemId: string,
  store?: StoreState,
): {
  purchased: number;
  issued: number;
  adjusted: number;
  remaining: number;
  opening: number;
} {
  const s = store ?? loadStore();
  const item = s.items.find((i) => i.id === itemId);
  let purchased = 0;
  let issued = 0;
  let adjusted = 0;
  const opening = item?.openingQty ?? 0;
  for (const m of s.movements) {
    if (m.itemId !== itemId) continue;
    if (m.kind === "purchase_in") purchased += m.qtyDelta;
    else if (m.kind === "issue_out") issued += Math.abs(m.qtyDelta);
    else if (m.kind === "void_in") issued -= m.qtyDelta;
    else if (m.kind === "adjust" || m.kind === "exchange_in") {
      adjusted += m.qtyDelta;
    }
  }
  return {
    purchased,
    issued: Math.max(0, issued),
    adjusted,
    remaining: item?.stockOnHand ?? 0,
    opening,
  };
}

export function stockRegisterRows(store?: StoreState) {
  const s = store ?? loadStore();
  return s.items
    .filter((i) => i.isActive)
    .map((i) => {
      const card = stockCardForItem(i.id, s);
      return {
        sku: i.sku,
        name: i.name,
        category: categoryLabel(i.categoryId, s),
        sizeLabel: i.sizeLabel,
        opening: card.opening,
        purchased: card.purchased,
        issued: card.issued,
        adjusted: card.adjusted,
        remaining: card.remaining,
        reorderLevel: i.reorderLevel,
        low: i.reorderLevel > 0 && i.stockOnHand <= i.reorderLevel,
        purchasePricePaise: i.purchasePricePaise,
        salePricePaise: i.salePricePaise,
        unitPricePaise: i.salePricePaise,
        maxDiscountPct: i.maxDiscountPct,
        audience: audienceLabel(i.audience),
        policy: issuePolicyLabel(i.issuePolicy),
      };
    });
}

export function salesDayBook(date: string, store?: StoreState) {
  const s = store ?? loadStore();
  return s.issues
    .filter((i) => i.issuedOn === date && !i.voidedAt)
    .map((i) => ({
      issueNo: i.issueNo,
      studentId: i.studentId,
      staffId: i.staffId,
      recipientKind: i.recipientKind,
      paymentMode: i.paymentMode,
      paymentStatus: i.paymentStatus,
      issueKind: i.issueKind,
      totalPaise: i.totalPaise,
      discountPaise: i.saleDiscountPaise,
      itemCount: i.lines.reduce((n, l) => n + l.qty, 0),
      issuedBy: i.issuedBy,
      note: i.note,
    }))
    .sort((a, b) => a.issueNo.localeCompare(b.issueNo));
}

/** CSV: SKU, Name, Category, Size, Purchase₹, Sale₹, Stock, Reorder, Policy, MaxDisc%, Audience */
export function importStoreCatalogCsv(text: string): {
  added: number;
  updated: number;
  state: StoreState;
  error?: string;
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { added: 0, updated: 0, state: loadStore(), error: "Empty file" };
  }
  let start = 0;
  if (/sku|name|price/i.test(lines[0]!)) start = 1;
  const state = loadStore();
  let categories = [...state.categories];
  const bySku = new Map(state.items.map((i) => [i.sku.toUpperCase(), i]));
  let added = 0;
  let updated = 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i]!.split(",").map((p) =>
      p.trim().replace(/^"|"$/g, ""),
    );
    const sku = (parts[0] ?? "").toUpperCase();
    const name = parts[1] ?? "";
    if (!sku || !name) continue;
    const catName = parts[2] ?? "Other";
    let cat =
      categories.find(
        (c) =>
          c.name.toLowerCase() === catName.toLowerCase() ||
          c.code === catName.toLowerCase(),
      ) || null;
    if (!cat) {
      const created = upsertStoreCategory({ name: catName });
      if (created.ok) {
        categories = created.state.categories;
        cat = created.category;
      }
    }
    const categoryId =
      cat?.id ||
      resolveCategoryId("other", categories);
    const sizeLabel = parts[3] ?? "";
    // Support old 5-col: Price only → sale; new: Purchase, Sale
    const hasPurchaseSale = parts.length >= 6 && Number.isFinite(Number(parts[4]));
    const purchase = Math.round(
      Number(hasPurchaseSale ? parts[4] : parts[4] ?? "0") * 100,
    );
    const sale = Math.round(
      Number(hasPurchaseSale ? parts[5] ?? parts[4] : parts[4] ?? "0") * 100,
    );
    const stockIdx = hasPurchaseSale ? 6 : 5;
    const stock = Math.max(0, Math.floor(Number(parts[stockIdx] ?? "0") || 0));
    const reorder = Math.max(
      0,
      Math.floor(Number(parts[stockIdx + 1] ?? "0") || 0),
    );
    const polRaw = (parts[stockIdx + 2] ?? "")
      .toLowerCase()
      .replace(/\s+/g, "_");
    const issuePolicy: StoreIssuePolicy =
      polRaw === "once_ever" ||
      polRaw === "unlimited" ||
      polRaw === "max_qty_per_ay" ||
      polRaw === "once_per_ay"
        ? polRaw
        : "once_per_ay";
    const maxDiscountPct = Math.min(
      100,
      Math.max(0, Math.round(Number(parts[stockIdx + 3] ?? "0") || 0)),
    );
    const audRaw = (parts[stockIdx + 4] ?? "student").toLowerCase();
    const audience: StoreAudience =
      audRaw === "staff" || audRaw === "both" ? audRaw : "student";
    const existing = bySku.get(sku);
    if (existing) {
      Object.assign(
        existing,
        normalizeItem(
          {
            ...existing,
            name,
            categoryId,
            sizeLabel,
            purchasePricePaise: Math.max(0, purchase || existing.purchasePricePaise),
            salePricePaise: Math.max(0, sale || existing.salePricePaise),
            reorderLevel: reorder,
            issuePolicy,
            maxDiscountPct,
            audience,
            isActive: true,
          },
          categories,
        ),
      );
      if (stock > 0 && existing.stockOnHand === 0) {
        existing.stockOnHand = stock;
        existing.openingQty = Math.max(existing.openingQty, stock);
      }
      updated += 1;
    } else {
      const item = normalizeItem(
        {
          id: nid("si"),
          sku,
          name,
          categoryId,
          sizeLabel,
          purchasePricePaise: Math.max(0, purchase),
          salePricePaise: Math.max(0, sale),
          stockOnHand: stock,
          openingQty: stock,
          reorderLevel: reorder,
          issuePolicy,
          maxDiscountPct,
          audience,
          isActive: true,
        },
        categories,
      );
      state.items.push(item);
      bySku.set(sku, item);
      if (stock > 0) {
        state.movements.unshift(
          normalizeMovement({
            itemId: item.id,
            kind: "opening",
            qtyDelta: stock,
            note: "CSV import",
          }),
        );
      }
      added += 1;
    }
  }
  state.categories = categories;
  saveStore(state);
  return { added, updated, state };
}

export function downloadStoreCatalogTemplate(): void {
  const body =
    "SKU,Name,Category,Size,Purchase,Sale,Stock,Reorder,Policy,MaxDiscPct,Audience\r\nBK-ENG-6,English Coursebook Class 6,Books,,280,385,80,10,once_per_ay,5,student\r\nUN-SHIRT,Uniform shirt,Uniform,32,320,450,60,8,once_per_ay,0,student\r\nST-NOTE-96,Notebook 96 pages,Stationery,,25,45,200,40,unlimited,10,both\r\n";
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "store_catalog_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function exportStoreCatalogCsv(store?: StoreState): void {
  const s = store ?? loadStore();
  const rows = [
    "SKU,Name,Category,Size,Purchase,Sale,Stock,Reorder,Policy,MaxDiscPct,Audience",
    ...s.items.map(
      (i) =>
        `${i.sku},${csvEscape(i.name)},${csvEscape(categoryLabel(i.categoryId, s))},${csvEscape(i.sizeLabel)},${(i.purchasePricePaise / 100).toFixed(0)},${(i.salePricePaise / 100).toFixed(0)},${i.stockOnHand},${i.reorderLevel},${i.issuePolicy},${i.maxDiscountPct},${i.audience}`,
    ),
  ];
  const blob = new Blob(["\uFEFF" + rows.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "store_catalog.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function upsertStoreInventoryAllocation(input: {
  id?: string;
  itemId: string;
  infraLevelId: string;
  qty: number;
  note?: string;
}): { ok: true; allocation: StoreInventoryAllocation; state: StoreState } | { ok: false; error: string } {
  const store = loadStore();
  if (!input.itemId) return { ok: false, error: "Pick an item" };
  if (!input.infraLevelId) return { ok: false, error: "Pick an infra level" };
  const item = store.items.find((i) => i.id === input.itemId);
  if (!item) return { ok: false, error: "Item not found" };
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  const existing = input.id
    ? store.inventoryAllocations.find((a) => a.id === input.id)
    : store.inventoryAllocations.find(
        (a) =>
          a.itemId === input.itemId && a.infraLevelId === input.infraLevelId,
      );
  const allocation = normalizeInventoryAllocation({
    id: existing?.id,
    itemId: input.itemId,
    infraLevelId: input.infraLevelId,
    qty,
    note: input.note ?? existing?.note ?? "",
    updatedAt: nowIso(),
  });
  const inventoryAllocations = existing
    ? store.inventoryAllocations.map((a) =>
        a.id === allocation.id ? allocation : a,
      )
    : [...store.inventoryAllocations, allocation];
  const state: StoreState = { ...store, inventoryAllocations };
  saveStore(state);
  return { ok: true, allocation, state };
}

export function deleteStoreInventoryAllocation(
  id: string,
): { ok: true; state: StoreState } | { ok: false; error: string } {
  const store = loadStore();
  if (!store.inventoryAllocations.some((a) => a.id === id)) {
    return { ok: false, error: "Allocation not found" };
  }
  const state: StoreState = {
    ...store,
    inventoryAllocations: store.inventoryAllocations.filter((a) => a.id !== id),
  };
  saveStore(state);
  return { ok: true, state };
}

export function upsertStoreAssetAllocation(input: {
  id?: string;
  itemId: string;
  assetTag: string;
  assignedTo: string;
  location?: string;
  qty?: number;
  note?: string;
}): { ok: true; allocation: StoreAssetAllocation; state: StoreState } | { ok: false; error: string } {
  const store = loadStore();
  if (!input.itemId) return { ok: false, error: "Pick an item" };
  if (!input.assetTag.trim()) return { ok: false, error: "Asset tag is required" };
  const item = store.items.find((i) => i.id === input.itemId);
  if (!item) return { ok: false, error: "Item not found" };
  const allocation = normalizeAssetAllocation({
    id: input.id,
    itemId: input.itemId,
    assetTag: input.assetTag.trim(),
    assignedTo: input.assignedTo.trim(),
    location: input.location?.trim() ?? "",
    qty: input.qty ?? 1,
    note: input.note ?? "",
    updatedAt: nowIso(),
  });
  const assetAllocations = input.id
    ? store.assetAllocations.map((a) =>
        a.id === allocation.id ? allocation : a,
      )
    : [...store.assetAllocations, allocation];
  const state: StoreState = { ...store, assetAllocations };
  saveStore(state);
  return { ok: true, allocation, state };
}

export function deleteStoreAssetAllocation(
  id: string,
): { ok: true; state: StoreState } | { ok: false; error: string } {
  const store = loadStore();
  if (!store.assetAllocations.some((a) => a.id === id)) {
    return { ok: false, error: "Allocation not found" };
  }
  const state: StoreState = {
    ...store,
    assetAllocations: store.assetAllocations.filter((a) => a.id !== id),
  };
  saveStore(state);
  return { ok: true, state };
}

/** Net billed after sell returns (used by Fee Take / dues). */
export function storeIssueNetBilledPaise(iss: StoreIssue): number {
  return Math.max(0, iss.totalPaise - (iss.returnedPaise || 0));
}

/** Qty already returned per item for an issue. */
export function returnedQtyByItem(
  issueId: string,
  store?: StoreState,
): Map<string, number> {
  const s = store ?? loadStore();
  const map = new Map<string, number>();
  for (const ret of s.sellReturns) {
    if (ret.issueId !== issueId) continue;
    for (const line of ret.lines) {
      map.set(line.itemId, (map.get(line.itemId) ?? 0) + line.qty);
    }
  }
  return map;
}

function nextSellReturnNo(store: StoreState): string {
  const n = store.sellReturns.length + 1;
  const y = new Date().getFullYear().toString().slice(-2);
  return `SR${y}${String(n).padStart(4, "0")}`;
}

/**
 * Student/staff returns sold items to school.
 * Restores stock, credits returnedPaise on the issue (reduces Fee Take due).
 */
export function createStoreSellReturn(input: {
  issueId: string;
  returnedOn?: string;
  note?: string;
  createdBy?: string;
  lines: { itemId: string; qty: number }[];
}):
  | { ok: true; sellReturn: StoreSellReturn; state: StoreState }
  | { ok: false; error: string } {
  const store = loadStore();
  const issue = store.issues.find((i) => i.id === input.issueId);
  if (!issue || issue.voidedAt) {
    return { ok: false, error: "Issue not found or void" };
  }
  if (!input.lines.length) {
    return { ok: false, error: "Add at least one return line" };
  }

  const already = returnedQtyByItem(issue.id, store);
  const returnLines: StoreSellReturnLine[] = [];
  let creditPaise = 0;

  for (const row of input.lines) {
    const qty = Math.max(0, Math.floor(Number(row.qty) || 0));
    if (!qty) continue;
    const src = issue.lines.find((l) => l.itemId === row.itemId);
    if (!src) {
      return { ok: false, error: "Item was not on this issue" };
    }
    const left = src.qty - (already.get(row.itemId) ?? 0);
    if (qty > left) {
      return {
        ok: false,
        error: `Cannot return more than ${left} of ${src.name}`,
      };
    }
    const linePaise = Math.round((src.linePaise / src.qty) * qty);
    returnLines.push({
      itemId: src.itemId,
      sku: src.sku,
      name: src.name,
      sizeLabel: src.sizeLabel,
      qty,
      unitPricePaise: src.unitPricePaise,
      linePaise,
    });
    creditPaise += linePaise;
    already.set(row.itemId, (already.get(row.itemId) ?? 0) + qty);
  }

  if (!returnLines.length) {
    return { ok: false, error: "Enter return quantities" };
  }

  // Proportionally reduce sale discount credit so net billed stays coherent
  const linesTotal = issue.lines.reduce((s, l) => s + l.linePaise, 0);
  const discountShare =
    linesTotal > 0
      ? Math.round((issue.saleDiscountPaise * creditPaise) / linesTotal)
      : 0;
  const netCredit = Math.max(0, creditPaise - discountShare);
  const newReturned = (issue.returnedPaise || 0) + netCredit;
  if (newReturned > issue.totalPaise) {
    return { ok: false, error: "Return credit exceeds issue total" };
  }

  let items = store.items;
  const movements: StoreStockMovement[] = [];
  const sellReturn = normalizeSellReturn({
    id: nid("sret"),
    returnNo: nextSellReturnNo(store),
    issueId: issue.id,
    studentId: issue.studentId,
    staffId: issue.staffId,
    returnedOn: input.returnedOn || nowIso().slice(0, 10),
    lines: returnLines,
    totalPaise: netCredit,
    note: input.note?.trim() || "",
    createdAt: nowIso(),
    createdBy: input.createdBy || "",
  });

  for (const line of returnLines) {
    items = bumpStock(items, line.itemId, line.qty);
    movements.push(
      normalizeMovement({
        itemId: line.itemId,
        kind: "sell_return_in",
        qtyDelta: line.qty,
        note: `Sell return ${sellReturn.returnNo}`,
        refIssueId: issue.id,
        by: input.createdBy || "",
      }),
    );
  }

  const fullyReturned =
    issue.lines.every((l) => (already.get(l.itemId) ?? 0) >= l.qty) &&
    newReturned >= issue.totalPaise;

  const state: StoreState = {
    ...store,
    items,
    movements: [...movements, ...store.movements],
    sellReturns: [sellReturn, ...store.sellReturns],
    issues: store.issues.map((i) =>
      i.id === issue.id
        ? {
            ...i,
            returnedPaise: newReturned,
            // Cash sales stay paid; credit fully returned → mark paid (zero due)
            paymentStatus:
              i.paymentMode === "credit" && fullyReturned
                ? "paid"
                : i.paymentStatus,
          }
        : i,
    ),
  };
  saveStore(state);

  void import("@/lib/accounts")
    .then((m) => {
      m.postStoreSellReturnToAccounts({
        returnId: sellReturn.id,
        returnNo: sellReturn.returnNo,
        returnedOn: sellReturn.returnedOn,
        amountPaise: sellReturn.totalPaise,
        paymentMode: issue.paymentMode,
      });
    })
    .catch(() => {
      /* accounts optional */
    });

  return { ok: true, sellReturn, state };
}
