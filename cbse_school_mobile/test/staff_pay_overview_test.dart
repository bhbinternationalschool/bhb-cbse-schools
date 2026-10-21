import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/features/staff/staff_pay_overview_screens.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";

// Management pay views (20 Oct 2026): a month nobody ran is "Not run",
// never ₹0; figures and parts read as the server sends them.

Map<String, dynamic> _month(String state, {Map<String, dynamic>? figures}) => {
  "month": "2026-08",
  "state": state,
  "gross": null,
  "totalDeductions": null,
  "netPay": null,
  "payable": null,
  "paid": null,
  "unpaid": null,
  "onHold": false,
  "holdNote": "",
  "parts": <dynamic>[],
  "extraRuns": 0,
  ...?figures,
};

void main() {
  final en = lookupL(const Locale("en"));

  test("a month not run has no figures and says Not run", () {
    final m = PayrollMonthInfo.fromJson(_month("not_run"));
    expect(m.hasFigures, false);
    expect(m.netPay, isNull);
    expect(payrollMonthStateText(en, m), "Not run");
    final p = PayrollMonthInfo.fromJson(_month("preparing"));
    expect(payrollMonthStateText(en, p), "Being prepared");
  });

  test("a month paid in parts shows what is still unpaid", () {
    final m = PayrollMonthInfo.fromJson(
      _month(
        "posted",
        figures: {
          "gross": 21000,
          "totalDeductions": 1000,
          "netPay": 20000,
          "payable": 20000,
          "paid": 12000,
          "unpaid": 8000,
          "parts": [
            {
              "runId": "r1",
              "runStatus": "posted",
              "amount": 12000,
              "paid": true,
              "paidOn": "2026-09-05",
              "paymentModeLabel": "UPI",
            },
          ],
        },
      ),
    );
    expect(m.hasFigures, true);
    expect(m.parts.single.paid, true);
    expect(payrollMonthStateText(en, m), contains("8,000"));
    final full = PayrollMonthInfo.fromJson(
      _month("paid", figures: {"netPay": 5000, "paid": 5000, "unpaid": 0}),
    );
    expect(payrollMonthStateText(en, full), "Paid");
    final none = PayrollMonthInfo.fromJson(
      _month("posted", figures: {"netPay": 5000, "paid": 0, "unpaid": 5000}),
    );
    expect(payrollMonthStateText(en, none), "Not paid yet");
  });

  test("advance totals parse and the search matches name or code", () {
    final d = AdvancesOverview.fromJson({
      "staff": [
        {
          "staffId": "s1",
          "empCode": "STF-001",
          "fullName": "Asha Devi",
          "taken": 18000,
          "recovered": 12500,
          "due": 5500,
          "advances": [
            {
              "id": "a1",
              "amount": 8000,
              "givenDate": "2026-09-10",
              "recovered": 2500,
              "outstanding": 5500,
              "recoveries": [
                {
                  "method": "return_to_school",
                  "amount": 2500,
                  "recoveredAt": "2026-09-20",
                },
              ],
            },
          ],
        },
        {"staffId": "s2", "empCode": "STF-002", "fullName": "Bina"},
      ],
      "totals": {"taken": 18000, "recovered": 12500, "due": 5500},
    });
    expect(d.due, 5500);
    expect(d.staff.first.advances.single.recoveries.single.fromSalary, false);
    List<String> find(String q) => filterByNameOrCode<StaffAdvanceTotalsInfo>(
      d.staff,
      q,
      (s) => s.fullName,
      (s) => s.empCode,
    ).map((s) => s.staffId).toList();
    expect(find("asha"), ["s1"]);
    expect(find("002"), ["s2"]);
    expect(find(""), ["s1", "s2"]);
  });

  testWidgets("detail screen shows Not run, not ₹0", (tester) async {
    final staff = StaffPayrollInfo.fromJson({
      "staffId": "s1",
      "fullName": "Asha",
      "months": [_month("not_run")],
    });
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: L.localizationsDelegates,
        supportedLocales: L.supportedLocales,
        home: StaffPayrollDetailScreen(staff: staff, session: "2026-27"),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text("Not run"), findsOneWidget);
    expect(find.textContaining("₹0"), findsNothing);
  });
}
