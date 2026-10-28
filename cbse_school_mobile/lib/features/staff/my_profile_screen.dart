import "dart:io";

import "package:flutter/material.dart";
import "package:image_picker/image_picker.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/i18n/locale_controller.dart";
import "../modules/module_shell.dart";
import "home_groups.dart";
import "my_signature_card.dart";
import "staff_profile_rules.dart";

/// A member of staff's own profile (director, 13 Oct 2026: "staff has no
/// option to see their profile in app and update or fill fields and update
/// their profile picture").
///
/// Contact, personal and qualification details save at once. Identity, bank
/// and statutory ones go to the office as a request (Staff → Requests on the
/// ERP) and change only when it is approved. A new photo shows at once and
/// waits in the office's document check. Aadhaar and the bank account are
/// only ever shown masked: changing them means typing the whole number again,
/// and the masked value is never sent back.
class MyProfileScreen extends StatefulWidget {
  const MyProfileScreen({super.key, required this.api, this.onSignOut});

  final ApiClient api;

  /// Shown as a Sign out button at the bottom when given.
  final VoidCallback? onSignOut;

  @override
  State<MyProfileScreen> createState() => _MyProfileScreenState();
}

class _MyProfileScreenState extends State<MyProfileScreen> {
  StaffProfile? _p;
  String? _error;
  bool _busy = false;

  /// Bumped after a photo upload so the avatar reloads the new image.
  int _photoRev = 0;

  bool get _hi => Localizations.localeOf(context).languageCode == "hi";
  String _t(String en, String hi) => _hi ? hi : en;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final p = await widget.api.fetchMyProfile();
      if (mounted) setState(() => _p = p);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _t(
            "Could not reach the school server.",
            "स्कूल सर्वर से संपर्क नहीं हो सका।",
          ),
        );
      }
    }
  }

  void _toast(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: error ? AppColors.danger : null,
      ),
    );
  }

  // ---- photo -------------------------------------------------------------

  Future<void> _changePhoto() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(_t("Take a photo", "फ़ोटो खींचें")),
              onTap: () => Navigator.pop(sheet, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(_t("Choose from gallery", "गैलरी से चुनें")),
              onTap: () => Navigator.pop(sheet, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    final XFile? shot;
    try {
      // 1600 px and quality 80 keep a face sharp and the file well under
      // the server's 5 MB (usually 200–600 KB).
      shot = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 80,
        preferredCameraDevice: CameraDevice.front,
      );
    } catch (_) {
      if (mounted) {
        _toast(
          _t("Could not open the camera or gallery.", "कैमरा/गैलरी नहीं खुली।"),
          error: true,
        );
      }
      return;
    }
    if (shot == null || !mounted) return;
    final file = File(shot.path);
    if (await file.length() > 5 * 1024 * 1024) {
      _toast(
        _t(
          "The photo is larger than 5 MB — take it again.",
          "फ़ोटो 5 MB से बड़ी है — दोबारा लें।",
        ),
        error: true,
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.api.uploadMyPhoto(file);
      final p = await widget.api.fetchMyProfile();
      if (!mounted) return;
      setState(() {
        _p = p;
        _photoRev += 1;
      });
      _toast(
        _t(
          "Photo saved — the office will check it.",
          "फ़ोटो सहेजी गई — कार्यालय जाँच करेगा।",
        ),
      );
    } on ApiException catch (e) {
      if (mounted) _toast(e.message, error: true);
    } catch (_) {
      if (mounted) {
        _toast(
          _t("The photo was not saved. Try again.", "फ़ोटो नहीं सहेजी गई।"),
          error: true,
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---- fields ------------------------------------------------------------

  Future<void> _edit(StaffProfileField f) async {
    final p = _p;
    if (p == null || _busy) return;
    final current = p.values[f.key] ?? "";
    String? value;
    if (f.kind == "date") {
      final now = DateTime.now();
      final picked = await showDatePicker(
        context: context,
        initialDate: DateTime.tryParse(current) ?? DateTime(now.year - 30),
        firstDate: DateTime(1940),
        lastDate: now,
        helpText: "${f.label} · ${f.hindi}",
      );
      if (picked == null) return;
      value =
          "${picked.year.toString().padLeft(4, "0")}-${picked.month.toString().padLeft(2, "0")}-${picked.day.toString().padLeft(2, "0")}";
    } else {
      value = await showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        builder: (_) => _FieldEditor(field: f, current: current),
      );
    }
    if (value == null || !mounted) return;
    // Nothing changed — no save, no request for "no change".
    if (!f.masked && value == current) return;
    await _save(f, value);
  }

  Future<void> _save(StaffProfileField f, String value) async {
    setState(() => _busy = true);
    try {
      final r = await widget.api.updateMyProfile({f.key: value});
      if (!mounted) return;
      setState(() => _p = r.profile);
      if (r.sentForApproval.isNotEmpty) {
        _toast(
          _t(
            "Sent to the office for approval.",
            "कार्यालय को स्वीकृति के लिए भेजा गया।",
          ),
        );
      } else if (r.saved.isNotEmpty) {
        _toast(_t("Saved.", "सहेजा गया।"));
      } else {
        _toast(_t("No change.", "कोई बदलाव नहीं।"));
      }
    } on ApiException catch (e) {
      if (mounted) _toast(e.message, error: true);
    } catch (_) {
      if (mounted) {
        _toast(
          _t("Not saved — check your connection.", "सहेजा नहीं गया।"),
          error: true,
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withdraw() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(_t("Withdraw your request?", "अनुरोध वापस लें?")),
        content: Text(
          _t(
            "The office will no longer see these changes.",
            "कार्यालय को ये बदलाव अब नहीं दिखेंगे।",
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(d, false),
            child: Text(_t("Keep", "रहने दें")),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(d, true),
            child: Text(_t("Withdraw", "वापस लें")),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final p = await widget.api.withdrawMyProfileRequest();
      if (!mounted) return;
      setState(() => _p = p);
      _toast(_t("Request withdrawn.", "अनुरोध वापस लिया गया।"));
    } on ApiException catch (e) {
      if (mounted) _toast(e.message, error: true);
    } catch (_) {
      if (mounted) {
        _toast(
          _t("Could not withdraw. Try again.", "वापस नहीं हो सका।"),
          error: true,
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _signOut() {
    final cb = widget.onSignOut;
    if (cb == null) return;
    Navigator.of(context).pop();
    cb();
  }

  // ---- build -------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final p = _p;
    return Scaffold(
      appBar: AppBar(
        title: Text(_t("My profile", "मेरी प्रोफ़ाइल")),
        bottom: _busy
            ? const PreferredSize(
                preferredSize: Size.fromHeight(3),
                child: LinearProgressIndicator(minHeight: 3),
              )
            : null,
      ),
      body: p == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator(color: AppColors.primary)
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: _load,
                            child: Text(context.l10n.retry),
                          ),
                          if (widget.onSignOut != null)
                            TextButton(
                              onPressed: _signOut,
                              child: Text(context.l10n.signOut),
                            ),
                        ],
                      ),
                    ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              color: AppColors.primary,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                children: [
                  _header(p),
                  const SizedBox(height: 8),
                  MySignatureCard(
                    api: widget.api,
                    signatureUrl: p.signatureUrl,
                    onChanged: (_) => _load(),
                  ),
                  if (p.pendingRequest != null) _pendingBanner(p),
                  if (p.pendingRequest == null && p.lastDecision != null)
                    _decisionBanner(p),
                  if (p.requestsUnknown)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        _t(
                          "Could not check your requests to the office just now.",
                          "कार्यालय को भेजे अनुरोध अभी नहीं देख सके।",
                        ),
                        style: AppText.labelMediumMuted,
                      ),
                    ),
                  for (final g in kProfileGroupOrder)
                    if (p.fields.any((f) => f.group == g)) _section(p, g),
                  if (widget.onSignOut != null) ...[
                    const SizedBox(height: 20),
                    OutlinedButton.icon(
                      onPressed: _signOut,
                      icon: const Icon(Icons.logout, size: 18),
                      label: Text(context.l10n.signOut),
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _header(StaffProfile p) {
    final (photoText, photoColor) = switch (p.photoStatus) {
      "pending" => (
        _t("Waiting for the office's check", "कार्यालय की जाँच बाकी है"),
        AppColors.warning,
      ),
      "rejected" => (
        "${_t("Photo not accepted", "फ़ोटो स्वीकार नहीं हुई")}${p.photoNote.isEmpty ? "" : " — ${p.photoNote}"}",
        AppColors.danger,
      ),
      "verified" => (_t("Photo checked", "फ़ोटो जाँची गई"), AppColors.success),
      _ => ("", AppColors.muted),
    };
    final role = [p.designation, p.department].where((s) => s.isNotEmpty);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            StaffAvatar(
              key: ValueKey("${p.photoUrl}#$_photoRev"),
              api: widget.api,
              name: p.fullName,
              photoUrl: p.photoUrl,
              radius: 44,
            ),
            TextButton.icon(
              onPressed: _busy ? null : _changePhoto,
              icon: const Icon(Icons.photo_camera_outlined, size: 18),
              label: Text(
                p.photoUrl.isEmpty
                    ? _t("Add photo", "फ़ोटो लगाएँ")
                    : _t("Change photo", "फ़ोटो बदलें"),
              ),
            ),
            if (photoText.isNotEmpty)
              Text(
                photoText,
                textAlign: TextAlign.center,
                style: AppText.labelMedium.copyWith(color: photoColor),
              ),
            const SizedBox(height: 10),
            Text(
              p.fullName,
              textAlign: TextAlign.center,
              style: AppText.titleMediumInk.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            if (role.isNotEmpty)
              Text(
                role.join(" · "),
                textAlign: TextAlign.center,
                style: AppText.bodySmallMuted,
              ),
            const SizedBox(height: 6),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 14,
              runSpacing: 4,
              children: [
                if (p.empCode.isNotEmpty)
                  Text(
                    "${_t("Emp. code", "कर्मचारी कोड")}: ${p.empCode}",
                    style: AppText.labelMediumInk,
                  ),
                if (p.joiningDate.isNotEmpty)
                  Text(
                    "${_t("Joined", "नियुक्ति")}: ${formatDateLabel(p.joiningDate)}",
                    style: AppText.labelMediumInk,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  StaffProfileField? _field(StaffProfile p, String key) {
    for (final f in p.fields) {
      if (f.key == key) return f;
    }
    return null;
  }

  String _shown(String key, String value) {
    if (value.isEmpty) return "—";
    return staffProfileOptionLabel(key, value);
  }

  Widget _pendingBanner(StaffProfile p) {
    final r = p.pendingRequest!;
    return _Banner(
      color: ModuleTone.amber,
      icon: Icons.hourglass_top,
      title: _t(
        "Waiting for the office's approval",
        "कार्यालय की स्वीकृति बाकी है",
      ),
      children: [
        for (final e in r.fields.entries)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              "${_field(p, e.key)?.label ?? e.key}: ${_shown(e.key, e.value.$2)}"
              "${e.value.$1.isEmpty ? "" : "  (${_t("now", "अभी")} ${_shown(e.key, e.value.$1)})"}",
              style: AppText.bodySmallInk,
            ),
          ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: _busy ? null : _withdraw,
            child: Text(_t("Withdraw", "वापस लें")),
          ),
        ),
      ],
    );
  }

  Widget _decisionBanner(StaffProfile p) {
    final r = p.lastDecision!;
    final approved = r.status == "approved";
    final keys = r.fields.keys.map((k) => _field(p, k)?.label ?? k).join(", ");
    return _Banner(
      color: approved ? ModuleTone.green : ModuleTone.coral,
      icon: approved ? Icons.check_circle_outline : Icons.cancel_outlined,
      title: approved
          ? _t(
              "The office approved your change",
              "कार्यालय ने बदलाव स्वीकार किया",
            )
          : _t(
              "The office did not approve your change",
              "कार्यालय ने बदलाव स्वीकार नहीं किया",
            ),
      children: [
        if (keys.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(keys, style: AppText.bodySmallInk),
          ),
        if (r.note.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              "${_t("Note", "टिप्पणी")}: ${r.note}",
              style: AppText.bodySmallInk,
            ),
          ),
        if (r.decidedAt.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              formatDateLabel(r.decidedAt.split("T").first),
              style: AppText.labelMediumMuted,
            ),
          ),
      ],
    );
  }

  Widget _section(StaffProfile p, String group) {
    final fields = p.fields.where((f) => f.group == group).toList();
    final approval = fields.any((f) => f.approval);
    final pending = p.pendingRequest?.fields ?? const {};
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  "$group · ${kProfileGroupHindi[group] ?? group}",
                  style: AppText.bodyLargeInk.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (approval) ...[
                const Icon(
                  Icons.lock_outline,
                  size: 14,
                  color: AppColors.muted,
                ),
                const SizedBox(width: 4),
                Text(
                  "Office approves · कार्यालय स्वीकृत करेगा",
                  style: AppText.labelSmallMuted,
                ),
              ],
            ],
          ),
          const SizedBox(height: 6),
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (final f in fields)
                  ListTile(
                    dense: true,
                    onTap: _busy ? null : () => _edit(f),
                    title: Text(
                      f.label,
                      style: AppText.bodyMediumInk.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (f.hindi.isNotEmpty)
                          Text(f.hindi, style: AppText.labelSmallMuted),
                        Text(
                          _shown(f.key, p.values[f.key] ?? ""),
                          style: AppText.bodySmallInk,
                        ),
                        if (pending[f.key] != null)
                          Text(
                            "${_t("Requested", "अनुरोध")}: ${_shown(f.key, pending[f.key]!.$2)}",
                            style: AppText.labelSmall.copyWith(
                              color: AppColors.warning,
                            ),
                          ),
                      ],
                    ),
                    trailing: Text(
                      f.masked
                          ? _t("Update", "बदलें")
                          : (p.values[f.key] ?? "").isEmpty
                          ? _t("Add", "भरें")
                          : _t("Edit", "बदलें"),
                      style: AppText.labelMediumInk.copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    required this.color,
    required this.icon,
    required this.title,
    required this.children,
  });

  final ModuleTone color;
  final IconData icon;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: color.background,
      margin: const EdgeInsets.only(top: 12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: color.foreground),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: AppText.bodyMediumInk.copyWith(
                      color: color.foreground,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            ...children,
          ],
        ),
      ),
    );
  }
}

/// The bottom sheet that edits one field. Pops with the cleaned value.
class _FieldEditor extends StatefulWidget {
  const _FieldEditor({required this.field, required this.current});

  final StaffProfileField field;
  final String current;

  @override
  State<_FieldEditor> createState() => _FieldEditorState();
}

class _FieldEditorState extends State<_FieldEditor> {
  // A masked value (••••1234) is never put in the box — the whole number
  // is typed again, so it can never be sent back by accident.
  late final _ctrl = TextEditingController(
    text: widget.field.masked ? "" : widget.current,
  );
  late String? _choice = widget.field.options.contains(widget.current)
      ? widget.current
      : null;
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  TextInputType get _keyboard => switch (widget.field.kind) {
    "mobile" => TextInputType.phone,
    "email" => TextInputType.emailAddress,
    "pincode" || "number" || "aadhaar" || "account" => TextInputType.number,
    _ when widget.field.key.startsWith("address") => TextInputType.multiline,
    _ => TextInputType.text,
  };

  void _submit() {
    final f = widget.field;
    final raw = f.kind == "select" ? (_choice ?? "") : _ctrl.text;
    // An empty box on a masked field means "not typed", never "clear it".
    if (f.masked && raw.trim().isEmpty) {
      setState(() => _error = "Type the full number · पूरा नंबर लिखें");
      return;
    }
    final (value, error) = checkStaffProfileValue(f, raw);
    if (error != null) {
      setState(() => _error = error);
      return;
    }
    Navigator.pop(context, value);
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.field;
    final hi = Localizations.localeOf(context).languageCode == "hi";
    final caps = f.kind == "pan" || f.kind == "ifsc";
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        16 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(f.label, style: AppText.titleMediumInk),
            if (f.hindi.isNotEmpty)
              Text(f.hindi, style: AppText.bodySmallMuted),
            if (f.approval)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  "The office approves this change before it counts. · "
                  "यह बदलाव कार्यालय की स्वीकृति के बाद लागू होगा।",
                  style: AppText.labelMediumMuted,
                ),
              ),
            const SizedBox(height: 14),
            if (f.kind == "select")
              DropdownButtonFormField<String>(
                initialValue: _choice,
                isExpanded: true,
                decoration: InputDecoration(
                  border: const OutlineInputBorder(),
                  errorText: _error,
                ),
                items: [
                  for (final o in f.options)
                    DropdownMenuItem(
                      value: o,
                      child: Text(staffProfileOptionLabel(f.key, o)),
                    ),
                ],
                onChanged: (v) => setState(() {
                  _choice = v;
                  _error = null;
                }),
              )
            else
              TextField(
                controller: _ctrl,
                autofocus: true,
                keyboardType: _keyboard,
                textCapitalization: caps
                    ? TextCapitalization.characters
                    : TextCapitalization.sentences,
                minLines: 1,
                maxLines: f.key.startsWith("address") ? 3 : 1,
                onChanged: (_) {
                  if (_error != null) setState(() => _error = null);
                },
                onSubmitted: (_) => _submit(),
                decoration: InputDecoration(
                  border: const OutlineInputBorder(),
                  errorText: _error,
                  helperText: f.masked && widget.current.isNotEmpty
                      ? "${hi ? "अभी" : "Now"}: ${widget.current} — "
                            "${hi ? "पूरा नंबर लिखें" : "type the full number"}"
                      : null,
                  hintText: switch (f.kind) {
                    "pan" => "ABCDE1234F",
                    "ifsc" => "SBIN0001234",
                    "mobile" => "98XXXXXXXX",
                    "pincode" => "221001",
                    "aadhaar" => "12 digits · 12 अंक",
                    _ => null,
                  },
                ),
              ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _submit,
              child: Text(
                f.approval
                    ? (hi ? "कार्यालय को भेजें" : "Send to the office")
                    : (hi ? "सहेजें" : "Save"),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
