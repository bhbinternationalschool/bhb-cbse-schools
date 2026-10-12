import { CRUD, type RbacFeatureDef, type RbacWholeModuleTab } from "@/lib/rbacFeatureCatalog/types";

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
    group: "Reports",
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
    group: "Fee payment",
    label: "Receipt delivery on WhatsApp",
    blurb: "See which receipts reached the family and send a receipt again.",
    actions: ["view", "create"],
    tabs: ["delivery"],
    routes: ["/api/fees/receipt-wa"],
  },
  {
    id: "fees.withhold",
    module: "fees",
    group: "Defaulters",
    label: "Withhold policy & approval rounds",
    blurb: "Set what a defaulting family loses, build an approval round and apply it.",
    actions: ["view", "edit"],
    tabs: ["policy"],
    routes: ["/api/fees/defaulter-policy", "/api/fees/hold-rounds", "/api/fees/hold-decisions"],
  },
  {
    id: "fees.autopay",
    module: "fees",
    group: "Payment gateway",
    label: "Fee auto-pay mandates",
    blurb: "Set up and follow families' auto-pay mandates; cancelling a live one needs Void.",
    actions: ["view", "edit", "void"],
    tabs: ["autopay"],
    routes: ["/api/fees/autopay"],
  },
  {
    id: "fees.refunds",
    module: "fees",
    group: "Refund",
    label: "Online refunds",
    blurb: "Refund an online payment back to the parent through the gateway (Void).",
    actions: ["view", "void"],
    routes: ["/api/fees/refund"],
  },
  // Fees → Bulk & PDC (/fees/tools). These three read and write the server
  // only (/api/fees/tools/*), never the fee desk, and each route runs the
  // same check it always did — a function stands in for the module grant
  // only at the actions it carries.
  {
    id: "fees.pdc",
    module: "fees",
    group: "Cheques",
    label: "Post-dated cheques",
    blurb:
      "Record post-dated cheques and see bounced ones. Depositing a cheque on its date makes the receipt (Create); bouncing, returning or cancelling one needs Edit.",
    // /api/fees/tools/pdc: GET view · create/deposit → create · bounce/return/cancel → edit.
    actions: ["view", "create", "edit"],
    tabs: ["pdc"],
    routes: ["/api/fees/tools/pdc", "/api/fees/tools/lookup"],
  },
  {
    id: "fees.bulk_payment",
    module: "fees",
    group: "Bulk fee payment",
    label: "Bulk fee payment",
    blurb:
      "Take one payment for several children (siblings or a group) and split it across their dues. Posting the payment makes receipts (Create).",
    // /api/fees/tools/bulk-payment: GET view · POST (preview and post) create.
    actions: ["view", "create"],
    tabs: ["bulk"],
    routes: ["/api/fees/tools/bulk-payment", "/api/fees/tools/lookup"],
  },
  {
    id: "fees.concession_templates",
    module: "fees",
    group: "Concession",
    label: "Concession templates (view)",
    blurb:
      "See the school's concession templates. Creating, changing or applying one records a concession, which still needs Fees edit or concession approval rights.",
    // GET needs fees·view. POST is canGrantConcession (fees·edit or an
    // approver) and approval is canApproveConcession — both module-level on
    // purpose, so this function never records or approves a concession.
    actions: ["view"],
    tabs: ["templates"],
    routes: ["/api/fees/tools/concession-templates", "/api/fees/tools/lookup"],
  },

  /* ── Accounts (Ledger v2, /api/ledger) ───────────────────────────── */
  {
    id: "accounts.voucher_entry",
    module: "accounts",
    group: "Transaction",
    label: "Voucher entry & day sheet",
    blurb: "Post expense, receipt and journal vouchers and run the day sheet. Voiding or amending a posted voucher needs Accounts approval.",
    actions: ["view", "edit"],
    tabs: ["vouchers", "daysheet"],
    routes: ["/api/ledger"],
  },
  {
    id: "accounts.bank_recon",
    module: "accounts",
    group: "Bank reconciliation",
    label: "Bank reconciliation",
    blurb: "Import bank statements, match them to the book and pull gateway settlements. Balances still need the balances grant.",
    actions: ["view", "edit"],
    tabs: ["recon"],
    routes: ["/api/ledger", "/api/payments/cashfree/settlements"],
  },
  {
    id: "accounts.vendor_bills",
    module: "accounts",
    group: "Transaction",
    label: "Vendor bills & payments",
    blurb: "See what each vendor is owed and pay their bills from the book.",
    actions: ["view", "edit"],
    tabs: ["bills"],
    routes: ["/api/ledger"],
  },
  {
    id: "accounts.heads",
    module: "accounts",
    group: "Masters",
    label: "Expense heads & cost centres",
    blurb: "Add, rename and retire expense heads and cost centres.",
    actions: ["view", "edit"],
    tabs: ["masters"],
    routes: ["/api/ledger"],
  },
  {
    id: "accounts.book_reports",
    module: "accounts",
    group: "Reports",
    label: "Book reports & server book (read only)",
    blurb: "Read the book's reports and the server book. Balances and session totals still need the balances grant.",
    actions: ["view", "export"],
    // The server book reads cockpit (a position read — accounts_position on
    // the server) and reconcile; its projection button is approve-class.
    tabs: ["bookreports", "book"],
    routes: ["/api/ledger", "/api/ai/ledger-brief"],
  },

  /* ── Trust · construction (trust-desk) ───────────────────────────── */
  {
    id: "trust.projects",
    module: "trust",
    group: "Construction",
    label: "Projects & works (BOQ)",
    blurb: "Projects, their work items and the rate card.",
    actions: CRUD,
    slices: ["projects", "workItems", "rateCard"],
    tabs: ["projects", "works"],
  },
  {
    id: "trust.materials",
    module: "trust",
    group: "Construction",
    label: "Site materials",
    blurb: "Material required, ordered, received and issued on site.",
    actions: CRUD,
    slices: ["materials"],
    tabs: ["materials"],
  },
  {
    id: "trust.labour",
    module: "trust",
    group: "Construction",
    label: "Labour register",
    blurb: "Record labour days on site. Paying labour posts to the accounts and stays with the Trust grant.",
    actions: CRUD,
    slices: ["labourEntries"],
    tabs: ["labour"],
  },
  {
    id: "trust.allotments",
    module: "trust",
    group: "Construction",
    label: "Work allotments",
    blurb: "Allot work to staff or contractors and record progress and verification.",
    actions: ["view", "create", "edit"],
    slices: ["allotments"],
    tabs: ["allotments"],
  },
  {
    id: "trust.cost_view",
    module: "trust",
    group: "Reports",
    label: "Contractor bills & cost reports (read only)",
    blurb: "See work orders, RA bills and the cost sheet in reports. Raising, approving and paying bills stays with the Trust grant.",
    actions: ["view", "export"],
    slices: ["contractors", "workOrders", "raBills", "costLines"],
    tabs: ["reports"],
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

/** Moved to ./store with the store functions; re-exported for old imports. */
export { STORE_FUNCTION_WRITES } from "@/lib/rbacFeatureCatalog/store";

/** Tabs of these modules that only the whole-module grant opens, and why. */
const FEE_DESK_WRITE =
  "writes the fee desk (fees-vouchers), whose receipts are append-only and server-numbered — fee desk writes stay with the Fees grant (money rule above)";

export const MONEY_WHOLE_MODULE_TABS: RbacWholeModuleTab[] = [
  /* Fees → Fee Take (/fees) */
  { module: "fees", tab: "collect", reason: `Collecting fees ${FEE_DESK_WRITE}.` },
  { module: "fees", tab: "receipts", reason: `Printing, cancelling and repairing receipts ${FEE_DESK_WRITE}; reading receipts is in Fee reports.` },
  { module: "fees", tab: "cheques", reason: `Clearing and bouncing counter cheques ${FEE_DESK_WRITE}; post-dated cheques are their own function (fees.pdc).` },
  { module: "fees", tab: "manual", reason: `Manual receipt books ${FEE_DESK_WRITE}.` },
  { module: "fees", tab: "dayclose", reason: `The cashier's day close ${FEE_DESK_WRITE} and hands cash over to the accounts.` },
  { module: "fees", tab: "adjustments", reason: `Fee adjustments, installment plans and carried-forward dues ${FEE_DESK_WRITE}.` },
  { module: "fees", tab: "vouchers", reason: `Charge vouchers ${FEE_DESK_WRITE}.` },
  {
    module: "fees",
    tab: "paylinks",
    reason:
      "Pay-links are created and marked cancelled in the payment-links desk, which stays module-level (a link is settled only off the stored copy); /api/payments/cancel-link only closes the gateway order first.",
  },
  {
    module: "fees",
    tab: "wa_sis",
    reason:
      "The parents' WhatsApp inbox is the office's shared inbox: /api/wa/sis-bot/threads is gated by requireWaStaffApi (view on admissions/fees/notices/news/notifications plus a school-wide scope), not by Fees functions.",
  },
  /* Fees → Defaulters (/fees/defaulters) */
  {
    module: "fees",
    tab: "list",
    reason:
      "The defaulters list is built from the whole fee desk and SIS, and its reminders create pay-links in the payment-links desk — a module-level write.",
  },
  /* Accounts (/accounts) */
  {
    module: "accounts",
    tab: "dashboard",
    reason: "The Accounts dashboard aggregates the whole module, balances included (cockpit/position reads).",
  },
  {
    module: "accounts",
    tab: "owner",
    reason: "Owner loans are the legacy accounts-desk register; its postings stay with the Accounts grant (money rule above).",
  },
  {
    module: "accounts",
    tab: "dayclose",
    reason: "The accounts day close approves the fee desk's day closes and posts the cash handover to the accounts desk — both module-level writes.",
  },
  {
    module: "accounts",
    tab: "closing",
    reason:
      "Closing balances move the book onto counted cash and a bank statement (closing-balances, approve-class on /api/ledger and accounts_position·approve) — no function carries it.",
  },
  /* Trust (/trust) */
  {
    module: "trust",
    tab: "dashboard",
    reason: "The Trust dashboard aggregates every construction register across the module.",
  },
  {
    module: "trust",
    tab: "bills",
    reason:
      "Contractors, work orders and RA bills are raised, approved and paid on this tab with no server approval check, and paying posts to the accounts desk; reading them is in trust.cost_view (Reports).",
  },
];
