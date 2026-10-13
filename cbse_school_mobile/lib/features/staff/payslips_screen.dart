import "dart:typed_data";

import "package:flutter/material.dart";
import "package:pdfx/pdfx.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";
import "../../core/i18n/locale_controller.dart";
import "my_attendance_calendar_screen.dart" show fullMonthLabel;

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

/// The academic year (April–March) a payslip month falls in:
/// "2026-09" → "2026-27", "2027-02" → "2026-27".
String payslipAcademicYear(String ym) {
  final p = ym.split("-");
  final y = int.tryParse(p.first);
  final m = p.length > 1 ? int.tryParse(p[1]) : null;
  if (y == null || m == null) return "";
  final start = m >= 4 ? y : y - 1;
  return "$start-${((start + 1) % 100).toString().padLeft(2, "0")}";
}

/// The words on a payslip's status chip: "Paid · 5 Oct 2026 · Bank transfer"
/// once paid, else that it is posted / approved and the payment is pending.
String payslipStatusText(Payslip s, {bool hindi = false}) {
  if (s.status == "paid") {
    return [
      hindi ? "भुगतान हो गया" : "Paid",
      if (s.paymentDate.isNotEmpty) formatDateLabel(s.paymentDate),
      if (s.paymentModeLabel.isNotEmpty) s.paymentModeLabel,
    ].join(" · ");
  }
  final stage = s.status == "posted"
      ? (hindi ? "पोस्ट हुई" : "Posted")
      : (hindi ? "स्वीकृत" : "Approved");
  return hindi ? "$stage — भुगतान बाकी" : "$stage — payment pending";
}

/// Slips (newest first, as the server sends them) under their academic
/// year, newest year first.
List<(String, List<Payslip>)> groupPayslipsByYear(List<Payslip> slips) {
  final sorted = [...slips]..sort((a, b) => b.month.compareTo(a.month));
  final out = <(String, List<Payslip>)>[];
  for (final s in sorted) {
    final ay = payslipAcademicYear(s.month);
    if (out.isEmpty || out.last.$1 != ay) out.add((ay, []));
    out.last.$2.add(s);
  }
  return out;
}

/// The staff member's own payslips — one per month (the server keeps the
/// best of paid / posted / approved), headed by the month, under its
/// academic year. A month still in draft shows as "being prepared".
/// Director, 13 Oct 2026: "show staff their monthwise paid payslip".
class PayslipsScreen extends StatelessWidget {
  const PayslipsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    return ModuleShell<PayslipList>(
      guideId: "payslips",
      title: hindi ? "वेतन पर्ची" : "Payslips",
      load: api.fetchPayslips,
      emptyIcon: Icons.receipt_long_outlined,
      emptyText: context.l10n.noPayslipHasBeenReleasedYet,
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
                  style: AppText.bodyMediumInk,
                ),
                subtitle: Text(
                  context.l10n.itAppearsHereOnceTheOffice,
                  style: AppText.bodySmallMuted,
                ),
              ),
            ),
          for (final (year, slips) in groupPayslipsByYear(p.slips)) ...[
            if (year.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 12, 4, 6),
                child: Text(
                  hindi ? "सत्र $year" : "Academic year $year",
                  style: AppText.labelLargeMuted.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            for (final s in slips) _SlipCard(s: s, api: api),
          ],
        ],
      ),
    );
  }
}

class _SlipCard extends StatelessWidget {
  const _SlipCard({required this.s, required this.api});

  final Payslip s;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    final paid = s.status == "paid";
    final tone = paid ? ModuleTone.green : ModuleTone.amber;
    return Card(
      child: ExpansionTile(
        tilePadding: const EdgeInsets.fromLTRB(14, 6, 10, 6),
        title: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                fullMonthLabel(s.month, hindi: hindi),
                style: AppText.titleSmallInk.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  rupees(s.amountPayable),
                  style: AppText.titleMedium.copyWith(
                    color: tone.foreground,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  paid
                      ? (hindi ? "मिला" : "Net paid")
                      : (hindi ? "देय" : "Net payable"),
                  style: AppText.labelSmallMuted,
                ),
              ],
            ),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              _Chip(
                text: payslipStatusText(s, hindi: hindi),
                tone: tone,
                icon: paid ? Icons.check_circle : Icons.schedule,
              ),
              if (s.onHold)
                _Chip(
                  text: hindi ? "रोकी गई" : "On hold",
                  tone: ModuleTone.coral,
                  icon: Icons.pause_circle_outline,
                ),
            ],
          ),
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
            _Row(
              paid ? "Paid this month" : "Payable this month",
              rupees(s.amountPayable),
              bold: true,
            ),
          if (s.holdNote.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                s.holdNote,
                style: AppText.bodySmall.copyWith(color: AppColors.warning),
              ),
            ),
          // The printed slip, on the letterhead — only when the server
          // offers it (an older server sends no pdfUrl).
          if (s.pdfUrl.isNotEmpty) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: () => openPayslipPdf(context, api, s),
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: const Text("Payslip PDF · वेतन पर्ची PDF"),
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _n(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);
}

class _Chip extends StatelessWidget {
  const _Chip({required this.text, required this.tone, required this.icon});

  final String text;
  final ModuleTone tone;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: tone.background,
      borderRadius: BorderRadius.circular(8),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: tone.foreground),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            text,
            style: AppText.labelSmall.copyWith(
              color: tone.foreground,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );
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
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style.copyWith(color: AppColors.ink)),
        ],
      ),
    );
  }
}

/// Fetch my payslip PDF for the month (with the session) and show it.
Future<void> openPayslipPdf(
  BuildContext context,
  ApiClient api,
  Payslip s,
) async {
  final hindi = Localizations.localeOf(context).languageCode == "hi";
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => AlertDialog(
      content: Row(
        children: [
          const SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              hindi ? "वेतन पर्ची ला रहे हैं…" : "Fetching your payslip…",
            ),
          ),
        ],
      ),
    ),
  );
  try {
    final bytes = await api.fetchPayslipPdf(s.pdfUrl);
    if (!context.mounted) return;
    Navigator.of(context).pop();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PayslipPdfScreen(
          title: fullMonthLabel(s.month, hindi: hindi),
          bytes: Uint8List.fromList(bytes),
        ),
      ),
    );
  } on ApiException catch (e) {
    if (!context.mounted) return;
    Navigator.of(context).pop();
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(e.message)));
  } catch (_) {
    if (!context.mounted) return;
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          hindi
              ? "वेतन पर्ची नहीं आ सकी — इंटरनेट देखें और फिर कोशिश करें।"
              : "Could not fetch the payslip — check the connection and try again.",
        ),
      ),
    );
  }
}

/// The month's payslip as the school prints it, in the app. Pinch to zoom.
class PayslipPdfScreen extends StatefulWidget {
  const PayslipPdfScreen({super.key, required this.title, required this.bytes});

  final String title;
  final Uint8List bytes;

  @override
  State<PayslipPdfScreen> createState() => _PayslipPdfScreenState();
}

class _PayslipPdfScreenState extends State<PayslipPdfScreen> {
  late final PdfControllerPinch _controller = PdfControllerPinch(
    document: PdfDocument.openData(widget.bytes),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text("Payslip · ${widget.title}", style: AppText.titleMedium),
        actions: const [
          ScreenGuideButton(guideId: "payslip-pdf", screenLabel: "payslip-pdf"),
        ],
      ),
      body: PdfViewPinch(controller: _controller),
    );
  }
}
