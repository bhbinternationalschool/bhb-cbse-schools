/**
 * Exam admit card — one full page per student, letterhead + subject/date/time
 * schedule pulled from the exam date sheet. See lib/idCardsPdf.ts for the
 * separate (multi-card-grid, mm-unit) student/staff ID card generator —
 * different jsPDF unit, different page model, kept in its own file.
 */

import type { jsPDF } from "jspdf";
import {
  drawPdfLetterhead,
  imageFormatFromDataUrl,
  resolvePdfLetterhead,
  type PdfLetterheadInfo,
} from "@/lib/pdfLetterhead";
import { qrDataUrlFor } from "@/lib/pdfQr";
import { classSectionLabel, WEEKDAY_SHORT } from "@/lib/timetable";
import { isoDateWeekday } from "@/lib/examTimetable";
import type { ExamDateSheetEntry, ExamSubject, ExamTerm } from "@/lib/exams";
import type { SisStudent } from "@/lib/sis";
import { loadMasters, type MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import { studentQrPayload } from "@/lib/idCardsPdf";

export type AdmitCardSubjectRow = {
  subjectName: string;
  date: string;
  dayLabel: string;
  startTime: string;
  durationMinutes: number;
  endTime: string;
  note: string;
};

export type AdmitCardDoc = {
  studentId: string;
  studentName: string;
  admissionNo: string;
  rollNo: string;
  classLabel: string;
  photoUrl: string | null;
  qrPayload: string;
  examTermLabel: string;
  academicYearCode: string;
  subjects: AdmitCardSubjectRow[];
};

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h || 0) * 60 + (m || 0) + minutes;
  const clamped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export function buildAdmitCardDoc(
  student: SisStudent,
  examTerm: ExamTerm,
  options: {
    masters: MastersState;
    dateSheet: ExamDateSheetEntry[];
    examSubjects: ExamSubject[];
  },
): AdmitCardDoc {
  const subjects = options.dateSheet
    .filter((row) => row.classId === student.classId)
    .map((row) => {
      const subject = options.examSubjects.find((s) => s.id === row.subjectId);
      const weekday = isoDateWeekday(row.date);
      return {
        subjectName: subject?.name || subject?.code || row.subjectId,
        date: row.date,
        dayLabel: weekday != null ? WEEKDAY_SHORT[weekday] ?? "" : "",
        startTime: row.startTime,
        durationMinutes: row.durationMinutes,
        endTime: addMinutes(row.startTime, row.durationMinutes),
        note: row.note,
      };
    });

  return {
    studentId: student.id,
    studentName: student.fullName,
    admissionNo: student.admissionNo,
    rollNo: student.rollNo,
    classLabel: classSectionLabel(
      options.masters,
      student.classId,
      student.sectionId,
    ),
    photoUrl: student.photoUrl || null,
    qrPayload: studentQrPayload(student.admissionNo, student.id),
    examTermLabel: examTerm.label,
    academicYearCode: examTerm.academicYearCode,
    subjects,
  };
}

const ADMIT_CARD_INSTRUCTIONS = [
  "Report 30 minutes before the first exam of the day.",
  "This admit card must be carried to every exam and shown on request.",
  "No electronic devices (mobile phones, smartwatches, calculators unless permitted) allowed in the exam hall.",
  "Reach your allotted classroom/seat as per school notice — seat numbers are shared separately.",
];

const MAX_ADMIT_CARDS_PER_RUN = 300;

function drawInfoBox(
  doc: jsPDF,
  a: AdmitCardDoc,
  margin: number,
  usable: number,
  y: number,
  photoDataUrl: string | null,
  qrDataUrl: string | null,
): number {
  const boxH = 90;
  doc.setFillColor(248, 248, 240);
  doc.setDrawColor(197, 160, 40);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin, y, usable, boxH, 4, 4, "FD");

  const textX = margin + 12;
  let textY = y + 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(32, 48, 80);
  doc.text(`Name: ${a.studentName}`, textX, textY);
  textY += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(`Admission No: ${a.admissionNo}`, textX, textY);
  textY += 16;
  doc.text(`Class: ${a.classLabel}`, textX, textY);
  textY += 16;
  doc.text(`Roll No: ${a.rollNo || "—"}`, textX, textY);

  const photoW = 60;
  const photoH = 72;
  const photoX = margin + usable - 12 - photoW - 12 - 60;
  const photoY = y + 10;
  if (photoDataUrl) {
    try {
      doc.addImage(
        photoDataUrl,
        imageFormatFromDataUrl(photoDataUrl),
        photoX,
        photoY,
        photoW,
        photoH,
      );
      doc.setDrawColor(32, 48, 80);
      doc.rect(photoX, photoY, photoW, photoH);
    } catch {
      /* skip photo on failure — QR + text still identify the student */
    }
  }

  if (qrDataUrl) {
    const qrSize = 60;
    const qrX = margin + usable - 12 - qrSize;
    const qrY = y + 10;
    try {
      doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);
    } catch {
      /* skip QR on failure */
    }
  }

  return y + boxH + 14;
}

function drawSubjectTable(
  doc: jsPDF,
  subjects: AdmitCardSubjectRow[],
  margin: number,
  usable: number,
  y: number,
): number {
  const widths = [70, 45, 150, 65, 65, 65];
  const headers = ["Date", "Day", "Subject", "Start", "Duration", "End"];
  const rowH = 20;
  const headerH = 22;

  doc.setFillColor(236, 239, 244);
  doc.rect(margin, y, usable, headerH, "F");
  doc.setDrawColor(32, 48, 80);
  doc.setLineWidth(0.5);
  doc.rect(margin, y, usable, headerH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(32, 48, 80);
  let x = margin;
  headers.forEach((h, i) => {
    doc.text(h, x + 6, y + 14);
    x += widths[i]!;
  });
  let rowY = y + headerH;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(40, 40, 40);
  subjects.forEach((row) => {
    doc.setDrawColor(210, 210, 200);
    doc.rect(margin, rowY, usable, rowH);
    x = margin;
    const cells = [
      row.date,
      row.dayLabel,
      row.subjectName,
      row.startTime,
      `${row.durationMinutes} min`,
      row.endTime,
    ];
    cells.forEach((c, i) => {
      doc.text(c, x + 6, rowY + 13, { maxWidth: widths[i]! - 8 });
      x += widths[i]!;
    });
    rowY += rowH;
  });

  return rowY + 12;
}

function drawInstructions(
  doc: jsPDF,
  margin: number,
  usable: number,
  y: number,
): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(32, 48, 80);
  doc.text("Instructions", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  for (const line of ADMIT_CARD_INSTRUCTIONS) {
    doc.text(`•  ${line}`, margin, y, { maxWidth: usable });
    y += 13;
  }
  return y + 10;
}

function drawSignatureLine(
  doc: jsPDF,
  margin: number,
  usable: number,
  pageW: number,
  pageH: number,
) {
  const y = pageH - 60;
  const x = pageW - margin - 140;
  doc.setDrawColor(120, 120, 120);
  doc.line(x, y, x + 140, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(50, 50, 50);
  doc.text("Principal", x + 70, y + 13, { align: "center" });
}

function drawAdmitCardPage(
  doc: jsPDF,
  a: AdmitCardDoc,
  margin: number,
  usable: number,
  pageW: number,
  pageH: number,
  letterhead: PdfLetterheadInfo,
  photoDataUrl: string | null,
  qrDataUrl: string | null,
) {
  let y = drawPdfLetterhead(doc, letterhead, margin, usable, pageW);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(32, 48, 80);
  doc.text(
    `Admit Card · ${a.examTermLabel} · ${a.academicYearCode}`,
    pageW / 2,
    y,
    { align: "center" },
  );
  y += 18;

  y = drawInfoBox(doc, a, margin, usable, y, photoDataUrl, qrDataUrl);
  y = drawSubjectTable(doc, a.subjects, margin, usable, y);
  drawInstructions(doc, margin, usable, y);
  drawSignatureLine(doc, margin, usable, pageW, pageH);

  doc.setFontSize(8);
  doc.setTextColor(130, 130, 130);
  doc.text(
    `${TENANT.shortName} · Admit Card · Generated ${new Date().toISOString().slice(0, 10)}`,
    pageW / 2,
    pageH - 14,
    { align: "center" },
  );
}

export async function downloadAdmitCardsPdf(
  docs: AdmitCardDoc[],
  options?: { masters?: MastersState },
): Promise<void> {
  if (!docs.length) throw new Error("No students selected for admit cards");
  if (docs.length > MAX_ADMIT_CARDS_PER_RUN) {
    throw new Error(
      `Select ${MAX_ADMIT_CARDS_PER_RUN} or fewer at a time — print the rest in a separate batch.`,
    );
  }

  const letterhead = await resolvePdfLetterhead(
    options?.masters ?? loadMasters(),
  );
  const qrDataUrls = await Promise.all(
    docs.map((d) => qrDataUrlFor(d.qrPayload).catch(() => null)),
  );

  const { jsPDF: JsPDF } = await import("jspdf");
  const doc = new JsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const usable = pageW - margin * 2;

  docs.forEach((a, i) => {
    if (i > 0) doc.addPage();
    drawAdmitCardPage(
      doc,
      a,
      margin,
      usable,
      pageW,
      pageH,
      letterhead,
      a.photoUrl,
      qrDataUrls[i] ?? null,
    );
  });

  const base =
    docs.length === 1
      ? `admit_card_${docs[0]!.admissionNo || "student"}`
      : `admit_cards_${docs.length}_students`;
  doc.save(`${base}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
