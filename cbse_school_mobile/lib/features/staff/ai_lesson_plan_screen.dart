import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "ai_common.dart";

/// AI lesson plan from the phone — the web Teaching → Lesson plans "Draft
/// with AI". The draft follows the school's own books for the class (never
/// NCERT's for Classes 1–8) and the learning outcomes teachers agreed with.
///
/// The draft lands in editable boxes. It is saved only when the teacher
/// presses Save, through the same lesson-plan save the app already uses,
/// marked "ai" (unchanged) or "ai_edited" — exactly as the web records it.
class AiLessonPlanScreen extends StatefulWidget {
  const AiLessonPlanScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<AiLessonPlanScreen> createState() => _AiLessonPlanScreenState();
}

class _AiLessonPlanScreenState extends State<AiLessonPlanScreen> {
  AiTargetClass? _class;
  AiTargetSubject? _subject;
  List<String> _unitIds = const [];
  int _periods = 1;
  String _language = "en";
  final _note = TextEditingController();

  AiCall? _call;
  String? _error;
  AiLessonPlanDraft? _draft;
  bool _saving = false;
  String _savedId = "";
  bool _reported = false;

  final _title = TextEditingController();
  final _objectives = TextEditingController();
  final _aids = TextEditingController();
  final _activities = TextEditingController();
  final _assessment = TextEditingController();
  final _homework = TextEditingController();

  List<(String, String, TextEditingController, int)> get _fields => [
    ("Title", "शीर्षक", _title, 1),
    ("Objectives", "उद्देश्य", _objectives, 4),
    ("Teaching aids", "शिक्षण सामग्री", _aids, 2),
    ("Activities", "गतिविधियाँ", _activities, 8),
    ("Assessment", "मूल्यांकन", _assessment, 3),
    ("Homework", "गृहकार्य", _homework, 2),
  ];

  @override
  void dispose() {
    _call?.cancel();
    _rejectUnsaved();
    for (final c in [
      _note,
      _title,
      _objectives,
      _aids,
      _activities,
      _assessment,
      _homework,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _rejectUnsaved() {
    final d = _draft;
    if (d != null && d.generationId.isNotEmpty && !_reported) {
      widget.api.reportAiOutcome(
        ids: [d.generationId],
        outcome: "rejected",
        targetType: "lesson_plan",
      );
    }
    _reported = true;
  }

  bool get _edited {
    final d = _draft;
    if (d == null) return false;
    return _title.text.trim() != d.title.trim() ||
        _objectives.text.trim() != d.objectives.trim() ||
        _aids.text.trim() != d.teachingAids.trim() ||
        _activities.text.trim() != d.activities.trim() ||
        _assessment.text.trim() != d.assessment.trim() ||
        _homework.text.trim() != d.homework.trim();
  }

  Future<void> _write() async {
    final cls = _class;
    final sub = _subject;
    if (cls == null || sub == null || _call != null) return;
    if (_unitIds.isEmpty &&
        _title.text.trim().isEmpty &&
        _note.text.trim().isEmpty) {
      setState(
        () => _error =
            "Tick at least one chapter, or say what the lesson is about.",
      );
      return;
    }
    // Re-drafting over an unsaved draft: the earlier one was not used.
    _rejectUnsaved();
    final call = AiCall();
    setState(() {
      _call = call;
      _error = null;
    });
    try {
      final d = await widget.api.draftLessonPlanAi(
        classId: cls.id,
        subjectId: sub.id,
        unitIds: _unitIds,
        periods: _periods,
        language: _language,
        teacherNote: _note.text.trim(),
        existing: _draft == null
            ? const {}
            : {
                "title": _title.text,
                "objectives": _objectives.text,
                "teachingAids": _aids.text,
                "activities": _activities.text,
                "assessment": _assessment.text,
                "homework": _homework.text,
              },
        call: call,
      );
      if (!mounted) return;
      setState(() {
        _draft = d;
        _reported = false;
        _savedId = "";
        _title.text = d.title;
        _objectives.text = d.objectives;
        _aids.text = d.teachingAids;
        _activities.text = d.activities;
        _assessment.text = d.assessment;
        _homework.text = d.homework;
      });
    } on AiCancelled {
      /* stopped */
    } catch (e) {
      if (mounted) setState(() => _error = aiErrorText(e));
    } finally {
      if (mounted) setState(() => _call = null);
    }
  }

  Future<void> _save() async {
    final d = _draft;
    final cls = _class;
    final sub = _subject;
    if (d == null || cls == null || sub == null) return;
    if (_title.text.trim().isEmpty) {
      setState(() => _error = "Give the plan a title.");
      return;
    }
    final edited = _edited;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final id = await widget.api.saveLessonPlan(
        classId: cls.id,
        subjectId: sub.id,
        title: _title.text.trim(),
        unitIds: d.unitIds,
        plannedPeriods: _periods,
        objectives: _objectives.text.trim(),
        teachingAids: _aids.text.trim(),
        activities: _activities.text.trim(),
        assessment: _assessment.text.trim(),
        homework: _homework.text.trim(),
        source: edited ? "ai_edited" : "ai",
        aiModel: d.model,
      );
      if (!_reported && d.generationId.isNotEmpty) {
        widget.api.reportAiOutcome(
          ids: [d.generationId],
          outcome: edited ? "edited" : "accepted",
          targetType: "lesson_plan",
          targetId: id,
        );
      }
      _reported = true;
      Haptics.success();
      if (!mounted) return;
      setState(() => _savedId = id);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Lesson plan saved · पाठ योजना सहेजी गई")),
      );
    } catch (e) {
      Haptics.warning();
      if (mounted) setState(() => _error = aiErrorText(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String get _asText => [
    for (final f in _fields)
      if (f.$3.text.trim().isNotEmpty) "${f.$1}:\n${f.$3.text.trim()}",
  ].join("\n\n");

  @override
  Widget build(BuildContext context) {
    final d = _draft;
    return Scaffold(
      appBar: AppBar(
        actions: const [
          ScreenGuideButton(
            guideId: "ai-lesson-plan",
            screenLabel: "ai-lesson-plan",
          ),
        ],
        title: const Text(
          "AI lesson plan · पाठ योजना",
          style: AppText.titleSmall,
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          AiClassSubjectChapters(
            api: widget.api,
            enabled: _call == null && !_saving,
            onChanged: (c, s, ids, picked) => setState(() {
              _class = c;
              _subject = s;
              _unitIds = ids;
              final planned = picked.fold<int>(
                0,
                (t, ch) => t + ch.plannedPeriods,
              );
              if (planned > 0) _periods = planned.clamp(1, 20);
            }),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Text("Periods · कालांश", style: AppText.bodySmallMuted),
              IconButton(
                onPressed: _periods > 1
                    ? () => setState(() => _periods -= 1)
                    : null,
                icon: const Icon(Icons.remove_circle_outline),
              ),
              Text("$_periods", style: AppText.bodyLargeInk),
              IconButton(
                onPressed: _periods < 20
                    ? () => setState(() => _periods += 1)
                    : null,
                icon: const Icon(Icons.add_circle_outline),
              ),
              const Spacer(),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: "en", label: Text("English")),
                  ButtonSegment(value: "hi", label: Text("हिंदी")),
                ],
                selected: {_language},
                onSelectionChanged: (v) => setState(() => _language = v.first),
              ),
            ],
          ),
          TextField(
            controller: _note,
            enabled: _call == null,
            maxLines: 2,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: "Note for the AI (optional) · निर्देश",
              hintText:
                  "e.g. include a group activity; class is weak in reading",
            ),
          ),
          const SizedBox(height: 16),
          if (_error != null) AiErrorCard(message: _error!),
          if (_call != null)
            AiWorking(
              message: "Writing the lesson plan…",
              onStop: () => _call?.cancel(),
            )
          else
            FilledButton.icon(
              onPressed: _class == null || _subject == null || _saving
                  ? null
                  : _write,
              icon: const Icon(Icons.auto_awesome),
              label: Text(
                d == null
                    ? "Draft with AI · AI से लिखें"
                    : "Draft again · फिर से लिखें",
              ),
            ),
          if (d != null && _call == null) ...[
            const SizedBox(height: 16),
            AiSuggestionBanner(
              detail: [
                if (d.booksKind == "chapters")
                  "Written on the school's own books for this class.",
                if (d.booksKind == "none")
                  "No book list was loaded for this class and subject — check chapter names.",
                if (d.agreedOutcomeUnits > 0)
                  "${d.agreedOutcomeUnits} chapter${d.agreedOutcomeUnits == 1 ? "" : "s"} on agreed learning outcomes.",
                "Edit anything, then Save.",
              ].join(" "),
            ),
            const SizedBox(height: 8),
            for (final f in _fields) ...[
              TextField(
                controller: f.$3,
                minLines: f.$4 > 1 ? 2 : 1,
                maxLines: f.$4,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(labelText: "${f.$1} · ${f.$2}"),
              ),
              const SizedBox(height: 8),
            ],
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: () => aiCopy(context, _asText, "Lesson plan"),
                  icon: const Icon(Icons.copy, size: 18),
                  label: const Text("Copy"),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    // One save per draft: the plan then lives on the
                    // Teaching desk / Period log, where it is edited.
                    onPressed: _saving || _savedId.isNotEmpty ? null : _save,
                    icon: Icon(
                      _savedId.isEmpty ? Icons.save_outlined : Icons.check,
                    ),
                    label: Text(
                      _saving
                          ? "Saving…"
                          : _savedId.isEmpty
                          ? "Save plan · सहेजें"
                          : "Saved · सहेजी गई",
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
