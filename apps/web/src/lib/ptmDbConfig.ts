export function ptmDualWriteDbEnabled(): boolean {
  const flag = process.env.PTM_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function ptmReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_PTM_READ_FROM_DB === "true";
  }
  return process.env.PTM_READ_FROM_DB === "true";
}
