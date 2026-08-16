import "package:flutter/material.dart";
import "package:geolocator/geolocator.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "lesson_plan_editor_screen.dart";
import "module_shell.dart";

/// Sentinel returned by the plan picker to mean "write a new one".
const _newPlanSentinel = "__new__";

/// Best-effort GPS fix taken as a period is logged, so the school can tell
/// a period logged in the corridor from one logged at home.
///
/// Every failure path returns null and the log goes through regardless.
/// Blocking the log on a satellite would teach the whole staff room that
/// logging is unreliable, and an unlogged period is a far worse outcome
/// than an unverified one.
Future<Position?> _bestEffortFix() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return null;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return null;
    }
    return await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.medium,
        // A period log is not worth making a teacher wait; if the fix is
        // not ready in a few seconds it is simply not recorded.
        timeLimit: Duration(seconds: 6),
      ),
    );
  } catch (_) {
    return null;
  }
}

/// Teacher period log — today's periods with a Taught / Not taught tap,
/// the chapter/topic covered, the lesson plan, and the e-book links.
///
/// The one rule this screen must not break: a period with no log yet is
/// shown as "Not logged" or "Not due yet", never as a period that was
/// missed. Only the teacher's own tap can say that.
class TeachingScreen extends StatelessWidget {
  const TeachingScreen({super.key, required this.api});

  final ApiClient api;

  Future<void> _log(
    BuildContext context,
    TeachingDay day,
    TeachingPeriod period,
    String status,
    Future<void> Function() reload, {
    List<String>? unitIds,
    String? lessonPlanId,
  }) async {
    try {
      // Only worth a fix when the teacher says the period happened; a
      // "not taught" log makes no claim about where anyone was standing.
      final fix = status == "not_delivered" ? null : await _bestEffortFix();
      final result = await api.logTeachingPeriod(
        date: day.date,
        periodNo: period.periodNo,
        classId: period.classId,
        sectionId: period.sectionId,
        status: status,
        unitIds: unitIds ?? period.unitIds,
        lessonPlanId: lessonPlanId ?? period.lessonPlanId,
        lat: fix?.latitude,
        lng: fix?.longitude,
        accuracyM: fix?.accuracy,
      );
      await reload();
      if (context.mounted) {
        // Only "off campus" is worth saying out loud, and even then as a
        // heads-up that the office will see it — not an accusation.
        final flagged = result.locationCheck == "off_campus";
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              status == "not_delivered"
                  ? "Recorded — period not taught"
                  : flagged
                      ? "Recorded — ${period.label} taught. Logged away from campus, so the office will see a location note."
                      : "Recorded — ${period.label} taught",
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  /// Chapter-grouped topic picker. Tapping a chapter with no topics tags
  /// the chapter itself.
  Future<void> _pickTopic(
    BuildContext context,
    TeachingDay day,
    TeachingPeriod period,
    Future<void> Function() reload,
  ) async {
    if (period.chapters.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text("No syllabus plan set for this subject yet."),
        ),
      );
      return;
    }
    final picked = await showModalBottomSheet<TeachingUnit>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(
                "What did you cover?",
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
            ),
            for (final chapter in period.chapters) ...[
              ListTile(
                dense: true,
                title: Text(
                  chapter.label,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                trailing: period.unitIds.contains(chapter.id)
                    ? const Icon(Icons.check, color: AppColors.success)
                    : null,
                onTap: () => Navigator.pop(context, chapter),
              ),
              for (final topic in chapter.topics)
                Padding(
                  padding: const EdgeInsets.only(left: 24),
                  child: ListTile(
                    dense: true,
                    title: Text(
                      topic.title,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.muted,
                      ),
                    ),
                    trailing: period.unitIds.contains(topic.id)
                        ? const Icon(Icons.check, color: AppColors.success)
                        : null,
                    onTap: () => Navigator.pop(context, topic),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
    if (picked == null) return;
    if (!context.mounted) return;
    await _log(
      context,
      day,
      period,
      period.status == "not_delivered" ? "delivered" : period.status,
      reload,
      unitIds: [picked.id],
    );
  }

  Future<void> _pickLessonPlan(
    BuildContext context,
    TeachingDay day,
    TeachingPeriod period,
    Future<void> Function() reload,
  ) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(
                "Which lesson plan?",
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
            ),
            if (period.lessonPlans.isEmpty)
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Text(
                  "No lesson plans for this subject yet.",
                  style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                ),
              ),
            for (final plan in period.lessonPlans)
              ListTile(
                dense: true,
                title: Text(plan.title,
                    style: const TextStyle(fontSize: 13, color: AppColors.ink)),
                subtitle: plan.objectives.isEmpty
                    ? null
                    : Text(
                        plan.objectives,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11.5, color: AppColors.muted),
                      ),
                trailing: period.lessonPlanId == plan.id
                    ? const Icon(Icons.check, color: AppColors.success)
                    : null,
                onTap: () => Navigator.pop(context, plan.id),
              ),
            const Divider(height: 1),
            ListTile(
              dense: true,
              leading: const Icon(Icons.add, size: 20, color: AppColors.info),
              title: const Text(
                "Write a new lesson plan",
                style: TextStyle(fontSize: 13, color: AppColors.info),
              ),
              onTap: () => Navigator.pop(context, _newPlanSentinel),
            ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    if (!context.mounted) return;

    var planId = picked;
    if (picked == _newPlanSentinel) {
      final created = await Navigator.of(context).push<String>(
        MaterialPageRoute(
          builder: (_) => LessonPlanEditorScreen(api: api, period: period),
        ),
      );
      if (created == null || created.isEmpty) return;
      planId = created;
    }
    if (!context.mounted) return;

    await _log(
      context,
      day,
      period,
      period.status == "not_delivered" ? "delivered" : period.status,
      reload,
      lessonPlanId: planId,
    );
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<TeachingDay>(
      title: "Period log",
      subtitle: "Today's teaching",
      load: () => api.fetchTeachingDay(),
      emptyIcon: Icons.menu_book_outlined,
      emptyText: "No periods on your timetable today.",
      // A day the school could not resolve is NOT empty — it needs its
      // own explanation, handled in the builder below.
      isEmpty: (day) => day.scheduleAvailable && day.periods.isEmpty,
      builder: (context, day, reload) {
        if (!day.scheduleAvailable) {
          return _ScheduleUnavailable(day: day);
        }
        final logged = day.periods.where((p) => p.isLogged).length;
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: ModuleTone.teal.background,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  const Icon(Icons.fact_check_outlined,
                      size: 20, color: AppColors.success),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      "$logged of ${day.periods.length} periods logged",
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            for (final period in day.periods) ...[
              _PeriodCard(
                period: period,
                onTaught: () => _log(context, day, period, "delivered", reload),
                onNotTaught: () =>
                    _log(context, day, period, "not_delivered", reload),
                onPickTopic: () => _pickTopic(context, day, period, reload),
                onPickPlan: () => _pickLessonPlan(context, day, period, reload),
              ),
              const SizedBox(height: 8),
            ],
          ],
        );
      },
    );
  }
}

class _ScheduleUnavailable extends StatelessWidget {
  const _ScheduleUnavailable({required this.day});

  final TeachingDay day;

  String get _message {
    switch (day.reason) {
      case "no_published_timetable":
        return "The school has not published a timetable for this year yet, so there are no periods to log. Ask the office to publish it.";
      case "non_working_weekday":
        return "Not a working day on the school calendar.";
      case "holiday":
        return "Holiday — no periods scheduled.";
      default:
        return day.detail.isEmpty
            ? "Your schedule for today could not be worked out."
            : day.detail;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 40),
        Icon(
          day.reason == "no_published_timetable"
              ? Icons.event_busy_outlined
              : Icons.beach_access_outlined,
          size: 48,
          color: AppColors.muted,
        ),
        const SizedBox(height: 14),
        const Text(
          "Nothing to log",
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          _message,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
        ),
      ],
    );
  }
}

IconData _resourceIcon(String kind) {
  switch (kind) {
    case "ebook":
      return Icons.menu_book_outlined;
    case "pdf":
      return Icons.picture_as_pdf_outlined;
    case "video":
      return Icons.play_circle_outline;
    default:
      return Icons.link;
  }
}

/// Opens a content link in the device browser / e-book app.
Future<void> _openResource(
  BuildContext context,
  TeachingResource resource,
) async {
  final uri = Uri.tryParse(resource.url);
  // The server only ever stores http(s), but a malformed row must fail
  // visibly here rather than silently doing nothing on tap.
  if (uri == null || !(uri.isScheme("http") || uri.isScheme("https"))) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text("That link is not a valid web address.")),
    );
    return;
  }
  final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text("Could not open ${resource.title}")),
    );
  }
}

class _PeriodCard extends StatelessWidget {
  const _PeriodCard({
    required this.period,
    required this.onTaught,
    required this.onNotTaught,
    required this.onPickTopic,
    required this.onPickPlan,
  });

  final TeachingPeriod period;
  final VoidCallback onTaught;
  final VoidCallback onNotTaught;
  final VoidCallback onPickTopic;
  final VoidCallback onPickPlan;

  ({String label, Color color, Color background}) get _status {
    switch (period.status) {
      case "delivered":
        return (
          label: "Taught",
          color: AppColors.success,
          background: ModuleTone.teal.background
        );
      case "substituted":
        return (
          label: "Taught (substitute)",
          color: AppColors.info,
          background: ModuleTone.blue.background
        );
      case "not_delivered":
        return (
          label: "Not taught",
          color: AppColors.danger,
          background: ModuleTone.coral.background
        );
      case "unlogged":
        return (
          label: "Not logged",
          color: AppColors.warning,
          background: ModuleTone.amber.background
        );
      default:
        return (
          label: "Not due yet",
          color: AppColors.muted,
          background: ModuleTone.gray.background
        );
    }
  }

  /// Titles of the chapters/topics this period is tagged with, looked up
  /// across the chapter tree.
  String get _topicLabel {
    final names = <String>[];
    for (final chapter in period.chapters) {
      if (period.unitIds.contains(chapter.id)) names.add(chapter.label);
      for (final topic in chapter.topics) {
        if (period.unitIds.contains(topic.id)) names.add(topic.title);
      }
    }
    return names.join(", ");
  }

  String get _planTitle {
    for (final plan in period.lessonPlans) {
      if (plan.id == period.lessonPlanId) return plan.title;
    }
    return "";
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    final topic = _topicLabel;
    final plan = _planTitle;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "${period.label} · ${period.classLabel}",
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        "${period.subjectName} · ${period.startTime}–${period.endTime}"
                        "${period.isSubstituted ? " · substitution" : ""}",
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: status.background,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    status.label,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: status.color,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: onTaught,
                    icon: const Icon(Icons.check, size: 17),
                    label: Text(
                      period.status == "delivered" ||
                              period.status == "substituted"
                          ? "Taught"
                          : "Mark taught",
                      style: const TextStyle(fontSize: 12.5),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onNotTaught,
                    icon: const Icon(Icons.close, size: 17),
                    label: const Text(
                      "Not taught",
                      style: TextStyle(fontSize: 12.5),
                    ),
                  ),
                ),
              ],
            ),
            if (period.isLogged) ...[
              const SizedBox(height: 6),
              _PickRow(
                icon: Icons.bookmark_border,
                label: topic.isEmpty ? "Add chapter / topic covered" : topic,
                muted: topic.isEmpty,
                onTap: onPickTopic,
              ),
              _PickRow(
                icon: Icons.assignment_outlined,
                label: plan.isEmpty ? "Link a lesson plan" : plan,
                muted: plan.isEmpty,
                onTap: onPickPlan,
              ),
            ],
            if (period.resources.isNotEmpty) ...[
              const SizedBox(height: 8),
              const Divider(height: 1),
              const SizedBox(height: 8),
              const Text(
                "CONTENT",
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.6,
                  color: AppColors.muted,
                ),
              ),
              const SizedBox(height: 4),
              for (final r in period.resources)
                InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => _openResource(context, r),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        Icon(_resourceIcon(r.kind),
                            size: 17, color: AppColors.info),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            r.locator.isEmpty
                                ? r.title
                                : "${r.title} · ${r.locator}",
                            style: const TextStyle(
                              fontSize: 12.5,
                              color: AppColors.info,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                        const Icon(Icons.open_in_new,
                            size: 15, color: AppColors.muted),
                      ],
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PickRow extends StatelessWidget {
  const _PickRow({
    required this.icon,
    required this.label,
    required this.muted,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool muted;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Icon(icon, size: 17, color: AppColors.muted),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 12.5,
                  color: muted ? AppColors.muted : AppColors.ink,
                ),
              ),
            ),
            const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}
