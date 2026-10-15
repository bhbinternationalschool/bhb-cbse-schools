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
 * (migration 20260810010000; since data-layer 1.5 with the `sync_meta_table`
 * it bumps) before writes reach the database — two deliberate steps, in two
 * systems, so neither can be done absent-mindedly. A `slice` / `object`
 * collection is limited instead by the RPCs' own list of the 16
 * `*_desk_slices` tables (migration 20261014220000).
 */

import type { RbacModule } from "@/lib/rbac";
import type { ApprovalRule } from "@/lib/data/approvalGate";

/** Scope filters the repo will refuse to build a query without. */
export type ScopeKey = "tenant_id" | "academic_year_code";

/**
 * Where a collection's records live (data-layer 1.5, rule R4).
 *
 *  - `rows` (the default): one table, one record per row; writes go through
 *    `desk_write_guarded` (base = the row's `updated_at`).
 *  - `slice`: the elements of one jsonb list in a `*_desk_slices` table;
 *    each write is ONE element through `desk_slice_row_write`. `base` says
 *    what a write's base is: `"slice"` — the slice's `updated_at`, shared by
 *    every element (Masters, timetable); `"rev"` — the element's own `_rev`
 *    (transport, trust, the desk-slice modules). `keyField` is the element's
 *    key (`id` unless lib/deskSliceRegistry says otherwise).
 *  - `object`: one object slice (Masters' schoolProfile, …), written whole
 *    through `desk_slice_object_write`, base = the slice's `updated_at`.
 */
export type SliceSource = {
  readonly table: string;
  readonly key: string;
  readonly keyField?: string;
  readonly base: "slice" | "rev";
};

/**
 * How a staff session that is NOT school-wide (a teacher: no leadership or
 * owner/principal/admin/office role, and no `edit` on the collection's
 * module) reads the collection. Unset = no restriction beyond `rbac.view`.
 *  - `section`: only rows whose (class_id, section_id) is in the session's
 *    staffSectionScope (lib/api/v1/staffScope.ts);
 *  - `household`: only the households of those students;
 *  - `deny`: 403 — the collection cannot be scoped to a teacher.
 * An unknown scope is a 503 (R6), never the whole school.
 */
export type TeacherScope = "section" | "household" | "deny";

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
   * Writes that are a DECISION rather than data entry, and need `approve` on
   * top of `edit`. Enforced in the write route, so hiding a button is not
   * mistaken for a rule. See lib/data/approvalGate.ts.
   */
  readonly approval?: ApprovalRule;
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
  /** Where the records live; `rows` when absent. See SliceSource. */
  readonly kind?: "rows" | "slice" | "object";
  /** For `slice` and `object` collections: which slice. */
  readonly slice?: SliceSource;
  /** See TeacherScope. */
  readonly teacherScope?: TeacherScope;
  /**
   * After a write that changed something, these server caches are dropped so
   * the next read cannot serve the pre-write body: probe-gated response
   * caches by key (lib/deskProbeCache.server.ts) and reference caches
   * (lib/api/v1/auth.ts).
   */
  readonly invalidates?: {
    readonly probeCaches?: readonly string[];
    readonly reference?: readonly ("masters" | "rbac")[];
  };
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
    // Tenant-scoped ONLY, and this is not an oversight.
    //
    // The obvious reading — "students belong to a session, so scope by it" —
    // is what this said, and it was wrong. Measured 2026-08-10:
    // sis_students.academic_year_code does NOT track the current session. Of
    // 680 active students it reads 2026-27 for 238, 2025-26 for 213, 2024-25
    // for 142 and 2023-24 for 88 — while every one of those groups holds
    // currently-enrolled children spread across Nursery to X, all with
    // earliest_joined 2023-01-01. It records when the record was created or
    // imported and was never advanced.
    //
    // So scoping a roster by it would have hidden 442 of 680 active students
    // and looked like data loss. Nothing consumes this collection yet, which
    // is the only reason it never shipped that way.
    //
    // Correct the column's meaning before adding the scope back. Until then a
    // roster query is tenant-wide and callers filter by class or status.
    scope: ["tenant_id"],
    // Hard delete: removing a student is deliberate and rare, and the audit
    // entry is the surviving record (see StudentsWorkspace.onRemove). It
    // cascades (transport point, fee-hold items and decisions — production
    // FKs, 14 Oct 2026), so it is a decision: `approve` on top of `edit`
    // (data-layer 1.5). sis_students has no deleted_at to soft-delete into.
    softDelete: false,
    approval: {
      module: "students",
      onDelete: true,
      message:
        "Removing a student needs the students Approve permission. Ask the principal to remove the record.",
    },
    // A teacher reads only the children of the sections they teach (1.7).
    teacherScope: "section",
    invalidates: { probeCaches: ["sis-roster"] },
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
    // Removing a family cascades too (village, transport pin request): a
    // decision, as for students.
    approval: {
      module: "students",
      onDelete: true,
      message:
        "Removing a family needs the students Approve permission. Ask the principal to remove the record.",
    },
    teacherScope: "household",
    invalidates: { probeCaches: ["sis-roster"] },
    list: { sortColumn: "code", defaultLimit: 100, maxLimit: 500 },
  },

  // ── Masters ────────────────────────────────────────────────────────────
  // The truth is masters_desk_slices: masters_sync_rows_from_slices rewrites
  // the masters_desk_* row tables from it on every save and deletes any row
  // the slice lacks. So since data-layer 1.5 these collections ARE the
  // slices: a read returns the slice's elements (camelCase, as the app holds
  // them) with the slice stamp as `revision`, and a write changes ONE element
  // through desk_slice_row_write — which re-syncs the row tables and bumps
  // masters_desk_sync_meta in the same transaction. Writing the row tables
  // directly was possible until 1.5 and was silently undone by the next save;
  // the migration took them off desk_writable_tables.
  //
  // Scope: tenant only. Masters is read whole — the session selector lists
  // every academic year, fee structures are compared across years, and a
  // class outlives any one session.
  //
  // Staff-owned lists (staff, departments, designations) and the students
  // projection are not here: the RPC refuses them.
  ...(
    [
      ["classes", "masters_desk_classes", "classes"],
      ["sections", "masters_desk_sections", "sections"],
      ["campuses", "masters_desk_campuses", "campuses"],
      ["academic-years", "masters_desk_academic_years", "academicYears"],
      ["academic-terms", "masters_desk_academic_terms", "academicTerms"],
      ["subjects", "masters_desk_subjects", "subjects"],
      ["class-subjects", "masters_desk_class_subjects", "classSubjects"],
      ["fee-head-categories", "masters_desk_fee_head_categories", "feeHeadCategories"],
      ["fee-heads", "masters_desk_fee_heads", "feeHeads"],
      ["installments", "masters_desk_installments", "installments"],
      ["fee-groups", "masters_desk_fee_groups", "feeGroups"],
      ["fee-structure-lines", "masters_desk_fee_structure_lines", "feeStructureLines"],
      ["late-fee-rules", "masters_desk_late_fee_rules", "lateFeeRules"],
      ["special-fees", "masters_desk_special_fees", "specialFees"],
      ["special-fee-assignments", "masters_desk_special_fee_assignments", "specialFeeAssignments"],
      ["concession-kinds", "masters_desk_concession_kinds", "concessionKinds"],
      ["concessions", "masters_desk_concessions", "concessions"],
      ["concession-grants", "masters_desk_concession_grants", "concessionGrants"],
      ["senior-streams", "masters_desk_senior_streams", "seniorStreams"],
      ["number-series", "masters_desk_number_series", "numberSeries"],
      ["holidays", "masters_desk_holidays", "holidays"],
    ] as const
  ).map(
    ([name, table, sliceKey]): CollectionDef => ({
      id: `masters.${name}`,
      module: "masters",
      // The derived row table, kept for reference (and for its name in logs);
      // reads and writes go to the slice.
      table,
      kind: "slice",
      slice: { table: "masters_desk_slices", key: sliceKey, base: "slice" },
      rbac: { view: "masters", edit: "masters" },
      scope: ["tenant_id"],
      // Masters elements are referenced by student, lead and fee records by
      // id; a delete removes the element (the write needs the slice stamp).
      softDelete: false,
      invalidates: { probeCaches: ["masters-desk-rows"], reference: ["masters"] },
      list: { sortColumn: "id", defaultLimit: 500, maxLimit: 1000 },
    }),
  ),
  ...(
    [
      ["school-profile", "schoolProfile"],
      ["school-timing", "schoolTiming"],
      ["mid-year-fee-policy", "midYearFeePolicy"],
      ["statutory-config", "statutoryConfig"],
    ] as const
  ).map(
    ([name, sliceKey]): CollectionDef => ({
      id: `masters.${name}`,
      module: "masters",
      table: "masters_desk_settings",
      kind: "object",
      slice: { table: "masters_desk_slices", key: sliceKey, base: "slice" },
      rbac: { view: "masters", edit: "masters" },
      scope: ["tenant_id"],
      softDelete: false,
      invalidates: { probeCaches: ["masters-desk-rows"], reference: ["masters"] },
      list: { sortColumn: "id", defaultLimit: 1, maxLimit: 1 },
    }),
  ),
  // ── Website (Phase 1) ──────────────────────────────────────────────────
  // Server-authoritative from the first commit, unlike most desks here. A
  // parent, a search engine and an admissions enquiry all read the public
  // page and none of them has a localStorage — and a stale tab pushing an
  // empty state is what emptied the Transport desk on 2026-08-21.
  //
  // Tenant-scoped only: a website is not a thing that belongs to an academic
  // session. Scoping by year would hide last year's About page every April.
  // ── UDISE+ working sheet ─────────────────────────────────────────────
  // Reconciling a UDISE+ export takes days, and the sheet must follow the
  // login rather than one browser. Rows are stored AS UPLOADED; the matched
  // table the office sees is derived from them against SIS every time, so a
  // child settled since the upload reports itself settled instead of being
  // shown again.
  {
    id: "udise.sheets",
    module: "students",
    table: "udise_upload_sheets",
    rbac: { view: "students", edit: "students" },
    scope: ["tenant_id"],
    // The whole school's UDISE+ export: not scopable to a teacher's sections.
    teacherScope: "deny",
    // "Start a fresh sheet" must be undoable — a day's reconciliation is not
    // something to lose to a misclick.
    softDelete: true,
    list: { sortColumn: "id", defaultLimit: 20, maxLimit: 50 },
  },
  {
    id: "udise.rows",
    module: "students",
    table: "udise_upload_rows",
    rbac: { view: "students", edit: "students" },
    scope: ["tenant_id"],
    teacherScope: "deny",
    softDelete: true,
    // A UDISE+ export runs to the whole school. The ceiling is the registry's
    // own maximum, and the reader pages to it rather than asking for
    // everything — PostgREST truncates at 1000 and calls it success.
    list: { sortColumn: "id", defaultLimit: 1000, maxLimit: 1000 },
  },
  {
    id: "site.pages",
    module: "website",
    table: "site_pages",
    rbac: { view: "website", edit: "website" },
    // Author drafts, director approves — the decision taken on 2026-08-30.
    // Saving a draft stays ordinary work; putting a page in front of the
    // public, now or on a schedule, is the decision. Scheduling counts: it is
    // publishing with a delay, and the delay is not what makes it safe.
    // Taking a page DOWN needs no approval, deliberately.
    approval: {
      module: "website",
      whenEquals: { status: ["published", "scheduled"] },
      whenSet: ["published_at", "scheduled_publish_at"],
      message:
        "Only the director can publish a page to the website. Save it as a draft and ask for it to be approved.",
    },
    scope: ["tenant_id"],
    // "Someone deleted the About page" has to be answerable, so the row
    // stays and Phase 7 restores from it.
    softDelete: true,
    // Sorted by slug rather than title: the slug is unique among live pages,
    // which is what keyset paging needs, and two pages may share a title.
    list: { sortColumn: "slug", defaultLimit: 200, maxLimit: 500 },
  },
  {
    id: "site.blocks",
    module: "website",
    table: "site_blocks",
    rbac: { view: "website", edit: "website" },
    scope: ["tenant_id"],
    softDelete: true,
    // A long page is perhaps 30 blocks. The ceiling is the registry's own
    // maximum, not a guess at how big the site might get — a page size with
    // no real bound is how the admissions payload reached 2.37 MB.
    list: { sortColumn: "id", defaultLimit: 500, maxLimit: 1000 },
  },
  {
    id: "site.media",
    module: "website",
    table: "site_media",
    rbac: { view: "website", edit: "website" },
    scope: ["tenant_id"],
    // A media row may still be referenced by a block on a live page, so
    // removing it must not orphan that block silently.
    softDelete: true,
    list: { sortColumn: "id", defaultLimit: 200, maxLimit: 1000 },
  },
  {
    id: "site.menu",
    module: "website",
    table: "site_menu",
    rbac: { view: "website", edit: "website" },
    scope: ["tenant_id"],
    // A menu entry carries nothing of its own; deleting one loses no record.
    softDelete: false,
    list: { sortColumn: "id", defaultLimit: 100, maxLimit: 200 },
  },
  {
    id: "site.publications",
    module: "website",
    table: "site_publications",
    rbac: { view: "website", edit: "website" },
    scope: ["tenant_id"],
    // Unpublishing is a status change, not a deletion — the decision to have
    // shown something publicly is itself worth keeping.
    softDelete: false,
    list: { sortColumn: "id", defaultLimit: 200, maxLimit: 1000 },
  },

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
  {
    // Field survey team (15 Oct 2026, migration 20261015120000). Written by
    // lib/surveyTeam.server.ts (office screen + team leader's phone), which
    // checks who may change what; through this generic route only an
    // Admissions editor can write, as for any other collection.
    id: "admissions.survey-members",
    module: "admissions",
    table: "admission_survey_members",
    rbac: { view: "admissions", edit: "admissions" },
    scope: ["tenant_id"],
    // A member removed from the team carries no record of their own (their
    // survey days and captures live in survey_days / survey_captures).
    softDelete: false,
    list: { sortColumn: "id", defaultLimit: 200, maxLimit: 500 },
  },
  {
    // Field survey beats. Retired with is_active, never deleted in the UI:
    // leads point at their beat by id.
    id: "admissions.survey-beats",
    module: "admissions",
    table: "admission_survey_beats",
    rbac: { view: "admissions", edit: "admissions" },
    scope: ["tenant_id"],
    softDelete: false,
    list: { sortColumn: "id", defaultLimit: 200, maxLimit: 500 },
  },
] as const;

const BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));

/** `rows` unless the entry says otherwise. */
export function collectionKind(def: CollectionDef): "rows" | "slice" | "object" {
  return def.kind ?? "rows";
}

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
