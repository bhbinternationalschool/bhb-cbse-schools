/**
 * The daily brief as a PDF.
 *
 * Its own renderer rather than the tabular one in reportPdf.server: this is
 * not a table, it is a page of the day's numbers followed by two tables,
 * and forcing it through a single-table renderer would mean sending three
 * separate documents at 6 PM.
 *
 * Layout, in the order the reader needs it:
 *   page 1  the day — money in, money out, students, staff, who is missing
 *           and why, and the leave requests waiting for a decision
 *   then    class-by-class attendance
 *   then    tomorrow's calling list, with the numbers to dial
 *
 * The calling list carries REAL mobile numbers, unlike the masked ones in
 * the defaulters report — the whole point of it is that somebody rings
 * these families in the morning. That is also why the brief goes to named
 * leadership numbers and not to a group.
 */

import "server-only";

import { jsPDF } from "jspdf";
import { ensureDevanagariFont, FONT_FAMILY, hasDevanagari } from "@/lib/pdfDevanagari";
import { drawPdfLetterhead, resolvePdfLetterhead } from "@/lib/pdfLetterhead";
import type { MastersState } from "@/lib/masters";
import {
  absencesNeedingAttention,
  attendancePercent,
  briefTitle,
  rupeesExact,
  staffPercent,
  tenderModeLabel,
  type DailyBrief,
} from "@/lib/dailyBrief";
import { telHrefForMobile } from "@/lib/udiseCompliance";

const MARGIN = 36;

/**
 * Money for a PDF page, as "Rs. 4,850.00".
 *
 * The ₹ sign (U+20B9) has no glyph in jsPDF's built-in Helvetica: it is
 * truncated to byte 0xB9 and printed as a superscript one, so "₹4,850.00"
 * comes out "¹4,850.00". Caught by rendering this brief and reading the
 * text back out of the file rather than trusting that it compiled.
 *
 * "Rs." is used rather than embedding a font for one symbol — the
 * Devanagari face is only loaded when a name needs it, and every line here
 * carries money. The same defect exists in the ERP's other report PDFs,
 * which go through formatInr; fixing those is a separate change.
 */
function pdfMoney(paise: number): string {
  return rupeesExact(paise).replace("₹", "Rs. ");
}

export async function renderDailyBriefPdf(
  brief: DailyBrief,
  masters?: MastersState,
): Promise<Buffer> {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - MARGIN * 2;

  // Names typed in Hindi are common on this roster, and a missing glyph in
  // a defaulter's name is a family nobody can identify to ring.
  const textBits = [
    ...brief.staff.absentRows.map((r) => r.name),
    ...brief.staff.pending.map((r) => r.name),
    ...brief.defaulters.rows.flatMap((r) => [r.name, r.fatherName, r.guardianName]),
    ...brief.students.classes.map((c) => c.label),
    ...brief.expenses.byHead.map((h) => h.label),
  ];
  const devanagari = textBits.some(hasDevanagari)
    ? await ensureDevanagariFont(doc)
    : false;
  const font = (bold: boolean, text?: string) => {
    if (devanagari && text && hasDevanagari(text)) {
      doc.setFont(FONT_FAMILY, bold ? "bold" : "normal");
    } else doc.setFont("helvetica", bold ? "bold" : "normal");
  };

  const letterhead = await resolvePdfLetterhead(masters);
  let y = drawPdfLetterhead(doc, letterhead, MARGIN, usable, pageW);

  const stamp = `${briefTitle(brief.date)} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;

  /** New page when the next block would not fit, with the letterhead redrawn. */
  const room = (needed: number) => {
    if (y + needed <= pageH - MARGIN - 24) return;
    doc.addPage();
    y = drawPdfLetterhead(doc, letterhead, MARGIN, usable, pageW);
  };

  const heading = (text: string) => {
    room(40);
    y += 8;
    font(true, text);
    doc.setFontSize(12);
    doc.setTextColor(32, 48, 80);
    doc.text(text, MARGIN, y);
    y += 6;
    doc.setDrawColor(210, 216, 228);
    doc.line(MARGIN, y, pageW - MARGIN, y);
    y += 12;
    doc.setTextColor(20, 20, 20);
  };

  const line = (label: string, value: string, bold = false) => {
    room(18);
    doc.setFontSize(10);
    font(bold, label);
    doc.text(label, MARGIN, y);
    font(bold, value);
    doc.text(value, pageW - MARGIN, y, { align: "right" });
    y += 14;
  };

  const note = (text: string) => {
    room(18);
    doc.setFontSize(9);
    doc.setTextColor(110, 118, 134);
    font(false, text);
    for (const row of doc.splitTextToSize(text, usable) as string[]) {
      room(12);
      doc.text(row, MARGIN, y);
      y += 11;
    }
    doc.setTextColor(20, 20, 20);
    y += 2;
  };

  const table = (
    columns: {
      key: string;
      label: string;
      width: number;
      align?: "right";
      /**
       * A cell can carry a link. The calling list uses it for `tel:` so a
       * number can be dialled by tapping it on a phone, instead of being
       * copied out by hand at six in the evening.
       */
      href?: (row: Record<string, string>) => string;
    }[],
    rows: Record<string, string>[],
  ) => {
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * usable);
    const header = () => {
      room(24);
      doc.setFillColor(240, 243, 248);
      doc.rect(MARGIN, y - 10, usable, 16, "F");
      doc.setFontSize(9);
      let x = MARGIN;
      columns.forEach((c, i) => {
        font(true, c.label);
        doc.setTextColor(90, 100, 120);
        if (c.align === "right") doc.text(c.label, x + widths[i]! - 4, y, { align: "right" });
        else doc.text(c.label, x + 2, y);
        x += widths[i]!;
      });
      doc.setTextColor(20, 20, 20);
      y += 14;
    };
    header();
    for (const r of rows) {
      if (y + 14 > pageH - MARGIN - 24) {
        doc.addPage();
        y = drawPdfLetterhead(doc, letterhead, MARGIN, usable, pageW);
        header();
      }
      doc.setFontSize(9);
      let x = MARGIN;
      columns.forEach((c, i) => {
        const v = r[c.key] ?? "";
        font(false, v);
        const fitted = (doc.splitTextToSize(v, widths[i]! - 6) as string[])[0] ?? "";
        const href = c.href ? c.href(r) : "";
        if (href) {
          // Drawn as a link so it reads as one: blue, underlined, and with a
          // real PDF link annotation over the text — which is what a phone's
          // PDF viewer turns into a tap-to-dial.
          doc.setTextColor(21, 101, 192);
          doc.text(fitted, x + 2, y);
          const w = doc.getTextWidth(fitted);
          doc.setDrawColor(21, 101, 192);
          doc.setLineWidth(0.5);
          doc.line(x + 2, y + 1.5, x + 2 + w, y + 1.5);
          doc.link(x + 2, y - 8, w, 11, { url: href });
          doc.setTextColor(20, 20, 20);
        } else if (c.align === "right") {
          doc.text(fitted, x + widths[i]! - 4, y, { align: "right" });
        } else {
          doc.text(fitted, x + 2, y);
        }
        x += widths[i]!;
      });
      y += 13;
    }
    y += 4;
  };

  /* ── Title ── */
  doc.setFontSize(15);
  font(true, briefTitle(brief.date));
  doc.setTextColor(32, 48, 80);
  doc.text(briefTitle(brief.date), MARGIN, y + 6);
  y += 24;
  doc.setTextColor(20, 20, 20);

  /* ── Money in ── */
  heading("Fee collection");
  if (!brief.collection.recorded) {
    note("No fee collection was recorded today. This is not the same as Rs. 0 collected — it means no receipt was raised at the desk.");
  } else {
    line(
      `Collected · ${brief.collection.receipts} receipt${brief.collection.receipts === 1 ? "" : "s"}`,
      pdfMoney(brief.collection.totalPaise),
      true,
    );
    for (const m of brief.collection.byMode) {
      line(`   ${tenderModeLabel(m.key)} · ${m.count}`, pdfMoney(m.paise));
    }
  }

  /* ── Money out ── */
  heading("Expenses");
  if (!brief.expenses.recorded) {
    note("No expense voucher was entered today. Again - not Rs. 0 spent, but nothing recorded on the accounts desk.");
  } else {
    line(
      `Total · ${brief.expenses.vouchers} voucher${brief.expenses.vouchers === 1 ? "" : "s"}`,
      pdfMoney(brief.expenses.totalPaise),
      true,
    );
    for (const h of brief.expenses.byHead) {
      line(`   ${h.label} · ${h.count}`, pdfMoney(h.paise));
    }
  }

  /* ── Students ── */
  const pct = attendancePercent(brief.students);
  heading("Student attendance");
  if (pct === null) {
    note("No class register was marked today.");
  } else {
    line("Present", String(brief.students.present), true);
    line("Absent", String(brief.students.absent));
    line("Of those marked", `${pct}%`);
    if (brief.students.classesUnmarked) {
      note(
        `${brief.students.classesUnmarked} of ${brief.students.classes.length} sections were not marked, covering ${brief.students.classes
          .filter((c) => !c.marked)
          .reduce((s, c) => s + c.strength, 0)} children. The percentage above is of the children who were marked, not of the school.`,
      );
    }
  }

  /* ── Staff ── */
  const spct = staffPercent(brief.staff);
  heading("Staff attendance");
  if (spct === null) {
    note("Staff attendance was not marked today.");
  } else {
    line("Present", `${brief.staff.present} of ${brief.staff.strength}`, true);
    line("Absent", String(brief.staff.absent));
    line("Of those marked", `${spct}%`);
    const attention = absencesNeedingAttention(brief.staff);
    if (attention.length) {
      y += 4;
      table(
        [
          { key: "name", label: "Absent without approved leave", width: 46 },
          { key: "code", label: "Code", width: 14 },
          { key: "why", label: "Position", width: 40 },
        ],
        attention.map((r) => ({
          name: r.name,
          code: r.empCode,
          why:
            r.reason === "leave_pending"
              ? `Applied for ${r.leaveTypeLabel || "leave"} — awaiting your decision`
              : "No leave on file",
        })),
      );
    }
  }

  /* ── Leave decisions ── */
  if (brief.staff.pending.length) {
    heading("Leave requests awaiting a decision");
    table(
      [
        { key: "name", label: "Staff", width: 32 },
        { key: "type", label: "Type", width: 18 },
        { key: "dates", label: "Dates", width: 30 },
        { key: "days", label: "Days", width: 10, align: "right" },
      ],
      brief.staff.pending.map((r) => ({
        name: r.name,
        type: r.leaveTypeLabel,
        dates: r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} → ${r.toDate}`,
        days: String(r.days || ""),
      })),
    );
    note("Reply LEAVE on WhatsApp to see these with their numbers, then LEAVE OK <n> or LEAVE NO <n> to decide one.");
  }

  /* ── Class by class ── */
  if (brief.students.classes.length) {
    heading("Class by class");
    table(
      [
        { key: "cls", label: "Class", width: 34 },
        { key: "p", label: "Present", width: 14, align: "right" },
        { key: "a", label: "Absent", width: 14, align: "right" },
        { key: "u", label: "Not marked", width: 16, align: "right" },
        { key: "s", label: "Strength", width: 14, align: "right" },
      ],
      brief.students.classes.map((c) => ({
        cls: c.label,
        p: c.marked ? String(c.present) : "—",
        a: c.marked ? String(c.absent) : "—",
        u: c.unmarked ? String(c.unmarked) : c.marked ? "" : String(c.strength),
        s: String(c.strength),
      })),
    );
  }

  /* ── Tomorrow's calls ── */
  heading("Calling list — overdue fees");
  if (brief.defaulters.rows.length === 0) {
    note("No family is overdue today.");
  } else {
    line(
      `${brief.defaulters.rows.length} families`,
      pdfMoney(brief.defaulters.totalPaise),
      true,
    );
    if (brief.defaulters.noMobile) {
      note(
        `${brief.defaulters.noMobile} of them have no usable number on file — those need a number before anyone can ring them.`,
      );
    }
    y += 4;
    table(
      [
        { key: "name", label: "Child", width: 26 },
        { key: "father", label: "Father", width: 24 },
        { key: "cls", label: "Class", width: 18 },
        {
          key: "mobile",
          label: "Mobile",
          width: 16,
          // "no number" rows carry nothing to dial, and telHrefForMobile
          // returns "" for anything that is not a real Indian mobile — so a
          // half-entered number never becomes a link that fails on tap.
          href: (row) => telHrefForMobile(row.mobile ?? ""),
        },
        { key: "due", label: "Overdue", width: 16, align: "right" },
      ],
      brief.defaulters.rows.map((r) => ({
        name: r.name,
        father: r.fatherName || r.guardianName || "—",
        cls: r.classLabel,
        mobile: r.mobile || "no number",
        due: pdfMoney(r.duePaise),
      })),
    );
  }

  /* ── AI note ── */
  if (brief.aiNote.trim()) {
    heading("Still open");
    note(brief.aiNote.trim());
  }

  /* ── Stamp every page: a PDF is forwarded far more easily than a screen
        is photographed, and this one carries parents' phone numbers. ── */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(140, 148, 162);
    doc.setFont("helvetica", "normal");
    doc.text(stamp, MARGIN, pageH - 18);
    doc.text(`Page ${p} of ${pages}`, pageW - MARGIN, pageH - 18, { align: "right" });
    doc.text(
      "Confidential — contains family contact details and fee balances.",
      MARGIN,
      pageH - 9,
    );
  }

  return Buffer.from(doc.output("arraybuffer"));
}
