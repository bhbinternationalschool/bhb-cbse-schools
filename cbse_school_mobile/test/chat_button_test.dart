// The chat button on every home (director, 29 Oct 2026) and staff-made
// groups in the school-chat list.
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/core/push/chat_button.dart";
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

Widget _app(Widget child, {ThemeMode mode = ThemeMode.light}) => LocaleScope(
  controller: LocaleController(),
  child: MaterialApp(
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    locale: const Locale("en"),
    themeMode: mode,
    theme: ThemeData.light(),
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

  testWidgets("the chat button shows the server's unread count and re-reads it after the chat closes", (tester) async {
    final requests = <http.Request>[];
    var unread = 3;
    final client = MockClient((req) async {
      requests.add(req);
      if (req.url.path == "/api/v1/school-chat/unread") return _ok({"unread": unread, "blocked": false});
      return http.Response("{}", 404);
    });
    var opened = 0;
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          Scaffold(
            appBar: AppBar(
              backgroundColor: const Color(0xFF0B1F4D),
              actions: [
                SchoolChatButton(
                  api: ApiClient(_config, cache: _memoryCache()),
                  studentId: "stu1",
                  onOpen: () async {
                    opened += 1;
                    unread = 0; // the member read everything
                  },
                ),
              ],
            ),
          ),
        ),
      );
      await _settle(tester);
      expect(find.byKey(const Key("chat-button")), findsOneWidget);
      expect(find.byKey(const Key("chat-button-count")), findsOneWidget);
      expect(find.text("3"), findsOneWidget);
      final first = requests.firstWhere((r) => r.url.path == "/api/v1/school-chat/unread");
      expect(first.url.queryParameters["studentId"], "stu1", reason: "a family always says which child");

      await tester.tap(find.byKey(const Key("chat-button")));
      await _settle(tester);
      expect(opened, 1);
      expect(find.text("3"), findsNothing, reason: "the count is re-read when the chat closes");
    }, () => client);
  });

  testWidgets("a failed count read shows the button without a number", (tester) async {
    final client = MockClient((req) async => http.Response("{}", 503));
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          Scaffold(
            appBar: AppBar(
              actions: [SchoolChatButton(api: ApiClient(_config, cache: _memoryCache()), onOpen: () async {})],
            ),
          ),
        ),
      );
      await _settle(tester);
    }, () => client);
    expect(find.byKey(const Key("chat-button")), findsOneWidget);
    expect(find.byKey(const Key("chat-button-count")), findsNothing);
  });

  testWidgets("a group a member of staff made is listed under Groups", (tester) async {
    final client = MockClient((req) async {
      if (req.url.path == "/api/v1/school-chat/conversations") {
        return _ok({
          "blocked": false,
          "muted": false,
          "moderator": false,
          "conversations": [
            {"id": "grp:abc123", "kind": "group", "title": "Annual day committee", "lastMessage": "hello", "lastMessageAt": "2026-10-29T04:30:00.000Z", "unread": 1, "oversight": false},
            {"id": "dms:s1:s2", "kind": "dm_staff", "title": "Mrs Rao", "lastMessage": null, "lastMessageAt": null, "unread": 0, "oversight": false},
          ],
        });
      }
      return http.Response("{}", 404);
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(_app(SchoolChatScreen(api: ApiClient(_config, cache: _memoryCache()))));
      await _settle(tester);
    }, () => client);
    final groupsY = tester.getTopLeft(find.text("Groups")).dy;
    final directY = tester.getTopLeft(find.text("Direct chats")).dy;
    final rowY = tester.getTopLeft(find.text("Annual day committee")).dy;
    expect(rowY > groupsY && rowY < directY, isTrue, reason: "the staff-made group sits in Groups, not Direct chats");
    expect(find.byIcon(Icons.groups_outlined), findsOneWidget);
  });

  test("every staff and parent home has the chat button", () {
    for (final f in [
      "lib/features/home/home_screen.dart",
      "lib/features/staff/teacher_home_screen.dart",
      "lib/features/staff/principal_home_screen.dart",
      "lib/features/staff/desk_home_screen.dart",
      "lib/features/staff/driver_home_screen.dart",
    ]) {
      expect(File(f).readAsStringSync().contains("SchoolChatButton("), isTrue, reason: "$f has no chat button");
    }
  });

  for (final dark in [false, true]) {
    testWidgets("layout: the header chat button with its badge (${dark ? "375 dark" : "desktop light"})", (tester) async {
      tester.view.physicalSize = dark ? const Size(375 * 3, 200 * 3) : const Size(1280, 200);
      tester.view.devicePixelRatio = dark ? 3 : 1;
      addTearDown(tester.view.reset);
      final client = MockClient((req) async => _ok({"unread": 4, "blocked": false}));
      await http.runWithClient(() async {
        await tester.pumpWidget(
          _app(
            mode: dark ? ThemeMode.dark : ThemeMode.light,
            Scaffold(
              appBar: AppBar(
                backgroundColor: const Color(0xFF0B1F4D),
                title: const Text("Home", style: TextStyle(color: Colors.white)),
                actions: [
                  SchoolChatButton(api: ApiClient(_config, cache: _memoryCache()), onOpen: () async {}),
                  IconButton(onPressed: () {}, icon: const Icon(Icons.notifications_outlined, color: Colors.white)),
                ],
              ),
            ),
          ),
        );
        await _settle(tester);
      }, () => client);
      expect(find.text("4"), findsOneWidget);
      // The badge sits on the chat icon, inside the 375 px header.
      final badge = tester.getRect(find.byKey(const Key("chat-button-count")));
      final button = tester.getRect(find.byKey(const Key("chat-button")));
      expect(button.overlaps(badge), isTrue);
      expect(button.right <= (dark ? 375 : 1280), isTrue);
    });
  }
}
