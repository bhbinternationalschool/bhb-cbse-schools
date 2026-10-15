/**
 * The only numbers whose WhatsApp payment screenshots are read and recorded
 * (director, 15 Oct 2026: "not from any staff number — only the owner number
 * 9919101755 goes to salary"). Override with UPI_PROOF_WA_MOBILES (comma
 * separated, 10 digits each). Every other number's photo goes on to the
 * staff bot exactly as before; the ERP's own screenshot upload is unchanged.
 */
export const UPI_PROOF_WA_DEFAULT_MOBILES = ["9919101755"];

export function upiProofWaMobiles(): string[] {
  const raw = (process.env.UPI_PROOF_WA_MOBILES || "").trim();
  const list = (raw ? raw.split(",") : UPI_PROOF_WA_DEFAULT_MOBILES)
    .map((m) => m.replace(/\D/g, "").slice(-10))
    .filter((m) => m.length === 10);
  return [...new Set(list)];
}

/** Is this WhatsApp sender one of the owner numbers allowed to record payments? */
export function isUpiProofWaSender(fromWaId: string): boolean {
  const m = String(fromWaId || "").replace(/\D/g, "").slice(-10);
  return m.length === 10 && upiProofWaMobiles().includes(m);
}
