import type { PayrollState } from "@/lib/payroll";
import { payrollReadFromDbEnabled } from "@/lib/payrollDbConfig";
import type { PayrollDeskBundle } from "@/lib/payrollNormalized.server";

export function mergeDbDeskIntoPayrollState(
  state: PayrollState,
  bundle: PayrollDeskBundle,
  opts?: { preferDb?: boolean },
): PayrollState {
  const hasRemote = bundle.runs.length > 0 || bundle.audit.length > 0;
  if (!hasRemote && !opts?.preferDb && !payrollReadFromDbEnabled()) return state;

  const preferDb = !!opts?.preferDb || payrollReadFromDbEnabled();

  function mergeById<T extends { id: string }>(
    local: T[],
    remote: T[],
    takeRemote: boolean,
  ): T[] {
    const byId = new Map<string, T>();
    if (!takeRemote) {
      for (const row of local) byId.set(row.id, row);
    }
    for (const row of remote) byId.set(row.id, row);
    if (!takeRemote) {
      for (const row of local) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  }

  return {
    version: 2,
    runs: mergeById(
      state.runs ?? [],
      bundle.runs,
      preferDb || bundle.runs.length >= (state.runs?.length ?? 0),
    ),
    audit: mergeById(
      state.audit ?? [],
      bundle.audit,
      preferDb || bundle.audit.length >= (state.audit?.length ?? 0),
    ),
  };
}
