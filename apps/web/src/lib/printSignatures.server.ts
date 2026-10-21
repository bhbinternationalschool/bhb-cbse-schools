import "server-only";

/**
 * The signatures a printed document carries (lib/printSignatures), read
 * from the private `school-files` bucket and embedded as data URLs, so
 * print, "Save as PDF" and jsPDF all have them without a second fetch and
 * nobody receives a link into the staff file store.
 */

import type { StaffRecord } from "@/lib/foundationMasters";
import type { PrintSignatureRequest, PrintSignatureSet } from "@/lib/printSignatures";
import { loadPrintSignaturesWith } from "@/lib/printSignaturesLoad";
import { getServerTenantContext } from "@/lib/serverTenant";

async function bucketDownload(path: string): Promise<Uint8Array | null> {
  const tenant = await getServerTenantContext();
  if (!tenant) return null;
  const { data, error } = await tenant.sb.storage.from("school-files").download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export function loadPrintSignatures(
  book: { staff?: StaffRecord[] | null; designations?: { id: string; code: string; name: string; isActive: boolean }[] | null },
  req: PrintSignatureRequest,
  opts: { memo?: Map<string, Promise<string | null>> } = {},
): Promise<PrintSignatureSet> {
  return loadPrintSignaturesWith(book, req, { download: bucketDownload, memo: opts.memo });
}
