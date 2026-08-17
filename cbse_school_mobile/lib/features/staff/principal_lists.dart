import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";
import "attendance_screen.dart";

/* ─── Shared bits ────────────────────────────────────────────────── */

Future<void> _call(BuildContext context, String mobile) async {
  final m = mobile.replaceAll(RegExp(r"\D"), "");
  if (m.isEmpty) return;
  final ok = await launchUrl(Uri.parse("tel:$m"));
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text("Could not open the dialer.")),
    );
  }
}

Future<void> _whatsapp(BuildContext context, String mobile,
    {String text = ""}) async {
  var m = mobile.replaceAll(RegExp(r"\D"), "");
  if (m.isEmpty) return;
  if (m.length == 10) m = "91$m";
  final uri = Uri.parse(
    "https://wa.me/$m${text.isEmpty ? "" : "?text=${Uri.encodeComponent(text)}"}",
  );
  final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text("WhatsApp is not available on this phone.")),
    );
  }
}

class _ContactButtons extends StatelessWidget {
  const _ContactButtons({required this.mobile, this.waText = ""});
  final String mobile;
  final String waText;

  @override
  Widget build(BuildContext context) {
    if (mobile.isEmpty) {
      return const Text(
        "No mobile on file",
        style: TextStyle(fontSize: 11, color: AppColors.muted),
      );
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          tooltip: "Call",
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.call_outlined, size: 20),
          color: AppColors.primary,
          onPressed: () => _call(context, mobile),
        ),
        IconButton(
          tooltip: "WhatsApp",
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.chat_outlined, size: 20),
          color: AppColors.success,
          onPressed: () => _whatsapp(context, mobile, text: waText),
        ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill(this.text, {required this.tone});
  final String text;
  final ModuleTone tone;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: tone.background,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            color: tone.foreground,
          ),
        ),
      );
}

/* ─── Fee defaulters ─────────────────────────────────────────────── */

class DefaultersScreen extends StatelessWidget {
  const DefaultersScreen({super.key, required this.api});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<DefaultersList>(
      title: "Fee defaulters",
      load: api.fetchDefaulters,
      emptyIcon: Icons.verified_outlined,
      emptyText: "No family has open dues right now.",
      isEmpty: (d) => d.households.isEmpty,
      builder: (context, d, _) => ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: d.households.length + 1,
        itemBuilder: (context, i) {
          if (i == 0) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Card(
                color: AppColors.primary,
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          "${d.households.length} families · as of ${formatDateLabel(d.asOf)}",
                          style: const TextStyle(
                              color: Colors.white, fontSize: 12.5),
                        ),
                      ),
                      Text(
                        formatInrPaise(d.totalOpenPaise),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }
          final h = d.households[i - 1];
          final wa =
              "Namaste ${h.guardianName}, this is BHB International School. "
              "Fee dues of ${formatInrPaise(h.openPaise)} are pending for "
              "${h.children.map((c) => c.fullName).join(", ")}. "
              "Kindly clear them at the school office. Thank you.";
          return Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 6, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          h.guardianName,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                      Text(
                        formatInrPaise(h.openPaise),
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.danger,
                        ),
                      ),
                      _ContactButtons(mobile: h.mobile, waText: wa),
                    ],
                  ),
                  for (final c in h.children)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              "${c.fullName} · ${c.classLabel}",
                              style: const TextStyle(
                                  fontSize: 12, color: AppColors.muted),
                            ),
                          ),
                          Text(
                            formatInrPaise(c.openPaise),
                            style: const TextStyle(
                                fontSize: 12, color: AppColors.muted),
                          ),
                          const SizedBox(width: 8),
                        ],
                      ),
                    ),
                  if (h.mobile.isNotEmpty)
                    Text(
                      h.mobile,
                      style: const TextStyle(
                          fontSize: 11, color: AppColors.muted),
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

/* ─── Today's registers ──────────────────────────────────────────── */

class RegistersScreen extends StatelessWidget {
  const RegistersScreen({super.key, required this.api});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<RegistersList>(
      title: "Today's attendance registers",
      load: api.fetchRegistersToday,
      emptyIcon: Icons.school_outlined,
      emptyText: "No active sections configured.",
      isEmpty: (d) => d.sections.isEmpty,
      builder: (context, d, reload) {
        final pending =
            d.sections.where((s) => !s.marked && !s.holiday).length;
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              "${formatDateLabel(d.date)} · ${d.sections.length - pending}/${d.sections.length} marked"
              "${pending > 0 ? " · $pending pending" : ""}",
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
            const SizedBox(height: 4),
            const Text(
              "Tap a section to view or mark its register.",
              style: TextStyle(fontSize: 11.5, color: AppColors.muted),
            ),
            const SizedBox(height: 10),
            for (final s in d.sections)
              Card(
                child: ListTile(
                  dense: true,
                  title: Text(
                    s.label,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, color: AppColors.ink),
                  ),
                  subtitle: Text(
                    s.holiday
                        ? "Holiday for this class"
                        : s.marked
                            ? "P ${s.present} · A ${s.absent} · L ${s.leave}"
                                "${s.markedBy.isNotEmpty ? " · by ${s.markedBy}" : ""}"
                            : "Not marked yet",
                    style: const TextStyle(fontSize: 11.5),
                  ),
                  trailing: s.holiday
                      ? _Pill("Holiday", tone: ModuleTone.blue)
                      : s.marked
                          ? _Pill("Marked", tone: ModuleTone.teal)
                          : _Pill("Pending", tone: ModuleTone.coral),
                  onTap: s.holiday
                      ? null
                      : () async {
                          final changed =
                              await Navigator.of(context).push<bool>(
                            MaterialPageRoute(
                              builder: (_) => AttendanceScreen(
                                api: api,
                                classId: s.classId,
                                sectionId: s.sectionId,
                                date: d.date,
                                title: s.label,
                              ),
                            ),
                          );
                          if (changed == true) await reload();
                        },
                ),
              ),
          ],
        );
      },
    );
  }
}

/* ─── Staff attendance today ─────────────────────────────────────── */

class StaffAttendanceTodayScreen extends StatelessWidget {
  const StaffAttendanceTodayScreen({super.key, required this.api});
  final ApiClient api;

  static (String, ModuleTone) _label(String status) => switch (status) {
        "P" => ("Present", ModuleTone.teal),
        "A" => ("Absent", ModuleTone.coral),
        "L" => ("Leave", ModuleTone.blue),
        "HD" => ("Half day", ModuleTone.blue),
        "LE" => ("Late", ModuleTone.blue),
        _ => ("Not marked", ModuleTone.coral),
      };

  @override
  Widget build(BuildContext context) {
    return ModuleShell<StaffAttendanceToday>(
      title: "Staff attendance today",
      load: api.fetchStaffAttendanceToday,
      emptyIcon: Icons.badge_outlined,
      emptyText: "No active staff on the roster.",
      isEmpty: (d) => d.staff.isEmpty,
      builder: (context, d, _) {
        final present = d.staff.where((s) => s.status == "P").length;
        final absent = d.staff.where((s) => s.status == "A").length;
        final unmarked = d.staff.where((s) => s.status.isEmpty).length;
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              "${formatDateLabel(d.date)} · $present present · $absent absent"
              "${unmarked > 0 ? " · $unmarked not marked" : ""}",
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
            const SizedBox(height: 10),
            for (final s in d.staff)
              Card(
                child: ListTile(
                  dense: true,
                  title: Text(
                    s.fullName,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, color: AppColors.ink),
                  ),
                  subtitle: Text(
                    [
                      if (s.designation.isNotEmpty) s.designation,
                      if (s.inTime.isNotEmpty)
                        "in ${s.inTime}${s.outTime.isNotEmpty ? " · out ${s.outTime}" : ""}",
                    ].join(" · "),
                    style: const TextStyle(fontSize: 11.5),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _Pill(_label(s.status).$1, tone: _label(s.status).$2),
                      if (s.status != "P")
                        _ContactButtons(mobile: s.mobile),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/* ─── Admission follow-ups due ───────────────────────────────────── */

class FollowUpsScreen extends StatelessWidget {
  const FollowUpsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<FollowUpLead>>(
      title: "Admission follow-ups due",
      load: api.fetchFollowUpsDue,
      emptyIcon: Icons.task_alt_outlined,
      emptyText: "No follow-ups are due. Nice.",
      isEmpty: (l) => l.isEmpty,
      builder: (context, leads, _) => ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: leads.length + 1,
        itemBuilder: (context, i) {
          if (i == 0) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                "${leads.length} leads · oldest first",
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
            );
          }
          final l = leads[i - 1];
          final wa =
              "Namaste ${l.guardianName}, this is BHB International School "
              "regarding ${l.childName}'s admission enquiry (${l.enquiryNo}). "
              "May we help you with the next step?";
          return Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 6, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          "${l.childName.isEmpty ? "(no name)" : l.childName}"
                          "${l.classSought.isNotEmpty ? " · Class ${l.classSought}" : ""}",
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Padding(
                        padding: const EdgeInsets.only(right: 8, top: 2),
                        child: _Pill(l.stage, tone: ModuleTone.blue),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    "${l.guardianName} · ${l.enquiryNo}",
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          "Due ${formatDateLabel(l.nextFollowUpAt)}"
                          "${l.overdueDays > 0 ? " · ${l.overdueDays}d overdue" : ""}",
                          style: TextStyle(
                            fontSize: 12,
                            color: l.overdueDays > 0
                                ? AppColors.danger
                                : AppColors.muted,
                          ),
                        ),
                      ),
                      _ContactButtons(mobile: l.mobile, waText: wa),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
