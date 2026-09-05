import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";
import "student_note_sheet.dart";

/// Read-only section roster for teachers — names, rolls, and today's
/// attendance status when the register is marked.
class StudentsScreen extends StatelessWidget {
  const StudentsScreen({
    super.key,
    required this.api,
    required this.classId,
    required this.sectionId,
    required this.date,
    required this.title,
  });

  final ApiClient api;
  final String classId;
  final String sectionId;
  final String date;
  final String title;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<AttendanceRoster>(
      title: "Students · $title",
      load: () => api.fetchAttendanceRoster(
        classId: classId,
        sectionId: sectionId,
        date: date,
      ),
      emptyIcon: Icons.school_outlined,
      emptyText: "No active students in this section.",
      isEmpty: (roster) => roster.students.isEmpty,
      builder: (context, roster, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            "${roster.students.length} students · attendance ${roster.attendanceMarked ? "marked" : "not marked"} today · tap a student for a merit, discipline or sick-room note",
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 10),
          for (final s in roster.students)
            Card(
              child: ListTile(
                dense: true,
                onTap: () => showStudentNoteSheet(
                  context,
                  api: api,
                  student: s,
                  classLabel: title,
                ),
                leading: CircleAvatar(
                  radius: 17,
                  backgroundColor: ModuleTone.teal.background,
                  child: Text(
                    s.rollNo.isEmpty ? "–" : s.rollNo,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: ModuleTone.teal.foreground,
                    ),
                  ),
                ),
                title: Text(
                  s.fullName,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                trailing: s.status == null
                    ? null
                    : Text(
                        s.status!,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: switch (s.status) {
                            "P" => AppColors.success,
                            "A" => AppColors.danger,
                            _ => AppColors.warning,
                          },
                        ),
                      ),
              ),
            ),
        ],
      ),
    );
  }
}
