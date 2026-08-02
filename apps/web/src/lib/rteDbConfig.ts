export function rteDualWriteDbEnabled(): boolean {
  const flag = process.env.RTE_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function rteReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_RTE_READ_FROM_DB === "true";
  }
  return process.env.RTE_READ_FROM_DB === "true";
}
