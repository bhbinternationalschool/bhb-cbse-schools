import assert from "node:assert/strict";
import {
  ifscFormatOk,
  ifscSummary,
  isbnChecksumOk,
  normalizeIfsc,
  normalizeIsbn,
  normalizePin,
  parseIfscResponse,
  parseOpenLibraryResponse,
  parsePinResponse,
  pinFormatOk,
  yearFrom,
} from "./openLookups";

console.log("openLookups.selftest.ts");

/* ── IFSC ────────────────────────────────────────────────────────────── */

assert.equal(normalizeIfsc(" ubin054 8847 "), "UBIN0548847");
assert.ok(ifscFormatOk("ubin0548847"), "lower case is still a valid code");
assert.ok(ifscFormatOk("UBIN0548847"));
assert.equal(ifscFormatOk("UBIN1548847"), false, "fifth character must be 0");
assert.equal(ifscFormatOk("UBI0548847"), false, "too short");
assert.equal(ifscFormatOk("UBIN05488471"), false, "too long");
assert.equal(ifscFormatOk(""), false);

{
  // The documented response, upper-case keys.
  const d = parseIfscResponse({
    IFSC: "UBIN0548847",
    BANK: "Union Bank of India",
    BRANCH: "MURDAHA BAZAR",
    CENTRE: "VARANASI",
    DISTRICT: "VARANASI",
    STATE: "UTTAR PRADESH",
    NEFT: true,
    RTGS: true,
    IMPS: false,
  });
  assert.ok(d);
  if (!d) throw new Error();
  assert.equal(d.bank, "Union Bank of India");
  assert.equal(d.city, "VARANASI");
  assert.equal(d.neft, true);
  assert.equal(d.imps, false);
  assert.equal(
    ifscSummary(d),
    "Union Bank of India — MURDAHA BAZAR · VARANASI · UTTAR PRADESH",
  );
}
{
  // Shape drift must degrade, not crash: lower-case keys, string booleans,
  // and CITY absent so CENTRE has to stand in.
  const d = parseIfscResponse({ ifsc: "SBIN0001234", bank: "State Bank of India", CENTRE: "LUCKNOW", NEFT: "true" });
  assert.ok(d && d.bank === "State Bank of India" && d.city === "LUCKNOW" && d.neft === true);
}
assert.equal(parseIfscResponse(null), null);
assert.equal(parseIfscResponse("<html>502</html>"), null, "an error page is not a record");
assert.equal(parseIfscResponse({}), null, "neither IFSC nor BANK = not a record");

/* ── PIN ─────────────────────────────────────────────────────────────── */

assert.equal(normalizePin("221 001"), "221001");
assert.equal(normalizePin("2210012345"), "221001", "capped at six");
assert.ok(pinFormatOk("221001"));
assert.equal(pinFormatOk("021001"), false, "an Indian PIN never starts with 0");
assert.equal(pinFormatOk("22100"), false);

{
  // The service answers with a single-element ARRAY — the shape most callers
  // get wrong, so it is pinned here.
  const d = parsePinResponse([
    {
      Message: "Number of pincode(s) found:3",
      Status: "Success",
      PostOffice: [
        { Name: "Varanasi Cantt", District: "Varanasi", State: "Uttar Pradesh", Pincode: "221002" },
        { Name: "Nadesar", District: "Varanasi", State: "Uttar Pradesh", Pincode: "221002" },
        { Name: "Nadesar", District: "Varanasi", State: "Uttar Pradesh", Pincode: "221002" },
      ],
    },
  ]);
  assert.ok(d);
  if (!d) throw new Error();
  assert.equal(d.district, "Varanasi");
  assert.equal(d.state, "Uttar Pradesh");
  assert.deepEqual(d.localities, ["Varanasi Cantt", "Nadesar"], "de-duplicated");
}
// An unknown PIN comes back 200 with Status "Error" — a normal answer.
assert.equal(parsePinResponse([{ Status: "Error", Message: "No records found", PostOffice: null }]), null);
assert.equal(parsePinResponse([{ Status: "Success", PostOffice: [] }]), null, "success with nothing in it");
assert.equal(parsePinResponse([]), null);
assert.equal(parsePinResponse(null), null);

/* ── ISBN ────────────────────────────────────────────────────────────── */

assert.equal(normalizeIsbn("978-0-14-032872-1"), "9780140328721");
assert.equal(normalizeIsbn("0-19-853453-x"), "019853453X");

// Real check digits.
assert.ok(isbnChecksumOk("9780140328721"), "ISBN-13");
assert.ok(isbnChecksumOk("0451526538"), "ISBN-10");
assert.ok(isbnChecksumOk("043942089X"), "ISBN-10 ending in X");
// One transposed digit must fail — this is the whole point of the check.
assert.equal(isbnChecksumOk("9780140328712"), false);
assert.equal(isbnChecksumOk("0451526539"), false);
assert.equal(isbnChecksumOk("X451526538"), false, "X is only legal as the check digit");
assert.equal(isbnChecksumOk("978014032872X"), false, "no X in an ISBN-13");
assert.equal(isbnChecksumOk("12345"), false, "wrong length");
assert.equal(isbnChecksumOk(""), false);

assert.equal(yearFrom("October 1, 1998"), "1998");
assert.equal(yearFrom("1998-10"), "1998");
assert.equal(yearFrom("n.d."), "");
assert.equal(yearFrom(undefined), "");

{
  const d = parseOpenLibraryResponse(
    {
      "ISBN:9780140328721": {
        title: "Fantastic Mr Fox",
        subtitle: "A Puffin Book",
        authors: [{ name: "Roald Dahl" }, { name: "Quentin Blake" }],
        publishers: [{ name: "Puffin" }],
        publish_date: "October 1, 1998",
        cover: { small: "s.jpg", medium: "m.jpg", large: "l.jpg" },
      },
    },
    "978-0-14-032872-1",
  );
  assert.ok(d);
  if (!d) throw new Error();
  assert.equal(d.title, "Fantastic Mr Fox: A Puffin Book");
  assert.equal(d.author, "Roald Dahl, Quentin Blake");
  assert.equal(d.publisher, "Puffin");
  assert.equal(d.year, "1998");
  assert.equal(d.coverUrl, "m.jpg", "medium preferred");
  assert.equal(d.isbn, "9780140328721", "normalised, not the string typed");
}
// Open Library returns {} for a book it does not hold — common for Indian
// school publishers, and not an error.
assert.equal(parseOpenLibraryResponse({}, "9780140328721"), null);
// A record with no title is not usable, whatever else it carries.
assert.equal(parseOpenLibraryResponse({ "ISBN:x": { authors: [{ name: "X" }] } }, "x"), null);
assert.equal(parseOpenLibraryResponse([], "x"), null, "an array is not the documented shape");
assert.equal(parseOpenLibraryResponse(null, "x"), null);
{
  // Missing cover / authors / publishers must give empty strings, never
  // "undefined" typed into a catalogue row.
  const d = parseOpenLibraryResponse({ "ISBN:x": { title: "Bare" } }, "0451526538");
  assert.ok(d);
  if (!d) throw new Error();
  assert.deepEqual([d.author, d.publisher, d.year, d.coverUrl], ["", "", "", ""]);
}

console.log("OK — openLookups.selftest.ts");
