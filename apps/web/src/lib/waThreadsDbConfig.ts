export function waThreadsDualWriteDbEnabled(): boolean {
  const flag = process.env.WA_THREADS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function waThreadsReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_WA_THREADS_READ_FROM_DB === "true";
  }
  return process.env.WA_THREADS_READ_FROM_DB === "true";
}
