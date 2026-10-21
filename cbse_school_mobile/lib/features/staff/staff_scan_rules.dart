/// Field rules for the gate check-in and the photo readings the staff app
/// pre-fills from (2026-10-20). Pure — no Flutter, no network — so the rules
/// have tests of their own (test/staff_scan_test.dart).
///
/// The server applies the same rules again (lib/staffScanReading.ts); these
/// exist so the guard hears about a bad number before the network does.
library;

/// `null` when fine (blank is fine: the register never required a mobile),
/// else the reason. Accepts +91 / 0 in front.
String? indianMobileError(String raw) {
  final t = raw.trim();
  if (t.isEmpty) return null;
  final d = indianMobile10(t);
  if (d == null) return "Mobile number should be 10 digits";
  if (!RegExp(r"^[6-9]").hasMatch(d)) {
    return "An Indian mobile number starts with 6, 7, 8 or 9";
  }
  return null;
}

/// The 10 digits, or null when it is not 10 digits after +91 / 0.
String? indianMobile10(String raw) {
  var d = raw.replaceAll(RegExp(r"[\s\-()+]"), "");
  if (!RegExp(r"^\d+$").hasMatch(d)) return null;
  if (d.length == 12 && d.startsWith("91")) d = d.substring(2);
  if (d.length == 11 && d.startsWith("0")) d = d.substring(1);
  return d.length == 10 ? d : null;
}

/// Number of people: blank → 1; a whole number 1–99; else null.
int? peopleCountOf(String raw) {
  final t = raw.trim();
  if (t.isEmpty) return 1;
  final n = int.tryParse(t);
  if (n == null || n < 1 || n > 99) return null;
  return n;
}

const _stateCodes = {
  "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DD", "DL", "DN", "GA", "GJ", //
  "HR", "HP", "JK", "JH", "KA", "KL", "LA", "LD", "MP", "MH", "MN", "ML",
  "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK", "TN", "TS", "TG", "TR",
  "UP", "UK", "UA", "WB",
};

/// "UP 32 AB 1234" (or "22 BH 1234 AA"); "" when it is not a plate. No
/// look-alike swaps (O/0, I/1) — that would be a guess.
String normalizePlate(String raw) {
  final s = raw.toUpperCase().replaceAll(RegExp(r"[^A-Z0-9]"), "");
  final bh = RegExp(r"^(\d{2})BH(\d{4})([A-Z]{1,2})$").firstMatch(s);
  if (bh != null) return "${bh[1]} BH ${bh[2]} ${bh[3]}";
  final m = RegExp(r"^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$").firstMatch(s);
  if (m == null || !_stateCodes.contains(m[1])) return "";
  if (RegExp(r"^0+$").hasMatch(m[4]!)) return "";
  return [m[1], m[2], m[3], m[4]].where((x) => x!.isNotEmpty).join(" ");
}

/// A reading of a visitor's ID card, as the server sends it. The ID number
/// of an Aadhaar is already masked ("XXXX XXXX 1234") by the server.
class VisitorIdScan {
  VisitorIdScan.fromJson(Map<String, dynamic> j)
    : readable = j["readable"] == true,
      note = _s(j, "note"),
      idTypeLabel = _s(j, "idTypeLabel"),
      name = _s(j, "name"),
      idNumber = _s(j, "idNumber"),
      address = _s(j, "address"),
      idProofNote = _s(j, "idProofNote");

  final bool readable;
  final String note;
  final String idTypeLabel;
  final String name;
  final String idNumber;
  final String address;
  final String idProofNote;
}

class PlateScan {
  PlateScan.fromJson(Map<String, dynamic> j)
    : readable = j["readable"] == true,
      note = _s(j, "note"),
      plate = _s(j, "plate");

  final bool readable;
  final String note;
  final String plate;
}

class FuelBillScan {
  FuelBillScan.fromJson(Map<String, dynamic> j)
    : readable = j["readable"] == true,
      note = _s(j, "note"),
      amountRupees = _n(j, "amountRupees"),
      date = _s(j, "date"),
      quantity = _n(j, "quantity"),
      ratePerUnit = _n(j, "ratePerUnit"),
      odometerKm = _n(j, "odometerKm"),
      vendor = _s(j, "vendor"),
      billNo = _s(j, "billNo"),
      warnings = ((j["warnings"] as List?) ?? const [])
          .whereType<String>()
          .toList();

  final bool readable;
  final String note;
  final num? amountRupees;
  final String date;
  final num? quantity;
  final num? ratePerUnit;
  final num? odometerKm;
  final String vendor;
  final String billNo;
  final List<String> warnings;
}

String _s(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v is String ? v : "";
}

num? _n(Map<String, dynamic> j, String k) => j[k] is num ? j[k] as num : null;

/// "2841.6" not "2841.60000001"; whole numbers without ".0".
String plainNumber(num n) {
  if (n == n.roundToDouble()) return n.toInt().toString();
  return double.parse(n.toStringAsFixed(2)).toString();
}

/// What a fuel-bill reading fills in. Only fields that are still EMPTY on
/// the form are filled — the driver's own typing always wins — and each
/// filled key is reported so the form can mark it "read from bill — check".
class FuelBillPrefill {
  FuelBillPrefill({
    required this.values,
    required this.filled,
    required this.notes,
  });

  /// form key → text to put in it
  final Map<String, String> values;

  /// keys filled from the bill
  final Set<String> filled;

  /// lines to show above the Save button (never a guess, only what to check)
  final List<String> notes;

  static FuelBillPrefill from(
    FuelBillScan r, {
    required Map<String, String> current,
    required String entryDate,
    required String unitShort,
  }) {
    final values = <String, String>{};
    final filled = <String>{};
    final notes = <String>[];
    if (!r.readable) {
      notes.add(
        r.note.isEmpty
            ? "The bill could not be read — fill it in by hand."
            : r.note,
      );
      return FuelBillPrefill(values: values, filled: filled, notes: notes);
    }
    void put(String key, String? v) {
      if (v == null || v.isEmpty) return;
      if ((current[key] ?? "").trim().isNotEmpty) return;
      values[key] = v;
      filled.add(key);
    }

    put("quantity", r.quantity == null ? null : plainNumber(r.quantity!));
    put("amount", r.amountRupees == null ? null : plainNumber(r.amountRupees!));
    put("odometer", r.odometerKm == null ? null : plainNumber(r.odometerKm!));
    final noteParts = [
      if (r.vendor.isNotEmpty) r.vendor,
      if (r.billNo.isNotEmpty) "Bill ${r.billNo}",
      if (r.ratePerUnit != null) "₹${plainNumber(r.ratePerUnit!)}/$unitShort",
    ];
    put("note", noteParts.isEmpty ? null : noteParts.join(" · "));
    if (r.note.isNotEmpty) notes.add(r.note);
    if (r.date.isNotEmpty && r.date != entryDate) {
      notes.add(
        "The bill is dated ${r.date}, but this entry is for $entryDate — check.",
      );
    }
    notes.addAll(r.warnings);
    return FuelBillPrefill(values: values, filled: filled, notes: notes);
  }
}
