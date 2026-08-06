/**
 * Hydrate server school mirror from Supabase (SIS tables + domain blobs).
 * Required on Cloud Run where localStorage / .data are empty.
 * Read-only toward Supabase — never write empty slices back on hydrate.
 */

import {
  getSchoolMirrorSync,
  replaceSchoolMirror,
  type SchoolMirrorBundle,
} from "@/lib/schoolDataMirror";
import { fetchServerBlob } from "@/lib/serverBlob";
import { defaultAdmissionsState, type AdmissionsState, admissionsStateIsEmpty } from "@/lib/admissions";
import { fetchAdmissionsRemoteServer } from "@/lib/admissionsPersistence";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import { emptyFeesState, type FeesState } from "@/lib/fees";
import { emptyPaymentsState, type PaymentsState } from "@/lib/payments";
import { emptySisState, type SisState } from "@/lib/sis";
import {
  fetchStaffRemoteServer,
  mergeStaffRemoteIntoMasters,
} from "@/lib/staffPersistence";

let lastHydrateMs = 0;
let inFlightPromise: Promise<boolean> | null = null;
const HYDRATE_TTL_MS = 45_000;

function nowIso() {
  return new Date().toISOString();
}

function admissionsLeadCount(adm: AdmissionsState | null | undefined): number {
  return Array.isArray(adm?.leads) ? adm.leads.length : 0;
}

function mirrorLooksEmpty(bundle: SchoolMirrorBundle): boolean {
  const sis = bundle.sis as SisState | null;
  const masters = bundle.masters as MastersState | null;
  const admissions = bundle.admissions as AdmissionsState | null;
  const hasSis =
    !!sis &&
    ((sis.households?.length ?? 0) > 0 || (sis.students?.length ?? 0) > 0);
  const hasStaff = (masters?.staff?.length ?? 0) > 0;
  const hasLeads = admissionsLeadCount(admissions) > 0;
  return !hasSis && !hasStaff && !hasLeads;
}

export async function hydrateSchoolMirrorFromRemote(
  opts?: { force?: boolean },
): Promise<boolean> {
  const now = Date.now();
  const cur = getSchoolMirrorSync();
  if (
    !opts?.force &&
    !mirrorLooksEmpty(cur) &&
    now - lastHydrateMs < HYDRATE_TTL_MS
  ) {
    return false;
  }

  if (inFlightPromise && !opts?.force) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const remoteBlob = await fetchServerBlob<SchoolMirrorBundle>(
        "school_mirror_state",
      );
      const { sisReadFromDbEnabled } = await import("@/lib/sisDbConfig");
      const { feesReadFromDbEnabled } = await import("@/lib/feesDbConfig");
      const { paymentsReadFromDbEnabled } = await import("@/lib/paymentsDbConfig");
      let next: SchoolMirrorBundle = {
        version: 1,
        updatedAt: remoteBlob.updatedAt || cur.updatedAt || nowIso(),
        sis: sisReadFromDbEnabled()
          ? cur.sis
          : (remoteBlob.state?.sis ?? cur.sis),
        fees: feesReadFromDbEnabled()
          ? cur.fees
          : (remoteBlob.state?.fees ?? cur.fees),
        payments: paymentsReadFromDbEnabled()
          ? cur.payments
          : (remoteBlob.state?.payments ?? cur.payments),
        masters: remoteBlob.state?.masters ?? cur.masters,
        admissions: remoteBlob.state?.admissions ?? cur.admissions,
      };

      const { ensureSisHydratedServer } = await import("@/lib/sisPersistence");
      if (await ensureSisHydratedServer()) {
        const hydrated = getSchoolMirrorSync().sis as SisState | null;
        if (hydrated) {
          next = { ...next, sis: hydrated, updatedAt: nowIso() };
        }
      }

      const { ensureFeesHydratedServer } = await import("@/lib/feesPersistence.server");
      if (await ensureFeesHydratedServer()) {
        const hydrated = getSchoolMirrorSync().fees as FeesState | null;
        if (hydrated) {
          next = { ...next, fees: hydrated, updatedAt: nowIso() };
        }
      }

      const { ensurePaymentsHydratedServer } = await import(
        "@/lib/paymentsPersistence"
      );
      if (await ensurePaymentsHydratedServer()) {
        const hydrated = getSchoolMirrorSync().payments as PaymentsState | null;
        if (hydrated) {
          next = { ...next, payments: hydrated, updatedAt: nowIso() };
        }
      }

      const mastersBase =
        (next.masters as MastersState | null) &&
        Array.isArray((next.masters as MastersState).classes)
          ? (next.masters as MastersState)
          : emptyMastersShell();
      const staffRemote = await fetchStaffRemoteServer();
      if (
        staffRemote &&
        (staffRemote.staff.length > 0 ||
          staffRemote.departments.length > 0 ||
          staffRemote.designations.length > 0)
      ) {
        next = {
          ...next,
          masters: mergeStaffRemoteIntoMasters(mastersBase, staffRemote),
          updatedAt: nowIso(),
        };
      }

      const [admissionsRemote] = await Promise.all([
        fetchAdmissionsRemoteServer(),
      ]);

      const { admissionsReadFromDbEnabled } = await import("@/lib/admissionsDbConfig");
      const mirrorAdmissions = next.admissions as AdmissionsState | null;
      const mirrorLeads = admissionsLeadCount(mirrorAdmissions);
      const blobLeads = admissionsLeadCount(admissionsRemote);
      if (
        !admissionsReadFromDbEnabled() &&
        blobLeads > 0 &&
        admissionsRemote
      ) {
        next = { ...next, admissions: admissionsRemote, updatedAt: nowIso() };
      } else if (admissionsReadFromDbEnabled() && admissionsRemote) {
        next = { ...next, admissions: admissionsRemote, updatedAt: nowIso() };
      } else if (mirrorLeads === 0 && !next.admissions) {
        next = { ...next, admissions: defaultAdmissionsState() };
      }

      if (!next.fees) next = { ...next, fees: emptyFeesState() };
      if (!next.payments) next = { ...next, payments: emptyPaymentsState() };
      if (!next.masters) next = { ...next, masters: emptyMastersShell() };
      if (!next.sis) next = { ...next, sis: emptySisState() };
      if (!next.admissions) next = { ...next, admissions: defaultAdmissionsState() };

      const { ensureAttendanceHydratedServer } = await import(
        "@/lib/attendancePersistence"
      );
      await ensureAttendanceHydratedServer();

      const { ensureExamsHydratedServer } = await import("@/lib/examsPersistence");
      await ensureExamsHydratedServer();

      const { ensureAdmissionsHydratedServer } = await import(
        "@/lib/admissionsPersistence"
      );
      await ensureAdmissionsHydratedServer();

      const { loadAdmissions } = await import("@/lib/admissions");
      const hydratedAdmissions = loadAdmissions();
      if (!admissionsStateIsEmpty(hydratedAdmissions)) {
        next = { ...next, admissions: hydratedAdmissions, updatedAt: nowIso() };
      }

      replaceSchoolMirror(next);
      lastHydrateMs = Date.now();
      return true;
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}
