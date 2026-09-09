import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "module_shell.dart";
import "online_class_qa_screen.dart";

/// The child's online classes: today's and the coming ones with a Join
/// button that only lights up inside the class window, and last week's for
/// the record. Join opens the room in the Meet / Zoom app and tells the
/// school the child went in.
class OnlineClassesScreen extends StatefulWidget {
  const OnlineClassesScreen({
    super.key,
    required this.api,
    required this.child,
    this.openQaSessionId,
  });

  final ApiClient api;
  final ParentChild child;

  /// From a "question from the teacher" notification: open that class's
  /// Q&A straight away.
  final String? openQaSessionId;

  @override
  State<OnlineClassesScreen> createState() => _OnlineClassesScreenState();
}

class _OnlineClassesScreenState extends State<OnlineClassesScreen> {
  ApiClient get api => widget.api;
  ParentChild get child => widget.child;
  bool _autoOpened = false;

  void _openQa(OnlineClassInfo c) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OnlineClassQaScreen(
          api: api,
          child: child,
          sessionId: c.id,
          title: c.title,
        ),
      ),
    );
  }

  Future<void> _join(
    BuildContext context,
    OnlineClassInfo c,
    Future<void> Function() reload,
  ) async {
    try {
      final url = await api.joinOnlineClass(sessionId: c.id, studentId: child.id);
      Haptics.success();
      final uri = Uri.tryParse(url);
      if (uri != null) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
      await reload();
    } on ApiException catch (e) {
      Haptics.warning();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<OnlineClassList>(
      title: "Online classes",
      subtitle: child.fullName,
      load: () => api.fetchOnlineClasses(child.id),
      emptyIcon: Icons.videocam_outlined,
      emptyText:
          "No online class is scheduled for ${child.fullName}'s section. You will get a notification when the teacher schedules one.",
      isEmpty: (d) => d.sessions.isEmpty,
      builder: (context, data, reload) {
        final wanted = widget.openQaSessionId;
        if (wanted != null && !_autoOpened) {
          final match = data.sessions.where((s) => s.id == wanted).firstOrNull;
          if (match != null) {
            _autoOpened = true;
            WidgetsBinding.instance.addPostFrameCallback((_) => _openQa(match));
          }
        }
        final upcoming = data.sessions.where((s) => !s.isOver && !s.isCancelled).toList();
        final past = data.sessions.where((s) => s.isOver || s.isCancelled).toList().reversed.toList();
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            if (upcoming.isNotEmpty) ...[
              Text("Coming up", style: AppText.labelMediumMuted),
              const SizedBox(height: 8),
              for (final c in upcoming) ...[
                _ClassCard(
                  c: c,
                  today: data.today,
                  onJoin: () => _join(context, c, reload),
                  onQa: c.phase == "upcoming" ? null : () => _openQa(c),
                ),
                const SizedBox(height: 10),
              ],
            ],
            if (past.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text("Earlier", style: AppText.labelMediumMuted),
              const SizedBox(height: 8),
              for (final c in past) ...[
                _ClassCard(c: c, today: data.today, onJoin: null, onQa: c.isCancelled ? null : () => _openQa(c)),
                const SizedBox(height: 10),
              ],
            ],
            const SizedBox(height: 8),
            Text(
              "The Join button works from 10 minutes before the class. It opens Google Meet or the app the teacher chose.",
              style: AppText.labelMediumMuted,
            ),
          ],
        );
      },
    );
  }
}

String _fmt12(String t) {
  final parts = t.split(":");
  if (parts.length != 2) return t;
  final h = int.tryParse(parts[0]) ?? 0;
  final m = parts[1];
  final ap = h >= 12 ? "PM" : "AM";
  final hh = h % 12 == 0 ? 12 : h % 12;
  return "$hh:$m $ap";
}

String _dayLabel(String date, String today) {
  if (date == today) return "Today";
  final d = DateTime.tryParse(date);
  final t = DateTime.tryParse(today);
  if (d != null && t != null && d.difference(t).inDays == 1) return "Tomorrow";
  return formatDateLabel(date);
}

class _ClassCard extends StatelessWidget {
  const _ClassCard({required this.c, required this.today, required this.onJoin, this.onQa});

  final OnlineClassInfo c;
  final String today;
  final VoidCallback? onJoin;
  final VoidCallback? onQa;

  @override
  Widget build(BuildContext context) {
    final live = c.isLive || c.phase == "joinable";
    final chipText = switch (c.phase) {
      "live" => "LIVE",
      "joinable" => "Starting",
      "cancelled" => "Cancelled",
      "over" => c.joined ? "Joined" : "Missed",
      _ => _dayLabel(c.date, today),
    };
    final chipColor = switch (c.phase) {
      "live" || "joinable" => AppColors.success,
      "cancelled" => AppColors.warning,
      "over" => c.joined ? AppColors.success : AppColors.muted,
      _ => AppColors.ink,
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(c.title, style: AppText.titleMedium)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: chipColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    chipText,
                    style: AppText.labelMediumMuted.copyWith(color: chipColor, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              "${_dayLabel(c.date, today)} · ${_fmt12(c.startTime)} – ${_fmt12(c.endTime)}"
              "${c.teacherName.isEmpty ? "" : " · ${c.teacherName}"}",
              style: AppText.bodyMedium,
            ),
            if (c.note.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(c.note, style: AppText.labelMediumMuted),
            ],
            if (onJoin != null && !c.isCancelled) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: c.canJoin ? onJoin : null,
                  icon: const Icon(Icons.videocam_outlined),
                  label: Text(
                    c.canJoin
                        ? (live ? "Join now" : "Join")
                        : "Opens at ${_fmt12(c.startTime)}",
                  ),
                ),
              ),
            ],
            if (onQa != null) ...[
              const SizedBox(height: 6),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: onQa,
                  icon: const Icon(Icons.quiz_outlined),
                  label: const Text("Teacher's questions & my answers"),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
