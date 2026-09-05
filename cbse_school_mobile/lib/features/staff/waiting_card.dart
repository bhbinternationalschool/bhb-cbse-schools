import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// "Waiting for you" — the counts from /api/v1/staff/approvals as tappable
/// chips. Shown on every staff home; hidden entirely when nothing waits so
/// a quiet day stays quiet.
class WaitingCard extends StatefulWidget {
  const WaitingCard({
    super.key,
    required this.api,
    required this.onOpen,
    this.refreshKey = 0,
  });

  final ApiClient api;

  /// staff_leave | student_leave | complaints | documents
  final void Function(String kind) onOpen;

  /// Bump to reload (after a decision elsewhere).
  final int refreshKey;

  @override
  State<WaitingCard> createState() => _WaitingCardState();
}

class _WaitingCardState extends State<WaitingCard> {
  StaffApprovals? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant WaitingCard old) {
    super.didUpdateWidget(old);
    if (old.refreshKey != widget.refreshKey) _load();
  }

  Future<void> _load() async {
    try {
      final d = await widget.api.fetchApprovals();
      if (mounted) setState(() => _data = d);
    } catch (_) {
      /* the card just stays hidden */
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null || d.total == 0) return const SizedBox.shrink();
    final chips = <(String, int, IconData, String)>[
      if (d.staffLeavePending > 0)
        (
          "Staff leave",
          d.staffLeavePending,
          Icons.event_busy_outlined,
          "staff_leave",
        ),
      if (d.studentLeavePending > 0)
        (
          "Leave requests",
          d.studentLeavePending,
          Icons.event_outlined,
          "student_leave",
        ),
      if (d.complaintsOpen > 0)
        (
          "Complaints",
          d.complaintsOpen,
          Icons.report_problem_outlined,
          "complaints",
        ),
      if (d.documentsPending > 0)
        (
          "Documents",
          d.documentsPending,
          Icons.folder_open_outlined,
          "documents",
        ),
    ];
    return Card(
      color: ModuleTone.amber.background,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Waiting for you · ${d.total}",
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: ModuleTone.amber.foreground,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                for (final (label, n, icon, kind) in chips)
                  ActionChip(
                    avatar: Icon(
                      icon,
                      size: 16,
                      color: ModuleTone.amber.foreground,
                    ),
                    label: Text("$label · $n"),
                    labelStyle: const TextStyle(
                      fontSize: 12,
                      color: AppColors.ink,
                    ),
                    backgroundColor: Colors.white,
                    side: BorderSide.none,
                    onPressed: () => widget.onOpen(kind),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
