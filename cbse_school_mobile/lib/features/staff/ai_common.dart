import "package:flutter/material.dart";
import "package:flutter/services.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";

/// Pieces shared by the teacher AI tool screens (13 Oct 2026).

/// The line every AI reply sits under: it is a suggestion, the teacher
/// decides. Shown above every draft, never dismissible.
class AiSuggestionBanner extends StatelessWidget {
  const AiSuggestionBanner({super.key, this.detail = ""});

  /// Extra line, e.g. which engine wrote it or what it could not see.
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: ModuleTone.amber.background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.auto_awesome,
            size: 18,
            color: ModuleTone.amber.foreground,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "AI suggestion — check it before you use it · AI सुझाव — इस्तेमाल से पहले जाँचें",
                  style: AppText.bodySmallInk.copyWith(
                    fontWeight: FontWeight.w600,
                    color: ModuleTone.amber.foreground,
                  ),
                ),
                if (detail.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(detail, style: AppText.bodySmallMuted),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// "The AI is writing…" with a Stop button — long calls take a minute.
class AiWorking extends StatelessWidget {
  const AiWorking({super.key, required this.message, required this.onStop});

  final String message;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const LinearProgressIndicator(color: AppColors.primary),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: AppText.bodyMediumInk,
            ),
            const SizedBox(height: 4),
            Text(
              "This can take up to a minute · इसमें एक मिनट तक लग सकता है",
              textAlign: TextAlign.center,
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: onStop,
              icon: const Icon(Icons.stop_circle_outlined, size: 18),
              label: const Text("Stop · रोकें"),
            ),
          ],
        ),
      ),
    );
  }
}

/// An error line with an optional retry.
class AiErrorCard extends StatelessWidget {
  const AiErrorCard({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFFFDECEA),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: AppColors.danger, size: 20),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: AppText.bodySmallInk)),
            if (onRetry != null)
              TextButton(onPressed: onRetry, child: const Text("Retry")),
          ],
        ),
      ),
    );
  }
}

/// Copy text to the clipboard and say so.
Future<void> aiCopy(BuildContext context, String text, String what) async {
  await Clipboard.setData(ClipboardData(text: text));
  Haptics.success();
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text("$what copied — paste it where you need it")),
    );
  }
}

/// Error text for a failed AI call.
String aiErrorText(Object e) {
  if (e is ApiException) return e.message;
  return "Could not reach the school server.";
}

/// Class → subject → chapters, from the server's list of what this teacher
/// may ask about (GET /api/v1/staff/ai/targets and /units). The chapters
/// are the school's own, mapped on the Teaching desk.
class AiClassSubjectChapters extends StatefulWidget {
  const AiClassSubjectChapters({
    super.key,
    required this.api,
    required this.onChanged,
    this.maxChapters = 12,
    this.enabled = true,
  });

  final ApiClient api;
  final int maxChapters;
  final bool enabled;

  /// (class, subject, picked chapter + topic ids) whenever any of them change.
  final void Function(
    AiTargetClass? cls,
    AiTargetSubject? subject,
    List<String> unitIds,
    List<AiChapter> pickedChapters,
  )
  onChanged;

  @override
  State<AiClassSubjectChapters> createState() => _AiClassSubjectChaptersState();
}

class _AiClassSubjectChaptersState extends State<AiClassSubjectChapters> {
  List<AiTargetClass>? _classes;
  String? _error;
  AiTargetClass? _class;
  AiTargetSubject? _subject;
  AiUnits? _units;
  bool _loadingUnits = false;
  String? _unitsError;
  final List<String> _picked = [];

  @override
  void initState() {
    super.initState();
    _loadTargets();
  }

  Future<void> _loadTargets() async {
    setState(() => _error = null);
    try {
      final c = await widget.api.fetchAiTargets();
      if (!mounted) return;
      setState(() {
        _classes = c;
        if (c.length == 1) _class = c.first;
        if (_class != null && _class!.subjects.length == 1) {
          _subject = _class!.subjects.first;
        }
      });
      if (_subject != null) _loadUnits();
      _emit();
    } catch (e) {
      if (mounted) setState(() => _error = aiErrorText(e));
    }
  }

  Future<void> _loadUnits() async {
    final cls = _class;
    final sub = _subject;
    if (cls == null || sub == null) return;
    setState(() {
      _loadingUnits = true;
      _unitsError = null;
      _units = null;
    });
    try {
      final u = await widget.api.fetchAiUnits(
        classId: cls.id,
        subjectId: sub.id,
      );
      if (mounted && _class?.id == cls.id && _subject?.id == sub.id) {
        setState(() => _units = u);
      }
    } catch (e) {
      if (mounted) setState(() => _unitsError = aiErrorText(e));
    } finally {
      if (mounted) setState(() => _loadingUnits = false);
    }
  }

  void _emit() {
    final chapters = _units?.chapters ?? const <AiChapter>[];
    widget.onChanged(
      _class,
      _subject,
      List.unmodifiable(_picked),
      chapters.where((c) => _picked.contains(c.id)).toList(),
    );
  }

  void _toggle(String id) {
    setState(() {
      if (_picked.contains(id)) {
        _picked.remove(id);
      } else if (_picked.length < widget.maxChapters) {
        _picked.add(id);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text("At most ${widget.maxChapters} chapters or topics"),
          ),
        );
      }
    });
    _emit();
  }

  @override
  Widget build(BuildContext context) {
    final classes = _classes;
    if (_error != null) {
      return AiErrorCard(message: _error!, onRetry: _loadTargets);
    }
    if (classes == null) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
      );
    }
    if (classes.isEmpty) {
      return const AiErrorCard(
        message:
            "No class or subject is linked to you yet — ask the office to add your classes (Staff → Duties).",
      );
    }
    final units = _units;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownButtonFormField<String>(
          initialValue: _class?.id,
          isExpanded: true,
          decoration: const InputDecoration(labelText: "Class · कक्षा"),
          items: [
            for (final c in classes)
              DropdownMenuItem(value: c.id, child: Text(c.name)),
          ],
          onChanged: !widget.enabled
              ? null
              : (id) {
                  setState(() {
                    _class = classes.firstWhere((c) => c.id == id);
                    _subject = _class!.subjects.length == 1
                        ? _class!.subjects.first
                        : null;
                    _units = null;
                    _picked.clear();
                  });
                  _emit();
                  if (_subject != null) _loadUnits();
                },
        ),
        const SizedBox(height: 8),
        if (_class != null)
          DropdownButtonFormField<String>(
            key: ValueKey("subject-${_class!.id}"),
            initialValue: _subject?.id,
            isExpanded: true,
            decoration: const InputDecoration(labelText: "Subject · विषय"),
            items: [
              for (final s in _class!.subjects)
                DropdownMenuItem(value: s.id, child: Text(s.name)),
            ],
            onChanged: !widget.enabled
                ? null
                : (id) {
                    setState(() {
                      _subject = _class!.subjects.firstWhere((s) => s.id == id);
                      _picked.clear();
                    });
                    _emit();
                    _loadUnits();
                  },
          ),
        if (_subject != null) ...[
          const SizedBox(height: 12),
          Text(
            "Chapters · अध्याय",
            style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 4),
          if (_loadingUnits)
            const LinearProgressIndicator(color: AppColors.primary)
          else if (_unitsError != null)
            AiErrorCard(message: _unitsError!, onRetry: _loadUnits)
          else if (units != null && !units.available)
            Text(
              "The Teaching plan could not be read (or is not set up). You can still go on — the AI will not name any chapter.",
              style: AppText.bodySmallMuted,
            )
          else if (units != null && units.chapters.isEmpty)
            Text(
              "No chapters are mapped for this subject yet (Teaching → Syllabus, or Scan syllabus). You can still go on — the AI will not name any chapter.",
              style: AppText.bodySmallMuted,
            )
          else if (units != null)
            for (final c in units.chapters) ...[
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _picked.contains(c.id),
                onChanged: widget.enabled ? (_) => _toggle(c.id) : null,
                title: Text(c.label, style: AppText.bodyMediumInk),
                subtitle: c.topics.isEmpty
                    ? null
                    : Text(
                        "${c.topics.length} topic${c.topics.length == 1 ? "" : "s"}",
                        style: AppText.labelMediumMuted,
                      ),
              ),
            ],
        ],
      ],
    );
  }
}
