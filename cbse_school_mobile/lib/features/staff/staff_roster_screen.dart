import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/api/school_whatsapp.dart";
import "colleague_profile_screen.dart";

/// The active roster for leadership and the office. Staff with no mobile
/// on record sit at the top — they cannot sign in to this app until a
/// number is added, and the office can add it right here. Everyone else
/// gets call / WhatsApp buttons.
///
/// Tapping a name opens that person's profile (the principal's "Active
/// staff" card opens this list as the Staff list — request mr_mv9yf8qf6y0j);
/// the red phone on a row with no number adds it, and the profile changes it.
class StaffRosterScreen extends StatelessWidget {
  const StaffRosterScreen({super.key, required this.api, this.title});

  final ApiClient api;

  /// Null = "Staff contacts" (the tile); the home card says "Staff list".
  final String? title;

  static String _kindLabel(String k) => switch (k) {
    "leadership" => "Leadership",
    "teaching" => "Teaching",
    "crew" => "Transport",
    "office" => "Office",
    _ => "Support",
  };

  @override
  Widget build(BuildContext context) {
    return ModuleShell<StaffRoster>(
      guideId: "staff-contacts",
      title: title ?? "Staff contacts",
      load: api.fetchStaffRoster,
      emptyIcon: Icons.badge_outlined,
      emptyText: context.l10n.noActiveStaffOnTheRoster,
      isEmpty: (r) => r.staff.isEmpty,
      builder: (context, r, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          if (r.missingMobile > 0)
            Card(
              color: ModuleTone.amber.background,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  context.l10n.hcRosterMissingMobile(r.missingMobile, r.total),
                  style: AppText.bodySmall.copyWith(
                    height: 1.4,
                    color: ModuleTone.amber.foreground,
                  ),
                ),
              ),
            ),
          for (final s in r.staff)
            Card(
              child: ListTile(
                onTap: () async {
                  final changed = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => ColleagueProfileScreen(
                        api: api,
                        staffId: s.id,
                        name: s.fullName,
                      ),
                    ),
                  );
                  if (changed == true) await reload();
                },
                leading: CircleAvatar(
                  backgroundColor: s.hasMobile
                      ? ModuleTone.teal.background
                      : ModuleTone.coral.background,
                  child: Icon(
                    s.hasMobile
                        ? Icons.person_outline
                        : Icons.phone_disabled_outlined,
                    color: s.hasMobile
                        ? ModuleTone.teal.foreground
                        : ModuleTone.coral.foreground,
                    size: 20,
                  ),
                ),
                title: Text(
                  s.fullName,
                  style: AppText.bodyMediumInk.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: Text(
                  "${s.designation.isEmpty ? _kindLabel(s.homeKind) : s.designation} · ${s.hasMobile ? s.mobile : "no mobile — cannot sign in"}",
                  style: AppText.bodySmall.copyWith(
                    color: s.hasMobile ? AppColors.muted : AppColors.danger,
                  ),
                ),
                trailing: s.hasMobile
                    ? Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            tooltip: context.l10n.call,
                            onPressed: () =>
                                launchUrl(Uri.parse("tel:${s.mobile}")),
                            icon: const Icon(
                              Icons.call_outlined,
                              size: 20,
                              color: AppColors.primary,
                            ),
                          ),
                          IconButton(
                            tooltip: context.l10n.whatsapp,
                            onPressed: () => sendSchoolWhatsApp(
                              context,
                              api,
                              mobile: s.mobile,
                              text:
                                  "Namaste ${s.fullName} — a message from the school office.",
                            ),
                            icon: const Icon(
                              Icons.chat_outlined,
                              size: 20,
                              color: AppColors.success,
                            ),
                          ),
                        ],
                      )
                    : IconButton(
                        tooltip: context.l10n.hcChangeMobile,
                        onPressed: () async {
                          if (await editStaffMobile(
                            context,
                            api,
                            staffId: s.id,
                            fullName: s.fullName,
                            designation: s.designation,
                            current: s.mobile,
                          )) {
                            await reload();
                          }
                        },
                        icon: const Icon(
                          Icons.add_call,
                          color: AppColors.danger,
                        ),
                      ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Add or change a colleague's login mobile (the office's fix for "cannot
/// sign in"). true = saved.
Future<bool> editStaffMobile(
  BuildContext context,
  ApiClient api, {
  required String staffId,
  required String fullName,
  required String designation,
  required String current,
}) async {
  final ctl = TextEditingController(text: current);
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(current.isNotEmpty ? "Change mobile" : "Add mobile"),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "$fullName${designation.isEmpty ? "" : " · $designation"}",
            style: AppText.bodyMedium,
          ),
          const SizedBox(height: 10),
          TextField(
            controller: ctl,
            autofocus: true,
            keyboardType: TextInputType.phone,
            maxLength: 10,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: context.l10n.digitMobile,
              helperText: context.l10n.staffSignInWithAnOtp,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: Text(context.l10n.cancel),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text(context.l10n.save),
        ),
      ],
    ),
  );
  if (ok != true || !context.mounted) return false;
  try {
    await api.setStaffMobile(staffId: staffId, mobile: ctl.text.trim());
    Haptics.success();
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("$fullName can now sign in with ${ctl.text.trim()}."),
        ),
      );
    }
    return true;
  } on ApiException catch (e) {
    Haptics.warning();
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
    return false;
  }
}
