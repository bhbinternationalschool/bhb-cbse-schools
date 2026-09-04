import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/features/home/home_stats.dart";
import "package:flutter_test/flutter_test.dart";

void main() {
  group("home tiles", () {
    test("attendance is a dash until a register has been marked", () {
      expect(attendanceTileValue(null), "—");
      expect(
        attendanceTileValue(AttendanceHistory.fromJson(const {
          "markedDays": 0,
          "presentDays": 0,
          "absentDays": 0,
          "lateDays": 0,
          "entries": [],
        })),
        "—",
      );
    });

    test("attendance counts late as present, over marked days", () {
      final h = AttendanceHistory.fromJson(const {
        "markedDays": 20,
        "presentDays": 17,
        "absentDays": 2,
        "lateDays": 1,
        "entries": [],
      });
      expect(attendanceTileValue(h), "90%");
    });

    test("homework counts posts and diary notes from the last seven days", () {
      final now = DateTime(2026, 9, 4, 15);
      final feed = HomeworkFeed.fromJson(const {
        "posts": [
          {"date": "2026-09-04", "title": "today"},
          {"date": "2026-08-29", "title": "six days ago, still in"},
          {"date": "2026-08-28", "title": "seven days ago, out"},
          {"date": "2026-09-05", "title": "future, out"},
        ],
        "diary": [
          {"date": "2026-09-01", "note": "in"},
        ],
        "subjects": [],
      });
      expect(homeworkTileValue(null, now), "—");
      expect(homeworkTileValue(feed, now), "3 new");
    });
  });

  group("fees", () {
    test("a due carries the key the checkout is asked for", () {
      final ledger = FeeLedger.fromJson(const {
        "studentName": "A",
        "openBalanceLabel": "₹1,500",
        "openDues": [
          {
            "dueKey": "stu_1:tuition:2026-09",
            "label": "Tuition — Sep",
            "kind": "tuition",
            "dueOn": "2026-09-10",
            "balancePaise": 150000,
            "balanceLabel": "₹1,500",
          },
        ],
      });
      expect(ledger.openDues.single.dueKey, "stu_1:tuition:2026-09");
    });

    test("checkout prefers the gateway page and falls back to the share page",
        () {
      final gw = ParentCheckout.fromJson(const {
        "linkId": "pl_1",
        "amountPaise": 150000,
        "checkoutUrl": "https://payments.cashfree.com/links/abc",
        "shareUrl": "https://bhbinternational.school/pay/share?x=1",
      });
      expect(gw.payUri.toString(), "https://payments.cashfree.com/links/abc");

      final noGw = ParentCheckout.fromJson(const {
        "linkId": "pl_2",
        "amountPaise": 150000,
        "checkoutUrl": null,
        "shareUrl": "https://bhbinternational.school/pay/share?x=2",
      });
      expect(
        noGw.payUri.toString(),
        "https://bhbinternational.school/pay/share?x=2",
      );

      expect(
        ParentCheckout.fromJson(const {"linkId": "pl_3"}).payUri,
        isNull,
      );
    });

    test("button amount uses Indian grouping, whole rupees", () {
      expect(formatInrPaise(0), "₹0");
      expect(formatInrPaise(99), "₹0");
      expect(formatInrPaise(150000), "₹1,500");
      expect(formatInrPaise(12345678), "₹1,23,456");
      expect(formatInrPaise(100000000), "₹10,00,000");
    });
  });

  group("e-book shelf", () {
    test("an unconfigured shelf is its own state, not an empty catalogue", () {
      final shelf = EbookShelf.fromJson(const {
        "configured": false,
        "missing": ["EBOOK_SHELF_URL"],
        "shelfUrl": null,
        "books": [],
        "note": "not set up",
      });
      expect(shelf.configured, isFalse);
      expect(shelf.books, isEmpty);
    });

    test("books parse with their pass key", () {
      final shelf = EbookShelf.fromJson(const {
        "configured": true,
        "shelfUrl": "https://online.fliphtml5.com/xyz/",
        "shelfKey": "123456",
        "books": [
          {
            "id": "b1",
            "title": "Maths VI",
            "author": "NCERT",
            "subject": "Maths",
            "classLabels": ["VI"],
            "url": "https://online.fliphtml5.com/xyz/abcd/",
            "passKey": "654321",
            "passKeyLabel": "Book key",
          },
        ],
        "catalogued": 1,
      });
      expect(shelf.configured, isTrue);
      expect(shelf.books.single.passKey, "654321");
      expect(shelf.books.single.classLabels, ["VI"]);
    });
  });
}
