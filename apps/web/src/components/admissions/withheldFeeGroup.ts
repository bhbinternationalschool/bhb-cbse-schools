import type { AdmissionLead } from "@/lib/admissions";

/**
 * data-layer 2.1g. A reader without the Masters view gets the teaching
 * subset: its fee-group list is WITHHELD, not empty. Enrolling would then
 * resolve the child's fee group to "none" and the child would carry no dues —
 * so it is refused unless the lead already names its fee group.
 */
export function withheldFeeGroupRefusal(
  feesWithheld: boolean,
  lead: Pick<AdmissionLead, "feeGroupId"> | null | undefined,
): string | null {
  if (!feesWithheld || lead?.feeGroupId) return null;
  return "Fee groups are not shown to your role — ask the office to send this child to Students.";
}
