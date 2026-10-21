import "package:flutter/material.dart";

import "../../core/guide/screen_guides.dart";
import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/i18n/locale_controller.dart";
import "../../l10n/app_localizations.dart";
import "../modules/dictate_field.dart";

/// Broadcast — the web ERP's WhatsApp send, from the phone (20 Oct 2026,
/// requests mr_mva0gr5aop3y and mr_mva0ik2uqmoy).
///
///  • **Audience**: all parents, chosen classes/sections, staff (all or by
///    stream/role), bus routes, fee defaulters — the web's audiences. The
///    server decides what this person may pick: a teacher gets only their
///    own sections; school-wide audiences need the broadcast permission.
///  • **Message**: an approved WhatsApp template (each family in its own
///    language), or a **custom message** — free text to people inside their
///    24-hour window, the approved "School notice" template for the rest.
///  • **Channel**: WhatsApp + app notification, or the app alone (free).
///
/// Two steps by design: "Preview recipients" is a server dry run that only
/// counts (free text vs template, cost estimate); the send needs a second,
/// explicit confirmation showing that count, and the server refuses it if
/// the audience has moved since.
class BroadcastScreen extends StatefulWidget {
  const BroadcastScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<BroadcastScreen> createState() => _BroadcastScreenState();
}

class _BroadcastScreenState extends State<BroadcastScreen> {
  BroadcastAudienceOptions? _options;
  String? _loadError;

  final _audience = BroadcastAudienceSelection();
  String _channel = "whatsapp"; // "whatsapp" | "app"
  String _mode = "template"; // "template" | "custom"

  BroadcastTemplateFamily? _template;
  final Map<String, TextEditingController> _vars = {};
  final _text = TextEditingController();
  final _title = TextEditingController();

  bool _busy = false;
  AudienceBroadcastResult? _preview;

  /// One per preview: the live send claims it once on the server.
  String? _sendId;
  AudienceBroadcastResult? _sent;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    _title.dispose();
    for (final c in _vars.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loadError = null;
      _options = null;
    });
    try {
      final o = await widget.api.fetchBroadcastAudienceOptions();
      if (!mounted) return;
      setState(() {
        _options = o;
        final offered = BroadcastAudienceSelection.offered(o);
        if (offered.isNotEmpty && !offered.contains(_audience.kind)) {
          _audience.kind = offered.first;
        }
        // No template to pick → start on the custom message.
        if ((o.templates ?? const []).isEmpty) _mode = "custom";
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _loadError = e.message);
    } catch (_) {
      if (mounted) setState(() => _loadError = context.l10n.bcLoadFailed);
    }
  }

  void _changed() {
    setState(() {
      _preview = null;
      _sendId = null;
      _sent = null;
      _error = null;
    });
  }

  void _pickTemplate(BroadcastTemplateFamily? t) {
    _template = t;
    if (t != null) {
      for (final v in t.askFor) {
        _vars.putIfAbsent(v.key, TextEditingController.new);
      }
    }
    _changed();
  }

  Map<String, String> _variableValues() {
    final t = _template;
    if (t == null) return const {};
    return {for (final v in t.askFor) v.key: (_vars[v.key]?.text ?? "").trim()};
  }

  String? _whyNotReady() {
    final l = context.l10n;
    if (_audience.toSpec() == null) return l.bcPickAtLeastOne;
    if (_mode == "custom") {
      if (_text.text.trim().isEmpty) return l.freeTextOnlyReachesRecipientsWho;
      return null;
    }
    final t = _template;
    if (t == null) return l.bcChooseTemplate;
    if (t.askFor.any((v) => (_vars[v.key]?.text ?? "").trim().isEmpty)) {
      return l.theSameValueIsUsedFor;
    }
    return null;
  }

  Future<AudienceBroadcastResult> _call({
    required bool dryRun,
    int? confirmCount,
    String? sendId,
  }) => widget.api.broadcastToAudience(
    audience: _audience.toSpec()!,
    mode: _mode,
    templateFamilyKey: _template?.familyKey ?? "",
    variables: _variableValues(),
    text: _text.text.trim(),
    title: _title.text.trim(),
    channel: _channel,
    dryRun: dryRun,
    confirmCount: confirmCount,
    sendId: sendId,
  );

  Future<void> _dryRun() async {
    final why = _whyNotReady();
    if (why != null) {
      setState(() => _error = why);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _preview = null;
      _sent = null;
    });
    try {
      final r = await _call(dryRun: true);
      if (mounted) {
        setState(() {
          _preview = r;
          _sendId = newBroadcastSendId();
        });
      }
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

  Future<void> _sendLive() async {
    final preview = _preview;
    final sendId = _sendId;
    if (preview == null || sendId == null) return;
    final count = "${preview.recipientCount}";
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.l10n.bcConfirmTitle),
        content: Text(context.l10n.bcConfirmBody(preview.audienceLabel, count)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(context.l10n.bcSendNow(count)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await _call(
        dryRun: false,
        confirmCount: preview.recipientCount,
        sendId: sendId,
      );
      if (mounted) {
        setState(() {
          _sent = r;
          _preview = null;
          _sendId = null;
        });
      }
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

  // ------------------------------------------------------------------ UI

  String _kindLabel(BroadcastAudienceKind k) {
    final l = context.l10n;
    switch (k) {
      case BroadcastAudienceKind.parents:
        return l.bcAudienceAllParents;
      case BroadcastAudienceKind.sections:
        return l.bcAudienceSections;
      case BroadcastAudienceKind.staff:
        return l.bcAudienceStaff;
      case BroadcastAudienceKind.route:
        return l.bcAudienceRoutes;
      case BroadcastAudienceKind.feeDefaulters:
        return l.bcAudienceFeeDefaulters;
    }
  }

  Widget _heading(String text) => Padding(
    padding: const EdgeInsets.only(top: 16, bottom: 6),
    child: Text(
      text,
      style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.ink),
    ),
  );

  Widget _chips(List<BroadcastIdLabel> items, Set<String> selected) => Wrap(
    spacing: 6,
    runSpacing: 6,
    children: [
      for (final it in items)
        FilterChip(
          label: Text(it.label),
          selected: selected.contains(it.id),
          onSelected: _busy
              ? null
              : (on) {
                  on ? selected.add(it.id) : selected.remove(it.id);
                  _changed();
                },
        ),
    ],
  );

  Widget _audiencePicker(BroadcastAudienceOptions o) {
    final l = context.l10n;
    final offered = BroadcastAudienceSelection.offered(o);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _heading(l.audience),
        if (!o.schoolWide)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(l.bcOwnSectionsOnly, style: AppText.labelMediumMuted),
          ),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final k in offered)
              ChoiceChip(
                label: Text(_kindLabel(k)),
                selected: _audience.kind == k,
                onSelected: _busy
                    ? null
                    : (_) {
                        _audience.kind = k;
                        _changed();
                      },
              ),
          ],
        ),
        const SizedBox(height: 8),
        if (_audience.kind == BroadcastAudienceKind.sections)
          for (final c in o.classes)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 64,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(c.name, style: AppText.labelMediumInk),
                    ),
                  ),
                  Expanded(
                    child: _chips([
                      for (final s in c.sections)
                        BroadcastIdLabel(
                          s.id,
                          s.name.isEmpty ? s.label : s.name,
                        ),
                    ], _audience.sectionIds),
                  ),
                ],
              ),
            ),
        if (_audience.kind == BroadcastAudienceKind.staff) ...[
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: "all", label: Text(l.bcStaffAll)),
              ButtonSegment(value: "teaching", label: Text(l.bcStaffTeaching)),
              ButtonSegment(
                value: "non_teaching",
                label: Text(l.bcStaffNonTeaching),
              ),
            ],
            selected: {_audience.staffStream},
            onSelectionChanged: _busy
                ? null
                : (s) {
                    _audience.staffStream = s.first;
                    _changed();
                  },
          ),
          if (o.designations.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(l.bcStaffRolesHint, style: AppText.labelMediumMuted),
            const SizedBox(height: 4),
            _chips(o.designations, _audience.designationIds),
          ],
        ],
        if (_audience.kind == BroadcastAudienceKind.route)
          _chips(o.routes, _audience.routeIds),
        if (_audience.kind == BroadcastAudienceKind.feeDefaulters)
          _chips(o.feeStages, _audience.feeStages),
      ],
    );
  }

  Widget _messagePicker(BroadcastAudienceOptions o) {
    final l = context.l10n;
    final templates = o.templates;
    final t = _template;
    // Parents read Hindi unless they chose English; staff read English.
    final hindiPreview = _audience.kind != BroadcastAudienceKind.staff;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _heading(l.bcChannel),
        SegmentedButton<String>(
          segments: [
            ButtonSegment(
              value: "whatsapp",
              label: Text(l.bcChannelWhatsapp),
              icon: const Icon(Icons.chat_outlined),
            ),
            ButtonSegment(
              value: "app",
              label: Text(l.bcChannelApp),
              icon: const Icon(Icons.notifications_outlined),
            ),
          ],
          selected: {_channel},
          onSelectionChanged: _busy
              ? null
              : (s) {
                  _channel = s.first;
                  _changed();
                },
        ),
        if (_channel == "app")
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(l.bcChannelAppHint, style: AppText.labelMediumMuted),
          ),
        _heading(l.messageType),
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: "template", label: Text(l.bcModeTemplate)),
            ButtonSegment(value: "custom", label: Text(l.bcModeCustom)),
          ],
          selected: {_mode},
          onSelectionChanged: _busy
              ? null
              : (s) {
                  _mode = s.first;
                  _changed();
                },
        ),
        const SizedBox(height: 10),
        if (_mode == "template") ...[
          if (templates == null)
            Text(
              l.bcTemplatesNotLoaded,
              style: AppText.labelMedium.copyWith(color: AppColors.danger),
            )
          else if (templates.isEmpty)
            Text(l.bcNoTemplates, style: AppText.labelMediumMuted)
          else
            DropdownButtonFormField<String>(
              key: ValueKey("tpl-${t?.familyKey ?? ""}"),
              initialValue: t?.familyKey,
              isExpanded: true,
              hint: Text(l.bcChooseTemplate),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: [
                for (final f in templates)
                  DropdownMenuItem(
                    value: f.familyKey,
                    child: Text(f.name, overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: _busy
                  ? null
                  : (k) => _pickTemplate(
                      templates.where((f) => f.familyKey == k).firstOrNull,
                    ),
            ),
          if (t != null) ...[
            const SizedBox(height: 8),
            Card(
              color: ModuleTone.teal.background,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      t.preview(_variableValues(), hindi: hindiPreview),
                      style: AppText.bodyMediumInk,
                    ),
                    if (t.variables.any((v) => v.auto)) ...[
                      const SizedBox(height: 6),
                      Text(
                        l.bcAutoFilledHint,
                        style: AppText.labelMedium.copyWith(
                          color: ModuleTone.teal.foreground,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            for (final v in t.askFor)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: TextField(
                  controller: _vars[v.key],
                  enabled: !_busy,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    labelText: v.label,
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  onChanged: (_) => _changed(),
                ),
              ),
          ],
        ] else ...[
          if (_channel == "whatsapp")
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: TextField(
                controller: _title,
                enabled: !_busy,
                maxLength: 60,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  labelText: l.bcCustomTitle,
                  border: const OutlineInputBorder(),
                  isDense: true,
                ),
                onChanged: (_) => _changed(),
              ),
            ),
          DictateField(
            label: l.message,
            controller: _text,
            enabled: !_busy,
            minLines: 4,
            maxLines: 10,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => _changed(),
            hint: l.eGSchoolWillRemainClosed,
          ),
          if (_text.text.length > o.customMax)
            Text(
              "${_text.text.length} / ${o.customMax}",
              style: AppText.labelMedium.copyWith(color: AppColors.danger),
            ),
          if (_channel == "whatsapp") ...[
            const SizedBox(height: 4),
            Text(l.bcCustomHint, style: AppText.labelMediumMuted),
            if (o.customTemplateReady == false)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  l.bcCustomTemplateNotReady,
                  style: AppText.labelMedium.copyWith(color: AppColors.warning),
                ),
              ),
          ],
        ],
      ],
    );
  }

  Widget _previewCard(AudienceBroadcastResult p) {
    final l = context.l10n;
    return Card(
      color: ModuleTone.coral.background,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l.bcReadyToSend,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: ModuleTone.coral.foreground,
              ),
            ),
            const SizedBox(height: 4),
            for (final line in broadcastPreviewLines(l, p))
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(line, style: AppText.bodySmall),
              ),
            if (p.sample.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                p.sample.join(" · "),
                style: AppText.labelMediumMuted,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            const SizedBox(height: 4),
            Text(l.nothingHasBeenSentYetReview, style: AppText.bodySmallMuted),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: _busy || p.recipientCount == 0 ? null : _sendLive,
              icon: const Icon(Icons.send),
              label: Text(l.bcSendNow("${p.recipientCount}")),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sentCard(AudienceBroadcastResult s) => Card(
    color: ModuleTone.teal.background,
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.check_circle, color: ModuleTone.teal.foreground),
              const SizedBox(width: 8),
              Text(
                context.l10n.sent,
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: ModuleTone.teal.foreground,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            context.l10n.bcResult(
              "${s.sent}",
              "${s.failed}",
              "${s.deferred}",
              "${s.pushSent}",
            ),
            style: AppText.bodySmall,
          ),
          if (s.error.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              s.error,
              style: AppText.bodySmall.copyWith(color: AppColors.danger),
            ),
          ],
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final o = _options;
    return Scaffold(
      appBar: AppBar(
        actions: [
          ScreenGuideButton(guideId: "broadcast", screenLabel: "broadcast"),
        ],
        title: Text(context.l10n.broadcastMessage),
      ),
      body: o == null
          ? Center(
              child: _loadError == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_loadError!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          OutlinedButton(
                            onPressed: _load,
                            child: Text(context.l10n.tryAgain),
                          ),
                        ],
                      ),
                    ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              children: [
                _audiencePicker(o),
                _messagePicker(o),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    style: AppText.bodySmall.copyWith(color: AppColors.danger),
                  ),
                ],
                const SizedBox(height: 12),
                if (_sent != null)
                  _sentCard(_sent!)
                else if (_preview != null)
                  _previewCard(_preview!)
                else
                  FilledButton.tonalIcon(
                    onPressed: _busy ? null : _dryRun,
                    icon: _busy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.people_outline),
                    label: Text(context.l10n.previewRecipients),
                  ),
                const SizedBox(height: 16),
                Text(
                  context.l10n.goesOutOnWhatsappFromThe,
                  style: AppText.labelMediumMuted,
                ),
              ],
            ),
    );
  }
}

/// The preview card's lines: how many go as free text, how many in the
/// template, who cannot be reached, what it should cost. Pure, for tests.
List<String> broadcastPreviewLines(L l, AudienceBroadcastResult p) {
  final whatsapp = p.channel != "app";
  final custom = p.messageMode == "custom";
  final est = p.estimate;
  return [
    p.audienceLabel,
    l.bcFamiliesInAudience("${p.families}"),
    if (whatsapp && custom) l.bcAsFreeText("${p.viaFreeText}"),
    if (whatsapp) l.bcViaTemplate("${p.viaTemplate}"),
    if (whatsapp && p.cannotReach > 0) l.bcCannotReach("${p.cannotReach}"),
    if (whatsapp && custom && !p.windowKnown) l.bcWindowUnknown,
    if (whatsapp && p.skippedTotal > 0)
      l.bcSkipped(
        "${p.skippedOptOut}",
        "${p.skippedNotOnWhatsApp}",
        "${p.skippedNoNumber}",
      ),
    if (whatsapp)
      est == null
          ? l.bcEstimateUnknown
          : l.bcEstimate(est.rupees, est.gstPct.toStringAsFixed(0)),
    if (whatsapp && est != null && !est.ratesConfirmed) l.bcEstimateDefaults,
    l.bcAppNotificationToo,
  ];
}
