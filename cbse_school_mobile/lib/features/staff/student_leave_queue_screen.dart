import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "staff_leave_screen.dart";

/// Parents' leave requests for the teacher's sections (every section for
/// leadership). A class teacher decides short leave; over 3 days, medical or
/// long leave waits for the principal — the card says which.
class StudentLeaveQueueScreen extends StatefulWidget {
  const StudentLeaveQueueScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<StudentLeaveQueueScreen> createState() =>
      _StudentLeaveQueueScreenState();
}

class _StudentLeaveQueueScreenState extends State<StudentLeaveQueueScreen> {
  String _filter = "pending";

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<StudentLeaveQueueItem>>(
      key: ValueKey(_filter),
      title: "Leave requests",
      subtitle: _filter == "pending" ? "From parents, waiting" : "Decided",
      load: () => widget.api.fetchStudentLeaveQueue(status: _filter),
      emptyIcon: Icons.event_available_outlined,
      emptyText: _filter == "pending"
          ? "No leave request is waiting for your classes."
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
  final StudentLeaveQueueItem r;
  final Future<void> Function() reload;

  Future<void> _decide(BuildContext context, bool approve) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(approve ? "Approve leave?" : "Decline leave?"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "${r.studentName} · ${r.leaveTypeLabel} · ${r.fromDate == r.toDate ? formatDateLabel(r.fromDate) : "${formatDateLabel(r.fromDate)} – ${formatDateLabel(r.toDate)}"}",
              style: const TextStyle(fontSize: 13),
            ),
            if (approve)
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text(
                  "The attendance register will show leave for these days.",
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            const SizedBox(height: 10),
            TextField(
              controller: note,
              maxLines: 2,
              decoration: InputDecoration(
                labelText: approve
                    ? "Note to parent (optional)"
                    : "Reason for the parent",
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
            child: Text(approve ? "Approve" : "Decline"),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await api.decideStudentLeave(
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
                    "${r.studentName} · ${r.classLabel}",
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                LeaveStatusChip(status: r.status),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              "${r.leaveTypeLabel} · ${r.fromDate == r.toDate ? formatDateLabel(r.fromDate) : "${formatDateLabel(r.fromDate)} – ${formatDateLabel(r.toDate)}"} · ${r.days} day${r.days == 1 ? "" : "s"}",
              style: const TextStyle(fontSize: 12.5, color: AppColors.ink),
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
            const SizedBox(height: 4),
            Text(
              "Asked by ${r.requestedBy.isEmpty ? "parent" : r.requestedBy}${r.status == "pending" ? " · decides: ${r.approverHint}" : ""}",
              style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
            ),
            if (r.decisionNote.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  "${r.decidedBy}: ${r.decisionNote}",
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            if (r.status == "pending")
              r.canDecide
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: () => _decide(context, false),
                          style: TextButton.styleFrom(
                            foregroundColor: AppColors.danger,
                          ),
                          child: const Text("Decline"),
                        ),
                        const SizedBox(width: 4),
                        FilledButton(
                          onPressed: () => _decide(context, true),
                          child: const Text("Approve"),
                        ),
                      ],
                    )
                  : const Padding(
                      padding: EdgeInsets.only(top: 6),
                      child: Text(
                        "Waiting for the principal.",
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.warning,
                        ),
                      ),
                    ),
          ],
        ),
      ),
    );
  }
}
