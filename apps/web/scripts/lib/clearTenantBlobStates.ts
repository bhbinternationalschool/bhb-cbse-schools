/**
 * Empty jsonb blob payloads after desk wipe (prevents ensure:desk backfill).
 */

import type { BlobTableName } from "./clearTenantDataTables";
import { defaultAdmissionsState } from "@/lib/admissions";
import { emptyAttendanceState } from "@/lib/attendance";
import { emptyAutomation } from "@/lib/automation";
import { emptyCertificatesState } from "@/lib/certificates";
import { emptyErpChatState } from "@/lib/erpChat";
import { emptyExamPapersState } from "@/lib/examPapers";
import { defaultExamPolicy } from "@/lib/exams";
import { emptyFeeRecoveryTasks } from "@/lib/feeRecoveryTasks";
import { emptyFeesState } from "@/lib/fees";
import { emptyHomeworkState } from "@/lib/homework";
import { emptyLibraryState } from "@/lib/library";
import { defaultMasters } from "@/lib/masters";
import { emptyNotifications } from "@/lib/notifications";
import { emptyPaymentsState } from "@/lib/payments";
import { emptyPtmState } from "@/lib/ptm";
import { emptyPurchaseState } from "@/lib/purchase";
import { defaultBuiltInRoles } from "@/lib/rbac";
import { emptyRteState } from "@/lib/rteEws";
import { emptySchoolComms } from "@/lib/schoolComms";
import { emptySisState } from "@/lib/sis";
import { emptyStaffAttendanceState } from "@/lib/staffAttendance";
import { emptyStaffChatState } from "@/lib/staffInternalChat";
import { emptyStaffHrState } from "@/lib/staffHr";
import { emptyStoreState } from "@/lib/store";
import { emptyStudentLeaveState } from "@/lib/studentLeave";
import { emptyTimetableState } from "@/lib/timetable";
import { emptyTransportState } from "@/lib/transport";
import { emptyTrustState } from "@/lib/trust";
import { emptyVaultState } from "@/lib/vault";
import { emptyWaTemplates } from "@/lib/waTemplates";

function emptyMirrorMasters() {
  const base = defaultMasters();
  return {
    ...base,
    version: 2 as const,
    classes: [],
    sections: [],
    feeHeads: [],
    feeGroups: [],
    feeStructureLines: [],
    installments: [],
    lateFeeRules: [],
    concessions: [],
    concessionGrants: [],
    specialFees: [],
    specialFeeAssignments: [],
    subjects: [],
    classSubjects: [],
    staff: [],
    departments: [],
    designations: [],
    holidays: [],
    academicTerms: [],
  };
}

function emptyMirrorState() {
  const now = new Date().toISOString();
  return {
    version: 1 as const,
    updatedAt: now,
    sis: emptySisState(),
    fees: emptyFeesState(),
    payments: emptyPaymentsState(),
    masters: emptyMirrorMasters(),
    admissions: defaultAdmissionsState(),
  };
}

function emptyWaBotBundle() {
  return {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    crm: null,
    sis: null,
    survey: null,
    classChannel: null,
    unified: null,
    hub: null,
    staffAtt: null,
  };
}

function emptyRbacBlob() {
  return {
    version: 1 as const,
    roles: defaultBuiltInRoles(),
    assignments: [] as unknown[],
    audit: [
      {
        id: `audit_clear_${Date.now()}`,
        at: new Date().toISOString(),
        by: "clear-tenant-data",
        action: "reset_rbac_blob",
        detail: "Tenant transactional wipe",
      },
    ],
  };
}

function emptyExamsBlob() {
  return {
    version: 1 as const,
    terms: [] as unknown[],
    subjects: [] as unknown[],
    dateSheet: [] as unknown[],
    sheets: [] as unknown[],
    policy: defaultExamPolicy(),
    promotions: [] as unknown[],
  };
}

function emptyAccountsBlob() {
  return {
    version: 1 as const,
    cashPools: [],
    cashLedger: [],
    bankAccounts: [],
    bankLedger: [],
    modeBankMap: [],
    reconSessions: [],
    expenseCategories: [],
    expenseVouchers: [],
    recurringRules: [],
    vendors: [],
    vendorBills: [],
    payables: [],
    trustees: [],
    ownerLoans: [],
    ownerLoanSchedule: [],
    ownerCashHandovers: [],
    coaAccounts: [],
    journalEntries: [],
    fiscalYears: [],
    settings: {},
  };
}

const BLOB_FACTORIES: Record<BlobTableName, () => unknown> = {
  school_mirror_state: emptyMirrorState,
  wa_bot_threads_state: emptyWaBotBundle,
  fees_state: emptyFeesState,
  payments_state: emptyPaymentsState,
  attendance_state: emptyAttendanceState,
  exams_state: emptyExamsBlob,
  admissions_state: defaultAdmissionsState,
  staff_attendance_state: emptyStaffAttendanceState,
  homework_state: emptyHomeworkState,
  ptm_state: emptyPtmState,
  student_leave_state: emptyStudentLeaveState,
  vault_state: emptyVaultState,
  library_state: emptyLibraryState,
  store_state: emptyStoreState,
  purchase_state: emptyPurchaseState,
  accounts_state: emptyAccountsBlob,
  payroll_state: () => ({ version: 2, runs: [], audit: [] }),
  school_comms_state: emptySchoolComms,
  notifications_state: emptyNotifications,
  rte_state: emptyRteState,
  timetable_state: emptyTimetableState,
  trust_state: emptyTrustState,
  transport_state: emptyTransportState,
  rbac_state: emptyRbacBlob,
  certificates_state: emptyCertificatesState,
  exam_papers_state: emptyExamPapersState,
  wa_templates_state: emptyWaTemplates,
  staff_hr_state: emptyStaffHrState,
  staff_advances_state: () => ({ version: 1, advances: [] }),
  module_registry_state: () => ({ version: 1, enabled: {} }),
  fee_recovery_tasks_state: emptyFeeRecoveryTasks,
  automation_state: emptyAutomation,
  erp_chat_state: emptyErpChatState,
  staff_chat_state: emptyStaffChatState,
};

export function emptyBlobState(table: BlobTableName): unknown {
  const factory = BLOB_FACTORIES[table];
  if (!factory) {
    console.warn(`[clear-tenant-data] no empty factory for ${table}, using {version:1}`);
    return { version: 1 };
  }
  return factory();
}
