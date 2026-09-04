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
import { normalizeDateField, excelSerialToIso } from "@/lib/studentImport";

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

// Already ISO, and Excel serials, are left alone.
check("ISO passes through", normalizeDateField("2015-01-15"), "2015-01-15");
check("ISO with time", normalizeDateField("2015-01-15T00:00:00Z"), "2015-01-15");
check("two-digit year", normalizeDateField("23/11/19"), "2019-11-23");
check("excel serial", normalizeDateField("43831"), excelSerialToIso(43831));
check("blank", normalizeDateField("   "), "");
check("unparseable is returned as-is", normalizeDateField("not a date"), "not a date");

if (failures) {
  console.error(`studentImport selftest: ${failures} failure(s)`);
  process.exit(1);
}
console.log("studentImport selftest: ok");
