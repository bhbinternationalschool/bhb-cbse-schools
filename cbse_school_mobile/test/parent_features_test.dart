import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/features/home/home_stats.dart";
import "package:flutter_test/flutter_test.dart";

void main() {
  group("home tiles", () {
    test("attendance is a dash until a register has been marked", () {
      expect(attendanceTileValue(null), "—");
      expect(
        attendanceTileValue(
          AttendanceHistory.fromJson(const {
            "markedDays": 0,
            "presentDays": 0,
            "absentDays": 0,
            "lateDays": 0,
            "entries": [],
          }),
        ),
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

    test(
      "checkout prefers the gateway page and falls back to the share page",
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
      },
    );

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

  group("leave", () {
    test("list parses requests and the type catalogue", () {
      final list = LeaveList.fromJson(const {
        "requests": [
          {
            "id": "slr_1",
            "studentId": "stu_1",
            "studentName": "A",
            "fromDate": "2026-09-08",
            "toDate": "2026-09-09",
            "days": 2,
            "leaveType": "SL",
            "leaveTypeLabel": "Full day",
            "reason": "Fever",
            "status": "pending",
            "createdAt": "2026-09-04T06:13:33.716Z",
            "decidedAt": "",
            "decisionNote": "",
          },
        ],
        "leaveTypes": [
          {"code": "SL", "label": "Full day", "note": ""},
          {"code": "HD_AM", "label": "Half day (AM)", "note": ""},
        ],
      });
      expect(list.requests.single.isPending, isTrue);
      expect(list.requests.single.days, 2);
      expect(list.leaveTypes.map((t) => t.isHalfDay), [false, true]);
    });
  });

  group("complaints", () {
    test("ticket status drives the closed flag", () {
      ComplaintTicketInfo t(String status) => ComplaintTicketInfo.fromJson({
        "id": "c",
        "studentId": null,
        "category": "transport",
        "categoryLabel": "Transport",
        "subject": "s",
        "description": "d",
        "date": "2026-09-04",
        "status": status,
        "statusLabel": status,
        "resolutionNote": "",
        "createdAt": "",
      });
      expect(t("open").isClosed, isFalse);
      expect(t("in_progress").isClosed, isFalse);
      expect(t("resolved").isClosed, isTrue);
      expect(t("closed").isClosed, isTrue);
      expect(t("open").studentId, isNull);
      expect(t("open").studentName, "");
    });
  });

  group("school WhatsApp", () {
    test("the card exists only when the server gave a usable contact", () {
      final withIt = ParentSummary.fromJson(const {
        "guardianName": "P",
        "children": [],
        "totalOpenBalanceLabel": "₹0",
        "schoolWhatsApp": {
          "number": "919451938805",
          "display": "+91 94519 38805",
          "chatUrl": "https://wa.me/919451938805?text=Hi",
        },
      });
      expect(withIt.schoolWhatsApp?.display, "+91 94519 38805");
      expect(withIt.schoolWhatsApp?.chatUrl, contains("wa.me/919451938805"));

      final without = ParentSummary.fromJson(const {
        "guardianName": "P",
        "children": [],
        "totalOpenBalanceLabel": "₹0",
        "schoolWhatsApp": null,
      });
      expect(without.schoolWhatsApp, isNull);

      final blank = ParentSummary.fromJson(const {
        "guardianName": "P",
        "children": [],
        "schoolWhatsApp": {"number": "", "display": "", "chatUrl": ""},
      });
      expect(
        blank.schoolWhatsApp,
        isNull,
        reason: "blank must not become a number",
      );
    });
  });

  group("profile & documents", () {
    test("a child's record parses with masked Aadhaar and the doc checklist", () {
      final profile = ParentProfile.fromJson(const {
        "household": {
          "id": "hh_1",
          "guardianName": "P",
          "mobile": "9876543210",
          "pincode": "",
        },
        "editableHouseholdFields": ["guardianName", "altMobile", "email"],
        "documents": [
          {
            "key": "birthCert",
            "label": "Birth certificate",
            "required": true,
            "accept": "image/jpeg,application/pdf",
            "hint": "h",
          },
          {
            "key": "photo",
            "label": "Passport photo",
            "required": true,
            "accept": "image/jpeg",
            "hint": "h",
          },
        ],
        "children": [
          {
            "id": "stu_1",
            "fullName": "A B",
            "admissionNo": "BHB-1",
            "classLabel": "LKG A",
            "gender": "M",
            "aadhaarMasked": "XXXX XXXX 9012",
            "completeness": 60,
            "docs": [
              {
                "key": "birthCert",
                "label": "Birth certificate",
                "required": true,
                "status": "missing",
                "statusLabel": "Missing",
                "fileName": "",
                "uploadedAt": "",
                "reviewNote": "",
                "previewUrl": null,
              },
              {
                "key": "photo",
                "label": "Passport photo",
                "required": true,
                "status": "verified",
                "statusLabel": "Verified",
                "fileName": "photo.jpg",
                "uploadedAt": "2026-09-01T00:00:00Z",
                "reviewNote": "",
                "previewUrl": "/api/documents/student/stu_1/photo",
              },
              {
                "key": "tc",
                "label": "TC",
                "required": false,
                "status": "rejected",
                "statusLabel": "Rejected",
                "fileName": "tc.pdf",
                "uploadedAt": "2026-09-01T00:00:00Z",
                "reviewNote": "Blurry",
                "previewUrl": "/api/documents/student/stu_1/tc",
              },
            ],
          },
        ],
      });
      final child = profile.children.single;
      expect(child.fields.firstWhere((f) => f.$1 == "Gender").$2, "Male");
      expect(
        child.fields.firstWhere((f) => f.$1 == "Aadhaar").$2,
        "XXXX XXXX 9012",
      );
      expect(
        child.fields.firstWhere((f) => f.$1 == "PEN").$2,
        "",
        reason: "blank stays blank, shown as a dash",
      );
      // Birth certificate missing counts; the rejected TC is optional so it does not.
      expect(child.requiredMissing, 1);
      expect(child.docs[1].isVerified, isTrue);
      expect(child.docs[2].isRejected, isTrue);
      expect(profile.documents.first.allowsPdf, isTrue);
      expect(profile.documents.last.allowsPdf, isFalse);
      expect(profile.household["mobile"], "9876543210");
      expect(profile.household["pincode"], "");
    });

    test("an upload result carries the message and the automatic checks", () {
      final r = DocumentSubmitResult.fromJson(const {
        "doc": {
          "key": "aadhaar",
          "label": "Aadhaar",
          "required": true,
          "status": "pending",
          "statusLabel": "Awaiting",
          "fileName": "a.jpg",
          "uploadedAt": "",
          "reviewNote": "",
          "previewUrl": "/x",
        },
        "validation": {
          "ran": true,
          "overall": "likely_match",
          "checks": [
            {"label": "Name", "status": "match", "note": ""},
            {"label": "Date of birth", "status": "missing_ocr", "note": ""},
          ],
        },
        "message": "Aadhaar submitted.",
      });
      expect(r.doc.isPending, isTrue);
      expect(r.checkRan, isTrue);
      expect(r.checks.map((c) => c.status), ["match", "missing_ocr"]);
      expect(DocumentSubmitResult.fromJson(const {}).checkRan, isFalse);
    });
  });

  group("receipts, pay-ahead and transport", () {
    test("the ledger splits what is due now from what may be paid ahead", () {
      final ledger = FeeLedger.fromJson(const {
        "studentName": "A",
        "openDues": [
          {
            "dueKey": "sep",
            "label": "Tuition · Sep",
            "kind": "installment",
            "dueOn": "2026-09-10",
            "balancePaise": 150000,
            "balanceLabel": "₹1,500",
          },
        ],
        "futureDues": [
          {
            "dueKey": "feb",
            "label": "Exam · Feb",
            "kind": "installment",
            "dueOn": "2027-02-10",
            "balancePaise": 50000,
            "balanceLabel": "₹500",
          },
        ],
        "openBalanceLabel": "₹1,500",
        "futureBalanceLabel": "₹500",
      });
      expect(ledger.openDues.single.dueKey, "sep");
      expect(ledger.futureDues.single.dueKey, "feb");
      expect(ledger.isEmpty, isFalse);
      expect(
        FeeLedger.fromJson(const {"openDues": [], "futureDues": []}).isEmpty,
        isTrue,
      );
    });

    test("a receipt parses with its PDF link and void flag", () {
      final r = ReceiptInfo.fromJson(const {
        "id": "rcv_1",
        "receiptNo": "RCV-00051",
        "date": "2026-04-06",
        "totalLabel": "₹7,500",
        "students": ["A", "B"],
        "particulars": ["Tuition"],
        "paidBy": "Cash",
        "voided": false,
        "pdfUrl": "/api/v1/receipts/rcv_1/pdf",
      });
      expect(r.pdfUrl, "/api/v1/receipts/rcv_1/pdf");
      expect(r.voided, isFalse);
      expect(r.students, ["A", "B"]);
    });

    test(
      "a child's transport shows the bus and a callable driver, or the request state",
      () {
        final mine = MyTransport.fromJson(const {
          "household": {
            "address": "Ayar",
            "locality": "",
            "landmark": "",
            "mobile": "9",
          },
          "children": [
            {
              "id": "s1",
              "fullName": "A",
              "classLabel": "V-A",
              "transport": {
                "routeCode": "R1",
                "routeName": "City",
                "stopName": "Temple",
                "serviceMode": "both",
                "suspended": false,
                "monthlyFeeLabel": "₹800",
                "vehicle": {
                  "name": "Bus 1",
                  "registrationNo": "UP65QT4657",
                  "type": "bus",
                },
                "driver": {"name": "Ram", "mobile": "+91 98765 43210"},
              },
              "request": null,
            },
            {
              "id": "s2",
              "fullName": "B",
              "classLabel": "II-A",
              "transport": null,
              "request": {
                "id": "treq_1",
                "status": "contacted",
                "createdAt": "2026-09-04T00:00:00Z",
                "handlingNote": "Called",
              },
            },
            {
              "id": "s3",
              "fullName": "C",
              "classLabel": "I-A",
              "transport": null,
              "request": null,
            },
          ],
        });
        expect(mine.address, "Ayar");
        expect(mine.children[0].transport!.canCallDriver, isTrue);
        expect(mine.children[0].transport!.vehicleReg, "UP65QT4657");
        expect(mine.children[1].transport, isNull);
        expect(mine.children[1].request!.isActive, isTrue);
        expect(mine.children[2].request, isNull);

        final noNumber = ChildTransport.fromJson(const {
          "routeCode": "R",
          "vehicle": {},
          "driver": {"name": "Ram", "mobile": ""},
        });
        expect(
          noNumber.canCallDriver,
          isFalse,
          reason: "no number, no call button",
        );
      },
    );

    test("a queue row knows whether it still needs action", () {
      final open = TransportRequestInfo.fromJson(const {
        "id": "t",
        "status": "open",
      });
      final done = TransportRequestInfo.fromJson(const {
        "id": "t",
        "status": "assigned",
      });
      expect(open.isActive, isTrue);
      expect(done.isActive, isFalse);
    });
  });
}
