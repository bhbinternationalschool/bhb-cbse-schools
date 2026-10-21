// Broadcast with an audience picker and a custom message (20 Oct 2026,
// requests mr_mva0gr5aop3y and mr_mva0ik2uqmoy).
//
// The server resolves the audience and decides who may aim where; the app
// builds the spec, shows the free-text / template split from the dry run,
// and sends only after a confirmation carrying the dry run's count.
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/staff/broadcast_screen.dart";
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

Map<String, dynamic> _options({required bool schoolWide}) => {
  "schoolWide": schoolWide,
  "classes": [
    {
      "id": "c5",
      "name": "5",
      "sections": [
        {"id": "s5a", "name": "A", "label": "5-A"},
      ],
    },
  ],
  "designations": schoolWide
      ? [
          {"id": "d1", "name": "PGT"},
        ]
      : [],
  "routes": schoolWide
      ? [
          {"id": "r1", "label": "Route 1"},
        ]
      : [],
  "feeStages": schoolWide
      ? [
          {"id": "S3", "label": "S3 Firm"},
        ]
      : [],
  "templates": [
    {
      "familyKey": "comms_notice",
      "name": "School notice broadcast",
      "module": "comms",
      "category": "UTILITY",
      "bodyEn": "Notice: {{noticeTitle}} {{noticeBody}} for {{guardianName}}",
      "bodyHi": "सूचना: {{noticeTitle}} {{noticeBody}}",
      "variables": [
        {"key": "noticeTitle", "label": "Title", "auto": false},
        {"key": "noticeBody", "label": "Body", "auto": false},
        {"key": "guardianName", "label": "Guardian", "auto": true},
      ],
    },
  ],
  "customTemplateReady": true,
  "customMax": 1000,
};

void main() {
  group("audience selection → spec", () {
    test("own sections, sorted; nothing picked = not ready", () {
      final a = BroadcastAudienceSelection();
      expect(a.toSpec(), isNull);
      a.sectionIds.addAll(["s5b", "s5a"]);
      expect(a.toSpec(), {
        "kind": "parents",
        "sectionIds": ["s5a", "s5b"],
      });
    });

    test("staff by stream and role; routes; fee stages; all parents", () {
      final a = BroadcastAudienceSelection(kind: BroadcastAudienceKind.staff)
        ..staffStream = "teaching";
      a.designationIds.add("d1");
      expect(a.toSpec(), {
        "kind": "staff",
        "stream": "teaching",
        "designationIds": ["d1"],
      });
      a.kind = BroadcastAudienceKind.route;
      expect(a.toSpec(), isNull);
      a.routeIds.add("r1");
      expect(a.toSpec(), {
        "kind": "transport_route",
        "routeIds": ["r1"],
      });
      a.kind = BroadcastAudienceKind.feeDefaulters;
      expect(a.toSpec(), {
        "kind": "fee_stage",
        "stages": ["S2", "S3", "S4"],
      });
      a.kind = BroadcastAudienceKind.parents;
      expect(a.toSpec(), {"kind": "parents"});
    });

    test("a teacher is offered only their own sections", () {
      final teacher = BroadcastAudienceOptions.fromJson(
        _options(schoolWide: false),
      );
      expect(BroadcastAudienceSelection.offered(teacher), [
        BroadcastAudienceKind.sections,
      ]);
      final principal = BroadcastAudienceOptions.fromJson(
        _options(schoolWide: true),
      );
      expect(
        BroadcastAudienceSelection.offered(principal),
        BroadcastAudienceKind.values,
      );
    });

    test("an unreadable template list stays unknown, not empty", () {
      final o = BroadcastAudienceOptions.fromJson({
        ..._options(schoolWide: true),
        "templates": null,
        "customTemplateReady": null,
      });
      expect(o.templates, isNull);
      expect(o.customTemplateReady, isNull);
    });

    test("a template asks only for what the server does not fill", () {
      final o = BroadcastAudienceOptions.fromJson(_options(schoolWide: true));
      expect(o.templates!.single.askFor.map((v) => v.key), [
        "noticeTitle",
        "noticeBody",
      ]);
    });
  });

  group("dry run → preview lines", () {
    final l = LEn();

    test("custom message: free text vs template, and the estimate", () {
      final p = AudienceBroadcastResult.fromJson({
        "mode": "dry_run",
        "audienceLabel": "Parents of 5-A",
        "channel": "whatsapp",
        "messageMode": "custom",
        "families": 31,
        "recipientCount": 30,
        "viaFreeText": 3,
        "viaTemplate": 27,
        "cannotReach": 0,
        "windowKnown": true,
        "skippedOptOut": 1,
        "skippedNotOnWhatsApp": 0,
        "skippedNoNumber": 0,
        "estimate": {"paise": 345, "gstPct": 18, "ratesConfirmed": true},
      });
      final lines = broadcastPreviewLines(l, p);
      expect(lines, contains(l.bcAsFreeText("3")));
      expect(lines, contains(l.bcViaTemplate("27")));
      expect(lines, contains(l.bcEstimate("₹3.45", "18")));
      expect(lines, isNot(contains(l.bcEstimateDefaults)));
    });

    test("no estimate is 'not loaded', never ₹0", () {
      final p = AudienceBroadcastResult.fromJson({
        "mode": "dry_run",
        "channel": "whatsapp",
        "messageMode": "template",
        "estimate": null,
      });
      expect(p.estimate, isNull);
      expect(broadcastPreviewLines(l, p), contains(l.bcEstimateUnknown));
    });

    test("app only: no WhatsApp lines at all", () {
      final p = AudienceBroadcastResult.fromJson({
        "mode": "dry_run",
        "channel": "app",
        "messageMode": "custom",
        "families": 12,
        "recipientCount": 12,
      });
      final lines = broadcastPreviewLines(l, p);
      expect(lines.any((x) => x.contains("WhatsApp")), isFalse);
      expect(lines, contains(l.bcFamiliesInAudience("12")));
    });
  });

  testWidgets("teacher: custom message to own section, confirmed send", (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "cookie-A",
    });
    tester.view.physicalSize = const Size(420, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final posts = <Map<String, dynamic>>[];
    final server = MockClient((req) async {
      if (req.url.path == "/api/v1/staff/broadcast/audience") {
        if (req.method == "GET") {
          return _json({"data": _options(schoolWide: false)});
        }
        final body = jsonDecode(req.body) as Map<String, dynamic>;
        posts.add(body);
        final live = body["dryRun"] == false;
        return http.Response(
          jsonEncode({
            "data": {
              "mode": live ? "live" : "dry_run",
              "audienceLabel": "Parents of 5-A",
              "channel": "whatsapp",
              "messageMode": "custom",
              "families": 31,
              "recipientCount": 30,
              "viaFreeText": 3,
              "viaTemplate": 27,
              "windowKnown": true,
              "estimate": {"paise": 345, "gstPct": 18, "ratesConfirmed": true},
              if (live) "sent": 29,
              if (live) "failed": 1,
              if (live) "push": {"sent": 7},
            },
          }),
          200,
        );
      }
      return http.Response('{"data":{}}', 200);
    });

    Future<void> settle() async {
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    await http.runWithClient(() async {
      await tester.pumpWidget(
        LocaleScope(
          controller: LocaleController(),
          child: MaterialApp(
            localizationsDelegates: L.localizationsDelegates,
            supportedLocales: L.supportedLocales,
            home: BroadcastScreen(
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
      await settle();
      final l = LEn();

      // A teacher never sees the school-wide audiences.
      expect(find.text(l.bcAudienceAllParents), findsNothing);
      expect(find.text(l.bcAudienceStaff), findsNothing);
      expect(find.text(l.bcOwnSectionsOnly), findsOneWidget);

      await tester.tap(find.widgetWithText(FilterChip, "A"));
      await tester.tap(find.text(l.bcModeCustom));
      await settle();
      await tester.enterText(
        find.byType(TextField).last,
        "School closed tomorrow",
      );
      await tester.ensureVisible(find.text(l.previewRecipients));
      await tester.tap(find.text(l.previewRecipients));
      await settle();

      expect(posts.single["dryRun"], isTrue);
      expect(posts.single["mode"], "custom");
      expect(posts.single["audience"], {
        "kind": "parents",
        "sectionIds": ["s5a"],
      });
      expect(find.text(l.bcAsFreeText("3")), findsOneWidget);
      expect(find.text(l.bcViaTemplate("27")), findsOneWidget);

      await tester.ensureVisible(find.text(l.bcSendNow("30")));
      await tester.tap(find.text(l.bcSendNow("30")));
      await settle();
      // The confirmation names the final count.
      await tester.tap(
        find.widgetWithText(FilledButton, l.bcSendNow("30")).last,
      );
      await settle();

      final live = posts.last;
      expect(live["dryRun"], isFalse);
      expect(live["confirmCount"], 30);
      expect((live["sendId"] as String).startsWith("app_"), isTrue);
      expect(find.text(l.bcResult("29", "1", "0", "7")), findsOneWidget);
    }, () => server);
  });
}

/// UTF-8 JSON (the template bodies carry Hindi).
http.Response _json(Object body) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  200,
  headers: {"content-type": "application/json; charset=utf-8"},
);
