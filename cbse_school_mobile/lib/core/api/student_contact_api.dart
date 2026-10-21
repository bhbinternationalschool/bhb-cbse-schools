part of "api_client.dart";

// One student's family from the staff app (requests mr_mv9ze8pqksu2,
// mr_mv9zkoot06df) and the document type chosen while verifying
// (mr_mv9z5lg1jlih). Server routes:
//   GET  /api/v1/staff/student-contact?studentId=
//   POST /api/v1/staff/student-contact              (change WhatsApp number)
//   POST /api/v1/staff/student-contact/message      (dry run = preview)
//   GET  /api/v1/staff/documents/types
//   POST /api/v1/staff/documents/types              (create a custom type)
// The helpers _s / _b / _list live in staff_api.dart (same library).

class StudentContact {
  StudentContact.fromJson(Map<String, dynamic> j)
    : studentId = _s(j, "studentId"),
      studentName = _s(j, "studentName"),
      classLabel = _s(j, "classLabel"),
      householdId = _s(_scObj(j["household"]), "id"),
      householdRevisionAt = _s(_scObj(j["household"]), "revisionAt"),
      guardianName = _s(_scObj(j["household"]), "guardianName"),
      callNumber = _s(_scObj(j["call"]), "number"),
      callSource = _s(_scObj(j["call"]), "source"),
      whatsappNumber = _s(_scObj(j["whatsapp"]), "number"),
      canChangeNumber = _b(j, "canChangeNumber"),
      canChat = _b(j, "canChat"),
      canMessage = _b(j, "canMessage");

  final String studentId;
  final String studentName;
  final String classLabel;

  /// "" when the child has no family record.
  final String householdId;
  final String householdRevisionAt;
  final String guardianName;

  /// The number a Call dials — "" means none on record (a placeholder such
  /// as 0000000000 is never sent as a number).
  final String callNumber;

  /// guardian | whatsapp | none
  final String callSource;

  /// The number the school messages — "" when none.
  final String whatsappNumber;

  /// Class teacher (or the office): may add / change the WhatsApp number.
  final bool canChangeNumber;

  /// Class teacher: the in-app chat with the family is theirs.
  final bool canChat;

  /// Holds "Message my classes": may send this family a WhatsApp.
  final bool canMessage;
}

Map<String, dynamic> _scObj(Object? raw) =>
    raw is Map ? Map<String, dynamic>.from(raw) : const {};

class StudentMessagePreview {
  StudentMessagePreview.fromJson(Map<String, dynamic> j)
    : to = _s(j, "to"),
      language = _s(j, "language"),
      preview = _s(j, "preview");

  /// Masked number ("98•••••567").
  final String to;
  final String language;

  /// Exactly what the family will read.
  final String preview;
}

class StudentMessageResult {
  StudentMessageResult.fromJson(Map<String, dynamic> j)
    : sent = _b(j, "sent"),
      held = _b(j, "held"),
      reason = _s(j, "reason"),
      to = _s(j, "to");

  final bool sent;

  /// Not sent on purpose (the family's quiet hours, or they said STOP).
  final bool held;
  final String reason;
  final String to;
}

class DocTypeOption {
  DocTypeOption.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      label = _s(j, "label"),
      labelHi = _s(j, "labelHi"),
      slot = _s(j, "slot"),
      aadhaarOf = _s(j, "aadhaarOf"),
      custom = _b(j, "custom");

  final String id;
  final String label;
  final String labelHi;

  /// The child's document slot it lives in; "" = filed off the child's slots.
  final String slot;

  /// child | father | mother | "" — an Aadhaar card, and whose.
  final String aadhaarOf;
  final bool custom;
}

class DocTypeCatalogue {
  DocTypeCatalogue.fromJson(Map<String, dynamic> j)
    : customLoaded = j["customLoaded"] != false,
      types = _list(j, "types").map(DocTypeOption.fromJson).toList();

  /// False when the school's own types could not be read — the built-ins
  /// are still offered, but the list is not complete.
  final bool customLoaded;
  final List<DocTypeOption> types;
}

class DocReviewOutcome {
  DocReviewOutcome.fromJson(Map<String, dynamic> j)
    : typeLabel = _s(j, "typeLabel"),
      movedTo = _s(j, "movedTo"),
      aadhaarSaved = _b(_scObj(j["aadhaar"]), "saved"),
      aadhaarAsked = j["aadhaar"] is Map,
      aadhaarStatus = _s(_scObj(_scObj(j["aadhaar"])["outcome"]), "status"),
      aadhaarError = _s(_scObj(j["aadhaar"]), "error");

  final String typeLabel;

  /// "" = verified where it was; a slot key = moved there; "filed".
  final String movedTo;
  final bool aadhaarAsked;
  final bool aadhaarSaved;

  /// saved | corrected | unchanged | kept_verified
  final String aadhaarStatus;
  final String aadhaarError;
}

extension StudentContactApi on ApiClient {
  Future<StudentContact> fetchStudentContact(
    String studentId,
  ) async => StudentContact.fromJson(
    await _getData(
      "/api/v1/staff/student-contact?studentId=${Uri.encodeQueryComponent(studentId)}",
    ),
  );

  /// Add / change the family's WhatsApp number (class teacher). Refused by
  /// the server with a reason for a placeholder, a non-Indian number, or a
  /// family record someone else saved since [revisionAt].
  Future<String> changeFamilyWhatsApp({
    required String studentId,
    required String number,
    required String revisionAt,
  }) async {
    final d = await _postData("/api/v1/staff/student-contact", {
      "studentId": studentId,
      "whatsappMobile": number,
      "revisionAt": revisionAt,
    });
    return _s(d, "whatsappMobile");
  }

  /// What the family would read — nothing is sent.
  Future<StudentMessagePreview> previewStudentMessage({
    required String studentId,
    required String text,
  }) async => StudentMessagePreview.fromJson(
    await _postData("/api/v1/staff/student-contact/message", {
      "studentId": studentId,
      "text": text,
      "dryRun": true,
    }),
  );

  /// Send it — only after the teacher pressed Send on the preview.
  Future<StudentMessageResult> sendStudentMessage({
    required String studentId,
    required String text,
  }) async => StudentMessageResult.fromJson(
    await _postData("/api/v1/staff/student-contact/message", {
      "studentId": studentId,
      "text": text,
      "dryRun": false,
    }),
  );

  Future<DocTypeCatalogue> fetchDocTypes() async => DocTypeCatalogue.fromJson(
    await _getData("/api/v1/staff/documents/types"),
  );

  /// A new type; an existing one with the same name is returned instead.
  Future<DocTypeOption> createDocType(String label) async {
    final d = await _postData("/api/v1/staff/documents/types", {
      "label": label,
    });
    return DocTypeOption.fromJson(_scObj(d["type"]));
  }

  /// Verify under a chosen type (and, for an Aadhaar card, its 12 digits).
  Future<DocReviewOutcome> verifyDocumentAs({
    required String studentId,
    required String key,
    required String typeId,
    String aadhaarNumber = "",
  }) async => DocReviewOutcome.fromJson(
    await _postData("/api/v1/staff/documents/review", {
      "studentId": studentId,
      "key": key,
      "verdict": "verified",
      "typeId": typeId,
      if (aadhaarNumber.isNotEmpty) "aadhaarNumber": aadhaarNumber,
    }),
  );
}
