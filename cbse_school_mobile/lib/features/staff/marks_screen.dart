import "package:flutter/material.dart";
import "../../core/guide/screen_guides.dart";
import "package:flutter/services.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "ai_answer_sheet_screen.dart";
import "section_picker.dart";
import "../../core/i18n/locale_controller.dart";

/// One editable column of the mark-entry grid: a whole-subject mark (empty
/// [component]) or one numeric part of a split subject (its code and label).
typedef MarkColumn = ({String component, String label, int max});

/// The columns to enter for one subject: one per numeric part when the
/// subject is marked in parts, otherwise a single whole-subject column. This
/// is why a split subject shows N fields and an ordinary subject shows one.
List<MarkColumn> markEntryColumns(ExamSubjectInfo sub) {
  if (!sub.isSplit) {
    return [(component: "", label: sub.name, max: sub.maxMarks)];
  }
  return [
    for (final p in sub.marksParts)
      (component: p.code, label: p.label, max: p.maxMarks),
  ];
}

/// Whether a typed value is acceptable for a column with the given [max].
/// Blank = absent / not entered (allowed); otherwise a number in 0..max.
/// Each part is checked against ITS own max, never a flat 100.
bool markEntryValid(String raw, int max) {
  final t = raw.trim();
  if (t.isEmpty) return true;
  final v = double.tryParse(t);
  return v != null && v >= 0 && v <= max;
}

/// The number a typed value stands for, or null for blank (absent).
double? parseMarkValue(String raw) {
  final t = raw.trim();
  if (t.isEmpty) return null;
  return double.tryParse(t);
}

/// The entries POSTed for one subject: one per student × column. A split
/// subject therefore posts a row per part (component set); an ordinary
/// subject posts one row with an empty component. [read] returns the typed
/// text for a (studentId, component) box. Validate with [markEntryValid]
/// before calling this.
List<({String studentId, String component, double? marks})> markEntriesFor(
  List<MarkColumn> cols,
  List<String> studentIds,
  String? Function(String studentId, String component) read,
) {
  final out = <({String studentId, String component, double? marks})>[];
  for (final id in studentIds) {
    for (final col in cols) {
      out.add((
        studentId: id,
        component: col.component,
        marks: parseMarkValue(read(id, col.component) ?? ""),
      ));
    }
  }
  return out;
}

/// The co-scholastic entries POSTed for one area: one grade per student.
/// [read] gives the picked grade for a studentId, where "" means unrated
/// (clear). The domain is the area's code, the same way the web desk stores it.
List<({String studentId, String domain, String rating})> coScholasticEntriesFor(
  String areaCode,
  List<String> studentIds,
  String? Function(String studentId) read,
) => [
  for (final id in studentIds)
    (studentId: id, domain: areaCode, rating: (read(id) ?? "").trim()),
];

/// Marks entry from the phone: pick the exam, then a section you teach,
/// then a subject — the roster appears with one box per student (or one box
/// per part, for a subject marked in parts). Saves one subject at a time into
/// the section's mark sheet on the exams desk; the desk's max-marks rule and
/// lock apply exactly as on the web.
class MarksScreen extends StatelessWidget {
  const MarksScreen({
    super.key,
    required this.api,
    required this.classes,
    this.canScan = false,
  });

  final ApiClient api;
  final List<ClassRef> classes;

  /// Offer "Scan answer sheet" on each child's row (the AI tools grant).
  final bool canScan;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<ExamTermInfo>>(
      guideId: "marks",
      title: "Marks",
      subtitle: "Choose the exam",
      load: api.fetchExamTerms,
      emptyIcon: Icons.grading_outlined,
      emptyText: context.l10n.noExamIsSetUpFor,
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
                    style: AppText.labelMedium.copyWith(
                      color: ModuleTone.amber.foreground,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                title: Text(
                  t.label,
                  style: AppText.bodyMediumInk.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: Text(
                  "Max ${t.maxMarks}${t.startsOn.isNotEmpty ? " · ${formatDateLabel(t.startsOn)}${t.endsOn.isNotEmpty && t.endsOn != t.startsOn ? " – ${formatDateLabel(t.endsOn)}" : ""}" : ""}"
                  "${t.sheetCount > 0 ? " · ${t.sheetCount} sheet${t.sheetCount == 1 ? "" : "s"} entered" : ""}",
                  style: AppText.bodySmallMuted,
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
            label: Text(context.l10n.examDateSheet),
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
          canScan: canScan,
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
    this.canScan = false,
  });

  final ApiClient api;
  final ExamTermInfo term;
  final String classId;
  final String sectionId;
  final String title;
  final bool canScan;

  @override
  State<MarkEntryScreen> createState() => _MarkEntryScreenState();
}

class _MarkEntryScreenState extends State<MarkEntryScreen> {
  MarkSheetInfo? _sheet;
  String? _error;
  String? _subjectId;

  /// The co-scholastic area code being graded, or null when a scholastic
  /// subject is selected. Exactly one of [_subjectId] / [_coschArea] is set.
  String? _coschArea;

  /// studentId → picked grade for the current co-scholastic area ("" = unrated).
  final Map<String, String> _coschSel = {};

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
        if (_subjectId == null && _coschArea == null) {
          if (s.subjects.isNotEmpty) {
            _subjectId = s.subjects.first.id;
          } else if (s.coScholasticAreas.isNotEmpty) {
            _coschArea = s.coScholasticAreas.first.code;
          }
        }
        _fill();
        _fillCosch();
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    }
  }

  /// Controller key: one text box per student × column, so a split subject's
  /// parts never share a box.
  String _ck(String studentId, String component) => "$studentId\u0000$component";

  String _fmt(double? v) => v == null
      ? ""
      : (v == v.roundToDouble() ? v.toInt().toString() : v.toString());

  void _fill() {
    final s = _sheet;
    final sub = _subject;
    if (s == null || sub == null) return;
    final cols = markEntryColumns(sub);
    for (final st in s.students) {
      final mark = st.markFor(sub.id);
      for (final col in cols) {
        final v = col.component.isEmpty
            ? mark?.marksObtained
            : mark?.partMark(col.component);
        final c = _ctl.putIfAbsent(
          _ck(st.id, col.component),
          () => TextEditingController(),
        );
        c.text = _fmt(v);
      }
    }
    _dirty = false;
  }

  /// Pre-fill the grade pickers for the current co-scholastic area with what
  /// is already stored (empty = not yet rated). Never guesses a grade.
  void _fillCosch() {
    final s = _sheet;
    final area = _coschArea;
    if (s == null || area == null) return;
    for (final st in s.students) {
      _coschSel[st.id] = st.coScholasticGrade(area);
    }
  }

  ExamSubjectInfo? get _subject =>
      _sheet?.subjects.where((x) => x.id == _subjectId).firstOrNull;

  CoScholasticAreaInfo? get _area =>
      _sheet?.coScholasticAreas.where((x) => x.code == _coschArea).firstOrNull;

  /// The grade of the currently selected chip for the Save button / title.
  String get _selectionName =>
      _coschArea != null ? (_area?.label ?? "") : (_subject?.name ?? "");

  /// Offer to discard unsaved edits before switching chips. Returns whether
  /// to proceed.
  Future<bool> _confirmDiscard() async {
    if (!_dirty) return true;
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(context.l10n.discardUnsavedMarks),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: Text(context.l10n.stay),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: Text(context.l10n.discard),
          ),
        ],
      ),
    );
    return go == true;
  }

  Future<void> _selectSubject(String id) async {
    if (!await _confirmDiscard() || !mounted) return;
    setState(() {
      _subjectId = id;
      _coschArea = null;
      _fill();
    });
  }

  Future<void> _selectCosch(String code) async {
    if (!await _confirmDiscard() || !mounted) return;
    setState(() {
      _coschArea = code;
      _subjectId = null;
      _fillCosch();
      _dirty = false;
    });
  }

  /// Save the current co-scholastic area's grades. The dropdown only offers
  /// letters the server sent, so nothing off-scale can be picked here; the
  /// server validates again and is the final word.
  Future<void> _saveCosch() async {
    final s = _sheet;
    final areaCode = _coschArea;
    if (s == null || areaCode == null) return;
    final areaLabel = _area?.label ?? areaCode;
    final grades = coScholasticEntriesFor(
      areaCode,
      [for (final st in s.students) st.id],
      (id) => _coschSel[id],
    );
    setState(() => _saving = true);
    try {
      await widget.api.saveCoScholastic(
        termId: widget.term.id,
        classId: widget.classId,
        sectionId: widget.sectionId,
        grades: grades,
      );
      Haptics.success();
      await _load();
      if (mounted) {
        final rated = grades.where((g) => g.rating.isNotEmpty).length;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              context.l10n.coScholasticGradesSaved(areaLabel, rated.toString()),
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _save() async {
    final s = _sheet;
    final sub = _subject;
    if (s == null || sub == null) return;
    final cols = markEntryColumns(sub);
    for (final st in s.students) {
      for (final col in cols) {
        final raw = (_ctl[_ck(st.id, col.component)]?.text ?? "").trim();
        if (!markEntryValid(raw, col.max)) {
          Haptics.warning();
          final who = col.component.isEmpty
              ? st.fullName
              : "${st.fullName} · ${col.label}";
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                context.l10n.markEntryRangeHint(who, col.max.toString()),
              ),
            ),
          );
          return;
        }
      }
    }
    final entries = markEntriesFor(
      cols,
      [for (final st in s.students) st.id],
      (id, comp) => _ctl[_ck(id, comp)]?.text,
    );
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
        final savedStudents = entries
            .where((e) => e.marks != null)
            .map((e) => e.studentId)
            .toSet()
            .length;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              "${sub.name} marks saved for $savedStudents students.",
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// The AI reads the child's sheet; the confirmed total lands in their box
  /// and is saved only with the screen's own Save, like a typed mark.
  Future<void> _scan(MarkSheetStudent st, ExamSubjectInfo sub) async {
    final total = await Navigator.of(context).push<double>(
      MaterialPageRoute(
        builder: (_) => AnswerSheetScanScreen(
          api: widget.api,
          termId: widget.term.id,
          classId: widget.classId,
          sectionId: widget.sectionId,
          subjectCode: sub.code,
          subjectName: sub.name,
          subjectMax: sub.maxMarks,
          studentId: st.id,
          studentName: st.fullName,
        ),
      ),
    );
    if (total == null || !mounted) return;
    setState(() {
      _ctl.putIfAbsent(_ck(st.id, ""), () => TextEditingController()).text =
          _fmt(total);
      _dirty = true;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          "${st.fullName}: ${_ctl[_ck(st.id, "")]!.text} filled in — press Save ${sub.name} to save it.",
        ),
      ),
    );
  }

  /// One numeric box for a student × column. [component] is "" for the whole
  /// subject or a part code; [hint] shows the max ("/80").
  Widget _markBox({
    required String studentId,
    required String component,
    required String hint,
    required bool locked,
    bool last = false,
  }) {
    return TextField(
      controller: _ctl.putIfAbsent(
        _ck(studentId, component),
        () => TextEditingController(),
      ),
      enabled: !locked,
      textAlign: TextAlign.center,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r"[0-9.]"))],
      textInputAction: last ? TextInputAction.done : TextInputAction.next,
      onChanged: (_) => _dirty = true,
      decoration: InputDecoration(
        isDense: true,
        hintText: hint,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      ),
    );
  }

  /// A labelled box for one numeric part of a split subject: "Written /80".
  Widget _partBox(String studentId, ExamComponentInfo part, bool locked) {
    return SizedBox(
      width: 92,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "${part.label} /${part.maxMarks}",
            style: AppText.labelMediumMuted,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 2),
          _markBox(
            studentId: studentId,
            component: part.code,
            hint: "/${part.maxMarks}",
            locked: locked,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = _sheet;
    final sub = _subject;
    return Scaffold(
      appBar: AppBar(
        actions: [
          ScreenGuideButton(guideId: "mark-entry", screenLabel: "mark-entry"),
        ],
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "${widget.term.label} · ${widget.title}",
              style: AppText.titleSmall,
            ),
            if (s != null)
              Text(
                s.locked
                    ? "Locked by the exams desk"
                    : "Blank = absent / not entered",
                style: AppText.labelMedium.copyWith(
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
                            child: Text(context.l10n.retry),
                          ),
                        ],
                      ),
                    ),
            )
          : s.subjects.isEmpty && s.coScholasticAreas.isEmpty
          ? Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  context.l10n.noExamSubjectsAreLinkedTo,
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
                            selected: _coschArea == null && x.id == _subjectId,
                            onSelected: (_) => _selectSubject(x.id),
                          ),
                        ),
                      // Co-scholastic subjects / activities are graded, not
                      // marked — a chip each, alongside the scholastic ones.
                      for (final a in s.coScholasticAreas)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            avatar: Icon(
                              Icons.workspace_premium_outlined,
                              size: 16,
                              color: _coschArea == a.code
                                  ? ModuleTone.amber.foreground
                                  : AppColors.muted,
                            ),
                            label: Text(a.label),
                            selected: _coschArea == a.code,
                            onSelected: (_) => _selectCosch(a.code),
                          ),
                        ),
                    ],
                  ),
                ),
                Expanded(
                  child: _coschArea != null
                      ? _coschBody(s)
                      : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 90),
                    itemCount: s.students.length,
                    itemBuilder: (context, i) {
                      final st = s.students[i];
                      final m = sub == null ? null : st.markFor(sub.id);
                      final split = sub != null && sub.isSplit;
                      final nameCol = Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            st.fullName,
                            style: AppText.bodyMediumInk.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (!split && (m?.grade ?? "").isNotEmpty)
                            Text(
                              "Grade ${m!.grade}",
                              style: AppText.labelMediumMuted,
                            ),
                        ],
                      );
                      final rollBox = SizedBox(
                        width: 30,
                        child: Text(
                          st.rollNo.isEmpty ? "–" : st.rollNo,
                          style: AppText.bodySmallMuted.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      );
                      return Card(
                        margin: const EdgeInsets.symmetric(vertical: 3),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                          child: split
                              ? Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        rollBox,
                                        Expanded(child: nameCol),
                                      ],
                                    ),
                                    const SizedBox(height: 6),
                                    Wrap(
                                      spacing: 12,
                                      runSpacing: 6,
                                      children: [
                                        for (final p in sub.marksParts)
                                          _partBox(st.id, p, s.locked),
                                      ],
                                    ),
                                  ],
                                )
                              : Row(
                                  children: [
                                    rollBox,
                                    Expanded(child: nameCol),
                                    if (widget.canScan &&
                                        !s.locked &&
                                        sub != null &&
                                        sub.code.isNotEmpty)
                                      IconButton(
                                        tooltip: "Scan answer sheet (AI)",
                                        visualDensity: VisualDensity.compact,
                                        onPressed: () => _scan(st, sub),
                                        icon: const Icon(
                                          Icons.document_scanner_outlined,
                                          size: 20,
                                          color: AppColors.primary,
                                        ),
                                      ),
                                    SizedBox(
                                      width: 72,
                                      child: _markBox(
                                        studentId: st.id,
                                        component: "",
                                        hint: "/${sub?.maxMarks ?? ""}",
                                        locked: s.locked,
                                        last: i == s.students.length - 1,
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
      floatingActionButton:
          s == null ||
              s.locked ||
              (s.subjects.isEmpty && s.coScholasticAreas.isEmpty)
          ? null
          : _coschArea != null
          // No save when the grade scale could not be read — nothing to pick.
          ? (s.coScholasticGrades.isEmpty
                ? null
                : FloatingActionButton.extended(
                    onPressed: _saving ? null : _saveCosch,
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    icon: const Icon(Icons.save_outlined),
                    label: Text(
                      _saving ? "Saving…" : "Save $_selectionName",
                    ),
                  ))
          : FloatingActionButton.extended(
              onPressed: _saving ? null : _save,
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.save_outlined),
              label: Text(_saving ? "Saving…" : "Save ${sub?.name ?? ""}"),
            ),
    );
  }

  /// The co-scholastic grading list: a grade picker per student. Shows
  /// "not loaded" rather than empty pickers if the scheme's scale is missing.
  Widget _coschBody(MarkSheetInfo s) {
    final grades = s.coScholasticGrades;
    if (grades.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            context.l10n.coScholasticGradesNotLoaded,
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 90),
      itemCount: s.students.length,
      itemBuilder: (context, i) => _coschRow(s.students[i], grades, s.locked),
    );
  }

  /// One student's co-scholastic row: roll, name, and a grade dropdown whose
  /// options are exactly the letters the server sent, plus "absent" and
  /// "not rated". A stored letter off the current scale is still shown.
  Widget _coschRow(MarkSheetStudent st, List<String> grades, bool locked) {
    final sel = _coschSel[st.id] ?? "";
    final items = <DropdownMenuItem<String>>[
      DropdownMenuItem(value: "", child: Text("—", style: AppText.bodyMediumMuted)),
      for (final g in grades) DropdownMenuItem(value: g, child: Text(g)),
      DropdownMenuItem(value: "AB", child: Text(context.l10n.coScholasticAbsent)),
      if (sel.isNotEmpty && sel != "AB" && !grades.contains(sel))
        DropdownMenuItem(value: sel, child: Text(sel)),
    ];
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 3),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
        child: Row(
          children: [
            SizedBox(
              width: 30,
              child: Text(
                st.rollNo.isEmpty ? "–" : st.rollNo,
                style: AppText.bodySmallMuted.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Expanded(
              child: Text(
                st.fullName,
                style: AppText.bodyMediumInk.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            SizedBox(
              width: 104,
              child: DropdownButtonFormField<String>(
                key: ValueKey("${st.id}|$_coschArea|$sel"),
                initialValue: sel,
                isDense: true,
                decoration: const InputDecoration(
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 10,
                  ),
                ),
                items: items,
                onChanged: locked
                    ? null
                    : (v) => setState(() {
                        _coschSel[st.id] = v ?? "";
                        _dirty = true;
                      }),
              ),
            ),
          ],
        ),
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
      guideId: "date-sheet",
      title: "Exam date sheet",
      load: () => api.fetchDateSheet(),
      emptyIcon: Icons.event_note_outlined,
      emptyText: context.l10n.noDateSheetHasBeenPublished,
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
                  style: AppText.bodyMediumInk.copyWith(
                    fontWeight: FontWeight.w700,
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
                            style: AppText.bodySmallMuted,
                          ),
                        ),
                        title: Text(
                          "${r.className} · ${r.subjectName}",
                          style: AppText.bodyMediumInk,
                        ),
                        subtitle: r.note.isEmpty && r.durationMinutes == 0
                            ? null
                            : Text(
                                "${r.durationMinutes > 0 ? "${r.durationMinutes} min" : ""}${r.note.isNotEmpty ? " · ${r.note}" : ""}",
                                style: AppText.labelMediumMuted,
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
