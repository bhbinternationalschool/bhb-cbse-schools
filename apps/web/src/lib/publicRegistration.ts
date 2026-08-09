/**
 * Shared shape of the public /register page config.
 * Resolved server-side in `publicRegistration.server.ts` and passed to the
 * client form as props — the form must never derive these from masters itself.
 */

export type PublicRegistrationClass = { id: string; name: string };

export type PublicRegistrationConfig = {
  /** Active classes a parent may apply to. Empty ⇒ registration is closed. */
  classes: PublicRegistrationClass[];
  /** Registration fee head the lead is billed against. */
  feeHead: { id: string; name: string } | null;
  /** Collections UPI for the payment QR. */
  upi: { vpa: string; payeeName: string } | null;
  /** Where the masters came from — for diagnostics, not shown to parents. */
  source: "desk" | "none";
};

export const UNAVAILABLE_REGISTRATION_CONFIG: PublicRegistrationConfig = {
  classes: [],
  feeHead: null,
  upi: null,
  source: "none",
};
