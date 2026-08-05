/**
 * Automated desk cutover — backfill desk from blobs, seed empty defaults, reconcile.
 */

import type { AdmissionsState } from "@/lib/admissions";
import {
  fetchAdmissionDeskFromDb,
  pushAdmissionDeskToDb,
} from "@/lib/admissionsNormalized.server";
import type { DeskModuleId } from "@/lib/deskCutover";
import {
  DESK_CUTOVER_MODULES,
  deskModuleById,
} from "@/lib/deskCutover";
import {
  DESK_SLICE_MODULE_DEFS,
  deskSliceDef,
} from "@/lib/deskSliceRegistry";
import {
  countDeskSliceStateRows,
  fetchDeskSliceFromDb,
  pushDeskSliceToDb,
} from "@/lib/deskSliceNormalized.server";
import type { ExamsState } from "@/lib/exams";
import {
  fetchExamDeskFromDb,
  pushExamDeskToDb,
} from "@/lib/examsNormalized.server";
import type { FeesState } from "@/lib/fees";
import {
  fetchFeeDeskFromDb,
  pushFeeDeskToDb,
} from "@/lib/feesNormalized.server";
import type { HomeworkState } from "@/lib/homework";
import {
  fetchHomeworkDeskFromDb,
  pushHomeworkDeskToDb,
} from "@/lib/homeworkNormalized.server";
import type { MastersState } from "@/lib/masters";
import { defaultRbacState } from "@/lib/rbac";
import { defaultMasters, emptyMastersShell } from "@/lib/masters";
import {
  fetchMastersDeskFromDb,
  pushMastersDeskToDb,
} from "@/lib/mastersNormalized.server";
import type { PaymentsState } from "@/lib/payments";
import {
  fetchPaymentDeskFromDb,
  pushPaymentDeskToDb,
} from "@/lib/paymentsNormalized.server";
import type { PtmState } from "@/lib/ptm";
import {
  fetchPtmDeskFromDb,
  pushPtmDeskToDb,
} from "@/lib/ptmNormalized.server";
import { emptyAutomation } from "@/lib/automation";
import { emptyStaffHrState } from "@/lib/staffHr";
import { emptyWaTemplates } from "@/lib/waTemplates";
import { fetchServerBlob } from "@/lib/serverBlob";
import type { AttendanceState } from "@/lib/attendance";
import {
  fetchAttendanceDeskFromDb,
  pushAttendanceDeskToDb,
} from "@/lib/attendanceNormalized.server";
import type { TransportState } from "@/lib/transport";
import {
  fetchTransportDeskFromDb,
  pushTransportDeskToDb,
} from "@/lib/transportNormalized.server";
import type { TrustState } from "@/lib/trust";
import {
  fetchTrustDeskFromDb,
  pushTrustDeskToDb,
} from "@/lib/trustNormalized.server";
import type { VaultState } from "@/lib/vault";
import {
  fetchVaultDeskFromDb,
  pushVaultDeskToDb,
} from "@/lib/vaultNormalized.server";
import type { RteState } from "@/lib/rteEws";
import {
  fetchRteDeskFromDb,
  pushRteDeskToDb,
} from "@/lib/rteNormalized.server";
import type { TimetableState } from "@/lib/timetable";
import {
  fetchTimetableDeskFromDb,
  pushTimetableDeskToDb,
} from "@/lib/timetableNormalized.server";
import type { SchoolCommsState } from "@/lib/schoolComms";
import {
  fetchSchoolCommsDeskFromDb,
  pushSchoolCommsDeskToDb,
} from "@/lib/schoolCommsNormalized.server";
import type { NotificationsState } from "@/lib/notifications";
import {
  fetchNotificationsDeskFromDb,
  pushNotificationsDeskToDb,
} from "@/lib/notificationsNormalized.server";
import type { StudentLeaveState } from "@/lib/studentLeave";
import {
  fetchStudentLeaveDeskFromDb,
  pushStudentLeaveDeskToDb,
} from "@/lib/studentLeaveNormalized.server";
import type { WaBotPersistBundle } from "@/lib/waBotStore.server";
import {
  fetchWaThreadsDeskFromDb,
  pushWaThreadsDeskToDb,
} from "@/lib/waThreadsNormalized.server";

export type EnsureDeskAction = {
  module: DeskModuleId;
  action: "backfill" | "seed" | "skip";
  detail: string;
};

export type EnsureDeskResult = {
  ok: boolean;
  actions: EnsureDeskAction[];
};

type BlobState = { version?: number } & Record<string, unknown>;

async function deskSliceRows(id: DeskModuleId): Promise<number> {
  const { bundle } = await fetchDeskSliceFromDb(id);
  return countDeskSliceStateRows(id, bundle);
}

async function blobSliceRows(
  id: DeskModuleId,
  table: string,
): Promise<number> {
  const blob = await fetchServerBlob<BlobState>(table as never);
  return countDeskSliceStateRows(id, blob.state ?? undefined);
}

async function backfillSliceModule(id: DeskModuleId): Promise<boolean> {
  const def = deskSliceDef(id);
  if (!def) return false;
  const blob = await fetchServerBlob<BlobState>(def.blobTable);
  if (!blob.state) return false;
  const deskRows = await deskSliceRows(id);
  const blobRows = countDeskSliceStateRows(id, blob.state);
  if (blobRows <= deskRows) return false;
  const result = await pushDeskSliceToDb(
    id,
    blob.state as BlobState & { version: number },
  );
  return result.ok;
}

async function seedSliceModule(id: DeskModuleId): Promise<boolean> {
  const seed = SLICE_SEEDS[id];
  if (!seed) return false;
  const state = seed();
  const result = await pushDeskSliceToDb(id, state);
  return result.ok;
}

const SLICE_SEEDS: Partial<
  Record<DeskModuleId, () => BlobState & { version: number }>
> = {
  rbac: () => defaultRbacState(),
  staff_hr: () => emptyStaffHrState(),
  wa_templates: () => emptyWaTemplates(),
  automation: () => emptyAutomation(),
  module_registry: () => ({ version: 1, enabled: {} }),
};

async function ensurePrimaryModule(id: DeskModuleId): Promise<EnsureDeskAction> {
  const mod = deskModuleById(id);
  if (!mod) return { module: id, action: "skip", detail: "unknown module" };

  if (deskSliceDef(id)) {
    const deskRows = await deskSliceRows(id);
    const blobRows = await blobSliceRows(id, mod.blobTable);
    if (blobRows > deskRows) {
      const ok = await backfillSliceModule(id);
      return {
        module: id,
        action: ok ? "backfill" : "skip",
        detail: ok
          ? `blob ${blobRows} → desk (was ${deskRows})`
          : "backfill failed",
      };
    }
    if (deskRows === 0 && blobRows === 0 && SLICE_SEEDS[id]) {
      const ok = await seedSliceModule(id);
      return {
        module: id,
        action: ok ? "seed" : "skip",
        detail: ok ? "seeded defaults" : "seed failed",
      };
    }
    return { module: id, action: "skip", detail: `desk ${deskRows} blob ${blobRows}` };
  }

  switch (id) {
    case "admissions": {
      const { state } = await fetchAdmissionDeskFromDb();
      const deskRows = state.leads.length;
      const blob = await fetchServerBlob<AdmissionsState>("admissions_state");
      const blobRows = blob.state?.leads?.length ?? 0;
      if (blobRows > deskRows && blob.state) {
        const ok = (await pushAdmissionDeskToDb(blob.state)).ok;
        return {
          module: id,
          action: ok ? "backfill" : "skip",
          detail: `leads ${deskRows}→${blobRows}`,
        };
      }
      break;
    }
    case "fees": {
      const desk = await fetchFeeDeskFromDb();
      const deskRows = desk.vouchers.length;
      const blob = await fetchServerBlob<FeesState>("fees_state");
      const blobRows = blob.state?.vouchers?.length ?? 0;
      if (blobRows > deskRows && blob.state) {
        const ok = (await pushFeeDeskToDb(blob.state)).ok;
        return {
          module: id,
          action: ok ? "backfill" : "skip",
          detail: `vouchers ${deskRows}→${blobRows}`,
        };
      }
      break;
    }
    case "masters": {
      const { bundle, meta } = await fetchMastersDeskFromDb();
      const deskRows = meta?.sliceCount ?? 0;
      const blob = await fetchServerBlob<{ masters?: MastersState }>(
        "school_mirror_state",
      );
      const blobRows = blob.state?.masters?.classes?.length ?? 0;
      if (blobRows > 0 && deskRows < 5) {
        const state = blob.state?.masters ?? emptyMastersShell();
        const ok = (await pushMastersDeskToDb(state)).ok;
        return {
          module: id,
          action: ok ? "backfill" : "skip",
          detail: `masters mirror → desk`,
        };
      }
      if (deskRows === 0) {
        const ok = (await pushMastersDeskToDb(emptyMastersShell())).ok;
        return {
          module: id,
          action: ok ? "seed" : "skip",
          detail: "empty masters shell",
        };
      }
      break;
    }
    case "payments": {
      const desk = await fetchPaymentDeskFromDb();
      const blob = await fetchServerBlob<PaymentsState>("payments_state");
      if (
        (blob.state?.links?.length ?? 0) > desk.links.length &&
        blob.state
      ) {
        const ok = (await pushPaymentDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "links" };
      }
      break;
    }
    case "attendance": {
      const desk = await fetchAttendanceDeskFromDb();
      const blob = await fetchServerBlob<AttendanceState>("attendance_state");
      const dr = desk.registers.length;
      const br = blob.state?.registers?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushAttendanceDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "registers" };
      }
      break;
    }
    case "exams": {
      const { bundle } = await fetchExamDeskFromDb();
      const blob = await fetchServerBlob<ExamsState>("exams_state");
      const dr = bundle.terms.length;
      const br = blob.state?.terms?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushExamDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "terms" };
      }
      break;
    }
    case "homework": {
      const { bundle } = await fetchHomeworkDeskFromDb();
      const blob = await fetchServerBlob<HomeworkState>("homework_state");
      const dr = bundle.posts.length;
      const br = blob.state?.posts?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushHomeworkDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "posts" };
      }
      break;
    }
    case "ptm": {
      const { bundle } = await fetchPtmDeskFromDb();
      const blob = await fetchServerBlob<PtmState>("ptm_state");
      const dr = bundle.events.length;
      const br = blob.state?.events?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushPtmDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "events" };
      }
      break;
    }
    case "transport": {
      const { bundle } = await fetchTransportDeskFromDb();
      const blob = await fetchServerBlob<TransportState>("transport_state");
      const dr = bundle.routes.length;
      const br = blob.state?.routes?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushTransportDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "routes" };
      }
      break;
    }
    case "trust": {
      const { bundle } = await fetchTrustDeskFromDb();
      const blob = await fetchServerBlob<TrustState>("trust_state");
      const dr = bundle.projects.length;
      const br = blob.state?.projects?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushTrustDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "projects" };
      }
      break;
    }
    case "vault": {
      const { bundle } = await fetchVaultDeskFromDb();
      const blob = await fetchServerBlob<VaultState>("vault_state");
      const dr = bundle.documents.length;
      const br = blob.state?.documents?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushVaultDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "documents" };
      }
      break;
    }
    case "rte": {
      const { bundle } = await fetchRteDeskFromDb();
      const blob = await fetchServerBlob<RteState>("rte_state");
      const dr = bundle.seats.length;
      const br = blob.state?.seats?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushRteDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "seats" };
      }
      break;
    }
    case "timetable": {
      const { bundle } = await fetchTimetableDeskFromDb();
      const blob = await fetchServerBlob<TimetableState>("timetable_state");
      const dr = bundle.grids.length;
      const br = blob.state?.grids?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushTimetableDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "grids" };
      }
      break;
    }
    case "school_comms": {
      const { bundle } = await fetchSchoolCommsDeskFromDb();
      const blob = await fetchServerBlob<SchoolCommsState>("school_comms_state");
      const dr = bundle.notices.length + bundle.news.length;
      const br =
        (blob.state?.notices?.length ?? 0) + (blob.state?.news?.length ?? 0);
      if (br > dr && blob.state) {
        const ok = (await pushSchoolCommsDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "comms" };
      }
      break;
    }
    case "notifications": {
      const { bundle } = await fetchNotificationsDeskFromDb();
      const blob = await fetchServerBlob<NotificationsState>("notifications_state");
      const dr = bundle.items.length;
      const br = blob.state?.items?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushNotificationsDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "items" };
      }
      break;
    }
    case "student_leave": {
      const { bundle } = await fetchStudentLeaveDeskFromDb();
      const blob = await fetchServerBlob<StudentLeaveState>("student_leave_state");
      const dr = bundle.requests.length;
      const br = blob.state?.requests?.length ?? 0;
      if (br > dr && blob.state) {
        const ok = (await pushStudentLeaveDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "requests" };
      }
      break;
    }
    case "wa_threads": {
      const { bundle } = await fetchWaThreadsDeskFromDb();
      const blob = await fetchServerBlob<WaBotPersistBundle>("wa_bot_threads_state");
      const dr = Object.keys(bundle).length;
      const br = blob.state ? Object.keys(blob.state).length : 0;
      if (br > dr && blob.state) {
        const ok = (await pushWaThreadsDeskToDb(blob.state)).ok;
        return { module: id, action: ok ? "backfill" : "skip", detail: "slices" };
      }
      break;
    }
    default:
      break;
  }

  return { module: id, action: "skip", detail: "ok" };
}

/** Backfill desk from blobs + seed empty slice modules with defaults. */
export async function ensureDeskCutoverServer(): Promise<EnsureDeskResult> {
  const actions: EnsureDeskAction[] = [];

  for (const mod of DESK_CUTOVER_MODULES) {
    const action = await ensurePrimaryModule(mod.id);
    if (action.action !== "skip" || mod.id in SLICE_SEEDS) {
      actions.push(action);
    }
  }

  // Ensure slice registry modules not duplicated in loop above are covered
  for (const def of DESK_SLICE_MODULE_DEFS) {
    if (actions.some((a) => a.module === def.id)) continue;
    const deskRows = await deskSliceRows(def.id);
    const blobRows = await blobSliceRows(def.id, def.blobTable);
    if (blobRows > deskRows) {
      const ok = await backfillSliceModule(def.id);
      actions.push({
        module: def.id,
        action: ok ? "backfill" : "skip",
        detail: `blob ${blobRows} → desk`,
      });
    } else if (deskRows === 0 && blobRows === 0 && SLICE_SEEDS[def.id]) {
      const ok = await seedSliceModule(def.id);
      actions.push({
        module: def.id,
        action: ok ? "seed" : "skip",
        detail: "defaults",
      });
    }
  }

  return { ok: true, actions };
}
