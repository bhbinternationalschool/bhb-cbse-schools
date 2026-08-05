/**
 * Tenant-scoped tables to wipe for a fresh go-live import.
 * Order: child / line tables before parents. All rows filtered by tenant_id.
 *
 * NOT cleared: tenants, roles, profiles, user_role_assignments, classes,
 * sections, fee_heads, academic_years, school_profiles (migration foundation).
 */

/** Tables kept when --preserve-admissions */
export const ADMISSIONS_DESK_TABLES = [
  "admission_desk_registration_payments",
  "admission_desk_leads",
  "admission_desk_households",
  "admission_desk_field_ops",
  "admission_desk_sync_meta",
] as const;

/** Tables kept when --preserve-sis */
export const SIS_TABLES = [
  "sis_students",
  "sis_households",
  "sis_sync_meta",
] as const;

export type ClearPreserveOptions = {
  preserveMasters?: boolean;
  preserveAdmissions?: boolean;
  preserveSis?: boolean;
  preserveSuperAdminStaff?: boolean;
  superAdminOnly?: boolean;
};

/** SQL run before tenant-scoped deletes (tables without tenant_id column). */
export function specialDeleteSql(
  tenantId: string,
  opts: ClearPreserveOptions = {},
): string[] {
  return [
    `delete from public.erp_chat_messages
      where thread_id in (
        select id from public.erp_chat_threads where tenant_id = '${tenantId}'::uuid
      );`,
    `delete from public.erp_chat_threads where tenant_id = '${tenantId}'::uuid;`,
  ];
}

/** DELETE FROM … WHERE tenant_id = … (order matters for FK chains). */
export const TENANT_SCOPED_DELETE_ORDER: string[] = [
  // Fee desk — lines before vouchers
  "fee_desk_voucher_lines",
  "fee_desk_voucher_tenders",
  "fee_desk_charge_voucher_lines",
  "fee_desk_vouchers",
  "fee_desk_cheques",
  "fee_desk_manual_books",
  "fee_desk_day_closes",
  "fee_desk_charge_vouchers",
  "fee_desk_installment_plans",
  "fee_desk_plan_allocations",
  "fee_desk_carried_forward",
  "fee_desk_open_dues",
  "fee_desk_sync_meta",

  // Payment desk
  "payment_desk_link_lines",
  "payment_desk_gateway_events",
  "payment_desk_links",
  "payment_desk_sync_meta",

  // Admissions desk
  "admission_desk_registration_payments",
  "admission_desk_leads",
  "admission_desk_households",
  "admission_desk_field_ops",
  "admission_desk_sync_meta",

  // Attendance
  "attendance_desk_marks",
  "attendance_desk_registers",
  "attendance_desk_policy",
  "attendance_desk_absent_nudges",
  "attendance_desk_exceptions",
  "attendance_desk_sync_meta",

  // Staff attendance
  "staff_attendance_desk_marks",
  "staff_attendance_desk_registers",
  "staff_attendance_desk_settings",
  "staff_attendance_desk_sync_meta",

  // Exams
  "exam_desk_marks",
  "exam_desk_sheets",
  "exam_desk_date_sheet",
  "exam_desk_subjects",
  "exam_desk_terms",
  "exam_desk_policy",
  "exam_desk_promotions",
  "exam_desk_sync_meta",

  // Homework
  "homework_desk_submissions",
  "homework_desk_seen",
  "homework_desk_diary",
  "homework_desk_posts",
  "homework_desk_settings",
  "homework_desk_sync_meta",

  // PTM
  "ptm_desk_feedback",
  "ptm_desk_bookings",
  "ptm_desk_slots",
  "ptm_desk_events",
  "ptm_desk_sync_meta",

  // Student leave
  "student_leave_desk_requests",
  "student_leave_desk_sync_meta",

  // Vault
  "vault_desk_documents",
  "vault_desk_settings",
  "vault_desk_sync_meta",

  // Library
  "library_desk_issues",
  "library_desk_copies",
  "library_desk_titles",
  "library_desk_procurement_docs",
  "library_desk_settings",
  "library_desk_sync_meta",

  // Store
  "store_desk_issue_lines",
  "store_desk_sell_return_lines",
  "store_desk_issues",
  "store_desk_sell_returns",
  "store_desk_movements",
  "store_desk_inventory_allocations",
  "store_desk_asset_allocations",
  "store_desk_items",
  "store_desk_categories",
  "store_desk_sale_groups",
  "store_desk_uoms",
  "store_desk_infra_levels",
  "store_desk_sources",
  "store_desk_sync_meta",

  // Purchase
  "purchase_desk_indent_lines",
  "purchase_desk_order_lines",
  "purchase_desk_grn_lines",
  "purchase_desk_return_lines",
  "purchase_desk_indents",
  "purchase_desk_orders",
  "purchase_desk_grns",
  "purchase_desk_returns",
  "purchase_desk_settings",
  "purchase_desk_sync_meta",

  // Accounts desk
  "accounts_desk_journal_lines",
  "accounts_desk_journal_entries",
  "accounts_desk_recon_lines",
  "accounts_desk_recon_sessions",
  "accounts_desk_expense_voucher_lines",
  "accounts_desk_expense_vouchers",
  "accounts_desk_vendor_bill_lines",
  "accounts_desk_vendor_bills",
  "accounts_desk_owner_loan_schedule",
  "accounts_desk_owner_loans",
  "accounts_desk_owner_cash_handovers",
  "accounts_desk_payables",
  "accounts_desk_bank_ledger",
  "accounts_desk_cash_ledger",
  "accounts_desk_mode_bank_map",
  "accounts_desk_recurring_rules",
  "accounts_desk_expense_categories",
  "accounts_desk_vendors",
  "accounts_desk_trustees",
  "accounts_desk_coa_accounts",
  "accounts_desk_fiscal_years",
  "accounts_desk_bank_accounts",
  "accounts_desk_cash_pools",
  "accounts_desk_settings",
  "accounts_desk_sync_meta",

  // Payroll
  "payroll_desk_run_lines",
  "payroll_desk_audit",
  "payroll_desk_runs",
  "payroll_desk_sync_meta",

  // School comms / gallery
  "school_comms_desk_photos",
  "school_comms_desk_albums",
  "school_comms_desk_news",
  "school_comms_desk_notices",
  "school_comms_desk_sync_meta",

  // Notifications
  "notifications_desk_items",
  "notifications_desk_sync_meta",

  // RTE
  "rte_desk_applications",
  "rte_desk_seats",
  "rte_desk_settings",
  "rte_desk_sync_meta",

  // Slice desks
  "transport_desk_slices",
  "transport_desk_sync_meta",
  "timetable_desk_slices",
  "timetable_desk_sync_meta",
  "trust_desk_slices",
  "trust_desk_sync_meta",
  "wa_desk_bot_slices",
  "wa_desk_sync_meta",
  "rbac_desk_slices",
  "rbac_desk_sync_meta",
  "certificates_desk_slices",
  "certificates_desk_sync_meta",
  "exam_papers_desk_slices",
  "exam_papers_desk_sync_meta",
  "wa_templates_desk_slices",
  "wa_templates_desk_sync_meta",
  "staff_hr_desk_slices",
  "staff_hr_desk_sync_meta",
  "staff_advances_desk_slices",
  "staff_advances_desk_sync_meta",
  // staff_agreements_* — add after migration is applied on Supabase
  "module_registry_desk_slices",
  "module_registry_desk_sync_meta",
  "fee_recovery_tasks_desk_slices",
  "fee_recovery_tasks_desk_sync_meta",
  "automation_desk_slices",
  "automation_desk_sync_meta",
  "erp_chat_desk_slices",
  "erp_chat_desk_sync_meta",
  "staff_chat_desk_slices",
  "staff_chat_desk_sync_meta",

  // Masters desk (optional — stripped by --preserve-masters)
  "masters_desk_slices",
  "masters_desk_sync_meta",

  // SIS + staff roster (students before households)
  "sis_students",
  "sis_households",
  "sis_sync_meta",
  "sis_staff",
  "sis_designations",
  "sis_departments",

  // Curriculum
  "student_curriculum",
  "curriculum_requests",
];

export function protectedSuperAdminEmailsFromEnv(): string[] {
  const defaults = [
    "director@bhbinternational.school",
    "ashishsingh80@gmail.com",
    "ashu.dube21@gmail.com",
  ];
  const raw = process.env.PROTECTED_SUPER_ADMIN_EMAILS ?? "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...defaults.map((e) => e.toLowerCase()), ...fromEnv])];
}

export function staffDeleteSql(
  tenantId: string,
  preserveSuperAdminStaff: boolean,
): string | null {
  if (!preserveSuperAdminStaff) {
    return `DELETE FROM public.sis_staff WHERE tenant_id = '${tenantId}'::uuid;`;
  }
  const emails = protectedSuperAdminEmailsFromEnv()
    .map((e) => `'${e.replace(/'/g, "''")}'`)
    .join(", ");
  return `DELETE FROM public.sis_staff
    WHERE tenant_id = '${tenantId}'::uuid
      AND lower(trim(email)) NOT IN (${emails});`;
}

export function buildTenantDeleteTables(
  opts: ClearPreserveOptions = {},
): string[] {
  let tables = [...TENANT_SCOPED_DELETE_ORDER];
  if (opts.preserveMasters) {
    tables = tables.filter(
      (t) => t !== "masters_desk_slices" && t !== "masters_desk_sync_meta",
    );
  }
  if (opts.preserveAdmissions) {
    tables = tables.filter((t) => !ADMISSIONS_DESK_TABLES.includes(t as never));
  }
  if (opts.preserveSis) {
    tables = tables.filter((t) => !SIS_TABLES.includes(t as never));
    tables = tables.filter(
      (t) =>
        t !== "sis_staff" &&
        t !== "sis_departments" &&
        t !== "sis_designations",
    );
  }
  return tables;
}

export function buildBlobTables(opts: ClearPreserveOptions = {}): BlobTableName[] {
  let tables = [...BLOB_TABLES];
  if (opts.preserveAdmissions) {
    tables = tables.filter((t) => t !== "admissions_state");
  }
  if (opts.preserveSis) {
    tables = tables.filter((t) => t !== "school_mirror_state");
  }
  return tables;
}

/** Cleared when --super-admin-only (migration shell kept: tenant + roles). */
export const FOUNDATION_DELETE_ORDER = [
  "classes",
  "fee_heads",
  "academic_years",
  "school_profiles",
  "campuses",
] as const;

export function foundationMastersDeleteSql(tenantId: string): string {
  return [
    "BEGIN;",
    `DELETE FROM public.sections
      WHERE class_id IN (
        SELECT id FROM public.classes WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.special_fee_assignment_students
      WHERE assignment_id IN (
        SELECT sfa.id FROM public.special_fee_assignments sfa
        JOIN public.special_fees sf ON sf.id = sfa.special_fee_id
        WHERE sf.tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.special_fee_assignment_classes
      WHERE assignment_id IN (
        SELECT sfa.id FROM public.special_fee_assignments sfa
        JOIN public.special_fees sf ON sf.id = sfa.special_fee_id
        WHERE sf.tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.special_fee_assignments
      WHERE special_fee_id IN (
        SELECT id FROM public.special_fees WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.special_fees WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.concession_rule_fee_heads
      WHERE concession_id IN (
        SELECT id FROM public.concession_rules WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.concession_incompatibilities
      WHERE concession_id IN (
        SELECT id FROM public.concession_rules WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.concession_grants WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.concession_rules WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.concession_kinds WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.fee_structure_lines
      WHERE fee_group_id IN (
        SELECT id FROM public.fee_groups WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.fee_group_classes
      WHERE fee_group_id IN (
        SELECT id FROM public.fee_groups WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.fee_groups WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.fee_installments WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.late_fee_rules WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.fee_heads WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.classes WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.academic_years WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.school_profiles WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.campuses WHERE tenant_id = '${tenantId}'::uuid;`,
    "COMMIT;",
  ].join("\n");
}

export function foundationDeleteSql(tenantId: string, keepEmails: string[]): string {
  const emailSql = keepEmails
    .map((e) => `'${e.replace(/'/g, "''")}'`)
    .join(", ");
  return [
    "BEGIN;",
    `DELETE FROM public.sections
      WHERE class_id IN (
        SELECT id FROM public.classes WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.special_fee_assignment_students
      WHERE assignment_id IN (
        SELECT sfa.id FROM public.special_fee_assignments sfa
        JOIN public.special_fees sf ON sf.id = sfa.special_fee_id
        WHERE sf.tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.special_fee_assignment_classes
      WHERE assignment_id IN (
        SELECT sfa.id FROM public.special_fee_assignments sfa
        JOIN public.special_fees sf ON sf.id = sfa.special_fee_id
        WHERE sf.tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.special_fee_assignments
      WHERE special_fee_id IN (
        SELECT id FROM public.special_fees WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.special_fees WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.concession_rule_fee_heads
      WHERE concession_id IN (
        SELECT id FROM public.concession_rules WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.concession_incompatibilities
      WHERE concession_id IN (
        SELECT id FROM public.concession_rules WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.concession_grants WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.concession_rules WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.concession_kinds WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.fee_structure_lines
      WHERE fee_group_id IN (
        SELECT id FROM public.fee_groups WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.fee_group_classes
      WHERE fee_group_id IN (
        SELECT id FROM public.fee_groups WHERE tenant_id = '${tenantId}'::uuid
      );`,
    `DELETE FROM public.fee_groups WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.fee_installments WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.late_fee_rules WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.fee_heads WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.classes WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.academic_years WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.school_profiles WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.campuses WHERE tenant_id = '${tenantId}'::uuid;`,
    `DELETE FROM public.user_role_assignments
      WHERE profile_id IN (
        SELECT id FROM public.profiles
        WHERE tenant_id = '${tenantId}'::uuid
          AND lower(trim(coalesce(email, ''))) NOT IN (${emailSql})
      );`,
    `DELETE FROM public.profiles
      WHERE tenant_id = '${tenantId}'::uuid
        AND lower(trim(coalesce(email, ''))) NOT IN (${emailSql});`,
    "COMMIT;",
  ].join("\n");
}

/** Jsonb blob tables — reset to empty state (one row per tenant). */
export const BLOB_TABLES = [
  "school_mirror_state",
  "wa_bot_threads_state",
  "fees_state",
  "payments_state",
  "attendance_state",
  "exams_state",
  "admissions_state",
  "staff_attendance_state",
  "homework_state",
  "ptm_state",
  "student_leave_state",
  "vault_state",
  "library_state",
  "store_state",
  "purchase_state",
  "accounts_state",
  "payroll_state",
  "school_comms_state",
  "notifications_state",
  "rte_state",
  "timetable_state",
  "trust_state",
  "transport_state",
  "rbac_state",
  "certificates_state",
  "exam_papers_state",
  "wa_templates_state",
  "staff_hr_state",
  "staff_advances_state",
  // staff_agreements_state — add after migration is applied on Supabase
  "module_registry_state",
  "fee_recovery_tasks_state",
  "automation_state",
  "erp_chat_state",
  "staff_chat_state",
] as const;

export type BlobTableName = (typeof BLOB_TABLES)[number];
