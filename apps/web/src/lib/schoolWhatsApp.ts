/**
 * The school's WhatsApp chat entry, as handed to the parent app.
 *
 * Pure: turns a display number ("+91 94519 38805") into the E.164 digits a
 * wa.me link wants and the link itself. The number's SOURCE lives in
 * schoolWhatsApp.server.ts; nothing here invents one — a blank in gives
 * null out, and the app hides its WhatsApp card.
 */
export type SchoolWhatsAppContact = {
  /** E.164 digits, no plus: "919451938805". */
  number: string;
  /** As Meta shows it: "+91 94519 38805". */
  display: string;
  /** Opens the chat with a greeting the parent bot answers. */
  chatUrl: string;
};

export const SCHOOL_WHATSAPP_GREETING = "Hi";

export function schoolWhatsAppContactFromDisplay(
  display: string | null | undefined,
): SchoolWhatsAppContact | null {
  const digits = (display ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const number = digits.length === 10 ? `91${digits}` : digits;
  return {
    number,
    display: (display ?? "").trim(),
    chatUrl: `https://wa.me/${number}?text=${encodeURIComponent(SCHOOL_WHATSAPP_GREETING)}`,
  };
}
