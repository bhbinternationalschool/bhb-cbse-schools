part of "api_client.dart";

// School chat (director, 15 Oct 2026). Server routes:
//   GET  /api/v1/school-chat/conversations[?studentId=]
//   GET  /api/v1/school-chat/messages?conversationId=[&studentId=]
//   POST /api/v1/school-chat/send   {conversationId, body, studentId?}
//   POST /api/v1/school-chat/direct {with: {kind, id|studentId}, studentId?}
//   GET  /api/v1/school-chat/contacts[?studentId=]
// The server decides who is in which conversation; the parent app always
// says which child it is acting for (the home screen's child picker). In a
// class / subject group the family speaks as that child; in a direct chat
// with a teacher it speaks as the parent. Every child's and family's
// message is checked before others see it — a held one comes back with
// status "held" and a notice for the sender.

class SchoolChatConversation {
  SchoolChatConversation.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      kind = _s(j, "kind"),
      title = _s(j, "title"),
      lastMessage = j["lastMessage"] as String?,
      lastMessageAt = j["lastMessageAt"] as String?,
      unread = _i(j, "unread"),
      oversight = _b(j, "oversight");

  final String id;

  /// class / subject / dm_staff / dm_parent
  final String kind;
  final String title;
  final String? lastMessage;
  final String? lastMessageAt;
  final int unread;
  final bool oversight;

  bool get isGroup => kind == "class" || kind == "subject";
}

class SchoolChatList {
  SchoolChatList.fromJson(Map<String, dynamic> j)
    : conversations = _list(
        j,
        "conversations",
      ).map(SchoolChatConversation.fromJson).toList(),
      blocked = _b(j, "blocked"),
      muted = _b(j, "muted");

  final List<SchoolChatConversation> conversations;

  /// The school has paused this login's chat.
  final bool blocked;
  final bool muted;
}

class SchoolChatMessage {
  SchoolChatMessage.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      senderLabel = _s(j, "senderLabel"),
      senderKind = _s(j, "senderKind"),
      body = _s(j, "body"),
      createdAt = _s(j, "createdAt"),
      mine = _b(j, "mine"),
      status = j["status"] as String? ?? "visible",
      notice = j["notice"] as String?;

  final String id;
  final String senderLabel;
  final String senderKind;
  final String body;
  final String createdAt;
  final bool mine;

  /// visible / held (waiting for review) / removed
  final String status;
  final String? notice;

  bool get held => status == "held";
  bool get removed => status == "removed";
}

class SchoolChatThread {
  SchoolChatThread.fromJson(Map<String, dynamic> j)
    : title = _s(
        (j["conversation"] as Map<String, dynamic>?) ?? const {},
        "title",
      ),
      canSend = _b(
        (j["conversation"] as Map<String, dynamic>?) ?? const {},
        "canSend",
      ),
      muted = _b(
        (j["conversation"] as Map<String, dynamic>?) ?? const {},
        "muted",
      ),
      messages = _list(j, "messages").map(SchoolChatMessage.fromJson).toList();

  final String title;
  final bool canSend;
  final bool muted;
  final List<SchoolChatMessage> messages;
}

class SchoolChatSendResult {
  SchoolChatSendResult.fromJson(Map<String, dynamic> j)
    : held = _b(j, "held"),
      notice = j["notice"] as String?;

  final bool held;
  final String? notice;
}

class SchoolChatContact {
  SchoolChatContact({required this.id, required this.name, required this.role});

  final String id;
  final String name;
  final String role;
}

String _chatQs(Map<String, String?> q) {
  final parts = [
    for (final e in q.entries)
      if (e.value != null && e.value!.isNotEmpty)
        "${e.key}=${Uri.encodeQueryComponent(e.value!)}",
  ];
  return parts.isEmpty ? "" : "?${parts.join("&")}";
}

extension SchoolChatApi on ApiClient {
  Future<SchoolChatList> fetchSchoolChats({
    String? studentId,
  }) async => SchoolChatList.fromJson(
    await _getData(
      "/api/v1/school-chat/conversations${_chatQs({"studentId": studentId})}",
    ),
  );

  Future<SchoolChatThread> fetchSchoolChatMessages(
    String conversationId, {
    String? studentId,
  }) async => SchoolChatThread.fromJson(
    await _getData(
      "/api/v1/school-chat/messages${_chatQs({"conversationId": conversationId, "studentId": studentId})}",
    ),
  );

  Future<SchoolChatSendResult> sendSchoolChatMessage({
    required String conversationId,
    required String body,
    String? studentId,
  }) async => SchoolChatSendResult.fromJson(
    await _postData("/api/v1/school-chat/send", {
      "conversationId": conversationId,
      "body": body,
      "studentId": ?studentId,
    }),
  );

  /// Open (or find) a direct chat with a staff member. Returns its id.
  Future<String> openSchoolChatWithStaff(
    String staffId, {
    String? studentId,
  }) async {
    final d = await _postData("/api/v1/school-chat/direct", {
      "with": {"kind": "staff", "id": staffId},
      "studentId": ?studentId,
    });
    return _s(d, "id");
  }

  Future<List<SchoolChatContact>> fetchSchoolChatContacts({
    String? studentId,
  }) async {
    final d = await _getData(
      "/api/v1/school-chat/contacts${_chatQs({"studentId": studentId})}",
    );
    return _list(d, "staff")
        .map(
          (s) => SchoolChatContact(
            id: _s(s, "id"),
            name: _s(s, "name"),
            role: _s(s, "role"),
          ),
        )
        .toList();
  }
}
