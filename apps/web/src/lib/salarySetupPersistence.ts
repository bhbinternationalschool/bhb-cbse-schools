/**
 * Salary setup (Masters → Salary) ↔ Supabase salary_setup_state blob.
 *
 * Until 2026-08-18 lib/salarySetup.ts was localStorage-only ("demo") and the
 * login-time cache wipe erased a whole salary setup. One row per tenant, one
 * payroll admin editing — the shared blob helper (pull on hydrate, push on
 * explicit save) is the right shape.
 */

import { refuseSaveBeforeLoad } from "@/lib/deskLoadGuard";
import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import { assertModulePermission } from "@/lib/rbacGuard";
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
  // Not before this page has loaded the desk (lib/deskLoadGuard).
  if (refuseSaveBeforeLoad(MODULE, () => ensureSalarySetupHydrated())) return;
  blob.scheduleSync(state);
}

/**
 * Save salary setup and wait for the server's answer (the "not on payroll"
 * switch, which is audited only once it is really saved). Refused or
 * failed: the local copy goes back to `previous` and the reason is returned.
 */
export async function saveSalarySetupConfirmed(
  next: SalarySetupState,
  previous: SalarySetupState,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!assertModulePermission("payroll", "edit", "saveSalarySetup")) {
    return { ok: false, error: "You do not have permission to change salary setup — nothing was saved." };
  }
  if (refuseSaveBeforeLoad(MODULE, () => ensureSalarySetupHydrated())) {
    return { ok: false, error: "Salary setup has not loaded yet — nothing was saved. Try again in a moment." };
  }
  writeSalarySetupLocalRaw(next);
  const r = await blob.saveNow(next);
  if (!r.ok) {
    // A conflict already re-pulled the server copy; anything else goes back.
    if (!r.conflict) writeSalarySetupLocalRaw(previous);
    return { ok: false, error: `Salary setup ${r.error}` };
  }
  return { ok: true };
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
