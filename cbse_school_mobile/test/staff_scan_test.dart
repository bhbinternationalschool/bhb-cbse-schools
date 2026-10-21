import "dart:io";

import "package:cbse_school_mobile/features/staff/staff_scan_rules.dart";
import "package:flutter_test/flutter_test.dart";

void main() {
  group("visitor mobile (optional, Indian 10-digit)", () {
    test("blank is fine", () {
      expect(indianMobileError(""), isNull);
      expect(indianMobileError("   "), isNull);
    });
    test("accepts +91 / 0 / spaces", () {
      expect(indianMobileError("+91 98765 43210"), isNull);
      expect(indianMobile10("+91 98765 43210"), "9876543210");
      expect(indianMobile10("09876543210"), "9876543210");
    });
    test("refuses short, letters and non-mobile starts", () {
      expect(indianMobileError("12345"), isNotNull);
      expect(indianMobileError("98765abc10"), isNotNull);
      expect(indianMobileError("5876543210"), contains("6, 7, 8 or 9"));
    });
  });

  group("number of people", () {
    test("blank means one", () => expect(peopleCountOf(""), 1));
    test("whole numbers 1–99", () {
      expect(peopleCountOf("3"), 3);
      expect(peopleCountOf("0"), isNull);
      expect(peopleCountOf("-2"), isNull);
      expect(peopleCountOf("1.5"), isNull);
      expect(peopleCountOf("100"), isNull);
    });
  });

  group("number plate", () {
    test("normalises the printed form", () {
      expect(normalizePlate("up32ab1234"), "UP 32 AB 1234");
      expect(normalizePlate("UP-32-AB-1234"), "UP 32 AB 1234");
      expect(normalizePlate("22bh1234aa"), "22 BH 1234 AA");
    });
    test("refuses what is not a plate, never swaps look-alikes", () {
      expect(normalizePlate("XX32AB1234"), "");
      expect(normalizePlate("UPO2AB1234"), "");
      expect(normalizePlate("UP32AB0000"), "");
    });
  });

  group("ID reading", () {
    test("parses the server's masked reading", () {
      final r = VisitorIdScan.fromJson({
        "readable": true,
        "note": "",
        "name": "Ramesh Kumar",
        "idNumber": "XXXX XXXX 0123",
        "idProofNote": "Aadhaar XXXX XXXX 0123",
        "address": "Ahirauli",
      });
      expect(r.readable, isTrue);
      expect(r.idProofNote, "Aadhaar XXXX XXXX 0123");
    });
    test("garbage is unreadable with empty fields", () {
      final r = VisitorIdScan.fromJson({"readable": "yes", "name": 42});
      expect(r.readable, isFalse);
      expect(r.name, "");
    });
  });

  group("fuel bill prefill", () {
    const empty = {"quantity": "", "amount": "", "odometer": "", "note": ""};

    test("fills empty fields and marks them", () {
      final p = FuelBillPrefill.from(
        FuelBillScan.fromJson({
          "readable": true,
          "note": "",
          "amountRupees": 2841.6,
          "date": "2026-10-20",
          "quantity": 30,
          "ratePerUnit": 94.72,
          "odometerKm": 45231,
          "vendor": "HP Ahirauli",
          "billNo": "4521",
          "warnings": <String>[],
        }),
        current: empty,
        entryDate: "2026-10-20",
        unitShort: "L",
      );
      expect(p.values["quantity"], "30");
      expect(p.values["amount"], "2841.6");
      expect(p.values["odometer"], "45231");
      expect(p.values["note"], "HP Ahirauli · Bill 4521 · ₹94.72/L");
      expect(p.filled, {"quantity", "amount", "odometer", "note"});
      expect(p.notes, isEmpty);
    });

    test("never overwrites what the driver typed", () {
      final p = FuelBillPrefill.from(
        FuelBillScan.fromJson({
          "readable": true,
          "amountRupees": 2841.6,
          "quantity": 30,
        }),
        current: {...empty, "amount": "2800"},
        entryDate: "2026-10-20",
        unitShort: "L",
      );
      expect(p.values.containsKey("amount"), isFalse);
      expect(p.filled, {"quantity"});
    });

    test("a different bill date is flagged, not applied", () {
      final p = FuelBillPrefill.from(
        FuelBillScan.fromJson({
          "readable": true,
          "amountRupees": 500,
          "date": "2026-10-18",
          "warnings": [
            "The total does not equal quantity × rate — check the bill.",
          ],
        }),
        current: empty,
        entryDate: "2026-10-20",
        unitShort: "L",
      );
      expect(p.notes.first, contains("2026-10-18"));
      expect(p.notes, hasLength(2));
    });

    test("unreadable / low confidence leaves everything empty with a note", () {
      final p = FuelBillPrefill.from(
        FuelBillScan.fromJson({
          "readable": false,
          "note": "The bill was not clear enough to read safely",
          "amountRupees": 2841.6,
        }),
        current: empty,
        entryDate: "2026-10-20",
        unitShort: "L",
      );
      expect(p.values, isEmpty);
      expect(p.filled, isEmpty);
      expect(p.notes.single, contains("not clear"));
    });

    test("strings where numbers belong are not used", () {
      final p = FuelBillPrefill.from(
        FuelBillScan.fromJson({
          "readable": true,
          "amountRupees": "lots",
          "quantity": null,
        }),
        current: empty,
        entryDate: "2026-10-20",
        unitShort: "L",
      );
      expect(p.values, isEmpty);
    });
  });

  test("the parent app never gains the camera permission", () {
    final parent = File(
      "android/app/src/parent/AndroidManifest.xml",
    ).readAsStringSync();
    expect(
      RegExp(
        r'android\.permission\.CAMERA"\s+tools:node="remove"',
      ).hasMatch(parent),
      isTrue,
    );
  });
}
