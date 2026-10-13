import "dart:convert";

import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:image_picker/image_picker.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "ai_common.dart";

/// Photograph a child's answer sheet → the AI suggests marks per question
/// → the teacher checks every one → the total goes back into the marks
/// grid. The web's Scan sheet (Exams → Mark entry), on the phone.
///
/// Nothing is saved here. "Use this total" only fills the child's box on the
/// marks screen; the teacher still presses that screen's Save. A question
/// the AI could not mark stays BLANK and the total cannot be used until the
/// teacher has filled it — an unread answer never silently counts as zero.
class AnswerSheetScanScreen extends StatefulWidget {
  const AnswerSheetScanScreen({
    super.key,
    required this.api,
    required this.termId,
    required this.classId,
    required this.sectionId,
    required this.subjectCode,
    required this.subjectName,
    required this.subjectMax,
    required this.studentId,
    required this.studentName,
  });

  final ApiClient api;
  final String termId;
  final String classId;
  final String sectionId;
  final String subjectCode;
  final String subjectName;
  final int subjectMax;
  final String studentId;
  final String studentName;

  @override
  State<AnswerSheetScanScreen> createState() => _AnswerSheetScanScreenState();
}

class _Page {
  _Page(this.bytes);
  final Uint8List bytes;
}

/// Longest edge sent — handwriting stays legible, the upload stays small
/// (the web shrinks to the same 1600 px).
const _maxEdge = 1600.0;
const _maxPages = 8;

class _AnswerSheetScanScreenState extends State<AnswerSheetScanScreen> {
  final _picker = ImagePicker();
  List<AnswerSheetPaper>? _papers;
  String? _papersError;
  AnswerSheetPaper? _paper;
  String _setCode = "";
  final List<_Page> _pages = [];

  AiCall? _call;
  String? _error;
  AnswerSheetReading? _reading;
  final Map<String, TextEditingController> _marks = {};
  bool _reported = false;

  @override
  void initState() {
    super.initState();
    _loadPapers();
  }

  @override
  void dispose() {
    _call?.cancel();
    for (final c in _marks.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadPapers() async {
    setState(() => _papersError = null);
    try {
      final p = await widget.api.fetchAnswerSheetPapers(
        classId: widget.classId,
        sectionId: widget.sectionId,
        subjectCode: widget.subjectCode,
        termId: widget.termId,
      );
      if (!mounted) return;
      setState(() {
        _papers = p;
        if (p.isNotEmpty) _pickPaper(p.first);
      });
    } catch (e) {
      if (mounted) setState(() => _papersError = aiErrorText(e));
    }
  }

  void _pickPaper(AnswerSheetPaper p) {
    _paper = p;
    final active = p.sets.where((s) => s.setCode == p.activeSetCode);
    _setCode = active.isNotEmpty
        ? active.first.setCode
        : (p.sets.isEmpty ? "" : p.sets.first.setCode);
  }

  AnswerSheetSet? get _set =>
      _paper?.sets.where((s) => s.setCode == _setCode).firstOrNull;

  Future<void> _addPage(ImageSource source) async {
    if (_pages.length >= _maxPages) return;
    try {
      if (source == ImageSource.gallery) {
        final shots = await _picker.pickMultiImage(
          maxWidth: _maxEdge,
          maxHeight: _maxEdge,
          imageQuality: 82,
        );
        for (final s in shots.take(_maxPages - _pages.length)) {
          _pages.add(_Page(await s.readAsBytes()));
        }
      } else {
        final shot = await _picker.pickImage(
          source: source,
          maxWidth: _maxEdge,
          maxHeight: _maxEdge,
          imageQuality: 82,
        );
        if (shot != null) _pages.add(_Page(await shot.readAsBytes()));
      }
      if (mounted) setState(() {});
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not open the camera or photos.");
      }
    }
  }

  void _reject() {
    final r = _reading;
    if (r != null && !_reported) {
      _reported = true;
      widget.api.reportAiOutcome(
        ids: [r.generationId],
        outcome: "rejected",
        targetType: "answer_sheet",
        targetId: widget.studentId,
      );
    }
  }

  Future<void> _read() async {
    final paper = _paper;
    if (paper == null || _pages.isEmpty || _call != null) return;
    // A second reading replaces the first; the first was not used.
    _reject();
    final call = AiCall();
    setState(() {
      _call = call;
      _error = null;
    });
    try {
      final r = await widget.api.readAnswerSheet(
        paperId: paper.id,
        setCode: _setCode,
        studentId: widget.studentId,
        classId: widget.classId,
        sectionId: widget.sectionId,
        subjectCode: widget.subjectCode,
        pagesBase64: [for (final p in _pages) base64Encode(p.bytes)],
        call: call,
      );
      if (!mounted) return;
      for (final c in _marks.values) {
        c.dispose();
      }
      _marks.clear();
      for (final q in r.questions) {
        final shown = q.shown;
        _marks[q.questionId] = TextEditingController(
          text: shown == null ? "" : _fmt(shown),
        );
      }
      setState(() {
        _reading = r;
        _reported = false;
      });
    } on AiCancelled {
      /* teacher pressed Stop */
    } catch (e) {
      if (mounted) setState(() => _error = aiErrorText(e));
    } finally {
      if (mounted) setState(() => _call = null);
    }
  }

  String _fmt(double m) =>
      m == m.roundToDouble() ? m.toInt().toString() : m.toString();

  Map<String, double?> get _final => {
    for (final e in _marks.entries) e.key: double.tryParse(e.value.text.trim()),
  };

  Future<void> _use() async {
    final r = _reading;
    if (r == null) return;
    final t = answerSheetTotals(r.questions, _final);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text("Use ${_fmt(t.total)} / ${widget.subjectMax}?"),
        content: Text(
          "${widget.studentName}'s ${widget.subjectName} box will show ${_fmt(t.total)}. "
          "It is saved only when you press Save on the marks screen.\n\n"
          "${widget.studentName} का ${widget.subjectName} अंक ${_fmt(t.total)} भरा जाएगा — "
          "अंक स्क्रीन पर Save दबाने पर ही सहेजा जाएगा।",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text("Check again"),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text("Use total"),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    _reported = true;
    widget.api.reportAiOutcome(
      ids: [r.generationId],
      outcome: answerSheetOutcome(r.questions, _final),
      targetType: "answer_sheet",
      targetId: widget.studentId,
    );
    Haptics.success();
    Navigator.of(context).pop(t.total);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) {
          _call?.cancel();
          _reject();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          actions: const [
            ScreenGuideButton(
              guideId: "ai-answer-sheet",
              screenLabel: "ai-answer-sheet",
            ),
          ],
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                "Scan answer sheet · उत्तर पुस्तिका",
                style: AppText.titleSmall,
              ),
              Text(
                "${widget.studentName} · ${widget.subjectName}",
                style: AppText.labelMediumMuted,
              ),
            ],
          ),
        ),
        body: _reading == null ? _setup() : _review(_reading!),
      ),
    );
  }

  Widget _setup() {
    final papers = _papers;
    final set = _set;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_papersError != null)
          AiErrorCard(message: _papersError!, onRetry: _loadPapers)
        else if (papers == null)
          const LinearProgressIndicator(color: AppColors.primary)
        else if (papers.isEmpty)
          const AiErrorCard(
            message:
                "No question paper for this class and subject is on the exams desk, so there is nothing to mark against. Mark this sheet by hand.",
          )
        else ...[
          DropdownButtonFormField<String>(
            initialValue: _paper?.id,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: "Question paper · प्रश्न-पत्र",
            ),
            items: [
              for (final p in papers)
                DropdownMenuItem(
                  value: p.id,
                  child: Text(
                    "${p.label}${p.termMatch ? " · this exam" : ""}",
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: _call != null
                ? null
                : (id) => setState(
                    () => _pickPaper(papers.firstWhere((p) => p.id == id)),
                  ),
          ),
          if ((_paper?.sets.length ?? 0) > 1) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: [
                for (final s in _paper!.sets)
                  ChoiceChip(
                    label: Text("Set ${s.setCode}"),
                    selected: s.setCode == _setCode,
                    onSelected: _call != null
                        ? null
                        : (_) => setState(() => _setCode = s.setCode),
                  ),
              ],
            ),
          ],
          if (set != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                "${set.questionCount} questions · ${set.keyedCount} with an answer key · out of ${_fmt(set.maxTotal)}",
                style: set.keyedCount < set.questionCount
                    ? AppText.bodySmallMuted.copyWith(color: AppColors.warning)
                    : AppText.bodySmallMuted,
              ),
            ),
        ],
        const SizedBox(height: 16),
        Text(
          "Pages (${_pages.length}/$_maxPages) · पन्ने",
          style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        if (_pages.isNotEmpty)
          SizedBox(
            height: 120,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _pages.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (_, i) => Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.memory(
                      _pages[i].bytes,
                      height: 120,
                      width: 90,
                      fit: BoxFit.cover,
                    ),
                  ),
                  Positioned(
                    left: 4,
                    top: 4,
                    child: CircleAvatar(
                      radius: 11,
                      backgroundColor: Colors.black54,
                      child: Text(
                        "${i + 1}",
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ),
                  if (_call == null)
                    Positioned(
                      right: 0,
                      top: 0,
                      child: IconButton(
                        tooltip: "Remove page",
                        icon: const Icon(Icons.cancel, color: Colors.white),
                        onPressed: () => setState(() => _pages.removeAt(i)),
                      ),
                    ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _call != null || _pages.length >= _maxPages
                    ? null
                    : () => _addPage(ImageSource.camera),
                icon: const Icon(Icons.photo_camera_outlined, size: 18),
                label: const Text("Camera"),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _call != null || _pages.length >= _maxPages
                    ? null
                    : () => _addPage(ImageSource.gallery),
                icon: const Icon(Icons.photo_library_outlined, size: 18),
                label: const Text("Photos"),
              ),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            "Photograph every page in order, flat and in good light.",
            style: AppText.bodySmallMuted,
          ),
        ),
        const SizedBox(height: 16),
        if (_error != null) AiErrorCard(message: _error!),
        if (_call != null)
          AiWorking(
            message:
                "Reading ${_pages.length} page${_pages.length == 1 ? "" : "s"}…",
            onStop: () => _call?.cancel(),
          )
        else
          FilledButton.icon(
            onPressed: _paper == null || _pages.isEmpty ? null : _read,
            icon: const Icon(Icons.document_scanner_outlined),
            label: const Text("Read the sheet · पढ़ें"),
          ),
      ],
    );
  }

  Widget _review(AnswerSheetReading r) {
    final t = answerSheetTotals(r.questions, _final);
    final canUse = t.blanks == 0 && t.over == 0 && t.total <= widget.subjectMax;
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
            children: [
              AiSuggestionBanner(
                detail: r.unknownCount > 0
                    ? "${r.unknownCount} question${r.unknownCount == 1 ? "" : "s"} could not be marked — fill the highlighted boxes yourself."
                    : "Check each mark against the sheet before you use the total.",
              ),
              const SizedBox(height: 8),
              for (final q in r.questions) _questionCard(q),
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  "Total ${_fmt(t.total)} / ${_fmt(r.maxTotal)}"
                  "${t.blanks > 0 ? " · ${t.blanks} blank" : ""}"
                  "${t.over > 0 ? " · ${t.over} out of range" : ""}"
                  "${t.total > widget.subjectMax ? " · more than ${widget.subjectMax}" : ""}",
                  style: AppText.bodyMediumInk.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    OutlinedButton(
                      onPressed: () {
                        _reject();
                        setState(() => _reading = null);
                      },
                      child: const Text("Back to photos"),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton(
                        onPressed: canUse ? _use : null,
                        child: Text("Use this total · ${_fmt(t.total)}"),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _questionCard(AnswerSheetQuestion q) {
    final ctl = _marks[q.questionId]!;
    final blank = ctl.text.trim().isEmpty;
    final conf = switch (q.confidence) {
      "high" => ("Sure", AppColors.success),
      "medium" => ("Check", AppColors.warning),
      _ => ("Unsure", AppColors.danger),
    };
    return Card(
      color: blank ? const Color(0xFFFFF4E5) : null,
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Q${q.number} · out of ${_fmt(q.maxMarks)}${q.hasKey ? "" : " · no key"}",
                    style: AppText.bodyMediumInk.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (q.text.isNotEmpty)
                    Text(
                      q.text,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.bodySmallMuted,
                    ),
                  const SizedBox(height: 4),
                  Text(
                    q.readAnswer.isEmpty
                        ? "Read: (nothing read)"
                        : "Read: ${q.readAnswer}",
                    style: AppText.bodySmallInk,
                  ),
                  if (q.reason.isNotEmpty)
                    Text("Why: ${q.reason}", style: AppText.bodySmallMuted),
                  if (!q.needsTeacher && q.suggestedMarks != null)
                    Text(
                      conf.$1,
                      style: AppText.labelMedium.copyWith(color: conf.$2),
                    ),
                  if (q.needsTeacher)
                    Text(
                      "You decide · आप तय करें",
                      style: AppText.labelMedium.copyWith(
                        color: AppColors.warning,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 64,
              child: TextField(
                controller: ctl,
                textAlign: TextAlign.center,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r"[0-9.]")),
                ],
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: "/${_fmt(q.maxMarks)}",
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
