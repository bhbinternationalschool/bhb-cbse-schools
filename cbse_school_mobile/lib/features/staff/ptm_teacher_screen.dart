import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// The teacher's PTM day: their slots, who has booked each, and a one-tap
/// record of the meeting (met + note, or no-show). Parents see the note in
/// their own app; the exams desk pulls it into the report-card brief.
class PtmTeacherScreen extends StatelessWidget {
  const PtmTeacherScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<PtmTeacherEvent>>(
      title: "PTM",
      subtitle: "My slots and bookings",
      load: api.fetchTeacherPtm,
      emptyIcon: Icons.groups_outlined,
      emptyText:
          "No PTM slots are yours right now. The office schedules PTM days "
          "and slots from the PTM desk.",
      isEmpty: (e) => e.isEmpty,
      builder: (context, events, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final e in events) ...[
            Text(
              "${e.name} · ${formatDateLabel(e.date)}${e.modeLabel.isNotEmpty ? " · ${e.modeLabel}" : ""}",
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
            if (e.note.isNotEmpty)
              Text(
                e.note,
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            const SizedBox(height: 6),
            for (final s in e.slots)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "${formatTimeLabel(s.startAt)} – ${formatTimeLabel(s.endAt)}"
                        "${s.roomOrLink.isNotEmpty ? " · ${s.roomOrLink}" : ""}"
                        "${s.isMine ? "" : " · ${s.teacherName}"}",
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        "${s.bookings.length} of ${s.capacity} booked",
                        style: const TextStyle(
                          fontSize: 11.5,
                          color: AppColors.muted,
                        ),
                      ),
                      for (final b in s.bookings)
                        _Booking(api: api, b: b, reload: reload),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

class _Booking extends StatelessWidget {
  const _Booking({required this.api, required this.b, required this.reload});

  final ApiClient api;
  final PtmTeacherBooking b;
  final Future<void> Function() reload;

  Future<void> _met(BuildContext context) async {
    final strengths = TextEditingController();
    final areas = TextEditingController();
    final followUp = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          16,
          20,
          MediaQuery.viewInsetsOf(context).bottom + 20,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                "Met ${b.parentName.isEmpty ? "the parent" : b.parentName} · ${b.studentName}",
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                "A short note for the parent and the report card. All three are optional.",
                style: TextStyle(fontSize: 12, color: AppColors.muted),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: strengths,
                maxLines: 2,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: "Doing well"),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: areas,
                maxLines: 2,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: "Needs attention"),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: followUp,
                maxLines: 2,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: "Agreed follow-up",
                ),
              ),
              const SizedBox(height: 14),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text("Save"),
              ),
            ],
          ),
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await api.updatePtmBooking(
        bookingId: b.id,
        status: "completed",
        feedback: {
          "strengths": strengths.text.trim(),
          "areas": areas.text.trim(),
          "followUp": followUp.text.trim(),
        },
      );
      Haptics.success();
      await reload();
    } on ApiException catch (e) {
      if (context.mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _noShow(BuildContext context) async {
    try {
      await api.updatePtmBooking(bookingId: b.id, status: "no_show");
      Haptics.tap();
      await reload();
    } on ApiException catch (e) {
      if (context.mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final digits = b.mobile.replaceAll(RegExp(r"\D"), "");
    final fb = b.feedback;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  "${b.studentName}${b.classLabel.isNotEmpty ? " · ${b.classLabel}" : ""}",
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (b.status == "completed")
                const Icon(
                  Icons.check_circle,
                  size: 18,
                  color: AppColors.success,
                )
              else if (b.status == "no_show")
                const Icon(
                  Icons.person_off_outlined,
                  size: 18,
                  color: AppColors.danger,
                ),
            ],
          ),
          Text(
            "${b.parentName.isEmpty ? "Parent" : b.parentName}${digits.length >= 10 ? " · $digits" : ""}",
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          if (fb != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                [
                  if ((fb["strengths"] as String?)?.isNotEmpty == true)
                    "Well: ${fb["strengths"]}",
                  if ((fb["areas"] as String?)?.isNotEmpty == true)
                    "Attention: ${fb["areas"]}",
                  if ((fb["followUp"] as String?)?.isNotEmpty == true)
                    "Follow-up: ${fb["followUp"]}",
                ].join("\n"),
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.ink,
                  height: 1.4,
                ),
              ),
            ),
          Wrap(
            spacing: 4,
            alignment: WrapAlignment.end,
            children: [
              if (digits.length >= 10)
                IconButton(
                  tooltip: "Call",
                  onPressed: () => launchUrl(Uri.parse("tel:$digits")),
                  icon: const Icon(
                    Icons.call_outlined,
                    size: 20,
                    color: AppColors.primary,
                  ),
                ),
              if (b.status == "booked") ...[
                TextButton(
                  onPressed: () => _noShow(context),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.danger,
                  ),
                  child: const Text("Did not come"),
                ),
                FilledButton.tonal(
                  onPressed: () => _met(context),
                  child: const Text("Met · add note"),
                ),
              ] else if (b.status == "completed" && fb == null)
                TextButton(
                  onPressed: () => _met(context),
                  child: const Text("Add note"),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
