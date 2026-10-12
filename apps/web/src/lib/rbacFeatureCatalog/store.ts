import { CRUD, type RbacFeatureDef, type RbacWholeModuleTab } from "@/lib/rbacFeatureCatalog/types";

/**
 * Store, purchase, library and vault (split out of money.ts, 12 Oct 2026).
 * /api/inventory/* and /api/library/* run on the store module through
 * invRoute (lib/inventory/route.server.ts): listing a path in `routes` opens
 * it for reading; writes are limited to STORE_FUNCTION_WRITES.
 */
const STORE_PURCHASE_FEATURES: RbacFeatureDef[] = [
  /* ── Store & purchase (/api/inventory/*, all on the store module) ─── */
  {
    id: "store.counter",
    module: "store",
    group: "Store counter",
    label: "Store counter (sell & issue)",
    blurb: "Sell or issue items and kits to students and staff, take payment and returns. Cancelling a posted sale needs Void.",
    actions: ["view", "edit", "void"],
    tabs: ["counter"],
    routes: [
      "/api/inventory/bootstrap",
      "/api/inventory/items",
      "/api/inventory/kits",
      "/api/inventory/buyers",
      "/api/inventory/sales",
    ],
  },
  {
    id: "store.purchase",
    module: "store",
    group: "Purchase",
    label: "Indents, orders & goods receipt",
    blurb: "Raise indents and purchase orders, receive goods (GRN) and return them to the vendor. Approving is a separate function.",
    actions: ["view", "edit", "delete"],
    tabs: ["purchase"],
    routes: [
      "/api/inventory/bootstrap",
      "/api/inventory/items",
      "/api/inventory/vendors",
      "/api/inventory/indents",
      "/api/inventory/orders",
      "/api/inventory/receipts",
      "/api/inventory/returns",
      "/api/inventory/bills",
    ],
  },
  {
    id: "store.purchase_approval",
    module: "store",
    group: "Purchase",
    label: "Approve indents & purchase orders",
    blurb: "Approve or reject indents and purchase orders raised by others.",
    actions: ["view", "approve"],
    tabs: ["purchase"],
    routes: [
      "/api/inventory/bootstrap",
      "/api/inventory/items",
      "/api/inventory/vendors",
      "/api/inventory/indents",
      "/api/inventory/orders",
    ],
  },
  {
    id: "store.vendor_payments",
    module: "store",
    group: "Purchase",
    label: "Pay vendor bills (store)",
    blurb: "Pay the store's vendor bills. Money out, so kept apart from raising orders.",
    actions: ["view", "edit"],
    tabs: ["purchase"],
    routes: ["/api/inventory/bootstrap", "/api/inventory/vendors", "/api/inventory/bills"],
  },
  {
    id: "store.stock",
    module: "store",
    group: "Stock & assets",
    label: "Stock & assets",
    blurb: "Stock cards, adjustments and transfers between locations, and the asset register.",
    actions: CRUD,
    tabs: ["stock"],
    routes: [
      "/api/inventory/bootstrap",
      "/api/inventory/items",
      "/api/inventory/stock",
      "/api/inventory/assets",
      "/api/inventory/reports",
    ],
  },
  {
    id: "store.catalogue",
    module: "store",
    group: "Store setup",
    label: "Catalogue, prices, kits & vendors",
    blurb: "Items, selling prices, class kits and the vendor list.",
    actions: CRUD,
    tabs: ["catalogue", "kits", "vendors"],
    routes: [
      "/api/inventory/bootstrap",
      "/api/inventory/items",
      "/api/inventory/prices",
      "/api/inventory/kits",
      "/api/inventory/vendors",
    ],
  },
  {
    id: "store.reports",
    module: "store",
    group: "Store reports",
    label: "Store reports (read only)",
    blurb: "Stock, sales, margin, purchase and day-book reports.",
    actions: ["view", "export"],
    tabs: ["reports"],
    routes: [
      "/api/inventory/bootstrap",
      "/api/inventory/reports",
      "/api/inventory/stock",
      "/api/inventory/sales",
    ],
  },
  {
    id: "store.setup",
    module: "store",
    group: "Store setup",
    label: "Store setup",
    blurb: "Locations, categories, units and store settings such as the approval threshold.",
    actions: CRUD,
    tabs: ["masters"],
    routes: ["/api/inventory/bootstrap", "/api/inventory/masters"],
  },
];

/* ── Library (module store; /api/library/* through invRoute) ─────────── */

/**
 * The functions whose holders the library-desk GET serves. Each reads the
 * whole desk (by function id, not by slice: these functions own no desk
 * slices, so no desk save can ever lift a key on their account) — the counter needs the copies and loans to preview a scan, the
 * copies tab needs the titles — and never a cut-down copy a later save on
 * that browser could push back. The desk POST (catalogue, procurement,
 * e-books) stays module-level; these functions write only through
 * /api/library/counter and /api/library/fines.
 */
export const LIBRARY_READER_FUNCTIONS = [
  "store.library_counter",
  "store.library_copies",
  "store.library_fines",
  "store.library_reports",
] as const;

const LIBRARY_FEATURES: RbacFeatureDef[] = [
  {
    id: "store.library_counter",
    module: "store",
    group: "Library",
    label: "Library counter (issue & return)",
    blurb: "Issue books to students and staff and take them back. Loan days, limits and the fine rule stay with the Store grant.",
    actions: ["view", "create", "edit"],
    tabs: ["issue"],
    routes: ["/api/library/counter"],
  },
  {
    id: "store.library_copies",
    module: "store",
    group: "Library",
    label: "Library copies & labels",
    blurb: "Add copies of a catalogued title with accession numbers, print labels, move a copy or mark it lost or damaged.",
    actions: ["view", "create", "edit"],
    tabs: ["copies"],
    routes: ["/api/library/counter"],
  },
  {
    id: "store.library_fines",
    module: "store",
    group: "Library",
    label: "Library circulation & fines",
    blurb: "See loans out and overdue, and collect late fines (a receipt is posted). Waiving a fine needs Approve.",
    actions: ["view", "edit", "approve"],
    tabs: ["circulation"],
    routes: ["/api/library/fines", "/api/library/counter"],
  },
  {
    id: "store.library_reports",
    module: "store",
    group: "Library",
    label: "Library dashboard, history & reports (read only)",
    blurb: "The library dashboard, loan history by borrower and the library reports. Changes nothing.",
    actions: ["view", "export"],
    tabs: ["dashboard", "history", "lib_reports"],
  },
];

export const STORE_FEATURES: RbacFeatureDef[] = [...STORE_PURCHASE_FEATURES, ...LIBRARY_FEATURES];

/**
 * The /api/inventory and /api/library paths each store function may WRITE (POST / DELETE).
 * Listing a path in `routes` opens it for reading; the counter reads the
 * catalogue, but must not be able to reprice it or change the approval
 * threshold through the same path (lib/inventory/route.server.ts).
 */
export const STORE_FUNCTION_WRITES: Readonly<Record<string, readonly string[]>> = {
  "store.counter": ["/api/inventory/sales"],
  "store.purchase": [
    "/api/inventory/indents",
    "/api/inventory/orders",
    "/api/inventory/receipts",
    "/api/inventory/returns",
  ],
  "store.purchase_approval": ["/api/inventory/indents", "/api/inventory/orders"],
  "store.vendor_payments": ["/api/inventory/bills"],
  "store.stock": ["/api/inventory/stock", "/api/inventory/assets"],
  "store.catalogue": [
    "/api/inventory/items",
    "/api/inventory/prices",
    "/api/inventory/kits",
    "/api/inventory/vendors",
  ],
  "store.setup": ["/api/inventory/masters", "/api/inventory/bootstrap"],
  // One library path does several jobs, so its routes name the job as a
  // sub-path (invRoute's `operation`): the counter clerk issues and takes
  // back, but cannot add copies or change the loan and fine rules
  // (/api/library/counter/save_rules — module only).
  "store.library_counter": ["/api/library/counter/issue", "/api/library/counter/return"],
  "store.library_copies": ["/api/library/counter/add_copies", "/api/library/counter/update_copy"],
  "store.library_fines": ["/api/library/fines/collect", "/api/library/fines/waive"],
};

/** Tabs of these modules that only the whole-module grant opens, and why. */
export const STORE_WHOLE_MODULE_TABS: RbacWholeModuleTab[] = [
  {
    module: "store",
    tab: "titles",
    reason: "Library catalogue titles are saved through the library-desk save, which stays module-level; no function-scoped route writes them.",
  },
  {
    module: "store",
    tab: "procurement",
    reason: "Library purchase bills are saved through the library-desk save (module-level) and read by the Store-edit bill OCR route.",
  },
  {
    module: "store",
    tab: "ebooks",
    reason: "E-book shelves are saved through the library-desk save, which stays module-level; parents read them through the app route.",
  },
  /* Vault — one register (vault-desk); module view reads it, edit saves it. */
  {
    module: "vault",
    tab: "dashboard",
    reason: "The vault is one register (vault-desk) read and saved whole; module view/edit already splits reading from changing it.",
  },
  {
    module: "vault",
    tab: "alerts",
    reason: "Expiry alerts read the whole vault register and save the digest numbers into it; vault-desk stays module-level (view/edit).",
  },
  {
    module: "vault",
    tab: "documents",
    reason: "The document list is the whole vault register, edited and deleted in place; vault-desk stays module-level (view/edit).",
  },
  {
    module: "vault",
    tab: "add",
    reason: "Adding a certificate saves the whole vault register through vault-desk, module-level by the money rule; no function route.",
  },
  {
    module: "vault",
    tab: "reports",
    reason: "Vault reports export the whole register — the same read as module view, so a function would only duplicate that grant.",
  },
];
