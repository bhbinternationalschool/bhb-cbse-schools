// "My pending work" on the staff homes (29 Oct 2026).
//
// The card reads /api/v1/staff/pending-work — the same computation as the
// reminders the school sends — and shows each kind of work as one row that
// opens through the home's deep-link switch. Nothing pending = no card; a
// part the server could not check is said so, never left out.
//
// Screenshot at 375 px: `flutter test --update-goldens --dart-define=SHOTS=true test/pending_work_card_test.dart`.
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/features/staff/pending_work_card.dart";
import "package:flutter/material.dart";
import "package:flutter/services.dart";
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

const _shots = bool.fromEnvironment("SHOTS");

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {"content-type": "application/json; charset=utf-8"},
);

final _busy = {
  "date": "2026-10-29",
  "items": [
    {
      "rule": "punch",
      "label": "Punch-in",
      "title": "You have not punched in today",
      "body": "Please punch in from the staff app.",
      "lines": ["Punch in for today"],
      "count": 1,
      "link": "/my-attendance",
    },
    {
      "rule": "register",
      "label": "Class register",
      "title": "Today's register is not taken",
      "body": "Take attendance: Class 5 · A register",
      "lines": ["Class 5 · A register"],
      "count": 1,
      "link": "/attendance",
    },
    {
      "rule": "marks",
      "label": "Exam marks",
      "title": "Marks to enter · due 31 Oct",
      "body": "Half-yearly: Class 5 · A · Maths",
      "lines": ["Half-yearly: Class 5 · A · Maths"],
      "count": 1,
      "link": "/marks",
      "dueOn": "2026-10-31",
      "overdue": false,
    },
  ],
  "unknown": [
    {"rule": "homework", "label": "Homework"},
  ],
};

Future<List<String>> _pump(WidgetTester tester, Map<String, dynamic> data) async {
  FlutterSecureStorage.setMockInitialValues({"bhb_session_cookie": "c"});
  tester.view.physicalSize = const Size(375 * 3, 812 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final opened = <String>[];
  final server = MockClient((req) async {
    if (req.url.path == "/api/v1/staff/pending-work") return _json({"data": data});
    return _json({"data": {}});
  });
  await http.runWithClient(() async {
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: "Roboto"),
        home: Scaffold(
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              PendingWorkCard(
                api: ApiClient(
                  _config,
                  cache: JsonCache(baseDir: () async => throw const FileSystemException("test")),
                ),
                onOpen: opened.add,
              ),
            ],
          ),
        ),
      ),
    );
    for (var i = 0; i < 12; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }, () => server);
  return opened;
}

/// Real glyphs for the screenshot only (the test font draws squares).
Future<void> _loadFonts() async {
  if (!_shots) return;
  Future<ByteData> read(String p) async => ByteData.view(Uint8List.fromList(File(p).readAsBytesSync()).buffer);
  final flutterRoot = Platform.environment["FLUTTER_ROOT"] ?? "";
  final fonts = "$flutterRoot/bin/cache/artifacts/material_fonts";
  final text = FontLoader("Roboto")..addFont(read("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"));
  await text.load();
  final icons = File("$fonts/MaterialIcons-Regular.otf");
  if (icons.existsSync()) {
    final l = FontLoader("MaterialIcons")..addFont(read(icons.path));
    await l.load();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(_loadFonts);

  testWidgets("shows each pending kind, opens its screen, says what could not be checked", (tester) async {
    final opened = await _pump(tester, _busy);
    expect(find.byKey(const Key("pending-work-card")), findsOneWidget);
    expect(find.text("My pending work"), findsOneWidget);
    expect(find.text("You have not punched in today"), findsOneWidget);
    expect(find.text("Today's register is not taken"), findsOneWidget);
    expect(find.text("Class 5 · A register"), findsOneWidget);
    expect(find.text("Marks to enter · due 31 Oct"), findsOneWidget);
    expect(find.textContaining("Could not check: Homework"), findsOneWidget);
    if (_shots) {
      await expectLater(find.byType(MaterialApp), matchesGoldenFile("goldens/pending_work_card.png"));
    }
    await tester.tap(find.text("Today's register is not taken"));
    await tester.pump();
    expect(opened, ["/attendance"], reason: "a row opens the home's own route");
  });

  testWidgets("nothing pending and everything checked → no card", (tester) async {
    await _pump(tester, {"date": "2026-10-29", "items": [], "unknown": []});
    expect(find.byKey(const Key("pending-work-card")), findsNothing);
  });
}
