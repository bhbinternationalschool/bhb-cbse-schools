// "My signature" on the staff app profile (director, 15 Oct 2026): the photo
// of a signature is trimmed to the ink and made transparent on the phone,
// previewed, then saved to the person's own record through
// /api/v1/staff/me/signature — replaced or removed the same way.
import "dart:convert";
import "dart:io";
import "dart:typed_data";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/staff/my_profile_screen.dart";
import "package:cbse_school_mobile/features/staff/my_signature_card.dart";
import "package:cbse_school_mobile/features/staff/signature_cleanup.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:flutter_test/flutter_test.dart";
import "package:http/http.dart" as http;
import "package:http/testing.dart";
import "package:image/image.dart" as img;

const _config = AppConfig(
  apiBaseUrl: "https://erp.example.invalid",
  tenantSlug: "t",
  schoolName: "s",
  supabaseUrl: "",
  supabaseAnonKey: "",
);

/// Screenshots at 375 px: `flutter test --update-goldens --dart-define=SHOTS=true test/staff_signature_test.dart`.
const _shots = bool.fromEnvironment("SHOTS");

Widget _app(Widget child) => LocaleScope(
  controller: LocaleController(),
  child: MaterialApp(
    debugShowCheckedModeBanner: false,
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    home: child,
  ),
);

JsonCache _memoryCache() => JsonCache(baseDir: () async => throw const FileSystemException("test"));

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(375 * 3, 812 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Future<void> _shot(WidgetTester tester, String name) async {
  if (!_shots) return;
  await expectLater(find.byType(MaterialApp), matchesGoldenFile("goldens/$name.png"));
}

/// A phone photo of a signature: off-white paper, a grey shadow down one
/// side, and a blue scrawl in the middle.
Uint8List _paperPhoto({bool ink = true}) {
  final im = img.Image(width: 800, height: 500);
  img.fill(im, color: img.ColorRgb8(236, 234, 228));
  img.fillRect(im, x1: 0, y1: 0, x2: 60, y2: 499, color: img.ColorRgb8(205, 203, 198)); // shadow
  if (ink) {
    img.drawLine(im, x1: 250, y1: 300, x2: 420, y2: 200, color: img.ColorRgb8(20, 40, 140), thickness: 6);
    img.drawLine(im, x1: 420, y1: 200, x2: 560, y2: 320, color: img.ColorRgb8(20, 40, 140), thickness: 6);
  }
  return Uint8List.fromList(img.encodeJpg(im, quality: 92));
}

Map<String, dynamic> _profile(String signatureUrl) => {
  "data": {
    "staff": {
      "id": "stf_1",
      "empCode": "BHB014",
      "fullName": "Asha Verma",
      "photoUrl": "",
      "photoStatus": "",
      "signatureUrl": signatureUrl,
      "designation": "PRT Teacher",
      "department": "Teaching",
      "joiningDate": "2024-04-01",
      "category": "regular",
      "status": "active",
    },
    "values": <String, String>{},
    "fields": <Object>[],
    "pendingRequest": null,
    "lastDecision": null,
    "requestsUnknown": false,
  },
};

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({"bhb_session_cookie": "cookie-A"});
  });

  group("cleaning the photo", () {
    test("trimmed to the ink, paper transparent, ink kept and opaque", () {
      final out = img.decodePng(cleanSignaturePng(_paperPhoto()))!;
      // The scrawl spans x 250–560, y 200–320 (plus a pen width and margin).
      expect(out.width, inInclusiveRange(310, 380));
      expect(out.height, inInclusiveRange(120, 190));
      expect(out.getPixel(0, 0).a, 0, reason: "the paper corner is see-through");
      expect(out.getPixel(out.width - 1, out.height - 1).a, 0);
      // (The pixel iterator reuses one object: read the values out.)
      final inked = [for (final p in out) if (p.a == 255) (r: p.r, b: p.b)];
      expect(inked, isNotEmpty);
      final blue = inked.fold<num>(0, (n, p) => n + p.b) / inked.length;
      final red = inked.fold<num>(0, (n, p) => n + p.r) / inked.length;
      expect(blue, greaterThan(red + 40), reason: "blue ink stays blue (b $blue, r $red)");
    });

    test("the shadow on the paper is not taken for ink", () {
      final out = img.decodePng(cleanSignaturePng(_paperPhoto()))!;
      expect(out.width, lessThan(400), reason: "the crop does not reach back to the shadow at x 0–60");
    });

    test("never wider than maxWidth", () {
      final out = img.decodePng(cleanSignaturePng(_paperPhoto(), maxWidth: 200))!;
      expect(out.width, 200);
    });

    test("a blank page and an unreadable file are refused with a reason", () {
      expect(() => cleanSignaturePng(_paperPhoto(ink: false)), throwsA(isA<SignatureCleanupException>()));
      expect(() => cleanSignaturePng(Uint8List.fromList(utf8.encode("not a picture"))), throwsA(isA<SignatureCleanupException>()));
    });
  });

  group("My signature on the profile", () {
    testWidgets("add: pick, preview the cleaned PNG, save to the own record", (tester) async {
      _phone(tester);
      var signatureUrl = "";
      http.Request? posted;
      final client = MockClient((req) async {
        if (req.url.path == "/api/v1/staff/me/profile" && req.method == "GET") {
          return http.Response(jsonEncode(_profile(signatureUrl)), 200);
        }
        if (req.url.path == "/api/v1/staff/me/signature" && req.method == "POST") {
          posted = req;
          signatureUrl = "/api/file/school-files/staff/BHB014/signature-1.png";
          return http.Response(jsonEncode({"data": {"signatureUrl": signatureUrl}}), 200);
        }
        if (req.url.path.startsWith("/api/file/")) return http.Response("", 404);
        return http.Response("{}", 404);
      });
      final photo = _paperPhoto();
      final cleaned = await tester.runAsync(() async => cleanSignaturePng(photo));
      await http.runWithClient(() async {
        final api = ApiClient(_config, cache: _memoryCache());
        await tester.pumpWidget(_app(MyProfileScreen(api: api)));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key("my-signature-card")), findsOneWidget);
        expect(find.byKey(const Key("signature-empty")), findsOneWidget);
        expect(find.byKey(const Key("signature-remove")), findsNothing, reason: "nothing to remove yet");
        await _shot(tester, "signature_empty_375");

        // The card on its own, with the camera stood in for and the cleaner given.
        await tester.pumpWidget(
          _app(
            Scaffold(
              body: MySignatureCard(
                api: api,
                signatureUrl: "",
                onChanged: (u) => signatureUrl = u,
                pick: (_) async => photo,
                clean: (_) async => cleaned!,
              ),
            ),
          ),
        );
        // Decode the preview for real (widget tests decode images only in runAsync).
        await tester.runAsync(() => precacheImage(MemoryImage(cleaned!), tester.element(find.byType(MySignatureCard))));
        await tester.tap(find.byKey(const Key("signature-add")));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key("signature-gallery")));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key("signature-preview")), findsOneWidget, reason: "previewed before anything is sent");
        expect(posted, isNull);
        await _shot(tester, "signature_preview_375");
        await tester.tap(find.byKey(const Key("signature-save")));
        await tester.pumpAndSettle();
      }, () => client);

      expect(posted, isNotNull);
      final body = posted!.bodyBytes;
      // multipart with one file part named "file", a PNG — and no staff id: the server takes it from the session.
      final text = latin1.decode(body);
      expect(text, contains('name="file"'));
      expect(text, contains("image/png"));
      expect(text, isNot(contains("staffId")));
      expect(signatureUrl, "https://erp.example.invalid/api/file/school-files/staff/BHB014/signature-1.png");
      expect(find.text("Signature saved."), findsOneWidget);
    });

    testWidgets("a saved signature can be replaced or removed (after a confirm)", (tester) async {
      _phone(tester);
      var deleted = 0;
      var current = "https://erp.example.invalid/api/file/school-files/staff/BHB014/signature-1.png";
      final client = MockClient((req) async {
        if (req.url.path == "/api/v1/staff/me/signature" && req.method == "DELETE") {
          deleted += 1;
          return http.Response(jsonEncode({"data": {"signatureUrl": ""}}), 200);
        }
        return http.Response("", 404);
      });
      await http.runWithClient(() async {
        final api = ApiClient(_config, cache: _memoryCache());
        await tester.pumpWidget(
          _app(
            Scaffold(
              body: StatefulBuilder(
                builder: (context, setState) => MySignatureCard(
                  api: api,
                  signatureUrl: current,
                  onChanged: (u) => setState(() => current = u),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text("Replace"), findsOneWidget);
        expect(find.byKey(const Key("signature-remove")), findsOneWidget);
        await _shot(tester, "signature_saved_375");

        await tester.tap(find.byKey(const Key("signature-remove")));
        await tester.pumpAndSettle();
        expect(deleted, 0, reason: "nothing goes until the person confirms");
        await tester.tap(find.byKey(const Key("signature-remove-confirm")));
        await tester.pumpAndSettle();
      }, () => client);
      expect(deleted, 1);
      expect(current, "");
      expect(find.byKey(const Key("signature-empty")), findsOneWidget);
      expect(find.text("Add signature"), findsOneWidget);
    });

    testWidgets("a picture with no signature in it is refused on the phone, nothing is sent", (tester) async {
      _phone(tester);
      var calls = 0;
      final client = MockClient((req) async {
        calls += 1;
        return http.Response("{}", 404);
      });
      await http.runWithClient(() async {
        final api = ApiClient(_config, cache: _memoryCache());
        await tester.pumpWidget(
          _app(
            Scaffold(
              body: MySignatureCard(
                api: api,
                signatureUrl: "",
                onChanged: (_) {},
                pick: (_) async => Uint8List(0),
                clean: (_) async => throw const SignatureCleanupException("No signature found in the picture."),
              ),
            ),
          ),
        );
        await tester.tap(find.byKey(const Key("signature-add")));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key("signature-camera")));
        await tester.pumpAndSettle();
      }, () => client);
      expect(find.text("No signature found in the picture."), findsOneWidget);
      expect(find.byKey(const Key("signature-preview")), findsNothing);
      expect(calls, 0);
    });
  });
}
