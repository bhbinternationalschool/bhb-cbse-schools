import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/dictate_field.dart";
import "../modules/module_shell.dart";
import "broadcast_screen.dart" show broadcastPreviewLines;

/// A teacher's message to the families of their OWN classes — school
/// WhatsApp plus an app notification.
///
/// Not the principal's Broadcast (school-wide, BroadcastScreen), but the
/// same send path since 22 Oct 2026: /api/v1/staff/broadcast/audience with
/// a custom message. The sections offered are the ones that route's GET
/// lists — the scope its POST enforces — so the screen offers nothing the
/// send would turn down. Typed text goes as free text only to families
/// inside their 24-hour WhatsApp window; everyone else gets it inside the
/// approved "School notice" template (the old route sent free text to all,
/// and Meta dropped it outside the window). The dry run shows that split;
/// the send carries the dry run's count and a one-time sendId.
class ClassMessageScreen extends StatelessWidget {
  const ClassMessageScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<ClassMessageDesk>(
      guideId: "class-message",
      title: "Message my classes",
      subtitle: "Families of your own sections",
      load: api.fetchClassMessageDesk,
      emptyIcon: Icons.campaign_outlined,
      emptyText:
          "No classes are given to you yet, so there is no one to message. The office adds them in Staff → Duties.",
      isEmpty: (d) => d.sections.isEmpty && (d.sent?.isEmpty ?? true),
      builder: (context, desk, reload) =>
          _Composer(api: api, desk: desk, reload: reload),
    );
  }
}

class _Composer extends StatefulWidget {
  const _Composer({
    required this.api,
    required this.desk,
    required this.reload,
  });

  final ApiClient api;
  final ClassMessageDesk desk;
  final Future<void> Function() reload;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  final _text = TextEditingController();
  final Set<String> _picked = {};
  AudienceBroadcastResult? _preview;

  /// One per preview: the live send claims it once on the server, so a
  /// retry after a lost reply cannot send twice.
  String? _sendId;
  bool _busy = false;
  String? _error;

  int get _maxChars => widget.desk.options.customMax;

  @override
  void initState() {
    super.initState();
    // One class: nothing to choose.
    final sections = widget.desk.sections;
    if (sections.length == 1) _picked.add(sections.first.id);
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  /// Any change to who or what voids the counted preview.
  void _changed() {
    if (_preview != null || _error != null) {
      setState(() {
        _preview = null;
        _sendId = null;
        _error = null;
      });
    }
  }

  Map<String, dynamic>? get _audience => BroadcastAudienceSelection(
    kind: BroadcastAudienceKind.sections,
    sectionIds: {..._picked},
  ).toSpec();

  Future<AudienceBroadcastResult> _call({
    required bool dryRun,
    int? confirmCount,
    String? sendId,
  }) => widget.api.broadcastToAudience(
    audience: _audience!,
    mode: "custom",
    text: _text.text.trim(),
    dryRun: dryRun,
    confirmCount: confirmCount,
    sendId: sendId,
  );

  Future<void> _check() async {
    if (_audience == null || _text.text.trim().isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
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

  Future<void> _send() async {
    final preview = _preview;
    final sendId = _sendId;
    if (preview == null || sendId == null) return;
    final l = context.l10n;
    final count = "${preview.recipientCount}";
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.bcConfirmTitle),
        content: Text(l.bcConfirmBody(preview.audienceLabel, count)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l.bcSendNow(count)),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
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
      Haptics.success();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            l.bcResult(
              "${r.sent}",
              "${r.failed}",
              "${r.deferred}",
              "${r.pushSent}",
            ),
          ),
        ),
      );
      _text.clear();
      setState(() {
        _preview = null;
        _sendId = null;
      });
      await widget.reload();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        // 409: the audience moved (check again) or this sendId was already
        // used — either way this preview is spent. Anything else keeps it,
        // so a retry reuses the same sendId and cannot send twice.
        if (e.statusCode == 409) {
          _preview = null;
          _sendId = null;
        }
      });
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
    final l = context.l10n;
    final desk = widget.desk;
    final sections = desk.sections;
    final families = desk.familiesBySection;
    final preview = _preview;
    final canCheck =
        !_busy && _picked.isNotEmpty && _text.text.trim().isNotEmpty;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: ModuleTone.blue.background,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(
            "Goes only to the families of the classes you teach — on the school's WhatsApp and as an app notification. "
            "${l.bcCustomHint}",
            style: AppText.bodySmall.copyWith(
              color: ModuleTone.blue.foreground,
            ),
          ),
        ),
        if (desk.options.customTemplateReady != true)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              desk.options.customTemplateReady == false
                  ? l.bcCustomTemplateNotReady
                  : l.bcTemplatesNotLoaded,
              style: AppText.bodySmall.copyWith(color: AppColors.danger),
            ),
          ),
        const SizedBox(height: 14),
        if (sections.isNotEmpty) ...[
          Text(
            "Classes · कक्षाएँ",
            style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              for (final s in sections)
                FilterChip(
                  label: Text(
                    families?[s.id] == null
                        ? s.label
                        : "${s.label} · ${families![s.id]}",
                  ),
                  selected: _picked.contains(s.id),
                  onSelected: _busy
                      ? null
                      : (on) {
                          setState(() {
                            on ? _picked.add(s.id) : _picked.remove(s.id);
                          });
                          _changed();
                        },
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            families == null
                ? l.cmFamiliesNotLoaded
                : "The number is families with a WhatsApp number on record.",
            style: AppText.labelMediumMuted,
          ),
          const SizedBox(height: 14),
          DictateField(
            label: "Message (Hindi or English) · संदेश",
            controller: _text,
            minLines: 3,
            maxLines: 8,
            enabled: !_busy,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (v) {
              if (v.length > _maxChars) {
                _text.text = v.substring(0, _maxChars);
                _text.selection = TextSelection.collapsed(offset: _maxChars);
              }
              setState(() {});
              _changed();
            },
          ),
          Align(
            alignment: Alignment.centerRight,
            child: Text(
              "${_text.text.length}/$_maxChars",
              style: AppText.labelMediumMuted,
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                _error!,
                style: AppText.bodySmall.copyWith(color: AppColors.danger),
              ),
            ),
          if (preview != null) _PreviewCard(preview: preview),
          const SizedBox(height: 10),
          if (preview == null)
            FilledButton.tonalIcon(
              onPressed: canCheck ? _check : null,
              icon: _busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.people_alt_outlined),
              label: const Text("Check reach · पहुँच देखें"),
            )
          else
            FilledButton.icon(
              onPressed: _busy || preview.recipientCount == 0 ? null : _send,
              icon: const Icon(Icons.send),
              label: Text(l.bcSendNow("${preview.recipientCount}")),
            ),
        ],
        const SizedBox(height: 24),
        Text(
          "What I sent · मेरे भेजे संदेश",
          style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        if (desk.sent == null)
          Text(
            "Your sent messages could not be loaded — pull down to try again.",
            style: AppText.bodySmallMuted,
          )
        else if (desk.sent!.isEmpty)
          Text("Nothing sent yet.", style: AppText.bodySmallMuted)
        else
          for (final m in desk.sent!) _SentTile(m: m),
      ],
    );
  }
}

/// The dry run's split — free text inside 24 h, template for the rest, who
/// cannot be reached, cost — the same lines as the Broadcast screen.
class _PreviewCard extends StatelessWidget {
  const _PreviewCard({required this.preview});

  final AudienceBroadcastResult preview;

  @override
  Widget build(BuildContext context) {
    final p = preview;
    final lines = broadcastPreviewLines(context.l10n, p);
    final tone = TextStyle(color: ModuleTone.green.foreground);
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: ModuleTone.green.background,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            p.recipientCount == 0 ? context.l10n.cmNoneReachable : lines.first,
            style: AppText.bodyMediumInk.copyWith(
              fontWeight: FontWeight.w700,
              color: ModuleTone.green.foreground,
            ),
          ),
          for (final line in lines.skip(1))
            Text(line, style: AppText.bodySmall.merge(tone)),
        ],
      ),
    );
  }
}

class _SentTile extends StatelessWidget {
  const _SentTile({required this.m});

  final ClassBroadcastSent m;

  @override
  Widget build(BuildContext context) {
    final when = DateTime.tryParse(m.at)?.toLocal();
    final whenLabel = when == null
        ? ""
        : "${formatDateLabel(m.at)} · ${hhmmLabel("${when.hour.toString().padLeft(2, "0")}:${when.minute.toString().padLeft(2, "0")}")}";
    final to = m.audience == "leadership"
        ? "Leadership"
        : m.audienceLabel.isNotEmpty
        ? m.audienceLabel
        : (m.sectionLabels.isEmpty ? "My classes" : m.sectionLabels.join(", "));
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              to,
              style: AppText.bodyMediumInk.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            if (whenLabel.isNotEmpty)
              Text(whenLabel, style: AppText.labelMediumMuted),
            const SizedBox(height: 4),
            Text(
              m.body.isNotEmpty
                  ? m.body
                  : (m.templateName.isNotEmpty
                        ? "Template: ${m.templateName}"
                        : ""),
              style: AppText.bodySmallInk.copyWith(height: 1.4),
              maxLines: 6,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
            Text(
              "${m.families} famil${m.families == 1 ? "y" : "ies"} · WhatsApp sent ${m.sent}"
              "${m.failed > 0 ? ", ${m.failed} failed" : ""} · app ${m.pushSent}",
              style: AppText.labelMediumMuted,
            ),
          ],
        ),
      ),
    );
  }
}
