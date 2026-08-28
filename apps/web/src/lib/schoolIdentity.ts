/**
 * The school's printed identity — one source for every document.
 *
 * Receipts, slips and certificates all need the same block: who the school
 * is, where it is, how to reach it, and the statutory numbers. Empty fields
 * are dropped rather than printed blank, because a financial document with a
 * placeholder UDISE code or phone number is worse than one without it.
 */

import { TENANT } from "@/lib/types";

/** "Affiliation 213XXXX · School code 70XXX · UDISE 09xxxxxxxxx" */
export function schoolStatutoryLine(): string {
  return [
    TENANT.affiliationNo ? `Affiliation ${TENANT.affiliationNo}` : "",
    TENANT.schoolCode ? `School code ${TENANT.schoolCode}` : "",
    TENANT.udiseCode ? `UDISE ${TENANT.udiseCode}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Ph 0542-xxxxxxx · WhatsApp 9xxxxxxxxx · office@… · bhbinternational.school" */
export function schoolContactLine(): string {
  const wa =
    TENANT.whatsappNumber && TENANT.whatsappNumber !== TENANT.officePhone
      ? `WhatsApp ${TENANT.whatsappNumber}`
      : "";
  return [
    TENANT.officePhone ? `Ph ${TENANT.officePhone}` : "",
    wa,
    TENANT.officeEmail,
    TENANT.domain,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function schoolAddressLine(): string {
  return TENANT.schoolAddress;
}
