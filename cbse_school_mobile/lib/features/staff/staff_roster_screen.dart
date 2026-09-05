import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// The active roster for leadership and the office. Staff with no mobile
/// on record sit at the top — they cannot sign in to this app until a
/// number is added, and the office can add it right here. Everyone else
/// gets call / WhatsApp buttons.
class StaffRosterScreen extends StatelessWidget {
  const StaffRosterScreen({super.key, required this.api});

  final ApiClient api;

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
      title: "Staff contacts",
      load: api.fetchStaffRoster,
      emptyIcon: Icons.badge_outlined,
      emptyText: "No active staff on the roster.",
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
                  "${r.missingMobile} of ${r.total} staff have no mobile on record, so they cannot sign in to the staff app. Tap a name to add the number.",
                  style: TextStyle(
                    fontSize: 12.5,
                    color: ModuleTone.amber.foreground,
                    height: 1.4,
                  ),
                ),
              ),
            ),
          for (final s in r.staff)
            Card(
              child: ListTile(
                onTap: () => _editMobile(context, s, reload),
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
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                subtitle: Text(
                  "${s.designation.isEmpty ? _kindLabel(s.homeKind) : s.designation} · ${s.hasMobile ? s.mobile : "no mobile — cannot sign in"}",
                  style: TextStyle(
                    fontSize: 12,
                    color: s.hasMobile ? AppColors.muted : AppColors.danger,
                  ),
                ),
                trailing: s.hasMobile
                    ? Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            tooltip: "Call",
                            onPressed: () =>
                                launchUrl(Uri.parse("tel:${s.mobile}")),
                            icon: const Icon(
                              Icons.call_outlined,
                              size: 20,
                              color: AppColors.primary,
                            ),
                          ),
                          IconButton(
                            tooltip: "WhatsApp",
                            onPressed: () => launchUrl(
                              Uri.parse("https://wa.me/91${s.mobile}"),
                              mode: LaunchMode.externalApplication,
                            ),
                            icon: const Icon(
                              Icons.chat_outlined,
                              size: 20,
                              color: AppColors.success,
                            ),
                          ),
                        ],
                      )
                    : const Icon(Icons.add_call, color: AppColors.danger),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _editMobile(
    BuildContext context,
    StaffRosterRow s,
    Future<void> Function() reload,
  ) async {
    final ctl = TextEditingController(text: s.mobile);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(s.hasMobile ? "Change mobile" : "Add mobile"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "${s.fullName}${s.designation.isEmpty ? "" : " · ${s.designation}"}",
              style: const TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: ctl,
              autofocus: true,
              keyboardType: TextInputType.phone,
              maxLength: 10,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: "10-digit mobile",
                helperText: "Staff sign in with an OTP sent to this number",
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text("Cancel"),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text("Save"),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await api.setStaffMobile(staffId: s.id, mobile: ctl.text.trim());
      Haptics.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              "${s.fullName} can now sign in with ${ctl.text.trim()}.",
            ),
          ),
        );
      }
      await reload();
    } on ApiException catch (e) {
      Haptics.warning();
      if (context.mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
}
