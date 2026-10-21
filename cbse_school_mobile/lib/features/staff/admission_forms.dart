/// Pure checks behind the admissions sheets (walk-in lead, registration,
/// message composer). No widgets here, so the rules are unit-tested; the
/// server holds the same rules (lib/staffAdmissionsApp.ts) and has the final
/// word — these only stop a form going out that it would refuse anyway.
library;

enum AdmFormIssue {
  childName,
  className,
  parentName,
  mobile,
  feeHead,
  feeAmount,
  collectAmount,
  collectMoreThanFee,
  collectMode,
  collectRef,
}

/// Whole, non-negative rupees typed on a phone keyboard; null otherwise.
/// "500.5", "-1", "1e3" and "" are all refused rather than rounded.
int? wholeRupees(String raw) {
  final t = raw.trim().replaceAll(",", "");
  if (!RegExp(r"^\d{1,7}$").hasMatch(t)) return null;
  return int.parse(t);
}

/// The last ten digits of what was typed, so "+91 98111 22233" works.
String mobile10(String raw) {
  final d = raw.replaceAll(RegExp(r"\D"), "");
  return d.length > 10 ? d.substring(d.length - 10) : d;
}

AdmFormIssue? walkInIssue({
  required String childName,
  required String classId,
  required String parentName,
  required String mobile,
}) {
  if (childName.trim().isEmpty) return AdmFormIssue.childName;
  if (classId.isEmpty) return AdmFormIssue.className;
  if (parentName.trim().isEmpty) return AdmFormIssue.parentName;
  if (mobile10(mobile).length != 10) return AdmFormIssue.mobile;
  return null;
}

AdmFormIssue? registrationIssue({
  required bool newChild,
  String childName = "",
  String classId = "",
  String parentName = "",
  String mobile = "",
  required String feeHeadId,
  required String feeRaw,
  required bool collect,
  String collectRaw = "",
  String modeId = "",
  bool modeNeedsRef = false,
  String ref = "",
}) {
  if (newChild) {
    final w = walkInIssue(
      childName: childName,
      classId: classId,
      parentName: parentName,
      mobile: mobile,
    );
    if (w != null) return w;
  }
  if (feeHeadId.isEmpty) return AdmFormIssue.feeHead;
  final fee = wholeRupees(feeRaw);
  if (fee == null) return AdmFormIssue.feeAmount;
  if (!collect) return null;
  final amount = wholeRupees(collectRaw);
  if (amount == null || amount <= 0 || fee <= 0) {
    return AdmFormIssue.collectAmount;
  }
  if (amount > fee) return AdmFormIssue.collectMoreThanFee;
  if (modeId.isEmpty) return AdmFormIssue.collectMode;
  if (modeNeedsRef && ref.trim().isEmpty) return AdmFormIssue.collectRef;
  return null;
}

/// What the message composer offers.
///
///   ownWords      — the family wrote within 24 h: the editable draft can go
///                   (and the approved message too, when there is one);
///   templateOnly  — outside the window: only the approved message can go;
///   nothing       — neither: the reason is shown and only Cancel remains.
enum ComposerMode { ownWords, templateOnly, nothing }

ComposerMode composerMode({required bool inWindow, required bool templateOk}) {
  if (inWindow) return ComposerMode.ownWords;
  if (templateOk) return ComposerMode.templateOnly;
  return ComposerMode.nothing;
}
