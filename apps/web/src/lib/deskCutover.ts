/**
 * Track C desk cutover — read-from-DB flags and readiness checks.
 */

import { admissionsDualWriteDbEnabled, admissionsReadFromDbEnabled } from "@/lib/admissionsDbConfig";
import {
  attendanceDualWriteDbEnabled,
  attendanceReadFromDbEnabled,
} from "@/lib/attendanceDbConfig";
import { examsDualWriteDbEnabled, examsReadFromDbEnabled } from "@/lib/examsDbConfig";
import { feesDualWriteDbEnabled, feesReadFromDbEnabled } from "@/lib/feesDbConfig";
import {
  homeworkDualWriteDbEnabled,
  homeworkReadFromDbEnabled,
} from "@/lib/homeworkDbConfig";
import { paymentsDualWriteDbEnabled, paymentsReadFromDbEnabled } from "@/lib/paymentsDbConfig";
import { ptmDualWriteDbEnabled, ptmReadFromDbEnabled } from "@/lib/ptmDbConfig";
import {
  studentLeaveDualWriteDbEnabled,
  studentLeaveReadFromDbEnabled,
} from "@/lib/studentLeaveDbConfig";
import { vaultDualWriteDbEnabled, vaultReadFromDbEnabled } from "@/lib/vaultDbConfig";
import {
  libraryDualWriteDbEnabled,
  libraryReadFromDbEnabled,
} from "@/lib/libraryDbConfig";
import {
  storeDualWriteDbEnabled,
  storeReadFromDbEnabled,
} from "@/lib/storeDbConfig";
import {
  purchaseDualWriteDbEnabled,
  purchaseReadFromDbEnabled,
} from "@/lib/purchaseDbConfig";
import {
  accountsDualWriteDbEnabled,
  accountsReadFromDbEnabled,
} from "@/lib/accountsDbConfig";
import {
  payrollDualWriteDbEnabled,
  payrollReadFromDbEnabled,
} from "@/lib/payrollDbConfig";
import {
  waThreadsDualWriteDbEnabled,
  waThreadsReadFromDbEnabled,
} from "@/lib/waThreadsDbConfig";
import {
  schoolCommsDualWriteDbEnabled,
  schoolCommsReadFromDbEnabled,
} from "@/lib/schoolCommsDbConfig";
import {
  notificationsDualWriteDbEnabled,
  notificationsReadFromDbEnabled,
} from "@/lib/notificationsDbConfig";
import {
  rteDualWriteDbEnabled,
  rteReadFromDbEnabled,
} from "@/lib/rteDbConfig";
import {
  timetableDualWriteDbEnabled,
  timetableReadFromDbEnabled,
} from "@/lib/timetableDbConfig";
import {
  trustDualWriteDbEnabled,
  trustReadFromDbEnabled,
} from "@/lib/trustDbConfig";
import {
  galleryDualWriteDbEnabled,
  galleryReadFromDbEnabled,
} from "@/lib/galleryDbConfig";
import {
  newsDualWriteDbEnabled,
  newsReadFromDbEnabled,
} from "@/lib/newsDbConfig";
import {
  transportDualWriteDbEnabled,
  transportReadFromDbEnabled,
} from "@/lib/transportDbConfig";
import {
  mastersDualWriteDbEnabled,
  mastersReadFromDbEnabled,
} from "@/lib/mastersDbConfig";
import { sisDualWriteDbEnabled, sisReadFromDbEnabled } from "@/lib/sisDbConfig";
import { staffDualWriteDbEnabled, staffReadFromDbEnabled } from "@/lib/staffDbConfig";
import {
  staffAttendanceDualWriteDbEnabled,
  staffAttendanceReadFromDbEnabled,
} from "@/lib/staffAttendanceDbConfig";
import {
  DESK_SLICE_MODULE_DEFS,
  deskSliceEnvDualWrite,
  deskSliceEnvReadFromDb,
} from "@/lib/deskSliceRegistry";

export type DeskModuleId =
  | "fees"
  | "attendance"
  | "staff_attendance"
  | "sis"
  | "staff"
  | "payments"
  | "exams"
  | "homework"
  | "ptm"
  | "student_leave"
  | "vault"
  | "library"
  | "store"
  | "purchase"
  | "accounts"
  | "payroll"
  | "wa_threads"
  | "school_comms"
  | "notifications"
  | "rte"
  | "timetable"
  | "trust"
  | "gallery"
  | "news"
  | "transport"
  | "masters"
  | "admissions"
  | "rbac"
  | "certificates"
  | "exam_papers"
  | "wa_templates"
  | "staff_hr"
  | "staff_advances"
  | "staff_agreements"
  | "module_registry"
  | "fee_recovery_tasks"
  | "automation"
  | "erp_chat"
  | "staff_chat";

export type DeskCutoverModule = {
  id: DeskModuleId;
  label: string;
  dualWrite: () => boolean;
  readFromDb: () => boolean;
  /** NEXT_PUBLIC_* — browser hydrate */
  readFromDbClient: () => boolean;
  blobTable: string;
};

function publicEnvFlag(name: string): boolean {
  return process.env[name] === "true";
}

export const DESK_CUTOVER_MODULES: DeskCutoverModule[] = [
  {
    id: "admissions",
    label: "Admissions CRM",
    dualWrite: admissionsDualWriteDbEnabled,
    readFromDb: admissionsReadFromDbEnabled,
    readFromDbClient: () =>
      publicEnvFlag("NEXT_PUBLIC_ADMISSIONS_READ_FROM_DB"),
    blobTable: "admissions_state",
  },
  {
    id: "fees",
    label: "Fees desk",
    dualWrite: feesDualWriteDbEnabled,
    readFromDb: feesReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_FEES_READ_FROM_DB"),
    blobTable: "fees_state",
  },
  {
    id: "attendance",
    label: "Student attendance",
    dualWrite: attendanceDualWriteDbEnabled,
    readFromDb: attendanceReadFromDbEnabled,
    readFromDbClient: () =>
      publicEnvFlag("NEXT_PUBLIC_ATTENDANCE_READ_FROM_DB"),
    blobTable: "attendance_state",
  },
  {
    id: "staff_attendance",
    label: "Staff attendance",
    dualWrite: staffAttendanceDualWriteDbEnabled,
    readFromDb: staffAttendanceReadFromDbEnabled,
    readFromDbClient: () =>
      publicEnvFlag("NEXT_PUBLIC_STAFF_ATTENDANCE_READ_FROM_DB"),
    blobTable: "staff_attendance_state",
  },
  {
    id: "sis",
    label: "SIS roster",
    dualWrite: sisDualWriteDbEnabled,
    readFromDb: sisReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_SIS_READ_FROM_DB"),
    blobTable: "school_mirror_state",
  },
  {
    id: "staff",
    label: "Staff roster",
    dualWrite: staffDualWriteDbEnabled,
    readFromDb: staffReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_STAFF_READ_FROM_DB"),
    blobTable: "school_mirror_state",
  },
  {
    id: "payments",
    label: "Payment links",
    dualWrite: paymentsDualWriteDbEnabled,
    readFromDb: paymentsReadFromDbEnabled,
    readFromDbClient: () =>
      publicEnvFlag("NEXT_PUBLIC_PAYMENTS_READ_FROM_DB"),
    blobTable: "payments_state",
  },
  {
    id: "exams",
    label: "Exams desk",
    dualWrite: examsDualWriteDbEnabled,
    readFromDb: examsReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_EXAMS_READ_FROM_DB"),
    blobTable: "exams_state",
  },
  {
    id: "homework",
    label: "Homework & diary",
    dualWrite: homeworkDualWriteDbEnabled,
    readFromDb: homeworkReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_HOMEWORK_READ_FROM_DB"),
    blobTable: "homework_state",
  },
  {
    id: "ptm",
    label: "PTM scheduler",
    dualWrite: ptmDualWriteDbEnabled,
    readFromDb: ptmReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_PTM_READ_FROM_DB"),
    blobTable: "ptm_state",
  },
  {
    id: "student_leave",
    label: "Student leave",
    dualWrite: studentLeaveDualWriteDbEnabled,
    readFromDb: studentLeaveReadFromDbEnabled,
    readFromDbClient: () =>
      publicEnvFlag("NEXT_PUBLIC_STUDENT_LEAVE_READ_FROM_DB"),
    blobTable: "student_leave_state",
  },
  {
    id: "vault",
    label: "Document vault",
    dualWrite: vaultDualWriteDbEnabled,
    readFromDb: vaultReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_VAULT_READ_FROM_DB"),
    blobTable: "vault_state",
  },
  {
    id: "library",
    label: "Library lending",
    dualWrite: libraryDualWriteDbEnabled,
    readFromDb: libraryReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_LIBRARY_READ_FROM_DB"),
    blobTable: "library_state",
  },
  {
    id: "store",
    label: "Store / inventory",
    dualWrite: storeDualWriteDbEnabled,
    readFromDb: storeReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_STORE_READ_FROM_DB"),
    blobTable: "store_state",
  },
  {
    id: "purchase",
    label: "Purchase (indent → PO → GRN)",
    dualWrite: purchaseDualWriteDbEnabled,
    readFromDb: purchaseReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_PURCHASE_READ_FROM_DB"),
    blobTable: "purchase_state",
  },
  {
    id: "accounts",
    label: "Accounts / finance",
    dualWrite: accountsDualWriteDbEnabled,
    readFromDb: accountsReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_ACCOUNTS_READ_FROM_DB"),
    blobTable: "accounts_state",
  },
  {
    id: "payroll",
    label: "Payroll runs",
    dualWrite: payrollDualWriteDbEnabled,
    readFromDb: payrollReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_PAYROLL_READ_FROM_DB"),
    blobTable: "payroll_state",
  },
  {
    id: "wa_threads",
    label: "WhatsApp bot threads",
    dualWrite: waThreadsDualWriteDbEnabled,
    readFromDb: waThreadsReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_WA_THREADS_READ_FROM_DB"),
    blobTable: "wa_bot_threads_state",
  },
  {
    id: "school_comms",
    label: "School comms",
    dualWrite: schoolCommsDualWriteDbEnabled,
    readFromDb: schoolCommsReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_SCHOOL_COMMS_READ_FROM_DB"),
    blobTable: "school_comms_state",
  },
  {
    id: "notifications",
    label: "Notifications inbox",
    dualWrite: notificationsDualWriteDbEnabled,
    readFromDb: notificationsReadFromDbEnabled,
    readFromDbClient: () =>
      publicEnvFlag("NEXT_PUBLIC_NOTIFICATIONS_READ_FROM_DB"),
    blobTable: "notifications_state",
  },
  {
    id: "rte",
    label: "RTE / EWS quota",
    dualWrite: rteDualWriteDbEnabled,
    readFromDb: rteReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_RTE_READ_FROM_DB"),
    blobTable: "rte_state",
  },
  {
    id: "timetable",
    label: "Timetable",
    dualWrite: timetableDualWriteDbEnabled,
    readFromDb: timetableReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_TIMETABLE_READ_FROM_DB"),
    blobTable: "timetable_state",
  },
  {
    id: "trust",
    label: "Trust / construction",
    dualWrite: trustDualWriteDbEnabled,
    readFromDb: trustReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_TRUST_READ_FROM_DB"),
    blobTable: "trust_state",
  },
  {
    id: "gallery",
    label: "Photo gallery",
    dualWrite: galleryDualWriteDbEnabled,
    readFromDb: galleryReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_GALLERY_READ_FROM_DB"),
    blobTable: "school_comms_state",
  },
  {
    id: "news",
    label: "School news",
    dualWrite: newsDualWriteDbEnabled,
    readFromDb: newsReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_NEWS_READ_FROM_DB"),
    blobTable: "school_comms_state",
  },
  {
    id: "transport",
    label: "Transport fleet",
    dualWrite: transportDualWriteDbEnabled,
    readFromDb: transportReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_TRANSPORT_READ_FROM_DB"),
    blobTable: "transport_state",
  },
  {
    id: "masters",
    label: "Masters (foundation + fees)",
    dualWrite: mastersDualWriteDbEnabled,
    readFromDb: mastersReadFromDbEnabled,
    readFromDbClient: () => publicEnvFlag("NEXT_PUBLIC_MASTERS_READ_FROM_DB"),
    blobTable: "school_mirror_state",
  },
  ...DESK_SLICE_MODULE_DEFS.map(
    (d): DeskCutoverModule => ({
      id: d.id,
      label: d.label,
      dualWrite: () => deskSliceEnvDualWrite(d.envPrefix),
      readFromDb: () => deskSliceEnvReadFromDb(d.envPrefix),
      readFromDbClient: () =>
        publicEnvFlag(`NEXT_PUBLIC_${d.envPrefix}_READ_FROM_DB`),
      blobTable: d.blobTable,
    }),
  ),
];

export function deskModuleById(id: DeskModuleId): DeskCutoverModule | undefined {
  return DESK_CUTOVER_MODULES.find((m) => m.id === id);
}

/** When true, blob hydrate is skipped — desk tables are authoritative. */
export function deskSkipBlobHydrate(id: DeskModuleId): boolean {
  const mod = deskModuleById(id);
  if (!mod) return false;
  return mod.readFromDb();
}

/** Browser: skip blob when public read-from-db flag is on. */
export function deskSkipBlobHydrateClient(id: DeskModuleId): boolean {
  const mod = deskModuleById(id);
  if (!mod) return false;
  if (typeof window === "undefined") return mod.readFromDb();
  return mod.readFromDbClient();
}

/** When true, skip jsonb blob upsert — desk tables are authoritative. */
export function deskSkipBlobPush(id: DeskModuleId): boolean {
  return deskSkipBlobHydrate(id);
}

/** Browser: skip blob push when public read-from-db flag is on. */
export function deskSkipBlobPushClient(id: DeskModuleId): boolean {
  return deskSkipBlobHydrateClient(id);
}

export type MirrorBlobSlice = "sis" | "fees" | "payments" | "admissions" | "masters";

const MIRROR_SLICE_MODULE: Record<MirrorBlobSlice, DeskModuleId> = {
  sis: "sis",
  fees: "fees",
  payments: "payments",
  admissions: "admissions",
  masters: "masters",
};

/** school_mirror_state slices that should not be upserted when desk is SoR. */
export function deskSkipMirrorBlobSlice(slice: MirrorBlobSlice): boolean {
  return deskSkipBlobPush(MIRROR_SLICE_MODULE[slice]);
}

export function deskSkipMirrorBlobSliceClient(slice: MirrorBlobSlice): boolean {
  return deskSkipBlobPushClient(MIRROR_SLICE_MODULE[slice]);
}

export type DeskReadinessRow = {
  id: DeskModuleId;
  label: string;
  dualWrite: boolean;
  readFromDb: boolean;
  readFromDbClient: boolean;
  deskCount: number;
  blobCount: number;
  ready: boolean;
  note: string;
};
