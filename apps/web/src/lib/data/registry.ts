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
