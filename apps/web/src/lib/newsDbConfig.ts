export function newsDualWriteDbEnabled(): boolean {
  const flag = process.env.NEWS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function newsReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_NEWS_READ_FROM_DB === "true";
  }
  return process.env.NEWS_READ_FROM_DB === "true";
}
