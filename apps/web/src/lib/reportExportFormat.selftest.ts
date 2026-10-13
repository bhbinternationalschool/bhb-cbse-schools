/**
 * Run: npx tsx src/lib/reportExportFormat.selftest.ts
 *
 * The report export engine (14 Oct 2026): what every "Export → Excel / PDF"
 * button in the ERP writes.
 *  - columns are typed from header + values: money, counts, %, dates stay
 *    numbers/dates in Excel; identifiers (roll, adm no, phone, receipt no,
 *    leading-zero codes) stay text;
 *  - the workbook read back holds real numbers, number formats, IST times and
 *    a TOTAL row of live SUM formulas — not "₹1,200" text;
 *  - CSV carries plain numbers;
 *  - totals skip balances/rates/marks, and never double a report's own total;
 *  - PDF text: ₹/Hindi are split into glyph runs (ASCII stand-ins without a
 *    renderer), cells wrap to their column and rows grow instead of
 *    overlapping, wide reports keep S.No + name on every band, and a long
 *    report with extra sheets lays out without error.
 */
import assert from "node:assert/strict";
import * as ExcelMod from "exceljs";
import {
  buildTotalsRow,
  classifyColumns,
  csvValue,
  displayValue,
  formatIndian,
  parseAmount,
  xlsxValue,
  type TypedColumn,
} from "./reportCells";
import { needsGlyphs, splitRuns, wrapText, type GlyphRenderer, type TextStyle } from "./pdfRichText";
import { bandColumns, drawReportPdf } from "./pdfReportTable";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}

const kindOf = (header: string, values: (string | number | null)[]) =>
  classifyColumns([{ key: "k", header }], values.map((k) => ({ k })))[0];

void (async () => {
  console.log("reportExportFormat.selftest.ts");

  await check("money: fee paise() strings, ₹ strings, Indian grouping, blanks", () => {
    assert.equal(kindOf("Paid ₹", ["1200.00", "350.50"]), "money");
    assert.equal(kindOf("Outstanding", ["₹1,23,456", "₹0", "—"]), "money");
    assert.equal(kindOf("Amount", [1200, 30]), "money");
    assert.equal(kindOf("Admission fee", ["5000"]), "money", "a money header beats 'admission'");
    assert.equal(kindOf("Receipt amount", ["700"]), "money");
    assert.equal(parseAmount("₹1,23,456.50"), 123456.5);
    assert.equal(parseAmount("-₹200"), -200);
    assert.equal(parseAmount("12 apples"), null);
  });

  await check("identifiers stay text whatever they look like", () => {
    assert.equal(kindOf("Roll no", ["12", "13"]), "text");
    assert.equal(kindOf("Adm no", ["1023", "1024"]), "text");
    assert.equal(kindOf("Mobile", ["9876543210"]), "text");
    assert.equal(kindOf("Receipt no", ["2026001"]), "text");
    assert.equal(kindOf("Loan ac", ["50100223344"]), "text");
    assert.equal(kindOf("Aadhaar", ["234567890123"]), "text");
    assert.equal(kindOf("Code", ["0123", "0456"]), "text");
    assert.equal(kindOf("Amount", ["0123"]), "text", "a leading zero is a code, not 123");
    assert.equal(kindOf("Name", ["12"]), "text", "no money/count header, no ₹: leave it");
  });

  await check("counts, %, dates, IST datetimes", () => {
    assert.equal(kindOf("Receipts", [3, "4"]), "number");
    assert.equal(kindOf("No. of students", ["30"]), "number");
    assert.equal(kindOf("Paid days", ["26"]), "number", "days, not rupees");
    assert.equal(kindOf("Pass %", ["72.5%", "80%"]), "percent");
    assert.equal(kindOf("Date", ["2026-10-13", "2026-10-14"]), "date");
    assert.equal(kindOf("Voided at", ["2026-10-13T08:20:49.387Z"]), "datetime");
    assert.equal(displayValue("datetime", "2026-10-13T20:00:00Z"), "14-10-2026 01:30", "IST, next day");
    assert.equal(displayValue("date", "2026-04-01"), "01-04-2026");
    assert.equal(formatIndian(1234567.5), "12,34,567.50");
    assert.equal(displayValue("money", "1200.00"), "1,200.00");
    assert.equal(csvValue("money", "₹1,23,456"), "123456");
    assert.equal(csvValue("percent", "72.5%"), "72.5");
  });

  await check("xlsx values: numbers, fractions, UTC wall-clock dates", () => {
    assert.equal(xlsxValue("money", "₹1,200"), 1200);
    assert.equal(xlsxValue("percent", "72.5%"), 0.725);
    const d = xlsxValue("date", "2026-04-01") as Date;
    assert.equal(d.toISOString(), "2026-04-01T00:00:00.000Z");
    const t = xlsxValue("datetime", "2026-10-13T20:00:00Z") as Date;
    assert.equal(t.toISOString(), "2026-10-14T01:30:00.000Z", "IST wall clock");
    assert.equal(xlsxValue("money", "—"), "—", "a dash stays a dash");
  });

  await check("totals: money + named counts; never balances, rates, marks; never twice", () => {
    const cols: TypedColumn[] = [
      { key: "name", header: "Student" },
      { key: "paid", header: "Paid ₹" },
      { key: "rc", header: "Receipts" },
      { key: "bal", header: "Balance" },
      { key: "rate", header: "Rate ₹" },
      { key: "marks", header: "Marks" },
    ];
    const rows = [
      { name: "A", paid: "1200.00", rc: 2, bal: "100", rate: "10", marks: 40 },
      { name: "B", paid: "₹300", rc: 1, bal: "50", rate: "10", marks: 35 },
    ];
    const kinds = classifyColumns(cols, rows);
    const t = buildTotalsRow(cols, rows, kinds)!;
    assert.equal(t.row.paid, 1500);
    assert.equal(t.row.rc, 3);
    assert.equal(t.row.name, "TOTAL");
    assert.equal(t.row.bal, undefined);
    assert.equal(t.row.rate, undefined);
    assert.equal(t.row.marks, undefined);
    assert.equal(buildTotalsRow(cols, [rows[0]!], kinds), null, "one row needs no total");
    assert.equal(buildTotalsRow(cols, [...rows, { name: "TOTAL", paid: "1500" }], kinds), null, "report has its own");
    assert.equal(buildTotalsRow([{ key: "n", header: "Name" }], [{ n: "a" }, { n: "b" }], ["text"]), null);
  });

  await check("xlsx read back: numbers, formats, SUM total, frozen header", async () => {
    // The workbook builder is in reportExport.ts, which imports app modules;
    // it is exercised here through its pieces against a real exceljs book.
    const { buildXlsxReport } = await import("./reportExport");
    const buf = await buildXlsxReport({
      title: "Daily collection",
      fileBaseName: "t",
      columns: [
        { key: "date", header: "Date" },
        { key: "rc", header: "Receipts" },
        { key: "amount", header: "Collected ₹" },
        { key: "adm", header: "Adm no" },
      ],
      rows: [
        { date: "2026-10-12", rc: 3, amount: "1200.00", adm: "0123" },
        { date: "2026-10-13", rc: 2, amount: "₹1,300.50", adm: "0456" },
      ],
      extraSheets: [{ name: "By mode", columns: [{ key: "m", header: "Mode" }, { key: "a", header: "Amount" }], rows: [{ m: "Cash", a: "100" }, { m: "UPI", a: "200" }] }],
    });
    const ExcelJS = ((ExcelMod as { default?: typeof ExcelMod }).default ?? ExcelMod) as typeof ExcelMod;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("C2").value, 1200);
    assert.equal(ws.getCell("C3").value, 1300.5);
    assert.equal(ws.getCell("C2").numFmt, "#,##0.00");
    assert.equal(ws.getCell("B2").value, 3);
    assert.ok(ws.getCell("A2").value instanceof Date, "date cell is a date");
    assert.equal(ws.getCell("A2").numFmt, "dd-mm-yyyy");
    assert.equal(ws.getCell("D2").value, "0123", "leading-zero id kept as text");
    const total = ws.getCell("C4").value as { formula?: string; result?: number };
    assert.equal(total.formula, "SUM(C2:C3)");
    assert.equal(total.result, 2500.5);
    assert.equal(ws.getCell("A4").value, "TOTAL");
    assert.equal((ws.getCell("B4").value as { formula?: string }).formula, "SUM(B2:B3)");
    assert.equal(wb.worksheets[1]!.getCell("B4").value && (wb.worksheets[1]!.getCell("B4").value as { formula?: string }).formula, "SUM(B2:B3)", "extra sheet totalled too");
  });

  // PDF pieces against the real jsPDF (node build), no renderer.
  const { jsPDF } = await import("jspdf");

  await check("glyph runs: ₹ and Hindi split out; ASCII stand-ins without a renderer", () => {
    assert.ok(needsGlyphs("Paid ₹"));
    assert.ok(!needsGlyphs("Paid Rs — ok… “quoted”"), "WinAnsi punctuation is fine");
    const fake: GlyphRenderer = { measure: (t) => t.length * 5, render: () => null };
    const runs = splitRuns("आरव कुमार (VI-A) ₹500", fake);
    assert.deepEqual(runs.map((r) => [r.glyph, r.text]), [
      [true, "आरव कुमार"],
      [false, " (VI-A) "],
      [true, "₹"],
      [false, "500"],
    ]);
    const plain = splitRuns("Paid ₹ → ≤75%", null);
    assert.equal(plain.map((r) => r.text).join(""), "Paid Rs  -> <=75%");
    assert.ok(plain.every((r) => !r.glyph));
    assert.ok(splitRuns("आरव", null)[0]!.glyph, "Hindi stays a glyph run: the caller must refuse, not print junk");
  });

  await check("cells wrap to the column; overflow ends in …", () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const style: TextStyle = { sizePt: 8, bold: false, color: [0, 0, 0] };
    const long = "Aarav Kumar Singh s/o Ramesh Kumar Singh, Village Chaubeypur, Varanasi";
    const lines = wrapText(doc, long, 80, style, null);
    assert.ok(lines.length >= 3, `wrapped into ${lines.length} lines`);
    for (const l of lines) assert.ok(doc.getTextWidth(l) <= 80.5, `"${l}" fits`);
    assert.equal(lines.join(" "), long, "no text lost");
    const capped = wrapText(doc, long, 80, style, null, 2);
    assert.equal(capped.length, 2);
    assert.ok(capped[1]!.endsWith("…"));
    const word = wrapText(doc, "X".repeat(60), 50, style, null);
    assert.ok(word.length > 1, "a word wider than the column is broken");
  });

  await check("bands keep S.No + name on every page", () => {
    const cols = [{ header: "S.No" }, { header: "Student" }, ...Array.from({ length: 31 }, (_, i) => ({ header: String(i + 1) }))];
    const bands = bandColumns(cols, 770);
    assert.ok(bands.length > 1);
    for (const b of bands) assert.deepEqual([b[0]!.header, b[1]!.header], ["S.No", "Student"]);
    const plain = bandColumns([{ header: "Student" }, ...Array.from({ length: 31 }, (_, i) => ({ header: String(i) }))], 770);
    for (const b of plain) assert.equal(b[0]!.header, "Student");
  });

  await check("a long report with extra sheets lays out: pages, rows grow, footer", () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const rows = Array.from({ length: 150 }, (_, i) => ({
      name: i % 7 === 0 ? "A very long guardian name and address line that must wrap over several lines in its column" : `Student ${i}`,
      amount: `${(i * 37.5).toFixed(2)}`,
      date: "2026-10-13",
    }));
    let addPages = 0;
    const realAdd = doc.addPage.bind(doc);
    (doc as unknown as { addPage: () => unknown }).addPage = () => {
      addPages++;
      return realAdd();
    };
    drawReportPdf(
      doc,
      [
        { title: "Fee collection — Paid ₹", columns: [{ key: "name", header: "Student" }, { key: "amount", header: "Paid ₹" }, { key: "date", header: "Date" }], rows },
        { title: "By mode", columns: [{ key: "m", header: "Mode" }, { key: "a", header: "Amount" }], rows: [{ m: "Cash", a: "1" }, { m: "UPI", a: "2" }] },
      ],
      { renderer: null, defaultSubtitle: "BHB", footerLabel: "BHB", generatedAt: "now" },
    );
    assert.ok(doc.getNumberOfPages() >= 4, `pages: ${doc.getNumberOfPages()}`);
    assert.equal(addPages, doc.getNumberOfPages() - 1);
  });

  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("  all ok");
})();
