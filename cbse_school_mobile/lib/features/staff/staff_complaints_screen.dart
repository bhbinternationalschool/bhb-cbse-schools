import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// Parents' complaints this staff member should act on — everything for
/// leadership and the office, else the ones assigned to them or about a
/// child in their sections. Take up, mark in progress, resolve with a note.
class StaffComplaintsScreen extends StatefulWidget {
  const StaffComplaintsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<StaffComplaintsScreen> createState() => _StaffComplaintsScreenState();
}

class _StaffComplaintsScreenState extends State<StaffComplaintsScreen> {
  String _filter = "open";

  @override
  Widget build(BuildContext context) {
    return ModuleShell<StaffComplaintList>(
      key: ValueKey(_filter),
      title: "Complaints",
      subtitle: _filter == "open" ? "Open" : "Resolved",
      load: () => widget.api.fetchStaffComplaints(status: _filter),
      emptyIcon: Icons.sentiment_satisfied_alt_outlined,
      emptyText: _filter == "open"
          ? "No open complaint for your classes."
          : "Nothing resolved yet.",
      isEmpty: (l) => l.tickets.isEmpty,
      builder: (context, list, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 8,
            children: [
              for (final (k, label) in const [
                ("open", "Open"),
                ("resolved", "Resolved"),
              ])
                ChoiceChip(
                  label: Text(label),
                  selected: _filter == k,
                  onSelected: (_) => setState(() => _filter = k),
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (final t in list.tickets)
            _Card(
              api: widget.api,
              t: t,
              canClose: list.unrestricted,
              reload: reload,
            ),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({
    required this.api,
    required this.t,
    required this.canClose,
    required this.reload,
  });

  final ApiClient api;
  final StaffComplaint t;
  final bool canClose;
  final Future<void> Function() reload;

  Future<void> _update(
    BuildContext context, {
    String status = "",
    bool takeUp = false,
  }) async {
    var note = "";
    if (status == "resolved") {
      final ctl = TextEditingController();
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text("Resolve complaint"),
          content: TextField(
            controller: ctl,
            maxLines: 3,
            autofocus: true,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: "What was done",
              hintText: "The parent reads this in their app",
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text("Back"),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text("Resolve"),
            ),
          ],
        ),
      );
      if (ok != true) return;
      note = ctl.text.trim();
      if (note.isEmpty) return;
    }
    if (!context.mounted) return;
    try {
      await api.updateComplaint(
        id: t.id,
        status: status,
        resolutionNote: note,
        takeUp: takeUp,
      );
      Haptics.success();
      await reload();
    } on ApiException catch (e) {
      Haptics.warning();
      if (context.mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final tone = switch (t.status) {
      "resolved" || "closed" => ModuleTone.green,
      "in_progress" => ModuleTone.blue,
      "assigned" => ModuleTone.teal,
      _ => ModuleTone.amber,
    };
    final digits = t.raisedByMobile.replaceAll(RegExp(r"\D"), "");
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
                    t.subject,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: tone.background,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    t.statusLabel,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: tone.foreground,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              "${t.categoryLabel} · ${formatDateLabel(t.date)}${t.studentName.isNotEmpty ? " · ${t.studentName}${t.classLabel.isNotEmpty ? " (${t.classLabel})" : ""}" : ""}",
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 6),
            Text(
              t.description,
              style: const TextStyle(
                fontSize: 12.5,
                color: AppColors.ink,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              "From ${t.raisedByName.isEmpty ? "parent" : t.raisedByName} via ${t.sourceLabel}"
              "${t.assignedToName.isNotEmpty ? " · with ${t.assignedToMe ? "you" : t.assignedToName}" : ""}",
              style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
            ),
            if (t.resolutionNote.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  "Resolution: ${t.resolutionNote}",
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (digits.length >= 10)
                  IconButton(
                    tooltip: "Call parent",
                    onPressed: () => launchUrl(Uri.parse("tel:$digits")),
                    icon: const Icon(
                      Icons.call_outlined,
                      size: 20,
                      color: AppColors.primary,
                    ),
                  ),
                if (t.isOpen && !t.assignedToMe)
                  OutlinedButton(
                    onPressed: () => _update(context, takeUp: true),
                    child: const Text("Take up"),
                  ),
                if (t.isOpen && t.status != "in_progress")
                  OutlinedButton(
                    onPressed: () => _update(context, status: "in_progress"),
                    child: const Text("In progress"),
                  ),
                if (t.isOpen)
                  FilledButton(
                    onPressed: () => _update(context, status: "resolved"),
                    child: const Text("Resolve"),
                  ),
                if (t.status == "resolved" && canClose)
                  TextButton(
                    onPressed: () => _update(context, status: "closed"),
                    child: const Text("Close"),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
