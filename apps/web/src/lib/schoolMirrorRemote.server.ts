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
import { defaultAdmissionsState, type AdmissionsState } from "@/lib/admissions";
import { fetchAdmissionsRemoteServer } from "@/lib/admissionsPersistence";
import { defaultMasters, type MastersState } from "@/lib/masters";
import { emptyFeesState, type FeesState } from "@/lib/fees";
import { emptyPaymentsState, type PaymentsState } from "@/lib/payments";
import { emptySisState, type SisState } from "@/lib/sis";
import {
  fetchSisRemoteServer,
  mergeSisRemoteIntoState,
} from "@/lib/sisPersistence";
import {
  fetchStaffRemoteServer,
  mergeStaffRemoteIntoMasters,
} from "@/lib/staffPersistence";

let lastHydrateMs = 0;
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

  const remoteBlob = await fetchServerBlob<SchoolMirrorBundle>(
    "school_mirror_state",
  );
  let next: SchoolMirrorBundle = {
    version: 1,
    updatedAt: remoteBlob.updatedAt || cur.updatedAt || nowIso(),
    sis: remoteBlob.state?.sis ?? cur.sis,
    fees: remoteBlob.state?.fees ?? cur.fees,
    payments: remoteBlob.state?.payments ?? cur.payments,
    masters: remoteBlob.state?.masters ?? cur.masters,
    admissions: remoteBlob.state?.admissions ?? cur.admissions,
  };

  const sisRemote = await fetchSisRemoteServer();
  if (sisRemote && (sisRemote.households.length > 0 || sisRemote.students.length > 0)) {
    const base =
      (next.sis as SisState | null) && Array.isArray((next.sis as SisState).households)
        ? (next.sis as SisState)
        : emptySisState();
    next = {
      ...next,
      sis: mergeSisRemoteIntoState(base, sisRemote),
      updatedAt: nowIso(),
    };
  }

  const mastersBase =
    (next.masters as MastersState | null) &&
    Array.isArray((next.masters as MastersState).classes)
      ? (next.masters as MastersState)
      : defaultMasters();
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

  const [feesBlob, payBlob, admissionsRemote] = await Promise.all([
    fetchServerBlob<FeesState>("fees_state"),
    fetchServerBlob<PaymentsState>("payments_state"),
    fetchAdmissionsRemoteServer(),
  ]);
  if (feesBlob.state) {
    next = { ...next, fees: feesBlob.state, updatedAt: nowIso() };
  }
  if (payBlob.state) {
    next = { ...next, payments: payBlob.state, updatedAt: nowIso() };
  }

  const mirrorAdmissions = next.admissions as AdmissionsState | null;
  const mirrorLeads = admissionsLeadCount(mirrorAdmissions);
  const blobLeads = admissionsLeadCount(admissionsRemote);
  if (blobLeads > 0 && admissionsRemote) {
    next = { ...next, admissions: admissionsRemote, updatedAt: nowIso() };
  } else if (mirrorLeads === 0 && !next.admissions) {
    next = { ...next, admissions: defaultAdmissionsState() };
  }

  if (!next.fees) next = { ...next, fees: emptyFeesState() };
  if (!next.payments) next = { ...next, payments: emptyPaymentsState() };
  if (!next.masters) next = { ...next, masters: defaultMasters() };
  if (!next.sis) next = { ...next, sis: emptySisState() };
  if (!next.admissions) next = { ...next, admissions: defaultAdmissionsState() };

  replaceSchoolMirror(next);
  lastHydrateMs = now;
  return true;
}
