export function transportDualWriteDbEnabled(): boolean {
  const flag = process.env.TRANSPORT_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function transportReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_TRANSPORT_READ_FROM_DB === "true";
  }
  return process.env.TRANSPORT_READ_FROM_DB === "true";
}
