import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";

/// After the class: the teacher says in a line what was taught, the ERP
/// writes the note and suggests homework, the teacher edits and posts it.
class OnlineClassSummaryScreen extends StatefulWidget {
  const OnlineClassSummaryScreen({super.key, required this.api, required this.c});

  final ApiClient api;
  final StaffOnlineClass c;

  @override
  State<OnlineClassSummaryScreen> createState() => _OnlineClassSummaryScreenState();
}

class _OnlineClassSummaryScreenState extends State<OnlineClassSummaryScreen> {
  final _taught = TextEditingController();
  final _topic = TextEditingController();
  final _summary = TextEditingController();
  final _hwTitle = TextEditingController();
  final _hwBody = TextEditingController();
  String _hwDue = "";
  bool _loaded = false;
  bool _canPost = false;
  bool _hasDraft = false;
  bool _posted = false;
  String _busy = "";
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [_taught, _topic, _summary, _hwTitle, _hwBody]) {
      c.dispose();
    }
    super.dispose();
  }

  void _apply(ClassSummaryInfo s) {
    _taught.text = s.taughtNote;
    _topic.text = s.topic;
    _summary.text = s.summaryEn;
    _hwTitle.text = s.homeworkTitle;
    _hwBody.text = s.homeworkBody;
    _hwDue = s.homeworkDue;
    _hasDraft = s.generatedAt.isNotEmpty || s.summaryEn.isNotEmpty;
    _posted = s.posted;
  }

  Future<void> _load() async {
    try {
      final r = await widget.api.fetchOnlineClassSummary(widget.c.id);
      if (!mounted) return;
      setState(() {
        _canPost = r.canPost;
        if (r.summary != null) _apply(r.summary!);
        _loaded = true;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loaded = true;
        });
      }
    }
  }

  Future<void> _generate() async {
    setState(() {
      _busy = "generate";
      _error = null;
    });
    try {
      final s = await widget.api.generateOnlineClassSummary(widget.c.id, _taught.text.trim());
      Haptics.success();
      if (mounted) setState(() => _apply(s));
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = "");
    }
  }

  Future<bool> _save() async {
    setState(() {
      _busy = "save";
      _error = null;
    });
    try {
      final s = await widget.api.saveOnlineClassSummary(widget.c.id, {
        "taughtNote": _taught.text.trim(),
        "topic": _topic.text.trim(),
        "summaryEn": _summary.text.trim(),
        "homeworkTitle": _hwTitle.text.trim(),
        "homeworkBody": _hwBody.text.trim(),
        "homeworkDue": _hwDue,
      });
      if (mounted) setState(() => _apply(s));
      return true;
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
      return false;
    } finally {
      if (mounted) setState(() => _busy = "");
    }
  }

  Future<void> _post() async {
    if (!await _save()) return;
    setState(() => _busy = "post");
    try {
      final s = await widget.api.postOnlineClassHomework(widget.c.id);
      Haptics.success();
      if (!mounted) return;
      setState(() => _apply(s));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Homework posted to ${widget.c.sectionLabel}'s diary")),
      );
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = "");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text("Class summary · ${widget.c.sectionLabel}")),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                Text(
                  "${widget.c.heading} · ${widget.c.date} ${widget.c.startTime}",
                  style: AppText.labelMediumMuted,
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _taught,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: "What did you teach? (one or two lines)",
                    hintText: "e.g. Adding fractions with different denominators; LCM method",
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton.tonal(
                  onPressed: _busy.isNotEmpty ? null : _generate,
                  child: Text(_busy == "generate"
                      ? "Writing…"
                      : _hasDraft
                          ? "Write again"
                          : "Write the note & suggest homework"),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!, style: TextStyle(color: AppColors.warning)),
                ],
                if (_hasDraft) ...[
                  const SizedBox(height: 16),
                  TextField(
                    controller: _topic,
                    decoration: const InputDecoration(labelText: "Topic", border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _summary,
                    minLines: 3,
                    maxLines: 8,
                    decoration: const InputDecoration(labelText: "Summary (class record)", border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 16),
                  Text("Suggested homework${_posted ? " · posted" : ""}", style: AppText.titleMedium),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _hwTitle,
                    enabled: !_posted,
                    decoration: const InputDecoration(labelText: "Title", border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _hwBody,
                    enabled: !_posted,
                    minLines: 3,
                    maxLines: 8,
                    decoration: const InputDecoration(labelText: "Task", border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: _posted
                        ? null
                        : () async {
                            final d = await showDatePicker(
                              context: context,
                              initialDate: DateTime.tryParse(_hwDue) ?? DateTime.now(),
                              firstDate: DateTime.now().subtract(const Duration(days: 1)),
                              lastDate: DateTime.now().add(const Duration(days: 60)),
                            );
                            if (d != null) {
                              setState(() => _hwDue =
                                  "${d.year}-${d.month.toString().padLeft(2, "0")}-${d.day.toString().padLeft(2, "0")}");
                            }
                          },
                    icon: const Icon(Icons.event_outlined, size: 18),
                    label: Text(_hwDue.isEmpty ? "Due date" : "Due $_hwDue"),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _busy.isNotEmpty ? null : _save,
                          child: Text(_busy == "save" ? "Saving…" : "Save"),
                        ),
                      ),
                      if (_canPost && !_posted) ...[
                        const SizedBox(width: 8),
                        Expanded(
                          child: FilledButton(
                            onPressed: _busy.isNotEmpty ? null : _post,
                            child: Text(_busy == "post" ? "Posting…" : "Post homework"),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "Posting puts the homework in the section's diary and notifies parents, the same as the Homework screen.",
                    style: AppText.labelMediumMuted,
                  ),
                ],
              ],
            ),
    );
  }
}
