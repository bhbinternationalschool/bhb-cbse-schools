// The notifications list and its settings (20 Oct 2026). The ERP decides who
// receives what by role; the app shows the signed-in person's own list
// (GET /api/v1/notifications), marks read, and saves mute / voice / quiet
// hours on the server (POST, op prefs, with the revision it loaded).
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/core/push/notification_bell.dart";
import "package:cbse_school_mobile/core/push/notifications_screen.dart";
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

JsonCache _memoryCache() =>
    JsonCache(baseDir: () async => throw const FileSystemException("test"));

Widget _app(Widget child, {Locale locale = const Locale("en")}) => LocaleScope(
  controller: LocaleController(),
  child: MaterialApp(
    locale: locale,
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    home: child,
  ),
);

Map<String, Object?> _inbox({
  int unread = 2,
  List<String> muted = const [],
  String? prefsRev = "2026-10-20T05:00:00.000001Z",
}) => {
  "recipient": {"type": "staff", "id": "s_prin"},
  "unread": unread,
  "prefs": {
    "mutedTopics": muted,
    "voice": true,
    "quietEnabled": true,
    "quietStart": "21:00",
    "quietEnd": "07:00",
  },
  "prefsRev": prefsRev,
  "items": [
    {
      "id": "nf_1",
      "kind": "staff_leave.requested",
      "topic": "leave",
      "title": "Leave request · Asha",
      "body": "CL 21 Oct",
      "titleHi": "",
      "bodyHi": "",
      "link": "/leave-approvals",
      "groupCount": 1,
      "urgent": false,
      "readAt": null,
      "createdAt": "2026-10-20T05:00:00Z",
    },
    {
      "id": "nf_2",
      "kind": "fees.received",
      "topic": "fees",
      "title": "5 fees received today",
      "body": "Ravi (II A) · cash · receipt R5",
      "titleHi": "आज 5 फीस जमा",
      "bodyHi": "",
      "link": "/notifications",
      "groupCount": 5,
      "urgent": false,
      "readAt": null,
      "createdAt": "2026-10-20T04:00:00Z",
    },
    {
      "id": "nf_3",
      "kind": "document.received",
      "topic": "document",
      "title": "Aadhaar received",
      "body": "Class III",
      "link": "/documents",
      "groupCount": 1,
      "readAt": "2026-10-19T10:00:00Z",
      "createdAt": "2026-10-19T09:00:00Z",
    },
  ],
};

/// UTF-8 (the titles carry ₹ and Hindi); http.Response(String) is Latin-1.
http.Response _json(Object body, int status) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {"content-type": "application/json; charset=utf-8"},
);

class _Server {
  _Server({this.failFirstGet = false, this.conflictOnSave = false});
  final bool failFirstGet;
  final bool conflictOnSave;
  int gets = 0;
  final posts = <Map<String, dynamic>>[];

  MockClient get client => MockClient((req) async {
    if (req.url.path != "/api/v1/notifications") {
      return http.Response('{"data":{}}', 200);
    }
    if (req.method == "GET") {
      gets += 1;
      if (failFirstGet && gets == 1) {
        return http.Response('{"ok":false,"error":"Could not load"}', 503);
      }
      return _json({"ok": true, "data": _inbox()}, 200);
    }
    final body = jsonDecode(req.body) as Map<String, dynamic>;
    posts.add(body);
    if (body["op"] == "prefs" && conflictOnSave) {
      return http.Response(
        jsonEncode({
          "ok": false,
          "error": "Your settings were changed on another device",
          "prefs": {
            "mutedTopics": ["message"],
            "voice": true,
            "quietEnabled": true,
            "quietStart": "21:00",
            "quietEnd": "07:00",
          },
          "prefsRev": "r9",
        }),
        409,
      );
    }
    if (body["op"] == "prefs") {
      return http.Response(
        jsonEncode({"ok": true, "prefs": body["prefs"], "prefsRev": "r2"}),
        200,
      );
    }
    return http.Response('{"ok":true,"marked":1}', 200);
  });
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    // Real time for the HTTP/JSON futures, fake time for the frames.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 5)),
    );
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _run(
  WidgetTester tester,
  _Server server,
  Future<void> Function() body,
) async {
  tester.view.physicalSize = const Size(420, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await http.runWithClient(body, () => server.client);
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "c",
      "bhb_persona": "staff",
    });
  });

  testWidgets(
    "lists my notifications; a tap marks it read and opens its link",
    (tester) async {
      final server = _Server();
      final opened = <String>[];
      await _run(tester, server, () async {
        final api = ApiClient(_config, cache: _memoryCache());
        await tester.pumpWidget(
          _app(
            Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => openNotifications(context, api, opened.add),
                  child: const Text("open"),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text("open"));
        await _settle(tester);
        expect(find.text("Leave request · Asha"), findsOneWidget);
        expect(
          find.text("5 fees received today  ×5"),
          findsOneWidget,
          reason: "a folded burst shows its count",
        );
        expect(find.text("Aadhaar received"), findsOneWidget);
        expect(find.byKey(const Key("notify-mark-all")), findsOneWidget);
        expect(
          find.byIcon(Icons.circle),
          findsNWidgets(2),
          reason: "two unread",
        );

        await tester.tap(find.byKey(const Key("notify-item-nf_1")));
        await _settle(tester);
        expect(server.posts.first, {
          "op": "read",
          "ids": ["nf_1"],
        });
        expect(opened, [
          "/leave-approvals",
        ], reason: "the home opens the item's screen");
        await tester.pumpAndSettle();
        expect(
          find.text("Leave request · Asha"),
          findsNothing,
          reason: "the list closed",
        );
      });
    },
  );

  testWidgets("mark all read posts read_all", (tester) async {
    final server = _Server();
    await _run(tester, server, () async {
      await tester.pumpWidget(
        _app(
          NotificationsScreen(api: ApiClient(_config, cache: _memoryCache())),
        ),
      );
      await _settle(tester);
      await tester.tap(find.byKey(const Key("notify-mark-all")));
      await _settle(tester);
      expect(server.posts.single, {"op": "read_all"});
      expect(server.gets, 2, reason: "re-read after marking");
    });
  });

  testWidgets("a failed read says so and offers Retry — never an empty list", (
    tester,
  ) async {
    final server = _Server(failFirstGet: true);
    await _run(tester, server, () async {
      await tester.pumpWidget(
        _app(
          NotificationsScreen(api: ApiClient(_config, cache: _memoryCache())),
        ),
      );
      await _settle(tester);
      expect(find.text("Could not load notifications"), findsOneWidget);
      expect(find.text("No notifications yet"), findsNothing);
      await tester.tap(find.byKey(const Key("notify-retry")));
      await _settle(tester);
      expect(find.text("Leave request · Asha"), findsOneWidget);
    });
  });

  testWidgets("in Hindi, the Hindi title is shown when the server sent one", (
    tester,
  ) async {
    final server = _Server();
    await _run(tester, server, () async {
      await tester.pumpWidget(
        _app(
          NotificationsScreen(api: ApiClient(_config, cache: _memoryCache())),
          locale: const Locale("hi"),
        ),
      );
      await _settle(tester);
      expect(find.text("आज 5 फीस जमा  ×5"), findsOneWidget);
      expect(
        find.text("Leave request · Asha"),
        findsOneWidget,
        reason: "no Hindi text → English",
      );
    });
  });

  testWidgets(
    "settings: mute a topic and turn voice off, saved with the loaded revision",
    (tester) async {
      final server = _Server();
      await _run(tester, server, () async {
        await tester.pumpWidget(
          _app(
            NotificationsScreen(api: ApiClient(_config, cache: _memoryCache())),
          ),
        );
        await _settle(tester);
        await tester.tap(find.byKey(const Key("notify-settings")));
        await _settle(tester);
        expect(find.text("Ring my phone for"), findsOneWidget);
        expect(
          find.text("21:00"),
          findsOneWidget,
          reason: "quiet hours default 9 pm – 7 am",
        );
        expect(find.text("07:00"), findsOneWidget);

        await tester.tap(find.byKey(const Key("notify-topic-fees")));
        await tester.tap(find.byKey(const Key("notify-voice")));
        await tester.pump();
        await tester.tap(find.byKey(const Key("notify-save")));
        await _settle(tester);
        final save = server.posts.single;
        expect(save["op"], "prefs");
        expect(save["base"], "2026-10-20T05:00:00.000001Z");
        expect((save["prefs"] as Map)["mutedTopics"], ["fees"]);
        expect((save["prefs"] as Map)["voice"], false);
        expect((save["prefs"] as Map)["quietStart"], "21:00");
        expect(find.text("Saved"), findsOneWidget);

        // A second save carries the new revision.
        await tester.tap(find.byKey(const Key("notify-save")));
        await _settle(tester);
        expect(server.posts.last["base"], "r2");
      });
    },
  );

  testWidgets(
    "settings: a save from an older copy shows the other device's settings",
    (tester) async {
      final server = _Server(conflictOnSave: true);
      await _run(tester, server, () async {
        await tester.pumpWidget(
          _app(
            NotificationSettingsScreen(
              api: ApiClient(_config, cache: _memoryCache()),
              prefs: const NotifyPrefs(),
              prefsRev: "r1",
            ),
          ),
        );
        await _settle(tester);
        await tester.tap(find.byKey(const Key("notify-save")));
        await _settle(tester);
        expect(
          find.textContaining("changed on another device"),
          findsOneWidget,
        );
        final messages = tester.widget<SwitchListTile>(
          find.byKey(const Key("notify-topic-message")),
        );
        expect(
          messages.value,
          isFalse,
          reason: "the stored settings are now on screen",
        );
      });
    },
  );

  testWidgets("the bell shows the unread count", (tester) async {
    final server = _Server();
    await _run(tester, server, () async {
      await tester.pumpWidget(
        _app(
          Scaffold(
            body: NotificationBellButton(
              api: ApiClient(_config, cache: _memoryCache()),
              onOpenRoute: (_) {},
            ),
          ),
        ),
      );
      await _settle(tester);
      expect(find.byKey(const Key("notify-bell-count")), findsOneWidget);
      expect(find.text("2"), findsOneWidget);
    });
  });

  test("every topic has its spoken clip, in Hindi and English", () {
    final raw = Directory(
      "android/app/src/main/res/raw",
    ).listSync().map((f) => f.uri.pathSegments.last).toSet();
    for (final t in kNotifyTopics) {
      for (final lang in ["hi", "en"]) {
        expect(
          raw.contains("bhb_voice_${t.$1}_$lang.m4a"),
          isTrue,
          reason: "missing clip for ${t.$1} $lang",
        );
      }
    }
  });
}
