/**
 * The collection registry — the single description of every readable and
 * writable set of records.
 *
 * Today the same facts are spread across 43 `*Persistence.ts`, 26
 * `*NormalizedClient.ts`, 26 `*Normalized.server.ts`, 27 `*DbConfig.ts` and
 * 33 hand-written API routes. Thirty-three near-identical routes is how
 * thirty-three near-identical bugs shipped: each one re-implemented auth,
 * scoping and error handling, and each got it slightly differently wrong.
 *
 * A collection is a set of records, not a module. `sis` is a module; it has
 * `sis.students` and `sis.households`. Whole-module state objects are what
 * this layer exists to abolish, so the module is never the unit of transfer.
 *
 * Adding an entry here grants access through the generic API. Review it as a
 * permission change. A row must ALSO be added to `desk_writable_tables`
 * (migration 20260810010000) before writes reach the database — two
 * deliberate steps, in two systems, so neither can be done absent-mindedly.
 */

import type { RbacModule } from "@/lib/rbac";

/** Scope filters the repo will refuse to build a query without. */
export type ScopeKey = "tenant_id" | "academic_year_code";

export type CollectionDef = {
  /** Stable id used in the URL: /api/data/<id> */
  readonly id: string;
  /** Module, for navigation and RBAC grouping. */
  readonly module: string;
  /** Postgres table. Must appear in desk_writable_tables to be writable. */
  readonly table: string;
  /**
   * Permission keys checked against the caller's role. Reads and writes are
   * separate: plenty of roles may view a roster and not edit it. Typed as
   * RbacModule so a key that does not exist fails to compile rather than
   * silently authorising nothing — or, worse, defaulting to something.
   */
  readonly rbac: { readonly view: RbacModule; readonly edit: RbacModule };
  /**
   * Filters that MUST be present on every query. `tenant_id` is always
   * required; `academic_year_code` is required wherever records belong to a
   * session, so a report can never silently span years. The repo throws if a
   * mandatory scope is missing rather than returning a whole table.
   */
  readonly scope: readonly ScopeKey[];
  /**
   * Soft-delete keeps the row and stamps `deleted_at`. Required for anything
   * financial or auditable — a receipt must remain answerable years later.
   * The table needs a `deleted_at` column for this to take effect.
   */
  readonly softDelete: boolean;
  readonly list: {
    /** Column for keyset pagination. Must be unique with `id`. */
    readonly sortColumn: string;
    readonly defaultLimit: number;
    /** Hard ceiling. No caller may ask for "everything". */
    readonly maxLimit: number;
    /**
     * Columns a LIST returns. Omit to return the whole row.
     *
     * A list view needs enough to render a row and open it; it does not need
     * the record. `admission_desk_leads` is the case that forced this:
     * `lead_json` is 1.82 MB of the table's 2.37 MB — 76.8% — and no list
     * screen reads a single field of it. Sending it anyway is what made the
     * admissions payload 2.37 MB, put it past the browser storage cap, and
     * cost the director's phone its saves on 2026-08-10.
     *
     * Must include `id` and `sortColumn`, or paging cannot continue. The repo
     * enforces that rather than trusting each definition to remember.
     */
    readonly columns?: readonly string[];
  };
};

/**
 * Seeded with the two collections Stage 1 exercises, matching the two tables
 * in `desk_writable_tables`. Modules are added as they migrate — the blast
 * radius grows exactly as fast as the migration does, never ahead of it.
 */
export const COLLECTIONS: readonly CollectionDef[] = [
  {
    id: "sis.students",
    module: "students",
    table: "sis_students",
    rbac: { view: "students", edit: "students" },
    // Students belong to a session. Without academic_year_code in scope a
    // roster query silently spans every year the school has ever run.
    scope: ["tenant_id", "academic_year_code"],
    // Hard delete: removing a student is deliberate and rare, and the audit
    // entry is the surviving record (see StudentsWorkspace.onRemove).
    softDelete: false,
    list: { sortColumn: "admission_no", defaultLimit: 100, maxLimit: 500 },
  },
  {
    id: "sis.households",
    module: "students",
    table: "sis_households",
    rbac: { view: "students", edit: "students" },
    // Households outlive any one session — a family stays a family across
    // years — so they are tenant-scoped only.
    scope: ["tenant_id"],
    softDelete: false,
    list: { sortColumn: "code", defaultLimit: 100, maxLimit: 500 },
  },

  // ── Masters (Stage 2) ──────────────────────────────────────────────────
  // Copied out of masters_desk_slices into masters_desk_* tables, ids
  // byte-identical (migration 20260810040000). The slices remain the source
  // of truth until the app is pointed here.
  //
  // Scope note: these are tenant-scoped only, NOT academic_year_code, even
  // though several carry that column. Masters is deliberately read whole —
  // the session selector lists every academic year, fee structures are
  // compared across years, and a class outlives any one session. Making the
  // year mandatory here would break those reads to enforce a rule that does
  // not apply. Callers filter by year where they mean to; sis.students above
  // is the opposite case, where an unscoped read genuinely is a bug.
  //
  // The whole of masters is 594 records, so the default page comfortably
  // holds any one collection. The ceiling is still real: it stops a future
  // caller assuming "small forever".
  ...(
    [
      ["classes", "masters_desk_classes", "sort_order"],
      ["sections", "masters_desk_sections", "name"],
      ["campuses", "masters_desk_campuses", "code"],
      ["academic-years", "masters_desk_academic_years", "code"],
      ["academic-terms", "masters_desk_academic_terms", "sort_order"],
      ["subjects", "masters_desk_subjects", "sort_order"],
      ["class-subjects", "masters_desk_class_subjects", "id"],
      ["fee-head-categories", "masters_desk_fee_head_categories", "sort_order"],
      ["fee-heads", "masters_desk_fee_heads", "sort_order"],
      ["installments", "masters_desk_installments", "sort_order"],
      ["fee-groups", "masters_desk_fee_groups", "code"],
      ["fee-structure-lines", "masters_desk_fee_structure_lines", "id"],
      ["late-fee-rules", "masters_desk_late_fee_rules", "id"],
      ["special-fees", "masters_desk_special_fees", "code"],
      ["special-fee-assignments", "masters_desk_special_fee_assignments", "id"],
      ["concession-kinds", "masters_desk_concession_kinds", "code"],
      ["concessions", "masters_desk_concessions", "code"],
      ["concession-grants", "masters_desk_concession_grants", "id"],
      ["senior-streams", "masters_desk_senior_streams", "sort_order"],
      ["number-series", "masters_desk_number_series", "code"],
      ["holidays", "masters_desk_holidays", "starts_on"],
      ["settings", "masters_desk_settings", "id"],
    ] as const
  ).map(
    ([name, table, sortColumn]): CollectionDef => ({
      id: `masters.${name}`,
      module: "masters",
      table,
      rbac: { view: "masters", edit: "masters" },
      scope: ["tenant_id"],
      // Masters rows are referenced by student, lead and fee records by id.
      // A soft delete would leave those references resolving to a row the
      // UI has hidden, which is a subtler version of the orphaning this
      // whole migration exists to prevent. Deletion stays explicit and hard,
      // and the write guard refuses a delete on a stale revision.
      softDelete: false,
      list: { sortColumn, defaultLimit: 500, maxLimit: 1000 },
    }),
  ),
  {
    // Stage 6. The table that made the case for projections: 919 leads,
    // 2.37 MB, of which lead_json is 1.82 MB that no list screen reads.
    id: "admissions.leads",
    module: "admissions",
    table: "admission_desk_leads",
    rbac: { view: "admissions", edit: "admissions" },
    // Leads belong to an intake year. Without academic_year_code a follow-up
    // list silently mixes this year's enquiries with last year's.
    scope: ["tenant_id", "academic_year_code"],
    // A lead that stops being pursued is still evidence of an enquiry, and
    // the family may return next year — so it SHOULD be soft-deleted. But
    // admission_desk_leads has no `deleted_at` column (checked, not assumed),
    // and declaring softDelete without it makes every list query filter on a
    // column that does not exist. False until the column is added, which must
    // happen before this collection accepts writes.
    softDelete: false,
    list: {
      // lead_date is not unique, so keyset paging leans on (lead_date, id) —
      // which is exactly why the repo forces `id` into every projection.
      sortColumn: "lead_date",
      defaultLimit: 100,
      maxLimit: 500,
      // What a list row renders and needs to open a detail view. Deliberately
      // NOT lead_json: ~2 KB per row of survey answers and history that only
      // the detail screen reads. Dropping it takes a 100-row page from
      // ~264 KB to roughly 20 KB.
      columns: [
        "child_name",
        "guardian_name",
        "mobile",
        "class_sought_id",
        "stage",
        "source",
        "lead_date",
        "next_follow_up_at",
        "assigned_to",
        "enquiry_no",
        "application_no",
        "admission_no",
        "sis_student_id",
        "academic_year_code",
        "updated_at",
      ],
    },
  },
] as const;

const BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));

/**
 * Look up a collection. Returns undefined for an unknown id — callers must
 * turn that into a 404 rather than guessing, because the id arrives from a
 * URL and must never be interpolated anywhere on trust.
 */
export function collectionDef(id: string): CollectionDef | undefined {
  return BY_ID.get(id);
}

export function collectionIds(): readonly string[] {
  return COLLECTIONS.map((c) => c.id);
}
