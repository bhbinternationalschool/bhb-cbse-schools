export function purchaseDualWriteDbEnabled(): boolean {
  const flag = process.env.PURCHASE_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function purchaseReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_PURCHASE_READ_FROM_DB === "true";
  }
  return process.env.PURCHASE_READ_FROM_DB === "true";
}
