import { attendanceReadFromDbFlag } from "@/lib/attendanceNormalizedMerge";

export function attendanceDualWriteDbEnabled(): boolean {
  const flag = process.env.ATTENDANCE_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function attendanceReadFromDbEnabled(): boolean {
  return attendanceReadFromDbFlag();
}
