import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// Schedule a PTM from the app (request mr_mv9yydt031or, 20 Oct 2026): a
/// name, a date (and a last day when it runs longer), one or more classes,
/// how it is held, and a note — POST /api/v1/staff/ptm/events.
///
/// The PTM model is the web desk's: ONE PTM covers every class picked, and
/// each teacher of those classes adds their own slots to it. A teacher is
/// offered only the classes they teach (the server checks again and refuses
/// any other); the office / leadership get every class.
class PtmScheduleScreen extends StatefulWidget {
  const PtmScheduleScreen({
    super.key,
    required this.api,
    required this.options,
  });

  final ApiClient api;
  final PtmScheduleOptions options;

  @override
  State<PtmScheduleScreen> createState() => _PtmScheduleScreenState();
}

/// Why the form cannot be sent yet, or null. The server checks the same
/// things (and the class scope); this only saves a round trip.
String? ptmScheduleProblem(
  BuildContext context, {
  required String name,
  required String date,
  required Set<String> classIds,
}) {
  final l = context.l10n;
  if (name.trim().isEmpty) return l.ptmScheduleNeedName;
  if (classIds.isEmpty) return l.ptmScheduleNeedClass;
  if (date.isEmpty) return l.ptmScheduleDate;
  return null;
}

String _ymd(DateTime d) =>
    "${d.year}-${d.month.toString().padLeft(2, "0")}-${d.day.toString().padLeft(2, "0")}";

class _PtmScheduleScreenState extends State<PtmScheduleScreen> {
  late final TextEditingController _name;
  final _note = TextEditingController();
  late String _date;
  String _endDate = "";
  String _mode = "in_person";
  final Set<String> _classIds = {};
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController();
    final today = DateTime.tryParse(widget.options.today) ?? DateTime.now();
    _date = _ymd(today);
    // One class to choose from: it is the choice.
    if (widget.options.classes.length == 1) {
      _classIds.add(widget.options.classes.first.id);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_name.text.isEmpty) _name.text = context.l10n.ptmScheduleNameDefault;
  }

  @override
  void dispose() {
    _name.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool end}) async {
    final first =
        DateTime.tryParse(end ? _date : widget.options.today) ?? DateTime.now();
    final current =
        DateTime.tryParse(end && _endDate.isNotEmpty ? _endDate : _date) ??
        first;
    final picked = await showDatePicker(
      context: context,
      initialDate: current.isBefore(first) ? first : current,
      firstDate: first,
      lastDate: first.add(const Duration(days: 366)),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (end) {
        _endDate = _ymd(picked);
      } else {
        _date = _ymd(picked);
        if (_endDate.isNotEmpty && _endDate.compareTo(_date) < 0) _endDate = "";
      }
    });
  }

  Future<void> _submit() async {
    final problem = ptmScheduleProblem(
      context,
      name: _name.text,
      date: _date,
      classIds: _classIds,
    );
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // Class order, as offered.
      final ids = [
        for (final c in widget.options.classes)
          if (_classIds.contains(c.id)) c.id,
      ];
      await widget.api.schedulePtm(
        name: _name.text.trim(),
        date: _date,
        endDate: _endDate,
        classIds: ids,
        mode: _mode,
        note: _note.text.trim(),
      );
      Haptics.success();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = context.l10n.homeCouldNotReachServerCheckConnection;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final classes = widget.options.classes;
    final allPicked = classes.isNotEmpty && _classIds.length == classes.length;
    final modes = [
      ("in_person", l.ptmModeInPerson),
      ("video", l.ptmModeVideo),
      ("phone", l.ptmModePhone),
    ];
    return Scaffold(
      appBar: AppBar(
        title: Text(l.ptmScheduleTitle, style: AppText.titleMedium),
      ),
      body: classes.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  l.ptmScheduleNoClasses,
                  textAlign: TextAlign.center,
                  style: AppText.bodyMediumMuted,
                ),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                TextField(
                  key: const Key("ptm-schedule-name"),
                  controller: _name,
                  maxLength: 120,
                  decoration: InputDecoration(labelText: l.ptmScheduleName),
                ),
                const SizedBox(height: 8),
                Text(l.ptmScheduleDate, style: AppText.labelMediumMuted),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      key: const Key("ptm-schedule-date"),
                      onPressed: _busy ? null : () => _pickDate(end: false),
                      icon: const Icon(Icons.event_outlined, size: 18),
                      label: Text(formatDateLabel(_date)),
                    ),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : () => _pickDate(end: true),
                      icon: const Icon(Icons.date_range_outlined, size: 18),
                      label: Text(
                        _endDate.isEmpty
                            ? l.ptmScheduleEndDate
                            : formatDateLabel(_endDate),
                      ),
                    ),
                    if (_endDate.isNotEmpty)
                      IconButton(
                        tooltip: l.mrClearMark,
                        onPressed: () => setState(() => _endDate = ""),
                        icon: const Icon(Icons.close, size: 18),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        l.ptmScheduleClasses,
                        style: AppText.labelMediumMuted,
                      ),
                    ),
                    if (classes.length > 1)
                      TextButton(
                        key: const Key("ptm-schedule-all"),
                        onPressed: _busy
                            ? null
                            : () => setState(() {
                                if (allPicked) {
                                  _classIds.clear();
                                } else {
                                  _classIds.addAll(classes.map((c) => c.id));
                                }
                              }),
                        child: Text(l.ptmScheduleSelectAll),
                      ),
                  ],
                ),
                Text(
                  widget.options.unrestricted
                      ? l.ptmScheduleClassesHintOffice
                      : l.ptmScheduleClassesHintTeacher,
                  style: AppText.bodySmallMuted,
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final c in classes)
                      FilterChip(
                        key: Key("ptm-class-${c.id}"),
                        selected: _classIds.contains(c.id),
                        label: Text(
                          c.sections.isEmpty
                              ? c.name
                              : "${c.name} (${c.sections})",
                        ),
                        onSelected: _busy
                            ? null
                            : (on) => setState(() {
                                if (on) {
                                  _classIds.add(c.id);
                                } else {
                                  _classIds.remove(c.id);
                                }
                              }),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(l.ptmScheduleMode, style: AppText.labelMediumMuted),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final m in modes)
                      ChoiceChip(
                        selected: _mode == m.$1,
                        label: Text(m.$2),
                        onSelected: _busy
                            ? null
                            : (_) => setState(() => _mode = m.$1),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _note,
                  maxLength: 500,
                  maxLines: 3,
                  minLines: 1,
                  decoration: InputDecoration(labelText: l.ptmScheduleNote),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      _error!,
                      key: const Key("ptm-schedule-error"),
                      style: AppText.bodySmall.copyWith(
                        color: AppColors.danger,
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  key: const Key("ptm-schedule-submit"),
                  onPressed: _busy ? null : _submit,
                  icon: _busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.event_available_outlined),
                  label: Text(l.ptmScheduleSave),
                ),
              ],
            ),
    );
  }
}
