export function admissionsDualWriteDbEnabled(): boolean {
  const flag = process.env.ADMISSIONS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function admissionsReadFromDbEnabled(): boolean {
  const flag = (
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_ADMISSIONS_READ_FROM_DB
      : process.env.ADMISSIONS_READ_FROM_DB
  )?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}
