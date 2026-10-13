import "../../core/api/api_client.dart";

/// The phone's copy of the ERP's checkProfileValue (lib/staffSelfProfile.ts):
/// the same cleaning and the same messages, so a wrong value is caught
/// before it is sent. The server checks again — this is only the courtesy.
///
/// Returns `(value, null)` with the cleaned value, or `(null, error)`.
(String?, String?) checkStaffProfileValue(StaffProfileField f, String raw) {
  final v = raw.trim();
  if (v.length > 300) return (null, "${f.label} is too long");
  if (v.isEmpty) {
    // Clearing is allowed for optional fields, never for name / login mobile.
    return f.approval && (f.key == "fullName" || f.key == "mobile")
        ? (null, "${f.label} cannot be empty")
        : ("", null);
  }
  final noSpace = v.replaceAll(RegExp(r"\s"), "");
  switch (f.kind) {
    case "mobile":
      final d = v.replaceAll(RegExp(r"\D"), "");
      final m = d.length == 12 && d.startsWith("91")
          ? d.substring(2)
          : d.length == 11 && d.startsWith("0")
          ? d.substring(1)
          : d;
      return RegExp(r"^[6-9]\d{9}$").hasMatch(m)
          ? (m, null)
          : (null, "${f.label}: enter a 10-digit mobile number");
    case "email":
      return RegExp(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").hasMatch(v)
          ? (v.toLowerCase(), null)
          : (null, "Enter a valid email");
    case "pincode":
      return RegExp(r"^\d{6}$").hasMatch(v)
          ? (v, null)
          : (null, "PIN code is 6 digits");
    case "date":
      return RegExp(r"^\d{4}-\d{2}-\d{2}$").hasMatch(v) &&
              DateTime.tryParse(v) != null
          ? (v, null)
          : (null, "${f.label}: use the date picker");
    case "number":
      return RegExp(r"^\d{1,20}$").hasMatch(noSpace)
          ? (noSpace, null)
          : (null, "${f.label}: digits only");
    case "aadhaar":
      final d = v.replaceAll(RegExp(r"\D"), "");
      return RegExp(r"^[2-9]\d{11}$").hasMatch(d)
          ? (d, null)
          : (null, "Aadhaar is 12 digits");
    case "pan":
      final p = noSpace.toUpperCase();
      return RegExp(r"^[A-Z]{5}\d{4}[A-Z]$").hasMatch(p)
          ? (p, null)
          : (null, "PAN looks like ABCDE1234F");
    case "ifsc":
      final p = noSpace.toUpperCase();
      return RegExp(r"^[A-Z]{4}0[A-Z0-9]{6}$").hasMatch(p)
          ? (p, null)
          : (null, "IFSC looks like SBIN0001234");
    case "account":
      return RegExp(r"^\d{6,20}$").hasMatch(noSpace)
          ? (noSpace, null)
          : (null, "Account number: 6–20 digits");
    case "select":
      return f.options.isEmpty || f.options.contains(v)
          ? (v, null)
          : (null, "${f.label}: choose from the list");
    default:
      return (v.replaceAll(RegExp(r"\s+"), " "), null);
  }
}

/// The profile screen's sections, in the order it shows them.
const kProfileGroupOrder = <String>[
  "Contact",
  "Personal",
  "Qualification",
  "Identity",
  "Bank",
  "Statutory",
];

const kProfileGroupHindi = <String, String>{
  "Contact": "संपर्क",
  "Personal": "व्यक्तिगत",
  "Qualification": "योग्यता",
  "Identity": "पहचान",
  "Bank": "बैंक",
  "Statutory": "पीएफ / ईएसआईसी",
};

/// Values the select fields store, as people read them.
String staffProfileOptionLabel(String key, String value) =>
    switch ("$key:$value") {
      "gender:M" => "Male · पुरुष",
      "gender:F" => "Female · महिला",
      "gender:O" => "Other · अन्य",
      "maritalStatus:single" => "Single · अविवाहित",
      "maritalStatus:married" => "Married · विवाहित",
      "maritalStatus:widowed" => "Widowed · विधवा/विधुर",
      "maritalStatus:other" => "Other · अन्य",
      _ => value,
    };
