import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "child_profile_screen.dart";
import "../../core/i18n/locale_controller.dart";

/// The family as the school has it, and a door into each child's record.
///
/// The parent can correct the family's contact details here; the child's
/// own record is read-only in the app and changes go through the office.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.api, required this.onSignOut});

  final ApiClient api;
  final Future<void> Function() onSignOut;

  static Map<String, String> labels(BuildContext context) => {
    "guardianName": context.l10n.profGuardian,
    "mobile": context.l10n.profRegisteredMobile,
    "whatsappMobile": context.l10n.whatsapp,
    "altMobile": context.l10n.profAlternateMobile,
    "email": context.l10n.profEmail,
    "address": context.l10n.profAddress,
    "locality": context.l10n.profLocality,
    "landmark": context.l10n.landmark,
    "city": context.l10n.profCity,
    "state": context.l10n.profState,
    "pincode": context.l10n.profPinCode,
  };

  @override
  Widget build(BuildContext context) {
    return ModuleShell<ParentProfile>(
      title: context.l10n.profProfile,
      load: api.fetchProfile,
      builder: (context, profile, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          _SectionTitle(context.l10n.profFamily),
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final e in labels(context).entries)
                    _Row(label: e.value, value: profile.household[e.key]),
                  const SizedBox(height: 6),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: () => _edit(context, profile, reload),
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      label: Text(context.l10n.updateFamilyDetails),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          _SectionTitle(context.l10n.profChildren),
          for (final child in profile.children)
            Card(
              child: ListTile(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) =>
                        ChildProfileScreen(api: api, studentId: child.id),
                  ),
                ),
                leading: _Avatar(child: child),
                title: Text(
                  child.fullName,
                  style: AppText.bodyLarge.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: Text(
                  "${context.l10n.profClassAdmNo(child.classLabel, child.admissionNo)}\n"
                  "${child.requiredMissing == 0
                      ? context.l10n.profDocsStatusAllIn(child.completeness.toString())
                      : child.requiredMissing == 1
                      ? context.l10n.profDocsStatusOneMissing(child.completeness.toString())
                      : context.l10n.profDocsStatusMissing(child.requiredMissing.toString(), child.completeness.toString())}",
                  style: AppText.labelMedium.copyWith(
                    height: 1.4,
                    color: child.requiredMissing == 0
                        ? AppColors.muted
                        : AppColors.warning,
                  ),
                ),
                isThreeLine: true,
                trailing: const Icon(
                  Icons.chevron_right,
                  color: AppColors.muted,
                ),
              ),
            ),
          const SizedBox(height: 20),
          OutlinedButton.icon(
            onPressed: onSignOut,
            icon: const Icon(Icons.logout, size: 18),
            label: Text(context.l10n.signOut),
          ),
        ],
      ),
    );
  }

  Future<void> _edit(
    BuildContext context,
    ParentProfile profile,
    Future<void> Function() reload,
  ) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _HouseholdForm(api: api, profile: profile),
    );
    if (saved == true) {
      Haptics.success();
      await reload();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.savedTheSchoolOfficeCanSee)),
        );
      }
    }
  }
}

class _HouseholdForm extends StatefulWidget {
  const _HouseholdForm({required this.api, required this.profile});

  final ApiClient api;
  final ParentProfile profile;

  @override
  State<_HouseholdForm> createState() => _HouseholdFormState();
}

class _HouseholdFormState extends State<_HouseholdForm> {
  late final Map<String, TextEditingController> _c = {
    for (final k in widget.profile.editableHouseholdFields)
      k: TextEditingController(text: widget.profile.household[k]),
  };
  bool _busy = false;

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.api.updateHousehold({
        for (final e in _c.entries) e.key: e.value.text,
      });
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.couldNotReachTheSchoolServer)),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + inset),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              context.l10n.updateFamilyDetails,
              style: AppText.titleMediumInk,
            ),
            const SizedBox(height: 4),
            Text(
              context.l10n.profRegisteredMobileNote(
                widget.profile.household["mobile"],
              ),
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 12),
            for (final k in widget.profile.editableHouseholdFields) ...[
              TextField(
                controller: _c[k],
                keyboardType: switch (k) {
                  "altMobile" || "pincode" => TextInputType.number,
                  "email" => TextInputType.emailAddress,
                  _ => TextInputType.text,
                },
                textCapitalization: k == "email"
                    ? TextCapitalization.none
                    : TextCapitalization.words,
                maxLines: k == "address" ? 2 : 1,
                decoration: InputDecoration(
                  labelText: ProfileScreen.labels(context)[k] ?? k,
                ),
              ),
              const SizedBox(height: 10),
            ],
            FilledButton(
              onPressed: _busy ? null : _save,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
              ),
              child: Text(_busy ? context.l10n.profSaving : context.l10n.save),
            ),
          ],
        ),
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.child});

  final StudentProfile child;

  @override
  Widget build(BuildContext context) {
    final initials = child.fullName
        .split(" ")
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    return CircleAvatar(
      radius: 22,
      backgroundColor: AppColors.accentSoft,
      child: Text(
        initials,
        style: const TextStyle(
          color: AppColors.primary,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 128,
            child: Text(label, style: AppText.bodySmallMuted),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? "—" : value,
              style: AppText.bodyMedium.copyWith(
                color: value.isEmpty ? AppColors.muted : AppColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Text(
        text,
        style: AppText.bodyLargeInk.copyWith(fontWeight: FontWeight.w600),
      ),
    );
  }
}
