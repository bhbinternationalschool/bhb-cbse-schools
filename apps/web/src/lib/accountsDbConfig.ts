export function accountsDualWriteDbEnabled(): boolean {
  const flag = process.env.ACCOUNTS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function accountsReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_ACCOUNTS_READ_FROM_DB === "true";
  }
  return process.env.ACCOUNTS_READ_FROM_DB === "true";
}
