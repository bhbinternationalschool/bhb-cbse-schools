/**
 * DomainBlobTable -> RbacModule mapping, used to gate the generic
 * domain-blob API route with the same per-module permission the rest
 * of the desk routes enforce (see SCHOOL_DATA_DESK_RBAC / DESK_SLICE_RBAC
 * in apiRouteAuth.server.ts).
 */

import type { DomainBlobTable } from "@/lib/domainBlobPersistence";
import type { RbacModule } from "@/lib/rbac";

export const DOMAIN_BLOB_RBAC: Record<DomainBlobTable, RbacModule> = {
  fees_state: "fees",
  payments_state: "fees",
  attendance_state: "attendance",
  exams_state: "exams",
  payroll_state: "payroll",
  salary_setup_state: "payroll",
  accounts_state: "accounts",
  store_state: "store",
  purchase_state: "purchase",
  staff_attendance_state: "attendance",
  staff_hr_state: "staff",
  staff_advances_state: "staff_advances",
  staff_agreements_state: "staff",
  rbac_state: "settings",
  module_registry_state: "settings",
  trust_state: "trust",
  transport_state: "transport",
  homework_state: "homework",
  timetable_state: "timetable",
  teaching_state: "teaching",
  exam_papers_state: "exams",
  ptm_state: "ptm",
  student_leave_state: "student_leave",
  certificates_state: "certificates",
  vault_state: "vault",
  rte_state: "rte",
  fee_recovery_tasks_state: "fees",
  school_comms_state: "notices",
  notifications_state: "notifications",
  staff_chat_state: "settings",
  erp_chat_state: "settings",
  wa_templates_state: "wa_templates",
  automation_state: "wa_automation",
  admissions_state: "admissions",
  library_state: "store",
};

export function domainBlobRbacModule(table: string): RbacModule | null {
  return (DOMAIN_BLOB_RBAC as Record<string, RbacModule>)[table] ?? null;
}
