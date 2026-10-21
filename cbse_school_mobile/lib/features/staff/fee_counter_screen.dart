import "dart:math";

import "../../core/guide/screen_guides.dart";
import "package:flutter/material.dart";
import "package:flutter/services.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "payslips_screen.dart" show rupees;
import "fee_counter_logic.dart";
import "../../core/i18n/locale_controller.dart";

/// Fee counter on a phone: find the child, tick what is being paid, take the
/// money, hand over a receipt number.
///
/// The amounts and the receipt number are the server's — this screen only
/// says which dues and how much of each. A collection is posted with one
/// `clientRef` for the whole attempt, so tapping "Collect" twice on a bad
/// signal returns the same receipt instead of charging the family again.
class FeeCounterScreen extends StatefulWidget {
  const FeeCounterScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<FeeCounterScreen> createState() => _FeeCounterScreenState();
}

class _FeeCounterScreenState extends State<FeeCounterScreen> {
  final _q = TextEditingController();
  List<FeeStudentHit>? _hits;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final q = _q.text.trim();
    if (q.length < 2) {
      setState(
        () => _error = "Type at least two letters, or the admission number",
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final hits = await widget.api.searchFeeStudents(q);
      if (mounted) setState(() => _hits = hits);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hits = _hits;
    return Scaffold(
      appBar: AppBar(
        actions: [
          ScreenGuideButton(guideId: "fee-counter", screenLabel: "fee-counter"),
        ],
        title: Text(context.l10n.collectFees, style: AppText.titleMedium),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _q,
                    autofocus: true,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _search(),
                    decoration: InputDecoration(
                      hintText: context.l10n.nameAdmissionNoOrMobile,
                      prefixIcon: Icon(Icons.search),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _busy ? null : _search,
                  child: Text(_busy ? "…" : "Find"),
                ),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                _error!,
                style: AppText.bodySmall.copyWith(color: AppColors.danger),
              ),
            ),
          Expanded(
            child: hits == null
                ? const _Hint()
                : hits.isEmpty
                ? Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        context.l10n.nobodyMatchedTryTheAdmissionNumber,
                        textAlign: TextAlign.center,
                        style: AppText.bodyMediumMuted,
                      ),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: hits.length,
                    itemBuilder: (context, i) {
                      final s = hits[i];
                      final owes = s.openPaise > 0;
                      return Card(
                        child: ListTile(
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  CounterScreen(api: widget.api, student: s),
                            ),
                          ),
                          title: Text(
                            s.fullName,
                            style: AppText.bodyMediumInk.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(
                            "${s.classLabel}${s.admissionNo.isEmpty ? "" : " · ${s.admissionNo}"} · ${s.guardianName}",
                            style: AppText.bodySmallMuted,
                          ),
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                owes ? s.openLabel : "Clear",
                                style: AppText.bodyMedium.copyWith(
                                  color: owes
                                      ? AppColors.danger
                                      : AppColors.success,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              if (owes)
                                Text(
                                  "${s.dueCount} due${s.dueCount == 1 ? "" : "s"}",
                                  style: AppText.labelMediumMuted,
                                ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint();

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.point_of_sale_outlined, size: 42, color: AppColors.muted),
          SizedBox(height: 12),
          Text(
            "Find the child first.\nThe receipt is issued by the school's own book, so it continues the same numbering as the counter.",
            textAlign: TextAlign.center,
            style: AppText.bodyMediumMuted.copyWith(height: 1.5),
          ),
        ],
      ),
    ),
  );
}

/// Dues for one family, with the amount being paid against each.
class CounterScreen extends StatefulWidget {
  const CounterScreen({super.key, required this.api, required this.student});

  final ApiClient api;
  final FeeStudentHit student;

  @override
  State<CounterScreen> createState() => _CounterScreenState();
}

class _CounterScreenState extends State<CounterScreen> {
  FeeCounter? _counter;
  String? _error;
  bool _busy = false;

  /// "studentId|dueKey" → paise being paid now.
  final Map<String, int> _picked = {};
  String _mode = "cash";
  final _ref = TextEditingController();
  final _bank = TextEditingController();
  final _note = TextEditingController();

  /// "Total paying now", whole rupees. Empty = the per-due amounts are used.
  final _payingNow = TextEditingController();

  /// The day the money was handed over. Empty = today.
  ///
  /// The screen used to have no date at all and the server hard-coded today,
  /// so cash taken on Saturday could not be recorded as Saturday. The picker
  /// only appears when the SERVER says this person may back-date — offering
  /// one it would then refuse is worse than not offering it.
  String _collectionDate = "";

  /// Minted once per counter session so a retry cannot double-charge.
  late String _clientRef = _mintRef();

  static String _mintRef() {
    final r = Random();
    return "app-${DateTime.now().millisecondsSinceEpoch}-${r.nextInt(1 << 32).toRadixString(36)}";
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _ref.dispose();
    _bank.dispose();
    _note.dispose();
    _payingNow.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final c = await widget.api.fetchFeeCounter(widget.student.id);
      if (mounted) {
        setState(() {
          _counter = c;
          _picked.clear();
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    }
  }

  int get _total => _picked.values.fold(0, (a, b) => a + b);

  /// The dues a "total paying now" is spread over: the ticked ones, or the
  /// whole bill when nothing is ticked. Listed in the counter's own order.
  List<AllocDue> _basis(FeeCounter c) {
    final all = [
      for (final ch in c.children)
        for (final d in ch.dues)
          AllocDue(
            key: "${ch.studentId}|${d.dueKey}",
            dueKey: d.dueKey,
            dueOn: d.dueOn,
            balancePaise: d.balancePaise,
            rank: d.allocationRank,
          ),
    ];
    if (_picked.isEmpty) return all;
    return all.where((d) => _picked.containsKey(d.key)).toList();
  }

  /// The split of the typed total, or null when no total is typed.
  PayingNowSplit? _split(FeeCounter c) {
    final p = payingNowPaiseFrom(_payingNow.text);
    if (p == null) return null;
    return splitPayingNow(_basis(c), p);
  }

  /// What "Collect" will take: the typed total when it splits cleanly, the
  /// ticked amounts when no total is typed, otherwise nothing.
  int _takingFor(FeeCounter c) {
    final split = _split(c);
    if (split == null) return _total;
    return split.ok ? split.amounts.values.fold(0, (a, b) => a + b) : 0;
  }

  void _toggle(FeeChild child, CounterDue due, bool on) {
    final key = "${child.studentId}|${due.dueKey}";
    setState(() {
      if (on) {
        _picked[key] = due.balancePaise;
      } else {
        _picked.remove(key);
      }
    });
  }

  Future<void> _editAmount(FeeChild child, CounterDue due) async {
    final key = "${child.studentId}|${due.dueKey}";
    final current = _picked[key] ?? due.balancePaise;
    final ctl = TextEditingController(text: (current / 100).toStringAsFixed(0));
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(due.label, style: AppText.titleSmall),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("Outstanding ${due.balanceLabel}", style: AppText.bodySmall),
            const SizedBox(height: 8),
            TextField(
              controller: ctl,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(
                labelText: context.l10n.payingNow,
                helperText: context.l10n.partPaymentIsAllowedMoreThan,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(context.l10n.setLabel),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final rupeesTyped = int.tryParse(ctl.text.trim()) ?? 0;
    final paise = rupeesTyped * 100;
    if (paise <= 0) {
      setState(() => _picked.remove(key));
      return;
    }
    if (paise > due.balancePaise) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text("More than the ${due.balanceLabel} outstanding"),
          ),
        );
      }
      return;
    }
    setState(() => _picked[key] = paise);
  }

  Future<void> _collect() async {
    final c = _counter;
    if (c == null) return;
    final split = _split(c);
    final taking = _takingFor(c);
    if (taking <= 0) return;
    final mode = c.tenderModes.firstWhere(
      (m) => m.value == _mode,
      orElse: () => c.tenderModes.first,
    );
    // Every payment that is not cash carries a reference — the server
    // refuses it otherwise, so say so before the confirm dialog.
    if (referenceMissing(mode.value, _ref.text)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            context.l10n.feeReferenceMissing(
              (mode.refLabel.isEmpty ? "reference" : mode.refLabel)
                  .toLowerCase(),
            ),
          ),
        ),
      );
      return;
    }
    if (mode.needsBank && _bank.text.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.l10n.feeBankMissing)));
      return;
    }

    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text("Take ${rupees(taking / 100)}?"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("From ${c.guardianName}", style: AppText.bodyMedium),
            Text("By ${mode.label}", style: AppText.bodyMedium),
            const SizedBox(height: 8),
            Text(
              context.l10n.aReceiptIsIssuedAtOnce,
              style: AppText.bodySmallMuted,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.l10n.back),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(context.l10n.takeMoney),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;

    setState(() => _busy = true);
    try {
      final source = split != null ? split.amounts : _picked;
      final lines = source.entries.map((e) {
        final parts = e.key.split("|");
        return (
          studentId: parts[0],
          dueKey: parts.sublist(1).join("|"),
          paise: e.value,
        );
      }).toList();
      final receipt = await widget.api.collectFee(
        studentId: widget.student.id,
        clientRef: _clientRef,
        lines: lines,
        tenders: [
          (
            mode: mode.value,
            paise: taking,
            ref: _ref.text.trim(),
            // The txn date defaults to the day the money was taken, as the
            // web counter pre-fills it.
            instrumentDate: mode.value == "cash"
                ? ""
                : (_collectionDate.isEmpty
                      ? c.collectionDate
                      : _collectionDate),
            bankName: mode.needsBank ? _bank.text.trim() : "",
          ),
        ],
        note: _note.text.trim(),
        collectionDate: _collectionDate,
        payingNowPaise: split != null ? taking : null,
      );
      Haptics.success();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => _ReceiptDialog(receipt: receipt),
      );
      if (!mounted) return;
      // A fresh session for the next family — never reuse an idempotency key.
      setState(() {
        _clientRef = _mintRef();
        _ref.clear();
        _bank.clear();
        _note.clear();
        _payingNow.clear();
        _collectionDate = "";
      });
      await _load();
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.message),
            duration: const Duration(seconds: 6),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _counter;
    final split = c == null ? null : _split(c);
    final taking = c == null ? 0 : _takingFor(c);
    return Scaffold(
      appBar: AppBar(
        actions: [
          ScreenGuideButton(
            guideId: "fee-counter-student",
            screenLabel: "fee-counter-student",
          ),
        ],
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.student.fullName, style: AppText.titleSmall),
            Text(
              c == null
                  ? widget.student.classLabel
                  : "${c.guardianName} · ${c.mobile}",
              style: AppText.labelMediumMuted,
            ),
          ],
        ),
      ),
      body: c == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator(color: AppColors.primary)
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: _load,
                            child: Text(context.l10n.retry),
                          ),
                        ],
                      ),
                    ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 180),
              children: [
                for (final child in c.children) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: 6, bottom: 4),
                    child: Text(
                      "${child.fullName} · ${child.classLabel}${child.isPrimary ? "" : " (sibling)"}",
                      style: AppText.bodyMediumInk.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  if (child.dues.isEmpty)
                    Card(
                      child: Padding(
                        padding: EdgeInsets.all(12),
                        child: Text(
                          context.l10n.nothingOutstanding,
                          style: AppText.bodySmall.copyWith(
                            color: AppColors.success,
                          ),
                        ),
                      ),
                    ),
                  for (final d in child.dues)
                    Card(
                      margin: const EdgeInsets.symmetric(vertical: 3),
                      child: CheckboxListTile(
                        dense: true,
                        value: _picked.containsKey(
                          "${child.studentId}|${d.dueKey}",
                        ),
                        onChanged: (v) => _toggle(child, d, v ?? false),
                        title: Text(d.label, style: AppText.bodyMediumInk),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              "${d.balanceLabel} outstanding${d.dueOn.isEmpty ? "" : " · due ${formatDateLabel(d.dueOn)}"}",
                              style: AppText.labelMediumMuted,
                            ),
                            FeeDueDiscount(due: d),
                          ],
                        ),
                        secondary: split != null
                            // The typed total decides each amount; the
                            // per-due "Part" editor would only fight it.
                            ? Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                ),
                                child: Text(
                                  rupees(
                                    (split.amounts["${child.studentId}|${d.dueKey}"] ??
                                            0) /
                                        100,
                                  ),
                                  style: AppText.bodySmall,
                                ),
                              )
                            : TextButton(
                                onPressed: () => _editAmount(child, d),
                                child: Text(
                                  _picked.containsKey(
                                        "${child.studentId}|${d.dueKey}",
                                      )
                                      ? rupees(
                                          _picked["${child.studentId}|${d.dueKey}"]! /
                                              100,
                                        )
                                      : "Part",
                                  style: AppText.bodySmall,
                                ),
                              ),
                      ),
                    ),
                ],
              ],
            ),
      bottomSheet: c == null
          ? null
          : Container(
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border(
                  top: BorderSide(color: Colors.black.withValues(alpha: 0.08)),
                ),
              ),
              padding: EdgeInsets.fromLTRB(
                16,
                10,
                16,
                MediaQuery.paddingOf(context).bottom + 10,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: TextField(
                      key: const ValueKey("fee-paying-now"),
                      controller: _payingNow,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        isDense: true,
                        labelText: context.l10n.feeTotalPayingNow,
                        helperText: context.l10n.feeTotalPayingNowHelp,
                        helperMaxLines: 2,
                        errorText: split != null && split.error == "over"
                            ? context.l10n.feeTotalPayingNowTooMuch(
                                rupees(split.basisPaise / 100),
                              )
                            : null,
                      ),
                    ),
                  ),
                  SizedBox(
                    height: 38,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        for (final m in c.tenderModes)
                          Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: ChoiceChip(
                              label: Text(m.label, style: AppText.bodySmall),
                              selected: _mode == m.value,
                              onSelected: (_) =>
                                  setState(() => _mode = m.value),
                            ),
                          ),
                      ],
                    ),
                  ),
                  // Not cash → a reference, always (the server refuses
                  // without one); shown for every such mode, not only the
                  // ones an older server flagged.
                  if (_mode != "cash")
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: TextField(
                        key: const ValueKey("fee-reference"),
                        controller: _ref,
                        decoration: InputDecoration(
                          isDense: true,
                          labelText: context.l10n.feeReferenceRequired(
                            c.tenderModes
                                .firstWhere(
                                  (m) => m.value == _mode,
                                  orElse: () => c.tenderModes.first,
                                )
                                .refLabel,
                          ),
                        ),
                      ),
                    ),
                  if (c.tenderModes.any((m) => m.value == _mode && m.needsBank))
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: TextField(
                        controller: _bank,
                        decoration: InputDecoration(
                          isDense: true,
                          labelText: context.l10n.feeBankName,
                        ),
                      ),
                    ),
                  if (c.mayBackdate)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: InkWell(
                        onTap: () async {
                          final first = DateTime.tryParse(
                            c.earliestCollectionDate,
                          );
                          final last = DateTime.tryParse(c.collectionDate);
                          if (first == null || last == null) return;
                          final chosen = await showDatePicker(
                            context: context,
                            initialDate:
                                DateTime.tryParse(
                                  _collectionDate.isEmpty
                                      ? c.collectionDate
                                      : _collectionDate,
                                ) ??
                                last,
                            firstDate: first,
                            lastDate: last,
                          );
                          if (chosen != null) {
                            setState(
                              () => _collectionDate = chosen
                                  .toIso8601String()
                                  .substring(0, 10),
                            );
                          }
                        },
                        child: InputDecorator(
                          decoration: const InputDecoration(
                            isDense: true,
                            labelText: "Date money was taken",
                          ),
                          child: Text(
                            _collectionDate.isEmpty
                                ? "${c.collectionDate} (today)"
                                : _collectionDate,
                            style: AppText.bodyMedium,
                          ),
                        ),
                      ),
                    ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          taking == 0
                              ? "Tick what is being paid"
                              : "Taking ${rupees(taking / 100)}",
                          style: AppText.titleSmall.copyWith(
                            color: taking == 0
                                ? AppColors.muted
                                : AppColors.ink,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      FilledButton.icon(
                        onPressed: _busy || taking <= 0 ? null : _collect,
                        icon: const Icon(Icons.receipt_long_outlined, size: 18),
                        label: Text(_busy ? "Saving…" : "Collect"),
                      ),
                    ],
                  ),
                ],
              ),
            ),
    );
  }
}

class _ReceiptDialog extends StatelessWidget {
  const _ReceiptDialog({required this.receipt});

  final FeeReceipt receipt;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Row(
        children: [
          const Icon(Icons.check_circle, color: AppColors.success),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              receipt.duplicate ? "Already collected" : "Received",
              style: AppText.titleMedium,
            ),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(receipt.receiptNo, style: AppText.titleLargeInk),
          Text(
            "${receipt.totalLabel} from ${receipt.guardianName}",
            style: AppText.bodyMediumInk,
          ),
          const SizedBox(height: 8),
          for (final l in receipt.lines)
            Text(
              "${l.studentName} · ${l.label} — ${l.amountLabel}",
              style: AppText.bodySmallMuted,
            ),
          const SizedBox(height: 10),
          Text(
            context.l10n.theParentHasBeenNotifiedIn,
            style: AppText.bodySmallMuted,
          ),
        ],
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.pop(context),
          child: Text(context.l10n.done),
        ),
      ],
    );
  }
}

/// The discount on one due, as the web counter lists it: the total and one
/// line per concession or counter discount. A discount the server could not
/// read says "not loaded" — never ₹0.
class FeeDueDiscount extends StatelessWidget {
  const FeeDueDiscount({super.key, required this.due});

  final CounterDue due;

  @override
  Widget build(BuildContext context) {
    switch (discountStateOf(due.discountPaise)) {
      case DiscountState.notLoaded:
        return Text(
          context.l10n.feeDiscountNotLoaded,
          style: AppText.labelMediumMuted.copyWith(color: AppColors.warning),
        );
      case DiscountState.none:
        return Text(
          context.l10n.feeDiscountNone,
          style: AppText.labelMediumMuted,
        );
      case DiscountState.some:
        final billed = due.billedPaise > 0
            ? " · billed ${rupees(due.billedPaise / 100)}"
            : "";
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "${context.l10n.feeDiscountLabel("−${rupees(due.discountPaise! / 100)}")}$billed",
              style: AppText.labelMediumMuted.copyWith(
                color: AppColors.success,
              ),
            ),
            for (final l in due.discountLines)
              Text(l, style: AppText.labelMediumMuted),
          ],
        );
    }
  }
}
