export function studentLeaveDualWriteDbEnabled(): boolean {
  const flag = process.env.STUDENT_LEAVE_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function studentLeaveReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_STUDENT_LEAVE_READ_FROM_DB === "true";
  }
  return process.env.STUDENT_LEAVE_READ_FROM_DB === "true";
}
