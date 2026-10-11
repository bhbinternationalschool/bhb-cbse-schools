/**
 * POST — Propel's student upload sheet, filled from the ERP (director,
 * 12 Oct 2026). The robot downloads Propel's own blank template (so its
 * dropdowns and checks come with it) and sends it here; the ERP writes one
 * row per active child of the current year into its "Student" sheet and
 * sends the file back for the office to upload on Propel. Children the sheet
 * cannot carry are listed with the reason. Writes nothing. Compliance · edit.
 */

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import { buildPropelStudentRows, PROPEL_STUDENT_COLUMNS } from "@/lib/propelRobot";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { template?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const bytes = typeof body.template === "string" ? Buffer.from(body.template, "base64") : null;
  if (!bytes || bytes.length < 1000 || bytes.length > 5_000_000) {
    return NextResponse.json({ ok: false, error: "Propel's template did not arrive." }, { status: 400 });
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return NextResponse.json({ ok: false, error: "That is not an Excel file." }, { status: 400 });
  }
  const sheet = wb.getWorksheet("Student");
  if (!sheet) return NextResponse.json({ ok: false, error: "Propel's template has no Student sheet." }, { status: 400 });
  // The template must still be the one studied — columns in this order.
  const cellText = (v: unknown): string =>
    v && typeof v === "object" && Array.isArray((v as { richText?: unknown }).richText)
      ? (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("")
      : String(v ?? "");
  const head = PROPEL_STUDENT_COLUMNS.map((_, i) => cellText(sheet.getRow(1).getCell(i + 1).value).trim());
  const drift = PROPEL_STUDENT_COLUMNS.findIndex((c, i) => head[i] !== c);
  if (drift >= 0) {
    return NextResponse.json(
      { ok: false, error: `Propel changed its template (column ${drift + 1} is "${head[drift]}", expected "${PROPEL_STUDENT_COLUMNS[drift]}"). Nothing was filled.` },
      { status: 409 },
    );
  }

  const sis = await fetchSisFromDb();
  if (!sis.ok) return NextResponse.json({ ok: false, error: "Could not read the student roster — try again." }, { status: 503 });
  const masters = auth.ctx.masters;
  const { rows, skipped } = buildPropelStudentRows({
    students: sis.bundle.students,
    households: sis.bundle.households,
    classes: masters.classes ?? [],
    sections: masters.sections ?? [],
    academicYearCode: staffWorkingYear(auth.ctx),
  });
  rows.forEach((r, i) => {
    const row = sheet.getRow(i + 2);
    r.forEach((v, c) => {
      // Text, never numbers: admission codes, phones and pincodes keep their digits.
      row.getCell(c + 1).value = v;
      row.getCell(c + 1).numFmt = "@";
    });
    row.commit();
  });
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  return NextResponse.json({
    ok: true,
    file: out.toString("base64"),
    fileName: `propel-students-${new Date().toISOString().slice(0, 10)}.xlsx`,
    count: rows.length,
    skipped,
  });
}
