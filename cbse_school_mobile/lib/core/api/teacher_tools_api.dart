part of "api_client.dart";

// Two teacher tools (13 Oct 2026):
//   * Message my classes — sections and the send go through
//     /api/v1/staff/broadcast/audience (22 Oct 2026; broadcast_audience_api),
//     which scopes a teacher to their own sections and splits free text vs
//     the approved "School notice" template by each family's 24-hour
//     window. GET /api/v1/staff/broadcast still supplies the families per
//     section and the sent list.
//   * PTM slots — /api/v1/staff/ptm/slots. A teacher adds, changes or
//     cancels their OWN slots in a PTM the office opened; a booked slot is
//     never moved or removed from the phone.
//   * Schedule a PTM — /api/v1/staff/ptm/events (20 Oct 2026). One PTM
//     covering the classes picked; a teacher only for classes they teach,
//     the office / leadership for any class.
// The JSON helpers (_s, _i, _b, _list) are staff_api.dart's — same library.

// ---------------------------------------------------------- schedule a PTM

class PtmScheduleClass {
  PtmScheduleClass.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      name = _s(j, "name"),
      sections = _s(j, "sections");

  final String id;
  final String name;

  /// The teacher's own sections of the class ("A, B"); "" for the office.
  final String sections;
}

class PtmScheduleOptions {
  PtmScheduleOptions.fromJson(Map<String, dynamic> j)
    : canSchedule = _b(j, "canSchedule"),
      unrestricted = _b(j, "unrestricted"),
      today = _s(j, "today"),
      classes = _list(j, "classes").map(PtmScheduleClass.fromJson).toList();

  final bool canSchedule;
  final bool unrestricted;

  /// IST today (YYYY-MM-DD) — the first date the picker offers.
  final String today;
  final List<PtmScheduleClass> classes;
}

// ------------------------------------------------------- message my classes

class ClassBroadcastSection {
  ClassBroadcastSection.fromJson(Map<String, dynamic> j)
    : sectionId = _s(j, "sectionId"),
      classId = _s(j, "classId"),
      label = _s(j, "label"),
      families = _i(j, "families");

  final String sectionId;
  final String classId;
  final String label;

  /// Families in the section with a WhatsApp number on record.
  final int families;
}

class ClassBroadcastSent {
  ClassBroadcastSent.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      at = _s(j, "at"),
      audience = _s(j, "audience"),
      audienceLabel = _s(j, "audienceLabel"),
      sectionLabels = ((j["sectionLabels"] as List?) ?? const [])
          .map((e) => "$e")
          .toList(),
      body = _s(j, "body"),
      templateName = _s(j, "templateName"),
      families = _i(j, "families"),
      recipientCount = _i(j, "recipientCount"),
      skippedOptOut = _i(j, "skippedOptOut"),
      sent = _i(j, "sent"),
      failed = _i(j, "failed"),
      pushSent = _i(j, "pushSent");

  final String id;
  final String at;

  /// Sends from the Broadcast screen name their audience ("Teaching staff").
  final String audienceLabel;
  final String audience;
  final List<String> sectionLabels;
  final String body;
  final String templateName;
  final int families;
  final int recipientCount;
  final int skippedOptOut;
  final int sent;
  final int failed;
  final int pushSent;
}

class ClassBroadcastDesk {
  ClassBroadcastDesk.fromJson(Map<String, dynamic> j)
    : sections = _list(
        j,
        "sections",
      ).map(ClassBroadcastSection.fromJson).toList(),
      sent = j["sent"] is List
          ? _list(j, "sent").map(ClassBroadcastSent.fromJson).toList()
          : null;

  final List<ClassBroadcastSection> sections;

  /// Null = the server could not read the log (unknown, not "nothing sent").
  final List<ClassBroadcastSent>? sent;
}

/// What "Message my classes" opens on: the sections the SEND accepts (the
/// audience route's own scope), families per section and my sent list from
/// GET /api/v1/staff/broadcast — both null when that read failed (unknown,
/// never "0 families" / "nothing sent").
class ClassMessageDesk {
  ClassMessageDesk({
    required this.options,
    required this.familiesBySection,
    required this.sent,
  });

  final BroadcastAudienceOptions options;
  final Map<String, int>? familiesBySection;
  final List<ClassBroadcastSent>? sent;

  List<BroadcastSectionOption> get sections => [
    for (final c in options.classes) ...c.sections,
  ];
}

// ---------------------------------------------------------------- PTM slots

/// "10:15" → "10:15 AM". Slot times are plain HH:MM (formatTimeLabel only
/// reads full timestamps and printed nothing for them).
String hhmmLabel(String hhmm) {
  final m = RegExp(r"^(\d{1,2}):(\d{2})$").firstMatch(hhmm.trim());
  if (m == null) return hhmm;
  final h = int.parse(m.group(1)!);
  final h12 = h % 12 == 0 ? 12 : h % 12;
  return "$h12:${m.group(2)} ${h < 12 ? "AM" : "PM"}";
}

int? _hhmmMinutes(String hhmm) {
  final m = RegExp(r"^(\d{1,2}):(\d{2})$").firstMatch(hhmm.trim());
  if (m == null) return null;
  final h = int.parse(m.group(1)!);
  final mm = int.parse(m.group(2)!);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

String _minutesHhmm(int total) =>
    "${(total ~/ 60).toString().padLeft(2, "0")}:${(total % 60).toString().padLeft(2, "0")}";

/// The start times for a PTM sitting from [from] to [until]: one slot of
/// [slotMinutes], then [breakMinutes] off, repeated while a whole slot still
/// ends by [until]. Empty when the times do not make sense.
List<String> ptmSlotStarts({
  required String from,
  required String until,
  required int slotMinutes,
  int breakMinutes = 0,
}) {
  final a = _hhmmMinutes(from);
  final b = _hhmmMinutes(until);
  if (a == null || b == null || slotMinutes < 5 || breakMinutes < 0) {
    return const [];
  }
  final out = <String>[];
  for (var t = a; t + slotMinutes <= b; t += slotMinutes + breakMinutes) {
    out.add(_minutesHhmm(t));
  }
  return out;
}

/// Length of a slot in minutes from its HH:MM start and end (0 if unreadable).
int ptmSlotMinutes(String startAt, String endAt) {
  final a = _hhmmMinutes(startAt);
  final b = _hhmmMinutes(endAt);
  if (a == null || b == null || b <= a) return 0;
  return b - a;
}

extension TeacherToolsApi on ApiClient {
  /// The sections I may message, families each reaches, and what I sent.
  Future<ClassBroadcastDesk> fetchClassBroadcast() async =>
      ClassBroadcastDesk.fromJson(await _getData("/api/v1/staff/broadcast"));

  /// The audience options (required) and the old GET's counts + sent list
  /// (optional: a failure there leaves them unknown, the screen still sends).
  Future<ClassMessageDesk> fetchClassMessageDesk() async {
    final desk = fetchClassBroadcast().then<ClassBroadcastDesk?>(
      (d) => d,
      onError: (Object _) => null,
    );
    final options = await fetchBroadcastAudienceOptions();
    final old = await desk;
    return ClassMessageDesk(
      options: options,
      familiesBySection: old == null
          ? null
          : {for (final s in old.sections) s.sectionId: s.families},
      sent: old?.sent,
    );
  }

  /// Who may schedule, and which classes they may pick.
  Future<PtmScheduleOptions> fetchPtmScheduleOptions() async =>
      PtmScheduleOptions.fromJson(await _getData("/api/v1/staff/ptm/events"));

  /// Schedules ONE PTM covering [classIds]. Returns the new event's id.
  Future<String> schedulePtm({
    required String name,
    required String date,
    String endDate = "",
    required List<String> classIds,
    String mode = "in_person",
    String note = "",
  }) async {
    final data = await _postData("/api/v1/staff/ptm/events", {
      "name": name,
      "date": date,
      if (endDate.isNotEmpty) "endDate": endDate,
      "classIds": classIds,
      "mode": mode,
      "note": note,
    });
    final ev = data["event"];
    return ev is Map ? "${ev["id"] ?? ""}" : "";
  }

  /// Add my own slots to a PTM the office opened. Returns how many were made.
  Future<int> createPtmSlots({
    required String eventId,
    required List<String> starts,
    required int durationMinutes,
    int capacity = 1,
    String roomOrLink = "",
  }) async {
    final data = await _postData("/api/v1/staff/ptm/slots", {
      "eventId": eventId,
      "starts": starts,
      "durationMinutes": durationMinutes,
      "capacity": capacity,
      "roomOrLink": roomOrLink,
    });
    return _list(data, "slots").length;
  }

  /// Change one of my slots that nobody has booked.
  Future<void> updatePtmSlot({
    required String slotId,
    required String startAt,
    required int durationMinutes,
    required int capacity,
    required String roomOrLink,
  }) async {
    final res = await _http.patch(
      _uri("/api/v1/staff/ptm/slots"),
      headers: await _authHeaders(),
      body: jsonEncode({
        "slotId": slotId,
        "startAt": startAt,
        "durationMinutes": durationMinutes,
        "capacity": capacity,
        "roomOrLink": roomOrLink,
      }),
    );
    if (res.statusCode != 200) _throwFrom(res);
  }

  /// Cancel one of my slots that nobody has booked.
  Future<void> deletePtmSlot(String slotId) async {
    final res = await _http.delete(
      _uri(
        "/api/v1/staff/ptm/slots?slotId=${Uri.encodeQueryComponent(slotId)}",
      ),
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) _throwFrom(res);
  }
}
