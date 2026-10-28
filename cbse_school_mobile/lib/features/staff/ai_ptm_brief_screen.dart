import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "ai_common.dart";

/// Three short paragraphs to read before a parent sits down — what the
/// marks, attendance, homework and conduct show, what needs attention, what
/// to suggest. The web PTM tab's "Prepare brief", on the phone.
///
/// The server builds the facts from the school's own records (never from
/// the phone) and writes in the family's language. Nothing is saved: "Use as
/// meeting note" pops the brief back so the PTM screen can start the note
/// with it, and the teacher edits before saving that note.
class AiPtmBriefScreen extends StatefulWidget {
  const AiPtmBriefScreen({
    super.key,
    required this.api,
    required this.bookingId,
    required this.studentName,
  });

  final ApiClient api;
  final String bookingId;
  final String studentName;

  @override
  State<AiPtmBriefScreen> createState() => _AiPtmBriefScreenState();
}

class _AiPtmBriefScreenState extends State<AiPtmBriefScreen> {
  final _note = TextEditingController();
  AiCall? _call;
  String? _error;
  AiPtmBrief? _brief;
  bool _reported = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _write();
    });
  }

  @override
  void dispose() {
    _call?.cancel();
    _reject();
    _note.dispose();
    super.dispose();
  }

  void _reject() {
    final b = _brief;
    if (b != null && b.generationId.isNotEmpty && !_reported) {
      widget.api.reportAiOutcome(
        ids: [b.generationId],
        outcome: "rejected",
        targetType: "ptm_booking",
      );
    }
    _reported = true;
  }

  Future<void> _write() async {
    if (_call != null) return;
    _reject();
    final call = AiCall();
    setState(() {
      _call = call;
      _error = null;
    });
    try {
      final b = await widget.api.draftPtmBrief(
        bookingId: widget.bookingId,
        teacherNote: _note.text.trim(),
        call: call,
      );
      if (!mounted) return;
      setState(() {
        _brief = b;
        _reported = false;
      });
    } on AiCancelled {
      /* stopped */
    } catch (e) {
      if (mounted) setState(() => _error = aiErrorText(e));
    } finally {
      if (mounted) setState(() => _call = null);
    }
  }

  void _use() {
    final b = _brief;
    if (b == null) return;
    if (b.generationId.isNotEmpty) {
      widget.api.reportAiOutcome(
        ids: [b.generationId],
        outcome: "accepted",
        targetType: "ptm_booking",
        targetId: widget.bookingId,
      );
    }
    _reported = true;
    Navigator.of(context).pop(b);
  }

  String _text(AiPtmBrief b) => [
    "Observations:\n${b.observations}",
    if (b.concerns.trim().isNotEmpty) "Concerns:\n${b.concerns}",
    "Suggestions:\n${b.suggestions}",
  ].join("\n\n");

  @override
  Widget build(BuildContext context) {
    final b = _brief;
    return Scaffold(
      appBar: AppBar(
        actions: const [
          ScreenGuideButton(
            guideId: "ai-ptm-brief",
            screenLabel: "ai-ptm-brief",
          ),
        ],
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text("PTM brief · PTM सार", style: AppText.titleSmall),
            Text(widget.studentName, style: AppText.labelMediumMuted),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null) AiErrorCard(message: _error!, onRetry: _write),
          if (_call != null)
            AiWorking(
              message: "Preparing the brief…",
              onStop: () => _call?.cancel(),
            ),
          if (b != null && _call == null) ...[
            AiSuggestionBanner(
              detail: [
                if (b.missing.isNotEmpty)
                  "Not available, so not mentioned: ${b.missing.join(", ")}.",
                if (b.basisTerms.isNotEmpty)
                  "Exams used: ${b.basisTerms.join(", ")}.",
                ...b.warnings,
              ].join(" "),
            ),
            const SizedBox(height: 8),
            for (final p in [
              ("What we see · अवलोकन", b.observations),
              ("Needs attention · ध्यान दें", b.concerns),
              ("Suggestions · सुझाव", b.suggestions),
            ])
              if (p.$2.trim().isNotEmpty)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          p.$1,
                          style: AppText.bodyMediumInk.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        SelectableText(
                          p.$2,
                          style: AppText.bodyMediumInk.copyWith(height: 1.45),
                        ),
                      ],
                    ),
                  ),
                ),
            const SizedBox(height: 8),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: () => aiCopy(context, _text(b), "Brief"),
                  icon: const Icon(Icons.copy, size: 18),
                  label: const Text("Copy"),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _use,
                    icon: const Icon(Icons.edit_note),
                    label: const Text("Use as meeting note"),
                  ),
                ),
              ],
            ),
          ],
          if (_call == null) ...[
            const SizedBox(height: 16),
            TextField(
              controller: _note,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: "Anything the brief should cover? (optional)",
                hintText: "e.g. parent asked about Maths",
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _write,
              icon: const Icon(Icons.refresh),
              label: const Text("Write again · फिर से लिखें"),
            ),
          ],
        ],
      ),
    );
  }
}
