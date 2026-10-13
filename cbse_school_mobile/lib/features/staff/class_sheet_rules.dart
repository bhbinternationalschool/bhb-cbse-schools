/// My class → Class sheet rules, ported line for line from the web ERP so
/// the phone refuses exactly what the server refuses:
///   apps/web/src/lib/classDetailsSheet.ts   (checkSheetRow, lists, groups)
///   apps/web/src/lib/studentMeasurements.ts (checkMeasurement, ageYears)
///   apps/web/src/lib/sis.ts                 (BLOOD_GROUPS, categories,
///                                            normalizeBloodGroup)
///   apps/web/src/components/staff/ClassSheet.tsx (draft / dirty / send)
/// The server re-checks every row; this only decides what to send and shows
/// the problem before the teacher presses Save. Pure — unit tested.
library;

const kBloodGroups = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const kStudentCategories = [
  ("", "—"),
  ("GEN", "General"),
  ("OBC", "OBC"),
  ("SC", "SC"),
  ("ST", "ST"),
  ("EWS", "EWS"),
];

const kReligions = [
  "HINDU",
  "MUSLIM",
  "CHRISTIAN",
  "SIKH",
  "BUDDHIST",
  "JAIN",
  "PARSI",
  "OTHER",
];

const kMotherTongueSuggestions = [
  "HINDI",
  "BHOJPURI",
  "AWADHI",
  "URDU",
  "ENGLISH",
  "BENGALI",
  "MAITHILI",
];

/// UDISE+ 4.3.7 scale, in the words the UDISE robot reads back exactly.
const kEducationLevels = [
  "NO SCHOOLING",
  "PRIMARY (CLASS 5)",
  "UPPER PRIMARY (CLASS 8)",
  "SECONDARY (10TH)",
  "HIGHER SECONDARY (12TH)",
  "GRADUATE",
  "POST GRADUATE",
];

const kHeightMin = 60, kHeightMax = 190;
const kWeightMin = 8, kWeightMax = 110;

enum SheetGroup {
  measure(
    "Height & weight",
    "लंबाई व वज़न",
    "Measure each child — tape and scale, never a guess",
    ["heightCm", "weightKg"],
  ),
  blood(
    "Blood group",
    "रक्त समूह",
    "From a report or the parents; leave blank if not known",
    ["bloodGroup"],
  ),
  family(
    "Mother tongue, religion, category",
    "मातृभाषा, धर्म, वर्ग",
    "As the family gives it",
    ["motherTongue", "religion", "category"],
  ),
  education(
    "Parents' education",
    "माता-पिता की शिक्षा",
    "Highest class each parent completed",
    ["fatherQualification", "motherQualification"],
  ),
  cwsn(
    "Special needs (CWSN)",
    "विशेष आवश्यकता",
    "Tick only a child with a disability or special need",
    ["isCwsn"],
  );

  const SheetGroup(this.label, this.hindi, this.hint, this.keys);
  final String label;
  final String hindi;
  final String hint;
  final List<String> keys;
}

/// "B(+)", "b +ve", "O Positive" → "B+" / "O+"; "" when not a blood group.
String normalizeBloodGroup(String raw) {
  final t = raw
      .toUpperCase()
      .replaceAll(RegExp(r"[\s()]"), "")
      .replaceFirst(RegExp(r"(POSITIVE|POS|\+VE)$"), "+")
      .replaceFirst(RegExp(r"(NEGATIVE|NEG|-VE)$"), "-");
  return t.isNotEmpty && kBloodGroups.contains(t) ? t : "";
}

/// JS `String(Math.round(n * 10) / 10)`: 112 → "112", 112.25 → "112.3".
String _oneDecimal(double n) {
  final r = (n * 10).round() / 10;
  return r == r.truncateToDouble() ? "${r.toInt()}" : "$r";
}

/// JS `${n}` for the numbers here: 2 → "2", 1.12 → "1.12".
String _jsNum(double n) => n == n.truncateToDouble() ? "${n.toInt()}" : "$n";

/// null = blank; NaN = not a number.
double? _num(String raw) {
  final t = raw.trim().replaceFirst(",", ".");
  if (t.isEmpty) return null;
  if (!RegExp(r"^\d{1,5}(\.\d{1,2})?$").hasMatch(t)) return double.nan;
  return double.parse(t);
}

typedef MeasureCheck = ({
  bool ok,
  String heightCm,
  String weightKg,
  String error,
});

/// Height in cm and weight in kg as a class teacher measures them. Both blank
/// is fine (nothing to save); one blank is fine (weighed today, measured
/// tomorrow).
MeasureCheck checkMeasurement(String heightRaw, String weightRaw) {
  MeasureCheck bad(String e) =>
      (ok: false, heightCm: "", weightKg: "", error: e);
  final h = _num(heightRaw);
  final w = _num(weightRaw);
  if (h != null && h.isNaN) {
    return bad("Height must be a number in cm, e.g. 112 or 112.5");
  }
  if (w != null && w.isNaN) {
    return bad("Weight must be a number in kg, e.g. 19 or 19.5");
  }
  if (h != null && h > 0 && h < 3) {
    return bad(
      "Height ${_jsNum(h)} looks like metres — type centimetres (e.g. ${(h * 100).round()})",
    );
  }
  if (w != null && w > 1000) {
    return bad(
      "Weight ${_jsNum(w)} looks like grams — type kilograms (e.g. ${_oneDecimal(w / 1000)})",
    );
  }
  if (h != null && w != null && h < kHeightMin && w > kHeightMin) {
    return bad("Height and weight look swapped — height in cm, weight in kg");
  }
  if (h != null && (h < kHeightMin || h > kHeightMax)) {
    return bad("Height must be between $kHeightMin and $kHeightMax cm");
  }
  if (w != null && (w < kWeightMin || w > kWeightMax)) {
    return bad("Weight must be between $kWeightMin and $kWeightMax kg");
  }
  return (
    ok: true,
    heightCm: h == null ? "" : _oneDecimal(h),
    weightKg: w == null ? "" : _oneDecimal(w),
    error: "",
  );
}

/// Age in whole years on [today] from an ISO date of birth; null if unknown.
int? ageYears(String dob, String today) {
  final re = RegExp(r"^(\d{4})-(\d{2})-(\d{2})");
  final m = re.firstMatch(dob);
  final t = re.firstMatch(today);
  if (m == null || t == null) return null;
  var age = int.parse(t[1]!) - int.parse(m[1]!);
  final tmd = "${t[2]}${t[3]}";
  final mmd = "${m[2]}${m[3]}";
  if (tmd.compareTo(mmd) < 0) age -= 1;
  return age >= 0 && age < 30 ? age : null;
}

/// One child's sheet values. Text keys as in [SheetGroup.keys]; isCwsn bool.
class SheetDraft {
  SheetDraft({
    this.heightCm = "",
    this.weightKg = "",
    this.bloodGroup = "",
    this.motherTongue = "",
    this.religion = "",
    this.category = "",
    this.fatherQualification = "",
    this.motherQualification = "",
    this.isCwsn = false,
  });

  /// What the record holds now. "B(+)" from the old import shows — and is
  /// kept — as "B+"; nothing unknown is filled in.
  factory SheetDraft.fromRecord({
    required Map<String, String> fields,
    required String heightCm,
    required String weightKg,
    required String fatherQualification,
    required String motherQualification,
    required bool isCwsn,
  }) {
    final bg = fields["bloodGroup"] ?? "";
    return SheetDraft(
      heightCm: heightCm,
      weightKg: weightKg,
      bloodGroup: normalizeBloodGroup(bg).isNotEmpty
          ? normalizeBloodGroup(bg)
          : bg,
      motherTongue: fields["motherTongue"] ?? "",
      religion: fields["religion"] ?? "",
      category: fields["category"] ?? "",
      fatherQualification: fatherQualification,
      motherQualification: motherQualification,
      isCwsn: isCwsn,
    );
  }

  String heightCm;
  String weightKg;
  String bloodGroup;
  String motherTongue;
  String religion;
  String category;
  String fatherQualification;
  String motherQualification;
  bool isCwsn;

  SheetDraft copy() => SheetDraft(
    heightCm: heightCm,
    weightKg: weightKg,
    bloodGroup: bloodGroup,
    motherTongue: motherTongue,
    religion: religion,
    category: category,
    fatherQualification: fatherQualification,
    motherQualification: motherQualification,
    isCwsn: isCwsn,
  );

  Object get(String k) => switch (k) {
    "heightCm" => heightCm,
    "weightKg" => weightKg,
    "bloodGroup" => bloodGroup,
    "motherTongue" => motherTongue,
    "religion" => religion,
    "category" => category,
    "fatherQualification" => fatherQualification,
    "motherQualification" => motherQualification,
    "isCwsn" => isCwsn,
    _ => "",
  };

  /// Text of a key ("" for isCwsn) — the `str(current[k])` of the web.
  String text(String k) {
    final v = get(k);
    return v is String ? v.trim() : "";
  }
}

/// Is this group filled in for the child? (CWSN: unticked is an answer.)
bool sheetGroupFilled(SheetDraft d, SheetGroup g) => switch (g) {
  SheetGroup.measure => d.heightCm.isNotEmpty && d.weightKg.isNotEmpty,
  SheetGroup.blood => d.bloodGroup.isNotEmpty,
  SheetGroup.family =>
    d.motherTongue.isNotEmpty && d.religion.isNotEmpty && d.category.isNotEmpty,
  SheetGroup.education =>
    d.fatherQualification.isNotEmpty && d.motherQualification.isNotEmpty,
  SheetGroup.cwsn => true,
};

/// What one child's row sends: for each chosen group with a change, the
/// changed keys — height and weight always travel together. Empty = nothing
/// to save for this child. Another child's values are never in it.
Map<String, Object> sheetRowToSend(
  SheetDraft base,
  SheetDraft draft,
  Iterable<SheetGroup> groups,
) {
  final send = <String, Object>{};
  for (final g in groups) {
    if (!g.keys.any((k) => draft.get(k) != base.get(k))) continue;
    for (final k in g.keys) {
      if (g == SheetGroup.measure || draft.get(k) != base.get(k)) {
        send[k] = draft.get(k);
      }
    }
  }
  return send;
}

/// The server's checkSheetRow: null when the row may be sent, else the
/// first problem in words. [current] is what the record holds now — a value
/// the ERP already had that is not on our lists may go back unchanged.
String? checkSheetRow(Map<String, Object?> input, SheetDraft current) {
  String str(Object? v) => v is String ? v.trim() : "";
  bool keep(String k, String v) => v == current.text(k);

  if (input.containsKey("heightCm") || input.containsKey("weightKg")) {
    final m = checkMeasurement(str(input["heightCm"]), str(input["weightKg"]));
    if (!m.ok) return m.error;
  }
  if (input.containsKey("bloodGroup")) {
    final raw = str(input["bloodGroup"]);
    final norm = normalizeBloodGroup(raw);
    final v = norm.isNotEmpty
        ? norm
        : (keep("bloodGroup", raw) ? raw : raw.toUpperCase());
    if (!kBloodGroups.contains(v) && !keep("bloodGroup", raw)) {
      return "Pick a blood group from the list";
    }
  }
  if (input.containsKey("motherTongue")) {
    final v = str(
      input["motherTongue"],
    ).toUpperCase().replaceAll(RegExp(r"\s+"), " ");
    if (v.isNotEmpty && !RegExp(r"^[A-Z][A-Z .-]{1,39}$").hasMatch(v)) {
      return "Mother tongue: letters only, e.g. HINDI";
    }
  }
  if (input.containsKey("religion")) {
    final raw = str(input["religion"]);
    final v = raw.toUpperCase();
    if (v.isNotEmpty && !kReligions.contains(v) && !keep("religion", raw)) {
      return "Pick a religion from the list";
    }
  }
  if (input.containsKey("category")) {
    final v = str(input["category"]).toUpperCase();
    if (!kStudentCategories.any((c) => c.$1 == v)) {
      return "Pick a category from the list";
    }
  }
  for (final k in const ["fatherQualification", "motherQualification"]) {
    if (!input.containsKey(k)) continue;
    final v = str(input[k]);
    if (v.isNotEmpty && !kEducationLevels.contains(v) && !keep(k, v)) {
      return "${k == "fatherQualification" ? "Father" : "Mother"}'s education: pick from the list";
    }
  }
  if (input.containsKey("isCwsn") && input["isCwsn"] is! bool) {
    return "CWSN must be ticked or not";
  }
  return null;
}

/// Options for a list, keeping an old value the ERP already holds.
List<String> withCurrent(List<String> list, String cur) =>
    cur.isNotEmpty && !list.contains(cur) ? [cur, ...list] : [...list];
