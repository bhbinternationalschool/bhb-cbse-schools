/**
 * Aadhaar number checks. The twelfth digit is a Verhoeff checksum, so a
 * number read off a photo by a model can be rejected before it is written
 * anywhere: a mis-read digit fails the checksum nine times in ten.
 */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True only for a 12-digit string whose Verhoeff checksum holds. */
export function aadhaarChecksumValid(raw: string): boolean {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 12) return false;
  // Aadhaar never starts with 0 or 1.
  if (digits[0] === "0" || digits[0] === "1") return false;
  let c = 0;
  const rev = digits.split("").reverse().map(Number);
  for (let i = 0; i < rev.length; i += 1) c = D[c]![P[i % 8]![rev[i]!]!]!;
  return c === 0;
}

/** 12 digits from "1234 5678 9012" or "1234-5678-9012"; "" when not exactly twelve. */
export function aadhaarDigits(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length === 12 ? d : "";
}

export function maskAadhaar(digits: string): string {
  const d = String(digits || "").replace(/\D/g, "");
  return d.length >= 4 ? `XXXX XXXX ${d.slice(-4)}` : "—";
}
