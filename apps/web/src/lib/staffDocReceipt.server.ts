/**
 * The Drive receipt of a staff document upload (2.2d follow-up, security).
 *
 * /api/documents/upload stores the file in Drive and hands back its id; the
 * member then submits it on their own record (POST /api/v1/staff/me/docs).
 * Nothing on the server records that id in between, so the upload route also
 * hands back a receipt: an HMAC of (staff id, document key, Drive id) under
 * the server's session secret. me/docs keeps a driveFileId only with a valid
 * receipt for THIS member and THIS document — another member's Drive id (or
 * any id not uploaded here for this document) is refused. The receipt itself
 * is never stored.
 */
import { signServerValue, verifyServerValue } from "@/lib/sessionCookie.server";

const PURPOSE = "staff-doc-drive-receipt";
const value = (staffId: string, docKey: string, driveFileId: string) => `${staffId}|${docKey}|${driveFileId}`;

export function staffDocDriveReceipt(staffId: string, docKey: string, driveFileId: string): string | null {
  if (!staffId || !docKey || !driveFileId) return null;
  return signServerValue(PURPOSE, value(staffId, docKey, driveFileId));
}

export function staffDocDriveReceiptValid(staffId: string, docKey: string, driveFileId: string, receipt: unknown): boolean {
  if (!staffId || !docKey || !driveFileId) return false;
  return verifyServerValue(PURPOSE, value(staffId, docKey, driveFileId), receipt);
}
