import type { jsPDF } from "jspdf";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  drawPdfDocumentSignatures,
  drawPdfLetterhead,
  drawPdfPageBackground,
  resolvePdfLetterhead,
  resolveSchoolBrandAssets,
} from "@/lib/pdfLetterhead";
import {
  drawPdfWrappedText,
  ensureDevanagariFont,
  hasDevanagari,
  resolveAgreementConsentText,
  splitAgreementBodySections,
} from "@/lib/pdfDevanagari";
import type { StaffAgreement } from "@/lib/staffAgreement";

export type AgreementPdfPrintMode = "full" | "green_stationery";
export type AgreementPdfPageFormat = "a4" | "legal";

export type AgreementPdfOptions = {
  includePrincipalStamp?: boolean;
  printMode?: AgreementPdfPrintMode;
  pageFormat?: AgreementPdfPageFormat;
};

/** Top margin when printing on pre-printed green legal stationery (letterhead already on paper). */
export const GREEN_STATIONERY_TOP_MARGIN_PT = 140;

function imageFormatFromDataUrl(dataUrl: string): "PNG" | "JPEG" | "WEBP" {
  if (dataUrl.includes("image/jpeg") || dataUrl.includes("image/jpg")) {
    return "JPEG";
  }
  if (dataUrl.includes("image/webp")) return "WEBP";
  return "PNG";
}

function drawStaffSignature(
  doc: jsPDF,
  signatureUrl: string,
  margin: number,
  pageH: number,
  blockH: number,
  devanagariReady: boolean,
) {
  if (!signatureUrl) return;
  const imgW = 100;
  const imgH = 48;
  const y = pageH - margin - blockH;
  try {
    doc.addImage(
      signatureUrl,
      imageFormatFromDataUrl(signatureUrl),
      margin,
      y,
      imgW,
      imgH,
    );
  } catch {
    /* ignore bad image */
  }
  const label = devanagariReady
    ? "Employee signature / कर्मचारी हस्ताक्षर"
    : "Employee signature";
  drawPdfWrappedText(doc, label, margin, y + imgH + 10, 200, {
    fontSize: 8,
    lineHeight: 10,
    devanagariReady,
  });
}

function pageFormatToJsPdf(format: AgreementPdfPageFormat): "a4" | "legal" {
  return format === "legal" ? "legal" : "a4";
}

type PageCtx = {
  doc: jsPDF;
  margin: number;
  pageW: number;
  pageH: number;
  usable: number;
  sigBlock: number;
  topStart: number;
  greenMode: boolean;
  letterhead: Awaited<ReturnType<typeof resolvePdfLetterhead>>;
  brand: Awaited<ReturnType<typeof resolveSchoolBrandAssets>>;
  devanagariReady: boolean;
};

async function ensurePageSpace(
  ctx: PageCtx,
  y: number,
  needed: number,
): Promise<number> {
  if (y + needed <= ctx.pageH - ctx.margin - ctx.sigBlock) return y;
  ctx.doc.addPage();
  if (!ctx.greenMode) {
    await drawPdfPageBackground(
      ctx.doc,
      ctx.letterhead,
      ctx.brand,
      ctx.pageW,
      ctx.pageH,
    );
    return ctx.margin + 12;
  }
  return ctx.topStart;
}

/**
 * Generate agreement PDF with letterhead or green-stationery (text-only) mode.
 * Hindi / Devanagari text uses embedded Noto Sans Devanagari.
 */
export async function generateStaffAgreementPdf(
  agreement: StaffAgreement,
  masters?: MastersState,
  options?: AgreementPdfOptions,
): Promise<string> {
  const printMode = options?.printMode ?? "full";
  const pageFormat = options?.pageFormat ?? "a4";
  const greenMode = printMode === "green_stationery";

  const { jsPDF } = await import("jspdf");
  const m = masters ?? loadMasters();
  const letterhead = await resolvePdfLetterhead(m);
  const brand = await resolveSchoolBrandAssets(m);
  const doc = new jsPDF({ unit: "pt", format: pageFormatToJsPdf(pageFormat) });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - margin * 2;
  const sigBlock = 80;
  const topStart = greenMode ? GREEN_STATIONERY_TOP_MARGIN_PT : margin;

  const needsDevanagari =
    hasDevanagari(agreement.title) || hasDevanagari(agreement.body);
  const devanagariReady = needsDevanagari
    ? await ensureDevanagariFont(doc)
    : false;

  const ctx: PageCtx = {
    doc,
    margin,
    pageW,
    pageH,
    usable,
    sigBlock,
    topStart,
    greenMode,
    letterhead,
    brand,
    devanagariReady,
  };

  if (!greenMode) {
    await drawPdfPageBackground(doc, letterhead, brand, pageW, pageH);
  }

  let y = greenMode
    ? topStart
    : drawPdfLetterhead(doc, letterhead, margin, usable, pageW);

  doc.setTextColor(0, 0, 0);
  if (agreement.agreementNo) {
    y = await ensurePageSpace(ctx, y, 20);
    y = drawPdfWrappedText(
      doc,
      `Agreement No. ${agreement.agreementNo}`,
      margin,
      y,
      usable,
      {
        fontSize: 10,
        lineHeight: 12,
        align: "center",
        devanagariReady,
      },
    );
  }
  if (agreement.title) {
    y = await ensurePageSpace(ctx, y, 30);
    y = drawPdfWrappedText(doc, agreement.title, margin, y, usable, {
      fontSize: 13,
      lineHeight: 16,
      align: "center",
      style: "bold",
      devanagariReady,
    });
    y += 6;
  }

  const sections = splitAgreementBodySections(agreement.body);
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    if (i > 0 && sections.length > 1) {
      y = await ensurePageSpace(ctx, y, 24);
      y += 12;
    }
    const paras = section.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const para of paras) {
      const estLines = Math.ceil(para.length / 72) + 2;
      y = await ensurePageSpace(ctx, y, estLines * 14);
      y = drawPdfWrappedText(doc, para, margin, y, usable, {
        fontSize: 11,
        lineHeight: 14,
        devanagariReady,
      });
    }
  }

  if (agreement.consentAccepted) {
    const consentText = resolveAgreementConsentText(agreement.body);
    const consentLines = consentText.split(/\n/).length + 2;
    y = await ensurePageSpace(ctx, y, consentLines * 14);
    y = drawPdfWrappedText(doc, consentText, margin, y, usable, {
      fontSize: 10,
      lineHeight: 13,
      style: "italic",
      devanagariReady,
    });
    y += 8;
  }

  if (agreement.staffSignatureUrl) {
    drawStaffSignature(
      doc,
      agreement.staffSignatureUrl,
      margin,
      pageH,
      sigBlock,
      devanagariReady,
    );
  }

  if (options?.includePrincipalStamp) {
    await drawPdfDocumentSignatures(doc, brand, margin, pageW, pageH);
  }

  return doc.output("datauristring");
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  const mime = header?.match(/:(.*?);/)?.[1] ?? "application/pdf";
  const binary = atob(data ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function downloadStaffAgreementPdf(
  agreement: StaffAgreement,
  masters: MastersState,
  options?: AgreementPdfOptions,
  filename?: string,
): Promise<void> {
  const dataUrl = await generateStaffAgreementPdf(agreement, masters, {
    includePrincipalStamp:
      options?.includePrincipalStamp ??
      agreement.status === "counter_signed",
    printMode: options?.printMode ?? "full",
    pageFormat: options?.pageFormat ?? "a4",
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download =
    filename ??
    `agreement_${agreement.empCode}_${agreement.templateId}_${options?.pageFormat ?? "a4"}.pdf`;
  a.click();
}

/** Browser print — HTML for green stationery, PDF iframe for full letterhead. */
export async function printStaffAgreement(
  agreement: StaffAgreement,
  masters: MastersState,
  options?: AgreementPdfOptions,
): Promise<void> {
  const printMode = options?.printMode ?? "full";
  const pageFormat = options?.pageFormat ?? "a4";
  const includeStamp =
    options?.includePrincipalStamp ?? agreement.status === "counter_signed";

  if (printMode === "green_stationery") {
    printGreenStationeryHtml(agreement, pageFormat, includeStamp);
    return;
  }

  const dataUrl = await generateStaffAgreementPdf(agreement, masters, {
    includePrincipalStamp: includeStamp,
    printMode: "full",
    pageFormat,
  });
  const blob = dataUrlToBlob(dataUrl);
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(url);
      }, 60_000);
    }
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printGreenStationeryHtml(
  agreement: StaffAgreement,
  pageFormat: AgreementPdfPageFormat,
  includePrincipalStamp: boolean,
) {
  const pageSize = pageFormat === "legal" ? "legal" : "A4";
  const topMm = Math.round(GREEN_STATIONERY_TOP_MARGIN_PT * 0.352778);
  const sections = splitAgreementBodySections(agreement.body);
  const bodyHtml = sections
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const consentHtml = agreement.consentAccepted
    ? `<p class="consent"><em>${escapeHtml(resolveAgreementConsentText(agreement.body)).replace(/\n/g, "<br/>")}</em></p>`
    : "";
  const staffSig = agreement.staffSignatureUrl
    ? `<div class="sig"><img src="${agreement.staffSignatureUrl}" alt="Employee signature" /><span>Employee signature / कर्मचारी हस्ताक्षर</span></div>`
    : "";
  const principalNote = includePrincipalStamp
    ? `<div class="sig principal"><span>Principal / Authorised signatory (stamp on physical copy)</span></div>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(agreement.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700&family=Noto+Serif:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: ${pageSize}; margin: 12mm 15mm 18mm 15mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: ${topMm}mm 0 0 0;
      font-family: "Noto Serif", "Noto Sans Devanagari", "Times New Roman", serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #000;
      background: transparent;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1 {
      font-family: "Noto Sans Devanagari", "Noto Serif", serif;
      font-size: 14pt;
      text-align: center;
      margin: 0 0 14pt;
      font-weight: 700;
    }
    p {
      margin: 0 0 10pt;
      text-align: justify;
      font-family: "Noto Serif", "Noto Sans Devanagari", serif;
    }
    .consent { margin-top: 14pt; }
    .sigs { display: flex; gap: 24pt; margin-top: 28pt; flex-wrap: wrap; }
    .sig { display: flex; flex-direction: column; gap: 4pt; }
    .sig img { max-height: 48pt; max-width: 120pt; object-fit: contain; }
    .sig span { font-size: 9pt; }
    .principal { margin-left: auto; text-align: right; }
    @media screen {
      body { max-width: 210mm; margin: 16px auto; padding: 24px; background: #f5f5f0; }
      body::before {
        content: "Preview — load green legal paper in printer, then print (no background graphics)";
        display: block; font: 11px sans-serif; color: #666; margin-bottom: 12px;
      }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(agreement.title)}</h1>
  ${bodyHtml}
  ${consentHtml}
  <div class="sigs">${staffSig}${principalNote}</div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) {
    alert("Allow pop-ups to print on green stationery");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
