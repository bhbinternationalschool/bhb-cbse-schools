/**
 * statutory_desk_* tables + grants are applied (migrations 20260812204851 /
 * 20260812204901). Both flags now default ON, same pattern as payroll's
 * payrollDbConfig.ts — set the env var to "false"/"0" to opt back out.
 */
export function statutoryDualWriteDbEnabled(): boolean {
  const flag = process.env.STATUTORY_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function statutoryReadFromDbEnabled(): boolean {
  const flag =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_STATUTORY_READ_FROM_DB?.trim().toLowerCase()
      : process.env.STATUTORY_READ_FROM_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}
