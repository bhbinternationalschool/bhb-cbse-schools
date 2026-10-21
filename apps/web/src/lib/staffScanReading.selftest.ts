/**
 * Gate + log-book photo readings: what a reply may fill, and what stays empty.
 * Run: npx tsx src/lib/staffScanReading.selftest.ts
 */
import assert from "node:assert/strict";
import {
  STAFF_SCAN_MAX_BASE64,
  buildStaffScanSystem,
  cleanIndianMobile,
  cleanPeopleCount,
  cleanStaffScanInput,
  cleanVehicleNo,
  maskAadhaarDigits,
  maskAadhaarInText,
  normalizePlate,
  parseFuelBillReading,
  parsePlateReading,
  parseStaffScanReading,
  parseVisitorIdReading,
  staffScanAuditOutput,
} from "./staffScanReading";
import { normalizeVisitorState, peopleCountOf } from "./visitors";

console.log("staffScanReading.selftest.ts");

const TODAY = "2026-10-20";
const j = (o: unknown) => JSON.stringify(o);

/* ── mobile: optional, Indian, 10 digits ──────────────────────────────── */
{
  assert.deepEqual(cleanIndianMobile(""), { ok: true, mobile: "" }, "blank is allowed");
  assert.deepEqual(cleanIndianMobile("  "), { ok: true, mobile: "" });
  assert.deepEqual(cleanIndianMobile("98765 43210"), { ok: true, mobile: "9876543210" });
  assert.deepEqual(cleanIndianMobile("+91-98765-43210"), { ok: true, mobile: "9876543210" });
  assert.deepEqual(cleanIndianMobile("09876543210"), { ok: true, mobile: "9876543210" });
  assert.equal(cleanIndianMobile("12345").ok, false, "too short");
  assert.equal(cleanIndianMobile("5876543210").ok, false, "Indian mobiles start 6–9");
  assert.equal(cleanIndianMobile("98765432101").ok, false, "11 digits that are not 0-prefixed");
  assert.equal(cleanIndianMobile("98765abc10").ok, false, "letters");
}

/* ── number of people: whole, ≥ 1, default 1 ──────────────────────────── */
{
  assert.deepEqual(cleanPeopleCount(undefined), { ok: true, count: 1 }, "absent → 1");
  assert.deepEqual(cleanPeopleCount(""), { ok: true, count: 1 }, "blank → 1");
  assert.deepEqual(cleanPeopleCount("3"), { ok: true, count: 3 });
  assert.deepEqual(cleanPeopleCount(2), { ok: true, count: 2 });
  assert.equal(cleanPeopleCount(0).ok, false, "zero people refused");
  assert.equal(cleanPeopleCount("-1").ok, false, "negative refused");
  assert.equal(cleanPeopleCount("2.5").ok, false, "fractions refused");
  assert.equal(cleanPeopleCount("two").ok, false, "words refused");
  assert.equal(cleanPeopleCount(500).ok, false, "absurd counts refused");
  assert.equal(peopleCountOf(undefined), 1, "an old entry counts as one person");
  assert.equal(peopleCountOf("junk"), 1);
}

/* ── Aadhaar masking (UIDAI: last four only) ──────────────────────────── */
{
  assert.equal(maskAadhaarDigits("234567890123"), "XXXX XXXX 0123");
  assert.equal(maskAadhaarDigits("12"), "");
  assert.equal(maskAadhaarInText("Aadhaar 2345 6789 0123"), "Aadhaar XXXX XXXX 0123");
  assert.equal(maskAadhaarInText("aadhar 2345-6789-0123 shown"), "aadhar XXXX XXXX 0123 shown");
  assert.equal(maskAadhaarInText("234567890123"), "XXXX XXXX 0123");
  assert.equal(maskAadhaarInText("VID 9123 4567 8901 2345"), "VID XXXX XXXX XXXX 2345", "a 16-digit VID is masked too");
  assert.equal(maskAadhaarInText("DL UP3220190001234"), "DL UP3220190001234", "13-digit licence tails are not Aadhaar");
  assert.equal(maskAadhaarInText("Aadhaar XXXX XXXX 0123"), "Aadhaar XXXX XXXX 0123", "idempotent");
  assert.equal(maskAadhaarInText("mobile 9876543210"), "mobile 9876543210", "a mobile is not masked");
}

/* ── number plates ────────────────────────────────────────────────────── */
{
  assert.equal(normalizePlate("up32ab1234"), "UP 32 AB 1234");
  assert.equal(normalizePlate("UP-32-AB-1234"), "UP 32 AB 1234");
  assert.equal(normalizePlate(" up 32 ab 1234 "), "UP 32 AB 1234");
  assert.equal(normalizePlate("UP65T1234"), "UP 65 T 1234");
  assert.equal(normalizePlate("DL1CAB1234"), "DL 1 CAB 1234");
  assert.equal(normalizePlate("UP321234"), "UP 32 1234", "no series letters");
  assert.equal(normalizePlate("22BH1234AA"), "22 BH 1234 AA", "Bharat series");
  assert.equal(normalizePlate("XX32AB1234"), "", "unknown state code");
  assert.equal(normalizePlate("UP32AB0000"), "", "all-zero number");
  assert.equal(normalizePlate("UPO2AB1234"), "", "no look-alike swaps (O is not 0)");
  assert.equal(normalizePlate("hello"), "");
  assert.equal(cleanVehicleNo("up32ab1234"), "UP 32 AB 1234");
  assert.equal(cleanVehicleNo("tractor no plate"), "TRACTOR NO PLATE", "typed text kept, upper-cased");
  assert.equal(cleanVehicleNo(""), "");
}

/* ── request body ─────────────────────────────────────────────────────── */
{
  const kinds = ["visitor_id", "vehicle_plate"] as const;
  assert.equal(typeof cleanStaffScanInput(null, kinds), "string");
  assert.match(cleanStaffScanInput({ kind: "fuel_bill", imageBase64: "AAAA" }, kinds) as string, /Unknown kind/, "a kind this route does not serve");
  assert.match(cleanStaffScanInput({ kind: "visitor_id", imageBase64: "" }, kinds) as string, /empty/);
  assert.match(cleanStaffScanInput({ kind: "visitor_id", imageBase64: "AAAA", mimeType: "application/pdf" }, kinds) as string, /JPG or PNG/);
  assert.match(
    cleanStaffScanInput({ kind: "visitor_id", imageBase64: "A".repeat(STAFF_SCAN_MAX_BASE64 + 1) }, kinds) as string,
    /too large/,
  );
  const ok = cleanStaffScanInput({ kind: "visitor_id", imageBase64: "data:image/jpeg;base64,QUJD" }, kinds);
  assert.ok(typeof ok === "object" && ok.base64 === "QUJD" && ok.mimeType === "image/jpeg", "data: prefix stripped");
}

/* ── ID card ──────────────────────────────────────────────────────────── */
{
  const r = parseVisitorIdReading(j({ readable: true, confidence: "high", idType: "aadhaar", name: "Ramesh Kumar", idNumber: "2345 6789 0123", address: "Village Ahirauli, Varanasi 221005" }))!;
  assert.equal(r.readable, true);
  assert.equal(r.name, "Ramesh Kumar");
  assert.equal(r.idNumber, "XXXX XXXX 0123", "a full Aadhaar from the model is masked");
  assert.equal(r.idProofNote, "Aadhaar XXXX XXXX 0123");
  assert.equal(r.address, "Village Ahirauli, Varanasi 221005");
  assert.ok(!/234567890123|2345 6789 0123/.test(JSON.stringify(r)), "the full number is nowhere in the reading");
  assert.equal(staffScanAuditOutput({ kind: "visitor_id", reading: r }), "idType=aadhaar", "the audit row keeps the type only");

  const last4 = parseVisitorIdReading(j({ readable: true, confidence: "medium", idType: "aadhaar", name: "Sita Devi", idNumber: "0123" }))!;
  assert.equal(last4.idNumber, "XXXX XXXX 0123");
  const xs = parseVisitorIdReading(j({ readable: true, confidence: "high", idType: "aadhaar", name: "Sita Devi", idNumber: "XXXX XXXX 0123" }))!;
  assert.equal(xs.idNumber, "XXXX XXXX 0123");

  const bad = parseVisitorIdReading(j({ readable: true, confidence: "high", idType: "aadhaar", name: "Sita Devi", idNumber: "2345678" }))!;
  assert.equal(bad.idNumber, "", "a 7-digit Aadhaar is not kept");
  assert.equal(bad.idProofNote, "Aadhaar", "the type is still known");
  assert.match(bad.note, /ID number/);

  const addr = parseVisitorIdReading(j({ readable: true, confidence: "high", idType: "other", name: "Sita Devi", idNumber: "", address: "C/o 2345 6789 0123 Ahirauli" }))!;
  assert.ok(!/2345 6789 0123/.test(addr.address), "an Aadhaar inside the address is masked");

  const pan = parseVisitorIdReading(j({ readable: true, confidence: "high", idType: "pan", name: "Amit Singh", idNumber: "abcde1234f" }))!;
  assert.equal(pan.idNumber, "ABCDE1234F");
  assert.equal(pan.idProofNote, "PAN ABCDE1234F");
  const badPan = parseVisitorIdReading(j({ readable: true, confidence: "high", idType: "pan", name: "Amit Singh", idNumber: "ABC1234" }))!;
  assert.equal(badPan.idNumber, "");

  const dl = parseVisitorIdReading(j({ readable: true, confidence: "high", idType: "driving licence", name: "Amit Singh", idNumber: "UP32 20190001234" }))!;
  assert.equal(dl.idType, "driving_licence");
  assert.equal(dl.idNumber, "UP3220190001234");

  const junkName = parseVisitorIdReading(j({ readable: true, confidence: "high", idType: "pan", name: "1234 ####", idNumber: "ABCDE1234F" }))!;
  assert.equal(junkName.name, "", "a name made of digits is not a name");

  // Low confidence / unreadable / garbage → empty, with a note, never a guess.
  const low = parseVisitorIdReading(j({ readable: true, confidence: "low", idType: "aadhaar", name: "Ramesh Kumar", idNumber: "2345 6789 0123" }))!;
  assert.equal(low.readable, false);
  assert.equal(low.name, "");
  assert.equal(low.idNumber, "");
  assert.ok(low.note.length > 0, "the guard is told why");
  const noConf = parseVisitorIdReading(j({ readable: true, idType: "pan", name: "Amit", idNumber: "ABCDE1234F" }))!;
  assert.equal(noConf.readable, false, "no stated confidence is treated as low");
  const unread = parseVisitorIdReading(j({ readable: false, unreadableReason: "This is a photo of a cat" }))!;
  assert.equal(unread.readable, false);
  assert.equal(unread.note, "This is a photo of a cat");
  assert.equal(parseVisitorIdReading("I am sorry, I cannot help with that."), null, "prose is not a reading");
  assert.equal(parseVisitorIdReading("{\"readable\": tru"), null, "truncated JSON is not a reading");
  const nothing = parseVisitorIdReading(j({ readable: true, confidence: "high", idType: "", name: "", idNumber: "", address: "" }))!;
  assert.equal(nothing.readable, false, "an all-empty reply is unreadable, not a blank card");
  const fenced = parseVisitorIdReading("```json\n" + j({ readable: true, confidence: "high", idType: "voter_id", name: "Amit Singh", idNumber: "ABC1234567" }) + "\n```")!;
  assert.equal(fenced.idNumber, "ABC1234567", "a fenced reply is still read");
}

/* ── plate ────────────────────────────────────────────────────────────── */
{
  assert.deepEqual(parsePlateReading(j({ readable: true, confidence: "high", plate: "UP32AB1234" })), { readable: true, note: "", plate: "UP 32 AB 1234" });
  const notPlate = parsePlateReading(j({ readable: true, confidence: "high", plate: "SCHOOL BUS" }))!;
  assert.equal(notPlate.readable, false);
  assert.equal(notPlate.plate, "");
  const low = parsePlateReading(j({ readable: true, confidence: "low", plate: "UP32AB1234" }))!;
  assert.equal(low.plate, "", "a low-confidence plate is not filled in");
  assert.equal(parsePlateReading("garbage"), null);
}

/* ── fuel bill ────────────────────────────────────────────────────────── */
{
  const good = parseFuelBillReading(j({
    readable: true, confidence: "high", amountRupees: "₹ 2,841.60", date: "2026-10-19", quantity: 30, ratePerUnit: 94.72,
    odometerKm: "45231", vendor: "HP Petrol Pump Ahirauli", billNo: "INV-4521",
  }), TODAY)!;
  assert.equal(good.readable, true);
  assert.equal(good.amountRupees, 2841.6);
  assert.equal(good.quantity, 30);
  assert.equal(good.ratePerUnit, 94.72);
  assert.equal(good.odometerKm, 45231);
  assert.equal(good.date, "2026-10-19");
  assert.equal(good.vendor, "HP Petrol Pump Ahirauli");
  assert.equal(good.billNo, "INV-4521");
  assert.deepEqual(good.warnings, []);
  assert.equal(good.note, "");

  const mismatch = parseFuelBillReading(j({ readable: true, confidence: "high", amountRupees: 3500, quantity: 30, ratePerUnit: 94.72 }), TODAY)!;
  assert.equal(mismatch.amountRupees, 3500, "kept as read …");
  assert.equal(mismatch.warnings.length, 1, "… but flagged");

  const odd = parseFuelBillReading(j({
    readable: true, confidence: "medium", amountRupees: 2841.6, date: "2026-11-05", quantity: 9999, ratePerUnit: 3, odometerKm: -5, billNo: "<script>",
  }), TODAY)!;
  assert.equal(odd.date, "", "a future date is a misreading");
  assert.equal(odd.quantity, null, "an impossible quantity is not kept");
  assert.equal(odd.ratePerUnit, null, "₹3/L is not a fuel rate");
  assert.equal(odd.odometerKm, null);
  assert.equal(odd.billNo, "");
  assert.match(odd.note, /quantity/, "the missing quantity is named");
  assert.equal(parseFuelBillReading(j({ readable: true, confidence: "high", date: "2026-02-30" }), TODAY)!.date, "", "Feb 30 is not a date");

  const derived = parseFuelBillReading(j({ readable: true, confidence: "high", amountRupees: 2841.6, ratePerUnit: 94.72 }), TODAY)!;
  assert.equal(derived.quantity, null, "quantity is never derived from amount ÷ rate");

  const low = parseFuelBillReading(j({ readable: true, confidence: "low", amountRupees: 2841.6, quantity: 30 }), TODAY)!;
  assert.equal(low.readable, false);
  assert.equal(low.amountRupees, null);
  assert.equal(low.quantity, null);
  assert.ok(low.note.length > 0);
  assert.equal(parseFuelBillReading("", TODAY), null);
  assert.equal(parseFuelBillReading("[1,2,3]", TODAY), null, "an array is not a reading");
  const allNull = parseFuelBillReading(j({ readable: true, confidence: "high", amountRupees: null, quantity: "abc" }), TODAY)!;
  assert.equal(allNull.readable, false, "nothing usable → unreadable");
}

/* ── dispatch + prompts ───────────────────────────────────────────────── */
{
  assert.equal(parseStaffScanReading("vehicle_plate", j({ readable: true, confidence: "high", plate: "UP32AB1234" }), TODAY)!.kind, "vehicle_plate");
  assert.match(buildStaffScanSystem("visitor_id"), /LAST FOUR digits/, "the prompt asks for the last four only");
  assert.match(buildStaffScanSystem("fuel_bill"), /Never guess/);
}

/* ── the visitor log keeps the new fields through the desk's normaliser ─ */
{
  const raw = {
    version: 1,
    visitorLog: [{
      id: "visit_abcdefgh", visitorName: "Ramesh", mobile: "", purpose: "meeting", personToMeet: "", inTime: "2026-10-20T03:00:00.000Z",
      outTime: null, idProofNote: "Aadhaar 2345 6789 0123", qrPayload: "", createdBy: "gate", createdAt: "2026-10-20T03:00:00.000Z",
      peopleCount: 3, vehicleNo: "up32ab1234", address: "Ahirauli",
    }],
    gatePasses: [],
  };
  const v = normalizeVisitorState(raw).visitorLog[0]!;
  assert.equal(v.peopleCount, 3, "people count survives a desk push");
  assert.equal(v.vehicleNo, "UP 32 AB 1234", "vehicle survives, normalised");
  assert.equal(v.address, "Ahirauli");
  assert.equal(v.idProofNote, "Aadhaar XXXX XXXX 0123", "a full Aadhaar typed into the note is masked on the way in");
  const again = normalizeVisitorState({ ...raw, visitorLog: [v] }).visitorLog[0]!;
  assert.deepEqual(again, v, "normalising twice changes nothing");
  const old = normalizeVisitorState({ ...raw, visitorLog: [{ ...raw.visitorLog[0], peopleCount: undefined, vehicleNo: undefined, address: undefined }] }).visitorLog[0]!;
  assert.equal(old.peopleCount, 1, "an entry from before the field is one person");
  assert.equal(old.vehicleNo, undefined);
}

console.log("  ok");
