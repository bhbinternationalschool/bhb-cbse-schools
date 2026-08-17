import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "dictate_field.dart";

/// Write a lesson plan on the phone, dictating the long fields.
///
/// Reached from a period in the period log, so the class and subject are
/// already known — the teacher only supplies the teaching content.
class LessonPlanEditorScreen extends StatefulWidget {
  const LessonPlanEditorScreen({
    super.key,
    required this.api,
    required this.period,
  });

  final ApiClient api;
  final TeachingPeriod period;

  @override
  State<LessonPlanEditorScreen> createState() =>
      _LessonPlanEditorScreenState();
}

class _LessonPlanEditorScreenState extends State<LessonPlanEditorScreen> {
  final _title = TextEditingController();
  final _objectives = TextEditingController();
  final _aids = TextEditingController();
  final _activities = TextEditingController();
  final _assessment = TextEditingController();
  final _homework = TextEditingController();

  final Set<String> _unitIds = {};
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Start from whatever the period is already tagged with, so the plan
    // lines up with what is being taught.
    _unitIds.addAll(widget.period.unitIds);
  }

  @override
  void dispose() {
    _title.dispose();
    _objectives.dispose();
    _aids.dispose();
    _activities.dispose();
    _assessment.dispose();
    _homework.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty) {
      setState(() => _error = "Give the lesson a title");
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final id = await widget.api.saveLessonPlan(
        classId: widget.period.classId,
        subjectId: widget.period.subjectId,
        title: _title.text.trim(),
        unitIds: _unitIds.toList(),
        objectives: _objectives.text.trim(),
        teachingAids: _aids.text.trim(),
        activities: _activities.text.trim(),
        assessment: _assessment.text.trim(),
        homework: _homework.text.trim(),
      );
      if (!mounted) return;
      Navigator.pop(context, id);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.period;
    return Scaffold(
      appBar: AppBar(
        title: const Text("New lesson plan", style: TextStyle(fontSize: 16)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            "${p.subjectName} · ${p.classLabel}",
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            "Tap Speak on any box to dictate instead of typing.",
            style: TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _title,
            style: const TextStyle(fontSize: 13),
            decoration: const InputDecoration(
              labelText: "Lesson title",
              border: OutlineInputBorder(),
              isDense: true,
            ),
          ),
          const SizedBox(height: 14),
          if (p.chapters.isNotEmpty) ...[
            const Text(
              "COVERS",
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.6,
                color: AppColors.muted,
              ),
            ),
            for (final chapter in p.chapters) ...[
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _unitIds.contains(chapter.id),
                title: Text(chapter.label,
                    style: const TextStyle(fontSize: 12.5)),
                onChanged: (v) => setState(() {
                  if (v == true) {
                    _unitIds.add(chapter.id);
                  } else {
                    _unitIds.remove(chapter.id);
                  }
                }),
              ),
              for (final topic in chapter.topics)
                Padding(
                  padding: const EdgeInsets.only(left: 20),
                  child: CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    value: _unitIds.contains(topic.id),
                    title: Text(
                      topic.title,
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.muted),
                    ),
                    onChanged: (v) => setState(() {
                      if (v == true) {
                        _unitIds.add(topic.id);
                      } else {
                        _unitIds.remove(topic.id);
                      }
                    }),
                  ),
                ),
            ],
            const SizedBox(height: 10),
          ],
          DictateField(
            label: "Objectives",
            controller: _objectives,
            hint: "By the end of this lesson, learners can…",
          ),
          DictateField(
            label: "Teaching aids",
            controller: _aids,
            hint: "Smart board, charts, lab kit…",
          ),
          DictateField(
            label: "Activities",
            controller: _activities,
            hint: "Recap 5 min · demo 15 min · group work…",
          ),
          DictateField(
            label: "Assessment",
            controller: _assessment,
            hint: "Oral check, exit ticket, worksheet…",
          ),
          DictateField(label: "Homework", controller: _homework),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                _error!,
                style: const TextStyle(
                    fontSize: 12.5, color: AppColors.danger),
              ),
            ),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: Text(_busy ? "Saving…" : "Save lesson plan"),
          ),
        ],
      ),
    );
  }
}
