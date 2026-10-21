part of "api_client.dart";

// Management pay views (20 Oct 2026): everyone's payslips by session and
// everyone's advances. Read only. The server gates both (mobile switch +
// the web's payroll / advances grant); an ordinary member of staff gets a
// 403 here and keeps their own payslips and advances.

double? _dn(Map<String, dynamic> j, String k) => (j[k] as num?)?.toDouble();

/// One payment of a month's salary — a month can be paid in parts.
class PayrollPartInfo {
  PayrollPartInfo.fromJson(Map<String, dynamic> j)
    : runId = _s(j, "runId"),
      runStatus = _s(j, "runStatus"),
      amount = _d(j, "amount"),
      paid = _b(j, "paid"),
      paidOn = _s(j, "paidOn"),
      paymentModeLabel = _s(j, "paymentModeLabel"),
      paymentRef = _s(j, "paymentRef");

  final String runId;
  final String runStatus;
  final double amount;
  final bool paid;
  final String paidOn;
  final String paymentModeLabel;
  final String paymentRef;
}

/// One month of one person. Figures are null when the month was not run
/// or is still being prepared — unknown, never 0.
class PayrollMonthInfo {
  PayrollMonthInfo.fromJson(Map<String, dynamic> j)
    : month = _s(j, "month"),
      state = _s(j, "state"),
      gross = _dn(j, "gross"),
      totalDeductions = _dn(j, "totalDeductions"),
      netPay = _dn(j, "netPay"),
      payable = _dn(j, "payable"),
      paid = _dn(j, "paid"),
      unpaid = _dn(j, "unpaid"),
      onHold = _b(j, "onHold"),
      holdNote = _s(j, "holdNote"),
      extraRuns = _i(j, "extraRuns"),
      parts = _list(j, "parts").map(PayrollPartInfo.fromJson).toList();

  final String month;

  /// "not_run" | "preparing" | "approved" | "posted" | "paid"
  final String state;
  final double? gross;
  final double? totalDeductions;
  final double? netPay;
  final double? payable;
  final double? paid;
  final double? unpaid;
  final bool onHold;
  final String holdNote;
  final int extraRuns;
  final List<PayrollPartInfo> parts;

  bool get hasFigures => netPay != null;
}

class StaffPayrollInfo {
  StaffPayrollInfo.fromJson(Map<String, dynamic> j)
    : staffId = _s(j, "staffId"),
      empCode = _s(j, "empCode"),
      fullName = _s(j, "fullName"),
      active = _b(j, "active"),
      monthsRun = _i(j, "monthsRun"),
      netTotal = _d(j, "netTotal"),
      paidTotal = _d(j, "paidTotal"),
      unpaidTotal = _d(j, "unpaidTotal"),
      months = _list(j, "months").map(PayrollMonthInfo.fromJson).toList();

  final String staffId;
  final String empCode;
  final String fullName;
  final bool active;
  final int monthsRun;
  final double netTotal;
  final double paidTotal;
  final double unpaidTotal;
  final List<PayrollMonthInfo> months;
}

class PayrollOverview {
  PayrollOverview.fromJson(Map<String, dynamic> j)
    : session = _s(j, "session"),
      currentSession = _s(j, "currentSession"),
      sessions = ((j["sessions"] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      staff = _list(j, "staff").map(StaffPayrollInfo.fromJson).toList();

  final String session;
  final String currentSession;
  final List<String> sessions;
  final List<StaffPayrollInfo> staff;
}

class AdvanceRecoveryRow {
  AdvanceRecoveryRow.fromJson(Map<String, dynamic> j)
    : method = _s(j, "method"),
      month = _s(j, "month"),
      amount = _d(j, "amount"),
      recoveredAt = _s(j, "recoveredAt"),
      returnMode = _s(j, "returnMode"),
      note = _s(j, "note");

  /// "salary" | "return_to_school"
  final String method;
  final String month;
  final double amount;
  final String recoveredAt;
  final String returnMode;
  final String note;

  bool get fromSalary => method != "return_to_school";
}

class AdvanceRow {
  AdvanceRow.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      amount = _d(j, "amount"),
      givenDate = _s(j, "givenDate"),
      note = _s(j, "note"),
      status = _s(j, "status"),
      recovered = _d(j, "recovered"),
      outstanding = _d(j, "outstanding"),
      recoveries = _list(
        j,
        "recoveries",
      ).map(AdvanceRecoveryRow.fromJson).toList();

  final String id;
  final double amount;
  final String givenDate;
  final String note;
  final String status;
  final double recovered;
  final double outstanding;
  final List<AdvanceRecoveryRow> recoveries;
}

class StaffAdvanceTotalsInfo {
  StaffAdvanceTotalsInfo.fromJson(Map<String, dynamic> j)
    : staffId = _s(j, "staffId"),
      empCode = _s(j, "empCode"),
      fullName = _s(j, "fullName"),
      taken = _d(j, "taken"),
      recovered = _d(j, "recovered"),
      due = _d(j, "due"),
      advanceCount = _i(j, "advanceCount"),
      openCount = _i(j, "openCount"),
      advances = _list(j, "advances").map(AdvanceRow.fromJson).toList();

  final String staffId;
  final String empCode;
  final String fullName;
  final double taken;
  final double recovered;
  final double due;
  final int advanceCount;
  final int openCount;
  final List<AdvanceRow> advances;
}

class AdvancesOverview {
  AdvancesOverview.fromJson(Map<String, dynamic> j)
    : staff = _list(j, "staff").map(StaffAdvanceTotalsInfo.fromJson).toList(),
      taken = _d(
        (j["totals"] as Map?)?.cast<String, dynamic>() ?? const {},
        "taken",
      ),
      recovered = _d(
        (j["totals"] as Map?)?.cast<String, dynamic>() ?? const {},
        "recovered",
      ),
      due = _d(
        (j["totals"] as Map?)?.cast<String, dynamic>() ?? const {},
        "due",
      );

  final List<StaffAdvanceTotalsInfo> staff;
  final double taken;
  final double recovered;
  final double due;
}

extension PayrollMgmtApi on ApiClient {
  /// Every staff member's pay for a session ("2026-27"); null = current.
  Future<PayrollOverview> fetchPayrollOverview({
    String? session,
  }) async => PayrollOverview.fromJson(
    await _getData(
      session == null || session.isEmpty
          ? "/api/v1/staff/payroll-overview"
          : "/api/v1/staff/payroll-overview?session=${Uri.encodeQueryComponent(session)}",
    ),
  );

  /// Staff who hold an advance, with totals and history.
  Future<AdvancesOverview> fetchAdvancesOverview() async =>
      AdvancesOverview.fromJson(
        await _getData("/api/v1/staff/advances-overview"),
      );
}
