import "server-only";

/**
 * Load the signatures a printed document carries (lib/printSignatures) as
 * data URLs. The image is read from the private bucket on the server and
 * embedded, so print, "Save as PDF" and jsPDF all have it without a
 * second fetch, and nobody receives a link into the staff file store.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  NO_SIGNATURES,
  resolvePrintSignatories,
  signatureSource,
  type PrintSignature,
  type PrintSignatureRequest,
  type PrintSignatureSet,
} from "@/lib/printSignatures";
import { SIGNATURE_MAX_BYTES, SIGNATURE_MIME, sniffSignatureImage } from "@/lib/staffSignature";

type Download = (path: string) => Promise<Uint8Array | null>;

async function bucketDownload(path: string): Promise<Uint8Array | null> {
  const tenant = await getServerTenantContext();
  if (!tenant) return null;
  const { data, error } = await tenant.sb.storage.from("school-files").download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** One stored signature as a data URL; null when absent, unreadable or not a PNG/JPEG/WebP. */
export async function signatureDataUrl(url: string, download: Download = bucketDownload): Promise<string | null> {
  const src = signatureSource(url);
  if (!src) return null;
  if (src.kind === "data") {
    const b64 = src.dataUrl.slice(src.dataUrl.indexOf(",") + 1).replace(/\s+/g, "");
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    const kind = sniffSignatureImage(bytes);
    if (!kind || bytes.length > SIGNATURE_MAX_BYTES) return null;
    return `data:${SIGNATURE_MIME[kind]};base64,${b64}`;
  }
  try {
    const bytes = await download(src.path);
    if (!bytes || bytes.length === 0 || bytes.length > SIGNATURE_MAX_BYTES) return null;
    const kind = sniffSignatureImage(bytes);
    if (!kind) return null;
    return `data:${SIGNATURE_MIME[kind]};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * The signatures for one document. A person with no signature, or one that
 * cannot be read, is a blank line (null) — the document still prints.
 * `memo` lets a caller printing many documents read each image once.
 */
export async function loadPrintSignatures(
  book: { staff?: StaffRecord[] | null; designations?: { id: string; code: string; name: string; isActive: boolean }[] | null },
  req: PrintSignatureRequest,
  opts: { download?: Download; memo?: Map<string, Promise<string | null>> } = {},
): Promise<PrintSignatureSet> {
  const who = resolvePrintSignatories(book, req);
  const memo = opts.memo ?? new Map<string, Promise<string | null>>();
  const one = async (s: StaffRecord | null): Promise<PrintSignature | null> => {
    if (!s || !s.signatureUrl) return null;
    let p = memo.get(s.signatureUrl);
    if (!p) {
      p = signatureDataUrl(s.signatureUrl, opts.download);
      memo.set(s.signatureUrl, p);
    }
    const src = await p;
    return src ? { staffId: s.id, name: s.fullName, src } : null;
  };
  if (!who.principal && !who.classTeacher && !who.checkedBy) return NO_SIGNATURES;
  const [principal, classTeacher, checkedBy] = await Promise.all([one(who.principal), one(who.classTeacher), one(who.checkedBy)]);
  return { principal, classTeacher, checkedBy };
}
