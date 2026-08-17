import "dart:convert";

import "package:flutter/material.dart";
import "package:image_picker/image_picker.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// Photograph a textbook contents page and add the chapters to a plan.
///
/// The scan only ever *suggests*. Every detected row lands in a ticked,
/// editable list and nothing reaches the school's plan until the teacher
/// presses save — a misread page costs a correction, never a wrong
/// syllabus.
class SyllabusScanScreen extends StatefulWidget {
  const SyllabusScanScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<SyllabusScanScreen> createState() => _SyllabusScanScreenState();
}

class _SyllabusScanScreenState extends State<SyllabusScanScreen> {
  final _picker = ImagePicker();

  List<PlanTargetClass> _classes = const [];
  PlanTargetClass? _class;
  PlanTargetSubject? _subject;

  SyllabusScan? _scan;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadTargets();
  }

  Future<void> _loadTargets() async {
    setState(() => _error = null);
    try {
      final classes = await widget.api.fetchTeachingSubjects();
      if (mounted) setState(() => _classes = classes);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = "Could not reach the school server.");
    }
  }

  Future<void> _scanFrom(ImageSource source) async {
    setState(() => _error = null);
    final XFile? shot;
    try {
      shot = await _picker.pickImage(
        source: source,
        // A contents page is dense text; too small and OCR loses lines,
        // too large and the upload stalls on school wifi.
        maxWidth: 2200,
        imageQuality: 85,
      );
    } catch (_) {
      setState(() => _error = "Could not open the camera.");
      return;
    }
    if (shot == null) return;

    setState(() {
      _busy = true;
      _scan = null;
    });
    try {
      final bytes = await shot.readAsBytes();
      final scan = await widget.api.scanSyllabusPage(
        imageBase64: base64Encode(bytes),
        mimeType: shot.mimeType ?? "image/jpeg",
      );
      if (mounted) setState(() => _scan = scan);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = "Could not read that page.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    final scan = _scan;
    final cls = _class;
    final sub = _subject;
    if (scan == null || cls == null || sub == null) return;

    final chapters = [
      for (final c in scan.chapters)
        if (c.include && c.title.trim().isNotEmpty) c.toImportJson(),
    ];
    if (chapters.isEmpty) {
      setState(() => _error = "Nothing ticked to add.");
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final summary = await widget.api.importSyllabus(
        classId: cls.id,
        subjectId: sub.id,
        chapters: chapters,
      );
      if (!mounted) return;
      setState(() => _scan = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            "Added ${summary.chaptersAdded} chapter(s)"
            "${summary.topicsAdded > 0 ? " and ${summary.topicsAdded} topic(s)" : ""}"
            "${summary.skipped.isNotEmpty ? " · ${summary.skipped.length} already in the plan" : ""}",
          ),
        ),
      );
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool get _canScan => _class != null && _subject != null;

  @override
  Widget build(BuildContext context) {
    final scan = _scan;
    return Scaffold(
      appBar: AppBar(
        title: const Text("Scan syllabus", style: TextStyle(fontSize: 16)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            "Photograph the contents page of the textbook. Chapters and topics are detected for you to check before they are added.",
            style: TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<PlanTargetClass>(
            initialValue: _class,
            decoration: const InputDecoration(
              labelText: "Class",
              border: OutlineInputBorder(),
              isDense: true,
            ),
            items: [
              for (final c in _classes)
                DropdownMenuItem(value: c, child: Text(c.name)),
            ],
            onChanged: (v) => setState(() {
              _class = v;
              _subject = null;
            }),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<PlanTargetSubject>(
            initialValue: _subject,
            decoration: const InputDecoration(
              labelText: "Subject",
              border: OutlineInputBorder(),
              isDense: true,
            ),
            items: [
              for (final s in _class?.subjects ?? const <PlanTargetSubject>[])
                DropdownMenuItem(value: s, child: Text(s.name)),
            ],
            onChanged: (v) => setState(() => _subject = v),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed:
                      _canScan && !_busy ? () => _scanFrom(ImageSource.camera) : null,
                  icon: const Icon(Icons.photo_camera_outlined, size: 18),
                  label: const Text("Camera", style: TextStyle(fontSize: 13)),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed:
                      _canScan && !_busy ? () => _scanFrom(ImageSource.gallery) : null,
                  icon: const Icon(Icons.photo_library_outlined, size: 18),
                  label: const Text("Gallery", style: TextStyle(fontSize: 13)),
                ),
              ),
            ],
          ),
          if (!_canScan)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                "Pick the class and subject first.",
                style: TextStyle(fontSize: 11.5, color: AppColors.muted),
              ),
            ),
          if (_busy)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                _error!,
                style: const TextStyle(fontSize: 12.5, color: AppColors.danger),
              ),
            ),
          if (scan != null) ...[
            const SizedBox(height: 16),
            _VerdictBanner(verdict: scan.verdict, count: scan.chapters.length),
            const SizedBox(height: 10),
            for (final chapter in scan.chapters)
              _ChapterTile(
                chapter: chapter,
                onChanged: () => setState(() {}),
              ),
            if (scan.ignored.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  "${scan.ignored.length} line(s) on the page were not used.",
                  style: const TextStyle(
                      fontSize: 11.5, color: AppColors.muted),
                ),
              ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: const Text("Add to plan"),
            ),
            TextButton(
              onPressed: () => setState(() => _scan = null),
              child: const Text("Discard"),
            ),
          ],
        ],
      ),
    );
  }
}

class _VerdictBanner extends StatelessWidget {
  const _VerdictBanner({required this.verdict, required this.count});

  final String verdict;
  final int count;

  @override
  Widget build(BuildContext context) {
    final (String text, Color colour, Color background) = switch (verdict) {
      "good" => (
          "Found $count chapter(s). Check before saving.",
          AppColors.success,
          ModuleTone.teal.background
        ),
      "partial" => (
          "Read only partly — please check every row.",
          AppColors.warning,
          ModuleTone.amber.background
        ),
      _ => (
          "Nothing recognisable. Try a straighter, brighter photo of just the contents page.",
          AppColors.danger,
          ModuleTone.coral.background
        ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text,
        style: TextStyle(
            fontSize: 12.5, color: colour, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _ChapterTile extends StatelessWidget {
  const _ChapterTile({required this.chapter, required this.onChanged});

  final ScannedChapter chapter;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 4, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Checkbox(
                  value: chapter.include,
                  onChanged: (v) {
                    chapter.include = v ?? false;
                    onChanged();
                  },
                ),
                Expanded(
                  child: TextFormField(
                    initialValue: chapter.title,
                    onChanged: (v) => chapter.title = v,
                    style: const TextStyle(fontSize: 13.5),
                    decoration: const InputDecoration(
                      isDense: true,
                      border: InputBorder.none,
                    ),
                  ),
                ),
                if (chapter.confidence == "low")
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(
                      color: ModuleTone.amber.background,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Text(
                      "guess",
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: AppColors.warning,
                      ),
                    ),
                  ),
              ],
            ),
            for (final topic in chapter.topics)
              Padding(
                padding: const EdgeInsets.only(left: 20),
                child: Row(
                  children: [
                    Checkbox(
                      value: topic.include,
                      onChanged: (v) {
                        topic.include = v ?? false;
                        onChanged();
                      },
                    ),
                    Expanded(
                      child: TextFormField(
                        initialValue: topic.title,
                        onChanged: (v) => topic.title = v,
                        style: const TextStyle(
                            fontSize: 12.5, color: AppColors.muted),
                        decoration: const InputDecoration(
                          isDense: true,
                          border: InputBorder.none,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
