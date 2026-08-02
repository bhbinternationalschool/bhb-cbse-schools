export function trustDualWriteDbEnabled(): boolean {
  const flag = process.env.TRUST_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function trustReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_TRUST_READ_FROM_DB === "true";
  }
  return process.env.TRUST_READ_FROM_DB === "true";
}
