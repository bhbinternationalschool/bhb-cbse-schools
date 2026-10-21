// Requests mr_mv9ze8pqksu2 / mr_mv9zkoot06df (call, message, change the
// family's WhatsApp number) and mr_mv9z5lg1jlih (document type at
// verification).
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/staff/doc_type_verify_sheet.dart";
import "package:cbse_school_mobile/features/staff/student_contact_rules.dart";
import "package:cbse_school_mobile/features/staff/student_contact_sheet.dart";
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
    home: Scaffold(body: child),
  ),
);

JsonCache _memoryCache() =>
    JsonCache(baseDir: () async => throw const FileSystemException("test"));

/// Records every call; answers from [replies] by path.
class _Server {
  _Server(this.replies);
  final Map<String, Map<String, dynamic> Function(Map<String, dynamic> body)>
  replies;
  final calls = <({String path, Map<String, dynamic> body})>[];

  MockClient client() => MockClient((req) async {
    final body = req.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(req.body) as Map<String, dynamic>;
    calls.add((path: req.url.path, body: body));
    final r = replies[req.url.path];
    if (r == null) return http.Response("{}", 404);
    return http.Response.bytes(
      utf8.encode(jsonEncode({"ok": true, "data": r(body)})),
      200,
      headers: {"content-type": "application/json; charset=utf-8"},
    );
  });

  ApiClient api() =>
      ApiClient(_config, client: client(), cache: _memoryCache());
}

Map<String, dynamic> _contact({
  String call = "",
  String source = "none",
  String wa = "",
  bool canChange = true,
  bool canMessage = true,
}) => {
  "studentId": "s1",
  "studentName": "Asha Devi",
  "classLabel": "III A",
  "household": {
    "id": "h1",
    "revisionAt": "2026-10-01T00:00:00.000Z",
    "guardianName": "Ram Kumar",
  },
  "call": {"number": call, "source": source},
  "whatsapp": {"number": wa},
  "canChangeNumber": canChange,
  "canChat": canChange,
  "canMessage": canMessage,
};

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// A button that opens [open] — the sheets need a navigator under them.
Widget _opener(Future<void> Function(BuildContext) open) => Builder(
  builder: (context) =>
      TextButton(onPressed: () => open(context), child: const Text("open")),
);

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({"bhb_session_cookie": "c"});
  });

  group("number rules (mirror of the server's)", () {
    test("placeholders are never a number", () {
      for (final ph in [
        "0000000000",
        "9999999999",
        "+91 99999 99999",
        "1234567890",
        "9876543210",
        "12345",
        "",
      ]) {
        expect(isPlaceholderMobile(ph), isTrue, reason: ph);
        expect(dialable(ph), isNull, reason: ph);
      }
      expect(dialable("+91 98391-24567"), "9839124567");
      expect(dialable("09839124567"), "9839124567");
    });

    test("a new WhatsApp number must be real, Indian and a change", () {
      expect(
        checkNewWhatsApp("+91 70070 01234", "9839124567").number,
        "7007001234",
      );
      expect(checkNewWhatsApp("", "").problem, NewNumberProblem.empty);
      expect(checkNewWhatsApp("98391", "").problem, NewNumberProblem.notMobile);
      expect(
        checkNewWhatsApp("5839124567", "").problem,
        NewNumberProblem.notMobile,
      );
      expect(
        checkNewWhatsApp("0000000000", "").problem,
        NewNumberProblem.notMobile,
      );
      expect(
        checkNewWhatsApp("9999999999", "").problem,
        NewNumberProblem.placeholder,
      );
      expect(
        checkNewWhatsApp("9839124567", "+919839124567").problem,
        NewNumberProblem.same,
      );
    });

    test("an Aadhaar box is empty or 12 digits", () {
      expect(aadhaarTyped(""), "");
      expect(aadhaarTyped("2345 6789 0123"), "234567890123");
      expect(aadhaarTyped("2345 6789"), isNull);
    });
  });

  group("document type", () {
    final types = [
      DocTypeOption.fromJson({
        "id": "birthCert",
        "label": "Birth certificate",
        "slot": "birthCert",
      }),
      DocTypeOption.fromJson({
        "id": "aadhaar",
        "label": "Child's Aadhaar",
        "slot": "aadhaar",
        "aadhaarOf": "child",
      }),
      DocTypeOption.fromJson({
        "id": "motherAadhaar",
        "label": "Mother's Aadhaar",
        "slot": "",
        "aadhaarOf": "mother",
      }),
      DocTypeOption.fromJson({
        "id": "tc",
        "label": "Transfer certificate",
        "slot": "tc",
      }),
      DocTypeOption.fromJson({
        "id": "cdt_1",
        "label": "Ration card",
        "slot": "",
        "custom": true,
      }),
    ];

    test("starts on the type the parent's slot stands for", () {
      expect(defaultDocType("aadhaar", types)!.id, "aadhaar");
      expect(defaultDocType("tc", types)!.id, "tc");
    });

    test("says where the verified document goes", () {
      expect(docTypeDestination("aadhaar", types[1]), isNull);
      expect(docTypeDestination("aadhaar", types[2]), "filed");
      expect(docTypeDestination("addressProof", types[3]), "tc");
      expect(docTypeDestination("incomeCert", types[4]), "filed");
    });

    testWidgets("verifying as Mother's Aadhaar sends the type and the digits", (
      tester,
    ) async {
      final server = _Server({
        "/api/v1/staff/documents/types": (_) => {
          "customLoaded": true,
          "types": [
            {
              "id": "aadhaar",
              "label": "Child's Aadhaar",
              "labelHi": "",
              "slot": "aadhaar",
              "aadhaarOf": "child",
              "custom": false,
            },
            {
              "id": "motherAadhaar",
              "label": "Mother's Aadhaar",
              "labelHi": "",
              "slot": "",
              "aadhaarOf": "mother",
              "custom": false,
            },
          ],
        },
        "/api/v1/staff/documents/review": (b) => {
          "typeLabel": "Mother's Aadhaar",
          "movedTo": "filed",
          "aadhaar": {
            "saved": true,
            "outcome": {"status": "saved"},
            "error": "",
          },
        },
      });
      final item = DocReviewItem.fromJson({
        "studentId": "s1",
        "studentName": "Asha Devi",
        "classLabel": "III A",
        "key": "aadhaar",
        "label": "Aadhaar",
        "status": "pending",
      });
      await tester.pumpWidget(
        _app(DocTypeVerifySheet(api: server.api(), item: item)),
      );
      await _settle(tester);

      await tester.tap(find.byKey(const ValueKey("doc-type")));
      await _settle(tester);
      await tester.tap(find.text("Mother's Aadhaar").last);
      await _settle(tester);
      expect(find.textContaining("filed as Mother's Aadhaar"), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey("doc-aadhaar")),
        "2345 67",
      );
      await tester.tap(find.byKey(const ValueKey("doc-verify")));
      await _settle(tester);
      expect(
        server.calls.where((c) => c.path.endsWith("/review")),
        isEmpty,
        reason: "a half-typed Aadhaar is refused before anything is sent",
      );

      await tester.enterText(
        find.byKey(const ValueKey("doc-aadhaar")),
        "2345 6789 0123",
      );
      await tester.tap(find.byKey(const ValueKey("doc-verify")));
      await _settle(tester);
      final review = server.calls.singleWhere(
        (c) => c.path.endsWith("/review"),
      );
      expect(review.body["typeId"], "motherAadhaar");
      expect(review.body["verdict"], "verified");
      expect(review.body["key"], "aadhaar");
      expect(review.body["aadhaarNumber"], "234567890123");
    });
  });

  group("contact sheet", () {
    testWidgets("no number on record: says so and offers Add, dials nothing", (
      tester,
    ) async {
      final server = _Server({
        "/api/v1/staff/student-contact": (_) => _contact(),
      });
      final api = server.api();
      await tester.pumpWidget(
        _app(
          _opener(
            (c) => showStudentContactActions(
              c,
              api: api,
              studentId: "s1",
              studentName: "Asha Devi",
            ),
          ),
        ),
      );
      await tester.tap(find.text("open"));
      await _settle(tester);
      expect(find.text("No number on record"), findsOneWidget);
      expect(find.text("No WhatsApp number on record"), findsOneWidget);
      expect(find.textContaining("Call "), findsNothing);
      expect(find.text("Add WhatsApp number"), findsWidgets);
    });

    testWidgets("a placeholder typed as the new number is refused locally", (
      tester,
    ) async {
      final server = _Server({
        "/api/v1/staff/student-contact": (b) =>
            b.isEmpty ? _contact() : {"whatsappMobile": b["whatsappMobile"]},
      });
      final api = server.api();
      await tester.pumpWidget(
        _app(
          _opener(
            (c) => showStudentContactActions(
              c,
              api: api,
              studentId: "s1",
              studentName: "Asha Devi",
            ),
          ),
        ),
      );
      await tester.tap(find.text("open"));
      await _settle(tester);
      await tester.tap(find.text("Add WhatsApp number").last);
      await _settle(tester);
      await tester.enterText(
        find.byKey(const ValueKey("wa-number")),
        "9999999999",
      );
      await tester.tap(find.text("Save"));
      await _settle(tester);
      expect(find.textContaining("placeholder"), findsOneWidget);
      expect(server.calls.where((c) => c.body.isNotEmpty), isEmpty);

      await tester.enterText(
        find.byKey(const ValueKey("wa-number")),
        "70070 01234",
      );
      await tester.tap(find.text("Save"));
      await _settle(tester);
      final post = server.calls.singleWhere((c) => c.body.isNotEmpty);
      expect(post.body["whatsappMobile"], "7007001234");
      expect(post.body["revisionAt"], "2026-10-01T00:00:00.000Z");
    });

    testWidgets("a WhatsApp message is previewed first and sent only on Send", (
      tester,
    ) async {
      final server = _Server({
        "/api/v1/staff/student-contact/message": (b) => b["dryRun"] == true
            ? {
                "to": "98•••••567",
                "language": "hi",
                "preview": "Notice: bring the copy",
              }
            : {"sent": true, "to": "98•••••567"},
      });
      final contact = StudentContact.fromJson(
        _contact(call: "9839124567", source: "guardian", wa: "9839124567"),
      );
      await tester.pumpWidget(
        _app(StudentMessageComposer(api: server.api(), contact: contact)),
      );
      await tester.enterText(
        find.byType(TextField).first,
        "Please bring the copy",
      );
      await tester.tap(find.byKey(const ValueKey("sc-preview")));
      await _settle(tester);
      expect(server.calls, hasLength(1));
      expect(server.calls.single.body["dryRun"], isTrue);
      expect(find.text("Notice: bring the copy"), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey("sc-send")));
      await _settle(tester);
      expect(server.calls, hasLength(2));
      expect(server.calls.last.body["dryRun"], isFalse);
      expect(server.calls.last.body["text"], "Please bring the copy");
    });
  });
}
