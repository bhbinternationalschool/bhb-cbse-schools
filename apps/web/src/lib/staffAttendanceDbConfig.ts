export function staffAttendanceDualWriteDbEnabled(): boolean {
  const flag = process.env.STAFF_ATTENDANCE_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function staffAttendanceReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_STAFF_ATTENDANCE_READ_FROM_DB === "true";
  }
  return process.env.STAFF_ATTENDANCE_READ_FROM_DB === "true";
}
