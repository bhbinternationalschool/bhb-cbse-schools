import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "staff_leave_screen.dart";

/// The principal's staff-leave queue — approve or reject each request with
/// an optional note; the applicant is pushed the decision.
class LeaveApprovalsScreen extends StatefulWidget {
  const LeaveApprovalsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<LeaveApprovalsScreen> createState() => _LeaveApprovalsScreenState();
}

class _LeaveApprovalsScreenState extends State<LeaveApprovalsScreen> {
  String _filter = "pending";

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<StaffLeaveRequest>>(
      key: ValueKey(_filter),
      title: "Staff leave",
      subtitle: _filter == "pending" ? "Waiting for your decision" : "Decided",
      load: () => widget.api.fetchLeaveApprovals(status: _filter),
      emptyIcon: Icons.event_available_outlined,
      emptyText: _filter == "pending"
          ? "No staff leave is waiting. New requests from the app or the HR desk land here."
          : "Nothing decided yet.",
      isEmpty: (l) => l.isEmpty,
      builder: (context, list, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 8,
            children: [
              for (final (k, label) in const [
                ("pending", "Pending"),
                ("decided", "Decided"),
              ])
                ChoiceChip(
                  label: Text(label),
                  selected: _filter == k,
                  onSelected: (_) => setState(() => _filter = k),
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (final r in list) _Card(api: widget.api, r: r, reload: reload),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.api, required this.r, required this.reload});

  final ApiClient api;
  final StaffLeaveRequest r;
  final Future<void> Function() reload;

  Future<void> _decide(BuildContext context, bool approve) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(approve ? "Approve leave?" : "Reject leave?"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "${r.staffName} · ${r.typeCode} · ${r.fromDate == r.toDate ? formatDateLabel(r.fromDate) : "${formatDateLabel(r.fromDate)} – ${formatDateLabel(r.toDate)}"}",
              style: const TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: note,
              maxLines: 2,
              decoration: InputDecoration(
                labelText: approve ? "Note (optional)" : "Reason",
                hintText: approve
                    ? "e.g. arrange your classes"
                    : "Tell them why",
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text("Back"),
          ),
          FilledButton(
            style: approve
                ? null
                : FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: Text(approve ? "Approve" : "Reject"),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await api.decideStaffLeave(
        id: r.id,
        approve: approve,
        note: note.text.trim(),
      );
      Haptics.success();
      await reload();
    } on ApiException catch (e) {
      Haptics.warning();
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    r.staffName,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                LeaveStatusChip(status: r.status, label: r.statusLabel),
              ],
            ),
            if (r.designation.isNotEmpty)
              Text(
                r.designation,
                style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
              ),
            const SizedBox(height: 6),
            Text(
              "${r.typeName} (${r.typeCode}) · ${r.fromDate == r.toDate ? formatDateLabel(r.fromDate) : "${formatDateLabel(r.fromDate)} – ${formatDateLabel(r.toDate)}"}${r.halfDay ? " · half day" : ""} · ${r.days == r.days.roundToDouble() ? r.days.toInt() : r.days} day${r.days == 1 ? "" : "s"}",
              style: const TextStyle(fontSize: 12.5, color: AppColors.ink),
            ),
            if (r.remaining != null && !r.unlimited)
              Text(
                "${r.remaining! == r.remaining!.roundToDouble() ? r.remaining!.toInt() : r.remaining} ${r.typeCode} left after this",
                style: TextStyle(
                  fontSize: 12,
                  color: (r.remaining ?? 0) < r.days
                      ? AppColors.danger
                      : AppColors.muted,
                ),
              ),
            const SizedBox(height: 6),
            Text(
              r.reason,
              style: const TextStyle(
                fontSize: 12.5,
                color: AppColors.ink,
                height: 1.4,
              ),
            ),
            if (r.decisionNote.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  "${r.decidedBy}: ${r.decisionNote}",
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            if (r.isPending)
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => _decide(context, false),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.danger,
                    ),
                    child: const Text("Reject"),
                  ),
                  const SizedBox(width: 4),
                  FilledButton(
                    onPressed: () => _decide(context, true),
                    child: const Text("Approve"),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
