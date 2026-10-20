import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/api/school_whatsapp.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";
import "home_groups.dart";
import "staff_roster_screen.dart";

/// One colleague's profile, opened from the Staff list (principal home →
/// "Active staff" → a name; request mr_mv9yf8qf6y0j). Read-only apart from
/// the login mobile, which the office could already fix from the list.
/// Contact, personal and qualification details only — the server never
/// sends identity numbers, bank or statutory fields here.
///
/// Pops `true` when the mobile was changed, so the list reloads.
class ColleagueProfileScreen extends StatefulWidget {
  const ColleagueProfileScreen({
    super.key,
    required this.api,
    required this.staffId,
    required this.name,
  });

  final ApiClient api;
  final String staffId;
  final String name;

  @override
  State<ColleagueProfileScreen> createState() => _ColleagueProfileScreenState();
}

class _ColleagueProfileScreenState extends State<ColleagueProfileScreen> {
  bool _changed = false;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: ModuleShell<ColleagueProfile>(
        guideId: "staff-profile",
        title: l.hcStaffProfile,
        subtitle: widget.name,
        load: () => widget.api.fetchColleagueProfile(widget.staffId),
        builder: (context, p, reload) {
          final groups = <String, List<ColleagueProfileField>>{};
          for (final f in p.fields) {
            (groups[f.group] ??= []).add(f);
          }
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      StaffAvatar(
                        api: widget.api,
                        name: p.fullName,
                        photoUrl: p.photoUrl,
                        radius: 30,
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              p.fullName,
                              style: AppText.titleMedium.copyWith(
                                color: AppColors.ink,
                              ),
                            ),
                            if (p.designation.isNotEmpty)
                              Text(p.designation, style: AppText.bodySmall),
                            if (p.department.isNotEmpty)
                              Text(
                                p.department,
                                style: AppText.labelMediumMuted,
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Card(
                child: Column(
                  children: [
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.phone_outlined),
                      title: Text(l.hcMobile),
                      subtitle: Text(
                        p.mobile.isEmpty ? l.noMobileOnFile : p.mobile,
                      ),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (p.mobile.isNotEmpty) ...[
                            IconButton(
                              tooltip: l.call,
                              icon: const Icon(
                                Icons.call_outlined,
                                color: AppColors.primary,
                              ),
                              onPressed: () =>
                                  launchUrl(Uri.parse("tel:${p.mobile}")),
                            ),
                            IconButton(
                              tooltip: l.whatsapp,
                              icon: const Icon(
                                Icons.chat_outlined,
                                color: AppColors.success,
                              ),
                              onPressed: () => sendSchoolWhatsApp(
                                context,
                                widget.api,
                                mobile: p.mobile,
                                text:
                                    "Namaste ${p.fullName} — a message from the school office.",
                              ),
                            ),
                          ],
                          IconButton(
                            tooltip: l.hcChangeMobile,
                            icon: const Icon(Icons.edit_outlined),
                            onPressed: () async {
                              if (await editStaffMobile(
                                context,
                                widget.api,
                                staffId: p.id,
                                fullName: p.fullName,
                                designation: p.designation,
                                current: p.mobile,
                              )) {
                                _changed = true;
                                await reload();
                              }
                            },
                          ),
                        ],
                      ),
                    ),
                    if (p.empCode.isNotEmpty)
                      _Row(label: l.hcEmpCode, value: p.empCode),
                    if (p.joiningDate.isNotEmpty)
                      _Row(
                        label: l.hcJoined,
                        value: formatDateLabel(p.joiningDate),
                      ),
                    if (p.classTeacherOf.isNotEmpty)
                      _Row(
                        label: l.hcClassTeacherOf,
                        value: p.classTeacherOf.join(", "),
                      ),
                  ],
                ),
              ),
              if (groups.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: Text(
                    l.hcNoOtherDetails,
                    style: AppText.bodySmallMuted,
                  ),
                ),
              for (final g in groups.entries)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 10, bottom: 4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Text(
                            g.key,
                            style: AppText.labelMediumMuted.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        for (final f in g.value)
                          _Row(
                            label: hindi && f.hindi.isNotEmpty
                                ? f.hindi
                                : f.label,
                            value: f.value,
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 130,
          child: Text(label, style: AppText.labelMediumMuted),
        ),
        Expanded(child: Text(value, style: AppText.bodySmallInk)),
      ],
    ),
  );
}
