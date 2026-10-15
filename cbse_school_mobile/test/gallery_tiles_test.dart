// The gallery's way in, per staff home (15 Oct 2026). Until now only the
// teacher home had a tile: the principal and the office — who post the
// school's albums and decide on what the AI check holds — had none, so
// "Held for review" was unreachable on the phone.
//
// The server decides who holds `class_gallery` (/api/v1/staff/features: class
// teachers, and school-wide staff with the Gallery grant); each home shows
// the tile exactly when it is granted, and it opens the gallery screen.
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/staff/class_gallery_screen.dart";
import "package:cbse_school_mobile/features/staff/desk_home_screen.dart";
import "package:cbse_school_mobile/features/staff/principal_home_screen.dart";
import "package:cbse_school_mobile/features/staff/teacher_home_screen.dart";
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
    home: child,
  ),
);

JsonCache _memoryCache() =>
    JsonCache(baseDir: () async => throw const FileSystemException("test"));

/// The server: the features it grants, and the gallery it answers with.
MockClient _server({
  required String homeKind,
  required List<String> features,
  Map<String, Object?>? gallery,
}) => MockClient((req) async {
  final p = req.url.path;
  if (p == "/api/v1/staff/features") {
    return http.Response(
      jsonEncode({
        "data": {"homeKind": homeKind, "features": features},
      }),
      200,
    );
  }
  if (p == "/api/v1/staff/summary") {
    return http.Response(
      jsonEncode({
        "data": {"fullName": "Asha Verma", "date": "2026-10-15"},
      }),
      200,
    );
  }
  if (p == "/api/v1/staff/class-gallery") {
    return http.Response(jsonEncode({"data": gallery ?? const {}}), 200);
  }
  if (p == "/api/v1/staff/approvals") {
    return http.Response('{"data":{"total":0}}', 200);
  }
  return http.Response('{"data":{}}', 200);
});

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _pump(
  WidgetTester tester,
  Widget Function(ApiClient api) home,
  MockClient server,
) async {
  tester.view.physicalSize = const Size(420, 3200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await http.runWithClient(() async {
    await tester.pumpWidget(
      _app(home(ApiClient(_config, cache: _memoryCache()))),
    );
    await _settle(tester);
  }, () => server);
}

Future<void> _openTile(
  WidgetTester tester,
  String label,
  MockClient server,
) async {
  await http.runWithClient(() async {
    final tile = find.text(label);
    await tester.ensureVisible(tile.first);
    await tester.tap(tile.first);
    await _settle(tester);
  }, () => server);
}

const _leaderGallery = {
  "section": "school",
  "classLabel": "Whole school",
  "classes": [
    {"section": "school", "classLabel": "Whole school"},
    {"section": "c1|s1", "classLabel": "Class Nursery-A"},
  ],
  "events": [],
  "canReview": true,
  "heldCount": 2,
};

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "cookie-A",
    });
  });

  group("teacher home", () {
    testWidgets("a class teacher (granted) sees Class gallery and it opens", (
      tester,
    ) async {
      final server = _server(
        homeKind: "teacher",
        features: ["homework", "class_gallery"],
        gallery: const {
          "section": "c1|s1",
          "classLabel": "Class Nursery-A",
          "classes": [
            {"section": "c1|s1", "classLabel": "Class Nursery-A"},
          ],
          "events": [],
          "canReview": false,
          "heldCount": 0,
        },
      );
      await _pump(
        tester,
        (api) => TeacherHomeScreen(api: api, onLogout: () {}),
        server,
      );
      expect(find.text("Class gallery"), findsOneWidget);
      await _openTile(tester, "Class gallery", server);
      expect(find.byType(ClassGalleryScreen), findsOneWidget);
      expect(find.text("Class Nursery-A"), findsWidgets);
      expect(
        find.text("Held for review"),
        findsNothing,
        reason: "a class teacher does not decide on held items",
      );
    });

    testWidgets("a subject-only teacher (not granted) has no tile", (
      tester,
    ) async {
      await _pump(
        tester,
        (api) => TeacherHomeScreen(api: api, onLogout: () {}),
        _server(homeKind: "teacher", features: ["homework"]),
      );
      expect(find.text("Class gallery"), findsNothing);
    });
  });

  group("principal home", () {
    testWidgets(
      "granted: Gallery opens with the whole school and Held for review",
      (tester) async {
        final server = _server(
          homeKind: "leadership",
          features: ["broadcast", "class_gallery"],
          gallery: _leaderGallery,
        );
        await _pump(
          tester,
          (api) => PrincipalHomeScreen(api: api, onLogout: () {}),
          server,
        );
        expect(find.text("Gallery"), findsOneWidget);
        await _openTile(tester, "Gallery", server);
        expect(find.byType(ClassGalleryScreen), findsOneWidget);
        expect(find.text("Held for review"), findsOneWidget);
        expect(find.text("2 waiting for you"), findsOneWidget);
        expect(find.text("Whole school"), findsWidgets);
      },
    );

    testWidgets("not granted: no tile", (tester) async {
      await _pump(
        tester,
        (api) => PrincipalHomeScreen(api: api, onLogout: () {}),
        _server(homeKind: "leadership", features: ["broadcast"]),
      );
      expect(find.text("Gallery"), findsNothing);
    });

    testWidgets(
      "a held count that could not be read is not 'Nothing waiting'",
      (tester) async {
        final server = _server(
          homeKind: "leadership",
          features: ["class_gallery"],
          gallery: {..._leaderGallery, "heldCount": null},
        );
        await _pump(
          tester,
          (api) => PrincipalHomeScreen(api: api, onLogout: () {}),
          server,
        );
        await _openTile(tester, "Gallery", server);
        expect(find.text("Could not count — open to see"), findsOneWidget);
        expect(find.text("Nothing waiting"), findsNothing);
      },
    );
  });

  group("office (desk) home", () {
    testWidgets("granted: Gallery tile opens the gallery", (tester) async {
      final server = _server(
        homeKind: "office",
        features: ["complaints_handle", "class_gallery"],
        gallery: _leaderGallery,
      );
      await _pump(
        tester,
        (api) => DeskHomeScreen(api: api, onLogout: () {}),
        server,
      );
      expect(find.text("Gallery"), findsOneWidget);
      await _openTile(tester, "Gallery", server);
      expect(find.byType(ClassGalleryScreen), findsOneWidget);
      expect(find.text("Held for review"), findsOneWidget);
    });

    testWidgets("support staff (not granted): no tile", (tester) async {
      await _pump(
        tester,
        (api) => DeskHomeScreen(api: api, onLogout: () {}),
        _server(homeKind: "support", features: ["my_leave"]),
      );
      expect(find.text("Gallery"), findsNothing);
    });
  });
}
