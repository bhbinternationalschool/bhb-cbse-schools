export function mastersDualWriteDbEnabled(): boolean {
  const flag = process.env.MASTERS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function mastersReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_MASTERS_READ_FROM_DB === "true";
  }
  return process.env.MASTERS_READ_FROM_DB === "true";
}
