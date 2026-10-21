import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/modules/school_chat_screen.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:flutter_test/flutter_test.dart";
import "package:http/http.dart" as http;
import "package:http/testing.dart";

const _config = AppConfig(
  apiBaseUrl: "https://erp.example.invalid",
  tenantSlug: "t",
  schoolName: "s",
  supabaseUrl: "",
  supabaseAnonKey: "",
);

Widget _app(Widget child) => LocaleScope(
  controller: LocaleController(),
  child: MaterialApp(
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    locale: const Locale("en"),
    home: child,
  ),
);

JsonCache _memoryCache() =>
    JsonCache(baseDir: () async => throw const FileSystemException("test"));

http.Response _ok(Object data) => http.Response(
  jsonEncode({"ok": true, "data": data}),
  200,
  headers: {"content-type": "application/json; charset=utf-8"},
);

const _cls = "cls:2026-27:c1:s1";

Map<String, dynamic> _msg(
  String id,
  String body, {
  bool mine = false,
  String status = "visible",
  String? notice,
}) => {
  "id": id,
  "senderLabel": mine ? "Aarav (Nursery-A)" : "Riya (Nursery-A)",
  "senderKind": "student",
  "body": body,
  "createdAt": "2026-10-20T04:30:00.000Z",
  "mine": mine,
  "status": status,
  "notice": ?notice,
};

class _Server {
  final requests = <http.Request>[];
  List<Map<String, dynamic>> messages = [_msg("m1", "Good morning")];
  bool muted = false;
  bool blocked = false;
  Map<String, dynamic> sendReply = {"held": false, "notice": null};

  MockClient client() => MockClient((req) async {
    requests.add(req);
    final p = req.url.path;
    if (p == "/api/v1/school-chat/conversations") {
      return _ok({
        "blocked": blocked,
        "muted": false,
        "moderator": false,
        "conversations": blocked
            ? []
            : [
                {
                  "id": _cls,
                  "kind": "class",
                  "title": "Nursery-A · Class group",
                  "lastMessage": "Good morning",
                  "lastMessageAt": "2026-10-20T04:30:00.000Z",
                  "unread": 2,
                  "oversight": false,
                },
                {
                  "id": "sub:2026-27:c1:s1:math",
                  "kind": "subject",
                  "title": "Nursery-A · Mathematics",
                  "lastMessage": null,
                  "lastMessageAt": null,
                  "unread": 0,
                  "oversight": false,
                },
                {
                  "id": "dmp:t1:stu1",
                  "kind": "dm_parent",
                  "title": "Mrs Rao",
                  "lastMessage": null,
                  "lastMessageAt": null,
                  "unread": 0,
                  "oversight": false,
                },
              ],
      });
    }
    if (p == "/api/v1/school-chat/messages") {
      return _ok({
        "conversation": {
          "title": "Nursery-A · Class group",
          "canSend": !muted,
          "muted": muted,
        },
        "messages": messages,
      });
    }
    if (p == "/api/v1/school-chat/send") {
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      final held = sendReply["held"] == true;
      messages = [
        ...messages,
        _msg(
          "m${messages.length + 1}",
          body["body"] as String,
          mine: true,
          status: held ? "held" : "visible",
          notice: sendReply["notice"] as String?,
        ),
      ];
      return _ok(sendReply);
    }
    return http.Response("{}", 404);
  });
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "cookie-A",
    });
  });

  testWidgets(
    "the family's list: groups and direct chats for the picked child",
    (tester) async {
      final server = _Server();
      await http.runWithClient(() async {
        await tester.pumpWidget(
          _app(
            SchoolChatScreen(
              api: ApiClient(_config, cache: _memoryCache()),
              studentId: "stu1",
              childName: "Aarav",
              classTeacherThread: (_) => const SizedBox(),
            ),
          ),
        );
        await _settle(tester);
      }, server.client);

      expect(find.text("Groups"), findsOneWidget);
      expect(find.text("Direct chats"), findsOneWidget);
      expect(find.text("Nursery-A · Class group"), findsOneWidget);
      expect(find.text("Nursery-A · Mathematics"), findsOneWidget);
      expect(find.text("Mrs Rao"), findsOneWidget);
      expect(find.text("Message the class teacher"), findsOneWidget);
      expect(find.text("2"), findsOneWidget, reason: "unread badge");
      final list = server.requests.firstWhere(
        (r) => r.url.path == "/api/v1/school-chat/conversations",
      );
      expect(
        list.url.queryParameters["studentId"],
        "stu1",
        reason: "the server is always told which child the family acts for",
      );
    },
  );

  testWidgets("a paused login sees why, and no chats", (tester) async {
    final server = _Server()..blocked = true;
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          SchoolChatScreen(
            api: ApiClient(_config, cache: _memoryCache()),
            studentId: "stu1",
          ),
        ),
      );
      await _settle(tester);
    }, server.client);
    expect(find.byKey(const Key("school-chat-paused")), findsOneWidget);
    expect(find.text("Nursery-A · Class group"), findsNothing);
  });

  testWidgets("a held message stays with the sender, marked waiting for review", (
    tester,
  ) async {
    final server = _Server()
      ..sendReply = {
        "held": true,
        "notice":
            "Your message is waiting for review — a teacher will check it before others can see it.",
      };
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          SchoolChatThreadScreen(
            api: ApiClient(_config, cache: _memoryCache()),
            conversationId: _cls,
            title: "Nursery-A · Class group",
            studentId: "stu1",
            childName: "Aarav",
            pollEvery: const Duration(hours: 1),
          ),
        ),
      );
      await _settle(tester);
      expect(find.text("Writing as Aarav"), findsOneWidget);
      expect(find.text("Good morning"), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key("school-chat-input")),
        "you are stupid",
      );
      await tester.tap(find.byKey(const Key("school-chat-send")));
      await _settle(tester);
    }, server.client);

    final send = server.requests.firstWhere(
      (r) => r.url.path == "/api/v1/school-chat/send",
    );
    final sent = jsonDecode(send.body) as Map<String, dynamic>;
    expect(sent["studentId"], "stu1");
    expect(sent["conversationId"], _cls);
    expect(find.text("you are stupid"), findsOneWidget);
    expect(find.text("Waiting for review"), findsOneWidget);
    expect(find.byKey(const Key("school-chat-notice")), findsOneWidget);
  });

  testWidgets("a muted member reads but has no box to type in", (tester) async {
    final server = _Server()..muted = true;
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          SchoolChatThreadScreen(
            api: ApiClient(_config, cache: _memoryCache()),
            conversationId: _cls,
            title: "Nursery-A · Class group",
            studentId: "stu1",
            pollEvery: const Duration(hours: 1),
          ),
        ),
      );
      await _settle(tester);
    }, server.client);
    expect(find.text("Good morning"), findsOneWidget);
    expect(find.byKey(const Key("school-chat-muted")), findsOneWidget);
    expect(find.byKey(const Key("school-chat-input")), findsNothing);
  });

  testWidgets("a removed message shows as removed, not its text", (
    tester,
  ) async {
    final server = _Server()
      ..messages = [
        _msg(
          "m1",
          "This message was removed by the school.",
          mine: true,
          status: "removed",
        ),
      ];
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          SchoolChatThreadScreen(
            api: ApiClient(_config, cache: _memoryCache()),
            conversationId: _cls,
            title: "Nursery-A · Class group",
            studentId: "stu1",
            pollEvery: const Duration(hours: 1),
          ),
        ),
      );
      await _settle(tester);
    }, server.client);
    expect(find.text("Removed by the school"), findsOneWidget);
  });
}
