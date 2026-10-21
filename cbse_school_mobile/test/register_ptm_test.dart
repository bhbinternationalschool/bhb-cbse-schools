// Month register fill / edit (request mr_mv9ysuiwc6ks) and PTM scheduling
// (request mr_mv9yydt031or), 20 Oct 2026.
import "dart:convert";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/staff/month_register_edit.dart";
import "package:cbse_school_mobile/features/staff/month_register_screen.dart";
import "package:cbse_school_mobile/features/staff/ptm_schedule_screen.dart";
import "package:cbse_school_mobile/features/staff/ptm_teacher_screen.dart";
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

Widget _app(Widget home) => LocaleScope(
  controller: LocaleController(),
  child: MaterialApp(
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    home: home,
  ),
);

http.Response _ok(Object data) => http.Response(
  jsonEncode({"ok": true, "data": data}),
  200,
  headers: {"content-type": "application/json; charset=utf-8"},
);

Map<String, dynamic> _day(
  String date, {
  bool working = true,
  bool future = false,
}) => {
  "date": date,
  "working": working,
  "half": false,
  "label": working ? "" : "Sunday Holiday",
  "future": future,
};

Map<String, dynamic> _sum(int w) => {
  "workingDays": w,
  "presentDays": 0,
  "unmarkedDays": 0,
  "percent": null,
};

/// 10 Oct (working), 11 Oct (Sunday), 12–13 Oct (working), 14 Oct (future).
/// Asha: P on the 10th, nothing on the 13th. Babu: admitted from the 12th,
/// LE on the 13th.
Map<String, dynamic> _month({required bool canEdit}) => {
  "academicYearCode": "2026-27",
  "today": "2026-10-13",
  "months": ["2026-10"],
  "canEdit": canEdit,
  "month": "2026-10",
  "days": [
    _day("2026-10-10"),
    _day("2026-10-11", working: false),
    _day("2026-10-12"),
    _day("2026-10-13"),
    _day("2026-10-14", future: true),
  ],
  "students": [
    {
      "id": "s1",
      "name": "Asha",
      "rollNo": "1",
      "startsOn": "2026-04-01",
      "marks": {"2026-10-10": "P"},
      "month": _sum(3),
      "session": _sum(90),
    },
    {
      "id": "s2",
      "name": "Babu",
      "rollNo": "2",
      "startsOn": "2026-10-12",
      "marks": {"2026-10-13": "LE"},
      "month": _sum(2),
      "session": _sum(2),
    },
  ],
};

const _summary = {
  "fullName": "Teacher",
  "classTeacherOf": {
    "classId": "c3",
    "sectionId": "s3a",
    "className": "III",
    "sectionName": "A",
  },
  "classes": [
    {
      "id": "c3",
      "name": "III",
      "sections": [
        {"id": "s3a", "name": "A"},
      ],
    },
  ],
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "signed.cookie",
    });
  });

  group("month register edits", () {
    test("only markable cells, only changes, and back to saved drops it", () {
      final r = MonthRegister.fromJson(_month(canEdit: true));
      final [asha, babu] = r.students;
      final [d10, d11, d12, d13, d14] = r.days;
      expect(monthCellMarkable(r, asha, d10), isTrue, reason: "a past day");
      expect(monthCellMarkable(r, asha, d11), isFalse, reason: "Sunday");
      expect(monthCellMarkable(r, asha, d14), isFalse, reason: "future");
      expect(monthCellMarkable(r, babu, d10), isFalse, reason: "not admitted");
      expect(monthCellMarkable(r, babu, d12), isTrue);
      final ro = MonthRegister.fromJson(_month(canEdit: false));
      expect(
        monthCellMarkable(ro, ro.students.first, ro.days.first),
        isFalse,
        reason: "no canEdit, nothing is markable",
      );

      final e = MonthRegisterEdits();
      e.set(asha, d10, "A");
      expect(e.valueOf(asha, d10), "A");
      expect(e.count, 1);
      e.set(asha, d10, "P");
      expect(e.isEmpty, isTrue, reason: "back to the saved mark");
      e.set(asha, d10, "H");
      expect(e.isEmpty, isTrue, reason: "H is a holiday, never a mark");
      e.set(babu, d13, "");
      expect(e.payload(), [
        {
          "date": "2026-10-13",
          "marks": [
            {"studentId": "s2", "status": ""},
          ],
        },
      ], reason: "clearing is sent as an empty status");
    });

    test(
      "fill a day: that day's blanks only; other days and marks untouched",
      () {
        final r = MonthRegister.fromJson(_month(canEdit: true));
        final d12 = r.days[2];
        final d13 = r.days[3];
        final e = MonthRegisterEdits();
        expect(e.fillDay(r, d13), 1, reason: "Babu already has LE");
        expect(e.payload(), [
          {
            "date": "2026-10-13",
            "marks": [
              {"studentId": "s1", "status": "P"},
            ],
          },
        ]);
        expect(e.valueOf(r.students[1], d13), "LE");
        expect(
          e.valueOf(r.students[0], d12),
          "",
          reason: "the 12th is not filled",
        );
        expect(e.fillDay(r, r.days[1]), 0, reason: "a holiday is never filled");
        expect(
          e.fillDay(r, r.days[4]),
          0,
          reason: "a future day is never filled",
        );
        expect(e.fillDay(r, d13), 0, reason: "nothing blank is left");
      },
    );
  });

  group("month register screen", () {
    Future<List<Map<String, dynamic>>> pump(
      WidgetTester tester, {
      required bool canEdit,
    }) async {
      tester.view.physicalSize = const Size(900, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final posts = <Map<String, dynamic>>[];
      final client = MockClient((req) async {
        final path = req.url.path;
        if (path == "/api/v1/staff/summary") return _ok(_summary);
        if (path == "/api/v1/attendance/month" && req.method == "GET") {
          return _ok(_month(canEdit: canEdit));
        }
        if (path == "/api/v1/attendance/month" && req.method == "POST") {
          posts.add(jsonDecode(req.body) as Map<String, dynamic>);
          return _ok({
            "saved": ["2026-10-13"],
            "refused": [],
            "failed": [],
          });
        }
        return http.Response('{"error":"not found"}', 404);
      });
      await tester.pumpWidget(
        _app(MonthRegisterScreen(api: ApiClient(_config, client: client))),
      );
      await tester.pumpAndSettle();
      return posts;
    }

    testWidgets("a read-only user gets no edit controls", (tester) async {
      await pump(tester, canEdit: false);
      expect(find.text("1. Asha"), findsOneWidget);
      expect(find.byKey(const Key("month-register-view-only")), findsOneWidget);
      expect(find.byKey(const Key("month-register-edit-hint")), findsNothing);
      expect(find.byKey(const Key("month-cell-s1-2026-10-13")), findsNothing);
      expect(find.byKey(const Key("month-day-2026-10-13")), findsNothing);
      expect(find.byKey(const Key("month-register-save")), findsNothing);
    });

    testWidgets(
      "fill a day present, mark the exception, save: one day, changed cells only",
      (tester) async {
        final posts = await pump(tester, canEdit: true);
        expect(
          find.byKey(const Key("month-register-edit-hint")),
          findsOneWidget,
        );
        // Holidays, future days and days before admission take no tap.
        expect(find.byKey(const Key("month-cell-s1-2026-10-11")), findsNothing);
        expect(find.byKey(const Key("month-cell-s1-2026-10-14")), findsNothing);
        expect(find.byKey(const Key("month-cell-s2-2026-10-10")), findsNothing);
        expect(find.byKey(const Key("month-day-2026-10-11")), findsNothing);

        await tester.tap(find.byKey(const Key("month-day-2026-10-13")));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key("mark-P")));
        await tester.pumpAndSettle();
        // Babu's saved LE stays; now mark him absent as the exception.
        await tester.tap(find.byKey(const Key("month-cell-s2-2026-10-13")));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key("mark-A")));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key("month-register-save")));
        await tester.pumpAndSettle();
        expect(posts, hasLength(1));
        expect(posts.single["classId"], "c3");
        expect(posts.single["sectionId"], "s3a");
        expect(posts.single["month"], "2026-10");
        expect(posts.single["days"], [
          {
            "date": "2026-10-13",
            "marks": [
              {"studentId": "s1", "status": "P"},
              {"studentId": "s2", "status": "A"},
            ],
          },
        ]);
      },
    );
  });

  group("PTM scheduling", () {
    final teacherOptions = PtmScheduleOptions.fromJson({
      "canSchedule": true,
      "unrestricted": false,
      "today": "2026-10-20",
      "classes": [
        {"id": "c3", "name": "III", "sections": "B"},
        {"id": "c5", "name": "V", "sections": "A, B"},
      ],
    });

    test("reads GET /api/v1/staff/ptm/events", () {
      expect(teacherOptions.canSchedule, isTrue);
      expect(teacherOptions.classes.map((c) => c.id), ["c3", "c5"]);
      expect(teacherOptions.classes[1].sections, "A, B");
      final none = PtmScheduleOptions.fromJson({});
      expect(none.canSchedule, isFalse);
      expect(none.classes, isEmpty);
    });

    Future<(List<Map<String, dynamic>>, bool?)> runSchedule(
      WidgetTester tester,
      Future<void> Function() fill,
    ) async {
      final posts = <Map<String, dynamic>>[];
      final client = MockClient((req) async {
        if (req.url.path == "/api/v1/staff/ptm/events" &&
            req.method == "POST") {
          posts.add(jsonDecode(req.body) as Map<String, dynamic>);
          return _ok({
            "event": {"id": "ptme_1"},
          });
        }
        return http.Response('{"error":"not found"}', 404);
      });
      final api = ApiClient(_config, client: client);
      bool? result;
      await tester.pumpWidget(
        _app(
          Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) =>
                          PtmScheduleScreen(api: api, options: teacherOptions),
                    ),
                  );
                },
                child: const Text("open"),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text("open"));
      await tester.pumpAndSettle();
      await fill();
      await tester.tap(find.byKey(const Key("ptm-schedule-submit")));
      await tester.pumpAndSettle();
      return (posts, result);
    }

    testWidgets("several classes make ONE PTM covering them", (tester) async {
      final (posts, result) = await runSchedule(tester, () async {
        await tester.tap(find.byKey(const Key("ptm-class-c5")));
        await tester.tap(find.byKey(const Key("ptm-class-c3")));
        await tester.pump();
      });
      expect(posts, hasLength(1));
      expect(posts.single["classIds"], ["c3", "c5"]);
      expect(posts.single["date"], "2026-10-20");
      expect(posts.single["name"], "Parent-teacher meeting");
      expect(posts.single["mode"], "in_person");
      expect(result, isTrue);
    });

    testWidgets("no class picked: nothing is sent", (tester) async {
      final (posts, result) = await runSchedule(tester, () async {});
      expect(posts, isEmpty);
      expect(find.byKey(const Key("ptm-schedule-error")), findsOneWidget);
      expect(result, isNull);
    });

    Future<void> pumpPtm(
      WidgetTester tester,
      Map<String, dynamic> options,
    ) async {
      final client = MockClient((req) async {
        if (req.url.path == "/api/v1/staff/ptm") {
          return _ok({"staffId": "st1", "events": []});
        }
        if (req.url.path == "/api/v1/staff/ptm/events") return _ok(options);
        return http.Response('{"error":"not found"}', 404);
      });
      await tester.pumpWidget(
        _app(PtmTeacherScreen(api: ApiClient(_config, client: client))),
      );
      await tester.pumpAndSettle();
    }

    testWidgets("an admin (every class) reaches Schedule PTM", (tester) async {
      await pumpPtm(tester, {
        "canSchedule": true,
        "unrestricted": true,
        "today": "2026-10-20",
        "classes": [
          {"id": "c1", "name": "I", "sections": ""},
        ],
      });
      expect(find.byKey(const Key("ptm-schedule-fab")), findsOneWidget);
    });

    testWidgets("no right to schedule: no button", (tester) async {
      await pumpPtm(tester, {
        "canSchedule": false,
        "unrestricted": false,
        "today": "2026-10-20",
        "classes": [],
      });
      expect(find.byKey(const Key("ptm-schedule-fab")), findsNothing);
    });
  });
}
