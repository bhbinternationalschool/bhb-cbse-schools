/**
 * Fee receipt delivery helpers — PDF capture + shareable payload for WhatsApp.
 */

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  amountInWordsPaise,
  formatConcessionDetailLine,
  formatInr,
  tenderModeLabel,
  type CollectionVoucher,
} from "@/lib/fees";
import type { MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import { TENANT } from "@/lib/types";

export type ReceiptShareStudent = {
  studentId: string;
  admissionNo: string;
  fullName: string;
  fatherName: string;
  classSection: string;
};

export type ReceiptSharePayload = {
  v: 1;
  voucher: CollectionVoucher;
  householdHint: string;
  students: ReceiptShareStudent[];
};

function buildStudents(
  voucher: CollectionVoucher,
  sis?: SisState | null,
  masters?: MastersState | null,
): ReceiptShareStudent[] {
  const seen = new Set<string>();
  const rows: ReceiptShareStudent[] = [];
  for (const line of voucher.lines) {
    if (seen.has(line.studentId)) continue;
    seen.add(line.studentId);
    const student = sis?.students.find((s) => s.id === line.studentId);
    const className =
      masters?.classes.find((c) => c.id === student?.classId)?.name ?? "—";
    const sectionName =
      masters?.sections.find((s) => s.id === student?.sectionId)?.name ?? "";
    rows.push({
      studentId: line.studentId,
      admissionNo: student?.admissionNo || "—",
      fullName: student?.fullName || line.studentName,
      fatherName: student?.fatherName || "—",
      classSection: sectionName ? `${className}-${sectionName}` : className,
    });
  }
  return rows;
}

export function buildReceiptSharePayload(
  voucher: CollectionVoucher,
  sis?: SisState | null,
  masters?: MastersState | null,
  householdHint?: string,
): ReceiptSharePayload {
  return {
    v: 1,
    voucher,
    householdHint: householdHint ?? "",
    students: buildStudents(voucher, sis, masters),
  };
}

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(raw: string): string {
  const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeReceiptSharePayload(payload: ReceiptSharePayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeReceiptSharePayload(
  encoded: string,
): ReceiptSharePayload | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as ReceiptSharePayload;
    if (parsed?.v !== 1 || !parsed.voucher?.receiptNo) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Public digital receipt URL (payload in hash — works on parent phone). */
export function buildReceiptShareUrl(payload: ReceiptSharePayload): string {
  if (typeof window === "undefined") return "";
  const encoded = encodeReceiptSharePayload(payload);
  return `${window.location.origin}/receipt/share#${encoded}`;
}

export async function captureReceiptPdfFile(
  element: HTMLElement,
  receiptNo: string,
): Promise<File> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false,
  });
  const imgData = canvas.toDataURL("image/jpeg", 0.92);
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const imgWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let y = margin;
  pdf.addImage(imgData, "JPEG", margin, y, imgWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    y = margin - (imgHeight - heightLeft);
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", margin, y, imgWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }

  const blob = pdf.output("blob");
  const safe = receiptNo.replace(/[^\w.-]+/g, "_");
  return new File([blob], `${safe}-fee-receipt.pdf`, {
    type: "application/pdf",
  });
}

export function downloadReceiptFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function canShareReceiptFile(file: File): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }
  try {
    if (typeof navigator.canShare === "function") {
      return navigator.canShare({ files: [file] });
    }
  } catch {
    return false;
  }
  return false;
}

export async function shareReceiptToWhatsApp(input: {
  file: File;
  text: string;
  title?: string;
}): Promise<boolean> {
  try {
    if (!(await canShareReceiptFile(input.file))) return false;
    await navigator.share({
      files: [input.file],
      text: input.text,
      title: input.title ?? "Fee receipt",
    });
    return true;
  } catch (err) {
    // User cancelled share sheet
    if (err instanceof DOMException && err.name === "AbortError") {
      return false;
    }
    return false;
  }
}

export function composeWhatsAppFeeReceiptMessage(
  voucher: CollectionVoucher,
  options?: {
    students?: ReceiptShareStudent[];
    householdHint?: string;
    receiptUrl?: string;
    pdfFileName?: string;
  },
): string {
  const students = options?.students ?? [];
  const lines: string[] = [
    `*${TENANT.shortName}*`,
    "*Fee receipt*",
    "",
    `Receipt no: ${voucher.receiptNo}`,
  ];
  if (voucher.schoolReceiptNo) {
    lines.push(`School book: ${voucher.schoolReceiptNo}`);
  }
  lines.push(`Date: ${voucher.collectionDate}`);
  lines.push(`Academic year: ${voucher.academicYearCode}`);
  if (options?.householdHint) {
    lines.push(`Guardian: ${options.householdHint}`);
  }
  lines.push(`Received by: ${voucher.cashierName}`);
  lines.push("");

  if (students.length > 0) {
    lines.push("*Student particulars*");
    students.forEach((st, i) => {
      lines.push(
        `${i + 1}. ${st.fullName} · ${st.admissionNo} · ${st.classSection}`,
      );
      if (st.fatherName && st.fatherName !== "—") {
        lines.push(`   Father: ${st.fatherName}`);
      }
    });
    lines.push("");
  }

  lines.push("*Fee break-up*");
  for (const line of voucher.lines) {
    lines.push(
      `• ${line.studentName}: ${line.label} — ${formatInr(line.amountPaise)}`,
    );
    if (line.billedPaise && line.concessionPaise) {
      lines.push(
        `   Billed ${formatInr(line.billedPaise)} − discount ${formatInr(line.concessionPaise)}`,
      );
    }
    if (line.concessionDetails?.length) {
      for (const c of line.concessionDetails) {
        lines.push(`   – Discount · ${formatConcessionDetailLine(c)}`);
      }
    }
    if (line.kind === "store" && line.storeItems?.length) {
      for (const it of line.storeItems) {
        lines.push(
          `   – ${it.sku} · ${it.name}${
            it.sizeLabel ? ` (${it.sizeLabel})` : ""
          } ×${it.qty} @ ${formatInr(it.unitPricePaise)} = ${formatInr(it.linePaise)}`,
        );
      }
    }
    if (line.kind === "transport" && line.transport) {
      const t = line.transport;
      lines.push(
        `   – ${t.routeCode} · ${t.routeName} · ${t.busNo} · Stop ${t.stopName}`,
      );
    }
  }
  lines.push("");
  const discountTotal = voucher.lines.reduce(
    (s, l) => s + (l.concessionPaise ?? 0),
    0,
  );
  if (discountTotal > 0) {
    lines.push(`Discount applied: −${formatInr(discountTotal)}`);
  }
  lines.push(`*Total paid: ${formatInr(voucher.totalPaise)}*`);
  lines.push(`In words: ${amountInWordsPaise(voucher.totalPaise)}`);
  lines.push(
    `Modes: ${voucher.tenders
      .map(
        (t) =>
          `${tenderModeLabel(t.mode)} ${formatInr(t.amountPaise)}${
            t.ref ? ` (${t.ref})` : ""
          }`,
      )
      .join(" + ")}`,
  );

  if (options?.receiptUrl) {
    lines.push("");
    lines.push("*Open full digital receipt:*");
    lines.push(options.receiptUrl);
  }
  if (options?.pdfFileName) {
    lines.push("");
    lines.push(
      `PDF receipt: ${options.pdfFileName} (attached or downloaded — please keep with this chat)`,
    );
  }

  lines.push("");
  lines.push(`Thank you — ${TENANT.city}`);
  return lines.join("\n");
}
