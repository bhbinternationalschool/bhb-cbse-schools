import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";
import "attendance_screen.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/api/school_whatsapp.dart";
import "admission_sheets.dart";

/* ─── Shared bits ────────────────────────────────────────────────── */

Future<void> _call(BuildContext context, String mobile) async {
  final m = mobile.replaceAll(RegExp(r"\D"), "");
  if (m.isEmpty) return;
  final ok = await launchUrl(Uri.parse("tel:$m"));
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(context.l10n.couldNotOpenTheDialer)));
  }
}

class _ContactButtons extends StatelessWidget {
  const _ContactButtons({required this.api, required this.mobile});

  /// Needed because WhatsApp goes out from the SCHOOL's number now, through
  /// the server — not from whichever phone the principal happens to hold.
  final ApiClient api;
  final String mobile;

  @override
  Widget build(BuildContext context) {
    if (mobile.isEmpty) {
      return Text(context.l10n.noMobileOnFile, style: AppText.labelMediumMuted);
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          tooltip: context.l10n.call,
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.call_outlined, size: 20),
          color: AppColors.primary,
          onPressed: () => _call(context, mobile),
        ),
        IconButton(
          tooltip: context.l10n.whatsapp,
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.chat_outlined, size: 20),
          color: AppColors.success,
          onPressed: () => sendSchoolWhatsApp(
            context,
            api,
            mobile: mobile,
            text: "Namaste — a message from the school office.",
          ),
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
      style: AppText.labelSmall.copyWith(
        color: tone.foreground,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

/* ─── Fee defaulters ─────────────────────────────────────────────── */

class RegistersScreen extends StatelessWidget {
  const RegistersScreen({super.key, required this.api});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<RegistersList>(
      guideId: "registers",
      title: "Today's attendance registers",
      load: api.fetchRegistersToday,
      emptyIcon: Icons.school_outlined,
      emptyText: context.l10n.noActiveSectionsConfigured,
      isEmpty: (d) => d.sections.isEmpty,
      builder: (context, d, reload) {
        final pending = d.sections.where((s) => !s.marked && !s.holiday).length;
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              "${formatDateLabel(d.date)} · ${d.sections.length - pending}/${d.sections.length} marked"
              "${pending > 0 ? " · $pending pending" : ""}",
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 4),
            Text(
              context.l10n.tapASectionToViewOr,
              style: AppText.labelMediumMuted,
            ),
            const SizedBox(height: 10),
            for (final s in d.sections)
              Card(
                child: ListTile(
                  dense: true,
                  title: Text(
                    s.label,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                  subtitle: Text(
                    s.holiday
                        ? "Holiday for this class"
                        : s.marked
                        ? "P ${s.present} · A ${s.absent} · L ${s.leave}"
                              "${s.markedBy.isNotEmpty ? " · by ${s.markedBy}" : ""}"
                        : "Not marked yet",
                    style: AppText.labelMedium,
                  ),
                  trailing: s.holiday
                      ? _Pill("Holiday", tone: ModuleTone.blue)
                      : s.marked
                      ? _Pill("Marked", tone: ModuleTone.teal)
                      : _Pill("Pending", tone: ModuleTone.coral),
                  onTap: s.holiday
                      ? null
                      : () async {
                          final changed = await Navigator.of(context)
                              .push<bool>(
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
  const StaffAttendanceTodayScreen({super.key, required this.api, this.filter});
  final ApiClient api;

  /// The principal's "Present today" / "Absent" cards open the list with
  /// only those rows (request mr_mv9ym54sdge3). The server leaves out staff
  /// exempt from attendance, so the rows here are the rows the card counted.
  final StaffTodayFilter? filter;

  static (String, ModuleTone) _label(String status) => switch (status) {
    "P" => ("Present", ModuleTone.teal),
    "A" => ("Absent", ModuleTone.coral),
    // The two were the wrong way round until 2026-09-16. Server truth
    // (lib/attendance.ts): L = Late, LE = Leave / excused — so a teacher who
    // came in late was shown to the principal as on leave, and vice versa.
    "L" => ("Late", ModuleTone.blue),
    "HD" => ("Half day", ModuleTone.blue),
    "LE" => ("Leave", ModuleTone.blue),
    _ => ("Not marked", ModuleTone.coral),
  };

  @override
  Widget build(BuildContext context) {
    final f = filter;
    return ModuleShell<StaffAttendanceToday>(
      guideId: "staff-attendance-today",
      title: switch (f) {
        StaffTodayFilter.present => context.l10n.hcStaffPresentToday,
        StaffTodayFilter.absent => context.l10n.hcStaffAbsentToday,
        null => "Staff attendance today",
      },
      load: api.fetchStaffAttendanceToday,
      emptyIcon: Icons.badge_outlined,
      emptyText: switch (f) {
        StaffTodayFilter.present => context.l10n.hcNoStaffPresent,
        StaffTodayFilter.absent => context.l10n.hcNoStaffAbsent,
        null => context.l10n.noActiveStaffOnTheRoster,
      },
      isEmpty: (d) => filterStaffToday(d.staff, f).isEmpty,
      builder: (context, d, _) {
        // Present counts late and half day too — the server's rule, and the
        // home card's.
        final present = d.staff
            .where((s) => isStaffPresentStatus(s.status))
            .length;
        final absent = d.staff.where((s) => s.status == "A").length;
        final unmarked = d.staff.where((s) => s.status.isEmpty).length;
        final rows = filterStaffToday(d.staff, f);
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              "${formatDateLabel(d.date)} · $present present · $absent absent"
              "${unmarked > 0 ? " · $unmarked not marked" : ""}",
              style: AppText.bodySmallMuted,
            ),
            Text(
              context.l10n.hcExemptNotListed,
              style: AppText.labelMediumMuted,
            ),
            const SizedBox(height: 10),
            for (final s in rows)
              Card(
                child: ListTile(
                  dense: true,
                  title: Text(
                    s.fullName,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                  subtitle: Text(
                    [
                      if (s.designation.isNotEmpty) s.designation,
                      if (s.inTime.isNotEmpty)
                        "in ${s.inTime}${s.outTime.isNotEmpty ? " · out ${s.outTime}" : ""}",
                    ].join(" · "),
                    style: AppText.labelMedium,
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _Pill(_label(s.status).$1, tone: _label(s.status).$2),
                      if (s.status != "P")
                        _ContactButtons(api: api, mobile: s.mobile),
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

/// Due follow-ups and registered leads, side by side.
///
/// Two tabs because they are two different jobs: "Leads" is who to call
/// today; "Registered" is families who have paid (or owe) the registration
/// fee and are waiting to be admitted — follow up, or send to SIS.
class FollowUpsScreen extends StatefulWidget {
  const FollowUpsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<FollowUpsScreen> createState() => _FollowUpsScreenState();
}

class _FollowUpsData {
  const _FollowUpsData({
    required this.due,
    required this.registered,
    required this.registeredError,
  });
  final List<FollowUpLead> due;

  /// Null when it could not be read — then [registeredError] says why, and
  /// the tab says "not loaded" rather than "none".
  final AdmissionLeadList? registered;
  final String? registeredError;
}

class _FollowUpsScreenState extends State<FollowUpsScreen> {
  bool _registeredTab = false;

  Future<_FollowUpsData> _load() async {
    final due = await widget.api.fetchFollowUpsDue();
    AdmissionLeadList? reg;
    String? regError;
    try {
      reg = await widget.api.fetchAdmissionLeads(filter: "registered");
    } on ApiException catch (e) {
      regError = e.message;
    } catch (_) {
      regError = mounted
          ? context.l10n.homeCouldNotReachServerCheckConnection
          : "";
    }
    return _FollowUpsData(due: due, registered: reg, registeredError: regError);
  }

  @override
  Widget build(BuildContext context) {
    final api = widget.api;
    return ModuleShell<_FollowUpsData>(
      guideId: "follow-ups",
      title: "Admission follow-ups due",
      load: _load,
      emptyIcon: Icons.task_alt_outlined,
      floatingActionButton: (context, _, reload) =>
          FloatingActionButton.extended(
            heroTag: "new-registration",
            onPressed: () async {
              if (await showRegistrationSheet(context, api)) await reload();
            },
            icon: const Icon(Icons.how_to_reg_outlined),
            label: Text(context.l10n.admNewRegistration),
          ),
      builder: (context, d, reload) {
        final leads = d.due
            .where((l) => l.stage != "applied" && l.stage != "verified")
            .toList();
        final reg = d.registered;
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Wrap(
              spacing: 8,
              children: [
                ChoiceChip(
                  label: Text("${context.l10n.admTabLeads} (${leads.length})"),
                  selected: !_registeredTab,
                  onSelected: (_) => setState(() => _registeredTab = false),
                ),
                ChoiceChip(
                  label: Text(
                    context.l10n.admTabRegistered(
                      reg == null ? "?" : "${reg.leads.length}",
                    ),
                  ),
                  selected: _registeredTab,
                  onSelected: (_) => setState(() => _registeredTab = true),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (!_registeredTab) ...[
              if (leads.isEmpty)
                _TabEmpty(context.l10n.noFollowUpsAreDueNice)
              else ...[
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    "${leads.length} leads · oldest first",
                    style: AppText.bodySmallMuted,
                  ),
                ),
                for (final l in leads)
                  _DueLeadCard(api: api, lead: l, reload: reload),
              ],
            ] else if (reg == null)
              _TabEmpty(
                context.l10n.admOptionsNotLoaded(d.registeredError ?? ""),
                error: true,
              )
            else if (reg.leads.isEmpty)
              _TabEmpty(context.l10n.admNoRegisteredLeads)
            else
              for (final r in reg.leads)
                _RegisteredLeadCard(api: api, lead: r, reload: reload),
            // Room for the floating button over the last card.
            const SizedBox(height: 72),
          ],
        );
      },
    );
  }
}

class _TabEmpty extends StatelessWidget {
  const _TabEmpty(this.text, {this.error = false});
  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 16),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: error
          ? AppText.bodySmall.copyWith(color: AppColors.danger)
          : AppText.bodyMediumMuted,
    ),
  );
}

/// Call, and the message composer (nothing is sent on the icon's tap).
class _LeadContact extends StatelessWidget {
  const _LeadContact({
    required this.api,
    required this.leadId,
    required this.mobile,
    required this.guardianName,
  });
  final ApiClient api;
  final String leadId;
  final String mobile;
  final String guardianName;

  @override
  Widget build(BuildContext context) {
    if (mobile.isEmpty) {
      return Text(context.l10n.noMobileOnFile, style: AppText.labelMediumMuted);
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          tooltip: context.l10n.call,
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.call_outlined, size: 20),
          color: AppColors.primary,
          onPressed: () => _call(context, mobile),
        ),
        IconButton(
          tooltip: context.l10n.whatsapp,
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.chat_outlined, size: 20),
          color: AppColors.success,
          onPressed: () => showLeadComposer(
            context,
            api,
            leadId: leadId,
            guardianName: guardianName,
          ),
        ),
      ],
    );
  }
}

class _DueLeadCard extends StatelessWidget {
  const _DueLeadCard({
    required this.api,
    required this.lead,
    required this.reload,
  });
  final ApiClient api;
  final FollowUpLead lead;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final l = lead;
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
                    style: AppText.bodyLargeInk.copyWith(
                      fontWeight: FontWeight.w600,
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
              style: AppText.bodySmallMuted,
            ),
            Row(
              children: [
                Expanded(
                  child: Text(
                    "Due ${formatDateLabel(l.nextFollowUpAt)}"
                    "${l.overdueDays > 0 ? " · ${l.overdueDays}d overdue" : ""}",
                    style: AppText.bodySmall.copyWith(
                      color: l.overdueDays > 0
                          ? AppColors.danger
                          : AppColors.muted,
                    ),
                  ),
                ),
                _LeadContact(
                  api: api,
                  leadId: l.id,
                  mobile: l.mobile,
                  guardianName: l.guardianName,
                ),
              ],
            ),
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 6,
                children: [
                  OutlinedButton(
                    onPressed: () async {
                      if (await showLeadFollowupSheet(
                        context,
                        api,
                        leadId: l.id,
                        guardianName: l.guardianName,
                        childName: l.childName,
                      )) {
                        await reload();
                      }
                    },
                    child: Text(
                      context.l10n.admFollowUp,
                      style: AppText.bodySmall,
                    ),
                  ),
                  FilledButton.tonal(
                    onPressed: () async {
                      if (await showRegistrationSheet(
                        context,
                        api,
                        leadId: l.id,
                        childName: l.childName,
                      )) {
                        await reload();
                      }
                    },
                    child: Text(
                      context.l10n.admRegister,
                      style: AppText.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RegisteredLeadCard extends StatelessWidget {
  const _RegisteredLeadCard({
    required this.api,
    required this.lead,
    required this.reload,
  });
  final ApiClient api;
  final AdmissionLeadRow lead;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final r = lead;
    final due = r.registrationFeeRupees > 0 && r.registrationBalanceRupees > 0;
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
                    "${r.childName.isEmpty ? "(no name)" : r.childName}"
                    "${r.classSought.isNotEmpty ? " · Class ${r.classSought}" : ""}",
                    style: AppText.bodyLargeInk.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Padding(
                  padding: const EdgeInsets.only(right: 8, top: 2),
                  child: _Pill(r.stageLabel, tone: ModuleTone.teal),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              [
                r.guardianName,
                if (r.applicationNo.isNotEmpty) r.applicationNo,
                if (r.applicationNo.isEmpty && r.enquiryNo.isNotEmpty)
                  r.enquiryNo,
              ].join(" · "),
              style: AppText.bodySmallMuted,
            ),
            Row(
              children: [
                Expanded(
                  child: Text(
                    registrationFeeLine(context.l10n, r),
                    style: AppText.bodySmall.copyWith(
                      color: due ? AppColors.danger : AppColors.muted,
                    ),
                  ),
                ),
                _LeadContact(
                  api: api,
                  leadId: r.id,
                  mobile: r.mobile,
                  guardianName: r.guardianName,
                ),
              ],
            ),
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 6,
                children: [
                  OutlinedButton(
                    onPressed: () async {
                      if (await showLeadFollowupSheet(
                        context,
                        api,
                        leadId: r.id,
                        guardianName: r.guardianName,
                        childName: r.childName,
                      )) {
                        await reload();
                      }
                    },
                    child: Text(
                      context.l10n.admFollowUp,
                      style: AppText.bodySmall,
                    ),
                  ),
                  FilledButton.tonal(
                    onPressed: () =>
                        confirmSendToSis(context, api, leadId: r.id),
                    child: Text(
                      context.l10n.admSendToSis,
                      style: AppText.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
