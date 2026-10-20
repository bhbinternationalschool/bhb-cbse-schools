/**
 * A member of staff's own signature (director, 15 Oct 2026): teachers and
 * the principal put their signature on their profile from the staff app.
 *
 * It is the same field the web staff form edits — StaffRecord.signatureUrl,
 * a private file in the `school-files` bucket served through /api/file — so
 * the office sees it on Staff → profile and anything that prints a staff
 * signature reads one place.
 *
 * The rules, decided here so the route and its self-test agree:
 *   - a staff login only, and only for ITSELF: the staff id is the session's;
 *     a request naming anyone else is refused (403), never quietly redirected;
 *   - PNG (preferred — the app sends a trimmed, transparent PNG), JPEG or
 *     WebP, recognised by the file's own bytes, not by the name or the
 *     declared type;
 *   - at most 1 MB (a trimmed signature is 10–80 KB).
 *
 * Pure: no I/O (staffSignature.selftest.ts).
 */

export const SIGNATURE_MAX_BYTES = 1024 * 1024;

export type SignatureKind = "png" | "jpg" | "webp";

export const SIGNATURE_MIME: Record<SignatureKind, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/** What the bytes are, from their header; null for anything else. */
export function sniffSignatureImage(bytes: Uint8Array): SignatureKind | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export type SignatureRefusal = { status: 400 | 403; message: string };

/**
 * Who may set this signature. `claimedStaffId` is whatever the request said
 * (form field or query) — absent is fine; anyone but the caller is not.
 */
export function signatureActorRefusal(input: {
  persona: string;
  sessionStaffId: string;
  claimedStaffId?: string | null;
}): SignatureRefusal | null {
  if (input.persona !== "staff" || !input.sessionStaffId) {
    return { status: 403, message: "Staff login required" };
  }
  const claimed = (input.claimedStaffId || "").trim();
  if (claimed && claimed !== input.sessionStaffId) {
    return { status: 403, message: "You can only set your own signature" };
  }
  return null;
}

/** The file itself: present, small enough, and really an image we take. */
export function signatureFileRefusal(input: { size: number; bytes: Uint8Array | null }): SignatureRefusal | null {
  if (!input.bytes || input.size <= 0) return { status: 400, message: "Choose a picture of your signature" };
  if (input.size > SIGNATURE_MAX_BYTES) {
    return { status: 400, message: "The signature picture is larger than 1 MB — crop it closer and try again" };
  }
  if (!sniffSignatureImage(input.bytes)) {
    return { status: 400, message: "The signature must be a PNG, JPG or WebP picture" };
  }
  return null;
}
