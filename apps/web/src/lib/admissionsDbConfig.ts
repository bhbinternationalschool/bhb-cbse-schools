export function admissionsDualWriteDbEnabled(): boolean {
  const flag = process.env.ADMISSIONS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function admissionsReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_ADMISSIONS_READ_FROM_DB === "true";
  }
  return process.env.ADMISSIONS_READ_FROM_DB === "true";
}
