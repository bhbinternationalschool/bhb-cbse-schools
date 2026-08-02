export function libraryDualWriteDbEnabled(): boolean {
  const flag = process.env.LIBRARY_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function libraryReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_LIBRARY_READ_FROM_DB === "true";
  }
  return process.env.LIBRARY_READ_FROM_DB === "true";
}
