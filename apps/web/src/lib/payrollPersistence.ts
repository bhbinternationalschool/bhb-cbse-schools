/**
 * Payroll remote sync — jsonb blob on payroll_state.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadPayroll,
  payrollStateIsEmpty,
  writePayrollLocalRaw,
  type PayrollState,
} from "@/lib/payroll";

const blob = createDomainBlobPersistence<PayrollState>({
  table: "payroll_state",
  metaKey: "bhb_payroll_v1_remote_meta",
  label: "payroll",
  isEmpty: payrollStateIsEmpty,
  loadLocal: loadPayroll,
  writeLocalRaw: writePayrollLocalRaw,
});

export const payrollRemoteEnabled = blob.remoteEnabled;
export const schedulePayrollSync = blob.scheduleSync;
export const ensurePayrollHydrated = blob.ensureHydrated;
export const resetPayrollPersistenceCache = blob.resetCache;
