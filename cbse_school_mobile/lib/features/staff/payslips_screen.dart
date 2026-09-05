import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";

String rupees(double v) {
  final whole = v.round().abs();
  final s = whole.toString();
  // Indian grouping: 12,34,567
  if (s.length <= 3) return "${v < 0 ? "-" : ""}₹$s";
  final last3 = s.substring(s.length - 3);
  var rest = s.substring(0, s.length - 3);
  final parts = <String>[];
  while (rest.length > 2) {
    parts.insert(0, rest.substring(rest.length - 2));
    rest = rest.substring(0, rest.length - 2);
  }
  if (rest.isNotEmpty) parts.insert(0, rest);
  return "${v < 0 ? "-" : ""}₹${parts.join(",")},$last3";
}

String monthLabel(String ym) {
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  final parts = ym.split("-");
  if (parts.length < 2) return ym;
  final m = int.tryParse(parts[1]) ?? 0;
  return m >= 1 && m <= 12 ? "${names[m - 1]} ${parts[0]}" : ym;
}

/// The staff member's own payslips — one per approved / posted / paid
/// payroll run. A month still in draft shows as "being prepared".
class PayslipsScreen extends StatelessWidget {
  const PayslipsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<PayslipList>(
      title: "Payslips",
      load: api.fetchPayslips,
      emptyIcon: Icons.receipt_long_outlined,
      emptyText:
          "No payslip has been released yet. One appears here for each month "
          "once the office approves that month's payroll.",
      isEmpty: (p) => p.slips.isEmpty && p.preparing == 0,
      builder: (context, p, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          if (p.preparing > 0)
            Card(
              color: ModuleTone.amber.background,
              child: ListTile(
                leading: Icon(
                  Icons.hourglass_top,
                  color: ModuleTone.amber.foreground,
                ),
                title: Text(
                  p.preparing == 1
                      ? "One month's salary is being prepared"
                      : "${p.preparing} months' salary are being prepared",
                  style: const TextStyle(fontSize: 13, color: AppColors.ink),
                ),
                subtitle: const Text(
                  "It appears here once the office approves the payroll.",
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            ),
          for (final s in p.slips) _SlipCard(s: s),
        ],
      ),
    );
  }
}

class _SlipCard extends StatelessWidget {
  const _SlipCard({required this.s});

  final Payslip s;

  @override
  Widget build(BuildContext context) {
    final tone = switch (s.status) {
      "paid" => ModuleTone.green,
      "posted" => ModuleTone.teal,
      _ => ModuleTone.blue,
    };
    return Card(
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 14),
        title: Row(
          children: [
            Expanded(
              child: Text(
                monthLabel(s.month),
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
            ),
            Text(
              rupees(s.amountPayable),
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: tone.foreground,
              ),
            ),
          ],
        ),
        subtitle: Text(
          "${switch (s.status) {
            "paid" => "Paid",
            "posted" => "Released",
            _ => "Approved",
          }}"
          "${s.paymentDate.isNotEmpty ? " · ${formatDateLabel(s.paymentDate)}" : ""}"
          "${s.paymentModeLabel.isNotEmpty ? " · ${s.paymentModeLabel}" : ""}"
          "${s.onHold ? " · on hold" : ""}",
          style: const TextStyle(fontSize: 12, color: AppColors.muted),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
        children: [
          _Row("Days in month", "${s.dayCount}"),
          _Row("Present", _n(s.daysPresent)),
          if (s.daysHalf > 0) _Row("Half days", _n(s.daysHalf)),
          if (s.daysLeavePaid > 0) _Row("Paid leave", _n(s.daysLeavePaid)),
          if (s.daysLwp > 0) _Row("Leave without pay", _n(s.daysLwp)),
          if (s.daysAbsent > 0) _Row("Absent", _n(s.daysAbsent)),
          if (s.daysHoliday > 0) _Row("Holidays", _n(s.daysHoliday)),
          const Divider(height: 18),
          for (final e in s.earnings) _Row(e.name, rupees(e.amount)),
          if (s.bonus > 0) _Row("Bonus", rupees(s.bonus)),
          _Row("Gross", rupees(s.gross), bold: true),
          const SizedBox(height: 6),
          for (final d in s.deductions) _Row(d.name, "– ${rupees(d.amount)}"),
          _Row(
            "Total deductions",
            "– ${rupees(s.totalDeductions)}",
            bold: true,
          ),
          const Divider(height: 18),
          _Row("Net pay", rupees(s.netPay), bold: true),
          if (s.amountPayable != s.netPay)
            _Row("Paid this month", rupees(s.amountPayable), bold: true),
          if (s.holdNote.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                s.holdNote,
                style: const TextStyle(fontSize: 12, color: AppColors.warning),
              ),
            ),
        ],
      ),
    );
  }

  String _n(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {this.bold = false});

  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: 12.5,
      fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
      color: bold ? AppColors.ink : AppColors.muted,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style.copyWith(color: AppColors.ink)),
        ],
      ),
    );
  }
}
