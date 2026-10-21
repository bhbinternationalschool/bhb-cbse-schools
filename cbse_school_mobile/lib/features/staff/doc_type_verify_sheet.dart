import "package:flutter/material.dart";
import "package:flutter/services.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "student_contact_rules.dart";

/// Verify a parent-uploaded document AS a type (request mr_mv9z5lg1jlih):
/// the existing types (the child's document slots, the parents' Aadhaar)
/// plus the school's own, and "Create a custom type…". The server keeps the
/// type with the document and files it where the record keeps that kind
/// (apps/web/src/lib/studentDocTypes.ts). For an Aadhaar card the 12 digits
/// may be typed off the card; they go onto the record as "received".

/// The type the parent's upload slot stands for, else the first one.
DocTypeOption? defaultDocType(String uploadedSlot, List<DocTypeOption> types) {
  for (final t in types) {
    if (t.slot == uploadedSlot && !t.custom) return t;
  }
  return types.isEmpty ? null : types.first;
}

/// Where the document goes once verified as [t]: null = stays where it is;
/// otherwise the slot key it moves to, or "filed" (off the child's slots).
String? docTypeDestination(String uploadedSlot, DocTypeOption t) {
  if (t.slot == uploadedSlot) return null;
  return t.slot.isEmpty ? "filed" : t.slot;
}

const _createCustom = "__create__";

Future<bool?> showDocTypeVerifySheet(
  BuildContext context, {
  required ApiClient api,
  required DocReviewItem item,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => DocTypeVerifySheet(api: api, item: item),
  );
}

class DocTypeVerifySheet extends StatefulWidget {
  const DocTypeVerifySheet({super.key, required this.api, required this.item});

  final ApiClient api;
  final DocReviewItem item;

  @override
  State<DocTypeVerifySheet> createState() => _DocTypeVerifySheetState();
}

class _DocTypeVerifySheetState extends State<DocTypeVerifySheet> {
  DocTypeCatalogue? _catalogue;
  final List<DocTypeOption> _types = [];
  DocTypeOption? _chosen;
  final _aadhaar = TextEditingController();
  String? _error;
  String? _aadhaarError;
  bool _busy = false;

  /// Rebuilds the dropdown so it shows [_chosen] again after "Create a
  /// custom type…" (made or cancelled).
  int _rev = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final c = await widget.api.fetchDocTypes();
      if (!mounted) return;
      setState(() {
        _catalogue = c;
        _types
          ..clear()
          ..addAll(c.types);
        _chosen = defaultDocType(widget.item.key, _types);
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = context.l10n.couldNotReachTheSchoolServer);
      }
    }
  }

  String _label(BuildContext context, DocTypeOption t) =>
      context.l10n.localeName == "hi" && t.labelHi.isNotEmpty
      ? t.labelHi
      : t.label;

  Future<void> _createType() async {
    final ctl = TextEditingController();
    final l = context.l10n;
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.dtCreateCustom),
        content: TextField(
          controller: ctl,
          autofocus: true,
          maxLength: 60,
          decoration: InputDecoration(
            labelText: l.dtCustomName,
            hintText: l.dtCustomHint,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l.scCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, ctl.text.trim()),
            child: Text(l.dtCreate),
          ),
        ],
      ),
    );
    if (!mounted) return;
    setState(() => _rev++);
    if (name == null || name.isEmpty) return;
    setState(() => _busy = true);
    try {
      final t = await widget.api.createDocType(name);
      if (!mounted) return;
      setState(() {
        if (!_types.any((x) => x.id == t.id)) _types.add(t);
        _chosen = _types.firstWhere((x) => x.id == t.id);
        _error = null;
        _rev++;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final t = _chosen;
    if (t == null) return;
    final typed = t.aadhaarOf.isEmpty ? "" : aadhaarTyped(_aadhaar.text);
    if (typed == null) {
      setState(() => _aadhaarError = context.l10n.dtAadhaarInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _aadhaarError = null;
    });
    final messenger = ScaffoldMessenger.of(context);
    final l = context.l10n;
    try {
      final r = await widget.api.verifyDocumentAs(
        studentId: widget.item.studentId,
        key: widget.item.key,
        typeId: t.id,
        aadhaarNumber: typed,
      );
      Haptics.success();
      final lines = [
        l.dtVerifiedAs(r.typeLabel.isEmpty ? t.label : r.typeLabel),
      ];
      if (r.aadhaarAsked) {
        lines.add(
          !r.aadhaarSaved
              ? l.dtAadhaarNotSaved(r.aadhaarError)
              : r.aadhaarStatus == "kept_verified"
              ? l.dtAadhaarKept
              : l.dtAadhaarSaved,
        );
      }
      messenger.showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 6),
          content: Text(lines.join(" ")),
        ),
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = l.couldNotReachTheSchoolServer);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = _chosen;
    final dest = t == null ? null : docTypeDestination(widget.item.key, t);
    final destLabel = dest == null || dest == "filed"
        ? ""
        : _types
              .firstWhere((x) => x.slot == dest && !x.custom, orElse: () => t!)
              .label;
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
            Text(l.dtTypeLabel, style: AppText.titleMediumInk),
            Text(
              "${widget.item.studentName} · ${widget.item.label}",
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 12),
            if (_catalogue == null && _error == null)
              const LinearProgressIndicator(minHeight: 2),
            if (_catalogue != null) ...[
              if (!_catalogue!.customLoaded)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    l.dtCustomNotLoaded,
                    style: AppText.bodySmall.copyWith(color: AppColors.warning),
                  ),
                ),
              KeyedSubtree(
                key: ValueKey("doc-type-rev-$_rev"),
                child: DropdownButtonFormField<String>(
                  key: const ValueKey("doc-type"),
                  initialValue: t?.id,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: l.dtPickType,
                    isDense: true,
                  ),
                  items: [
                    for (final x in _types)
                      DropdownMenuItem(
                        value: x.id,
                        child: Text(_label(context, x)),
                      ),
                    if (_catalogue!.customLoaded)
                      DropdownMenuItem(
                        value: _createCustom,
                        child: Text(
                          l.dtCreateCustom,
                          style: const TextStyle(color: AppColors.primary),
                        ),
                      ),
                  ],
                  onChanged: _busy
                      ? null
                      : (v) {
                          if (v == _createCustom) {
                            _createType();
                            return;
                          }
                          setState(() {
                            _chosen = _types.firstWhere((x) => x.id == v);
                            _aadhaarError = null;
                          });
                        },
                ),
              ),
              if (t != null && dest != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    dest == "filed"
                        ? l.dtGoesOffSlot(_label(context, t), widget.item.label)
                        : l.dtGoesToSlot(destLabel),
                    style: AppText.bodySmallMuted,
                  ),
                ),
              if (t != null && t.aadhaarOf.isNotEmpty) ...[
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey("doc-aadhaar"),
                  controller: _aadhaar,
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r"[0-9 ]")),
                    LengthLimitingTextInputFormatter(14),
                  ],
                  decoration: InputDecoration(
                    labelText: l.dtAadhaarNumber,
                    helperText: l.dtAadhaarHint,
                    errorText: _aadhaarError,
                  ),
                ),
              ],
              const SizedBox(height: 14),
              FilledButton(
                key: const ValueKey("doc-verify"),
                onPressed: _busy || t == null ? null : _verify,
                child: Text(_busy ? "…" : context.l10n.dtVerify),
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
