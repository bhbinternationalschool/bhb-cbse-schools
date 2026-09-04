/**
 * Pure naming for the Drive archive — where a thing goes and what it is
 * called. Kept out of the server module so the self-test can pin it: a
 * receipt that lands in the wrong year's folder is a filing error that
 * nobody notices until an auditor asks for March.
 */
export type ArchiveKind = "media" | "receipt";

/** https://drive.google.com/file/d/<id>/view — opens for anyone the school shares it with. */
export function driveViewUrl(driveFileId: string): string {
  return driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view` : "";
}

/** "Media / Website & gallery / 2026 / 09" — by bucket, then the month uploaded. */
export function mediaArchiveFolder(bucket: string, uploadedAt: Date): string[] {
  const area = bucket === "site-media" ? "Website & gallery" : "Private files";
  const y = String(uploadedAt.getFullYear());
  const m = String(uploadedAt.getMonth() + 1).padStart(2, "0");
  return ["Media", area, y, m];
}

/** The path's last segment, so "gallery/annual-day/photo-3.jpg" files as "photo-3.jpg". */
export function mediaArchiveFileName(path: string): string {
  const base = path.split("/").filter(Boolean).pop() || "upload.bin";
  return base.replace(/[^\w.\-() ]+/g, "_");
}

/** "Receipts / 2026-27 / 2026-09" — by academic year, then collection month. */
export function receiptArchiveFolder(academicYearCode: string, collectionDate: string): string[] {
  const ay = academicYearCode.trim() || "unknown-year";
  const month = /^\d{4}-\d{2}/.test(collectionDate) ? collectionDate.slice(0, 7) : "unknown-month";
  return ["Receipts", ay, month];
}

/** "R-2026-27-0123.pdf", with anything a filesystem dislikes replaced. */
export function receiptArchiveFileName(receiptNo: string, voided: boolean): string {
  const safe = (receiptNo.trim() || "receipt").replace(/[^\w.\-]+/g, "_");
  return `${safe}${voided ? "-VOID" : ""}.pdf`;
}
