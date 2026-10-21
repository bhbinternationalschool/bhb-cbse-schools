// Admissions requests on the staff app (director-approved, 20 Oct 2026):
//   mr_mva01cgp36wt — "Add walk-in lead"; the message icon opens a preview
//                     with Send instead of sending at once;
//   mr_mva0dic9d7k2 — the follow-ups message icon opens an editable composer;
//   mr_mva0aehp8w18 — New registration with the registration fee, Leads and
//                     Registered tabs, Follow up / Send to SIS on registered.
// The form rules are unit-tested; each screen runs against a stand-in school
// server that records exactly what the app sends.
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/staff/admission_forms.dart";
import "package:cbse_school_mobile/features/staff/admission_leads_screen.dart";
import "package:cbse_school_mobile/features/staff/admission_sheets.dart";
import "package:cbse_school_mobile/features/staff/principal_lists.dart";
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
    debugShowCheckedModeBanner: false,
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    locale: const Locale("en"),
    home: child,
  ),
);

JsonCache _memoryCache() =>
    JsonCache(baseDir: () async => throw const FileSystemException("test"));

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(375 * 3, 900 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Map<String, dynamic> _lead({
  String id = "L1",
  String stage = "enquiry",
  bool registered = false,
  int fee = 0,
  int paid = 0,
}) => {
  "id": id,
  "enquiryNo": "ENQ/26/0001",
  "childName": "Sita",
  "guardianName": "Ram Kumar",
  "mobile": "9811122233",
  "whatsapp": "9811122233",
  "stage": stage,
  "stageLabel": registered ? "Registered" : "Open",
  "classSought": "LKG",
  "bucket": "today",
  "nextFollowUpAt": "2026-10-20",
  "registered": registered,
  "applicationNo": registered ? "APP/26/0007" : "",
  "registrationFeeRupees": fee,
  "registrationCollectedRupees": paid,
  "registrationBalanceRupees": fee - paid,
  "registrationPaymentStatus": paid >= fee && fee > 0 ? "paid" : "none",
};

http.Response _ok(Object data) => http.Response.bytes(
  utf8.encode(jsonEncode({"ok": true, "data": data})),
  200,
  headers: {"content-type": "application/json; charset=utf-8"},
);

const _options = {
  "classes": [
    {"id": "c_lkg", "name": "LKG"},
    {"id": "c_ukg", "name": "UKG"},
  ],
  "registrationFeeHeads": [
    {"id": "fh_reg", "name": "Registration fee"},
  ],
  "tenderModes": [
    {"id": "cash", "label": "Cash", "needsRef": false, "refLabel": "Slip"},
    {
      "id": "upi",
      "label": "UPI",
      "needsRef": true,
      "refLabel": "UTR / UPI ref",
    },
  ],
};

Map<String, dynamic> _composer({required bool inWindow}) => {
  "leadId": "L1",
  "mobile": "9811122233",
  "familyKey": "admissions_followup",
  "draft": "Namaste Ram Kumar ji, about Sita's admission enquiry.",
  "inWindow": inWindow,
  "template": {
    "ok": true,
    "body": "Namaste Ram Kumar ji — checking in on Sita's admission enquiry.",
    "language": "en",
  },
  "variables": {
    "guardianName": "Ram Kumar",
    "childName": "Sita",
    "schoolName": "BHB",
  },
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "signed.cookie",
    });
  });

  group("form rules", () {
    test("whole rupees only — a typo is refused, not rounded", () {
      expect(wholeRupees("500"), 500);
      expect(wholeRupees(" 1,500 "), 1500);
      expect(wholeRupees("0"), 0);
      expect(wholeRupees("500.5"), isNull);
      expect(wholeRupees("-1"), isNull);
      expect(wholeRupees(""), isNull);
      expect(wholeRupees("1e3"), isNull);
    });

    test("mobile keeps the last ten digits", () {
      expect(mobile10("+91 98111 22233"), "9811122233");
      expect(mobile10("98111"), "98111");
    });

    test("walk-in needs child, class, parent and a 10-digit mobile", () {
      AdmFormIssue? w({
        String c = "Sita",
        String k = "c_lkg",
        String p = "Ram",
        String m = "9811122233",
      }) => walkInIssue(childName: c, classId: k, parentName: p, mobile: m);
      expect(w(), isNull);
      expect(w(c: " "), AdmFormIssue.childName);
      expect(w(k: ""), AdmFormIssue.className);
      expect(w(p: ""), AdmFormIssue.parentName);
      expect(w(m: "98111"), AdmFormIssue.mobile);
    });

    test(
      "registration: fee required; money received is checked like the desk",
      () {
        AdmFormIssue? r({
          String fee = "500",
          bool collect = false,
          String amount = "",
          String mode = "cash",
          bool needsRef = false,
          String ref = "",
          String head = "fh_reg",
        }) => registrationIssue(
          newChild: false,
          feeHeadId: head,
          feeRaw: fee,
          collect: collect,
          collectRaw: amount,
          modeId: mode,
          modeNeedsRef: needsRef,
          ref: ref,
        );
        expect(r(), isNull, reason: "registered with the fee left due");
        expect(r(head: ""), AdmFormIssue.feeHead);
        expect(r(fee: "abc"), AdmFormIssue.feeAmount);
        expect(r(collect: true, amount: "500"), isNull);
        expect(r(collect: true, amount: "200"), isNull, reason: "part payment");
        expect(r(collect: true, amount: "0"), AdmFormIssue.collectAmount);
        expect(
          r(collect: true, amount: "600"),
          AdmFormIssue.collectMoreThanFee,
        );
        expect(
          r(collect: true, amount: "500", mode: "upi", needsRef: true),
          AdmFormIssue.collectRef,
        );
        expect(
          r(
            collect: true,
            amount: "500",
            mode: "upi",
            needsRef: true,
            ref: "UTR1",
          ),
          isNull,
        );
        expect(
          registrationIssue(
            newChild: true,
            feeHeadId: "fh_reg",
            feeRaw: "500",
            collect: false,
          ),
          AdmFormIssue.childName,
          reason: "a new child needs the walk-in fields too",
        );
      },
    );

    test("composer: own words only inside the 24-hour window", () {
      expect(
        composerMode(inWindow: true, templateOk: true),
        ComposerMode.ownWords,
      );
      expect(
        composerMode(inWindow: false, templateOk: true),
        ComposerMode.templateOnly,
      );
      expect(
        composerMode(inWindow: false, templateOk: false),
        ComposerMode.nothing,
      );
    });

    test("a zero registration fee reads 'not set', never 'paid'", () {
      final l = lookupL(const Locale("en"));
      expect(
        registrationFeeLine(
          l,
          AdmissionLeadRow.fromJson(_lead(registered: true)),
        ),
        "Registration fee not set",
      );
      expect(
        registrationFeeLine(
          l,
          AdmissionLeadRow.fromJson(
            _lead(registered: true, fee: 500, paid: 200),
          ),
        ),
        "Fee ₹500 · paid ₹200 · due ₹300",
      );
    });
  });

  group("Admission leads", () {
    testWidgets(
      "the message icon opens a composer; nothing is sent until Send",
      (tester) async {
        _phone(tester);
        final sent = <Map<String, dynamic>>[];
        final client = MockClient((req) async {
          final p = req.url.path;
          if (p == "/api/v1/staff/admissions/leads") {
            return _ok({
              "counts": {"overdue": 0, "today": 1},
              "leads": [_lead()],
            });
          }
          if (p == "/api/v1/staff/admissions/compose") {
            return _ok(_composer(inWindow: true));
          }
          if (p == "/api/v1/staff/wa/send") {
            sent.add(jsonDecode(req.body) as Map<String, dynamic>);
            return _ok({"sent": true, "deferred": false});
          }
          return http.Response("{}", 404);
        });
        await http.runWithClient(() async {
          await tester.pumpWidget(
            _app(
              AdmissionLeadsScreen(
                api: ApiClient(_config, cache: _memoryCache()),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.byIcon(Icons.chat_outlined));
          await tester.pumpAndSettle();
          expect(find.text("Message to Ram Kumar"), findsOneWidget);
          expect(sent, isEmpty, reason: "the first tap only opens the preview");

          // Cancel: still nothing sent.
          await tester.tap(find.text("Cancel"));
          await tester.pumpAndSettle();
          expect(sent, isEmpty);

          // Open again, edit, send.
          await tester.tap(find.byIcon(Icons.chat_outlined));
          await tester.pumpAndSettle();
          await tester.enterText(
            find.byType(TextField).last,
            "Namaste ji, the visit is fixed for Saturday 10 am.",
          );
          await tester.tap(find.text("Send my message"));
          await tester.pumpAndSettle();
        }, () => client);

        expect(sent, hasLength(1));
        expect(
          sent.single["text"],
          "Namaste ji, the visit is fixed for Saturday 10 am.",
        );
        expect(
          sent.single["textOnly"],
          true,
          reason: "the edited words go, not the template",
        );
        expect(sent.single["familyKey"], "admissions_followup");
      },
    );

    testWidgets(
      "outside the 24-hour window only the approved message is offered",
      (tester) async {
        _phone(tester);
        final sent = <Map<String, dynamic>>[];
        final client = MockClient((req) async {
          final p = req.url.path;
          if (p == "/api/v1/staff/admissions/leads") {
            return _ok({
              "counts": {},
              "leads": [_lead()],
            });
          }
          if (p == "/api/v1/staff/admissions/compose") {
            return _ok(_composer(inWindow: false));
          }
          if (p == "/api/v1/staff/wa/send") {
            sent.add(jsonDecode(req.body) as Map<String, dynamic>);
            return _ok({"sent": true, "deferred": false});
          }
          return http.Response("{}", 404);
        });
        await http.runWithClient(() async {
          await tester.pumpWidget(
            _app(
              AdmissionLeadsScreen(
                api: ApiClient(_config, cache: _memoryCache()),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.byIcon(Icons.chat_outlined));
          await tester.pumpAndSettle();
          expect(find.text("Send my message"), findsNothing);
          expect(
            find.textContaining("checking in on Sita's admission enquiry"),
            findsOneWidget,
            reason: "the exact approved words are previewed",
          );
          await tester.tap(find.text("Send approved message"));
          await tester.pumpAndSettle();
        }, () => client);
        expect(sent, hasLength(1));
        expect(sent.single.containsKey("textOnly"), isFalse);
        expect((sent.single["variables"] as Map)["childName"], "Sita");
      },
    );

    testWidgets("Add walk-in lead saves the web's required fields", (
      tester,
    ) async {
      _phone(tester);
      final posted = <Map<String, dynamic>>[];
      final client = MockClient((req) async {
        final p = req.url.path;
        if (p == "/api/v1/staff/admissions/leads" && req.method == "GET") {
          return _ok({"counts": {}, "leads": []});
        }
        if (p == "/api/v1/staff/admissions/options") return _ok(_options);
        if (p == "/api/v1/staff/admissions/leads" && req.method == "POST") {
          posted.add(jsonDecode(req.body) as Map<String, dynamic>);
          return _ok({
            "leadId": "L9",
            "enquiryNo": "ENQ/26/0042",
            "linkedExisting": false,
          });
        }
        return http.Response("{}", 404);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          _app(
            AdmissionLeadsScreen(
              api: ApiClient(_config, cache: _memoryCache()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        // Offered on an empty list too.
        await tester.tap(find.text("Add walk-in lead"));
        await tester.pumpAndSettle();
        await tester.tap(find.text("Save lead"));
        await tester.pumpAndSettle();
        expect(find.text("Child's name is required"), findsOneWidget);
        expect(posted, isEmpty);

        await tester.enterText(
          find.widgetWithText(TextField, "Child's name"),
          "Aarav",
        );
        await tester.tap(find.byType(DropdownButtonFormField<String>));
        await tester.pumpAndSettle();
        await tester.tap(find.text("UKG").last);
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextField, "Parent's name"),
          "Mohan",
        );
        await tester.enterText(
          find.widgetWithText(TextField, "Parent's mobile (10 digits)"),
          "+91 98111 22244",
        );
        await tester.tap(find.text("Save lead"));
        await tester.pumpAndSettle();
      }, () => client);
      expect(posted, hasLength(1));
      expect(posted.single["childName"], "Aarav");
      expect(posted.single["classSoughtId"], "c_ukg");
      expect(posted.single["guardianName"], "Mohan");
      expect(posted.single["mobile"], "9811122244");
    });
  });

  group("Follow-ups", () {
    testWidgets(
      "Leads and Registered tabs; registration with money goes to the register route",
      (tester) async {
        _phone(tester);
        final registers = <Map<String, dynamic>>[];
        final client = MockClient((req) async {
          final p = req.url.path;
          if (p == "/api/v1/principal/lists") {
            return _ok({
              "date": "2026-10-20",
              "leads": [
                {
                  "id": "L1",
                  "enquiryNo": "ENQ/26/0001",
                  "childName": "Sita",
                  "guardianName": "Ram Kumar",
                  "mobile": "9811122233",
                  "stage": "enquiry",
                  "classSought": "LKG",
                  "nextFollowUpAt": "2026-10-19",
                  "overdueDays": 1,
                },
                {
                  "id": "L2",
                  "enquiryNo": "ENQ/26/0002",
                  "childName": "Gita",
                  "guardianName": "Ram Kumar",
                  "mobile": "9811122233",
                  "stage": "applied",
                  "classSought": "UKG",
                  "nextFollowUpAt": "2026-10-20",
                  "overdueDays": 0,
                },
              ],
            });
          }
          if (p == "/api/v1/staff/admissions/leads") {
            expect(req.url.queryParameters["filter"], "registered");
            return _ok({
              "counts": {"registered": 1},
              "leads": [
                {
                  ..._lead(
                    id: "L2",
                    stage: "applied",
                    registered: true,
                    fee: 500,
                    paid: 200,
                  ),
                  "childName": "Gita",
                },
              ],
            });
          }
          if (p == "/api/v1/staff/admissions/options") return _ok(_options);
          if (p == "/api/v1/staff/admissions/register") {
            registers.add(jsonDecode(req.body) as Map<String, dynamic>);
            return _ok({
              "leadId": "L1",
              "enquiryNo": "ENQ/26/0001",
              "applicationNo": "APP/26/0008",
              "feeRupees": 500,
              "balanceRupees": 0,
              "payment": {
                "code": "RF-0031",
                "amountRupees": 500,
                "mode": "upi",
              },
            });
          }
          return http.Response("{}", 404);
        });
        await http.runWithClient(() async {
          await tester.pumpWidget(
            _app(
              FollowUpsScreen(api: ApiClient(_config, cache: _memoryCache())),
            ),
          );
          await tester.pumpAndSettle();

          // Leads tab: the registered child is not here.
          expect(find.text("Leads (1)"), findsOneWidget);
          expect(find.text("Registered (1)"), findsOneWidget);
          expect(find.textContaining("Sita"), findsOneWidget);
          expect(find.textContaining("Gita"), findsNothing);

          await tester.tap(find.text("Registered (1)"));
          await tester.pumpAndSettle();
          expect(find.textContaining("Gita"), findsOneWidget);
          expect(find.text("Fee ₹500 · paid ₹200 · due ₹300"), findsOneWidget);
          expect(find.text("Follow up"), findsOneWidget);
          expect(find.text("Send to SIS"), findsOneWidget);

          // Register Sita from the Leads tab with the full fee by UPI.
          await tester.tap(find.text("Leads (1)"));
          await tester.pumpAndSettle();
          await tester.tap(find.text("Register"));
          await tester.pumpAndSettle();
          await tester.enterText(
            find.widgetWithText(TextField, "Registration fee (₹)"),
            "500",
          );
          await tester.tap(find.text("Money received now"));
          await tester.pumpAndSettle();
          await tester.enterText(
            find.widgetWithText(TextField, "Amount received (₹)"),
            "500",
          );
          await tester.tap(find.text("UPI"));
          await tester.pumpAndSettle();
          await tester.tap(find.widgetWithText(FilledButton, "Register").last);
          await tester.pumpAndSettle();
          expect(
            find.text("UTR / UPI ref is required for a non-cash payment"),
            findsOneWidget,
          );
          expect(registers, isEmpty);

          await tester.enterText(
            find.widgetWithText(TextField, "UTR / UPI ref"),
            "UTR998877",
          );
          await tester.tap(find.widgetWithText(FilledButton, "Register").last);
          await tester.pumpAndSettle();
        }, () => client);

        expect(registers, hasLength(1));
        final b = registers.single;
        expect(b["leadId"], "L1");
        expect(
          b["feeHeadId"],
          "fh_reg",
          reason: "the only head is preselected",
        );
        expect(b["feeAmountRupees"], 500);
        expect(b["collect"], {
          "amountRupees": 500,
          "mode": "upi",
          "ref": "UTR998877",
        });
      },
    );

    testWidgets(
      "Registered tab says 'not loaded' when the list cannot be read",
      (tester) async {
        _phone(tester);
        final client = MockClient((req) async {
          if (req.url.path == "/api/v1/principal/lists") {
            return _ok({"date": "2026-10-20", "leads": []});
          }
          if (req.url.path == "/api/v1/staff/admissions/leads") {
            return http.Response(
              jsonEncode({
                "ok": false,
                "error": {
                  "code": "forbidden",
                  "message": "Admission leads is not enabled for you",
                },
              }),
              403,
            );
          }
          return http.Response("{}", 404);
        });
        await http.runWithClient(() async {
          await tester.pumpWidget(
            _app(
              FollowUpsScreen(api: ApiClient(_config, cache: _memoryCache())),
            ),
          );
          await tester.pumpAndSettle();
          expect(find.text("Registered (?)"), findsOneWidget);
          await tester.tap(find.text("Registered (?)"));
          await tester.pumpAndSettle();
          expect(find.textContaining("not enabled for you"), findsOneWidget);
          expect(
            find.text("No registered leads are waiting to be sent to SIS."),
            findsNothing,
          );
        }, () => client);
      },
    );
  });
}
