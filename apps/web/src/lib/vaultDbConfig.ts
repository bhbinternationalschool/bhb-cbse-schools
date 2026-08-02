export function vaultDualWriteDbEnabled(): boolean {
  const flag = process.env.VAULT_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function vaultReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_VAULT_READ_FROM_DB === "true";
  }
  return process.env.VAULT_READ_FROM_DB === "true";
}
