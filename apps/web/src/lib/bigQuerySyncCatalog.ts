/**
 * Supabase Postgres → BigQuery nightly sync catalog.
 * One BQ table per Postgres desk table; rows include tenant_slug + _synced_at.
 */

export type BigQuerySyncTableDef = {
  /** Stable id for logs */
  id: string;
  pgTable: string;
  bqTable: string;
  description: string;
  /** Optional ORDER BY for stable exports */
  orderBy?: string;
};

export const BIGQUERY_SYNC_TABLES: BigQuerySyncTableDef[] = [
  {
    id: "fee_vouchers",
    pgTable: "fee_desk_vouchers",
    bqTable: "fee_desk_vouchers",
    description: "Fee receipts (counter + online)",
    orderBy: "collection_date desc, id",
  },
  {
    id: "fee_voucher_lines",
    pgTable: "fee_desk_voucher_lines",
    bqTable: "fee_desk_voucher_lines",
    description: "Fee receipt line items",
    orderBy: "voucher_id, due_key",
  },
  {
    id: "fee_voucher_tenders",
    pgTable: "fee_desk_voucher_tenders",
    bqTable: "fee_desk_voucher_tenders",
    description: "Fee payment modes per receipt",
    orderBy: "voucher_id, tender_index",
  },
  {
    id: "sis_students",
    pgTable: "sis_students",
    bqTable: "sis_students",
    description: "Student register",
    orderBy: "admission_no",
  },
  {
    id: "sis_households",
    pgTable: "sis_households",
    bqTable: "sis_households",
    description: "Parent households",
    orderBy: "code",
  },
  {
    id: "admission_leads",
    pgTable: "admission_desk_leads",
    bqTable: "admission_desk_leads",
    description: "Admissions CRM leads",
    orderBy: "updated_at desc",
  },
  {
    id: "attendance_registers",
    pgTable: "attendance_desk_registers",
    bqTable: "attendance_desk_registers",
    description: "Daily attendance registers",
    orderBy: "attendance_date desc",
  },
  {
    id: "attendance_marks",
    pgTable: "attendance_desk_marks",
    bqTable: "attendance_desk_marks",
    description: "Per-student attendance marks",
    orderBy: "register_id, student_id",
  },
  {
    id: "sis_staff",
    pgTable: "sis_staff",
    bqTable: "sis_staff",
    description: "Staff roster",
    orderBy: "emp_code",
  },
];
