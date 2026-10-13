import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

/// Upcoming papers for one child's class, from the date sheets the school
/// published to parents (Exams → Date-sheet → "Show to parents").
class ExamDateSheetScreen extends StatelessWidget {
  const ExamDateSheetScreen({
    super.key,
    required this.api,
    required this.child,
  });

  final ApiClient api;
  final ParentChild child;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<ParentDateSheet>(
      guideId: "datesheet-parent",
      title: context.l10n.dateSheetTitle,
      subtitle: child.fullName,
      load: api.fetchParentDateSheet,
      emptyIcon: Icons.event_note_outlined,
      emptyText: context.l10n.dateSheetNone,
      isEmpty: (d) => d.examsFor(child.id).isEmpty,
      builder: (context, sheet, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final exam in sheet.examsFor(child.id)) ...[
            Text(exam.termLabel, style: AppText.titleSmallInk),
            const SizedBox(height: 8),
            Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 4,
                ),
                child: Column(
                  children: [
                    for (final p in exam.papers)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: 96,
                              child: Text(
                                formatDateLabel(p.date),
                                style: AppText.labelLargeInk,
                              ),
                            ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    p.subjectName,
                                    style: AppText.bodyLargeInk,
                                  ),
                                  Text(
                                    [
                                      if (p.startTime.isNotEmpty) p.startTime,
                                      if (p.durationMinutes > 0)
                                        context.l10n.dateSheetMinutes(
                                          "${p.durationMinutes}",
                                        ),
                                      if (p.note.isNotEmpty) p.note,
                                    ].join(" · "),
                                    style: AppText.bodySmallMuted,
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
        ],
      ),
    );
  }
}
