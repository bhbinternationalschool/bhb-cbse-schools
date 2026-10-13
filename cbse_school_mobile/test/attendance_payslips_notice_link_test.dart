import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/core/theme/app_theme.dart";
import "package:cbse_school_mobile/features/modules/notice_detail_screen.dart";
import "package:cbse_school_mobile/features/staff/home_groups.dart";
import "package:cbse_school_mobile/features/staff/my_attendance_calendar_screen.dart";
import "package:cbse_school_mobile/features/staff/payslips_screen.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";

CommsItem _item(String id, {bool news = false}) => CommsItem(
  id: id,
  title: "T$id",
  body: "",
  publishedAt: "2026-10-13",
  pinned: false,
  isNews: news,
  summary: "",
);

Payslip _slip(
  String month, {
  String status = "paid",
  String date = "",
  String mode = "",
}) => Payslip.fromJson({
  "month": month,
  "status": status,
  "paymentDate": date,
  "paymentModeLabel": mode,
  "amountPayable": 1000,
  "netPay": 1000,
});

void main() {
  group("calendar grid", () {
    test("Sunday-first leading blanks, like the web grid", () {
      expect(calendarLeadingBlanks("2026-10"), 4); // 1 Oct 2026 = Thursday
      expect(calendarLeadingBlanks("2026-11"), 0); // 1 Nov 2026 = Sunday
      expect(calendarLeadingBlanks("2026-09"), 2); // 1 Sep 2026 = Tuesday
      expect(calendarLeadingBlanks("2026-08"), 6); // 1 Aug 2026 = Saturday
      expect(calendarLeadingBlanks("nonsense"), 0);
    });

    test("months shift across years", () {
      expect(shiftMonth("2026-01", -1), "2025-12");
      expect(shiftMonth("2025-12", 1), "2026-01");
      expect(shiftMonth("2026-10", 0), "2026-10");
    });

    test("month labels in both languages", () {
      expect(fullMonthLabel("2026-10"), "October 2026");
      expect(fullMonthLabel("2026-10", hindi: true), "अक्टूबर 2026");
      expect(fullMonthLabel("2026-13"), "2026-13");
    });

    test("every server day kind has the web's colour and word", () {
      expect(staffDayStyle("present").foreground, AppColors.success);
      expect(staffDayStyle("present").name, "Present");
      expect(staffDayStyle("late").foreground, AppColors.warning);
      expect(staffDayStyle("half_day").foreground, AppColors.info);
      expect(staffDayStyle("absent").foreground, AppColors.danger);
      expect(staffDayStyle("not_marked").dashed, isTrue);
      expect(staffDayStyle("not_marked").name, "Not marked");
      expect(staffDayStyle("leave").bold, isTrue);
      expect(staffDayStyle("holiday").foreground, AppColors.muted);
      expect(staffDayStyle("unpaid_holiday").foreground, AppColors.danger);
      expect(staffDayStyle("exempt").name, "No attendance kept");
      expect(staffDayStyle("future").faded, isTrue);
      expect(staffDayStyle("something_new").name, "");
      for (final k in kStaffLegendKinds) {
        expect(staffDayStyle(k).name, isNotEmpty);
        expect(staffDayStyle(k).hindi, isNotEmpty);
      }
    });

    test("the month response parses, counts included", () {
      final m = StaffAttendanceMonth.fromJson({
        "staffId": "s1",
        "fullName": "A",
        "month": "2026-10",
        "today": "2026-10-13",
        "exempt": false,
        "days": [
          {
            "date": "2026-10-01",
            "kind": "late",
            "label": "Late",
            "inTime": "08:41",
            "way": "GPS punch",
          },
          {"date": "2026-10-02", "kind": "holiday", "label": "Gandhi Jayanti"},
        ],
        "counts": {"present": 1, "late": 1, "lwpDays": 1.5},
      });
      expect(m.days.first.inTime, "08:41");
      expect(m.days.first.outTime, "");
      expect(m.days[1].kind, "holiday");
      expect(m.counts.late, 1);
      expect(m.counts.lwpDays, 1.5);
      expect(m.counts.absent, 0);
    });

    test("My attendance is always shown, under Self service", () {
      expect(kAlwaysShownStaffFeatures, contains("my_attendance"));
      expect(kLocalFeatureGroups["my_attendance"], "Self service");
    });
  });

  group("notice push links", () {
    test("?notice=<id> is read off the route", () {
      expect(noticeIdFromRoute(Uri.parse("/notices?notice=n_42")), "n_42");
      expect(noticeIdFromRoute(Uri.parse("/notices?notice=")), isNull);
      expect(noticeIdFromRoute(Uri.parse("/notices")), isNull);
      expect(noticeIdFromRoute(null), isNull);
      // The home's switch matches on the path, query and all.
      expect(Uri.parse("/notices?notice=n_42").path, "/notices");
    });

    test("a /notices?notice= link opens that notice, not the list", () {
      final api = ApiClient(AppConfig.production);
      final w = noticesScreenForRoute(api, Uri.parse("/notices?notice=n_42"));
      expect(w, isA<NoticeByIdScreen>());
      expect((w as NoticeByIdScreen).noticeId, "n_42");
    });

    test("the notice is found by id, a notice before news", () {
      final feed = [_item("a"), _item("b", news: true), _item("b")];
      expect(findCommsItem(feed, "a")?.title, "Ta");
      expect(findCommsItem(feed, "b")?.isNews, isFalse);
      expect(findCommsItem([_item("b", news: true)], "b")?.isNews, isTrue);
      expect(findCommsItem(feed, "zzz"), isNull);
    });
  });

  group("payslips month-wise", () {
    test("academic year runs April to March", () {
      expect(payslipAcademicYear("2026-04"), "2026-27");
      expect(payslipAcademicYear("2026-09"), "2026-27");
      expect(payslipAcademicYear("2027-03"), "2026-27");
      expect(payslipAcademicYear("2026-03"), "2025-26");
      expect(payslipAcademicYear("x"), "");
    });

    test("slips group by year, newest first", () {
      final g = groupPayslipsByYear([
        _slip("2026-03"),
        _slip("2026-09"),
        _slip("2026-04"),
      ]);
      expect(g.map((e) => e.$1).toList(), ["2026-27", "2025-26"]);
      expect(g.first.$2.map((s) => s.month).toList(), ["2026-09", "2026-04"]);
    });

    test("status chip says paid with date and mode, else pending", () {
      expect(
        payslipStatusText(
          _slip("2026-09", date: "2026-10-05", mode: "Bank transfer"),
        ),
        "Paid · 5 Oct 2026 · Bank transfer",
      );
      expect(payslipStatusText(_slip("2026-09")), "Paid");
      expect(
        payslipStatusText(_slip("2026-09", status: "posted")),
        "Posted — payment pending",
      );
      expect(
        payslipStatusText(_slip("2026-09", status: "approved")),
        "Approved — payment pending",
      );
    });
  });

  testWidgets("the calendar screen opens on the asked month", (tester) async {
    await tester.pumpWidget(
      LocaleScope(
        controller: LocaleController(),
        child: MaterialApp(
          localizationsDelegates: L.localizationsDelegates,
          supportedLocales: L.supportedLocales,
          home: MyAttendanceCalendarScreen(
            api: ApiClient(AppConfig.production),
            initialMonth: "2026-09",
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text("September 2026"), findsOneWidget);
    expect(find.byIcon(Icons.chevron_left), findsOneWidget);
    expect(find.byIcon(Icons.chevron_right), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
