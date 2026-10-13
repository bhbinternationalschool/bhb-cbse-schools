import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "ai_lesson_plan_screen.dart";
import "ai_paper_screen.dart";
import "marks_screen.dart";
import "ptm_teacher_screen.dart";

/// "AI tools" — the web ERP's teacher AI helpers gathered on one screen
/// (13 Oct 2026). Each tool shows only when the person holds the screen it
/// helps with: answer-sheet marks, question paper and remedial worksheet sit
/// on marks entry (exams), the lesson plan on the period log (teaching), the
/// PTM brief on PTM meetings. The server checks the same grants again.
///
/// Every answer is a suggestion; nothing is saved without the teacher.
class TeacherAiToolsScreen extends StatelessWidget {
  const TeacherAiToolsScreen({
    super.key,
    required this.api,
    required this.features,
    this.classes,
  });

  final ApiClient api;
  final StaffFeatureSet features;

  /// The teacher's classes for the marks pickers; fetched when not given.
  final List<ClassRef>? classes;

  Future<void> _openMarks(BuildContext context) async {
    var list = classes;
    if (list == null) {
      try {
        list = (await api.fetchStaffSummary()).classes;
      } catch (_) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Could not reach the school server.")),
          );
        }
        return;
      }
    }
    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => MarksScreen(api: api, classes: list!, canScan: true),
      ),
    );
  }

  void _push(BuildContext context, Widget w) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => w));

  @override
  Widget build(BuildContext context) {
    final exams = features.has("marks_entry");
    final teaching = features.has("period_log");
    final ptm = features.has("ptm_meet");
    final tools = <(IconData, ModuleTone, String, String, VoidCallback)>[
      if (exams)
        (
          Icons.document_scanner_outlined,
          ModuleTone.amber,
          "Mark from answer sheet · उत्तर पुस्तिका से अंक",
          "Photograph a child's sheet; the AI suggests marks per question, you check them, the total goes into Marks.",
          () => _openMarks(context),
        ),
      if (exams)
        (
          Icons.quiz_outlined,
          ModuleTone.blue,
          "Question paper · प्रश्न-पत्र",
          "A draft paper from your chapters — copy it with or without answers.",
          () => _push(
            context,
            AiPaperScreen(api: api, mode: AiPaperMode.questionPaper),
          ),
        ),
      if (exams)
        (
          Icons.assignment_outlined,
          ModuleTone.green,
          "Remedial worksheet · अभ्यास पत्र",
          "Practice questions on what the class found hard, easy first.",
          () => _push(
            context,
            AiPaperScreen(api: api, mode: AiPaperMode.worksheet),
          ),
        ),
      if (teaching)
        (
          Icons.event_note_outlined,
          ModuleTone.purple,
          "Lesson plan · पाठ योजना",
          "A plan from the school's own books; edit it and save.",
          () => _push(context, AiLessonPlanScreen(api: api)),
        ),
      if (ptm)
        (
          Icons.groups_outlined,
          ModuleTone.pink,
          "PTM brief · PTM सार",
          "Open your PTM bookings and tap AI brief on a child before the parent arrives.",
          () => _push(context, PtmTeacherScreen(api: api, canBrief: true)),
        ),
    ];
    return Scaffold(
      appBar: AppBar(
        actions: const [
          ScreenGuideButton(guideId: "ai-tools", screenLabel: "ai-tools"),
        ],
        title: const Text("AI tools · AI सहायक", style: AppText.titleSmall),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            "Each tool writes a suggestion. Nothing is saved until you check it and press Save.\n"
            "हर सुझाव पहले आप जाँचें — Save दबाने पर ही सहेजा जाता है।",
            style: AppText.bodySmallMuted,
          ),
          const SizedBox(height: 12),
          if (tools.isEmpty)
            Text(
              "None of the AI tools is open to you — ask the office (Masters → Roles).",
              style: AppText.bodyMediumInk,
            ),
          for (final t in tools)
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: t.$2.background,
                  child: Icon(t.$1, color: t.$2.foreground),
                ),
                title: Text(
                  t.$3,
                  style: AppText.bodyMediumInk.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: Text(t.$4, style: AppText.bodySmallMuted),
                trailing: const Icon(
                  Icons.chevron_right,
                  color: AppColors.muted,
                ),
                onTap: t.$5,
              ),
            ),
        ],
      ),
    );
  }
}
