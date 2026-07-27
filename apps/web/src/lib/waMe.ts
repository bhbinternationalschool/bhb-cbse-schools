/**
 * Client-side WhatsApp deep links (wa.me).
 * Interactive staff/parent UX uses these; unattended digests may use /api/wa/dispatch.
 */

/** Build https://wa.me/91…?text=… from a 10-digit or E.164 mobile. */
export function waMeUrl(mobile: string, text: string): string {
  const digits = mobile.replace(/\D/g, "");
  const phone = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function openWaMe(mobile: string, text: string): void {
  if (typeof window === "undefined") return;
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 10) return;
  window.open(waMeUrl(mobile, text), "_blank", "noopener,noreferrer");
}
