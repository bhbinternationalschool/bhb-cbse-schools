// Changing a staff-made group from the app (director, 30 Oct 2026: "after
// making chat groups there is no option to edit the group and remove or add
// members"): the group screen's ⋮ menu — Edit name, Members (add / remove),
// Class section, Leave group — shown only to whoever may use each, every
// change sent with the version it was made against (409 = changed by
// someone else), and the group's history lines drawn as notes.
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
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: TextButton(
            onPressed: () => Navigator.of(
              context,
            ).push(MaterialPageRoute(builder: (_) => child)),
            child: const Text("open"),
          ),
        ),
      ),
    ),
  ),
);

JsonCache _memoryCache() =>
    JsonCache(baseDir: () async => throw const FileSystemException("test"));

http.Response _ok(Object data) => http.Response(
  jsonEncode({"ok": true, "data": data}),
  200,
  headers: {"content-type": "application/json; charset=utf-8"},
);

http.Response _err(int status, String message) => http.Response(
  jsonEncode({
    "ok": false,
    "error": {"code": "x", "message": message},
  }),
  status,
  headers: {"content-type": "application/json; charset=utf-8"},
);

const _grp = "grp:abc123";

/// A staff-made group as the server keeps it.
class _Group {
  _Group({this.me = "s1", this.maker = "s1", this.moderator = false});
  final String me;
  final String maker;
  final bool moderator;
  final requests = <http.Request>[];
  String title = "Annual day";
  List<String> staff = ["s1", "s2", "s3"];
  String section = "";
  int rev = 1;
  final names = {
    "s1": "Asha",
    "s2": "Ravi",
    "s3": "Meena",
    "s4": "Kiran",
    "s5": "Dev",
  };
  final notes = <String>[];

  /// Someone else changes the group before this person's change lands.
  bool raceNext = false;

  bool get _canManage => moderator || (me == maker && staff.contains(maker));

  Map<String, dynamic> _manage() => {
    "rev": "r$rev",
    "members": [
      for (final s in staff) {"id": s, "name": names[s]},
    ],
    "creatorName": names[maker],
    "creatorLeft": !staff.contains(maker),
    "canManage": _canManage,
    "canLeave": staff.contains(me),
    "sectionLabel": section,
    "me": me,
  };

  MockClient client() => MockClient((req) async {
    requests.add(req);
    final p = req.url.path;
    if (p == "/api/v1/school-chat/messages") {
      return _ok({
        "conversation": {
          "title": title,
          "canSend": staff.contains(me),
          "muted": false,
          "manage": _manage(),
        },
        "messages": [
          {
            "id": "m1",
            "senderLabel": "Ravi (staff)",
            "senderKind": "staff",
            "body": "Hello all",
            "createdAt": "2026-10-30T04:30:00.000Z",
            "mine": false,
            "status": "visible",
          },
          for (var i = 0; i < notes.length; i++)
            {
              "id": "n$i",
              "senderLabel": "Group",
              "senderKind": "staff",
              "body": notes[i],
              "createdAt": "2026-10-30T05:00:00.000Z",
              "mine": false,
              "status": "visible",
              "system": true,
            },
        ],
      });
    }
    if (p == "/api/v1/school-chat/contacts") {
      return _ok({
        "staff": [
          for (final e in names.entries)
            if (e.key != me) {"id": e.key, "name": e.value, "role": ""},
        ],
        "families": [],
        "sections": [
          {"classId": "c1", "sectionId": "s1", "label": "Nursery-A"},
        ],
      });
    }
    if (p == "/api/v1/school-chat/groups") {
      final b = jsonDecode(req.body) as Map<String, dynamic>;
      if (raceNext) {
        raceNext = false;
        rev++;
        title = "Changed elsewhere";
      }
      if (b["rev"] != "r$rev") {
        return _err(
          409,
          "This group was changed by someone else — reload it and try again.",
        );
      }
      final op = b["op"] as String;
      if (op != "leave" && !_canManage) {
        return _err(403, "Only the maker or a moderator can change it.");
      }
      final ids = ((b["staffIds"] as List?) ?? const []).cast<String>();
      switch (op) {
        case "rename":
          title = b["title"] as String;
          notes.add("${names[me]} renamed the group to \"$title\"");
        case "addStaff":
          staff = [...staff, ...ids];
          notes.add(
            "${names[me]} added ${ids.map((i) => names[i]).join(", ")}",
          );
        case "removeStaff":
          if (staff.length - ids.length < 2) {
            return _err(400, "A group needs at least two staff.");
          }
          staff = staff.where((s) => !ids.contains(s)).toList();
          notes.add(
            "${names[me]} removed ${ids.map((i) => names[i]).join(", ")}",
          );
        case "setSection":
          section = "Nursery-A";
        case "clearSection":
          section = "";
        case "leave":
          staff = staff.where((s) => s != me).toList();
      }
      rev++;
      return _ok({
        "id": _grp,
        "title": title,
        "rev": "r$rev",
        "left": op == "leave",
      });
    }
    return http.Response("{}", 404);
  });

  List<Map<String, dynamic>> changes() => [
    for (final r in requests)
      if (r.url.path == "/api/v1/school-chat/groups")
        jsonDecode(r.body) as Map<String, dynamic>,
  ];
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _open(WidgetTester tester, _Group g) async {
  await tester.pumpWidget(
    _app(
      SchoolChatThreadScreen(
        api: ApiClient(_config, cache: _memoryCache()),
        conversationId: _grp,
        title: "Annual day",
        pollEvery: const Duration(hours: 1),
      ),
    ),
  );
  await tester.tap(find.text("open"));
  await _settle(tester);
}

Future<void> _menu(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key("school-chat-group-menu")));
  await _settle(tester);
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "cookie-A",
    });
  });

  testWidgets("the maker sees every item; renaming sends the version read", (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375 * 3, 812 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final g = _Group();
    await http.runWithClient(() async {
      await _open(tester, g);
      await _menu(tester);
      expect(find.text("Edit name"), findsOneWidget);
      expect(find.text("Members (3)"), findsOneWidget);
      expect(find.text("Class section"), findsOneWidget);
      expect(find.text("Leave group"), findsOneWidget);
      await tester.tap(find.text("Edit name"));
      await _settle(tester);
      await tester.enterText(
        find.byKey(const Key("school-chat-group-name")),
        "Annual day committee",
      );
      await tester.tap(find.byKey(const Key("school-chat-group-name-save")));
      await _settle(tester);
    }, g.client);
    final c = g.changes().single;
    expect(c["op"], "rename");
    expect(c["rev"], "r1");
    expect(c["conversationId"], _grp);
    expect(c["title"], "Annual day committee");
    expect(
      find.text("Annual day committee"),
      findsOneWidget,
      reason: "the header shows the new name",
    );
    // The history line is a note, not a bubble.
    expect(find.byKey(const Key("school-chat-note-n0")), findsOneWidget);
    expect(find.byKey(const Key("school-chat-msg-n0")), findsNothing);
    expect(find.byKey(const Key("school-chat-msg-m1")), findsOneWidget);
    expect(tester.takeException(), isNull, reason: "no overflow at 375 px");
  });

  testWidgets("Members: add with the picker, remove; two staff is the floor", (
    tester,
  ) async {
    final g = _Group();
    await http.runWithClient(() async {
      await _open(tester, g);
      await _menu(tester);
      await tester.tap(find.text("Members (3)"));
      await _settle(tester);
      expect(find.text("Asha (you)"), findsOneWidget);
      expect(find.byKey(const Key("school-chat-remove-s1")), findsNothing);
      // Add Kiran.
      await tester.tap(find.byKey(const Key("school-chat-add-member")));
      await _settle(tester);
      expect(
        find.byKey(const Key("school-chat-pick-s2")),
        findsNothing,
        reason: "people already in it are not offered",
      );
      await tester.tap(find.byKey(const Key("school-chat-pick-s4")));
      await tester.pump();
      await tester.tap(find.byKey(const Key("school-chat-add-picked")));
      await _settle(tester);
      expect(find.text("Kiran"), findsOneWidget);
      // Remove Ravi.
      await tester.tap(find.byKey(const Key("school-chat-remove-s2")));
      await _settle(tester);
      await tester.tap(find.byKey(const Key("school-chat-confirm")));
      await _settle(tester);
      expect(find.text("Ravi"), findsNothing);
      // Remove Meena: down to two (Asha, Kiran) — the buttons go dead.
      await tester.tap(find.byKey(const Key("school-chat-remove-s3")));
      await _settle(tester);
      await tester.tap(find.byKey(const Key("school-chat-confirm")));
      await _settle(tester);
      final last = tester.widget<IconButton>(
        find.byKey(const Key("school-chat-remove-s4")),
      );
      expect(last.onPressed, isNull, reason: "a group keeps two staff");
    }, g.client);
    final ops = g.changes();
    expect(ops.map((c) => c["op"]), ["addStaff", "removeStaff", "removeStaff"]);
    expect(ops[0]["staffIds"], ["s4"]);
    expect(ops[0]["rev"], "r1");
    expect(ops[1]["staffIds"], ["s2"]);
    expect(
      ops[1]["rev"],
      "r2",
      reason: "each change uses the version re-read after the last",
    );
    expect(g.staff, ["s1", "s4"]);
  });

  testWidgets("a member who did not make it: Members and Leave only", (
    tester,
  ) async {
    final g = _Group(me: "s2");
    await http.runWithClient(() async {
      await _open(tester, g);
      await _menu(tester);
      expect(find.text("Edit name"), findsNothing);
      expect(find.text("Class section"), findsNothing);
      expect(find.text("Members (3)"), findsOneWidget);
      expect(find.text("Leave group"), findsOneWidget);
      await tester.tap(find.text("Members (3)"));
      await _settle(tester);
      expect(find.byKey(const Key("school-chat-add-member")), findsNothing);
      expect(find.byIcon(Icons.person_remove_outlined), findsNothing);
    }, g.client);
  });

  testWidgets(
    "the maker has left: members are told only moderators can change it",
    (tester) async {
      final g = _Group(me: "s2")..staff = ["s2", "s3"];
      await http.runWithClient(() async {
        await _open(tester, g);
        await _menu(tester);
        await tester.tap(find.text("Members (2)"));
        await _settle(tester);
      }, g.client);
      expect(find.byKey(const Key("school-chat-creator-left")), findsOneWidget);
      expect(
        find.textContaining("only a chat moderator can change it now"),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    "changed by someone else first: the 409 is shown and the group re-read",
    (tester) async {
      final g = _Group()..raceNext = true;
      await http.runWithClient(() async {
        await _open(tester, g);
        await _menu(tester);
        await tester.tap(find.text("Class section"));
        await _settle(tester);
        await tester.tap(find.byKey(const Key("school-chat-section-c1-s1")));
        await _settle(tester);
      }, g.client);
      expect(find.textContaining("changed by someone else"), findsOneWidget);
      expect(g.section, "", reason: "nothing was saved");
      expect(find.text("Changed elsewhere"), findsOneWidget, reason: "re-read");
      final reads = g.requests
          .where((r) => r.url.path == "/api/v1/school-chat/messages")
          .length;
      expect(reads, greaterThanOrEqualTo(2));
    },
  );

  testWidgets("Leave group: confirmed, sent, and the screen closes", (
    tester,
  ) async {
    final g = _Group(me: "s3");
    await http.runWithClient(() async {
      await _open(tester, g);
      await _menu(tester);
      await tester.tap(find.text("Leave group"));
      await _settle(tester);
      await tester.tap(find.byKey(const Key("school-chat-confirm")));
      await _settle(tester);
    }, g.client);
    expect(g.changes().single["op"], "leave");
    expect(g.staff, ["s1", "s2"]);
    expect(find.text("open"), findsOneWidget, reason: "back on the list");
  });

  testWidgets("a class or subject group (no manage) has no menu", (
    tester,
  ) async {
    final client = MockClient((req) async {
      if (req.url.path == "/api/v1/school-chat/messages") {
        return _ok({
          "conversation": {
            "title": "Nursery-A · Class group",
            "canSend": true,
            "muted": false,
          },
          "messages": [],
        });
      }
      return http.Response("{}", 404);
    });
    await http.runWithClient(() async {
      await _open(tester, _Group());
    }, () => client);
    expect(find.byKey(const Key("school-chat-group-menu")), findsNothing);
  });
}
