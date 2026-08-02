import { feesReadFromDbFlag } from "@/lib/feesNormalizedMerge";

export function feesDualWriteDbEnabled(): boolean {
  const flag = process.env.FEES_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function feesReadFromDbEnabled(): boolean {
  return feesReadFromDbFlag();
}
