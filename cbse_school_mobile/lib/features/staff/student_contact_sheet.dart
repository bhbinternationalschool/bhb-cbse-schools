import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/chat_thread_screen.dart";
import "../modules/dictate_field.dart";
import "student_contact_rules.dart";

/// One student's family from the staff app (requests mr_mv9ze8pqksu2 and
/// mr_mv9zkoot06df): Call, a WhatsApp message from the school's number
/// (always previewed, sent only on Send), the class teacher's app chat, and
/// — for the class teacher — adding or changing the WhatsApp number.
///
/// The numbers come from the server (/api/v1/staff/student-contact), which
/// never hands back a placeholder: "no number on record" is shown and Add
/// offered instead, and nothing is dialled.

/// The family's actions in one sheet (My class: tap a child's name).
/// [onNumberChanged] runs after the WhatsApp number was saved.
Future<void> showStudentContactActions(
  BuildContext context, {
  required ApiClient api,
  required String studentId,
  required String studentName,
  VoidCallback? onNumberChanged,
}) {
  Haptics.tap();
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _ContactActionsSheet(
      api: api,
      studentId: studentId,
      studentName: studentName,
      onNumberChanged: onNumberChanged,
    ),
  );
}

/// Students → Call: dial the guardian at once when there is a number;
/// otherwise say so (and offer Add to the class teacher).
Future<void> callStudentFamily(
  BuildContext context, {
  required ApiClient api,
  required String studentId,
  required String studentName,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  StudentContact c;
  try {
    c = await api.fetchStudentContact(studentId);
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
    return;
  }
  final number = dialable(c.callNumber);
  if (number != null) {
    await launchUrl(Uri.parse("tel:+91$number"));
    return;
  }
  if (!context.mounted) return;
  // No number: the sheet says so and offers Add where the caller may.
  await showStudentContactActions(
    context,
    api: api,
    studentId: studentId,
    studentName: studentName,
  );
}

/// Students → Message: the WhatsApp composer (with the app chat offered to
/// the class teacher).
Future<void> messageStudentFamily(
  BuildContext context, {
  required ApiClient api,
  required String studentId,
  required String studentName,
}) => showStudentContactActions(
  context,
  api: api,
  studentId: studentId,
  studentName: studentName,
);

class _ContactActionsSheet extends StatefulWidget {
  const _ContactActionsSheet({
    required this.api,
    required this.studentId,
    required this.studentName,
    this.onNumberChanged,
  });

  final ApiClient api;
  final String studentId;
  final String studentName;
  final VoidCallback? onNumberChanged;

  @override
  State<_ContactActionsSheet> createState() => _ContactActionsSheetState();
}

class _ContactActionsSheetState extends State<_ContactActionsSheet> {
  StudentContact? _c;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final c = await widget.api.fetchStudentContact(widget.studentId);
      if (mounted) setState(() => _c = c);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = context.l10n.couldNotReachTheSchoolServer);
      }
    }
  }

  Future<void> _changeNumber(StudentContact c) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _ChangeNumberDialog(api: widget.api, contact: c),
    );
    if (saved == true) {
      widget.onNumberChanged?.call();
      await _load();
    }
  }

  Future<void> _compose(StudentContact c) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => StudentMessageComposer(api: widget.api, contact: c),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final c = _c;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.studentName, style: AppText.titleMediumInk),
            if (c != null)
              Text(
                [
                  c.classLabel,
                  c.guardianName,
                ].where((s) => s.isNotEmpty).join(" · "),
                style: AppText.bodySmallMuted,
              ),
            const SizedBox(height: 8),
            if (c == null && _error == null) ...[
              const LinearProgressIndicator(minHeight: 2),
              const SizedBox(height: 8),
              Text(l.scLoadingFamily, style: AppText.bodySmallMuted),
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  _error!,
                  style: AppText.bodySmall.copyWith(color: AppColors.danger),
                ),
              ),
            if (c != null) ..._actions(context, c),
          ],
        ),
      ),
    );
  }

  List<Widget> _actions(BuildContext context, StudentContact c) {
    final l = context.l10n;
    final call = dialable(c.callNumber);
    final wa = dialable(c.whatsappNumber);
    return [
      // Call
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(
          Icons.call_outlined,
          color: call == null ? AppColors.muted : AppColors.primary,
        ),
        title: Text(call == null ? l.scNoNumberOnRecord : l.scCallNumber(call)),
        subtitle: Text(
          call == null
              ? (c.canChangeNumber ? l.scAddWhatsApp : l.scAskClassTeacherToAdd)
              : c.callSource == "whatsapp"
              ? l.scCallSourceWhatsApp
              : l.scCallSourceGuardian,
          style: AppText.bodySmallMuted,
        ),
        onTap: call == null
            ? (c.canChangeNumber ? () => _changeNumber(c) : null)
            : () {
                Navigator.pop(context);
                launchUrl(Uri.parse("tel:+91$call"));
              },
      ),
      // WhatsApp from the school number
      if (c.canMessage)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(
            Icons.chat_outlined,
            color: wa == null ? AppColors.muted : AppColors.success,
          ),
          title: Text(
            wa == null ? l.scNoWhatsAppOnRecord : l.scWhatsAppMessage,
          ),
          subtitle: Text(
            wa == null
                ? (c.canChangeNumber
                      ? l.scAddWhatsApp
                      : l.scAskClassTeacherToAdd)
                : l.scWhatsAppMessageHint,
            style: AppText.bodySmallMuted,
          ),
          onTap: wa == null
              ? (c.canChangeNumber ? () => _changeNumber(c) : null)
              : () => _compose(c),
        ),
      // The class teacher's in-app chat
      if (c.canChat)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.forum_outlined, color: AppColors.primary),
          title: Text(l.scAppChat),
          subtitle: Text(l.scAppChatHint, style: AppText.bodySmallMuted),
          onTap: () {
            Navigator.pop(context);
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ChatThreadScreen(
                  api: widget.api,
                  studentId: c.studentId,
                  studentName: c.studentName,
                ),
              ),
            );
          },
        ),
      // Add / change the WhatsApp number (class teacher)
      if (c.canChangeNumber)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.edit_outlined, color: AppColors.primary),
          title: Text(wa == null ? l.scAddWhatsApp : l.scChangeWhatsApp),
          subtitle: wa == null
              ? null
              : Text(l.scCurrentNumber(wa), style: AppText.bodySmallMuted),
          onTap: () => _changeNumber(c),
        ),
    ];
  }
}

/// The words of a [NewNumberProblem], in the teacher's language.
String newNumberProblemText(
  BuildContext context,
  NewNumberProblem p,
  String typed,
) {
  final l = context.l10n;
  return switch (p) {
    NewNumberProblem.empty => l.scErrEmpty,
    NewNumberProblem.notMobile => l.scErrNotMobile,
    NewNumberProblem.placeholder => l.scErrPlaceholder(
      indianMobile10(typed) ?? typed,
    ),
    NewNumberProblem.same => l.scErrSame,
  };
}

class _ChangeNumberDialog extends StatefulWidget {
  const _ChangeNumberDialog({required this.api, required this.contact});

  final ApiClient api;
  final StudentContact contact;

  @override
  State<_ChangeNumberDialog> createState() => _ChangeNumberDialogState();
}

class _ChangeNumberDialogState extends State<_ChangeNumberDialog> {
  final _ctl = TextEditingController();
  String? _error;
  bool _busy = false;

  Future<void> _save() async {
    final c = widget.contact;
    final r = checkNewWhatsApp(_ctl.text, c.whatsappNumber);
    if (r.problem != null) {
      setState(
        () => _error = newNumberProblemText(context, r.problem!, _ctl.text),
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.changeFamilyWhatsApp(
        studentId: c.studentId,
        number: r.number!,
        revisionAt: c.householdRevisionAt,
      );
      Haptics.success();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.l10n.scNumberSaved)));
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = context.l10n.couldNotReachTheSchoolServer);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final current = dialable(widget.contact.whatsappNumber);
    return AlertDialog(
      title: Text(current == null ? l.scAddWhatsApp : l.scChangeWhatsApp),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.contact.studentName, style: AppText.bodyMediumInk),
          if (current != null)
            Text(l.scCurrentNumber(current), style: AppText.bodySmallMuted),
          const SizedBox(height: 8),
          TextField(
            key: const ValueKey("wa-number"),
            controller: _ctl,
            autofocus: true,
            keyboardType: TextInputType.phone,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r"[0-9+ \-]")),
              LengthLimitingTextInputFormatter(16),
            ],
            decoration: InputDecoration(
              labelText: l.scWhatsAppNumberLabel,
              prefixText: "+91 ",
              errorText: _error,
              errorMaxLines: 3,
            ),
            onSubmitted: (_) => _busy ? null : _save(),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context, false),
          child: Text(l.scCancel),
        ),
        FilledButton(onPressed: _busy ? null : _save, child: Text(l.scSave)),
      ],
    );
  }
}

/// Write → Preview (the exact text the family will read, from the server)
/// → Send. Nothing is sent until Send is pressed on the preview.
class StudentMessageComposer extends StatefulWidget {
  const StudentMessageComposer({
    super.key,
    required this.api,
    required this.contact,
  });

  final ApiClient api;
  final StudentContact contact;

  @override
  State<StudentMessageComposer> createState() => _StudentMessageComposerState();
}

class _StudentMessageComposerState extends State<StudentMessageComposer> {
  final _text = TextEditingController();
  StudentMessagePreview? _preview;
  bool _busy = false;
  String? _error;

  Future<void> _makePreview() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final p = await widget.api.previewStudentMessage(
        studentId: widget.contact.studentId,
        text: _text.text,
      );
      if (mounted) setState(() => _preview = p);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = context.l10n.couldNotReachTheSchoolServer);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final messenger = ScaffoldMessenger.of(context);
    final l = context.l10n;
    try {
      final r = await widget.api.sendStudentMessage(
        studentId: widget.contact.studentId,
        text: _text.text,
      );
      if (r.sent) {
        Haptics.success();
        messenger.showSnackBar(SnackBar(content: Text(l.scSent)));
        if (mounted) Navigator.pop(context);
      } else {
        Haptics.warning();
        if (mounted) setState(() => _error = l.scNotSent(r.reason));
      }
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) setState(() => _error = l.scNotSent(e.message));
    } catch (_) {
      if (mounted) setState(() => _error = l.couldNotReachTheSchoolServer);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final p = _preview;
    return Padding(
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
              "${l.scWhatsAppMessage} · ${widget.contact.studentName}",
              style: AppText.titleMediumInk,
            ),
            const SizedBox(height: 10),
            if (p == null) ...[
              DictateField(
                label: l.scMessageLabel,
                controller: _text,
                hint: l.scMessageHint,
                minLines: 3,
                maxLines: 8,
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                key: const ValueKey("sc-preview"),
                onPressed: _busy ? null : _makePreview,
                icon: const Icon(Icons.visibility_outlined, size: 18),
                label: Text(l.scPreview),
              ),
            ] else ...[
              Text(l.scPreviewTitle, style: AppText.bodyMediumInk),
              Text(
                l.scPreviewTo(
                  p.to,
                  p.language == "hi" ? l.scLanguageHindi : l.scLanguageEnglish,
                ),
                style: AppText.bodySmallMuted,
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFE7F6E7),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(p.preview, style: AppText.bodyMediumInk),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => setState(() {
                              _preview = null;
                              _error = null;
                            }),
                      child: Text(l.scEdit),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: const ValueKey("sc-send"),
                      onPressed: _busy ? null : _send,
                      child: Text(_busy ? l.scSending : l.scSend),
                    ),
                  ),
                ],
              ),
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  style: AppText.bodySmall.copyWith(color: AppColors.danger),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
