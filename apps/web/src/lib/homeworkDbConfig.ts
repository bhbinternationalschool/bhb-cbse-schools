export function homeworkDualWriteDbEnabled(): boolean {
  const flag = process.env.HOMEWORK_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function homeworkReadFromDbEnabled(): boolean {
  const flag = (
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_HOMEWORK_READ_FROM_DB
      : process.env.HOMEWORK_READ_FROM_DB
  )?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}
