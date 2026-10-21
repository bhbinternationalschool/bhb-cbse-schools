import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../l10n/app_localizations.dart";
import "../modules/module_shell.dart";
import "principal_lists.dart";

/// One line for an activity, in the app's language.
String staffActivityLine(L l, StaffActivityItem i) => switch (i.kind) {
  "punch_in" => l.hcActPunchIn(i.firstAt),
  "punch_out" => l.hcActPunchOut(i.lastAt),
  "attendance_register" => l.hcActRegisters(i.count),
  "homework" => l.hcActHomework(i.count),
  "marks" => l.hcActMarks(i.qty),
  "co_scholastic" => l.hcActCoScholastic(i.count),
  "class_sheet" => l.hcActClassSheet(i.count),
  "student_records" => l.hcActStudentRecords(i.count),
  "fee_receipts" => l.hcActFees(formatInrPaise(i.qty), i.count),
  "receipt_edit" => l.hcActReceiptEdit(i.count),
  "leave_applied" => l.hcActLeaveApplied,
  "staff_leave_decided" => l.hcActStaffLeave(i.count),
  "student_leave_decided" => l.hcActStudentLeave(i.count),
  "profile" => l.hcActProfile,
  _ => i.kind,
};

IconData _icon(String kind) => switch (kind) {
  "punch_in" => Icons.login,
  "punch_out" => Icons.logout,
  "attendance_register" => Icons.fact_check_outlined,
  "homework" => Icons.menu_book_outlined,
  "marks" || "co_scholastic" => Icons.grading_outlined,
  "class_sheet" || "student_records" => Icons.groups_outlined,
  "fee_receipts" || "receipt_edit" => Icons.currency_rupee,
  "leave_applied" ||
  "staff_leave_decided" ||
  "student_leave_decided" => Icons.event_note_outlined,
  _ => Icons.circle_outlined,
};

/// Staff today: what each member of staff did today — punches, registers
/// marked, homework posted, marks entered, fees taken, leave decided
/// (request mr_mva0mcxt0c3h; the server's lib/staffActivityToday says where
/// each comes from). The attendance view this screen used to be stays one
/// tap away (app bar → Attendance) and behind the Present / Absent cards.
class StaffActivityTodayScreen extends StatelessWidget {
  const StaffActivityTodayScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return ModuleShell<StaffActivityToday>(
      guideId: "staff-today",
      title: l.hcStaffToday,
      load: api.fetchStaffActivityToday,
      emptyIcon: Icons.badge_outlined,
      emptyText: l.noActiveStaffOnTheRoster,
      isEmpty: (d) => d.staff.isEmpty,
      floatingActionButton: (context, d, _) => FloatingActionButton.extended(
        heroTag: "staff-today-attendance",
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.fact_check_outlined),
        label: Text(l.hcOpenAttendance),
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => StaffAttendanceTodayScreen(api: api),
          ),
        ),
      ),
      builder: (context, d, _) {
        final active = d.staff.where((s) => s.workCount > 0).length;
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
          children: [
            Text(
              "${formatDateLabel(d.date)} · ${l.hcActivitySummary(active, d.staff.length)}",
              style: AppText.bodySmallMuted,
            ),
            if (!d.auditKnown)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Card(
                  color: ModuleTone.amber.background,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      l.hcAuditNotLoaded,
                      style: AppText.bodySmall.copyWith(
                        color: ModuleTone.amber.foreground,
                      ),
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 10),
            for (final p in d.staff) _PersonCard(person: p),
          ],
        );
      },
    );
  }
}

class _PersonCard extends StatelessWidget {
  const _PersonCard({required this.person});

  final StaffActivityPerson person;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final p = person;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              p.fullName,
              style: AppText.bodyMediumInk.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            if (p.designation.isNotEmpty)
              Text(p.designation, style: AppText.labelMediumMuted),
            const SizedBox(height: 6),
            if (p.items.isEmpty)
              Text(l.hcNothingRecordedToday, style: AppText.bodySmallMuted)
            else
              for (final i in p.items)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(_icon(i.kind), size: 16, color: AppColors.primary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              staffActivityLine(l, i),
                              style: AppText.bodySmallInk,
                            ),
                            if (i.details.isNotEmpty)
                              Text(
                                i.details.join(" · "),
                                style: AppText.labelMediumMuted,
                              ),
                          ],
                        ),
                      ),
                      if (i.kind != "punch_in" &&
                          i.kind != "punch_out" &&
                          i.lastAt.isNotEmpty)
                        Text(
                          i.count > 1 ? l.hcActLastAt(i.lastAt) : i.lastAt,
                          style: AppText.labelMediumMuted,
                        ),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }
}
