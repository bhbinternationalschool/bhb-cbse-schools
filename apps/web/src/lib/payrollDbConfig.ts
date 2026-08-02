export function payrollDualWriteDbEnabled(): boolean {
  const flag = process.env.PAYROLL_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function payrollReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_PAYROLL_READ_FROM_DB === "true";
  }
  return process.env.PAYROLL_READ_FROM_DB === "true";
}
