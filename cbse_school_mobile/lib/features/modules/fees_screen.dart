import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "module_shell.dart";
import "receipts_screen.dart";

/// One child's open dues, with online payment.
///
/// The parent ticks what to pay (everything, by default), the server builds
/// the pay-link and hands back the gateway's hosted checkout, and the phone's
/// browser takes it from there. The app never handles card or UPI details
/// and never sends an amount — only due keys. When the parent comes back to
/// the app the ledger is reloaded, so a completed payment drops off the list
/// as soon as the gateway's webhook has settled it.
class FeesScreen extends StatefulWidget {
  const FeesScreen({super.key, required this.api, required this.child});

  final ApiClient api;
  final ParentChild child;

  @override
  State<FeesScreen> createState() => _FeesScreenState();
}

class _FeesScreenState extends State<FeesScreen> with WidgetsBindingObserver {
  /// Dues the parent has un-ticked. Stored inverted so that a fresh ledger
  /// starts fully selected without needing a load callback.
  final _deselected = <String>{};

  /// Months ahead the parent has chosen to clear now. Stored the other way
  /// round: nothing ahead is selected until they tick it.
  final _ahead = <String>{};
  bool _starting = false;

  /// Set when the browser has been opened for a payment; the next resume
  /// reloads the ledger and says so.
  bool _awaitingReturn = false;
  Future<void> Function()? _reload;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed || !_awaitingReturn) return;
    _awaitingReturn = false;
    _reload?.call();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            "Checking for your payment. Paid dues disappear from this list "
            "once the bank confirms — usually within a minute.",
          ),
          duration: Duration(seconds: 5),
        ),
      );
    }
  }

  List<FeeDue> _selected(FeeLedger ledger) => [
    ...ledger.openDues.where(
      (d) => d.dueKey.isNotEmpty && !_deselected.contains(d.dueKey),
    ),
    ...ledger.futureDues.where((d) => _ahead.contains(d.dueKey)),
  ];

  Future<void> _pay(FeeLedger ledger) async {
    final dues = _selected(ledger);
    if (dues.isEmpty || _starting) return;
    setState(() => _starting = true);
    try {
      final checkout = await widget.api.startParentCheckout(
        dueKeys: dues.map((d) => d.dueKey).toList(),
        studentId: widget.child.id,
      );
      final uri = checkout.payUri;
      if (uri == null) throw ApiException("Could not start payment", 400);
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened) {
        throw ApiException("No browser available to open the payment page", 0);
      }
      _awaitingReturn = true;
      Haptics.success();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast("Could not start payment — check your connection and try again.");
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Widget _dueTile(FeeDue due, {required bool ahead}) {
    final selected = ahead
        ? _ahead.contains(due.dueKey)
        : due.dueKey.isNotEmpty && !_deselected.contains(due.dueKey);
    return Card(
      child: CheckboxListTile(
        dense: true,
        controlAffinity: ListTileControlAffinity.leading,
        activeColor: AppColors.primary,
        value: selected,
        onChanged: due.dueKey.isEmpty
            ? null
            : (v) => setState(() {
                if (ahead) {
                  v == true
                      ? _ahead.add(due.dueKey)
                      : _ahead.remove(due.dueKey);
                } else if (v == true) {
                  _deselected.remove(due.dueKey);
                } else {
                  _deselected.add(due.dueKey);
                }
              }),
        title: Text(
          due.label,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.ink,
          ),
        ),
        subtitle: due.dueOn.isEmpty
            ? null
            : Text(
                "${ahead ? "Falls due" : "Due"} ${formatDateLabel(due.dueOn)}",
                style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
              ),
        secondary: Text(
          due.balanceLabel,
          style: const TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<FeeLedger>(
      title: "Fees",
      subtitle: widget.child.fullName,
      load: () => widget.api.fetchFeeLedger(widget.child.id),
      emptyIcon: Icons.task_alt,
      emptyText: "No pending fees — all dues are cleared. Thank you!",
      isEmpty: (ledger) => ledger.isEmpty,
      bottomBar: (context, ledger, reload) {
        _reload = reload;
        final selected = _selected(ledger);
        final total = selected.fold<int>(0, (s, d) => s + d.balancePaise);
        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: FilledButton.icon(
              onPressed: selected.isEmpty || _starting
                  ? null
                  : () => _pay(ledger),
              icon: _starting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.lock_outline, size: 18),
              label: Text(
                selected.isEmpty
                    ? "Select a fee to pay"
                    : "Pay ${formatInrPaise(total)} online",
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ),
        );
      },
      builder: (context, ledger, reload) {
        _reload = reload;
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              color: AppColors.primary,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        "Total due",
                        style: TextStyle(
                          color: Color(0xFFB8C0D4),
                          fontSize: 13,
                        ),
                      ),
                    ),
                    Text(
                      ledger.openBalanceLabel,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            const Padding(
              padding: EdgeInsets.fromLTRB(4, 4, 4, 6),
              child: Text(
                "Tick the fees you want to pay now.",
                style: TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ),
            for (final due in ledger.openDues) _dueTile(due, ahead: false),
            if (ledger.futureDues.isNotEmpty) ...[
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 4, 4, 6),
                child: Text(
                  "Pay ahead · ${ledger.futureBalanceLabel} for the months to come",
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(4, 0, 4, 6),
                child: Text(
                  "Not due yet. Tick any you would like to clear now.",
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
              for (final due in ledger.futureDues) _dueTile(due, ahead: true),
            ],
            const SizedBox(height: 12),
            Card(
              child: ListTile(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => ReceiptsScreen(api: widget.api),
                  ),
                ),
                leading: const Icon(
                  Icons.receipt_long_outlined,
                  color: AppColors.primary,
                ),
                title: const Text(
                  "Previous receipts",
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
                subtitle: const Text(
                  "Every payment so far, as a PDF",
                  style: TextStyle(fontSize: 11.5, color: AppColors.muted),
                ),
                trailing: const Icon(
                  Icons.chevron_right,
                  color: AppColors.muted,
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
