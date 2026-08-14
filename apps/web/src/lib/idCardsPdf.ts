/**
 * Batch student/staff ID card printing — CR80-ish cards laid out on A4
 * sheets, photo + QR + identity fields. See lib/admitCardPdf.ts for the
 * separate (full-page, per-student) exam admit card generator — different
 * jsPDF unit and page model, kept in its own file on purpose.
 */

import { imageFormatFromDataUrl } from "@/lib/pdfLetterhead";
import { qrDataUrlFor } from "@/lib/pdfQr";
import { classSectionLabel } from "@/lib/timetable";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";
import type { StaffRecord } from "@/lib/foundationMasters";
import { TENANT } from "@/lib/types";

export type IdCardKind = "student" | "staff";

export type IdCardDoc = {
  kind: IdCardKind;
  refId: string;
  name: string;
  /** "Class 6-A · Roll 12" | designation label */
  line2: string;
  /** admission no | emp code */
  line3: string;
  /** blood group | department */
  line4?: string;
  /** "Valid: AY 2025-26" */
  validityLine: string;
  photoUrl: string | null;
  qrPayload: string;
};

/** Mirrors staffQrPayload's JSON shape ({type,...,id}) so a future scanner
 * app can switch on `type` instead of special-casing two QR formats. */
export function studentQrPayload(admissionNo: string, id: string): string {
  return JSON.stringify({
    type: "bhb_student",
    admissionNo: admissionNo.trim().toUpperCase(),
    id,
  });
}

export function buildStudentIdCardDoc(
  student: SisStudent,
  masters: MastersState,
): IdCardDoc {
  const ay = student.academicYearCode || currentAcademicYearCode(masters);
  return {
    kind: "student",
    refId: student.id,
    name: student.fullName,
    line2: `${classSectionLabel(masters, student.classId, student.sectionId)} · Roll ${student.rollNo || "—"}`,
    line3: `Adm: ${student.admissionNo || "—"}`,
    line4: student.bloodGroup ? `Blood: ${student.bloodGroup}` : undefined,
    validityLine: `Valid: AY ${ay}`,
    photoUrl: student.photoUrl || null,
    qrPayload: studentQrPayload(student.admissionNo, student.id),
  };
}

export function buildStaffIdCardDoc(
  staff: StaffRecord,
  masters: MastersState,
): IdCardDoc {
  const designation =
    (masters.designations ?? []).find((d) => d.id === staff.designationId)
      ?.name || "";
  const department =
    (masters.departments ?? []).find((d) => d.id === staff.departmentId)
      ?.name || "";
  return {
    kind: "staff",
    refId: staff.id,
    name: staff.fullName,
    line2: designation || "Staff",
    line3: `Emp: ${staff.empCode || "—"}`,
    line4: department || undefined,
    validityLine: `Valid: AY ${currentAcademicYearCode(masters)}`,
    photoUrl: staff.photoUrl || null,
    qrPayload: staff.qrPayload || studentQrPayload(staff.empCode, staff.id),
  };
}

const MAX_CARDS_PER_RUN = 300;
const CARD_W = 90;
const CARD_H = 44;
const MARGIN_X = 12;
const MARGIN_Y = 12;
const GAP_X = 6;
const GAP_Y = 6;
const COLS = 2;
const CARDS_PER_PAGE = 10;
const QR_CHUNK_SIZE = 50;

function drawPlaceholderPhoto(
  doc: import("jspdf").jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  doc.setDrawColor(32, 48, 80);
  doc.setFillColor(240, 240, 232);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(140, 140, 130);
  doc.text(TENANT.shortName.slice(0, 3).toUpperCase(), x + w / 2, y + h / 2, {
    align: "center",
  });
}

function drawIdCardCell(
  doc: import("jspdf").jsPDF,
  x: number,
  y: number,
  card: IdCardDoc & { photoDataUrl: string | null; qrDataUrl: string | null },
) {
  doc.setDrawColor(32, 48, 80);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, CARD_W, CARD_H, 2, 2);

  const photoX = x + 3;
  const photoY = y + 3;
  const photoW = 22;
  const photoH = 26;
  if (card.photoDataUrl) {
    try {
      doc.addImage(
        card.photoDataUrl,
        imageFormatFromDataUrl(card.photoDataUrl),
        photoX,
        photoY,
        photoW,
        photoH,
      );
    } catch {
      drawPlaceholderPhoto(doc, photoX, photoY, photoW, photoH);
    }
  } else {
    drawPlaceholderPhoto(doc, photoX, photoY, photoW, photoH);
  }

  const textX = x + 27;
  doc.setTextColor(32, 48, 80);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(card.name, textX, y + 6, { maxWidth: 37 });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);
  doc.text(card.line2, textX, y + 11.5, { maxWidth: 37 });

  doc.setFontSize(6.5);
  doc.text(card.line3, textX, y + 16.5, { maxWidth: 37 });
  if (card.line4) {
    doc.text(card.line4, textX, y + 21.5, { maxWidth: 37 });
  }
  doc.setFontSize(6);
  doc.setTextColor(100, 100, 100);
  doc.text(card.validityLine, textX, y + 26.5, { maxWidth: 37 });

  const qrSize = 21;
  const qrX = x + CARD_W - qrSize - 3;
  const qrY = y + CARD_H - qrSize - 3;
  if (card.qrDataUrl) {
    try {
      doc.addImage(card.qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);
    } catch {
      /* skip QR on failure — card still readable by eye */
    }
  }
}

async function withQrDataUrls(
  docs: IdCardDoc[],
): Promise<(IdCardDoc & { qrDataUrl: string | null })[]> {
  const out: (IdCardDoc & { qrDataUrl: string | null })[] = [];
  for (let i = 0; i < docs.length; i += QR_CHUNK_SIZE) {
    const chunk = docs.slice(i, i + QR_CHUNK_SIZE);
    const withQr = await Promise.all(
      chunk.map(async (d) => ({
        ...d,
        qrDataUrl: await qrDataUrlFor(d.qrPayload).catch(() => null),
      })),
    );
    out.push(...withQr);
    // Yield to the main thread between chunks so the UI doesn't freeze.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return out;
}

export async function downloadIdCardsPdf(
  docs: IdCardDoc[],
  options?: { fileBaseName?: string },
): Promise<void> {
  if (!docs.length) throw new Error("No cards selected");
  if (docs.length > MAX_CARDS_PER_RUN) {
    throw new Error(
      `Select ${MAX_CARDS_PER_RUN} or fewer at a time — print the rest in a separate batch.`,
    );
  }

  const withQr = await withQrDataUrls(docs);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  withQr.forEach((card, i) => {
    const posOnPage = i % CARDS_PER_PAGE;
    if (i > 0 && posOnPage === 0) doc.addPage();
    const col = posOnPage % COLS;
    const row = Math.floor(posOnPage / COLS);
    const x = MARGIN_X + col * (CARD_W + GAP_X);
    const y = MARGIN_Y + row * (CARD_H + GAP_Y);
    drawIdCardCell(doc, x, y, { ...card, photoDataUrl: card.photoUrl });
  });

  const base = options?.fileBaseName || "id_cards";
  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`${base}_${stamp}.pdf`);
}
