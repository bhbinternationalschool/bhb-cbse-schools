/**
 * The tables each probe-cached desk GET fingerprints (lib/deskProbeCache).
 *
 * A probe list must name EVERY table the route's body is built from: a table
 * left out can change without moving the fingerprint, and the cached body —
 * with the old rows — is served until something listed changes. Until
 * 13 Oct 2026 (data-layer 0.5f) a day close, an installment plan or an
 * attendance policy change was invisible this way, and so were student tags
 * and class moves.
 *
 * Every name here must also be in the `desk_probe` SQL allowlist (newest
 * migration defining it): an unlisted table makes the RPC raise, the probe
 * fails open, and the route re-reads the whole desk on every request
 * (the 9 Oct 2026 incident). test:desk-probe-allowlist checks both lists.
 *
 * The probe is count(*) + max(updated_at) per table. Tables without
 * updated_at are probed by count only: fee_desk_plan_allocations (only ever
 * inserted, or deleted with a voided receipt) and fee_desk_charge_voucher_lines
 * (replaced together with their charge voucher, whose updated_at moves).
 */
export const FEES_VOUCHERS_PROBE_TABLES: readonly string[] = [
  "fee_desk_vouchers",
  "fee_desk_voucher_lines",
  "fee_desk_voucher_tenders",
  "fee_desk_open_dues",
  // desk.ancillary (lib/feesDeskAncillary.server.ts)
  "fee_desk_cheques",
  "fee_desk_day_closes",
  "fee_desk_installment_plans",
  "fee_desk_plan_allocations",
  "fee_desk_carried_forward",
  "fee_desk_charge_vouchers",
  "fee_desk_charge_voucher_lines",
  "fee_desk_manual_books",
];

export const ATTENDANCE_REGISTERS_PROBE_TABLES: readonly string[] = [
  "attendance_desk_registers",
  "attendance_desk_marks",
  // desk.ancillary (lib/attendanceDeskAncillary.server.ts)
  "attendance_desk_policy",
  "attendance_desk_exceptions",
  "attendance_desk_absent_nudges",
];

export const SIS_ROSTER_PROBE_TABLES: readonly string[] = [
  "sis_students",
  "sis_households",
  "sis_enrollments",
  "sis_student_identities",
  // bundle.tags / bundle.classUpgrades (lib/sisNormalized.server.ts)
  "sis_student_tags",
  "sis_class_upgrades",
];
