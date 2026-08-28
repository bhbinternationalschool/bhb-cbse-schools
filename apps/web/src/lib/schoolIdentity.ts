/**
 * The school's printed identity — one source for every document.
 *
 * Receipts, slips and certificates all need the same block: who the school
 * is, where it is, how to reach it, and the statutory numbers.
 *
 * The values come from Masters → School profile, which is where the office
 * actually maintains them. TENANT is only a fallback for a field the profile
 * leaves blank, never an override — otherwise editing Masters would appear to
 * do nothing. Empty fields are dropped rather than printed blank, because a
 * financial document carrying a placeholder UDISE code is worse than one
 * carrying none.
 */

import { normalizeSchoolProfile, type SchoolProfile } from "@/lib/foundationMasters";
import { loadMasters, type MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";

/**
 * The school's verified WhatsApp Business number. Parents already message
 * this number, so it is the right one to print when Masters has none set.
 */
export const SCHOOL_WHATSAPP_FALLBACK = "+91 94519 38805";

/** A placeholder is worse than a blank — never print one on a receipt. */
function real(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return /X{3,}/i.test(v) ? "" : v;
}

/**
 * Resolve the printed profile. Pass `masters` when the caller already has it
 * loaded; otherwise it is read from Masters and memoised briefly, because a
 * dual-copy receipt asks for the identity six times and parsing the whole
 * Masters blob per line would show up on print.
 */
let memo: { at: number; profile: SchoolProfile } | null = null;
const MEMO_MS = 5000;

export function schoolIdentity(masters?: MastersState | null): SchoolProfile {
  if (masters) return normalizeSchoolProfile(masters.schoolProfile);
  if (typeof window === "undefined") return normalizeSchoolProfile(null);
  const now = Date.now();
  if (memo && now - memo.at < MEMO_MS) return memo.profile;
  const profile = normalizeSchoolProfile(loadMasters().schoolProfile);
  memo = { at: now, profile };
  return profile;
}

/** Drop the memo after Masters → School profile is saved. */
export function forgetSchoolIdentity(): void {
  memo = null;
}

/** "Affiliation 2131234 · School code 70123 · UDISE 09123456789" */
export function schoolStatutoryLine(masters?: MastersState | null): string {
  const p = schoolIdentity(masters);
  const affiliation = real(p.affiliationNo) || real(TENANT.affiliationNo);
  const code = real(p.schoolCode) || real(TENANT.schoolCode);
  const udise = real(p.udiseCode) || real(TENANT.udiseCode);
  return [
    affiliation ? `Affiliation ${affiliation}` : "",
    code ? `School code ${code}` : "",
    udise ? `UDISE ${udise}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Ph 0542-… · WhatsApp +91 94519 38805 · office@… · bhbinternational.school" */
export function schoolContactLine(masters?: MastersState | null): string {
  const p = schoolIdentity(masters);
  const phone = real(p.phone) || real(p.mobile) || real(TENANT.officePhone);
  const whatsapp =
    real(p.whatsapp) || real(TENANT.whatsappNumber) || SCHOOL_WHATSAPP_FALLBACK;
  const email = real(p.email) || real(TENANT.officeEmail);
  const site = real(p.website).replace(/^https?:\/\//, "") || TENANT.domain;
  return [
    phone ? `Ph ${phone}` : "",
    // Don't print the same number twice when the office line is WhatsApp too.
    whatsapp && whatsapp.replace(/\D/g, "") !== phone.replace(/\D/g, "")
      ? `WhatsApp ${whatsapp}`
      : "",
    email,
    site,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Piyamilan Chauraha, Baniyavapar, Ayar, Varanasi, Uttar Pradesh 221202" */
export function schoolAddressLine(masters?: MastersState | null): string {
  const p = schoolIdentity(masters);
  const street = real(p.address);
  // The office often types the whole address into one field. Append city,
  // state or pincode only when the street line doesn't already carry them,
  // otherwise the receipt prints "…Varanasi, UP 221202, Varanasi, UP 221202".
  const has = (part: string) =>
    !!part && street.toLowerCase().includes(part.toLowerCase());
  const tail = [
    has(real(p.city)) ? "" : real(p.city),
    [
      has(real(p.state)) ? "" : real(p.state),
      has(real(p.pincode)) ? "" : real(p.pincode),
    ]
      .filter(Boolean)
      .join(" "),
  ].filter(Boolean);
  const line = [street, ...tail].filter(Boolean).join(", ");
  return line || TENANT.schoolAddress;
}

/** The name to head a printed document with. */
export function schoolPrintName(masters?: MastersState | null): string {
  const p = schoolIdentity(masters);
  return real(p.displayName) || real(p.legalName) || TENANT.nameDisplay;
}
