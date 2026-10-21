import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";

/// Write and publish a notice or a news item from the staff app (request
/// mr_mv9y435vx6e5). Shown only to staff who may create them on the web
/// (features `notices_create` / `news_create`); the server checks again.
///
/// Pops `true` once published, so the list reloads.
class NoticeComposeScreen extends StatefulWidget {
  const NoticeComposeScreen({
    super.key,
    required this.api,
    required this.canNotice,
    required this.canNews,
  });

  final ApiClient api;
  final bool canNotice;
  final bool canNews;

  @override
  State<NoticeComposeScreen> createState() => _NoticeComposeScreenState();
}

class _NoticeComposeScreenState extends State<NoticeComposeScreen> {
  late String _kind = widget.canNotice ? "notice" : "news";
  String _audience = "all";
  bool _pinned = false;
  bool _busy = false;
  final _title = TextEditingController();
  final _summary = TextEditingController();
  final _body = TextEditingController();

  @override
  void dispose() {
    _title.dispose();
    _summary.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _publish() async {
    final l = context.l10n;
    final problem = noticeDraftProblem(title: _title.text, body: _body.text);
    if (problem != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(switch (problem) {
            "title" => l.hcWriteTitle,
            "body" => l.hcWriteMessage,
            _ => l.hcTooLong,
          }),
        ),
      );
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(l.hcConfirmPublish),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l.hcPublish),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.api.publishNotice(
        kind: _kind,
        title: _title.text,
        body: _body.text,
        audience: _audience,
        pinned: _pinned,
        summary: _summary.text,
      );
      Haptics.success();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l.hcPublished)));
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l.homeCouldNotReachServerCheckConnection)),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final isNotice = _kind == "notice";
    return Scaffold(
      appBar: AppBar(
        title: Text(l.hcCreateNotice, style: AppText.titleMedium),
        actions: [
          ScreenGuideButton(
            guideId: "notice-compose",
            screenLabel: l.hcCreateNotice,
          ),
          const LanguageToggle(onLight: true),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (widget.canNotice && widget.canNews)
            SegmentedButton<String>(
              segments: [
                ButtonSegment(value: "notice", label: Text(l.homeNotice)),
                ButtonSegment(value: "news", label: Text(l.homeNews)),
              ],
              selected: {_kind},
              onSelectionChanged: _busy
                  ? null
                  : (v) => setState(() => _kind = v.first),
            ),
          const SizedBox(height: 14),
          TextField(
            controller: _title,
            enabled: !_busy,
            maxLength: 200,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l.hcNoticeTitle),
          ),
          if (!isNotice)
            TextField(
              controller: _summary,
              enabled: !_busy,
              maxLength: 300,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(labelText: l.hcNewsSummary),
            ),
          TextField(
            controller: _body,
            enabled: !_busy,
            minLines: 6,
            maxLines: 14,
            maxLength: 5000,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              labelText: l.hcNoticeMessage,
              alignLabelWithHint: true,
            ),
          ),
          if (isNotice) ...[
            const SizedBox(height: 8),
            Text(l.hcAudience, style: AppText.labelMediumMuted),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: [
                for (final (v, label) in [
                  ("all", l.hcAudienceAll),
                  ("parents", l.hcAudienceParents),
                  ("staff", l.hcAudienceStaff),
                ])
                  ChoiceChip(
                    label: Text(label),
                    selected: _audience == v,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() => _audience = v),
                  ),
              ],
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l.hcPinToTop),
              value: _pinned,
              onChanged: _busy ? null : (v) => setState(() => _pinned = v),
            ),
            Text(l.hcNoticePushNote, style: AppText.labelMediumMuted),
          ],
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: _busy ? null : _publish,
            icon: _busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.send_outlined),
            label: Text(l.hcPublish),
          ),
        ],
      ),
    );
  }
}
