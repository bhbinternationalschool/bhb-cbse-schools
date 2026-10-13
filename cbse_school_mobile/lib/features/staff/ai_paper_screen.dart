import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "ai_common.dart";

/// Which of the two exam-desk AI helpers this screen is.
enum AiPaperMode { questionPaper, worksheet }

/// Question paper or remedial worksheet from the phone — the web's Exam
/// papers "AI fill" and Item analysis "Remedial worksheet".
///
/// Class, subject and the school's own chapters (from the Teaching plan)
/// go to the server, which writes the draft with the same generator as the
/// web. The phone shows it, with or without answers, and copies it. Nothing
/// is saved to the exams desk from here: a paper to print and keep is set up
/// on the web's Exam papers, where its layout, sets and key live.
class AiPaperScreen extends StatefulWidget {
  const AiPaperScreen({super.key, required this.api, required this.mode});

  final ApiClient api;
  final AiPaperMode mode;

  @override
  State<AiPaperScreen> createState() => _AiPaperScreenState();
}

class _AiPaperScreenState extends State<AiPaperScreen> {
  AiTargetClass? _class;
  AiTargetSubject? _subject;
  List<String> _unitIds = const [];
  int _marks = 40;
  int _count = 8;
  String _hardness = "mixed";
  final _weak = TextEditingController();

  AiCall? _call;
  String? _error;
  String _heading = "";
  List<AiPaperSection>? _sections;
  String _generationId = "";
  String _detail = "";
  bool _showAnswers = false;
  bool _used = false;

  bool get _isPaper => widget.mode == AiPaperMode.questionPaper;
  String get _targetType => _isPaper ? "exam_paper" : "remedial_worksheet";

  @override
  void initState() {
    super.initState();
    if (!_isPaper) _hardness = "medium";
  }

  @override
  void dispose() {
    _call?.cancel();
    _rejectUnused();
    _weak.dispose();
    super.dispose();
  }

  /// A draft the teacher never copied was not used.
  void _rejectUnused() {
    if (_generationId.isNotEmpty && !_used) {
      widget.api.reportAiOutcome(
        ids: [_generationId],
        outcome: "rejected",
        targetType: _targetType,
      );
    }
    _used = true;
  }

  List<String> get _weakAreas => _weak.text
      .split(RegExp(r"[\n,;]"))
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .take(8)
      .toList();

  Future<void> _write() async {
    final cls = _class;
    final sub = _subject;
    if (cls == null || sub == null || _call != null) return;
    if (!_isPaper && _unitIds.isEmpty && _weakAreas.isEmpty) {
      setState(
        () => _error = "Tick a chapter, or type what the class found hard.",
      );
      return;
    }
    _rejectUnused();
    final call = AiCall();
    setState(() {
      _call = call;
      _error = null;
    });
    try {
      if (_isPaper) {
        final d = await widget.api.draftQuestionPaper(
          classId: cls.id,
          subjectId: sub.id,
          unitIds: _unitIds,
          maxMarks: _marks,
          hardness: _hardness,
          call: call,
        );
        if (!mounted) return;
        setState(() {
          _sections = d.sections;
          _generationId = d.generationId;
          _used = false;
          _heading =
              "${cls.name} · ${sub.name} · ${d.totalMarks.round()} marks";
          _detail = d.isOffline
              ? "The AI was unavailable — this is the ERP's built-in offline draft."
              : d.explanation.join(" ");
        });
      } else {
        final w = await widget.api.draftRemedialWorksheet(
          classId: cls.id,
          subjectId: sub.id,
          unitIds: _unitIds,
          weakAreas: _weakAreas,
          count: _count,
          hardness: _hardness,
          call: call,
        );
        if (!mounted) return;
        setState(() {
          _sections = [AiPaperSection.of("Practice worksheet", w.questions)];
          _generationId = w.generationId;
          _used = false;
          _heading = "${cls.name} · ${sub.name} · Practice worksheet";
          _detail =
              "Starts easy, then builds up. Answers and marking steps are under 'Show answers'.";
        });
      }
    } on AiCancelled {
      /* stopped */
    } catch (e) {
      if (mounted) setState(() => _error = aiErrorText(e));
    } finally {
      if (mounted) setState(() => _call = null);
    }
  }

  Future<void> _copy(bool withAnswers) async {
    final sections = _sections;
    if (sections == null) return;
    await aiCopy(
      context,
      aiPaperText(
        heading: _heading,
        sections: sections,
        withAnswers: withAnswers,
      ),
      withAnswers ? "Teacher copy" : "Student copy",
    );
    if (_generationId.isNotEmpty && !_used) {
      _used = true;
      widget.api.reportAiOutcome(
        ids: [_generationId],
        outcome: "accepted",
        targetType: _targetType,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final sections = _sections;
    final guide = _isPaper ? "ai-question-paper" : "ai-worksheet";
    return Scaffold(
      appBar: AppBar(
        actions: [ScreenGuideButton(guideId: guide, screenLabel: guide)],
        title: Text(
          _isPaper
              ? "Question paper · प्रश्न-पत्र"
              : "Remedial worksheet · अभ्यास पत्र",
          style: AppText.titleSmall,
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          AiClassSubjectChapters(
            api: widget.api,
            enabled: _call == null,
            onChanged: (c, s, ids, _) => setState(() {
              _class = c;
              _subject = s;
              _unitIds = ids;
            }),
          ),
          const SizedBox(height: 12),
          if (_isPaper) ...[
            Text("Total marks · कुल अंक", style: AppText.bodySmallMuted),
            Wrap(
              spacing: 6,
              children: [
                for (final m in const [20, 25, 40, 50, 80])
                  ChoiceChip(
                    label: Text("$m"),
                    selected: _marks == m,
                    onSelected: _call != null
                        ? null
                        : (_) => setState(() => _marks = m),
                  ),
              ],
            ),
          ] else ...[
            TextField(
              controller: _weak,
              enabled: _call == null,
              minLines: 2,
              maxLines: 4,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: "What did the class find hard? · कहाँ कठिनाई हुई?",
                hintText:
                    "e.g. fractions with unlike denominators, word problems",
              ),
            ),
            const SizedBox(height: 8),
            Text("Questions · प्रश्न", style: AppText.bodySmallMuted),
            Wrap(
              spacing: 6,
              children: [
                for (final n in const [5, 8, 10, 12])
                  ChoiceChip(
                    label: Text("$n"),
                    selected: _count == n,
                    onSelected: _call != null
                        ? null
                        : (_) => setState(() => _count = n),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          Text("Difficulty · कठिनाई", style: AppText.bodySmallMuted),
          Wrap(
            spacing: 6,
            children: [
              for (final h in [
                ("easy", "Easy"),
                ("medium", "Medium"),
                ("hard", "Hard"),
                if (_isPaper) ("mixed", "Mixed"),
              ])
                ChoiceChip(
                  label: Text(h.$2),
                  selected: _hardness == h.$1,
                  onSelected: _call != null
                      ? null
                      : (_) => setState(() => _hardness = h.$1),
                ),
            ],
          ),
          const SizedBox(height: 16),
          if (_error != null) AiErrorCard(message: _error!),
          if (_call != null)
            AiWorking(
              message: _isPaper
                  ? "Writing the paper…"
                  : "Writing the worksheet…",
              onStop: () => _call?.cancel(),
            )
          else
            FilledButton.icon(
              onPressed: _class == null || _subject == null ? null : _write,
              icon: const Icon(Icons.auto_awesome),
              label: Text(
                sections == null
                    ? "Write with AI · AI से बनाएँ"
                    : "Write again · फिर से बनाएँ",
              ),
            ),
          if (sections != null && _call == null) ...[
            const SizedBox(height: 16),
            AiSuggestionBanner(detail: _detail),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _heading,
                    style: AppText.bodyMediumInk.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Switch(
                  value: _showAnswers,
                  onChanged: (v) => setState(() => _showAnswers = v),
                ),
                Text("Show answers", style: AppText.labelMediumMuted),
              ],
            ),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: SelectableText(
                  aiPaperText(
                    heading: "",
                    sections: sections,
                    withAnswers: _showAnswers,
                  ),
                  style: AppText.bodyMediumInk.copyWith(height: 1.45),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _copy(false),
                    icon: const Icon(Icons.copy, size: 18),
                    label: const Text("Copy student copy"),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _copy(true),
                    icon: const Icon(Icons.key_outlined, size: 18),
                    label: const Text("Copy with answers"),
                  ),
                ),
              ],
            ),
            if (_isPaper)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  "To print and keep this paper, set it up on the web ERP (Exams → Question papers), where its layout and key are saved.",
                  style: AppText.bodySmallMuted,
                ),
              ),
          ],
        ],
      ),
    );
  }
}
