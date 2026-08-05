/**
 * Ops scripts — load/save desk state (Supabase SoR). No mirror JSON.
 */

import type { AdmissionsState } from "@/lib/admissions";
import { defaultAdmissionsState } from "@/lib/admissions";
import {
  fetchAdmissionDeskFromDb,
  pushAdmissionDeskToDb,
} from "@/lib/admissionsNormalized.server";
import type { FeesState } from "@/lib/fees";
import {
  fetchFeeDeskFromDb,
  pushFeeDeskToDb,
} from "@/lib/feesNormalized.server";
import { mergeDbDeskIntoFeesState } from "@/lib/feesNormalizedMerge";
import type { MastersState } from "@/lib/masters";
import { emptyMastersShell } from "@/lib/masters";
import {
  fetchMastersDeskFromDb,
  pushMastersDeskToDb,
} from "@/lib/mastersNormalized.server";
import type { SisState } from "@/lib/sis";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";

function emptyFees(): FeesState {
  return {
    version: 1,
    vouchers: [],
    cheques: [],
    manualBooks: [],
    dayCloses: [],
    installmentPlans: [],
    planAllocations: [],
    carriedForwardDues: [],
    chargeVouchers: [],
  };
}

function bundleToSisState(bundle: {
  households: SisState["households"];
  students: SisState["students"];
}): SisState {
  return {
    households: bundle.households,
    students: bundle.students,
  } as SisState;
}

export async function loadOpsAdmissions(): Promise<AdmissionsState> {
  const { state } = await fetchAdmissionDeskFromDb();
  return state?.leads ? state : defaultAdmissionsState();
}

export async function saveOpsAdmissions(state: AdmissionsState): Promise<void> {
  const result = await pushAdmissionDeskToDb(state);
  if (!result.ok) throw new Error(result.error || "admissions desk push failed");
}

export async function loadOpsFees(): Promise<FeesState> {
  const desk = await fetchFeeDeskFromDb();
  return mergeDbDeskIntoFeesState(emptyFees(), desk, { preferDb: true });
}

export async function saveOpsFees(state: FeesState): Promise<void> {
  const result = await pushFeeDeskToDb(state);
  if (!result.ok) throw new Error(result.error || "fees desk push failed");
}

export async function loadOpsMasters(): Promise<MastersState> {
  const { bundle } = await fetchMastersDeskFromDb();
  if ((bundle.classes?.length ?? 0) > 0 || (bundle.feeHeads?.length ?? 0) > 0) {
    return { version: 2, ...bundle };
  }
  return emptyMastersShell();
}

export async function saveOpsMasters(state: MastersState): Promise<void> {
  const result = await pushMastersDeskToDb(state);
  if (!result.ok) throw new Error(result.error || "masters desk push failed");
}

export async function loadOpsSis(): Promise<SisState> {
  const { bundle } = await fetchSisFromDb();
  return bundleToSisState(bundle);
}
