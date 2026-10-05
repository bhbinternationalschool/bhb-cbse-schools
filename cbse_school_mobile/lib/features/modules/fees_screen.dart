import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "module_shell.dart";
import "receipts_screen.dart";
import "../../core/i18n/locale_controller.dart";

/// One child's open dues, with online payment.
///
/// The parent ticks what to pay (everything, by default), the server builds
/// the pay-link and hands back the gateway's hosted checkout, and the phone's
/// browser takes it from there. The app never handles card or UPI details
/// and never sends an amount — only due keys. When the parent comes back to
/// the app the ledger is reloaded, so a completed payment drops off the list
/// as soon as the gateway's webhook has settled it.
///
/// From 1.0.14: when the school passes the online payment charge on, the
/// parent picks how they will pay and sees the charge for that way BEFORE
/// the checkout opens; the order then takes only that way. And a family can
/// set up monthly fee auto-pay (UPI Autopay / e-NACH) from the same screen.
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

  /// Set when the browser has been opened to approve auto-pay; the next
  /// resume re-reads the mandate from Cashfree before reloading.
  bool _awaitingAutopay = false;
  bool _autopayBusy = false;
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
    if (state != AppLifecycleState.resumed) return;
    if (_awaitingAutopay) {
      _awaitingAutopay = false;
      _toast(context.l10n.checkingYourAutopay);
      widget.api
          .refreshAutopay()
          .then<void>((_) {}, onError: (_) {})
          .whenComplete(() => _reload?.call());
      return;
    }
    if (!_awaitingReturn) return;
    _awaitingReturn = false;
    _reload?.call();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(context.l10n.checkingForYourPaymentPaidDues),
          duration: Duration(seconds: 5),
        ),
      );
    }
  }

  /// The ledger, and this family's auto-pay beside it. Auto-pay is an extra:
  /// if it cannot be read (an older server, a network blip) the dues still
  /// show and can still be paid.
  Future<_FeesData> _load() async {
    final ledgerF = widget.api.fetchFeeLedger(widget.child.id);
    final autopayF = widget.api.fetchAutopay().then<AutopayInfo?>(
      (a) => a,
      onError: (_) => null,
    );
    return _FeesData(await ledgerF, await autopayF);
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
    final l10n = context.l10n;
    setState(() => _starting = true);
    try {
      final keys = dues.map((d) => d.dueKey).toList();
      // Only when the school passes the charge on is there anything to
      // choose; otherwise this is 1.0.13's flow, an open checkout.
      String? methodGroup;
      final quote = await widget.api.quoteParentPayment(keys);
      if (quote.chargesParents && quote.options.isNotEmpty && mounted) {
        final chosen = await _choosePayOption(quote);
        if (chosen == null) return;
        methodGroup = chosen.group;
      }
      final checkout = await widget.api.startParentCheckout(
        dueKeys: keys,
        studentId: widget.child.id,
        methodGroup: methodGroup,
      );
      final uri = checkout.payUri;
      if (uri == null) {
        throw ApiException(l10n.modFeesCouldNotStartPayment, 400);
      }
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened) {
        throw ApiException(l10n.modFeesNoBrowserForPaymentPage, 0);
      }
      _awaitingReturn = true;
      Haptics.success();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast(l10n.modFeesCouldNotStartPaymentConnection);
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  /// Every way of paying with what it would cost, cheapest first. Null when
  /// the parent backs out.
  Future<PayOption?> _choosePayOption(PayQuote quote) {
    return showModalBottomSheet<PayOption>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          children: [
            Text(sheet.l10n.howWillYouPay, style: AppText.titleSmall),
            const SizedBox(height: 4),
            Text(
              sheet.l10n.schoolFeesAmount(formatInrPaise(quote.netPaise)),
              style: AppText.bodyMediumInk,
            ),
            const SizedBox(height: 4),
            Text(sheet.l10n.paymentChargeHint, style: AppText.bodySmallMuted),
            const SizedBox(height: 12),
            for (final o in quote.options)
              Card(
                child: ListTile(
                  onTap: () => Navigator.of(sheet).pop(o),
                  title: Text(
                    o.label,
                    style: AppText.bodyMediumInk.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    o.surchargePaise > 0
                        ? sheet.l10n.includesPaymentCharge(
                            formatInrPaise(o.surchargePaise),
                          )
                        : sheet.l10n.noExtraCharge,
                    style: o.surchargePaise > 0
                        ? AppText.labelMediumMuted
                        : AppText.labelMediumMuted.copyWith(
                            color: AppColors.success,
                          ),
                  ),
                  trailing: Text(
                    formatInrPaise(o.chargeablePaise),
                    style: AppText.bodyMediumInk.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _openInBrowser(String url) async {
    final l10n = context.l10n;
    final uri = Uri.tryParse(url);
    if (uri == null ||
        !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw ApiException(l10n.modFeesNoBrowserForPage, 0);
    }
  }

  Future<void> _startAutopay(Future<void> Function() reload) async {
    if (_autopayBusy) return;
    final l10n = context.l10n;
    setState(() => _autopayBusy = true);
    try {
      final info = await widget.api.startAutopay();
      final url = info.approveUrl.isNotEmpty
          ? info.approveUrl
          : info.mandate?.approveUrl ?? "";
      if (info.mandate?.active == true || url.isEmpty) {
        await reload();
        return;
      }
      await _openInBrowser(url);
      _awaitingAutopay = true;
      Haptics.success();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast(l10n.modFeesCouldNotStartAutopay);
    } finally {
      if (mounted) setState(() => _autopayBusy = false);
    }
  }

  Future<void> _approveAutopay(String url) async {
    try {
      await _openInBrowser(url);
      _awaitingAutopay = true;
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _stopAutopay(Future<void> Function() reload) async {
    final l10n = context.l10n;
    final yes = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        content: Text(d.l10n.stopAutopayConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(d).pop(false),
            child: Text(d.l10n.keep),
          ),
          TextButton(
            onPressed: () => Navigator.of(d).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: Text(d.l10n.stopAutopay),
          ),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    setState(() => _autopayBusy = true);
    try {
      await widget.api.stopAutopay();
      if (mounted) _toast(context.l10n.autopayStopped);
      await reload();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast(l10n.modFeesCouldNotStopAutopay);
    } finally {
      if (mounted) setState(() => _autopayBusy = false);
    }
  }

  Widget _autopayCard(AutopayInfo info, Future<void> Function() reload) {
    final m = info.mandate;
    final busy = _autopayBusy
        ? const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : null;
    final lines = <Widget>[];
    final actions = <Widget>[];
    if (m == null) {
      lines.add(
        Text(
          context.l10n.autopayPitch(
            "${info.chargeDay}",
            formatInrPaise(info.defaultMaxPaise),
          ),
          style: AppText.bodySmallMuted,
        ),
      );
      actions.add(
        FilledButton(
          onPressed: _autopayBusy ? null : () => _startAutopay(reload),
          child: busy ?? Text(context.l10n.setUpAutopay),
        ),
      );
    } else {
      lines.add(
        Text(
          m.active
              ? context.l10n.autopayOnUpTo(formatInrPaise(m.maxPaise))
              : m.statusLabel,
          style: AppText.bodyMediumInk.copyWith(
            fontWeight: FontWeight.w600,
            color: m.active ? AppColors.success : null,
          ),
        ),
      );
      if (info.lastDebitPaise > 0 && info.lastDebitDate.isNotEmpty) {
        lines.add(
          Text(
            context.l10n.autopayLastDebit(
              formatInrPaise(info.lastDebitPaise),
              formatDateLabel(info.lastDebitDate),
            ),
            style: AppText.bodySmallMuted,
          ),
        );
      }
      if (m.needsApproval && m.approveUrl.isNotEmpty) {
        actions.add(
          FilledButton(
            onPressed: _autopayBusy
                ? null
                : () => _approveAutopay(m.approveUrl),
            child: Text(context.l10n.approveAutopay),
          ),
        );
      }
      actions.add(
        TextButton(
          onPressed: _autopayBusy ? null : () => _stopAutopay(reload),
          style: TextButton.styleFrom(foregroundColor: AppColors.danger),
          child: busy ?? Text(context.l10n.stopAutopay),
        ),
      );
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.autorenew, color: AppColors.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    context.l10n.payFeesAutomatically,
                    style: AppText.bodyMedium.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ...lines,
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 4, children: actions),
          ],
        ),
      ),
    );
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
          style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
        ),
        subtitle: due.dueOn.isEmpty
            ? null
            : Text(
                ahead
                    ? context.l10n.modFeesFallsDueOn(formatDateLabel(due.dueOn))
                    : context.l10n.modFeesDueOn(formatDateLabel(due.dueOn)),
                style: AppText.labelMediumMuted,
              ),
        secondary: Text(
          due.balanceLabel,
          style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w700),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<_FeesData>(
      title: context.l10n.modFeesTitle,
      subtitle: widget.child.fullName,
      load: _load,
      emptyIcon: Icons.task_alt,
      emptyText: context.l10n.noPendingFeesAllDuesAre,
      // A family with nothing due still sees the screen when auto-pay is on
      // offer or already set up — that is where they would stop it.
      isEmpty: (data) =>
          data.ledger.isEmpty && !(data.autopay?.visible ?? false),
      bottomBar: (context, data, reload) {
        _reload = reload;
        final ledger = data.ledger;
        if (ledger.isEmpty) return const SizedBox.shrink();
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
                    ? context.l10n.modFeesSelectAFeeToPay
                    : context.l10n.modFeesPayAmountOnline(
                        formatInrPaise(total),
                      ),
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ),
        );
      },
      builder: (context, data, reload) {
        _reload = reload;
        final ledger = data.ledger;
        final autopay = data.autopay;
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            if (ledger.isEmpty && autopay != null && autopay.visible) ...[
              _autopayCard(autopay, reload),
            ] else ...[
              Card(
                color: AppColors.primary,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          context.l10n.totalDue,
                          style: AppText.bodyMedium.copyWith(
                            color: Color(0xFFB8C0D4),
                          ),
                        ),
                      ),
                      Text(
                        ledger.openBalanceLabel,
                        style: AppText.headlineSmall.copyWith(
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Padding(
                padding: EdgeInsets.fromLTRB(4, 4, 4, 6),
                child: Text(
                  context.l10n.tickTheFeesYouWantTo,
                  style: AppText.bodySmallMuted,
                ),
              ),
              for (final due in ledger.openDues) _dueTile(due, ahead: false),
              if (ledger.futureDues.isNotEmpty) ...[
                const SizedBox(height: 12),
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 4, 4, 6),
                  child: Text(
                    context.l10n.modFeesPayAhead(ledger.futureBalanceLabel),
                    style: AppText.bodyMediumInk.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(4, 0, 4, 6),
                  child: Text(
                    context.l10n.notDueYetTickAnyYou,
                    style: AppText.bodySmallMuted,
                  ),
                ),
                for (final due in ledger.futureDues) _dueTile(due, ahead: true),
              ],
              if (autopay != null && autopay.visible) ...[
                const SizedBox(height: 12),
                _autopayCard(autopay, reload),
              ],
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
                title: Text(
                  context.l10n.previousReceipts,
                  style: AppText.bodyMedium.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: Text(
                  context.l10n.everyPaymentSoFarAsA,
                  style: AppText.labelMediumMuted,
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

class _FeesData {
  const _FeesData(this.ledger, this.autopay);

  final FeeLedger ledger;
  final AutopayInfo? autopay;
}
