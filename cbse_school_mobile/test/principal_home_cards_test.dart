import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/guide/staff_guides.dart";
import "package:cbse_school_mobile/features/staff/staff_activity_screen.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";

StaffAttendanceRow _row(String id, String status) => StaffAttendanceRow(
  staffId: id,
  fullName: id,
  designation: "",
  mobile: "",
  status: status,
  inTime: "",
  outTime: "",
  punchWay: "",
);

StaffActivityItem _item(String kind, {int count = 1, int qty = 0}) =>
    StaffActivityItem.fromJson({
      "kind": kind,
      "count": count,
      "qty": qty,
      "firstAt": "08:05",
      "lastAt": "15:40",
      "details": <String>[],
    });

void main() {
  group("Present / Absent cards open the rows they count", () {
    final rows = [
      _row("p", "P"),
      _row("late", "L"),
      _row("half", "HD"),
      _row("absent", "A"),
      _row("leave", "LE"),
      _row("unmarked", ""),
    ];

    test("present = P, late and half day; absent = A only", () {
      expect(
        filterStaffToday(rows, StaffTodayFilter.present).map((r) => r.staffId),
        ["p", "late", "half"],
      );
      expect(
        filterStaffToday(rows, StaffTodayFilter.absent).map((r) => r.staffId),
        ["absent"],
      );
      expect(filterStaffToday(rows, null).length, rows.length);
    });
  });

  group("snapshot staff counts", () {
    Map<String, dynamic> snap(Map<String, dynamic> staff) => {"staff": staff};

    test("an unreadable exempt list is not shown as fact", () {
      expect(
        PrincipalSnapshot.fromJson(
          snap({"presentToday": 3, "absentToday": 1, "countsKnown": false}),
        ).staffCountsKnown,
        isFalse,
      );
      expect(
        PrincipalSnapshot.fromJson(
          snap({"presentToday": 3, "absentToday": 1, "countsKnown": true}),
        ).staffCountsKnown,
        isTrue,
      );
      // An older server sends no flag: its counts are what they always were.
      expect(
        PrincipalSnapshot.fromJson(
          snap({"presentToday": 3, "absentToday": 1}),
        ).staffCountsKnown,
        isTrue,
      );
    });
  });

  group("staff today: activities", () {
    test("parses the server answer and counts work, not punches", () {
      final d = StaffActivityToday.fromJson({
        "date": "2026-10-20",
        "auditKnown": false,
        "staff": [
          {
            "staffId": "s1",
            "fullName": "Asha",
            "designation": "PGT",
            "status": "P",
            "items": [
              {
                "kind": "punch_in",
                "count": 1,
                "qty": 0,
                "firstAt": "08:05",
                "lastAt": "08:05",
                "details": [],
              },
              {
                "kind": "attendance_register",
                "count": 2,
                "qty": 0,
                "firstAt": "08:30",
                "lastAt": "09:00",
                "details": ["V A", "V B"],
              },
            ],
          },
        ],
      });
      expect(d.auditKnown, isFalse);
      expect(d.staff.single.workCount, 2);
      expect(d.staff.single.items[1].details, ["V A", "V B"]);
    });

    test(
      "every kind the server sends has its own line, in both languages",
      () async {
        const kinds = [
          "punch_in",
          "punch_out",
          "attendance_register",
          "homework",
          "marks",
          "co_scholastic",
          "class_sheet",
          "student_records",
          "fee_receipts",
          "receipt_edit",
          "leave_applied",
          "staff_leave_decided",
          "student_leave_decided",
          "profile",
        ];
        for (final code in ["en", "hi"]) {
          final l = await L.delegate.load(Locale(code));
          for (final k in kinds) {
            final line = staffActivityLine(l, _item(k, count: 3, qty: 4200));
            expect(line, isNot(k), reason: "$code has no line for $k");
            expect(line, isNotEmpty);
          }
        }
        final en = await L.delegate.load(const Locale("en"));
        expect(
          staffActivityLine(en, _item("marks", count: 2, qty: 58)),
          "Entered marks for 58 students",
        );
        expect(staffActivityLine(en, _item("punch_in")), "Punched in at 08:05");
        expect(
          staffActivityLine(en, _item("fee_receipts", count: 2, qty: 150000)),
          "Collected ${formatInrPaise(150000)} in 2 receipts",
        );
      },
    );
  });

  group("create notice / news", () {
    test("an empty or overlong draft is stopped before it is sent", () {
      expect(noticeDraftProblem(title: " ", body: "x"), "title");
      expect(noticeDraftProblem(title: "Holiday", body: "  "), "body");
      expect(noticeDraftProblem(title: "x" * 201, body: "y"), "title_long");
      expect(noticeDraftProblem(title: "x", body: "y" * 5001), "body_long");
      expect(noticeDraftProblem(title: "Holiday", body: "School shut"), isNull);
    });
  });

  test("every new screen has its guide", () {
    final ids = staffScreenGuides.map((g) => g.id).toSet();
    for (final id in [
      "staff-today",
      "staff-attendance-today",
      "staff-profile",
      "notice-compose",
      "school-collections",
      "staff-contacts",
    ]) {
      expect(ids, contains(id));
    }
    expect(
      staffScreenGuides.map((g) => g.id).length,
      ids.length,
      reason: "a guide id is used twice",
    );
  });
}
