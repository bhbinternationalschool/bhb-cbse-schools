part of "api_client.dart";

// The signed-in person's own notifications (20 Oct 2026):
//   GET  /api/v1/notifications   list, unread count, settings
//   POST /api/v1/notifications   {op:"read", ids} | {op:"read_all"} |
//                                {op:"prefs", prefs, base}
// Who receives what is decided by the ERP from roles (apps/web
// lib/notify/audience.ts); nothing sent from the phone names whose list it is.

/// The topics a person can mute — the same list as the ERP
/// (apps/web/src/lib/notify/kinds.ts NOTIFY_TOPICS). Each is also the spoken
/// line the phone plays (channel `bhb_voice_<topic>_<hi|en>`).
const kNotifyTopics = <(String, String, String)>[
  ("approval", "Approvals", "मंज़ूरी"),
  ("leave", "Leave", "छुट्टी"),
  ("document", "Documents", "दस्तावेज़"),
  ("message", "Messages", "संदेश"),
  ("fees", "Fees & receipts", "फीस व रसीद"),
  ("homework", "Homework", "होमवर्क"),
  ("attendance", "Attendance", "हाज़िरी"),
  ("notice", "Notices", "सूचनाएँ"),
];

String notifyTopicLabel(String topic, {required bool hindi}) {
  for (final t in kNotifyTopics) {
    if (t.$1 == topic) return hindi ? t.$3 : t.$2;
  }
  return topic;
}

class NotifyItem {
  NotifyItem.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      kind = _s(j, "kind"),
      topic = _s(j, "topic"),
      title = _s(j, "title"),
      body = _s(j, "body"),
      titleHi = _s(j, "titleHi"),
      bodyHi = _s(j, "bodyHi"),
      link = _s(j, "link"),
      groupCount = _i(j, "groupCount") < 1 ? 1 : _i(j, "groupCount"),
      urgent = _b(j, "urgent"),
      readAt = j["readAt"] is String ? j["readAt"] as String : null,
      createdAt = _s(j, "createdAt");

  final String id;
  final String kind;
  final String topic;
  final String title;
  final String body;
  final String titleHi;
  final String bodyHi;

  /// In-app route, e.g. "/leave-approvals" — opened by the home.
  final String link;
  final int groupCount;
  final bool urgent;
  final String? readAt;
  final String createdAt;

  bool get unread => readAt == null;
  String titleFor({required bool hindi}) =>
      hindi && titleHi.isNotEmpty ? titleHi : title;
  String bodyFor({required bool hindi}) =>
      hindi && bodyHi.isNotEmpty ? bodyHi : body;
}

class NotifyPrefs {
  const NotifyPrefs({
    this.mutedTopics = const [],
    this.voice = true,
    this.quietEnabled = true,
    this.quietStart = "21:00",
    this.quietEnd = "07:00",
  });

  NotifyPrefs.fromJson(Map<String, dynamic> j)
    : mutedTopics = (j["mutedTopics"] is List)
          ? (j["mutedTopics"] as List).whereType<String>().toList()
          : const [],
      voice = j["voice"] is bool ? j["voice"] as bool : true,
      quietEnabled = j["quietEnabled"] is bool
          ? j["quietEnabled"] as bool
          : true,
      quietStart = j["quietStart"] is String
          ? j["quietStart"] as String
          : "21:00",
      quietEnd = j["quietEnd"] is String ? j["quietEnd"] as String : "07:00";

  final List<String> mutedTopics;
  final bool voice;
  final bool quietEnabled;

  /// "HH:MM", India time.
  final String quietStart;
  final String quietEnd;

  NotifyPrefs copyWith({
    List<String>? mutedTopics,
    bool? voice,
    bool? quietEnabled,
    String? quietStart,
    String? quietEnd,
  }) => NotifyPrefs(
    mutedTopics: mutedTopics ?? this.mutedTopics,
    voice: voice ?? this.voice,
    quietEnabled: quietEnabled ?? this.quietEnabled,
    quietStart: quietStart ?? this.quietStart,
    quietEnd: quietEnd ?? this.quietEnd,
  );

  Map<String, dynamic> toJson() => {
    "mutedTopics": mutedTopics,
    "voice": voice,
    "quietEnabled": quietEnabled,
    "quietStart": quietStart,
    "quietEnd": quietEnd,
  };
}

class NotifyInbox {
  NotifyInbox.fromJson(Map<String, dynamic> j)
    : items = _list(j, "items").map(NotifyItem.fromJson).toList(),
      unread = _i(j, "unread"),
      prefs = j["prefs"] is Map
          ? NotifyPrefs.fromJson(Map<String, dynamic>.from(j["prefs"] as Map))
          : const NotifyPrefs(),
      prefsRev = j["prefsRev"] is String ? j["prefsRev"] as String : null;

  final List<NotifyItem> items;
  final int unread;
  final NotifyPrefs prefs;

  /// The saved settings' revision; null = never saved (the defaults).
  final String? prefsRev;
}

/// A settings save the server refused because another device saved first.
class NotifyPrefsConflict implements Exception {
  NotifyPrefsConflict(this.message, this.prefs, this.prefsRev);
  final String message;
  final NotifyPrefs? prefs;
  final String? prefsRev;
}

extension NotificationsApi on ApiClient {
  Future<NotifyInbox> fetchNotifications() async =>
      NotifyInbox.fromJson(await _getData("/api/v1/notifications"));

  Future<void> markNotificationsRead(List<String> ids) async {
    if (ids.isEmpty) return;
    await _postRaw("/api/v1/notifications", {"op": "read", "ids": ids});
  }

  Future<void> markAllNotificationsRead() =>
      _postRaw("/api/v1/notifications", {"op": "read_all"});

  /// Save settings; returns the new revision. Throws [NotifyPrefsConflict]
  /// (with the stored settings) when another device saved first.
  Future<String?> saveNotifyPrefs(NotifyPrefs prefs, {String? base}) async {
    final res = await _clientFor("/api/v1/notifications").post(
      _uri("/api/v1/notifications"),
      headers: await _authHeaders(),
      body: jsonEncode({"op": "prefs", "prefs": prefs.toJson(), "base": base}),
    );
    final decoded = res.body.isEmpty
        ? const <String, dynamic>{}
        : jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode == 409) {
      final p = decoded["prefs"];
      throw NotifyPrefsConflict(
        (decoded["error"] as String?) ?? "Changed on another device",
        p is Map ? NotifyPrefs.fromJson(Map<String, dynamic>.from(p)) : null,
        decoded["prefsRev"] as String?,
      );
    }
    if (res.statusCode != 200) _throwFrom(res);
    return decoded["prefsRev"] as String?;
  }

  Future<void> _postRaw(String path, Map<String, dynamic> body) async {
    final res = await _clientFor(
      path,
    ).post(_uri(path), headers: await _authHeaders(), body: jsonEncode(body));
    if (res.statusCode != 200) _throwFrom(res);
  }
}
