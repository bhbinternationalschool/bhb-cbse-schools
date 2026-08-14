/**
 * Batch student/staff ID card printing — CR80 cards (86×54mm landscape,
 * 54×86mm portrait, same size as a debit card) laid out on A4 sheets,
 * template-driven (lib/idCardTemplate.ts decides which fields print on
 * which side). See lib/admitCardPdf.ts for the separate (full-page,
 * per-student) exam admit card generator — different jsPDF unit and page
 * model, kept in its own file on purpose.
 */

import type { jsPDF } from "jspdf";
import { imageFormatFromDataUrl } from "@/lib/pdfLetterhead";
import { qrDataUrlFor } from "@/lib/pdfQr";
import { classSectionLabel } from "@/lib/timetable";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import { householdOf, type SisState, type SisStudent } from "@/lib/sis";
import type { StaffRecord } from "@/lib/foundationMasters";
import { TENANT } from "@/lib/types";
import {
  ID_CARD_SECONDARY_PHOTO_IDS,
  ID_CARD_TEXT_FIELD_PRIORITY,
  type IdCardFieldId,
  type IdCardKind,
  type IdCardOrientation,
  type IdCardPhotoFieldId,
  type IdCardTemplate,
  type IdCardTextFieldId,
} from "@/lib/idCardTemplate";

export type { IdCardKind };

/** Superset carrier — every value/photo this ref could possibly show on a
 * card. The template's frontFields/backFields decide what's actually
 * rendered; building a doc no longer needs to know the template. */
export type IdCardDoc = {
  kind: IdCardKind;
  refId: string;
  values: Partial<Record<IdCardTextFieldId, string>>;
  photos: Partial<Record<IdCardPhotoFieldId, string | null>>;
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
  sis: SisState,
  masters: MastersState,
): IdCardDoc {
  const ay = student.academicYearCode || currentAcademicYearCode(masters);
  const household = householdOf(sis, student.householdId);
  return {
    kind: "student",
    refId: student.id,
    values: {
      name: student.fullName,
      class_section: classSectionLabel(masters, student.classId, student.sectionId),
      roll_no: student.rollNo || "—",
      admission_no: student.admissionNo || "—",
      blood_group: student.bloodGroup || undefined,
      dob: student.dob || undefined,
      father_name: student.fatherName || undefined,
      mother_name: student.motherName || undefined,
      validity: `Valid: AY ${ay}`,
    },
    photos: {
      student_photo: student.photoUrl || null,
      father_photo: student.fatherPhotoUrl || null,
      mother_photo: student.motherPhotoUrl || null,
      guardian_photo: household?.guardianPhotoUrl || null,
    },
    qrPayload: studentQrPayload(student.admissionNo, student.id),
  };
}

export function buildStaffIdCardDoc(staff: StaffRecord, masters: MastersState): IdCardDoc {
  const designation =
    (masters.designations ?? []).find((d) => d.id === staff.designationId)?.name || "";
  const department =
    (masters.departments ?? []).find((d) => d.id === staff.departmentId)?.name || "";
  return {
    kind: "staff",
    refId: staff.id,
    values: {
      name: staff.fullName,
      designation: designation || "Staff",
      emp_code: staff.empCode || "—",
      department: department || undefined,
      validity: `Valid: AY ${currentAcademicYearCode(masters)}`,
    },
    // father/mother/guardian keys deliberately never set — the data-layer
    // backstop alongside the field catalog's appliesTo filter (see
    // lib/idCardTemplate.ts) so a corrupted staff template can't leak
    // parent photos even if it somehow requested them.
    photos: {
      student_photo: staff.photoUrl || null,
    },
    qrPayload: staff.qrPayload || studentQrPayload(staff.empCode, staff.id),
  };
}

const MAX_CARDS_PER_RUN = 300;
const QR_CHUNK_SIZE = 50;

const CARD_DIMS: Record<IdCardOrientation, { w: number; h: number }> = {
  landscape: { w: 86, h: 54 },
  portrait: { w: 54, h: 86 },
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 10;
const MARGIN_Y = 10;
const GAP_X = 5;
const GAP_Y = 5;

function gridFor(cardW: number, cardH: number): { cols: number; perPage: number } {
  const cols = Math.max(1, Math.floor((PAGE_W - 2 * MARGIN_X + GAP_X) / (cardW + GAP_X)));
  const rows = Math.max(1, Math.floor((PAGE_H - 2 * MARGIN_Y + GAP_Y) / (cardH + GAP_Y)));
  return { cols, perPage: cols * rows };
}

function gridPos(idx: number, cols: number, cardW: number, cardH: number): { x: number; y: number } {
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  return { x: MARGIN_X + col * (cardW + GAP_X), y: MARGIN_Y + row * (cardH + GAP_Y) };
}

function drawPlaceholderPhoto(doc: jsPDF, x: number, y: number, w: number, h: number, dashed = false) {
  doc.setDrawColor(dashed ? 170 : 32, dashed ? 170 : 48, dashed ? 170 : 80);
  doc.setFillColor(dashed ? 250 : 240, dashed ? 250 : 240, dashed ? 250 : 232);
  doc.setLineWidth(0.3);
  if (dashed) doc.setLineDashPattern([1, 1], 0);
  doc.rect(x, y, w, h, "FD");
  if (dashed) doc.setLineDashPattern([], 0);
  if (!dashed && w >= 10) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(5, w * 0.25));
    doc.setTextColor(140, 140, 130);
    doc.text(TENANT.shortName.slice(0, 3).toUpperCase(), x + w / 2, y + h / 2, { align: "center" });
  }
}

function drawPhotoOrPlaceholder(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  dataUrl: string | null | undefined,
  dashedFallback = false,
) {
  if (w <= 0 || h <= 0) return;
  if (dataUrl) {
    try {
      doc.addImage(dataUrl, imageFormatFromDataUrl(dataUrl), x, y, w, h);
      return;
    } catch {
      /* fall through to placeholder */
    }
  }
  drawPlaceholderPhoto(doc, x, y, w, h, dashedFallback);
}

function valueFor(card: IdCardDoc, f: IdCardTextFieldId): string {
  return card.values[f] || "—";
}

function secondaryLabel(id: IdCardPhotoFieldId): string {
  if (id === "father_photo") return "Father";
  if (id === "mother_photo") return "Mother";
  return "Guardian";
}

/** One card face (front or back) — same function for both orientations,
 * everything derived from cardW/cardH so it adapts without a second
 * implementation. Portrait cards (narrow, tall) use a stacked layout;
 * landscape cards (wide, short) use a side-by-side layout — the split is
 * a width/height comparison inside this function, not a caller choice. */
function drawIdCardFace(
  doc: jsPDF,
  x: number,
  y: number,
  cardW: number,
  cardH: number,
  fields: IdCardFieldId[],
  card: IdCardDoc & { qrDataUrl: string | null },
) {
  const pad = 3;
  doc.setDrawColor(32, 48, 80);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, cardW, cardH, 2, 2);

  const hasPhoto = fields.includes("student_photo");
  const hasQr = fields.includes("qr");
  const secondaryIds = ID_CARD_SECONDARY_PHOTO_IDS.filter((id) => fields.includes(id));
  const textFields = ID_CARD_TEXT_FIELD_PRIORITY.filter((f) => fields.includes(f));

  function drawSecondaryRow(rowX: number, rowY: number, availW: number) {
    if (!secondaryIds.length) return;
    const gap = 2;
    const thumb = Math.min(
      12,
      Math.max(5, (availW - (secondaryIds.length - 1) * gap) / secondaryIds.length),
    );
    let cx = rowX;
    for (const id of secondaryIds) {
      drawPhotoOrPlaceholder(doc, cx, rowY, thumb, thumb, card.photos[id], true);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(3.6);
      doc.setTextColor(110, 110, 110);
      doc.text(secondaryLabel(id), cx + thumb / 2, rowY + thumb + 2.6, { align: "center" });
      cx += thumb + gap;
    }
  }

  if (cardH > cardW) {
    // Portrait: photo + QR side by side on top, text centered below, then
    // a secondary-photo row along the bottom.
    const topRowH = cardH * 0.3;
    const photoH = hasPhoto ? topRowH : 0;
    const photoW = hasPhoto ? photoH * 0.78 : 0;
    const qrSize = hasQr ? Math.min(topRowH, cardW * 0.3) : 0;

    drawPhotoOrPlaceholder(doc, x + pad, y + pad, photoW, photoH, card.photos.student_photo);
    if (hasQr && card.qrDataUrl) {
      try {
        doc.addImage(card.qrDataUrl, "PNG", x + cardW - pad - qrSize, y + pad, qrSize, qrSize);
      } catch {
        /* skip QR on failure — card still readable by eye */
      }
    }

    const secRowH = secondaryIds.length ? 16 : 0;
    const textTop = y + pad + Math.max(photoH, qrSize) + 3;
    const textBottom = y + cardH - pad - secRowH;
    const textAvailH = Math.max(0, textBottom - textTop);
    const lineH = textFields.length ? Math.min(4.4, textAvailH / textFields.length) : 0;
    const textW = cardW - pad * 2;
    textFields.forEach((f, i) => {
      doc.setFont("helvetica", i === 0 ? "bold" : "normal");
      doc.setFontSize(i === 0 ? 7.5 : 6.2);
      doc.setTextColor(i === 0 ? 32 : 70, i === 0 ? 48 : 70, i === 0 ? 80 : 70);
      doc.text(valueFor(card, f), x + cardW / 2, textTop + (i + 1) * lineH, {
        align: "center",
        maxWidth: textW,
      });
    });

    if (secondaryIds.length) {
      const thumb = 12;
      drawSecondaryRow(x + pad, y + cardH - pad - thumb - 3, cardW - pad * 2);
    }
  } else {
    // Landscape: photo left, QR right, text flowing between them.
    const photoW = hasPhoto ? Math.min(cardW * 0.32, (cardH - pad * 2) * 0.78) : 0;
    const photoH = hasPhoto ? photoW / 0.78 : 0;
    const qrSize = hasQr ? Math.min(20, cardH * 0.35) : 0;

    drawPhotoOrPlaceholder(doc, x + pad, y + pad, photoW, photoH, card.photos.student_photo);
    if (hasQr && card.qrDataUrl) {
      try {
        doc.addImage(
          card.qrDataUrl,
          "PNG",
          x + cardW - pad - qrSize,
          y + cardH - pad - qrSize,
          qrSize,
          qrSize,
        );
      } catch {
        /* skip QR on failure — card still readable by eye */
      }
    }

    const textX = x + pad + (hasPhoto ? photoW + pad : 0);
    const textRight = x + cardW - pad - (hasQr ? qrSize + pad : 0);
    const textW = Math.max(15, textRight - textX);
    const secRowH = secondaryIds.length ? 14 : 0;
    const textAvailH = cardH - pad * 2 - secRowH;
    const lineH = textFields.length ? Math.min(4.4, textAvailH / textFields.length) : 0;
    textFields.forEach((f, i) => {
      doc.setFont("helvetica", i === 0 ? "bold" : "normal");
      doc.setFontSize(i === 0 ? 8 : 6.5);
      doc.setTextColor(i === 0 ? 32 : 70, i === 0 ? 48 : 70, i === 0 ? 80 : 70);
      doc.text(valueFor(card, f), textX, y + pad + (i + 1) * lineH, { maxWidth: textW });
    });

    if (secondaryIds.length) {
      const thumb = 12;
      const rowAvailRight = hasQr ? x + cardW - pad - qrSize - pad : x + cardW - pad;
      drawSecondaryRow(textX, y + cardH - pad - thumb, rowAvailRight - textX);
    }
  }
}

async function withQrDataUrls(
  docs: IdCardDoc[],
  needsQr: boolean,
): Promise<(IdCardDoc & { qrDataUrl: string | null })[]> {
  if (!needsQr) return docs.map((d) => ({ ...d, qrDataUrl: null }));
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

/** True when the template has enough photos-per-card that a large batch
 * is worth an advisory in the UI (not a hard cap change). */
export function idCardTemplateIsHeavy(template: IdCardTemplate): boolean {
  const secondaryOnFront = ID_CARD_SECONDARY_PHOTO_IDS.some((id) => template.frontFields.includes(id));
  const secondaryOnBack = ID_CARD_SECONDARY_PHOTO_IDS.some((id) => template.backFields.includes(id));
  return template.sides === "front_back" && (secondaryOnFront || secondaryOnBack);
}

export async function downloadIdCardsPdf(
  docs: IdCardDoc[],
  template: IdCardTemplate,
  options?: { fileBaseName?: string },
): Promise<void> {
  if (!docs.length) throw new Error("No cards selected");
  if (docs.length > MAX_CARDS_PER_RUN) {
    throw new Error(
      `Select ${MAX_CARDS_PER_RUN} or fewer at a time — print the rest in a separate batch.`,
    );
  }

  const needsQr =
    template.frontFields.includes("qr") ||
    (template.sides === "front_back" && template.backFields.includes("qr"));
  const withQr = await withQrDataUrls(docs, needsQr);

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const { w: cardW, h: cardH } = CARD_DIMS[template.orientation];
  const { cols, perPage } = gridFor(cardW, cardH);

  let firstPage = true;
  for (let i = 0; i < withQr.length; i += perPage) {
    const chunk = withQr.slice(i, i + perPage);
    if (!firstPage) doc.addPage();
    firstPage = false;
    chunk.forEach((card, idx) => {
      const { x, y } = gridPos(idx, cols, cardW, cardH);
      drawIdCardFace(doc, x, y, cardW, cardH, template.frontFields, card);
    });
    if (template.sides === "front_back") {
      doc.addPage();
      chunk.forEach((card, idx) => {
        const { x, y } = gridPos(idx, cols, cardW, cardH);
        drawIdCardFace(doc, x, y, cardW, cardH, template.backFields, card);
      });
    }
    // Yield between page-chunks — up to 4 photos/card now, no yields at
    // all in this loop previously, a real freeze risk on a 300-card run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const base = options?.fileBaseName || "id_cards";
  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`${base}_${stamp}.pdf`);
}
