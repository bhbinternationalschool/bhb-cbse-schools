// Field survey in the staff app (director, 15 Oct 2026): a family recorded
// WITHOUT a survey day with the home placed on the map, the team leader's
// team & beats screen, and starting a survey day — each against a stand-in
// school server that checks what the app sends.
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/core/punch/punch_device_key.dart";
import "package:cbse_school_mobile/features/staff/survey_day_screen.dart";
import "package:cbse_school_mobile/features/staff/survey_location_picker.dart";
import "package:cbse_school_mobile/features/staff/survey_manage_screen.dart";
import "package:cbse_school_mobile/features/staff/survey_screen.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:flutter_test/flutter_test.dart";
import "package:geolocator/geolocator.dart";
import "package:http/http.dart" as http;
import "package:http/testing.dart";

const _config = AppConfig(
  apiBaseUrl: "https://erp.example.invalid",
  tenantSlug: "t",
  schoolName: "s",
  supabaseUrl: "",
  supabaseAnonKey: "",
);

/// Screenshots at 375 px: `flutter test --update-goldens --dart-define=SHOTS=true test/survey_team_app_test.dart`.
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

/// The phone's location, without a phone.
class _FakeGeo extends GeolocatorPlatform {
  @override
  Future<bool> isLocationServiceEnabled() async => true;
  @override
  Future<LocationPermission> checkPermission() async => LocationPermission.whileInUse;
  @override
  Future<Position> getCurrentPosition({LocationSettings? locationSettings}) async => Position(
    latitude: 25.31,
    longitude: 82.97,
    timestamp: DateTime.now(),
    accuracy: 9,
    altitude: 0,
    altitudeAccuracy: 0,
    heading: 0,
    headingAccuracy: 0,
    speed: 0,
    speedAccuracy: 0,
    isMocked: false,
  );
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({"bhb_session_cookie": "cookie-A"});
    GeolocatorPlatform.instance = _FakeGeo();
  });

  group("record a family without a survey day", () {
    testWidgets("the home is placed on the map and sent with the family", (tester) async {
      _phone(tester);
      Map<String, dynamic>? sent;
      final client = MockClient((req) async {
        if (req.url.path == "/api/v1/staff/survey/beats") {
          return http.Response(
            jsonEncode({
              "data": {
                "capturedTodayByMe": 0,
                "beats": [
                  {"id": "beat_1", "code": "B1", "name": "Shivpur", "area": "Ward 4", "targetHouseholds": 40, "captured": 3},
                ],
                "classes": [
                  {"id": "c1", "name": "Nursery"},
                ],
              },
            }),
            200,
          );
        }
        if (req.url.path == "/api/v1/staff/survey/capture") {
          sent = jsonDecode(req.body) as Map<String, dynamic>;
          return http.Response(jsonEncode({"data": {"enquiryNo": "ENQ-77", "duplicate": false}}), 200);
        }
        return http.Response("{}", 404);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          _app(
            SurveyScreen(
              api: ApiClient(_config, cache: _memoryCache()),
              // The map screen itself is tested below; here the surveyor "places" the pin.
              pickLocation: (_, _) async => (lat: 25.30123, lng: 82.98765, accuracyM: 0.0, source: "map"),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text("Families without a survey day"), findsOneWidget);
        expect(find.text("Other area (no beat)"), findsOneWidget, reason: "a family outside every beat can be recorded");
        await _shot(tester, "no_day_list_375");

        await tester.tap(find.byKey(const Key("survey-other-area")));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField).at(0), "Asha Kumari");
        await tester.enterText(find.byType(TextField).at(1), "Ramesh Kumar");
        await tester.enterText(find.byType(TextField).at(2), "9876543210");
        await tester.ensureVisible(find.byType(CheckboxListTile));
        await tester.tap(find.byType(CheckboxListTile));
        await tester.pump();

        // Saving without the home is refused on the phone.
        await tester.ensureVisible(find.text("Save family"));
        await tester.tap(find.text("Save family"));
        await tester.pump();
        expect(find.text("Place the family's home on the map first."), findsOneWidget);
        expect(sent, isNull);

        await tester.ensureVisible(find.byKey(const Key("survey-pick-location")));
        await tester.tap(find.byKey(const Key("survey-pick-location")));
        await tester.pumpAndSettle();
        expect(find.textContaining("Map pin 25.30123, 82.98765"), findsOneWidget);
        await _shot(tester, "no_day_sheet_375");

        await tester.ensureVisible(find.text("Save family"));
        await tester.tap(find.text("Save family"));
        await tester.pumpAndSettle();
      }, () => client);

      expect(sent, isNotNull);
      expect(sent!["beatId"], "", reason: "no beat: recorded in 'other area'");
      expect(sent!["childName"], "Asha Kumari");
      expect(sent!["parentConsent"], true);
      expect(sent!["location"], {"lat": 25.30123, "lng": 82.98765, "accuracyM": 0.0, "source": "map"});
      expect(find.text("Save family"), findsNothing, reason: "the sheet closes once the server saved it");
    });

    testWidgets("the map picker: tap places the pin, 'use my location' moves it", (tester) async {
      _phone(tester);
      SurveyPoint? got;
      await tester.pumpWidget(
        _app(
          Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () async {
                    got = await Navigator.of(context).push<SurveyPoint>(
                      MaterialPageRoute(
                        builder: (_) => SurveyLocationPicker(
                          showTiles: false,
                          locate: () async => (lat: 25.32, lng: 82.99, accuracyM: 14.0, source: "gps"),
                        ),
                      ),
                    );
                  },
                  child: const Text("open"),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text("open"));
      await tester.pumpAndSettle();
      final use = find.widgetWithText(FilledButton, "Use this place");
      expect(tester.widget<FilledButton>(use).onPressed, isNull, reason: "nothing placed yet");

      await tester.tapAt(tester.getCenter(find.byKey(const Key("survey-location-map"))));
      // flutter_map waits out the double-tap window before a tap counts.
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.textContaining("Pin:"), findsOneWidget);
      expect(find.byIcon(Icons.location_pin), findsOneWidget);
      await _shot(tester, "no_day_map_375");

      await tester.tap(find.text("Use my location"));
      await tester.pumpAndSettle();
      expect(find.textContaining("Your location: 25.32000, 82.99000 (±14 m)"), findsOneWidget);
      await tester.tap(use);
      await tester.pumpAndSettle();
      expect(got, (lat: 25.32, lng: 82.99, accuracyM: 14.0, source: "gps"));
    });
  });

  group("team leader: team & beats", () {
    testWidgets("adds staff, removes a surveyor, retires a beat — each one signed change", (tester) async {
      _phone(tester);
      final changes = <Map<String, dynamic>>[];
      var members = [
        {"id": "m_me", "name": "Leela (leader)", "kind": "staff", "role": "leader", "empCode": "E1", "revision": "r1", "isMe": true},
        {"id": "m_a", "name": "Arun", "kind": "staff", "role": "agent", "empCode": "E2", "revision": "r2", "isMe": false},
        {"id": "m_x", "name": "Outside Om", "kind": "external", "role": "agent", "empCode": "EXT", "revision": "r3", "isMe": false},
      ];
      var beats = [
        {"id": "b1", "code": "B1", "name": "Shivpur", "area": "Ward 4", "targetHouseholds": 40, "isActive": true, "revision": "rb1"},
      ];
      var staff = [
        {"id": "st_9", "name": "Neha Singh", "empCode": "E9"},
      ];
      SurveyTeamInfo info() => SurveyTeamInfo.fromJson({"members": members, "beats": beats, "staff": staff});
      Future<SurveyTeamInfo> call(String action, [Map<String, dynamic>? change]) async {
        if (action == "manage") {
          changes.add(change!);
          if (change["op"] == "member_add_staff") {
            members = [...members, {"id": "m_n", "name": "Neha Singh", "kind": "staff", "role": "agent", "empCode": "E9", "revision": "r9", "isMe": false}];
            staff = [];
          } else if (change["op"] == "member_remove") {
            members = members.where((m) => m["id"] != change["id"]).toList();
          } else if (change["op"] == "beat_active") {
            beats = [
              {...beats.first, "isActive": change["isActive"], "revision": "rb2"},
            ];
          }
        }
        return info();
      }

      await tester.pumpWidget(_app(SurveyManageScreen(call: call)));
      await tester.pumpAndSettle();
      expect(find.text("Team · 3"), findsOneWidget);
      // A leader may remove school-staff surveyors only — not themselves, not outsiders.
      expect(find.byKey(const Key("remove-m_a")), findsOneWidget);
      expect(find.byKey(const Key("remove-m_me")), findsNothing);
      expect(find.byKey(const Key("remove-m_x")), findsNothing);
      await _shot(tester, "leader_manage_375");

      await tester.tap(find.byKey(const Key("survey-add-staff")));
      await tester.pumpAndSettle();
      await tester.tap(find.text("Neha Singh"));
      await tester.pumpAndSettle();
      expect(changes.last, {"op": "member_add_staff", "staffId": "st_9"});
      expect(find.text("Neha Singh added to the team"), findsOneWidget);

      await tester.tap(find.byKey(const Key("remove-m_a")));
      await tester.pumpAndSettle();
      await tester.tap(find.text("Remove"));
      await tester.pumpAndSettle();
      expect(changes.last, {"op": "member_remove", "id": "m_a", "base": "r2"}, reason: "the base is the revision the screen loaded");
      expect(find.text("Arun"), findsNothing);

      await tester.tap(find.byKey(const Key("beat-active-b1")));
      await tester.pumpAndSettle();
      expect(changes.last, {"op": "beat_active", "id": "b1", "base": "rb1", "isActive": false});
      expect(find.text("Reactivate"), findsOneWidget);

      await tester.tap(find.byKey(const Key("survey-add-beat")));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key("beat-name")), "Lanka");
      await tester.tap(find.text("Save"));
      await tester.pumpAndSettle();
      expect(changes.last["op"], "beat_save");
      expect(changes.last["name"], "Lanka");
      expect(changes.last.containsKey("id"), isFalse, reason: "a new beat has no id — the server makes it");
    });

    test("the signed text of a change matches the server's manageExtra", () {
      expect(surveyManageExtra({"op": "member_remove", "id": "stm_1", "base": "x"}), "member_remove:stm_1");
      expect(surveyManageExtra({"op": "member_add_staff", "staffId": "st_9"}), "member_add_staff:st_9");
      expect(surveyManageExtra({"op": "beat_save", "name": "Lanka"}), "beat_save:Lanka");
    });
  });

  group("start a survey day", () {
    testWidgets("status → choose beat → start: signed, located, and the day opens", (tester) async {
      _phone(tester);
      final key = await PunchDeviceKey.load();
      final steps = <Map<String, dynamic>>[];
      var started = false;
      Map<String, dynamic> status() => {
        "member": {"name": "Leela", "startMode": "field", "kind": "staff", "role": "leader"},
        "canManage": true,
        "day": started
            ? {"status": "active", "beatId": "b1", "startedAt": DateTime.now().toUtc().toIso8601String(), "endedAt": null, "breaks": 0, "workedMs": 0}
            : null,
        "captures": [],
        "beats": [
          {"id": "b1", "name": "Shivpur", "area": "Ward 4"},
        ],
        "classes": [],
      };
      final client = MockClient((req) async {
        final body = jsonDecode(req.body) as Map<String, dynamic>;
        steps.add(body);
        if (body["action"] == "start") started = true;
        return http.Response(jsonEncode({"data": status()}), 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(_app(SurveyDayScreen(api: ApiClient(_config, cache: _memoryCache()))));
        await tester.pumpAndSettle();
        expect(find.text("Start survey · सर्वे शुरू करें"), findsOneWidget);
        expect(find.byKey(const Key("survey-manage-team")), findsOneWidget, reason: "the leader sees Manage team & beats");
        expect(find.byKey(const Key("survey-no-day")), findsOneWidget, reason: "no-day recording is always offered");
        await _shot(tester, "start_survey_375");

        await tester.tap(find.byType(DropdownButtonFormField<String>));
        await tester.pumpAndSettle();
        await tester.tap(find.text("Shivpur · Ward 4").last);
        await tester.pumpAndSettle();
        await tester.tap(find.text("Start survey · सर्वे शुरू करें"));
        await tester.pumpAndSettle();
      }, () => client);

      expect(steps.first["action"], "status");
      final start = steps.firstWhere((s) => s["action"] == "start");
      expect(start["beatId"], "b1");
      expect((start["geo"] as Map)["lat"], 25.31);
      final dev = start["device"] as Map;
      expect(dev["jwk"], key.publicJwk);
      expect(
        key.verify(PunchDeviceKey.surveyMessage(action: "start", extra: "", ts: dev["ts"] as int), dev["signature"] as String),
        isTrue,
        reason: "signed over the server's exact text",
      );
      expect(find.textContaining("working"), findsOneWidget);
      expect(find.text("Record a family · परिवार दर्ज करें"), findsOneWidget);
    });
  });
}
