// "Message my classes" on the audience route (22 Oct 2026).
//
// The old screen POSTed free text to /api/v1/staff/broadcast for every
// family, which WhatsApp drops outside a family's 24-hour window. The screen
// now offers the sections the audience route lists, sends a custom message
// there (free text inside 24 h, the approved template for the rest), shows
// that split, and sends only with the dry run's count and a one-time sendId.
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/staff/class_message_screen.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:cbse_school_mobile/l10n/app_localizations_en.dart";
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

/// The audience route's GET for a teacher of 5-A and 6-B only.
final _options = {
  "schoolWide": false,
  "classes": [
    {
      "id": "c5",
      "name": "5",
      "sections": [
        {"id": "s5a", "name": "A", "label": "5-A"},
      ],
    },
    {
      "id": "c6",
      "name": "6",
      "sections": [
        {"id": "s6b", "name": "B", "label": "6-B"},
      ],
    },
  ],
  "designations": [],
  "routes": [],
  "feeStages": [],
  "templates": [],
  "customTemplateReady": true,
  "customMax": 1000,
};

/// The old GET: counts per section and the sent list (an audience send
/// logged with its label).
final _oldDesk = {
  "staffId": "st1",
  "sections": [
    {"sectionId": "s5a", "classId": "c5", "label": "Class 5 A", "families": 31},
    {"sectionId": "s6b", "classId": "c6", "label": "Class 6 B", "families": 28},
  ],
  "sent": [
    {
      "id": "sb_1",
      "at": "2026-10-21T05:30:00.000Z",
      "audience": "audience",
      "audienceLabel": "Parents of 5-A",
      "body": "Earlier note",
      "families": 31,
      "sent": 30,
      "pushSent": 4,
    },
  ],
};

Map<String, dynamic> _reply({required bool live}) => {
  "mode": live ? "live" : "dry_run",
  "audienceLabel": "Parents of 5-A",
  "channel": "whatsapp",
  "messageMode": "custom",
  "families": 31,
  "recipientCount": 30,
  "viaFreeText": 3,
  "viaTemplate": 27,
  "cannotReach": 0,
  "windowKnown": true,
  "estimate": {"paise": 345, "gstPct": 18, "ratesConfirmed": true},
  if (live) "sent": 29,
  if (live) "failed": 1,
  if (live) "push": {"sent": 7},
};

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {"content-type": "application/json; charset=utf-8"},
);

Future<void> _pump(WidgetTester tester) async {
  FlutterSecureStorage.setMockInitialValues({"bhb_session_cookie": "c"});
  // Wide: the test font (Ahem) draws every glyph as a full square, so the
  // message field's label row needs more room than on a phone.
  tester.view.physicalSize = const Size(900, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    LocaleScope(
      controller: LocaleController(),
      child: MaterialApp(
        localizationsDelegates: L.localizationsDelegates,
        supportedLocales: L.supportedLocales,
        home: ClassMessageScreen(
          api: ApiClient(
            _config,
            cache: JsonCache(
              baseDir: () async => throw const FileSystemException("test"),
            ),
          ),
        ),
      ),
    ),
  );
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  final l = LEn();

  testWidgets(
    "own sections only; custom message via the audience route; split shown; confirmed send",
    (tester) async {
      final audiencePosts = <Map<String, dynamic>>[];
      var oldRoutePosts = 0;
      final server = MockClient((req) async {
        if (req.url.path == "/api/v1/staff/broadcast/audience") {
          if (req.method == "GET") return _json({"data": _options});
          final body = jsonDecode(req.body) as Map<String, dynamic>;
          audiencePosts.add(body);
          return _json({"data": _reply(live: body["dryRun"] == false)});
        }
        if (req.url.path == "/api/v1/staff/broadcast") {
          if (req.method == "GET") return _json({"data": _oldDesk});
          oldRoutePosts++;
          return _json({"ok": true});
        }
        return _json({"data": {}});
      });

      await http.runWithClient(() async {
        await _pump(tester);
        await _settle(tester);

        // The teacher's two sections, with families per section.
        expect(find.widgetWithText(FilterChip, "5-A · 31"), findsOneWidget);
        expect(find.widgetWithText(FilterChip, "6-B · 28"), findsOneWidget);
        expect(find.byType(FilterChip), findsNWidgets(2));
        // The sent list still reads back, named by audienceLabel.
        expect(find.text("Parents of 5-A"), findsOneWidget);

        await tester.tap(find.widgetWithText(FilterChip, "5-A · 31"));
        await tester.enterText(
          find.byType(TextField).last,
          "School closed tomorrow",
        );
        await _settle(tester);
        await tester.tap(find.text("Check reach · पहुँच देखें"));
        await _settle(tester);

        final dry = audiencePosts.single;
        expect(dry["dryRun"], isTrue);
        expect(dry["mode"], "custom");
        expect(dry["text"], "School closed tomorrow");
        expect(dry["channel"], "whatsapp");
        expect(dry["audience"], {
          "kind": "parents",
          "sectionIds": ["s5a"],
        });
        // The free-text / template split from the dry run.
        expect(find.text(l.bcAsFreeText("3")), findsOneWidget);
        expect(find.text(l.bcViaTemplate("27")), findsOneWidget);

        await tester.ensureVisible(find.text(l.bcSendNow("30")));
        await tester.tap(find.text(l.bcSendNow("30")));
        await _settle(tester);
        // The confirmation carries the count.
        expect(
          find.text(l.bcConfirmBody("Parents of 5-A", "30")),
          findsOneWidget,
        );
        await tester.tap(
          find.widgetWithText(FilledButton, l.bcSendNow("30")).last,
        );
        await _settle(tester);

        final live = audiencePosts.last;
        expect(live["dryRun"], isFalse);
        expect(live["confirmCount"], 30);
        expect((live["sendId"] as String).startsWith("app_"), isTrue);
        expect(find.text(l.bcResult("29", "1", "0", "7")), findsOneWidget);
        // Nothing goes down the old free-text path any more.
        expect(oldRoutePosts, 0);
      }, () => server);
    },
  );

  testWidgets(
    "a failed live send keeps its sendId, so a retry cannot double-send",
    (tester) async {
      final liveIds = <String>[];
      var failNext = true;
      final server = MockClient((req) async {
        if (req.url.path == "/api/v1/staff/broadcast/audience") {
          if (req.method == "GET") return _json({"data": _options});
          final body = jsonDecode(req.body) as Map<String, dynamic>;
          if (body["dryRun"] == false) {
            liveIds.add(body["sendId"] as String);
            if (failNext) {
              failNext = false;
              return _json({
                "error": {
                  "code": "server_error",
                  "message": "Dispatch timed out",
                },
              }, 502);
            }
          }
          return _json({"data": _reply(live: body["dryRun"] == false)});
        }
        // Old GET unreadable: counts and sent list are unknown, not zero.
        return _json({
          "error": {"code": "server_error", "message": "down"},
        }, 500);
      });

      await http.runWithClient(() async {
        await _pump(tester);
        await _settle(tester);

        expect(find.widgetWithText(FilterChip, "5-A"), findsOneWidget);
        expect(find.text(l.cmFamiliesNotLoaded), findsOneWidget);
        expect(
          find.text(
            "Your sent messages could not be loaded — pull down to try again.",
          ),
          findsOneWidget,
        );

        await tester.tap(find.widgetWithText(FilterChip, "6-B"));
        await tester.enterText(find.byType(TextField).last, "PTM on Saturday");
        await _settle(tester);
        await tester.tap(find.text("Check reach · पहुँच देखें"));
        await _settle(tester);

        for (var attempt = 0; attempt < 2; attempt++) {
          await tester.ensureVisible(find.text(l.bcSendNow("30")).first);
          await tester.tap(find.text(l.bcSendNow("30")).first);
          await _settle(tester);
          await tester.tap(
            find.widgetWithText(FilledButton, l.bcSendNow("30")).last,
          );
          await _settle(tester);
        }

        expect(liveIds, hasLength(2));
        expect(liveIds[0], liveIds[1]);
      }, () => server);
    },
  );
}
