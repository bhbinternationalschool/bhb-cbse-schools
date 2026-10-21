/// The checks the staff app makes before it asks the server to change a
/// family's WhatsApp number — the same rules the server applies
/// (apps/web/src/lib/studentContact.ts checkNewWhatsAppNumber, lib/sis.ts
/// isPlaceholderMobile), so a teacher hears "that is a placeholder" before
/// a round trip, never after a save.
library;

/// The last ten digits of a typed Indian mobile ("+91 …" / "0…" prefixes
/// accepted), or null when it is not a 10-digit mobile starting 6–9.
String? indianMobile10(String raw) {
  final d = raw.replaceAll(RegExp(r"\D"), "");
  final ten = d.length == 12 && d.startsWith("91")
      ? d.substring(2)
      : d.length == 11 && d.startsWith("0")
      ? d.substring(1)
      : d;
  return RegExp(r"^[6-9]\d{9}$").hasMatch(ten) ? ten : null;
}

/// 0000000000, 9999999999, 1234567890, 9876543210 … — what a form gets when
/// nobody knew the number. Never dialled, never saved (PR #377).
bool isPlaceholderMobile(String value) {
  final digits = value.replaceAll(RegExp(r"\D"), "");
  final m = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
  if (m.length != 10) return true;
  if (!RegExp(r"^[6-9]").hasMatch(m)) return true;
  if (RegExp(r"^(\d)\1{9}$").hasMatch(m)) return true;
  if (m == "1234567890" || m == "9876543210") return true;
  return false;
}

enum NewNumberProblem { empty, notMobile, placeholder, same }

/// The number to save, or why not.
({String? number, NewNumberProblem? problem}) checkNewWhatsApp(
  String raw,
  String current,
) {
  if (raw.trim().isEmpty) {
    return (number: null, problem: NewNumberProblem.empty);
  }
  final m = indianMobile10(raw);
  if (m == null) return (number: null, problem: NewNumberProblem.notMobile);
  if (isPlaceholderMobile(m)) {
    return (number: null, problem: NewNumberProblem.placeholder);
  }
  if (indianMobile10(current) == m) {
    return (number: null, problem: NewNumberProblem.same);
  }
  return (number: m, problem: null);
}

/// A number the phone may dial: real, not a placeholder; else null.
String? dialable(String raw) {
  final m = indianMobile10(raw);
  return m == null || isPlaceholderMobile(m) ? null : m;
}

/// The 12 digits of a typed Aadhaar number, "" when the box is empty, or
/// null when something was typed that is not 12 digits. The checksum is
/// the server's (Verhoeff), which says so in words.
String? aadhaarTyped(String raw) {
  final d = raw.replaceAll(RegExp(r"\D"), "");
  if (raw.trim().isEmpty) return "";
  return d.length == 12 ? d : null;
}
