export function sisDualWriteDbEnabled(): boolean {
  const flag = process.env.SIS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function sisReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_SIS_READ_FROM_DB === "true";
  }
  return process.env.SIS_READ_FROM_DB === "true";
}
