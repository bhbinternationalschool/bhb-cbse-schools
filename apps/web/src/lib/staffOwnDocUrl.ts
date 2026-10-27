/**
 * Which file references a member of staff may put on their OWN record as a
 * document (POST /api/v1/staff/me/docs; data-layer 2.2d follow-up, security).
 *
 * The route takes the reference from the request body, and for the photo it
 * becomes the member's photoUrl — shown as an <img> and a link to the office
 * in Staff → Doc verify, and on every staff list. A body is anything anyone
 * can send, so the reference must be one of the school's own upload paths for
 * THIS member and THIS document, never an external URL (a tracking pixel, a
 * look-alike page, a file that is not theirs):
 *
 *   /api/documents/staff/<own id>/<this docKey>   what /api/documents/upload
 *                                                 returns (documentProxyUrl) —
 *                                                 the web "My docs" upload
 *   /api/file/staff/<own folder>/<file name>      the private-media path the
 *                                                 staff app's photo / signature
 *                                                 routes build (privateMediaUrl;
 *                                                 folder = emp code, else id)
 *
 * Anything else — another scheme or host, a protocol-relative //, a query or
 * fragment, a backslash, an encoded or literal "..", another member's id or
 * folder, another document's key — is refused. Pure; self-tested in
 * staffOwnDocUrl.selftest.ts.
 */
import { documentProxyUrl } from "@/lib/documentsRouting";

/** The folder the staff app's own-media routes store this member's files under. */
export function ownStaffMediaFolder(staffId: string, empCode: string | null | undefined): string {
  return (String(empCode || "").trim() || staffId).replace(/[^A-Za-z0-9_-]/g, "_");
}

const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

/**
 * null = this reference may be stored on the member's record as `docKey`;
 * otherwise the reason it may not (said to the caller as a 400).
 */
export function ownStaffDocUrlRefusal(
  url: string,
  who: { staffId: string; empCode?: string | null; docKey: string },
): string | null {
  const refused = "Only a file uploaded here for this document can be submitted — nothing was submitted";
  if (!url || !who.staffId || !who.docKey) return refused;
  // One plain same-site path: no scheme, no host, no query, no tricks.
  if (!url.startsWith("/") || url.startsWith("//")) return refused;
  if (/[\\?#\s]/.test(url) || /%2e|%2f|%5c/i.test(url) || url.includes("..")) return refused;

  if (url === documentProxyUrl("staff", who.staffId, who.docKey)) return null;

  const prefix = `/api/file/staff/${ownStaffMediaFolder(who.staffId, who.empCode)}/`;
  if (url.startsWith(prefix) && FILE_NAME.test(url.slice(prefix.length))) return null;

  return refused;
}
