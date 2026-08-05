import type { FeesState } from "@/lib/fees";

export type FeeDeskAncillary = Pick<
  FeesState,
  | "cheques"
  | "manualBooks"
  | "dayCloses"
  | "installmentPlans"
  | "planAllocations"
  | "carriedForwardDues"
  | "chargeVouchers"
>;
