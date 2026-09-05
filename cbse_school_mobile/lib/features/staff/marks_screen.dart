import "package:flutter/material.dart";
import "package:flutter/services.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "section_picker.dart";

/// Marks entry from the phone: pick the exam, then a section you teach,
/// then a subject — the roster appears with one box per student. Saves one
/// subject at a time into the section's mark sheet on the exams desk; the
/// desk's max-marks rule and lock apply exactly as on the web.
class MarksScreen extends StatelessWidget {
  const MarksScreen({super.key, required this.api, required this.classes});

  final ApiClient api;
  final List<ClassRef> classes;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<ExamTermInfo>>(
      title: "Marks",
      subtitle: "Choose the exam",
      load: api.fetchExamTerms,
      emptyIcon: Icons.grading_outlined,
      emptyText:
          "No exam is set up for this year yet. The exams desk creates terms "
          "(unit tests, half-yearly, annual) and mark entry opens here.",
      isEmpty: (t) => t.isEmpty,
      builder: (context, terms, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final t in terms)
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: ModuleTone.amber.background,
                  child: Text(
                    t.code.isEmpty
                        ? "?"
                        : t.code.substring(0, t.code.length.clamp(0, 3)),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: ModuleTone.amber.foreground,
                    ),
                  ),
                ),
                title: Text(
                  t.label,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                subtitle: Text(
                  "Max ${t.maxMarks}${t.startsOn.isNotEmpty ? " · ${formatDateLabel(t.startsOn)}${t.endsOn.isNotEmpty && t.endsOn != t.startsOn ? " – ${formatDateLabel(t.endsOn)}" : ""}" : ""}"
                  "${t.sheetCount > 0 ? " · ${t.sheetCount} sheet${t.sheetCount == 1 ? "" : "s"} entered" : ""}",
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                trailing: const Icon(
                  Icons.chevron_right,
                  color: AppColors.muted,
                ),
                onTap: () => _pickSection(context, t),
              ),
            ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => DateSheetScreen(api: api)),
            ),
            icon: const Icon(Icons.event_note_outlined, size: 18),
            label: const Text("Exam date sheet"),
          ),
        ],
      ),
    );
  }

  Future<void> _pickSection(BuildContext context, ExamTermInfo term) async {
    final target = await showModalBottomSheet<(String, String, String)>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => SectionPicker(classes: classes),
    );
    if (target == null || !context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => MarkEntryScreen(
          api: api,
          term: term,
          classId: target.$1,
          sectionId: target.$2,
          title: target.$3,
        ),
      ),
    );
  }
}

class MarkEntryScreen extends StatefulWidget {
  const MarkEntryScreen({
    super.key,
    required this.api,
    required this.term,
    required this.classId,
    required this.sectionId,
    required this.title,
  });

  final ApiClient api;
  final ExamTermInfo term;
  final String classId;
  final String sectionId;
  final String title;

  @override
  State<MarkEntryScreen> createState() => _MarkEntryScreenState();
}

class _MarkEntryScreenState extends State<MarkEntryScreen> {
  MarkSheetInfo? _sheet;
  String? _error;
  String? _subjectId;
  final Map<String, TextEditingController> _ctl = {};
  bool _saving = false;
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _ctl.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final s = await widget.api.fetchMarkSheet(
        termId: widget.term.id,
        classId: widget.classId,
        sectionId: widget.sectionId,
      );
      if (!mounted) return;
      setState(() {
        _sheet = s;
        _subjectId ??= s.subjects.isEmpty ? null : s.subjects.first.id;
        _fill();
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted)
        setState(() => _error = "Could not reach the school server.");
    }
  }

  void _fill() {
    final s = _sheet;
    final sub = _subjectId;
    if (s == null || sub == null) return;
    for (final st in s.students) {
      final m = st.markFor(sub)?.marksObtained;
      final text = m == null
          ? ""
          : (m == m.roundToDouble() ? m.toInt().toString() : m.toString());
      final c = _ctl.putIfAbsent(st.id, () => TextEditingController());
      c.text = text;
    }
    _dirty = false;
  }

  ExamSubjectInfo? get _subject =>
      _sheet?.subjects.where((x) => x.id == _subjectId).firstOrNull;

  Future<void> _save() async {
    final s = _sheet;
    final sub = _subject;
    if (s == null || sub == null) return;
    final entries = <({String studentId, double? marks})>[];
    for (final st in s.students) {
      final raw = (_ctl[st.id]?.text ?? "").trim();
      if (raw.isEmpty) {
        entries.add((studentId: st.id, marks: null));
        continue;
      }
      final v = double.tryParse(raw);
      if (v == null || v < 0 || v > sub.maxMarks) {
        Haptics.warning();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              "${st.fullName}: enter 0–${sub.maxMarks} or leave blank for absent",
            ),
          ),
        );
        return;
      }
      entries.add((studentId: st.id, marks: v));
    }
    setState(() => _saving = true);
    try {
      await widget.api.saveMarks(
        termId: widget.term.id,
        classId: widget.classId,
        sectionId: widget.sectionId,
        subjectId: sub.id,
        marks: entries,
      );
      Haptics.success();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              "${sub.name} marks saved for ${entries.where((e) => e.marks != null).length} students.",
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _sheet;
    final sub = _subject;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "${widget.term.label} · ${widget.title}",
              style: const TextStyle(fontSize: 15),
            ),
            if (s != null)
              Text(
                s.locked
                    ? "Locked by the exams desk"
                    : "Blank = absent / not entered",
                style: TextStyle(
                  fontSize: 11,
                  color: s.locked ? AppColors.warning : AppColors.muted,
                ),
              ),
          ],
        ),
      ),
      body: s == null
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
                            child: const Text("Retry"),
                          ),
                        ],
                      ),
                    ),
            )
          : s.subjects.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  "No exam subjects are linked to this class yet. The exams desk links subjects from Masters.",
                  textAlign: TextAlign.center,
                ),
              ),
            )
          : Column(
              children: [
                SizedBox(
                  height: 48,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    children: [
                      for (final x in s.subjects)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text("${x.name} /${x.maxMarks}"),
                            selected: x.id == _subjectId,
                            onSelected: (_) async {
                              if (_dirty) {
                                final go = await showDialog<bool>(
                                  context: context,
                                  builder: (c) => AlertDialog(
                                    title: const Text("Discard unsaved marks?"),
                                    actions: [
                                      TextButton(
                                        onPressed: () =>
                                            Navigator.pop(c, false),
                                        child: const Text("Stay"),
                                      ),
                                      FilledButton(
                                        onPressed: () => Navigator.pop(c, true),
                                        child: const Text("Discard"),
                                      ),
                                    ],
                                  ),
                                );
                                if (go != true) return;
                              }
                              setState(() {
                                _subjectId = x.id;
                                _fill();
                              });
                            },
                          ),
                        ),
                    ],
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 90),
                    itemCount: s.students.length,
                    itemBuilder: (context, i) {
                      final st = s.students[i];
                      final m = sub == null ? null : st.markFor(sub.id);
                      return Card(
                        margin: const EdgeInsets.symmetric(vertical: 3),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
                          child: Row(
                            children: [
                              SizedBox(
                                width: 30,
                                child: Text(
                                  st.rollNo.isEmpty ? "–" : st.rollNo,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.muted,
                                  ),
                                ),
                              ),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      st.fullName,
                                      style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                        color: AppColors.ink,
                                      ),
                                    ),
                                    if ((m?.grade ?? "").isNotEmpty)
                                      Text(
                                        "Grade ${m!.grade}",
                                        style: const TextStyle(
                                          fontSize: 11,
                                          color: AppColors.muted,
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                              SizedBox(
                                width: 72,
                                child: TextField(
                                  controller: _ctl[st.id],
                                  enabled: !s.locked,
                                  textAlign: TextAlign.center,
                                  keyboardType:
                                      const TextInputType.numberWithOptions(
                                        decimal: true,
                                      ),
                                  inputFormatters: [
                                    FilteringTextInputFormatter.allow(
                                      RegExp(r"[0-9.]"),
                                    ),
                                  ],
                                  textInputAction: i == s.students.length - 1
                                      ? TextInputAction.done
                                      : TextInputAction.next,
                                  onChanged: (_) => _dirty = true,
                                  decoration: InputDecoration(
                                    isDense: true,
                                    hintText: "/${sub?.maxMarks ?? ""}",
                                    contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                      vertical: 10,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
      floatingActionButton: s == null || s.locked || s.subjects.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: _saving ? null : _save,
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.save_outlined),
              label: Text(_saving ? "Saving…" : "Save ${sub?.name ?? ""}"),
            ),
    );
  }
}

class DateSheetScreen extends StatelessWidget {
  const DateSheetScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<DateSheetRow>>(
      title: "Exam date sheet",
      load: () => api.fetchDateSheet(),
      emptyIcon: Icons.event_note_outlined,
      emptyText: "No date sheet has been published for this year yet.",
      isEmpty: (r) => r.isEmpty,
      builder: (context, rows, _) {
        final byDate = <String, List<DateSheetRow>>{};
        for (final r in rows) {
          byDate.putIfAbsent(r.date, () => []).add(r);
        }
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            for (final e in byDate.entries) ...[
              Padding(
                padding: const EdgeInsets.only(top: 6, bottom: 4),
                child: Text(
                  "${formatDateLabel(e.key)}${e.value.first.termLabel.isNotEmpty ? " · ${e.value.first.termLabel}" : ""}",
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Card(
                child: Column(
                  children: [
                    for (final r in e.value)
                      ListTile(
                        dense: true,
                        leading: SizedBox(
                          width: 54,
                          child: Text(
                            r.startTime,
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.muted,
                            ),
                          ),
                        ),
                        title: Text(
                          "${r.className} · ${r.subjectName}",
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppColors.ink,
                          ),
                        ),
                        subtitle: r.note.isEmpty && r.durationMinutes == 0
                            ? null
                            : Text(
                                "${r.durationMinutes > 0 ? "${r.durationMinutes} min" : ""}${r.note.isNotEmpty ? " · ${r.note}" : ""}",
                                style: const TextStyle(
                                  fontSize: 11.5,
                                  color: AppColors.muted,
                                ),
                              ),
                      ),
                  ],
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}
