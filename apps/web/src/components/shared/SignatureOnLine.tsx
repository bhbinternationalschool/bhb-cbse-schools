/**
 * A staff signature sitting on a printed sheet's signing line
 * (lib/printSignatures). Nothing when the line has no signature — the
 * line stays blank, never someone else's.
 */

/* eslint-disable @next/next/no-img-element -- an embedded data: URL on paper; next/image adds nothing to print */

import type { PrintSignature } from "@/lib/printSignatures";

export function SignatureOnLine({
  sig,
  align = "center",
  heightClass = "h-10",
}: {
  sig: PrintSignature | null | undefined;
  align?: "left" | "center" | "right";
  heightClass?: string;
}) {
  if (!sig) return null;
  const justify = align === "left" ? "justify-start" : align === "right" ? "justify-end" : "justify-center";
  return (
    <span
      className={`pointer-events-none flex ${justify} items-end ${heightClass}`}
      data-testid="print-signature"
      data-signature-of={sig.staffId}
    >
      <img src={sig.src} alt={`Signature of ${sig.name}`} className="max-h-full max-w-[11rem] object-contain" />
    </span>
  );
}
