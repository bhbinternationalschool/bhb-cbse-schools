/**
 * Salary setup (Masters → Salary) ↔ Supabase salary_setup_state blob.
 *
 * Until 2026-08-18 lib/salarySetup.ts was localStorage-only ("demo") and the
 * login-time cache wipe erased a whole salary setup. One row per tenant, one
 * payroll admin editing — the shared blob helper (pull on hydrate, push on
 * explicit save) is the right shape.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadSalarySetup,
  salarySetupIsEmpty,
  writeSalarySetupLocalRaw,
  type SalarySetupState,
} from "@/lib/salarySetup";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "salary_setup";

const blob = createDomainBlobPersistence<SalarySetupState>({
  table: "salary_setup_state",
  metaKey: "bhb_salary_setup_v1_remote_meta",
  label: "salary setup",
  isEmpty: salarySetupIsEmpty,
  loadLocal: loadSalarySetup,
  writeLocalRaw: writeSalarySetupLocalRaw,
});

export const salarySetupRemoteEnabled = blob.remoteEnabled;

export function scheduleSalarySetupSync(state: SalarySetupState): void {
  blob.scheduleSync(state);
}

export async function ensureSalarySetupHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;
  const changed = await blob.ensureHydrated();
  markDeskHydrated(MODULE);
  return changed;
}

export function resetSalarySetupPersistenceCache(): void {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}
