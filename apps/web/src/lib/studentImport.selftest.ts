/**
 * Date parsing on the student import.
 *
 * This exists because of a real incident. The import's date parser used to read
 *
 *     const day   = a > 12 ? a : b > 12 ? b : a;
 *     const month = a > 12 ? b : a;
 *
 * so whenever NEITHER number exceeded 12, both day and month came out as `a`
 * and the second number was thrown away: "08/04/2020" became 2020-08-08. It
 * rewrote the day of 296 student birth dates — about 42% of the roll — and left
 * no trace, because the result is always a valid date that merely happens to
 * have its day equal to its month.
 *
 * Found on 2026-09-04 by comparing the SIS against class attendance registers,
 * which carry the true dates. Of 213 pupils checked: every one of the 120 whose
 * birth day fell after the 12th was correct, and 82 of the 93 whose birth day
 * fell on or before the 12th were wrong.
 */
import {
  normalizeDateField,
  excelSerialToIso,
  detectDateOrder,
  rowsToFieldMaps,
  workbookToStudentImportCsv,
} from "@/lib/studentImport";
import * as XLSX from "xlsx";
import { formatDobLong } from "@/lib/dobFormat";

let failures = 0;
function check(label: string, got: string, want: string) {
  if (got !== want) {
    failures++;
    console.error(`  FAIL ${label}\n       got  ${got}\n       want ${want}`);
  }
}

// Unambiguous: one of the numbers is above 12, so it must be the day.
check("D/M/Y, day 23", normalizeDateField("23/11/2019"), "2019-11-23");
check("M/D/Y, day 23", normalizeDateField("11/23/2019"), "2019-11-23");
check("D/M/Y, day 18", normalizeDateField("18/05/2020"), "2020-05-18");
check("M/D/Y, day 31", normalizeDateField("12/31/2021"), "2021-12-31");
check("dashes too", normalizeDateField("23-11-2019"), "2019-11-23");

// The regression itself. Both numbers are 12 or under, so the value is
// genuinely ambiguous and we take D/M/Y. What matters is that BOTH numbers
// survive: the old parser produced 2020-08-08 here, discarding the 4.
check("ambiguous keeps both numbers", normalizeDateField("08/04/2020"), "2020-04-08");
check("ambiguous, 12/09", normalizeDateField("12/09/2019"), "2019-09-12");
check("ambiguous, 09/12", normalizeDateField("09/12/2013"), "2013-12-09");
check("ambiguous, 05/11", normalizeDateField("05/11/2020"), "2020-11-05");

// No ambiguous input may ever come back with day equal to month unless it was
// written that way. This is the shape of the original bug, stated directly.
for (const a of [1, 3, 4, 5, 7, 8, 9, 10, 11, 12]) {
  for (const b of [1, 2, 6, 9, 11, 12]) {
    if (a === b) continue;
    const iso = normalizeDateField(`${String(a).padStart(2, "0")}/${String(b).padStart(2, "0")}/2020`);
    const [, mm, dd] = iso.split("-");
    if (mm === dd) {
      failures++;
      console.error(`  FAIL ${a}/${b}/2020 collapsed to ${iso} — day took the month's value`);
    }
  }
}

// The spelled-out form our own export writes must round-trip exactly, and must
// never fall through to the ambiguous numeric branch.
check("long form, August", normalizeDateField("04-August-2020"), "2020-08-04");
check("long form, short month", normalizeDateField("04-Aug-2020"), "2020-08-04");
check("long form, spaces", normalizeDateField("9 December 2019"), "2019-12-09");
check("long form, day > 12", normalizeDateField("23-November-2019"), "2019-11-23");
check("round trip", normalizeDateField(formatDobLong("2013-09-12")), "2013-09-12");
check("round trip, ambiguous day", normalizeDateField(formatDobLong("2020-08-04")), "2020-08-04");
check("formatDobLong output", formatDobLong("2020-08-04"), "04-August-2020");
check("formatDobLong leaves rubbish alone", formatDobLong("not a date"), "not a date");

// Already ISO, and Excel serials, are left alone.
check("ISO passes through", normalizeDateField("2015-01-15"), "2015-01-15");
check("ISO with time", normalizeDateField("2015-01-15T00:00:00Z"), "2015-01-15");
check("two-digit year", normalizeDateField("23/11/19"), "2019-11-23");
check("excel serial", normalizeDateField("43831"), excelSerialToIso(43831));
check("blank", normalizeDateField("   "), "");
check("unparseable is returned as-is", normalizeDateField("not a date"), "not a date");

// ── The admission-date incident (2026-10-07) ──────────────────────────────
//
// The same parser wrote sis_students.joined_on, and the old ERP's file was
// M/D/Y: 382 join dates came out with day equal to month ("3/10/23" →
// 2023-03-03). After the 4 Sep fix the same file would have SWAPPED them
// instead (→ 2023-10-03), which leaves no signature at all. So: read the
// column's convention, and read Excel date cells as dates, not as text.

// A column decides its own convention from its unambiguous values.
check("order: M/D/Y column", detectDateOrder(["3/10/23", "4/29/25", ""]) ?? "null", "MDY");
check("order: D/M/Y column", detectDateOrder(["10/3/23", "29/4/25"]) ?? "null", "DMY");
check("order: no evidence", detectDateOrder(["3/10/23", "4/4/23"]) ?? "null", "null");
check("order: contradicts itself", detectDateOrder(["29/4/25", "4/29/25"]) ?? "null", "null");
check("order: ISO ignored", detectDateOrder(["2023-03-10", "2025-04-29"]) ?? "null", "null");
check("M/D/Y ambiguous", normalizeDateField("3/10/23", "MDY"), "2023-03-10");
check("M/D/Y unambiguous unaffected", normalizeDateField("4/29/25", "MDY"), "2025-04-29");
check("D/M/Y forced still reads day>12", normalizeDateField("29/4/25", "MDY"), "2025-04-29");

// The old ERP's CSV, as it was really imported (header on row 4, M/D/YY).
{
  const csv = [
    "BHB International School,,,,",
    "Student Report(2023-2024),,,,",
    "Class -Nursery A,,,,",
    "Sr,Student Name,AdmissionNumber,Admission Date,Date of birth",
    "1,AYUSH SINGH,BHB-21/2023,3/10/23,10/11/19",
    "2,SAGAR RAJBHAR,BHB-43/2023,4/17/23,5/4/15",
    "3,PIYUSH PATEL,BHB-79/2023,7/1/23,1/3/17",
  ].join("\n");
  const { rows } = rowsToFieldMaps(csv);
  const got = rows.map((r) => `${r.fields.joinedOn}|${r.fields.dob}`).join(" ");
  check(
    "old-ERP CSV reads M/D/Y per column",
    got,
    "2023-03-10|2019-10-11 2023-04-17|2015-05-04 2023-07-01|2017-01-03",
  );
}

// The old ERP's .xlsx: real date cells, number format m/d/yy. The CSV we make
// from it must carry ISO dates, so nothing downstream has to guess.
async function xlsxCase() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["BHB International School"],
    ["Student Report(2023-2024)"],
    ["Class -Nursery A"],
    ["Sr", "Student Name", "AdmissionNumber", "Admission Date", "Date of birth"],
    [1, "AYUSH SINGH", "BHB-21/2023", 44995, 43749], // 10 Mar 2023, 11 Oct 2019
    [2, "PIYUSH PATEL", "BHB-79/2023", 45108, 42738], // 1 Jul 2023, 3 Jan 2017
  ]);
  for (const a of ["D5", "E5", "D6", "E6"]) {
    ws[a]!.z = "m/d/yy";
    delete ws[a]!.w;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Table");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const { csv, detectedSession } = await workbookToStudentImportCsv(buf);
  check("xlsx session", detectedSession, "2023-24");
  const { rows } = rowsToFieldMaps(csv);
  check(
    "xlsx date cells become ISO",
    rows.map((r) => `${r.fields.joinedOn}|${r.fields.dob}`).join(" "),
    "2023-03-10|2019-10-11 2023-07-01|2017-01-03",
  );
}

void xlsxCase().then(() => {
  if (failures) {
    console.error(`studentImport selftest: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("studentImport selftest: ok");
});
