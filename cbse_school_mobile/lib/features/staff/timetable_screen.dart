import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";

/// The staff member's week from the published timetable, one day per tab,
/// today selected. Substitutions this week — periods they cover, and their
/// own periods someone else covers — sit above the grid.
class TimetableScreen extends StatelessWidget {
  const TimetableScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<StaffTimetable>(
      title: "My timetable",
      load: api.fetchStaffTimetable,
      emptyIcon: Icons.calendar_view_week_outlined,
      emptyText:
          "No periods are assigned to you on the timetable yet. The office "
          "publishes it from Timetable on the desk.",
      isEmpty: (t) => t.periodCount == 0 && t.substitutions.isEmpty,
      builder: (context, t, _) => _Week(t: t),
    );
  }
}

class _Week extends StatefulWidget {
  const _Week({required this.t});

  final StaffTimetable t;

  @override
  State<_Week> createState() => _WeekState();
}

class _WeekState extends State<_Week> {
  late int _weekday = () {
    final days = widget.t.days;
    final today = widget.t.todayWeekday;
    return days.any((d) => d.weekday == today)
        ? today
        : (days.isEmpty ? 1 : days.first.weekday);
  }();

  @override
  Widget build(BuildContext context) {
    final t = widget.t;
    final day = t.days.where((d) => d.weekday == _weekday).firstOrNull;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        if (!t.published)
          const Padding(
            padding: EdgeInsets.only(bottom: 10),
            child: Text(
              "Working draft — the office has not published this timetable yet.",
              style: TextStyle(fontSize: 12, color: AppColors.warning),
            ),
          ),
        if (t.substitutions.isNotEmpty) ...[
          const Text(
            "This week's arrangements",
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 6),
          for (final s in t.substitutions)
            Card(
              color: s.role == "substitute"
                  ? ModuleTone.amber.background
                  : ModuleTone.gray.background,
              child: ListTile(
                dense: true,
                leading: Icon(
                  s.role == "substitute"
                      ? Icons.swap_horiz
                      : Icons.person_off_outlined,
                  color: s.role == "substitute"
                      ? ModuleTone.amber.foreground
                      : ModuleTone.gray.foreground,
                ),
                title: Text(
                  "${formatDateLabel(s.date)} · Period ${s.periodNo}${s.startTime.isEmpty ? "" : " · ${s.startTime}"}",
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                subtitle: Text(
                  s.role == "substitute"
                      ? "You cover ${s.className} ${s.sectionName} ${s.subjectName}${s.otherTeacherName.isEmpty ? "" : " for ${s.otherTeacherName}"}"
                      : "${s.className} ${s.sectionName} ${s.subjectName} — ${s.otherTeacherName.isEmpty ? "left free" : "covered by ${s.otherTeacherName}"}",
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            ),
          const SizedBox(height: 12),
        ],
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final d in t.days)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(
                      d.weekday == t.todayWeekday
                          ? "${d.short} · today"
                          : d.short,
                    ),
                    selected: d.weekday == _weekday,
                    onSelected: (_) => setState(() => _weekday = d.weekday),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        if (day == null || day.periods.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                "No periods this day.",
                style: TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
            ),
          )
        else
          for (final p in day.periods)
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  radius: 18,
                  backgroundColor: ModuleTone.blue.background,
                  child: Text(
                    "${p.periodNo}",
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: ModuleTone.blue.foreground,
                    ),
                  ),
                ),
                title: Text(
                  "${p.subjectName.isEmpty ? "Period" : p.subjectName} — ${p.className} ${p.sectionName}",
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                subtitle: Text(
                  p.startTime.isEmpty ? "" : "${p.startTime} – ${p.endTime}",
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            ),
        const SizedBox(height: 8),
        Text(
          "${t.periodCount} periods a week",
          style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
        ),
      ],
    );
  }
}
