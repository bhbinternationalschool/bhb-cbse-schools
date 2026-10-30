part of "api_client.dart";

// School chat (director, 15 Oct 2026). Server routes:
//   GET  /api/v1/school-chat/conversations[?studentId=]
//   GET  /api/v1/school-chat/messages?conversationId=[&studentId=]
//   POST /api/v1/school-chat/send   {conversationId, body, studentId?}
//   POST /api/v1/school-chat/direct {with: {kind, id|studentId}, studentId?}
//   GET  /api/v1/school-chat/contacts[?studentId=]
//   POST /api/v1/school-chat/groups {op, conversationId, rev, …} — change a
//        staff-made group (rename / addStaff / removeStaff / setSection /
//        clearSection / leave); 409 = someone else changed it first
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

  /// class / subject / group (made by a member of staff) / dm_staff / dm_parent
  final String kind;
  final String title;
  final String? lastMessage;
  final String? lastMessageAt;
  final int unread;
  final bool oversight;

  bool get isGroup => kind == "class" || kind == "subject" || kind == "group";
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
      notice = j["notice"] as String?,
      system = _b(j, "system"),
      card = j["card"] is Map<String, dynamic>
          ? SchoolChatCard.fromJson(j["card"] as Map<String, dynamic>)
          : null;

  final String id;
  final String senderLabel;
  final String senderKind;
  final String body;
  final String createdAt;
  final bool mine;

  /// visible / held (waiting for review) / removed
  final String status;
  final String? notice;

  /// A group's history line written by the server ("Asha added Ravi") —
  /// drawn as a note, not a bubble.
  final bool system;

  /// A homework / classwork card: the Homework module's own record.
  final SchoolChatCard? card;

  bool get held => status == "held";
  bool get removed => status == "removed";

  /// A notice a teacher posted from the class chat ("Notice: …").
  bool get isNotice => senderKind == "staff" && body.startsWith("Notice: ");
}

/// Homework or classwork in a class / subject group — read from the
/// Homework module, never copied into the chat.
class SchoolChatCard {
  SchoolChatCard.fromJson(Map<String, dynamic> j)
    : kind = _s(j, "kind"),
      refId = _s(j, "refId"),
      subject = _s(j, "subject"),
      title = _s(j, "title"),
      body = _s(j, "body"),
      dueAt = _s(j, "dueAt"),
      date = _s(j, "date"),
      attachments = _list(j, "attachments").length;

  /// homework / classwork
  final String kind;
  final String refId;
  final String subject;
  final String title;
  final String body;
  final String dueAt;
  final String date;
  final int attachments;

  bool get isHomework => kind == "homework";
}

/// Who may post homework / classwork / a notice in this group.
class SchoolChatCompose {
  SchoolChatCompose.fromJson(Map<String, dynamic> j)
    : subjects = _list(
        j,
        "subjects",
      ).map((s) => (id: _s(s, "id"), name: _s(s, "name"))).toList(),
      fixedSubject = _s(j, "fixedSubject");

  final List<({String id, String name})> subjects;
  final String fixedSubject;
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
      compose =
          ((j["conversation"] as Map<String, dynamic>?)?["compose"])
              is Map<String, dynamic>
          ? SchoolChatCompose.fromJson(
              (j["conversation"] as Map<String, dynamic>)["compose"]
                  as Map<String, dynamic>,
            )
          : null,
      manage =
          ((j["conversation"] as Map<String, dynamic>?)?["manage"])
              is Map<String, dynamic>
          ? SchoolChatGroupManage.fromJson(
              (j["conversation"] as Map<String, dynamic>)["manage"]
                  as Map<String, dynamic>,
            )
          : null,
      messages = _list(j, "messages").map(SchoolChatMessage.fromJson).toList();

  final String title;

  /// A staff-made group, for staff: members and what this person may change.
  final SchoolChatGroupManage? manage;
  final bool canSend;
  final bool muted;

  /// null = this person cannot post homework / classwork / notices here.
  final SchoolChatCompose? compose;
  final List<SchoolChatMessage> messages;
}

/// A staff-made group's settings as the server reads them now.
class SchoolChatGroupManage {
  SchoolChatGroupManage.fromJson(Map<String, dynamic> j)
    : rev = _s(j, "rev"),
      members = _list(
        j,
        "members",
      ).map((m) => (id: _s(m, "id"), name: _s(m, "name"))).toList(),
      creatorName = _s(j, "creatorName"),
      creatorLeft = _b(j, "creatorLeft"),
      canManage = _b(j, "canManage"),
      canLeave = _b(j, "canLeave"),
      sectionLabel = _s(j, "sectionLabel"),
      me = _s(j, "me");

  /// The version every change is made against (409 if it moved on).
  final String rev;
  final List<({String id, String name})> members;
  final String creatorName;

  /// The maker has left: only chat moderators can change the group now.
  final bool creatorLeft;

  /// Rename, add / remove staff, class section: the maker or a moderator.
  final bool canManage;
  final bool canLeave;
  final String sectionLabel;
  final String me;
}

/// The staff and class sections a member of staff may put in a group.
class SchoolChatGroupPicker {
  SchoolChatGroupPicker.fromJson(Map<String, dynamic> j)
    : staff = _list(
        j,
        "staff",
      ).map((s) => (id: _s(s, "id"), name: _s(s, "name"))).toList(),
      sections = _list(j, "sections")
          .map(
            (s) => (
              classId: _s(s, "classId"),
              sectionId: _s(s, "sectionId"),
              label: _s(s, "label"),
            ),
          )
          .toList();

  final List<({String id, String name})> staff;
  final List<({String classId, String sectionId, String label})> sections;
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
  /// Unread messages across the caller's conversations (the chat button's badge).
  Future<int> fetchSchoolChatUnread({String? studentId}) async => _i(
    await _getData(
      "/api/v1/school-chat/unread${_chatQs({"studentId": studentId})}",
    ),
    "unread",
  );

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

  /// Post classwork or a notice into a class / subject group
  /// (homework goes through the Homework screen's own compose — Scan page,
  /// Upload file — and shows here as a card).
  Future<void> postSchoolChatWork({
    required String conversationId,
    required String kind,
    required String title,
    String body = "",
    String? subjectId,
  }) async {
    await _postData("/api/v1/school-chat/work", {
      "conversationId": conversationId,
      "kind": kind,
      "title": title,
      "body": body,
      "subjectId": ?subjectId,
    });
  }

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

  /// Staff and sections for a group's Members → Add and Class section.
  Future<SchoolChatGroupPicker> fetchSchoolChatGroupPicker() async =>
      SchoolChatGroupPicker.fromJson(
        await _getData("/api/v1/school-chat/contacts"),
      );

  /// Change a staff-made group. [rev] is [SchoolChatGroupManage.rev] as
  /// last read; a group someone else changed since answers 409.
  Future<void> changeSchoolChatGroup({
    required String conversationId,
    required String rev,
    required String op,
    String? title,
    List<String>? staffIds,
    ({String classId, String sectionId})? section,
  }) async {
    await _postData("/api/v1/school-chat/groups", {
      "op": op,
      "conversationId": conversationId,
      "rev": rev,
      "title": ?title,
      "staffIds": ?staffIds,
      if (section != null)
        "section": {"classId": section.classId, "sectionId": section.sectionId},
    });
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
