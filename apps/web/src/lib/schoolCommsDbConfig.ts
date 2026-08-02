export function schoolCommsDualWriteDbEnabled(): boolean {
  const flag = process.env.SCHOOL_COMMS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function schoolCommsReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_SCHOOL_COMMS_READ_FROM_DB === "true";
  }
  return process.env.SCHOOL_COMMS_READ_FROM_DB === "true";
}
