// Homework / classwork / notice cards in a class chat (director, 29 Oct 2026).
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

Widget _app(Widget child, {bool dark = false}) => LocaleScope(
  controller: LocaleController(),
  child: MaterialApp(
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    locale: const Locale("en"),
    themeMode: dark ? ThemeMode.dark : ThemeMode.light,
    darkTheme: ThemeData.dark(),
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

Map<String, dynamic> _thread({required bool staff}) => {
  "conversation": {
    "title": "Nursery-A · Class group",
    "canSend": true,
    "muted": false,
    "compose": staff
        ? {
            "subjects": [
              {"id": "math", "name": "Mathematics"},
            ],
            "fixedSubject": "",
          }
        : null,
  },
  "messages": [
    {
      "id": "hw:p1",
      "senderLabel": "Mrs Rao (staff)",
      "senderKind": "staff",
      "body": "Homework · Mathematics: Ex 5.2 (due 2026-11-02)",
      "createdAt": "2026-10-29T04:30:00.000Z",
      "mine": false,
      "status": "visible",
      "card": {
        "kind": "homework",
        "refId": "p1",
        "subject": "Mathematics",
        "title": "Ex 5.2 Q1-5",
        "body": "Do questions 1 to 5",
        "dueAt": "2026-11-02",
        "date": "2026-10-29",
        "attachments": [
          {"id": "a1", "label": "Page 1", "kind": "image", "url": "/x"},
        ],
      },
    },
    {
      "id": "cw:d1",
      "senderLabel": "Mrs Rao (staff)",
      "senderKind": "staff",
      "body": "Classwork: Counted to 20",
      "createdAt": "2026-10-29T05:00:00.000Z",
      "mine": false,
      "status": "visible",
      "card": {
        "kind": "classwork",
        "refId": "d1",
        "subject": "",
        "title": "Counted to 20",
        "body": "Number songs",
        "dueAt": "",
        "date": "2026-10-29",
        "attachments": [],
      },
    },
    {
      "id": "m3",
      "senderLabel": "Mrs Rao (staff)",
      "senderKind": "staff",
      "body": "Notice: PTM on Saturday\n\n10 am",
      "createdAt": "2026-10-29T06:00:00.000Z",
      "mine": false,
      "status": "visible",
    },
  ],
};

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

  for (final dark in [false, true]) {
    testWidgets("a family sees homework, classwork and notice cards and no post button (${dark ? "375 dark" : "light"})", (tester) async {
      tester.view.physicalSize = const Size(375 * 3, 812 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final client = MockClient((req) async => _ok(_thread(staff: false)));
      await http.runWithClient(() async {
        await tester.pumpWidget(
          _app(
            dark: dark,
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
      }, () => client);
      expect(find.byKey(const Key("school-chat-card-p1")), findsOneWidget);
      expect(find.text("HOMEWORK · Mathematics"), findsOneWidget);
      expect(find.text("Ex 5.2 Q1-5"), findsOneWidget);
      expect(find.byKey(const Key("school-chat-card-due")), findsOneWidget);
      expect(find.text("1 file — open in Homework"), findsOneWidget);
      expect(find.byKey(const Key("school-chat-card-d1")), findsOneWidget);
      expect(find.text("CLASSWORK"), findsOneWidget);
      expect(find.byKey(const Key("school-chat-notice-card")), findsOneWidget);
      expect(find.text("PTM on Saturday\n\n10 am"), findsOneWidget);
      expect(find.byKey(const Key("school-chat-post-work")), findsNothing, reason: "families never post work");
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets("a teacher posts classwork from the class chat: one POST to /work", (tester) async {
    final posts = <http.Request>[];
    final client = MockClient((req) async {
      if (req.method == "POST") {
        posts.add(req);
        return _ok({"kind": "classwork", "refId": "d2"});
      }
      return _ok(_thread(staff: true));
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          SchoolChatThreadScreen(
            api: ApiClient(_config, cache: _memoryCache()),
            conversationId: _cls,
            title: "Nursery-A · Class group",
            pollEvery: const Duration(hours: 1),
          ),
        ),
      );
      await _settle(tester);
      await tester.tap(find.byKey(const Key("school-chat-post-work")));
      await _settle(tester);
      expect(find.byKey(const Key("school-chat-post-homework")), findsOneWidget);
      await tester.tap(find.byKey(const Key("school-chat-post-classwork")));
      await _settle(tester);
      await tester.enterText(find.byKey(const Key("school-chat-work-title")), "Counted to 30");
      await tester.tap(find.byKey(const Key("school-chat-work-post")));
      await _settle(tester);
    }, () => client);
    expect(posts, hasLength(1));
    expect(posts.single.url.path, "/api/v1/school-chat/work");
    final body = jsonDecode(posts.single.body) as Map<String, dynamic>;
    expect(body["kind"], "classwork");
    expect(body["conversationId"], _cls);
    expect(body["title"], "Counted to 30");
  });
}
