/**
 * Payroll state — jsonb blob on payroll_state + normalized payroll_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadPayroll,
  payrollStateIsEmpty,
  writePayrollLocalRaw,
  type PayrollState,
} from "@/lib/payroll";
import {
  hydratePayrollDeskFromDb,
  schedulePayrollDeskSync,
} from "@/lib/payrollNormalizedClient";
import { mergeDbDeskIntoPayrollState } from "@/lib/payrollNormalizedMerge";
import { payrollReadFromDbEnabled } from "@/lib/payrollDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "payroll";

const blob = createDomainBlobPersistence<PayrollState>({
  table: "payroll_state",
  metaKey: "bhb_payroll_v1_remote_meta",
  label: "payroll",
  isEmpty: payrollStateIsEmpty,
  loadLocal: loadPayroll,
  writeLocalRaw: writePayrollLocalRaw,
});

export const payrollRemoteEnabled = blob.remoteEnabled;
export const schedulePayrollSync = (state: PayrollState) => {
  if (typeof window === "undefined") {
    void pushPayrollRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("payroll")) blob.scheduleSync(state);
  schedulePayrollDeskSync(state);
};
export const ensurePayrollHydrated = async () => {
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

  const readFromDb = payrollReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("payroll")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydratePayrollDeskFromDb(readFromDb);
  if (changed && (bundle.runs.length > 0 || readFromDb)) {
    writePayrollLocalRaw(
      mergeDbDeskIntoPayrollState(loadPayroll(), bundle, { preferDb: readFromDb }),
    );
    normChanged = true;
  }
  if (normChanged) schedulePayrollSync(loadPayroll());
  return blobChanged || normChanged;
};

export async function pushPayrollRemoteServer(
  state: PayrollState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushPayrollDeskToDb } = await import("@/lib/payrollNormalized.server");
  const desk = await pushPayrollDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("payroll")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<PayrollState>("payroll_state");
  const remoteRuns = remote.state?.runs?.length ?? 0;
  const nextRuns = state.runs?.length ?? 0;
  if (nextRuns < remoteRuns && remote.state) return { ok: true };

  return pushServerBlob("payroll_state", state);
}

export async function ensurePayrollHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchPayrollDeskFromDb } = await import("@/lib/payrollNormalized.server");
  const { payrollReadFromDbEnabled } = await import("@/lib/payrollDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadPayroll();
  let changed = false;

  if (!deskSkipBlobPush("payroll")) {
    const remoteBlob = await fetchServerBlob<PayrollState>("payroll_state");
    if (
      remoteBlob.state &&
      !payrollReadFromDbEnabled() &&
      !payrollStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchPayrollDeskFromDb();
  if (dbDesk.bundle.runs.length > 0 || payrollReadFromDbEnabled()) {
    state = mergeDbDeskIntoPayrollState(state, dbDesk.bundle, {
      preferDb: payrollReadFromDbEnabled() || (state.runs?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writePayrollLocalRaw(state);
  return changed;
}

export function resetPayrollPersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}
