import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/push/broadcast_inbox.dart";
import "package:cbse_school_mobile/features/modules/notice_detail_screen.dart";
import "package:cbse_school_mobile/features/modules/notices_screen.dart";
import "package:cbse_school_mobile/features/staff/home_groups.dart";
import "package:cbse_school_mobile/features/staff/staff_profile_rules.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";

StaffProfileField _f(
  String kind, {
  String key = "k",
  bool approval = false,
  List<String> options = const [],
}) => StaffProfileField(
  key: key,
  label: "Field",
  kind: kind,
  approval: approval,
  options: options,
);

void main() {
  group("profile values are checked like the ERP checks them", () {
    test("mobile: 10 digits starting 6-9, +91 / 0 prefixes dropped", () {
      expect(
        checkStaffProfileValue(_f("mobile"), "98765 43210").$1,
        "9876543210",
      );
      expect(
        checkStaffProfileValue(_f("mobile"), "+91 9876543210").$1,
        "9876543210",
      );
      expect(
        checkStaffProfileValue(_f("mobile"), "09876543210").$1,
        "9876543210",
      );
      expect(checkStaffProfileValue(_f("mobile"), "12345").$2, isNotNull);
      expect(checkStaffProfileValue(_f("mobile"), "5876543210").$2, isNotNull);
    });

    test("PIN, email, Aadhaar, PAN, IFSC, account, number, date", () {
      expect(checkStaffProfileValue(_f("pincode"), "221001").$1, "221001");
      expect(
        checkStaffProfileValue(_f("pincode"), "22100").$2,
        "PIN code is 6 digits",
      );
      expect(checkStaffProfileValue(_f("email"), "A@B.In").$1, "a@b.in");
      expect(checkStaffProfileValue(_f("email"), "a@b").$2, isNotNull);
      expect(
        checkStaffProfileValue(_f("aadhaar"), "2345 6789 0123").$1,
        "234567890123",
      );
      expect(
        checkStaffProfileValue(_f("aadhaar"), "1234 5678 9012").$2,
        "Aadhaar is 12 digits",
      );
      expect(checkStaffProfileValue(_f("pan"), "abcde1234f").$1, "ABCDE1234F");
      expect(checkStaffProfileValue(_f("pan"), "ABCD1234F").$2, isNotNull);
      expect(
        checkStaffProfileValue(_f("ifsc"), "sbin0001234").$1,
        "SBIN0001234",
      );
      expect(checkStaffProfileValue(_f("ifsc"), "SBIN1001234").$2, isNotNull);
      expect(
        checkStaffProfileValue(_f("account"), "1234 5678 90").$1,
        "1234567890",
      );
      expect(checkStaffProfileValue(_f("account"), "12345").$2, isNotNull);
      expect(checkStaffProfileValue(_f("number"), "1 2").$1, "12");
      expect(checkStaffProfileValue(_f("number"), "1.5").$2, isNotNull);
      expect(checkStaffProfileValue(_f("date"), "1990-04-01").$1, "1990-04-01");
      expect(checkStaffProfileValue(_f("date"), "01/04/1990").$2, isNotNull);
    });

    test("select only takes its options; text squeezes spaces", () {
      final blood = _f("select", options: ["A+", "O-"]);
      expect(checkStaffProfileValue(blood, "O-").$1, "O-");
      expect(checkStaffProfileValue(blood, "Z").$2, isNotNull);
      expect(
        checkStaffProfileValue(_f("text"), "  Ram   Nagar ").$1,
        "Ram Nagar",
      );
    });

    test("clearing: allowed, except the name and the login mobile", () {
      expect(checkStaffProfileValue(_f("email"), "  ").$1, "");
      expect(
        checkStaffProfileValue(
          _f("mobile", key: "mobile", approval: true),
          "",
        ).$2,
        isNotNull,
      );
      expect(
        checkStaffProfileValue(
          _f("text", key: "fullName", approval: true),
          "",
        ).$2,
        isNotNull,
      );
    });
  });

  group("home tiles sit under their headings", () {
    test("server order, empty headings dropped, unknown heading last", () {
      final groups = groupStaffTiles(
        ["my_leave", "fee_take", "attendance_mark", "x_new"],
        (t) => t == "x_new" ? "Library" : kLocalFeatureGroups[t]!,
        order: kStaffGroupOrder,
      );
      expect(groups.map((g) => g.$1).toList(), [
        "Teaching",
        "Fees",
        "Self service",
        "Library",
      ]);
      expect(groups.first.$2, ["attendance_mark"]);
    });

    test("the server's group wins; an older server falls back locally", () {
      final fromServer = StaffFeatureSet.fromJson(const {
        "features": ["notices", "fee_take"],
        "groups": {"notices": "Leadership", "fee_take": "Fees"},
        "groupOrder": ["Fees", "Leadership", "Self service"],
      });
      expect(staffGroupOf(fromServer, "notices"), "Leadership");
      expect(fromServer.groupOrder.first, "Fees");

      final old = StaffFeatureSet.fromJson(const {
        "features": ["notices"],
      });
      expect(old.groups, isEmpty);
      expect(staffGroupOf(old, "notices"), "Self service");
      expect(staffGroupOf(old, "visitor_gate"), "Gate");
      expect(staffGroupOf(old, "something_new"), "Self service");
    });
  });

  group("a tapped broadcast opens in full", () {
    test("the full text is parked and the route names it", () {
      final route = BroadcastInbox.routeFor({
        "url": "/notices",
        "kind": "broadcast",
        "fullText": "A long message " * 40,
        "sender": "Principal",
        "title": "Principal · BHB International School",
      });
      final uri = Uri.parse(route!);
      expect(uri.path, "/notices");
      final item = BroadcastInbox.take(uri);
      expect(item!.body, startsWith("A long message"));
      expect(item.body.length, greaterThan(200));
      expect(item.sender, "Principal");
      // Taken once only.
      expect(BroadcastInbox.take(uri), isNull);
    });

    test("other pushes keep their url", () {
      expect(BroadcastInbox.routeFor({"url": "/homework"}), "/homework");
      expect(BroadcastInbox.routeFor({"title": "x"}), isNull);
    });
  });

  testWidgets("a notice's detail shows the whole body, uncut", (tester) async {
    final api = ApiClient(AppConfig.production);
    final body = List.generate(30, (i) => "Line $i of the notice.").join("\n");
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: L.localizationsDelegates,
        supportedLocales: L.supportedLocales,
        home: NoticeDetailScreen(
          api: api,
          item: CommsItem(
            id: "n1",
            title: "Diwali holidays",
            body: body,
            publishedAt: "2026-10-13T08:00:00Z",
            pinned: true,
            isNews: false,
            summary: "",
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text("Diwali holidays"), findsOneWidget);
    expect(find.text(body), findsOneWidget);
    expect(find.text("Pinned"), findsOneWidget);
  });

  test("a /notices link without a broadcast opens the list", () {
    final api = ApiClient(AppConfig.production);
    expect(
      noticesScreenForRoute(api, Uri.parse("/notices")),
      isA<NoticesScreen>(),
    );
  });
}
