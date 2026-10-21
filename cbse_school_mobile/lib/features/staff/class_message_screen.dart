import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/dictate_field.dart";
import "../modules/module_shell.dart";

/// A teacher's message to the families of their OWN classes — school
/// WhatsApp plus an app notification (/api/v1/staff/broadcast).
///
/// Not the principal's Broadcast (school-wide, BroadcastScreen): the server
/// lists only the sections this person teaches and refuses any other, so
/// the screen offers nothing the send would turn down. The count is always
/// checked with the server (a dry run) before the real send.
class ClassMessageScreen extends StatelessWidget {
  const ClassMessageScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<ClassBroadcastDesk>(
      guideId: "class-message",
      title: "Message my classes",
      subtitle: "Families of your own sections",
      load: api.fetchClassBroadcast,
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
  final ClassBroadcastDesk desk;
  final Future<void> Function() reload;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  static const _maxChars = 1000;
  final _text = TextEditingController();
  final Set<String> _picked = {};
  ClassBroadcastResult? _preview;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // One class: nothing to choose.
    if (widget.desk.sections.length == 1) {
      _picked.add(widget.desk.sections.first.sectionId);
    }
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
        _error = null;
      });
    }
  }

  List<String> get _sectionIds => widget.desk.sections
      .where((s) => _picked.contains(s.sectionId))
      .map((s) => s.sectionId)
      .toList();

  Future<void> _check() async {
    final body = _text.text.trim();
    if (_picked.isEmpty || body.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await widget.api.sendClassBroadcast(
        sectionIds: _sectionIds,
        body: body,
      );
      if (mounted) setState(() => _preview = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    final preview = _preview;
    final body = _text.text.trim();
    if (preview == null || body.isEmpty) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Send now? · अभी भेजें?"),
        content: Text(
          "This goes to ${preview.families} famil${preview.families == 1 ? "y" : "ies"} "
          "on the school's WhatsApp and as an app notification. It cannot be taken back.",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text("Cancel"),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text("Send · भेजें"),
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
      final r = await widget.api.sendClassBroadcast(
        sectionIds: _sectionIds,
        body: body,
        dryRun: false,
      );
      Haptics.success();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            "Sent: WhatsApp ${r.sent}${r.failed > 0 ? " (${r.failed} failed)" : ""} · app ${r.pushSent}",
          ),
        ),
      );
      _text.clear();
      setState(() => _preview = null);
      await widget.reload();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final desk = widget.desk;
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
            "WhatsApp delivers typed text only to families who messaged the school in the last 24 hours; the app notification reaches every family using the app.",
            style: AppText.bodySmall.copyWith(
              color: ModuleTone.blue.foreground,
            ),
          ),
        ),
        const SizedBox(height: 14),
        if (desk.sections.isNotEmpty) ...[
          Text(
            "Classes · कक्षाएँ",
            style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              for (final s in desk.sections)
                FilterChip(
                  label: Text("${s.label} · ${s.families}"),
                  selected: _picked.contains(s.sectionId),
                  onSelected: _busy
                      ? null
                      : (on) {
                          setState(() {
                            on
                                ? _picked.add(s.sectionId)
                                : _picked.remove(s.sectionId);
                          });
                          _changed();
                        },
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            "The number is families with a WhatsApp number on record.",
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
              onPressed: _busy || preview.families == 0 ? null : _send,
              icon: const Icon(Icons.send),
              label: const Text("Send · भेजें"),
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

class _PreviewCard extends StatelessWidget {
  const _PreviewCard({required this.preview});

  final ClassBroadcastResult preview;

  @override
  Widget build(BuildContext context) {
    final p = preview;
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
            p.families == 0
                ? "No family in these classes has a number on record — nothing would be sent."
                : "Goes to ${p.families} famil${p.families == 1 ? "y" : "ies"} · ${p.families} परिवारों को जाएगा",
            style: AppText.bodyMediumInk.copyWith(
              fontWeight: FontWeight.w700,
              color: ModuleTone.green.foreground,
            ),
          ),
          if (p.families > 0)
            Text(
              "${p.recipientCount} WhatsApp number${p.recipientCount == 1 ? "" : "s"}"
              "${p.skippedOptOut > 0 ? " · ${p.skippedOptOut} left out (asked not to get WhatsApp)" : ""}",
              style: AppText.bodySmall.copyWith(
                color: ModuleTone.green.foreground,
              ),
            ),
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
