import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../l10n/app_localizations.dart";
import "../modules/module_shell.dart";
import "my_attendance_calendar_screen.dart" show fullMonthLabel;
import "payslips_screen.dart" show rupees;

// Management pay views (20 Oct 2026, director-approved requests
// mr_mva1bgmhdfu3 and mr_mva1j71v1ttn). Read only: nothing here moves money
// or edits a run. The server decides who may open them; the app shows the
// way in only to people whose feature list carries the switch.

/// Feature ids the server sends (lib/mobileFeatures.ts).
const kStaffPayslipsAllFeature = "staff_payslips_all";
const kStaffAdvancesAllFeature = "staff_advances_all";

/// People whose name or code matches [query] (case-insensitive).
List<T> filterByNameOrCode<T>(
  List<T> rows,
  String query,
  String Function(T) name,
  String Function(T) code,
) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return rows;
  return rows
      .where(
        (r) =>
            name(r).toLowerCase().contains(q) ||
            code(r).toLowerCase().contains(q),
      )
      .toList();
}

/// The chip under a month: "Not run", "Being prepared", "Paid", or the run's
/// stage — a month nobody ran is never shown as ₹0.
String payrollMonthStateText(L t, PayrollMonthInfo m) {
  switch (m.state) {
    case "not_run":
      return t.pmNotRun;
    case "preparing":
      return t.pmPreparing;
  }
  if (m.onHold) return t.pmOnHold;
  if ((m.unpaid ?? 0) <= 0 && (m.paid ?? 0) > 0) return t.pmPaid;
  if ((m.paid ?? 0) > 0) {
    return "${t.pmPaid} ${rupees(m.paid!)} · ${t.pmUnpaid} ${rupees(m.unpaid ?? 0)}";
  }
  return t.pmNotPaidYet;
}

ModuleTone payrollMonthTone(PayrollMonthInfo m) {
  if (!m.hasFigures) return ModuleTone.gray;
  if (m.onHold) return ModuleTone.coral;
  return (m.unpaid ?? 0) > 0 ? ModuleTone.amber : ModuleTone.green;
}

/// A small "All staff" button for the top of a self-service screen. It
/// appears only when the server lists [feature] for this person (cached
/// first, then fresh), so ordinary staff never see it.
class ManagementEntryCard extends StatefulWidget {
  const ManagementEntryCard({
    super.key,
    required this.api,
    required this.feature,
    required this.label,
    required this.open,
  });

  final ApiClient api;
  final String feature;
  final String label;
  final Widget Function() open;

  @override
  State<ManagementEntryCard> createState() => _ManagementEntryCardState();
}

class _ManagementEntryCardState extends State<ManagementEntryCard> {
  bool _has = false;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    try {
      final cached = await widget.api.cachedStaffFeatures();
      if (cached != null && mounted) {
        setState(() => _has = cached.value.has(widget.feature));
      }
      final fresh = await widget.api.fetchStaffFeatures();
      if (mounted) setState(() => _has = fresh.has(widget.feature));
    } catch (_) {
      // Keep whatever the cache said; the server still gates the screen.
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_has) return const SizedBox.shrink();
    return Card(
      color: ModuleTone.blue.background,
      child: ListTile(
        leading: Icon(Icons.groups_outlined, color: ModuleTone.blue.foreground),
        title: Text(widget.label, style: AppText.bodyMediumInk),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(
          context,
        ).push(MaterialPageRoute(builder: (_) => widget.open())),
      ),
    );
  }
}

// ------------------------------------------------------------- payslips

/// Every staff member's pay for a session; tap one for the months.
class StaffPayrollOverviewScreen extends StatefulWidget {
  const StaffPayrollOverviewScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<StaffPayrollOverviewScreen> createState() =>
      _StaffPayrollOverviewScreenState();
}

class _StaffPayrollOverviewScreenState
    extends State<StaffPayrollOverviewScreen> {
  String? _session;
  String _query = "";

  @override
  Widget build(BuildContext context) {
    final t = context.l10n;
    return ModuleShell<PayrollOverview>(
      key: ValueKey(_session ?? ""),
      guideId: "payslips",
      title: t.pmStaffPayslipsTitle,
      load: () => widget.api.fetchPayrollOverview(session: _session),
      emptyIcon: Icons.receipt_long_outlined,
      emptyText: t.pmNoStaff,
      builder: (context, d, _) {
        final rows = filterByNameOrCode<StaffPayrollInfo>(
          d.staff,
          _query,
          (s) => s.fullName,
          (s) => s.empCode,
        );
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search),
                      isDense: true,
                    ),
                    onChanged: (v) => setState(() => _query = v),
                  ),
                ),
                const SizedBox(width: 12),
                DropdownButton<String>(
                  value: d.session,
                  items: [
                    for (final s in {d.session, ...d.sessions})
                      DropdownMenuItem(value: s, child: Text(t.pmSession(s))),
                  ],
                  onChanged: (v) {
                    if (v != null && v != d.session) {
                      setState(() => _session = v);
                    }
                  },
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(t.pmReadOnlyNote, style: AppText.bodySmallMuted),
            const SizedBox(height: 8),
            if (rows.isEmpty)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Text(t.pmNoStaff, textAlign: TextAlign.center),
              ),
            for (final s in rows)
              Card(
                child: ListTile(
                  title: Text(
                    s.empCode.isEmpty
                        ? s.fullName
                        : "${s.fullName} · ${s.empCode}",
                    style: AppText.bodyMediumInk,
                  ),
                  subtitle: Text(
                    [
                      t.pmMonthsRun("${s.monthsRun}"),
                      if (s.monthsRun > 0) "${t.pmPaid} ${rupees(s.paidTotal)}",
                      if (!s.active) t.pmLeft,
                    ].join(" · "),
                    style: AppText.bodySmallMuted,
                  ),
                  trailing: s.unpaidTotal > 0
                      ? Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              rupees(s.unpaidTotal),
                              style: AppText.labelLarge.copyWith(
                                color: ModuleTone.amber.foreground,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            Text(t.pmUnpaid, style: AppText.labelSmallMuted),
                          ],
                        )
                      : const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => StaffPayrollDetailScreen(
                        staff: s,
                        session: d.session,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// One person's months for the session, each with its payment parts.
class StaffPayrollDetailScreen extends StatelessWidget {
  const StaffPayrollDetailScreen({
    super.key,
    required this.staff,
    required this.session,
  });

  final StaffPayrollInfo staff;
  final String session;

  @override
  Widget build(BuildContext context) {
    final t = context.l10n;
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(staff.fullName, style: AppText.titleMedium),
            Text(
              [
                if (staff.empCode.isNotEmpty) staff.empCode,
                t.pmSession(session),
              ].join(" · "),
              style: AppText.labelMedium.copyWith(
                color: const Color(0xFFB8C0D4),
              ),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final m in staff.months) _MonthCard(m: m, hindi: hindi),
        ],
      ),
    );
  }
}

class _MonthCard extends StatelessWidget {
  const _MonthCard({required this.m, required this.hindi});

  final PayrollMonthInfo m;
  final bool hindi;

  @override
  Widget build(BuildContext context) {
    final t = context.l10n;
    final tone = payrollMonthTone(m);
    final header = Row(
      children: [
        Expanded(
          child: Text(
            fullMonthLabel(m.month, hindi: hindi),
            style: AppText.titleSmallInk.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: tone.background,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            payrollMonthStateText(t, m),
            style: AppText.labelSmall.copyWith(
              color: tone.foreground,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
    if (!m.hasFigures) {
      return Card(
        child: Padding(padding: const EdgeInsets.all(14), child: header),
      );
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            header,
            const SizedBox(height: 8),
            _Line(t.pmGross, rupees(m.gross!)),
            _Line(t.pmDeductions, "– ${rupees(m.totalDeductions ?? 0)}"),
            _Line(t.pmNet, rupees(m.netPay!), bold: true),
            if (m.payable != m.netPay)
              _Line(t.pmPayable, rupees(m.payable ?? 0)),
            const Divider(height: 16),
            for (final p in m.parts)
              _Line(
                p.paid
                    ? [
                        t.pmPaidOn(formatDateLabel(p.paidOn)),
                        if (p.paymentModeLabel.isNotEmpty) p.paymentModeLabel,
                      ].join(" · ")
                    : t.pmNotPaidYet,
                rupees(p.amount),
              ),
            _Line(t.pmUnpaid, rupees(m.unpaid ?? 0), bold: true),
            if (m.holdNote.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  m.holdNote,
                  style: AppText.bodySmall.copyWith(color: AppColors.warning),
                ),
              ),
            if (m.extraRuns > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  t.pmExtraRuns("${m.extraRuns}"),
                  style: AppText.bodySmall.copyWith(color: AppColors.warning),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------- advances

/// Only staff who hold an advance: taken / recovered / due.
class StaffAdvancesOverviewScreen extends StatefulWidget {
  const StaffAdvancesOverviewScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<StaffAdvancesOverviewScreen> createState() =>
      _StaffAdvancesOverviewScreenState();
}

class _StaffAdvancesOverviewScreenState
    extends State<StaffAdvancesOverviewScreen> {
  String _query = "";

  @override
  Widget build(BuildContext context) {
    final t = context.l10n;
    return ModuleShell<AdvancesOverview>(
      guideId: "my-advances",
      title: t.pmStaffAdvancesTitle,
      load: widget.api.fetchAdvancesOverview,
      emptyIcon: Icons.account_balance_wallet_outlined,
      emptyText: t.pmNoAdvances,
      isEmpty: (d) => d.staff.isEmpty,
      builder: (context, d, _) {
        final rows = filterByNameOrCode<StaffAdvanceTotalsInfo>(
          d.staff,
          _query,
          (s) => s.fullName,
          (s) => s.empCode,
        );
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              color: ModuleTone.amber.background,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    _Total(t.pmTaken, d.taken),
                    _Total(t.pmRecovered, d.recovered),
                    _Total(t.pmDue, d.due, strong: true),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _query = v),
            ),
            const SizedBox(height: 8),
            for (final s in rows)
              Card(
                child: ListTile(
                  title: Text(
                    s.empCode.isEmpty
                        ? s.fullName
                        : "${s.fullName} · ${s.empCode}",
                    style: AppText.bodyMediumInk,
                  ),
                  subtitle: Text(
                    "${t.pmTaken} ${rupees(s.taken)} · ${t.pmRecovered} ${rupees(s.recovered)}",
                    style: AppText.bodySmallMuted,
                  ),
                  trailing: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        rupees(s.due),
                        style: AppText.labelLarge.copyWith(
                          color: s.due > 0
                              ? ModuleTone.amber.foreground
                              : ModuleTone.green.foreground,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(t.pmDue, style: AppText.labelSmallMuted),
                    ],
                  ),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => StaffAdvanceDetailScreen(staff: s),
                    ),
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
              child: Text(t.pmAdvancesNote, style: AppText.bodySmallMuted),
            ),
          ],
        );
      },
    );
  }
}

/// One person's advances, each with every recovery and its date.
class StaffAdvanceDetailScreen extends StatelessWidget {
  const StaffAdvanceDetailScreen({super.key, required this.staff});

  final StaffAdvanceTotalsInfo staff;

  @override
  Widget build(BuildContext context) {
    final t = context.l10n;
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    return Scaffold(
      appBar: AppBar(title: Text(staff.fullName, style: AppText.titleMedium)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: ModuleTone.amber.background,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  _Total(t.pmTaken, staff.taken),
                  _Total(t.pmRecovered, staff.recovered),
                  _Total(t.pmDue, staff.due, strong: true),
                ],
              ),
            ),
          ),
          for (final a in staff.advances)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _Line(
                      a.givenDate.isEmpty
                          ? t.pmTaken
                          : t.pmGiven(formatDateLabel(a.givenDate)),
                      rupees(a.amount),
                      bold: true,
                    ),
                    if (a.note.isNotEmpty)
                      Text(a.note, style: AppText.bodySmallMuted),
                    const Divider(height: 14),
                    for (final r in a.recoveries)
                      _Line(
                        r.fromSalary
                            ? t.pmFromSalary(
                                r.month.isEmpty
                                    ? (r.recoveredAt.length >= 10
                                          ? formatDateLabel(
                                              r.recoveredAt.substring(0, 10),
                                            )
                                          : "—")
                                    : fullMonthLabel(r.month, hindi: hindi),
                              )
                            : t.pmReturned(
                                r.recoveredAt.length >= 10
                                    ? formatDateLabel(
                                        r.recoveredAt.substring(0, 10),
                                      )
                                    : "—",
                              ),
                        "– ${rupees(r.amount)}",
                      ),
                    if (a.recoveries.isEmpty)
                      Text(t.pmNothingRecovered, style: AppText.bodySmallMuted),
                    _Line(t.pmDue, rupees(a.outstanding), bold: true),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Total extends StatelessWidget {
  const _Total(this.label, this.value, {this.strong = false});

  final String label;
  final double value;
  final bool strong;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        Text(
          rupees(value),
          style: AppText.titleSmallInk.copyWith(
            fontWeight: strong ? FontWeight.w800 : FontWeight.w600,
            color: strong ? ModuleTone.amber.foreground : null,
          ),
        ),
        Text(label, style: AppText.labelSmallMuted),
      ],
    ),
  );
}

class _Line extends StatelessWidget {
  const _Line(this.label, this.value, {this.bold = false});

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
          Text(value, style: style.copyWith(color: AppColors.ink)),
        ],
      ),
    );
  }
}
