import { CRUD, type RbacFeatureDef } from "@/lib/rbacFeatureCatalog/types";

/**
 * Money modules — fees, accounts, trust, payroll, store (6 Oct 2026).
 *
 * The rule here is stricter than elsewhere. The fee book has lost its
 * receipt lines twice to whole-desk pushes (1 and 6 Sep 2026), so a function
 * never takes a share of a desk whose integrity depends on its own merge
 * logic. Those desks stay module-level for WRITES:
 *
 *   fees-vouchers, payment-links  receipts are append-only and server-
 *       numbered, lines are kept when a push omits them, a pay-link is
 *       settled only off the stored copy. A per-row lift would let a browser's
 *       stale copy of a receipt or link stand in for the server's.
 *   accounts-desk, payroll-desk, statutory-desk  ledger postings, payslips
 *       and remittances; one row in them is somebody's money.
 *   module-state salary_increment / salary_hold / salary_account  saved
 *       whole, and approval, release and "applied" live inside the book with
 *       no server check — a book-level function would carry them. The salary
 *       account is where pay is sent.
 *   staff_advances (desk-slice)  one key, so a function would be the module.
 *   vault-desk  one register; view/edit on the module already splits it.
 *
 * Functions there work through the dedicated API routes instead, which run
 * their own server checks. Where one route serves several jobs (/api/ledger,
 * /api/inventory/*), the WRITES each function may make are named below
 * (LEDGER_FUNCTION_WRITES, STORE_FUNCTION_WRITES) and enforced by the route:
 * listing a route opens it for reading, not for every write it can do.
 *
 * Trust is the one money desk wired for function saves: its site registers
 * (projects, materials, labour, allotments) are not postings, and the route
 * refuses any function save that pays labour or touches a paid entry.
 */

/** Every key the fee desk GET returns — a reader sees all or nothing. */
export const FEE_DESK_KEYS = [
  "vouchers",
  "cheques",
  "manualBooks",
  "dayCloses",
  "installmentPlans",
  "planAllocations",
  "carriedForwardDues",
  "chargeVouchers",
] as const;

export const MONEY_FEATURES: RbacFeatureDef[] = [
  /* ── Fees ─────────────────────────────────────────────────────────── */
  {
    id: "fees.reports",
    module: "fees",
    label: "Fee dashboard & reports (read only)",
    blurb:
      "See collections, receipts and dues on the dashboard and in reports. Changes nothing — collecting, voiding and waivers stay with the Fees grant.",
    actions: ["view", "export"],
    // Read-only by construction: a view-only function can never pass the
    // row check, and the desk POST stays module-level anyway. It owns every
    // key so its reader gets the whole desk — never a partial copy a later
    // save on that browser could push back.
    slices: [...FEE_DESK_KEYS, "links"],
    tabs: ["dashboard", "reports"],
    routes: ["/api/fees/open-dues-summary", "/api/ai/collections-weekly-note"],
  },
  {
    id: "fees.receipt_delivery",
    module: "fees",
    label: "Receipt delivery on WhatsApp",
    blurb: "See which receipts reached the family and send a receipt again.",
    actions: ["view", "create"],
    tabs: ["delivery"],
    routes: ["/api/fees/receipt-wa"],
  },
  {
    id: "fees.withhold",
    module: "fees",
    label: "Withhold policy & approval rounds",
    blurb: "Set what a defaulting family loses, build an approval round and apply it.",
    actions: ["view", "edit"],
    tabs: ["policy"],
    routes: ["/api/fees/defaulter-policy", "/api/fees/hold-rounds", "/api/fees/hold-decisions"],
  },
  {
    id: "fees.autopay",
    module: "fees",
    label: "Fee auto-pay mandates",
    blurb: "Set up and follow families' auto-pay mandates; cancelling a live one needs Void.",
    actions: ["view", "edit", "void"],
    tabs: ["autopay"],
    routes: ["/api/fees/autopay"],
  },
  {
    id: "fees.refunds",
    module: "fees",
    label: "Online refunds",
    blurb: "Refund an online payment back to the parent through the gateway (Void).",
    actions: ["view", "void"],
    routes: ["/api/fees/refund"],
  },

  /* ── Accounts (Ledger v2, /api/ledger) ───────────────────────────── */
  {
    id: "accounts.voucher_entry",
    module: "accounts",
    label: "Voucher entry & day sheet",
    blurb: "Post expense, receipt and journal vouchers and run the day sheet. Voiding or amending a posted voucher needs Accounts approval.",
    actions: ["view", "edit"],
    tabs: ["vouchers", "daysheet"],
    routes: ["/api/ledger"],
  },
  {
    id: "accounts.bank_recon",
    module: "accounts",
    label: "Bank reconciliation",
    blurb: "Import bank statements, match them to the book and pull gateway settlements. Balances still need the balances grant.",
    actions: ["view", "edit"],
    tabs: ["recon"],
    routes: ["/api/ledger", "/api/payments/cashfree/settlements"],
  },
  {
    id: "accounts.vendor_bills",
    module: "accounts",
    label: "Vendor bills & payments",
    blurb: "See what each vendor is owed and pay their bills from the book.",
    actions: ["view", "edit"],
    tabs: ["bills"],
    routes: ["/api/ledger"],
  },
  {
    id: "accounts.heads",
    module: "accounts",
    label: "Expense heads & cost centres",
    blurb: "Add, rename and retire expense heads and cost centres.",
    actions: ["view", "edit"],
    tabs: ["masters"],
    routes: ["/api/ledger"],
  },
  {
    id: "accounts.book_reports",
    module: "accounts",
    label: "Book reports (read only)",
    blurb: "Read the book's reports. Balances and session totals still need the balances grant.",
    actions: ["view", "export"],
    tabs: ["bookreports"],
    routes: ["/api/ledger", "/api/ai/ledger-brief"],
  },

  /* ── Trust · construction (trust-desk) ───────────────────────────── */
  {
    id: "trust.projects",
    module: "trust",
    label: "Projects & works (BOQ)",
    blurb: "Projects, their work items and the rate card.",
    actions: CRUD,
    slices: ["projects", "workItems", "rateCard"],
    tabs: ["projects", "works"],
  },
  {
    id: "trust.materials",
    module: "trust",
    label: "Site materials",
    blurb: "Material required, ordered, received and issued on site.",
    actions: CRUD,
    slices: ["materials"],
    tabs: ["materials"],
  },
  {
    id: "trust.labour",
    module: "trust",
    label: "Labour register",
    blurb: "Record labour days on site. Paying labour posts to the accounts and stays with the Trust grant.",
    actions: CRUD,
    slices: ["labourEntries"],
    tabs: ["labour"],
  },
  {
    id: "trust.allotments",
    module: "trust",
    label: "Work allotments",
    blurb: "Allot work to staff or contractors and record progress and verification.",
    actions: ["view", "create", "edit"],
    slices: ["allotments"],
    tabs: ["allotments"],
  },
  {
    id: "trust.cost_view",
    module: "trust",
    label: "Contractor bills & cost reports (read only)",
    blurb: "See work orders, RA bills and the cost sheet in reports. Raising, approving and paying bills stays with the Trust grant.",
    actions: ["view", "export"],
    slices: ["contractors", "workOrders", "raBills", "costLines"],
    tabs: ["reports"],
  },

  /* ── Payroll ─────────────────────────────────────────────────────── */
  {
    id: "payroll.payslips",
    module: "payroll",
    label: "Payroll runs & payslips (read only)",
    blurb: "See approved payslips, print them and read the payroll reports.",
    actions: ["view", "export"],
    // Owns both payroll-desk keys so its reader gets the whole desk; it is
    // view-only, and the desk POST stays module-level. The Runs and Run
    // detail tabs generate and edit runs, so they are not opened here.
    slices: ["runs", "audit"],
    tabs: ["payslips", "print", "reports"],
  },
  /* ── Store & purchase (/api/inventory/*, all on the store module) ─── */
  {
    id: "store.counter",
    module: "store",
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
    label: "Pay vendor bills (store)",
    blurb: "Pay the store's vendor bills. Money out, so kept apart from raising orders.",
    actions: ["view", "edit"],
    tabs: ["purchase"],
    routes: ["/api/inventory/bootstrap", "/api/inventory/vendors", "/api/inventory/bills"],
  },
  {
    id: "store.stock",
    module: "store",
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
    label: "Store setup",
    blurb: "Locations, categories, units and store settings such as the approval threshold.",
    actions: CRUD,
    tabs: ["masters"],
    routes: ["/api/inventory/bootstrap", "/api/inventory/masters"],
  },
];

/**
 * /api/ledger is one route with forty operations. A function that lists it
 * may READ (the route's own view-level operations; balances still need
 * accounts_position), but WRITES only the operations named here. Approval-
 * class work — void, amend, reverse, lock, close-year, projection, closing
 * balances — and reclassifying posted vouchers are in no list: they stay
 * with the Accounts grant.
 */
export const LEDGER_FUNCTION_WRITES: Readonly<Record<string, readonly string[]>> = {
  "accounts.voucher_entry": ["post"],
  "accounts.bank_recon": ["import-statement", "auto-match", "match", "unmatch"],
  "accounts.vendor_bills": ["pay-vendor-bill"],
  "accounts.heads": ["save-expense-head", "remove-expense-head", "save-cost-centre", "remove-cost-centre"],
};

/**
 * The /api/inventory paths each store function may WRITE (POST / DELETE).
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
};
