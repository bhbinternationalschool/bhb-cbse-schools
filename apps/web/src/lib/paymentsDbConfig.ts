export function paymentsDualWriteDbEnabled(): boolean {
  const flag = process.env.PAYMENTS_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function paymentsReadFromDbEnabled(): boolean {
  const flag = (
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_PAYMENTS_READ_FROM_DB
      : process.env.PAYMENTS_READ_FROM_DB
  )?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}
