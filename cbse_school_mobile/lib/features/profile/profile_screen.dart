import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";
import "child_profile_screen.dart";

/// The family as the school has it, and a door into each child's record.
///
/// The parent can correct the family's contact details here; the child's
/// own record is read-only in the app and changes go through the office.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.api, required this.onSignOut});

  final ApiClient api;
  final Future<void> Function() onSignOut;

  static const labels = {
    "guardianName": "Guardian",
    "mobile": "Registered mobile",
    "whatsappMobile": "WhatsApp",
    "altMobile": "Alternate mobile",
    "email": "Email",
    "address": "Address",
    "locality": "Locality",
    "landmark": "Landmark",
    "city": "City",
    "state": "State",
    "pincode": "PIN code",
  };

  @override
  Widget build(BuildContext context) {
    return ModuleShell<ParentProfile>(
      title: "Profile",
      load: api.fetchProfile,
      builder: (context, profile, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          const _SectionTitle("Family"),
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final e in labels.entries)
                    _Row(label: e.value, value: profile.household[e.key]),
                  const SizedBox(height: 6),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: () => _edit(context, profile, reload),
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      label: const Text("Update family details"),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          const _SectionTitle("Children"),
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
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: Text(
                  "${child.classLabel} · Adm. ${child.admissionNo}\n"
                  "${child.requiredMissing == 0 ? "All required documents in" : "${child.requiredMissing} required document${child.requiredMissing == 1 ? "" : "s"} to upload"}"
                  " · profile ${child.completeness}% complete",
                  style: TextStyle(
                    fontSize: 11.5,
                    color: child.requiredMissing == 0
                        ? AppColors.muted
                        : AppColors.warning,
                    height: 1.4,
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
            label: const Text("Sign out"),
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
      await reload();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text("Saved. The school office can see the update."),
          ),
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
          const SnackBar(content: Text("Could not reach the school server.")),
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
            const Text(
              "Update family details",
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              "Registered mobile ${widget.profile.household["mobile"]} is your sign-in and "
              "can only be changed at the office.",
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
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
                  labelText: ProfileScreen.labels[k] ?? k,
                ),
              ),
              const SizedBox(height: 10),
            ],
            FilledButton(
              onPressed: _busy ? null : _save,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
              ),
              child: Text(_busy ? "Saving…" : "Save"),
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
            child: Text(
              label,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? "—" : value,
              style: TextStyle(
                fontSize: 13,
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
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
      ),
    );
  }
}
