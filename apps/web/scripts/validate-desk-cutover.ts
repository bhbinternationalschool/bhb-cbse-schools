#!/usr/bin/env npx tsx
/**
 * Validate desk cutover readiness — compare normalized desk vs jsonb blob counts.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/validate-desk-cutover.ts
 *   cd apps/web && npx tsx scripts/validate-desk-cutover.ts --json
 */

import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

import type { AdmissionsState } from "../src/lib/admissions";
import type { AttendanceState } from "../src/lib/attendance";
import type { ExamsState } from "../src/lib/exams";
import type { FeesState } from "../src/lib/fees";
import type { HomeworkState } from "../src/lib/homework";
import type { MastersState } from "../src/lib/masters";
import type { PaymentsState } from "../src/lib/payments";
import type { PtmState } from "../src/lib/ptm";
import type { StudentLeaveState } from "../src/lib/studentLeave";
import type { VaultState } from "../src/lib/vault";
import type { LibraryState } from "../src/lib/library";
import type { StoreState } from "../src/lib/store";
import type { PurchaseState } from "../src/lib/purchase";
import type { AccountsState } from "../src/lib/accounts";
import type { PayrollState } from "../src/lib/payroll";
import type { WaBotPersistBundle } from "../src/lib/waBotStore.server";
import type { SchoolCommsState } from "../src/lib/schoolComms";
import type { NotificationsState } from "../src/lib/notifications";
import type { RteState } from "../src/lib/rteEws";
import type { TimetableState } from "../src/lib/timetable";
import type { TrustState } from "../src/lib/trust";
import type { TransportState } from "../src/lib/transport";
import type { SisState } from "../src/lib/sis";
import type { StaffAttendanceState } from "../src/lib/staffAttendance";
import {
  DESK_CUTOVER_MODULES,
  type DeskModuleId,
  type DeskReadinessRow,
} from "../src/lib/deskCutover";
import { fetchAdmissionDeskFromDb } from "../src/lib/admissionsNormalized.server";
import { fetchAttendanceDeskFromDb } from "../src/lib/attendanceNormalized.server";
import {
  fetchExamDeskFromDb,
  type ExamDeskBundle,
  type ExamDeskSyncMeta,
} from "../src/lib/examsNormalized.server";
import {
  fetchHomeworkDeskFromDb,
  type HomeworkDeskBundle,
  type HomeworkDeskSyncMeta,
} from "../src/lib/homeworkNormalized.server";
import {
  fetchPtmDeskFromDb,
  type PtmDeskBundle,
} from "../src/lib/ptmNormalized.server";
import {
  fetchStudentLeaveDeskFromDb,
  type StudentLeaveDeskBundle,
} from "../src/lib/studentLeaveNormalized.server";
import {
  fetchVaultDeskFromDb,
  type VaultDeskBundle,
} from "../src/lib/vaultNormalized.server";
import {
  fetchLibraryDeskFromDb,
  type LibraryDeskBundle,
} from "../src/lib/libraryNormalized.server";
import {
  fetchStoreDeskFromDb,
  type StoreDeskBundle,
} from "../src/lib/storeNormalized.server";
import {
  fetchPurchaseDeskFromDb,
  type PurchaseDeskBundle,
} from "../src/lib/purchaseNormalized.server";
import {
  fetchAccountsDeskFromDb,
  type AccountsDeskBundle,
} from "../src/lib/accountsNormalized.server";
import {
  fetchPayrollDeskFromDb,
  type PayrollDeskBundle,
} from "../src/lib/payrollNormalized.server";
import {
  fetchWaThreadsDeskFromDb,
  WA_BOT_SLICE_KEYS,
} from "../src/lib/waThreadsNormalized.server";
import {
  fetchSchoolCommsDeskFromDb,
  type SchoolCommsDeskBundle,
} from "../src/lib/schoolCommsNormalized.server";
import {
  fetchNotificationsDeskFromDb,
  type NotificationsDeskBundle,
} from "../src/lib/notificationsNormalized.server";
import {
  fetchRteDeskFromDb,
  type RteDeskBundle,
} from "../src/lib/rteNormalized.server";
import {
  fetchTimetableDeskFromDb,
  type TimetableDeskSyncMeta,
} from "../src/lib/timetableNormalized.server";
import {
  fetchTrustDeskFromDb,
  type TrustDeskBundle,
} from "../src/lib/trustNormalized.server";
import {
  fetchTransportDeskFromDb,
  type TransportDeskBundle,
} from "../src/lib/transportNormalized.server";
import {
  fetchMastersDeskFromDb,
  MASTERS_ARRAY_SLICES,
  MASTERS_OBJECT_SLICES,
  type MastersDeskBundle,
} from "../src/lib/mastersNormalized.server";
import {
  fetchGalleryDeskFromDb,
  fetchNewsDeskFromDb,
  type GalleryDeskBundle,
  type NewsDeskBundle,
} from "../src/lib/schoolCommsNormalized.server";
import {
  fetchDeskSliceFromDb,
  countDeskSliceStateRows,
} from "../src/lib/deskSliceNormalized.server";
import { deskSliceDef } from "../src/lib/deskSliceRegistry";
import { fetchFeeDeskFromDb } from "../src/lib/feesNormalized.server";
import { fetchPaymentDeskFromDb } from "../src/lib/paymentsNormalized.server";
import { fetchSisFromDb } from "../src/lib/sisNormalized.server";
import {
  fetchStaffRemoteServer,
  stripStaffFromMastersForBlob,
} from "../src/lib/staffPersistence";
import { fetchStaffAttendanceDeskFromDb } from "../src/lib/staffAttendanceNormalized.server";

type Counts = { desk: number; blob: number; deskLabel: string; blobLabel: string };

function countFeeDeskRows(fees: FeesState | null | undefined): number {
  if (!fees) return 0;
  return (
    (fees.vouchers?.length ?? 0) +
    (fees.cheques?.length ?? 0) +
    (fees.manualBooks?.length ?? 0) +
    (fees.dayCloses?.length ?? 0) +
    (fees.chargeVouchers?.length ?? 0) +
    (fees.installmentPlans?.length ?? 0) +
    (fees.planAllocations?.length ?? 0) +
    (fees.carriedForwardDues?.length ?? 0)
  );
}

function countLibraryDeskRows(bundle: LibraryDeskBundle): number {
  return (
    bundle.titles.length +
    bundle.copies.length +
    bundle.issues.length +
    1
  );
}

function countLibraryStateRows(state: LibraryState | null | undefined): number {
  if (!state) return 0;
  return (
    (state.titles?.length ?? 0) +
    (state.copies?.length ?? 0) +
    (state.issues?.length ?? 0) +
    (state.settings ? 1 : 0)
  );
}

function countStoreDeskRows(bundle: StoreDeskBundle): number {
  const issueLines = bundle.issues.reduce((n, i) => n + (i.lines?.length ?? 0), 0);
  const returnLines = bundle.sellReturns.reduce(
    (n, r) => n + (r.lines?.length ?? 0),
    0,
  );
  return (
    bundle.categories.length +
    bundle.saleGroups.length +
    bundle.uoms.length +
    bundle.infraLevels.length +
    bundle.sources.length +
    bundle.items.length +
    bundle.issues.length +
    issueLines +
    bundle.movements.length +
    bundle.inventoryAllocations.length +
    bundle.assetAllocations.length +
    bundle.sellReturns.length +
    returnLines
  );
}

function countStoreStateRows(state: StoreState | null | undefined): number {
  if (!state) return 0;
  const issueLines = (state.issues ?? []).reduce(
    (n, i) => n + (i.lines?.length ?? 0),
    0,
  );
  const returnLines = (state.sellReturns ?? []).reduce(
    (n, r) => n + (r.lines?.length ?? 0),
    0,
  );
  return (
    (state.categories?.length ?? 0) +
    (state.saleGroups?.length ?? 0) +
    (state.uoms?.length ?? 0) +
    (state.infraLevels?.length ?? 0) +
    (state.sources?.length ?? 0) +
    (state.items?.length ?? 0) +
    (state.issues?.length ?? 0) +
    issueLines +
    (state.movements?.length ?? 0) +
    (state.inventoryAllocations?.length ?? 0) +
    (state.assetAllocations?.length ?? 0) +
    (state.sellReturns?.length ?? 0) +
    returnLines
  );
}

function countPurchaseDeskRows(bundle: PurchaseDeskBundle): number {
  const indentLines = bundle.indents.reduce((n, i) => n + (i.lines?.length ?? 0), 0);
  const orderLines = bundle.orders.reduce((n, o) => n + (o.lines?.length ?? 0), 0);
  const grnLines = bundle.grns.reduce((n, g) => n + (g.lines?.length ?? 0), 0);
  const returnLines = bundle.returns.reduce((n, r) => n + (r.lines?.length ?? 0), 0);
  return (
    bundle.indents.length +
    indentLines +
    bundle.orders.length +
    orderLines +
    bundle.grns.length +
    grnLines +
    bundle.returns.length +
    returnLines +
    1
  );
}

function countPurchaseStateRows(state: PurchaseState | null | undefined): number {
  if (!state) return 0;
  const indentLines = (state.indents ?? []).reduce(
    (n, i) => n + (i.lines?.length ?? 0),
    0,
  );
  const orderLines = (state.orders ?? []).reduce(
    (n, o) => n + (o.lines?.length ?? 0),
    0,
  );
  const grnLines = (state.grns ?? []).reduce((n, g) => n + (g.lines?.length ?? 0), 0);
  const returnLines = (state.returns ?? []).reduce(
    (n, r) => n + (r.lines?.length ?? 0),
    0,
  );
  return (
    (state.indents?.length ?? 0) +
    indentLines +
    (state.orders?.length ?? 0) +
    orderLines +
    (state.grns?.length ?? 0) +
    grnLines +
    (state.returns?.length ?? 0) +
    returnLines +
    (state.settings ? 1 : 0)
  );
}

function countAccountsDeskRows(bundle: AccountsDeskBundle): number {
  const voucherLines = bundle.expenseVouchers.reduce(
    (n, v) => n + (v.lines?.length ?? 0),
    0,
  );
  const billLines = bundle.vendorBills.reduce(
    (n, b) => n + (b.lines?.length ?? 0),
    0,
  );
  const reconLines = bundle.reconSessions.reduce(
    (n, s) => n + (s.lines?.length ?? 0),
    0,
  );
  const journalLines = bundle.journalEntries.reduce(
    (n, j) => n + (j.lines?.length ?? 0),
    0,
  );
  return (
    bundle.cashPools.length +
    bundle.cashLedger.length +
    bundle.bankAccounts.length +
    bundle.bankLedger.length +
    bundle.modeBankMap.length +
    bundle.reconSessions.length +
    reconLines +
    bundle.expenseCategories.length +
    bundle.expenseVouchers.length +
    voucherLines +
    bundle.recurringRules.length +
    bundle.vendors.length +
    bundle.vendorBills.length +
    billLines +
    bundle.payables.length +
    bundle.trustees.length +
    bundle.ownerLoans.length +
    bundle.ownerLoanSchedule.length +
    bundle.ownerCashHandovers.length +
    bundle.coaAccounts.length +
    bundle.journalEntries.length +
    journalLines +
    bundle.fiscalYears.length +
    1
  );
}

function countAccountsStateRows(state: AccountsState | null | undefined): number {
  if (!state) return 0;
  const voucherLines = (state.expenseVouchers ?? []).reduce(
    (n, v) => n + (v.lines?.length ?? 0),
    0,
  );
  const billLines = (state.vendorBills ?? []).reduce(
    (n, b) => n + (b.lines?.length ?? 0),
    0,
  );
  const reconLines = (state.reconSessions ?? []).reduce(
    (n, s) => n + (s.lines?.length ?? 0),
    0,
  );
  const journalLines = (state.journalEntries ?? []).reduce(
    (n, j) => n + (j.lines?.length ?? 0),
    0,
  );
  return (
    (state.cashPools?.length ?? 0) +
    (state.cashLedger?.length ?? 0) +
    (state.bankAccounts?.length ?? 0) +
    (state.bankLedger?.length ?? 0) +
    (state.modeBankMap?.length ?? 0) +
    (state.reconSessions?.length ?? 0) +
    reconLines +
    (state.expenseCategories?.length ?? 0) +
    (state.expenseVouchers?.length ?? 0) +
    voucherLines +
    (state.recurringRules?.length ?? 0) +
    (state.vendors?.length ?? 0) +
    (state.vendorBills?.length ?? 0) +
    billLines +
    (state.payables?.length ?? 0) +
    (state.trustees?.length ?? 0) +
    (state.ownerLoans?.length ?? 0) +
    (state.ownerLoanSchedule?.length ?? 0) +
    (state.ownerCashHandovers?.length ?? 0) +
    (state.coaAccounts?.length ?? 0) +
    (state.journalEntries?.length ?? 0) +
    journalLines +
    (state.fiscalYears?.length ?? 0) +
    (state.settings ? 1 : 0)
  );
}

function countPayrollDeskRows(bundle: PayrollDeskBundle): number {
  const lineCount = bundle.runs.reduce((n, r) => n + (r.lines?.length ?? 0), 0);
  return bundle.runs.length + lineCount + bundle.audit.length;
}

function countPayrollStateRows(state: PayrollState | null | undefined): number {
  if (!state) return 0;
  const lineCount = (state.runs ?? []).reduce(
    (n, r) => n + (r.lines?.length ?? 0),
    0,
  );
  return (state.runs?.length ?? 0) + lineCount + (state.audit?.length ?? 0);
}

function countSchoolCommsDeskRows(bundle: SchoolCommsDeskBundle): number {
  return (
    bundle.notices.length +
    bundle.news.length +
    bundle.albums.length +
    bundle.photos.length
  );
}

function countSchoolCommsStateRows(state: SchoolCommsState | null | undefined): number {
  if (!state) return 0;
  return (
    (state.notices?.length ?? 0) +
    (state.news?.length ?? 0) +
    (state.albums?.length ?? 0) +
    (state.photos?.length ?? 0)
  );
}

function countNotificationsDeskRows(bundle: NotificationsDeskBundle): number {
  return bundle.items.length;
}

function countNotificationsStateRows(
  state: NotificationsState | null | undefined,
): number {
  return state?.items?.length ?? 0;
}

function countRteDeskRows(bundle: RteDeskBundle): number {
  return bundle.seats.length + bundle.applications.length + 1;
}

function countRteStateRows(state: RteState | null | undefined): number {
  if (!state) return 0;
  return (state.seats?.length ?? 0) + (state.applications?.length ?? 0) + 1;
}

function countTimetableDeskRows(
  state: Pick<
    TimetableState,
    "grids" | "publishedGrids" | "substitutions" | "bellTemplate"
  >,
  meta?: TimetableDeskSyncMeta | null,
): number {
  if (meta) {
    return (
      meta.sliceCount +
      meta.gridCount +
      meta.publishedGridCount +
      meta.substitutionCount
    );
  }
  return (
    state.grids.length +
    state.publishedGrids.length +
    state.substitutions.length +
    (state.bellTemplate.length > 0 ? 1 : 0)
  );
}

function countTimetableStateRows(state: TimetableState | null | undefined): number {
  if (!state) return 0;
  return countTimetableDeskRows(state);
}

function countTrustDeskRows(
  bundle: TrustDeskBundle,
  meta?: { sliceCount: number; projectCount: number; workItemCount: number } | null,
): number {
  if (meta) {
    return meta.sliceCount + meta.projectCount + meta.workItemCount;
  }
  return (
    bundle.projects.length +
    bundle.workItems.length +
    bundle.materials.length +
    bundle.labourEntries.length +
    bundle.allotments.length +
    bundle.contractors.length +
    bundle.workOrders.length +
    bundle.raBills.length +
    bundle.costLines.length +
    bundle.rateCard.length
  );
}

function countTrustStateRows(state: TrustState | null | undefined): number {
  if (!state) return 0;
  return (
    (state.projects?.length ?? 0) +
    (state.workItems?.length ?? 0) +
    (state.materials?.length ?? 0) +
    (state.labourEntries?.length ?? 0) +
    (state.allotments?.length ?? 0) +
    (state.contractors?.length ?? 0) +
    (state.workOrders?.length ?? 0) +
    (state.raBills?.length ?? 0) +
    (state.costLines?.length ?? 0) +
    (state.rateCard?.length ?? 0)
  );
}

function countGalleryDeskRows(bundle: GalleryDeskBundle): number {
  return bundle.albums.length + bundle.photos.length;
}

function countGalleryStateRows(state: SchoolCommsState | null | undefined): number {
  if (!state) return 0;
  return (state.albums?.length ?? 0) + (state.photos?.length ?? 0);
}

function countNewsDeskRows(bundle: NewsDeskBundle): number {
  return bundle.news.length;
}

function countNewsStateRows(state: SchoolCommsState | null | undefined): number {
  return state?.news?.length ?? 0;
}

function countTransportDeskRows(
  bundle: TransportDeskBundle,
  meta?: {
    sliceCount: number;
    routeCount: number;
    vehicleCount: number;
    assignmentCount: number;
  } | null,
): number {
  if (meta) {
    return (
      meta.sliceCount +
      meta.routeCount +
      meta.vehicleCount +
      meta.assignmentCount
    );
  }
  return (
    bundle.routes.length +
    bundle.vehicles.length +
    bundle.assignments.length +
    (bundle.feePolicy ? 1 : 0)
  );
}

function countTransportStateRows(state: TransportState | null | undefined): number {
  if (!state) return 0;
  return (
    (state.routes?.length ?? 0) +
    (state.vehicles?.length ?? 0) +
    (state.assignments?.length ?? 0) +
    1
  );
}

function countMastersPayloadRows(
  state: MastersState | MastersDeskBundle | null | undefined,
): number {
  if (!state) return 0;
  const s = stripStaffFromMastersForBlob(
    "version" in state ? state : ({ version: 2, ...state } as MastersState),
  );
  let rows = 0;
  for (const key of MASTERS_OBJECT_SLICES) {
    if (s[key] != null) rows += 1;
  }
  for (const key of MASTERS_ARRAY_SLICES) {
    const arr = s[key];
    if (Array.isArray(arr) && arr.length > 0) rows += arr.length;
  }
  return rows;
}

function countMastersDeskRows(bundle: MastersDeskBundle): number {
  return countMastersPayloadRows(bundle);
}

function countMastersStateRows(state: MastersState | null | undefined): number {
  return countMastersPayloadRows(state);
}

function countWaThreadsDeskRows(
  bundle: WaBotPersistBundle,
  meta?: { sliceCount: number; threadCount: number } | null,
): number {
  if (meta) return meta.sliceCount + meta.threadCount;
  let slices = 0;
  let threads = 0;
  for (const key of WA_BOT_SLICE_KEYS) {
    const payload = bundle[key];
    if (payload == null) continue;
    slices += 1;
    if (typeof payload === "object" && payload !== null) {
      const p = payload as { threads?: unknown };
      if (Array.isArray(p.threads)) threads += p.threads.length;
      else if (p.threads && typeof p.threads === "object") {
        threads += Object.keys(p.threads as object).length;
      }
    }
  }
  return slices + threads;
}

function countWaThreadsBlobRows(state: WaBotPersistBundle | null | undefined): number {
  if (!state) return 0;
  return countWaThreadsDeskRows(state);
}

function countVaultDeskRows(bundle: VaultDeskBundle): number {
  return bundle.documents.length + 1;
}

function countVaultStateRows(state: VaultState | null | undefined): number {
  if (!state) return 0;
  return (state.documents?.length ?? 0) + (state.settings ? 1 : 0);
}

function countStudentLeaveDeskRows(bundle: StudentLeaveDeskBundle): number {
  return bundle.requests.length;
}

function countStudentLeaveStateRows(
  state: StudentLeaveState | null | undefined,
): number {
  return state?.requests?.length ?? 0;
}

function countPtmDeskRows(bundle: PtmDeskBundle): number {
  return (
    bundle.events.length +
    bundle.slots.length +
    bundle.bookings.length +
    bundle.feedback.length
  );
}

function countPtmStateRows(state: PtmState | null | undefined): number {
  if (!state) return 0;
  return (
    (state.events?.length ?? 0) +
    (state.slots?.length ?? 0) +
    (state.bookings?.length ?? 0) +
    (state.feedback?.length ?? 0)
  );
}

function countHomeworkDeskRows(
  bundle: HomeworkDeskBundle,
  meta?: HomeworkDeskSyncMeta | null,
): number {
  return (
    bundle.posts.length +
    bundle.diary.length +
    bundle.submissions.length +
    bundle.seen.length +
    (meta ? 1 : bundle.settings.examModeFreeze ? 1 : 0)
  );
}

function countHomeworkStateRows(state: HomeworkState | null | undefined): number {
  if (!state) return 0;
  return (
    (state.posts?.length ?? 0) +
    (state.diary?.length ?? 0) +
    (state.submissions?.length ?? 0) +
    (state.seen?.length ?? 0) +
    (state.settings ? 1 : 0)
  );
}

function countExamDeskRows(
  bundle: ExamDeskBundle,
  meta?: ExamDeskSyncMeta | null,
): number {
  const marks =
    meta?.markCount ??
    bundle.sheets.reduce((n, s) => n + s.marks.length, 0);
  return (
    bundle.terms.length +
    bundle.subjects.length +
    bundle.dateSheet.length +
    bundle.sheets.length +
    marks +
    bundle.promotions.length
  );
}

function countExamStateRows(state: ExamsState | null | undefined): number {
  if (!state) return 0;
  const marks = (state.sheets ?? []).reduce(
    (n, s) => n + (s.marks?.length ?? 0),
    0,
  );
  return (
    (state.terms?.length ?? 0) +
    (state.subjects?.length ?? 0) +
    (state.dateSheet?.length ?? 0) +
    (state.sheets?.length ?? 0) +
    marks +
    (state.promotions?.length ?? 0)
  );
}

function countFeeDeskSnapshot(
  desk: Awaited<ReturnType<typeof fetchFeeDeskFromDb>>,
): number {
  const a = desk.ancillary;
  return (
    desk.vouchers.length +
    a.cheques.length +
    a.manualBooks.length +
    a.dayCloses.length +
    a.chargeVouchers.length +
    a.installmentPlans.length +
    a.planAllocations.length +
    a.carriedForwardDues.length
  );
}

async function countDesk(id: DeskModuleId): Promise<Counts> {
  const sliceDef = deskSliceDef(id);
  if (sliceDef) {
    const { bundle } = await fetchDeskSliceFromDb(id);
    return {
      desk: countDeskSliceStateRows(id, bundle),
      deskLabel: "desk rows",
      blob: 0,
      blobLabel: "desk rows",
    };
  }
  switch (id) {
    case "admissions": {
      const { state } = await fetchAdmissionDeskFromDb();
      return {
        desk: state.leads.length,
        deskLabel: "leads",
        blob: 0,
        blobLabel: "leads",
      };
    }
    case "fees": {
      const desk = await fetchFeeDeskFromDb();
      const rows = countFeeDeskSnapshot(desk);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "attendance": {
      const desk = await fetchAttendanceDeskFromDb();
      const rows =
        desk.registers.length +
        desk.ancillary.absentNudges.length +
        desk.ancillary.exceptions.length;
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "staff_attendance": {
      const desk = await fetchStaffAttendanceDeskFromDb();
      const rows = desk.registers.length + (desk.ancillary.settings ? 1 : 0);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "sis": {
      const { bundle } = await fetchSisFromDb();
      return {
        desk: bundle.students.length,
        deskLabel: "students",
        blob: 0,
        blobLabel: "students",
      };
    }
    case "staff": {
      const remote = await fetchStaffRemoteServer();
      return {
        desk: remote?.staff.length ?? 0,
        deskLabel: "staff",
        blob: 0,
        blobLabel: "staff",
      };
    }
    case "payments": {
      const desk = await fetchPaymentDeskFromDb();
      return {
        desk: desk.links.length,
        deskLabel: "links",
        blob: 0,
        blobLabel: "links",
      };
    }
    case "exams": {
      const { bundle, meta } = await fetchExamDeskFromDb();
      const rows = countExamDeskRows(bundle, meta);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "homework": {
      const { bundle, meta } = await fetchHomeworkDeskFromDb();
      const rows = countHomeworkDeskRows(bundle, meta);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "ptm": {
      const { bundle } = await fetchPtmDeskFromDb();
      const rows = countPtmDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "student_leave": {
      const { bundle } = await fetchStudentLeaveDeskFromDb();
      const rows = countStudentLeaveDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "requests",
        blob: 0,
        blobLabel: "requests",
      };
    }
    case "vault": {
      const { bundle } = await fetchVaultDeskFromDb();
      const rows = countVaultDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "library": {
      const { bundle } = await fetchLibraryDeskFromDb();
      const rows = countLibraryDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "store": {
      const { bundle } = await fetchStoreDeskFromDb();
      const rows = countStoreDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "purchase": {
      const { bundle } = await fetchPurchaseDeskFromDb();
      const rows = countPurchaseDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "accounts": {
      const { bundle } = await fetchAccountsDeskFromDb();
      const rows = countAccountsDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "payroll": {
      const { bundle } = await fetchPayrollDeskFromDb();
      const rows = countPayrollDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "wa_threads": {
      const { bundle, meta } = await fetchWaThreadsDeskFromDb();
      const rows = countWaThreadsDeskRows(bundle, meta);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "school_comms": {
      const { bundle } = await fetchSchoolCommsDeskFromDb();
      const rows = countSchoolCommsDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "notifications": {
      const { bundle } = await fetchNotificationsDeskFromDb();
      const rows = countNotificationsDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "rte": {
      const { bundle } = await fetchRteDeskFromDb();
      const rows = countRteDeskRows(bundle);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "timetable": {
      const { bundle, meta } = await fetchTimetableDeskFromDb();
      const rows = countTimetableDeskRows(bundle, meta);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "trust": {
      const { bundle, meta } = await fetchTrustDeskFromDb();
      const rows = countTrustDeskRows(bundle, meta);
      return {
        desk: rows,
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "gallery": {
      const { bundle } = await fetchGalleryDeskFromDb();
      return {
        desk: countGalleryDeskRows(bundle),
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "news": {
      const { bundle } = await fetchNewsDeskFromDb();
      return {
        desk: countNewsDeskRows(bundle),
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "transport": {
      const { bundle, meta } = await fetchTransportDeskFromDb();
      return {
        desk: countTransportDeskRows(bundle, meta),
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
    case "masters": {
      const { bundle } = await fetchMastersDeskFromDb();
      return {
        desk: countMastersDeskRows(bundle),
        deskLabel: "desk rows",
        blob: 0,
        blobLabel: "desk rows",
      };
    }
  }
}

async function countBlob(id: DeskModuleId): Promise<number> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const sliceDef = deskSliceDef(id);
  if (sliceDef) {
    const b = await fetchServerBlob<Record<string, unknown>>(sliceDef.blobTable);
    return countDeskSliceStateRows(id, b.state ?? undefined);
  }
  switch (id) {
    case "admissions": {
      const b = await fetchServerBlob<AdmissionsState>("admissions_state");
      return b.state?.leads?.length ?? 0;
    }
    case "fees": {
      const b = await fetchServerBlob<FeesState>("fees_state");
      return countFeeDeskRows(b.state);
    }
    case "attendance": {
      const b = await fetchServerBlob<AttendanceState>("attendance_state");
      const s = b.state;
      if (!s) return 0;
      return (
        (s.registers?.length ?? 0) +
        (s.absentNudges?.length ?? 0) +
        (s.exceptions?.length ?? 0)
      );
    }
    case "staff_attendance": {
      const b = await fetchServerBlob<StaffAttendanceState>(
        "staff_attendance_state",
      );
      const s = b.state;
      if (!s) return 0;
      return (s.registers?.length ?? 0) + (s.settings ? 1 : 0);
    }
    case "sis": {
      const b = await fetchServerBlob<{ sis?: SisState }>("school_mirror_state");
      return b.state?.sis?.students?.length ?? 0;
    }
    case "staff": {
      const b = await fetchServerBlob<{ masters?: MastersState }>(
        "school_mirror_state",
      );
      return b.state?.masters?.staff?.length ?? 0;
    }
    case "payments": {
      const b = await fetchServerBlob<PaymentsState>("payments_state");
      return b.state?.links?.length ?? 0;
    }
    case "exams": {
      const b = await fetchServerBlob<ExamsState>("exams_state");
      return countExamStateRows(b.state);
    }
    case "homework": {
      const b = await fetchServerBlob<HomeworkState>("homework_state");
      return countHomeworkStateRows(b.state);
    }
    case "ptm": {
      const b = await fetchServerBlob<PtmState>("ptm_state");
      return countPtmStateRows(b.state);
    }
    case "student_leave": {
      const b = await fetchServerBlob<StudentLeaveState>("student_leave_state");
      return countStudentLeaveStateRows(b.state);
    }
    case "vault": {
      const b = await fetchServerBlob<VaultState>("vault_state");
      return countVaultStateRows(b.state);
    }
    case "library": {
      const b = await fetchServerBlob<LibraryState>("library_state");
      return countLibraryStateRows(b.state);
    }
    case "store": {
      const b = await fetchServerBlob<StoreState>("store_state");
      return countStoreStateRows(b.state);
    }
    case "purchase": {
      const b = await fetchServerBlob<PurchaseState>("purchase_state");
      return countPurchaseStateRows(b.state);
    }
    case "accounts": {
      const b = await fetchServerBlob<AccountsState>("accounts_state");
      return countAccountsStateRows(b.state);
    }
    case "payroll": {
      const b = await fetchServerBlob<PayrollState>("payroll_state");
      return countPayrollStateRows(b.state);
    }
    case "wa_threads": {
      const b = await fetchServerBlob<WaBotPersistBundle>("wa_bot_threads_state");
      return countWaThreadsBlobRows(b.state ?? undefined);
    }
    case "school_comms": {
      const b = await fetchServerBlob<SchoolCommsState>("school_comms_state");
      return countSchoolCommsStateRows(b.state);
    }
    case "notifications": {
      const b = await fetchServerBlob<NotificationsState>("notifications_state");
      return countNotificationsStateRows(b.state);
    }
    case "rte": {
      const b = await fetchServerBlob<RteState>("rte_state");
      return countRteStateRows(b.state);
    }
    case "timetable": {
      const b = await fetchServerBlob<TimetableState>("timetable_state");
      return countTimetableStateRows(b.state);
    }
    case "trust": {
      const b = await fetchServerBlob<TrustState>("trust_state");
      return countTrustStateRows(b.state);
    }
    case "gallery": {
      const b = await fetchServerBlob<SchoolCommsState>("school_comms_state");
      return countGalleryStateRows(b.state);
    }
    case "news": {
      const b = await fetchServerBlob<SchoolCommsState>("school_comms_state");
      return countNewsStateRows(b.state);
    }
    case "transport": {
      const b = await fetchServerBlob<TransportState>("transport_state");
      return countTransportStateRows(b.state);
    }
    case "masters": {
      const b = await fetchServerBlob<{ masters?: MastersState }>(
        "school_mirror_state",
      );
      return countMastersStateRows(b.state?.masters);
    }
  }
}

function readinessNote(
  desk: number,
  blob: number,
  readFromDb: boolean,
): { ready: boolean; note: string } {
  if (desk === 0 && blob === 0) {
    if (readFromDb) {
      return { ready: true, note: "OK — empty (desk SoR)" };
    }
    return { ready: false, note: "No data in desk or blob — use ERP first" };
  }
  if (desk === 0 && blob > 0) {
    return {
      ready: false,
      note: `Backfill needed — blob has ${blob}, desk empty`,
    };
  }
  if (desk > 0 && blob > 0 && desk < blob) {
    return {
      ready: false,
      note: `Desk behind blob (${desk} < ${blob}) — re-run backfill`,
    };
  }
  if (desk > 0) {
    return {
      ready: true,
      note:
        blob > 0 && desk >= blob
          ? `OK — desk ${desk} ≥ blob ${blob}`
          : `OK — desk has ${desk} (blob ${blob})`,
    };
  }
  return { ready: true, note: `OK — desk ${desk}` };
}

async function buildReport(): Promise<DeskReadinessRow[]> {
  const rows: DeskReadinessRow[] = [];

  for (const mod of DESK_CUTOVER_MODULES) {
    const counts = await countDesk(mod.id);
    const blobCount = await countBlob(mod.id);
    counts.blob = blobCount;
    const { ready, note } = readinessNote(
      counts.desk,
      counts.blob,
      mod.readFromDb(),
    );

    rows.push({
      id: mod.id,
      label: mod.label,
      dualWrite: mod.dualWrite(),
      readFromDb: mod.readFromDb(),
      readFromDbClient: mod.readFromDbClient(),
      deskCount: counts.desk,
      blobCount: counts.blob,
      ready,
      note,
    });
  }

  return rows;
}

function printReport(rows: DeskReadinessRow[]) {
  console.log("\n=== Desk cutover readiness ===\n");
  console.log(
    "Module".padEnd(20) +
      "Desk".padStart(8) +
      "Blob".padStart(8) +
      "Ready".padStart(8) +
      "  Flags (dual/read/pub)" +
      "\n" +
      "-".repeat(72),
  );

  for (const r of rows) {
    const flags = `${r.dualWrite ? "D" : "-"}${r.readFromDb ? "R" : "-"}${r.readFromDbClient ? "P" : "-"}`;
    console.log(
      r.id.padEnd(20) +
        String(r.deskCount).padStart(8) +
        String(r.blobCount).padStart(8) +
        (r.ready ? "  YES" : "   NO").padStart(8) +
        `  ${flags}  ${r.note}`,
    );
  }

  const ready = rows.filter((r) => r.ready);
  console.log("\n--- Safe to enable READ_FROM_DB now ---");
  if (!ready.length) {
    console.log("(none — backfill or enter data in ERP first)");
  } else {
    for (const r of ready) {
      const prefix =
        r.id === "staff_attendance"
          ? "STAFF_ATTENDANCE"
          : r.id === "student_leave"
            ? "STUDENT_LEAVE"
          : r.id === "staff"
            ? "STAFF"
            : r.id.toUpperCase();
      console.log(
        `  ${r.id}: ${prefix}_READ_FROM_DB=true + NEXT_PUBLIC_${prefix}_READ_FROM_DB=true`,
      );
    }
  }

  console.log("\nRun: npx tsx scripts/validate-desk-cutover.ts after changing flags.\n");
}

async function main() {
  const rows = await buildReport();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  printReport(rows);
  const blocked = rows.filter((r) => !r.ready && r.deskCount === 0 && r.blobCount > 0);
  if (blocked.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
