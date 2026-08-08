export function staffDualWriteDbEnabled(): boolean {
  const flag = process.env.STAFF_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function staffReadFromDbEnabled(): boolean {
  const flag = (
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_STAFF_READ_FROM_DB
      : process.env.STAFF_READ_FROM_DB
  )?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}
