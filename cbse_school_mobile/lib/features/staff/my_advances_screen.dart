import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";
import "my_attendance_calendar_screen.dart" show fullMonthLabel;
import "payslips_screen.dart" show rupees;

/// My salary advances, read straight from the office's advance register
/// (GET /api/v1/staff/my-advances): what was given and when, what has been
/// recovered and from which payslip months, and what is still to recover.
///
/// Show only — there is no route to ask for an advance from the app, so the
/// screen says to ask the office rather than offering a form that files
/// nothing. How much comes off each month is decided by the office in that
/// month's payroll; the register keeps no fixed instalment, so none is shown
/// as if it were a plan.
class MyAdvancesScreen extends StatelessWidget {
  const MyAdvancesScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    return ModuleShell<MyAdvances>(
      guideId: "my-advances",
      title: hindi ? "मेरा एडवांस" : "My advances",
      load: api.fetchMyAdvances,
      emptyIcon: Icons.account_balance_wallet_outlined,
      emptyText: hindi
          ? "आपके नाम कोई वेतन एडवांस दर्ज नहीं है।"
          : "No salary advance is recorded in your name.",
      isEmpty: (d) => d.advances.isEmpty,
      builder: (context, d, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          _OutstandingCard(total: d.outstanding, hindi: hindi),
          const SizedBox(height: 8),
          for (final a in d.advances) _AdvanceCard(a: a, hindi: hindi),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
            child: Text(
              hindi
                  ? "एडवांस चाहिए या कोई राशि ग़लत लगे, तो दफ़्तर से बात करें। हर महीने कितना कटेगा, यह दफ़्तर उस महीने के वेतन में तय करता है।"
                  : "To ask for an advance, or if an amount looks wrong, speak to the office. How much is recovered each month is set by the office in that month's payroll.",
              style: AppText.bodySmallMuted,
            ),
          ),
        ],
      ),
    );
  }
}

class _OutstandingCard extends StatelessWidget {
  const _OutstandingCard({required this.total, required this.hindi});

  final double total;
  final bool hindi;

  @override
  Widget build(BuildContext context) {
    final tone = total > 0 ? ModuleTone.amber : ModuleTone.green;
    return Card(
      color: tone.background,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(
              total > 0
                  ? Icons.account_balance_wallet_outlined
                  : Icons.check_circle_outline,
              color: tone.foreground,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                hindi ? "बाकी (वसूली होनी है)" : "Still to recover",
                style: AppText.bodyMediumInk,
              ),
            ),
            Text(
              rupees(total),
              style: AppText.titleMedium.copyWith(
                color: tone.foreground,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AdvanceCard extends StatelessWidget {
  const _AdvanceCard({required this.a, required this.hindi});

  final StaffAdvanceInfo a;
  final bool hindi;

  @override
  Widget build(BuildContext context) {
    final tone = a.closed ? ModuleTone.green : ModuleTone.amber;
    final salary = a.recoveries.where((r) => r.fromSalary).toList()
      ..sort((x, y) => x.month.compareTo(y.month));
    final months = a.salaryMonths;
    return Card(
      child: ExpansionTile(
        tilePadding: const EdgeInsets.fromLTRB(14, 6, 10, 6),
        title: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    rupees(a.amount),
                    style: AppText.titleSmallInk.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    a.givenDate.isEmpty
                        ? (hindi ? "तारीख़ दर्ज नहीं" : "Date not recorded")
                        : "${hindi ? "दिया" : "Given"} ${formatDateLabel(a.givenDate)}",
                    style: AppText.labelMediumMuted,
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  rupees(a.outstanding),
                  style: AppText.titleMedium.copyWith(
                    color: tone.foreground,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  hindi ? "बाकी" : "Balance",
                  style: AppText.labelSmallMuted,
                ),
              ],
            ),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            a.closed
                ? (hindi ? "पूरा वसूल हो गया" : "Fully recovered")
                : "${hindi ? "वसूल" : "Recovered"} ${rupees(a.recovered)}",
            style: AppText.labelSmall.copyWith(
              color: tone.foreground,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
        children: [
          _Row(hindi ? "एडवांस" : "Advance", rupees(a.amount)),
          _Row(hindi ? "अब तक वसूल" : "Recovered so far", rupees(a.recovered)),
          _Row(hindi ? "बाकी" : "Balance", rupees(a.outstanding), bold: true),
          _Row(
            hindi ? "हर महीने कटौती" : "Recovery per month",
            salary.isEmpty
                ? (a.closed
                      ? "—"
                      : (hindi
                            ? "दफ़्तर वेतन में तय करेगा"
                            : "Set by the office in payroll"))
                : "${hindi ? "पिछली" : "Last"} ${rupees(salary.last.amount)}",
          ),
          if (a.note.isNotEmpty) _Row(hindi ? "नोट" : "Note", a.note),
          if (months.isNotEmpty) ...[
            const Divider(height: 18),
            Text(
              hindi
                  ? "इन महीनों की वेतन पर्ची से कटा"
                  : "Recovered in these payslips",
              style: AppText.labelLargeInk.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 4),
          ],
          if (a.recoveries.isNotEmpty && months.isEmpty)
            const Divider(height: 18),
          for (final r in [
            ...a.recoveries,
          ]..sort((x, y) => _when(x).compareTo(_when(y))))
            _Row(
              r.fromSalary
                  ? (r.month.isEmpty
                        ? (hindi ? "वेतन से" : "From salary")
                        : fullMonthLabel(r.month, hindi: hindi))
                  : "${hindi ? "लौटाया" : "Returned"}${r.recoveredAt.length >= 10 ? " ${formatDateLabel(r.recoveredAt.substring(0, 10))}" : ""}",
              "– ${rupees(r.amount)}",
            ),
          if (a.recoveries.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                hindi ? "अभी कोई वसूली नहीं हुई।" : "Nothing recovered yet.",
                style: AppText.bodySmallMuted,
              ),
            ),
        ],
      ),
    );
  }

  static String _when(AdvanceRecoveryInfo r) =>
      r.month.isNotEmpty ? r.month : r.recoveredAt;
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {this.bold = false});

  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = bold
        ? AppText.labelLargeInk.copyWith(fontWeight: FontWeight.w700)
        : AppText.labelLargeMuted.copyWith(fontWeight: FontWeight.w400);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: style)),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: style.copyWith(color: AppColors.ink),
            ),
          ),
        ],
      ),
    );
  }
}
