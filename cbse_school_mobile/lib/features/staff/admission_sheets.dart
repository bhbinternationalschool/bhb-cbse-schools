import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../../l10n/app_localizations.dart";
import "../modules/dictate_field.dart";
import "../modules/module_shell.dart";
import "admission_forms.dart";

/// The admissions bottom sheets shared by Admission leads and Follow-ups:
/// add a walk-in lead, register (with the registration fee), the message
/// composer, logging a call, and the hand-off to SIS.

Future<T?> _sheet<T>(BuildContext context, Widget child) =>
    showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => child,
    );

void _toast(BuildContext context, String text) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}

String _issueText(L l, AdmFormIssue issue, {String refLabel = ""}) =>
    switch (issue) {
      AdmFormIssue.childName => l.admFieldRequired(l.admChildName),
      AdmFormIssue.className => l.admFieldRequired(l.admClassSought),
      AdmFormIssue.parentName => l.admFieldRequired(l.admParentName),
      AdmFormIssue.mobile => l.admMobileTenDigits,
      AdmFormIssue.feeHead => l.admFieldRequired(l.admFeeHead),
      AdmFormIssue.feeAmount => l.admWholeRupees,
      AdmFormIssue.collectAmount => l.admWholeRupees,
      AdmFormIssue.collectMoreThanFee => l.admAmountMoreThanFee,
      AdmFormIssue.collectMode => l.admFieldRequired(l.admPaidBy),
      AdmFormIssue.collectRef => l.admRefRequired(refLabel),
    };

class _SheetFrame extends StatelessWidget {
  const _SheetFrame({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      20,
      16,
      20,
      MediaQuery.viewInsetsOf(context).bottom + 20,
    ),
    child: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    ),
  );
}

/* ─── Options (classes, fee heads, ways of paying) ─────────────────── */

class _WithOptions extends StatefulWidget {
  const _WithOptions({required this.api, required this.builder});
  final ApiClient api;
  final Widget Function(BuildContext, AdmissionFormOptions) builder;

  @override
  State<_WithOptions> createState() => _WithOptionsState();
}

class _WithOptionsState extends State<_WithOptions> {
  late final Future<AdmissionFormOptions> _future = widget.api
      .fetchAdmissionFormOptions();

  @override
  Widget build(BuildContext context) => FutureBuilder<AdmissionFormOptions>(
    future: _future,
    builder: (context, snap) {
      if (snap.hasError) {
        final e = snap.error;
        return _SheetFrame(
          children: [
            Text(
              context.l10n.admOptionsNotLoaded(
                e is ApiException ? e.message : "$e",
              ),
              style: AppText.bodySmall.copyWith(color: AppColors.danger),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.l10n.close),
            ),
          ],
        );
      }
      if (!snap.hasData) {
        return const Padding(
          padding: EdgeInsets.all(40),
          child: Center(child: CircularProgressIndicator()),
        );
      }
      return widget.builder(context, snap.data!);
    },
  );
}

/* ─── Add walk-in lead ─────────────────────────────────────────────── */

/// True when a lead was saved.
Future<bool> showWalkInLeadSheet(BuildContext context, ApiClient api) async =>
    await _sheet<bool>(
      context,
      _WithOptions(
        api: api,
        builder: (_, o) => _WalkInSheet(api: api, options: o),
      ),
    ) ==
    true;

class _WalkInSheet extends StatefulWidget {
  const _WalkInSheet({required this.api, required this.options});
  final ApiClient api;
  final AdmissionFormOptions options;

  @override
  State<_WalkInSheet> createState() => _WalkInSheetState();
}

class _WalkInSheetState extends State<_WalkInSheet> {
  final _child = TextEditingController();
  final _parent = TextEditingController();
  final _mobile = TextEditingController();
  final _note = TextEditingController();
  String _classId = "";
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _child.dispose();
    _parent.dispose();
    _mobile.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l = context.l10n;
    final issue = walkInIssue(
      childName: _child.text,
      classId: _classId,
      parentName: _parent.text,
      mobile: _mobile.text,
    );
    if (issue != null) {
      setState(() => _error = _issueText(l, issue));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await widget.api.createWalkInLead(
        childName: _child.text.trim(),
        classSoughtId: _classId,
        guardianName: _parent.text.trim(),
        mobile: mobile10(_mobile.text),
        note: _note.text.trim(),
      );
      Haptics.success();
      if (!mounted) return;
      _toast(
        context,
        r.linkedExisting
            ? l.admWalkInSavedLinked(r.enquiryNo)
            : l.admWalkInSaved(r.enquiryNo),
      );
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      Haptics.warning();
      if (mounted) {
        setState(() => _error = l.homeCouldNotReachServerCheckConnection);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return _SheetFrame(
      children: [
        Text(l.admWalkInTitle, style: AppText.titleMediumInk),
        Text(l.admSourceWalkIn, style: AppText.bodySmallMuted),
        const SizedBox(height: 12),
        TextField(
          controller: _child,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(labelText: l.admChildName),
        ),
        const SizedBox(height: 8),
        _ClassPicker(
          classes: widget.options.classes,
          value: _classId,
          onChanged: (v) => setState(() => _classId = v),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _parent,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(labelText: l.admParentName),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _mobile,
          keyboardType: TextInputType.phone,
          decoration: InputDecoration(labelText: l.admParentMobile),
        ),
        const SizedBox(height: 8),
        DictateField(
          label: l.admNotes,
          controller: _note,
          maxLines: 2,
          textCapitalization: TextCapitalization.sentences,
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(
            _error!,
            style: AppText.bodySmall.copyWith(color: AppColors.danger),
          ),
        ],
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _busy ? null : () => Navigator.pop(context, false),
                child: Text(l.cancel),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: FilledButton(
                onPressed: _busy ? null : _save,
                child: Text(_busy ? l.admSaving : l.admSaveLead),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _ClassPicker extends StatelessWidget {
  const _ClassPicker({
    required this.classes,
    required this.value,
    required this.onChanged,
  });
  final List<({String id, String name})> classes;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String>(
    initialValue: value.isEmpty ? null : value,
    isExpanded: true,
    decoration: InputDecoration(labelText: context.l10n.admClassSought),
    items: [
      for (final c in classes)
        DropdownMenuItem(value: c.id, child: Text(c.name)),
    ],
    onChanged: (v) => onChanged(v ?? ""),
  );
}

/* ─── Registration (new child, or an existing lead) ───────────────── */

/// True when the registration was saved. [leadId] registers that lead;
/// empty is a new child entered here.
Future<bool> showRegistrationSheet(
  BuildContext context,
  ApiClient api, {
  String leadId = "",
  String childName = "",
}) async =>
    await _sheet<bool>(
      context,
      _WithOptions(
        api: api,
        builder: (_, o) => _RegistrationSheet(
          api: api,
          options: o,
          leadId: leadId,
          childName: childName,
        ),
      ),
    ) ==
    true;

class _RegistrationSheet extends StatefulWidget {
  const _RegistrationSheet({
    required this.api,
    required this.options,
    required this.leadId,
    required this.childName,
  });
  final ApiClient api;
  final AdmissionFormOptions options;
  final String leadId;
  final String childName;

  @override
  State<_RegistrationSheet> createState() => _RegistrationSheetState();
}

class _RegistrationSheetState extends State<_RegistrationSheet> {
  final _child = TextEditingController();
  final _parent = TextEditingController();
  final _mother = TextEditingController();
  final _mobile = TextEditingController();
  final _fee = TextEditingController();
  final _collect = TextEditingController();
  final _ref = TextEditingController();
  String _classId = "";
  late String _feeHeadId = widget.options.feeHeads.length == 1
      ? widget.options.feeHeads.first.id
      : "";
  bool _collectNow = false;
  String _mode = "cash";
  String? _error;
  bool _busy = false;

  bool get _newChild => widget.leadId.isEmpty;

  ({String id, String label, bool needsRef, String refLabel})? get _modeMeta {
    for (final m in widget.options.tenderModes) {
      if (m.id == _mode) return m;
    }
    return null;
  }

  @override
  void dispose() {
    for (final c in [_child, _parent, _mother, _mobile, _fee, _collect, _ref]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final l = context.l10n;
    final meta = _modeMeta;
    final issue = registrationIssue(
      newChild: _newChild,
      childName: _child.text,
      classId: _classId,
      parentName: _parent.text,
      mobile: _mobile.text,
      feeHeadId: _feeHeadId,
      feeRaw: _fee.text,
      collect: _collectNow,
      collectRaw: _collect.text,
      modeId: meta?.id ?? "",
      modeNeedsRef: meta?.needsRef ?? true,
      ref: _ref.text,
    );
    if (issue != null) {
      setState(
        () => _error = _issueText(l, issue, refLabel: meta?.refLabel ?? ""),
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await widget.api.registerAdmission(
        leadId: widget.leadId,
        childName: _child.text.trim(),
        classSoughtId: _classId,
        guardianName: _parent.text.trim(),
        motherName: _mother.text.trim(),
        mobile: mobile10(_mobile.text),
        feeHeadId: _feeHeadId,
        feeAmountRupees: wholeRupees(_fee.text)!,
        collectRupees: _collectNow ? wholeRupees(_collect.text)! : 0,
        collectMode: _collectNow ? _mode : "",
        collectRef: _collectNow ? _ref.text.trim() : "",
      );
      Haptics.success();
      if (!mounted) return;
      String rupees(double v) => v.toStringAsFixed(0);
      final no = r.applicationNo.isEmpty ? r.enquiryNo : r.applicationNo;
      _toast(
        context,
        r.paymentCode.isEmpty
            ? l.admRegisteredDue(no, rupees(r.feeRupees))
            : l.admRegisteredPaid(
                no,
                rupees(r.paidRupees),
                r.paymentCode,
                rupees(r.balanceRupees),
              ),
      );
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      Haptics.warning();
      if (mounted) {
        setState(() => _error = l.homeCouldNotReachServerCheckConnection);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final o = widget.options;
    final meta = _modeMeta;
    return _SheetFrame(
      children: [
        Text(
          _newChild
              ? l.admNewRegistration
              : l.admRegisterChild(widget.childName),
          style: AppText.titleMediumInk,
        ),
        const SizedBox(height: 12),
        if (_newChild) ...[
          TextField(
            controller: _child,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(labelText: l.admChildName),
          ),
          const SizedBox(height: 8),
          _ClassPicker(
            classes: o.classes,
            value: _classId,
            onChanged: (v) => setState(() => _classId = v),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _parent,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(labelText: l.admParentName),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _mobile,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(labelText: l.admParentMobile),
          ),
          const SizedBox(height: 8),
        ],
        TextField(
          controller: _mother,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(labelText: l.admMotherNameOptional),
        ),
        const SizedBox(height: 8),
        if (o.feeHeads.isEmpty)
          Text(
            l.admNoFeeHeads,
            style: AppText.bodySmall.copyWith(color: AppColors.danger),
          )
        else
          DropdownButtonFormField<String>(
            initialValue: _feeHeadId.isEmpty ? null : _feeHeadId,
            isExpanded: true,
            decoration: InputDecoration(labelText: l.admFeeHead),
            items: [
              for (final h in o.feeHeads)
                DropdownMenuItem(value: h.id, child: Text(h.name)),
            ],
            onChanged: (v) => setState(() => _feeHeadId = v ?? ""),
          ),
        const SizedBox(height: 8),
        TextField(
          controller: _fee,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: l.admRegistrationFee),
        ),
        const SizedBox(height: 4),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _collectNow,
          onChanged: (v) => setState(() => _collectNow = v),
          title: Text(l.admMoneyReceivedNow, style: AppText.bodyMedium),
          subtitle: Text(
            l.admMoneyReceivedNowNote,
            style: AppText.labelMediumMuted,
          ),
        ),
        if (_collectNow) ...[
          TextField(
            controller: _collect,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: l.admAmountReceived),
          ),
          const SizedBox(height: 8),
          Text(l.admPaidBy, style: AppText.labelMediumMuted),
          Wrap(
            spacing: 6,
            children: [
              for (final m in o.tenderModes)
                ChoiceChip(
                  label: Text(m.label, style: AppText.bodySmall),
                  selected: _mode == m.id,
                  onSelected: (_) => setState(() => _mode = m.id),
                ),
            ],
          ),
          if (meta?.needsRef ?? false) ...[
            const SizedBox(height: 8),
            TextField(
              controller: _ref,
              decoration: InputDecoration(labelText: meta!.refLabel),
            ),
          ],
        ],
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(
            _error!,
            style: AppText.bodySmall.copyWith(color: AppColors.danger),
          ),
        ],
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _busy ? null : () => Navigator.pop(context, false),
                child: Text(l.cancel),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: FilledButton(
                onPressed: _busy || o.feeHeads.isEmpty ? null : _save,
                child: Text(_busy ? l.admSaving : l.admRegister),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/* ─── Message composer ─────────────────────────────────────────────── */

/// The message icon. Opens a preview; nothing is sent until Send.
Future<void> showLeadComposer(
  BuildContext context,
  ApiClient api, {
  required String leadId,
  required String guardianName,
}) => _sheet<void>(
  context,
  _ComposerSheet(api: api, leadId: leadId, guardianName: guardianName),
);

class _ComposerSheet extends StatefulWidget {
  const _ComposerSheet({
    required this.api,
    required this.leadId,
    required this.guardianName,
  });
  final ApiClient api;
  final String leadId;
  final String guardianName;

  @override
  State<_ComposerSheet> createState() => _ComposerSheetState();
}

class _ComposerSheetState extends State<_ComposerSheet> {
  final _text = TextEditingController();
  LeadComposer? _c;
  String? _loadError;
  String? _sendError;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final c = await widget.api.fetchLeadComposer(widget.leadId);
      if (!mounted) return;
      _text.text = c.draft;
      setState(() => _c = c);
    } on ApiException catch (e) {
      if (mounted) setState(() => _loadError = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () =>
              _loadError = context.l10n.homeCouldNotReachServerCheckConnection,
        );
      }
    }
  }

  Future<void> _send({required bool template}) async {
    final c = _c!;
    final l = context.l10n;
    final text = _text.text.trim();
    if (!template && text.isEmpty) {
      setState(() => _sendError = l.admComposerEmpty);
      return;
    }
    setState(() {
      _busy = true;
      _sendError = null;
    });
    try {
      final r = await widget.api.sendSchoolWhatsApp(
        mobile: c.mobile,
        familyKey: c.familyKey,
        text: template ? "" : text,
        variables: template ? c.variables : const {},
        textOnly: !template,
      );
      Haptics.success();
      if (!mounted) return;
      _toast(
        context,
        r.deferred
            ? (r.reason.isEmpty ? l.admComposerQueued : r.reason)
            : l.admComposerSent,
      );
      Navigator.pop(context);
    } catch (e) {
      Haptics.warning();
      if (mounted) {
        setState(
          () => _sendError = l.admComposerNotSent(
            e is ApiException
                ? e.message
                : e.toString().replaceFirst("Exception: ", ""),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final c = _c;
    final cancel = OutlinedButton(
      onPressed: _busy ? null : () => Navigator.pop(context),
      child: Text(l.cancel),
    );
    if (c == null) {
      return _SheetFrame(
        children: [
          Text(
            l.admComposerTitle(widget.guardianName),
            style: AppText.titleMediumInk,
          ),
          const SizedBox(height: 12),
          if (_loadError == null)
            Row(
              children: [
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: 10),
                Text(l.admComposerLoading, style: AppText.bodySmallMuted),
              ],
            )
          else
            Text(
              _loadError!,
              style: AppText.bodySmall.copyWith(color: AppColors.danger),
            ),
          const SizedBox(height: 14),
          cancel,
        ],
      );
    }

    final mode = composerMode(inWindow: c.inWindow, templateOk: c.templateOk);
    return _SheetFrame(
      children: [
        Text(
          l.admComposerTitle(widget.guardianName),
          style: AppText.titleMediumInk,
        ),
        const SizedBox(height: 8),
        if (mode == ComposerMode.ownWords) ...[
          Text(l.admComposerInWindow, style: AppText.bodySmallMuted),
          const SizedBox(height: 8),
          TextField(
            controller: _text,
            minLines: 3,
            maxLines: 8,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l.admComposerYourWords),
          ),
        ] else
          Text(l.admComposerOutOfWindow, style: AppText.bodySmallMuted),
        if (c.templateOk) ...[
          const SizedBox(height: 12),
          Text(l.admComposerApproved, style: AppText.labelMediumMuted),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5EE),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(c.templateBody, style: AppText.bodySmallInk),
          ),
          const SizedBox(height: 4),
          Text(l.admComposerApprovedNote, style: AppText.labelMediumMuted),
        ] else ...[
          const SizedBox(height: 8),
          Text(
            l.admComposerTemplateUnavailable(c.templateReason),
            style: AppText.bodySmall.copyWith(
              color: mode == ComposerMode.nothing
                  ? AppColors.danger
                  : AppColors.muted,
            ),
          ),
        ],
        if (_sendError != null) ...[
          const SizedBox(height: 8),
          Text(
            _sendError!,
            style: AppText.bodySmall.copyWith(color: AppColors.danger),
          ),
        ],
        const SizedBox(height: 14),
        if (mode == ComposerMode.ownWords)
          FilledButton.icon(
            onPressed: _busy ? null : () => _send(template: false),
            icon: const Icon(Icons.send_outlined, size: 18),
            label: Text(l.admComposerSendMine),
          ),
        if (c.templateOk) ...[
          const SizedBox(height: 6),
          (mode == ComposerMode.templateOnly
              ? FilledButton.icon(
                  onPressed: _busy ? null : () => _send(template: true),
                  icon: const Icon(Icons.verified_outlined, size: 18),
                  label: Text(l.admComposerSendApproved),
                )
              : OutlinedButton.icon(
                  onPressed: _busy ? null : () => _send(template: true),
                  icon: const Icon(Icons.verified_outlined, size: 18),
                  label: Text(l.admComposerSendApproved),
                )),
        ],
        const SizedBox(height: 6),
        cancel,
      ],
    );
  }
}

/* ─── Log a call (follow up) ───────────────────────────────────────── */

/// True when the call was saved.
Future<bool> showLeadFollowupSheet(
  BuildContext context,
  ApiClient api, {
  required String leadId,
  required String guardianName,
  required String childName,
}) async =>
    await _sheet<bool>(
      context,
      LeadFollowupSheet(
        api: api,
        leadId: leadId,
        guardianName: guardianName,
        childName: childName,
      ),
    ) ==
    true;

class LeadFollowupSheet extends StatefulWidget {
  const LeadFollowupSheet({
    super.key,
    required this.api,
    required this.leadId,
    required this.guardianName,
    required this.childName,
  });

  final ApiClient api;
  final String leadId;
  final String guardianName;
  final String childName;

  @override
  State<LeadFollowupSheet> createState() => _LeadFollowupSheetState();
}

class _LeadFollowupSheetState extends State<LeadFollowupSheet> {
  String _channel = "call";
  String _outcome = "connected";
  DateTime _next = DateTime.now().add(const Duration(days: 3));
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  String _iso(DateTime d) => d.toIso8601String().substring(0, 10);

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await widget.api.logLeadFollowup(
        leadId: widget.leadId,
        channel: _channel,
        outcome: _outcome,
        note: _note.text.trim(),
        nextFollowUpAt: _iso(_next),
      );
      Haptics.success();
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) _toast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _SheetFrame(
      children: [
        Text("Call with ${widget.guardianName}", style: AppText.titleMediumInk),
        Text("about ${widget.childName}", style: AppText.bodySmallMuted),
        const SizedBox(height: 10),
        Wrap(
          spacing: 6,
          children: [
            for (final (v, l) in const [
              ("call", "Called"),
              ("whatsapp", "WhatsApp"),
              ("visit", "Visited"),
            ])
              ChoiceChip(
                label: Text(l, style: AppText.bodySmall),
                selected: _channel == v,
                onSelected: (_) => setState(() => _channel = v),
              ),
          ],
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 4,
          children: [
            for (final (v, l) in const [
              ("connected", "Spoke"),
              ("no_answer", "No answer"),
              ("busy", "Busy"),
              ("visit_scheduled", "Visit fixed"),
              ("not_interested", "Not interested"),
              ("wrong_number", "Wrong number"),
              ("admitted", "Admitted"),
            ])
              ChoiceChip(
                label: Text(l, style: AppText.bodySmall),
                selected: _outcome == v,
                onSelected: (_) => setState(() => _outcome = v),
              ),
          ],
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: _next,
              firstDate: DateTime.now(),
              lastDate: DateTime.now().add(const Duration(days: 365)),
            );
            if (d != null) setState(() => _next = d);
          },
          icon: const Icon(Icons.event_outlined, size: 16),
          label: Text("Call again on ${formatDateLabel(_iso(_next))}"),
        ),
        const SizedBox(height: 8),
        DictateField(
          label: context.l10n.whatWasSaid,
          controller: _note,
          maxLines: 2,
          textCapitalization: TextCapitalization.sentences,
        ),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(_busy ? "Saving…" : "Save"),
        ),
      ],
    );
  }
}

/* ─── Send to SIS ──────────────────────────────────────────────────── */

/// Admitting into SIS allocates the admission number and SRN, picks the
/// section and fee group, and posts the registration money to the child's
/// Fee Take ledger as an R-series receipt. All of that is the web ERP's
/// enrolLead and runs on the office's browser; a second copy of it on the
/// phone would be a second way of creating students. So the phone hands the
/// lead over to that screen instead of doing it half.
Future<void> confirmSendToSis(
  BuildContext context,
  ApiClient api, {
  required String leadId,
}) async {
  final l = context.l10n;
  final go = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(l.admSendToSis),
      content: Text(l.admSendToSisNote),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: Text(l.cancel),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(l.admOpenInErp),
        ),
      ],
    ),
  );
  if (go != true || !context.mounted) return;
  final url = Uri.parse(
    api.erpUrl("/admissions?openLead=${Uri.encodeQueryComponent(leadId)}"),
  );
  final ok = await launchUrl(url, mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) _toast(context, l.admCouldNotOpenErp);
}

/// One line for a registered lead's fee. A zero fee is "not set" — never
/// read as paid.
String registrationFeeLine(L l, AdmissionLeadRow r) {
  if (r.registrationPaymentStatus == "waived") return l.admFeeWaived;
  if (r.registrationFeeRupees <= 0) return l.admFeeNotSet;
  return l.admFeeStatus(
    "${r.registrationFeeRupees}",
    "${r.registrationCollectedRupees}",
    "${r.registrationBalanceRupees}",
  );
}
