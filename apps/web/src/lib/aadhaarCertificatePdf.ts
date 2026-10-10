/**
 * The UIDAI certificate as a PDF: the official blank form as the page, the
 * school's typed block letters in its boxes (aadhaarCertificate.ts decides
 * where). Node-only (reads the form image from public/docs); no server-only
 * import, so a script or self-test can render one.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";

import { A4, certificateLayout, type CertificateInput } from "@/lib/aadhaarCertificate";

let formImage: string | null = null;
function blankForm(): string {
  if (!formImage) {
    const bytes = readFileSync(path.join(process.cwd(), "public", "docs", "uidai-aadhaar-certificate-blank.jpg"));
    formImage = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  }
  return formImage;
}

export function renderAadhaarCertificatePdf(input: CertificateInput): {
  pdf: Buffer;
  overflow: { field: string; rest: string }[];
  blank: string[];
} {
  const layout = certificateLayout(input);
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  doc.addImage(blankForm(), "JPEG", 0, 0, A4.w, A4.h);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(10, 20, 80);
  for (const p of layout.text) {
    // y is the box's vertical centre; a capital's baseline sits ~4pt below it.
    doc.text(p.text, p.x, p.y + 4, { align: "center" });
  }
  doc.setDrawColor(10, 20, 80);
  doc.setLineWidth(1.6);
  for (const t of layout.ticks) {
    doc.line(t.x - 4, t.y, t.x - 1, t.y + 3.5);
    doc.line(t.x - 1, t.y + 3.5, t.x + 5, t.y - 4.5);
  }
  doc.setProperties({ title: "Certificate for Aadhaar Enrolment / Update", creator: "School ERP" });
  return { pdf: Buffer.from(doc.output("arraybuffer")), overflow: layout.overflow, blank: layout.blank };
}
