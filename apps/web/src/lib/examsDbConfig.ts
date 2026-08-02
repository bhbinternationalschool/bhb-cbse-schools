export function examsDualWriteDbEnabled(): boolean {
  const flag = process.env.EXAMS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function examsReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_EXAMS_READ_FROM_DB === "true";
  }
  return process.env.EXAMS_READ_FROM_DB === "true";
}
