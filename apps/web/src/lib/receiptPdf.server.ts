/**
 * A fee receipt as a PDF, drawn on the server.
 *
 * The office prints receipts from FeeReceiptSheet in the browser; nothing
 * on the server has ever produced one, which is why online payments — the
 * ones the gateway settles at 2 a.m. with nobody at the counter — had no
 * printed form at all. This renders every voucher the same way from its
 * stored lines and tenders, so the Drive archive holds one PDF per receipt
 * regardless of how the money arrived.
 *
 * Content matches the printed sheet (school header, receipt no, date,
 * guardian, each child's particulars, total, amount in words, how it was
 * paid, who received it); the layout is a plain table, not the sheet's
 * pixels. Helvetica has no rupee sign, hence "Rs".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import { TENANT } from "@/lib/types";
import {
  amountInWordsPaise,
  receiptSeriesOf,
  tenderModeLabel,
  type CollectionVoucher,
} from "@/lib/fees";
import { qrDataUrlFor } from "@/lib/pdfQr";

/**
 * What the header says about the school. Resolved once per sweep by the
 * caller (it needs the masters and a Meta lookup); the renderer stays pure
 * so the self-test can run it with fixed values.
 */
export type ReceiptSchoolHeader = {
  /** PNG bytes of the crest, or null to print without a logo. */
  logoPng: Buffer | null;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  /** "Affiliation … · School code … · UDISE …" — blank parts are omitted. */
  statutoryLine: string;
};

/** The office mailbox parents should write to — not the director's. */
export const RECEIPT_CONTACT_EMAIL = "office@bhbinternational.school";

/** The crest as shipped with the web app, read from disk once. */
let crestCache: Buffer | null | undefined;
export function schoolCrestPng(): Buffer | null {
  if (crestCache !== undefined) return crestCache;
  try {
    crestCache = readFileSync(path.join(process.cwd(), "public", "logo-crest.png"));
  } catch {
    crestCache = null;
  }
  return crestCache;
}

export type ReceiptPdfContext = {
  guardianName: string;
  householdCode: string;
  /** studentId → "Name · Class-Section" */
  studentLabel: (studentId: string, fallbackName: string) => string;
  school: ReceiptSchoolHeader;
};

/**
 * What the QR on the receipt says. Deliberately plain text, not a link into
 * the ERP: the archive copy must stay verifiable by anyone with a phone
 * camera even if the portal moves, and short enough to scan at 26 mm.
 */
export function receiptQrText(voucher: CollectionVoucher, ctx: Pick<ReceiptPdfContext, "householdCode" | "school">): string {
  return [
    TENANT.nameDisplay || TENANT.name,
    `Receipt ${voucher.receiptNo}${voucher.voidedAt ? " (VOID)" : ""}`,
    `Date ${voucher.collectionDate}`,
    `Amount ${rupees(voucher.totalPaise)}`,
    ctx.householdCode ? `Family ${ctx.householdCode}` : "",
    `Verify: ${ctx.school.whatsapp || ctx.school.phone} / ${ctx.school.email}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(paise) / 100);
  const s = whole.toString();
  if (s.length <= 3) return `${sign}Rs ${s}`;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${sign}Rs ${parts.join(",")},${last3}`;
}

function displayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

export async function renderReceiptPdf(voucher: CollectionVoucher, ctx: ReceiptPdfContext): Promise<Buffer> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const left = 16;
  const right = W - 16;
  let y = 16;

  // ---- header: crest left, school identity centre, QR right -----------------
  const logoSize = 22;
  if (ctx.school.logoPng) {
    try {
      doc.addImage(ctx.school.logoPng.toString("base64"), "PNG", left, y, logoSize, logoSize, undefined, "MEDIUM");
    } catch {
      /* a crest that will not decode is not worth failing a receipt for */
    }
  }
  const qrSize = 26;
  const qr = await qrDataUrlFor(receiptQrText(voucher, ctx));
  doc.addImage(qr, "PNG", right - qrSize, y, qrSize, qrSize, undefined, "MEDIUM");
  doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(120, 120, 120);
  doc.text("Scan to verify", right - qrSize / 2, y + qrSize + 3, { align: "center" });

  const cx = W / 2;
  const textMax = W - 2 * (logoSize + 24);
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(0, 0, 0);
  doc.text(TENANT.nameDisplay || TENANT.name, cx, y + 6, { align: "center", maxWidth: textMax });
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(60, 60, 60);
  let hy = y + 11.5;
  if (TENANT.schoolAddress) {
    doc.text(TENANT.schoolAddress, cx, hy, { align: "center", maxWidth: textMax });
    hy += 4 * doc.splitTextToSize(TENANT.schoolAddress, textMax).length;
  }
  if (ctx.school.statutoryLine) {
    doc.text(ctx.school.statutoryLine, cx, hy, { align: "center", maxWidth: textMax });
    hy += 4;
  }
  const contactBits = [
    ctx.school.phone ? `Ph ${ctx.school.phone}` : "",
    ctx.school.whatsapp ? `WhatsApp ${ctx.school.whatsapp}` : "",
  ].filter(Boolean);
  if (contactBits.length) {
    doc.text(contactBits.join("  ·  "), cx, hy, { align: "center", maxWidth: textMax });
    hy += 4;
  }
  const onlineBits = [ctx.school.email, ctx.school.website].filter(Boolean);
  if (onlineBits.length) {
    doc.text(onlineBits.join("  ·  "), cx, hy, { align: "center", maxWidth: textMax });
    hy += 4;
  }
  y = Math.max(hy, y + qrSize + 6) + 2;
  doc.setDrawColor(32, 48, 80).setLineWidth(0.6).line(left, y, right, y);
  y += 8;

  const isRegistration = receiptSeriesOf(voucher.receiptNo) === "R";
  doc.setFont("helvetica", "bold").setFontSize(13);
  doc.text(isRegistration ? "REGISTRATION RECEIPT" : "FEE RECEIPT", left, y);
  if (voucher.voidedAt) {
    doc.setTextColor(180, 35, 24);
    doc.text("VOID", right, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }
  y += 8;

  // ---- particulars of the receipt --------------------------------------------
  doc.setFontSize(10);
  const kv = (label: string, value: string, col: 0 | 1) => {
    const x = col === 0 ? left : W / 2 + 4;
    doc.setFont("helvetica", "normal").setTextColor(92, 100, 120);
    doc.text(label, x, y);
    doc.setFont("helvetica", "bold").setTextColor(0, 0, 0);
    doc.text(value || "—", x + 34, y, { maxWidth: W / 2 - 44 });
  };
  kv("Receipt no.", voucher.receiptNo, 0);
  kv("Date", displayDate(voucher.collectionDate), 1);
  y += 6;
  if (voucher.schoolReceiptNo) {
    kv("School receipt no.", voucher.schoolReceiptNo, 0);
    y += 6;
  }
  kv("Guardian", ctx.guardianName, 0);
  kv("Family code", ctx.householdCode, 1);
  y += 6;
  kv("Academic year", voucher.academicYearCode, 0);
  kv("Received by", voucher.cashierName, 1);
  y += 10;

  // ---- lines -----------------------------------------------------------------
  const colAmt = right;
  const colStudent = left;
  const colPart = left + 62;
  doc.setDrawColor(200, 200, 200).setLineWidth(0.3);
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(92, 100, 120);
  doc.text("Student", colStudent, y);
  doc.text("Fee particulars", colPart, y);
  doc.text("Amount", colAmt, y, { align: "right" });
  y += 2;
  doc.line(left, y, right, y);
  y += 5;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(0, 0, 0);

  const bottomLimit = doc.internal.pageSize.getHeight() - 60;
  let lastStudent = "";
  for (const line of voucher.lines) {
    if (y > bottomLimit) {
      doc.addPage();
      y = 20;
    }
    const student = ctx.studentLabel(line.studentId, line.studentName);
    if (student !== lastStudent) {
      doc.text(student, colStudent, y, { maxWidth: 58 });
      lastStudent = student;
    }
    const particulars = line.concessionPaise
      ? `${line.label}  (after concession ${rupees(line.concessionPaise)})`
      : line.label;
    doc.text(particulars, colPart, y, { maxWidth: right - colPart - 30 });
    doc.text(rupees(line.amountPaise), colAmt, y, { align: "right" });
    const lineCount = Math.max(
      doc.splitTextToSize(particulars, right - colPart - 30).length,
      doc.splitTextToSize(student, 58).length,
    );
    y += 5 * lineCount + 1;
  }
  y += 1;
  doc.setDrawColor(32, 48, 80).setLineWidth(0.5).line(left, y, right, y);
  y += 6;
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text("Total received", colPart, y);
  doc.text(rupees(voucher.totalPaise), colAmt, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "italic").setFontSize(9).setTextColor(92, 100, 120);
  doc.text(`Rupees ${amountInWordsPaise(voucher.totalPaise)} only`, colPart, y, {
    maxWidth: right - colPart,
  });
  y += 10;

  // ---- how it was paid ----------------------------------------------------------
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(92, 100, 120);
  doc.text("Paid by", left, y);
  y += 5;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(0, 0, 0);
  for (const t of voucher.tenders) {
    const bits = [tenderModeLabel(t.mode)];
    if (t.gatewayProvider) bits.push(`via ${t.gatewayProvider}`);
    if (t.ref) bits.push(`ref ${t.ref}`);
    if (t.bankName) bits.push(t.bankName);
    if (t.instrumentDate) bits.push(`dated ${displayDate(t.instrumentDate)}`);
    if (t.mode === "cheque" && t.realisation !== "cleared") bits.push("subject to realisation");
    doc.text(`${bits.join("  ·  ")}`, left, y, { maxWidth: right - left - 34 });
    doc.text(rupees(t.amountPaise), colAmt, y, { align: "right" });
    y += 6;
  }
  if (voucher.note) {
    y += 2;
    doc.setFont("helvetica", "italic").setFontSize(9).setTextColor(92, 100, 120);
    doc.text(`Note: ${voucher.note}`, left, y, { maxWidth: right - left });
    y += 6;
  }

  // ---- footer ---------------------------------------------------------------------
  const H = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120, 120, 120);
  doc.text(
    `Archive copy generated by the school ERP on ${displayDate(new Date().toISOString())}. ` +
      `Receipt ${voucher.receiptNo}${voucher.voidedAt ? ` — VOIDED ${displayDate(voucher.voidedAt)}` : ""}. ` +
      `Queries: ${ctx.school.email}${ctx.school.whatsapp ? ` · WhatsApp ${ctx.school.whatsapp}` : ""}.`,
    left,
    H - 12,
    { maxWidth: right - left },
  );
  return Buffer.from(doc.output("arraybuffer"));
}
