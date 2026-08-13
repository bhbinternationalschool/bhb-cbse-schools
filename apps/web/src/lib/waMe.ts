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

export function openWaMe(mobile: string, text: string, fallbackMobile?: string): void {
  if (typeof window === "undefined") return;
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 10) return;

  // Dispatch via official WhatsApp Business Cloud API first. fallbackMobile
  // (e.g. the household's altMobile) is retried automatically by the
  // dispatch route if the primary number's send fails synchronously.
  void fetch("/api/wa/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ mobile: digits, fallbackMobile, body: text }],
    }),
  }).catch(() => null);

  window.open(waMeUrl(mobile, text), "_blank", "noopener,noreferrer");
}
