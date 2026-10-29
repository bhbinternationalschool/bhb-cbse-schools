import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// "My pending work" — the signed-in member of staff's own work today, from
/// /api/v1/staff/pending-work: the same computation as the reminders the
/// school sends (punch-in, class registers, homework, exam marks, approvals
/// waiting). One row per kind of work; a tap opens it through the home's
/// own deep-link switch ([onOpen] gets the route, e.g. "/attendance").
///
/// Hidden when nothing is pending and everything could be checked. A part
/// that could not be checked is said so ("Could not check: …"), never left
/// out as if nothing were due.
class PendingWorkCard extends StatefulWidget {
  const PendingWorkCard({
    super.key,
    required this.api,
    required this.onOpen,
    this.refreshKey = 0,
  });

  final ApiClient api;
  final void Function(String route) onOpen;

  /// Bump to reload (pull-to-refresh, a screen closed after a change).
  final int refreshKey;

  @override
  State<PendingWorkCard> createState() => _PendingWorkCardState();
}

class _PendingWorkCardState extends State<PendingWorkCard> {
  StaffPendingWork? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PendingWorkCard old) {
    super.didUpdateWidget(old);
    if (old.refreshKey != widget.refreshKey) _load();
  }

  Future<void> _load() async {
    try {
      final d = await widget.api.fetchPendingWork();
      if (mounted) setState(() => _data = d);
    } catch (_) {
      /* stays as it was (hidden on first load) — the home must not break */
    }
  }

  static IconData _icon(String rule) => switch (rule) {
    "punch" => Icons.fingerprint,
    "register" => Icons.how_to_reg_outlined,
    "homework" => Icons.menu_book_outlined,
    "marks" => Icons.grading_outlined,
    _ => Icons.inbox_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null || (d.items.isEmpty && d.unknown.isEmpty)) {
      return const SizedBox.shrink();
    }
    final tone = ModuleTone.coral;
    return Card(
      key: const Key("pending-work-card"),
      color: tone.background,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "My pending work",
              style: AppText.bodyMedium.copyWith(
                color: tone.foreground,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            for (final i in d.items)
              Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
                child: InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: i.link.isEmpty ? null : () => widget.onOpen(i.link),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
                    child: Row(
                      children: [
                        Icon(_icon(i.rule), size: 20, color: tone.foreground),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                i.title,
                                style: AppText.bodyMediumInk.copyWith(
                                  fontWeight: FontWeight.w600,
                                  color: i.overdue
                                      ? const Color(0xFFB3261E)
                                      : null,
                                ),
                              ),
                              if (i.rule != "punch" && i.lines.isNotEmpty)
                                Text(
                                  i.lines.take(3).join(" · ") +
                                      (i.lines.length > 3
                                          ? " · +${i.lines.length - 3} more"
                                          : ""),
                                  style: AppText.bodySmallMuted,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                            ],
                          ),
                        ),
                        const Icon(Icons.chevron_right, size: 20),
                      ],
                    ),
                  ),
                ),
              ).withGap(),
            if (d.unknown.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  "Could not check: ${d.unknown.join(", ")} — pull down to try again.",
                  style: AppText.bodySmallMuted,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

extension on Widget {
  Widget withGap() =>
      Padding(padding: const EdgeInsets.only(bottom: 6), child: this);
}
