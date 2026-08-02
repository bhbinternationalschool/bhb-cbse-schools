export function timetableDualWriteDbEnabled(): boolean {
  const flag = process.env.TIMETABLE_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function timetableReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_TIMETABLE_READ_FROM_DB === "true";
  }
  return process.env.TIMETABLE_READ_FROM_DB === "true";
}
