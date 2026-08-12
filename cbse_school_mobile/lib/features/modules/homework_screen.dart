import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

/// Homework feed for one section. Parents pass [studentId]; teachers pass
/// [classId]+[sectionId] and get a compose button.
class HomeworkScreen extends StatelessWidget {
  const HomeworkScreen({
    super.key,
    required this.api,
    required this.subtitle,
    this.studentId,
    this.classId,
    this.sectionId,
    this.canPost = false,
  });

  final ApiClient api;
  final String subtitle;
  final String? studentId;
  final String? classId;
  final String? sectionId;
  final bool canPost;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<HomeworkFeed>(
      title: "Homework & diary",
      subtitle: subtitle,
      load: () => api.fetchHomeworkFeed(
        studentId: studentId,
        classId: classId,
        sectionId: sectionId,
      ),
      emptyIcon: Icons.menu_book_outlined,
      emptyText: canPost
          ? "No homework posted for this section yet — use the button below to post the first one."
          : "No homework posted for this class yet. New homework appears here as soon as the teacher publishes it.",
      isEmpty: (feed) => feed.items.isEmpty,
      floatingActionButton: !canPost
          ? null
          : (context, feed, reload) => FloatingActionButton.extended(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                onPressed: () async {
                  final posted = await showModalBottomSheet<bool>(
                    context: context,
                    isScrollControlled: true,
                    backgroundColor: Colors.white,
                    shape: const RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.vertical(top: Radius.circular(24)),
                    ),
                    builder: (context) => _ComposeSheet(
                      api: api,
                      classId: classId!,
                      sectionId: sectionId!,
                      subjects: feed.subjects,
                    ),
                  );
                  if (posted == true) reload();
                },
                icon: const Icon(Icons.add),
                label: const Text("Post homework"),
              ),
      builder: (context, feed, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final item in feed.items)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: item.isDiary
                                ? ModuleTone.amber.background
                                : ModuleTone.purple.background,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            item.subjectName.isEmpty
                                ? "Homework"
                                : item.subjectName,
                            style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: item.isDiary
                                  ? ModuleTone.amber.foreground
                                  : ModuleTone.purple.foreground,
                            ),
                          ),
                        ),
                        const Spacer(),
                        Text(
                          formatDateLabel(item.date),
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      item.title,
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                    if (item.body.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        item.body,
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: AppColors.ink,
                          height: 1.4,
                        ),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Text(
                      [
                        if (item.teacherName.isNotEmpty) item.teacherName,
                        if ((item.dueAt ?? "").isNotEmpty)
                          "due ${formatDateLabel(item.dueAt!)}",
                      ].join(" · "),
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ComposeSheet extends StatefulWidget {
  const _ComposeSheet({
    required this.api,
    required this.classId,
    required this.sectionId,
    required this.subjects,
  });

  final ApiClient api;
  final String classId;
  final String sectionId;
  final List<SubjectRef> subjects;

  @override
  State<_ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<_ComposeSheet> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  String? _subjectId;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.api.postHomework(
        classId: widget.classId,
        sectionId: widget.sectionId,
        subjectId: _subjectId ?? "",
        title: _title.text.trim(),
        bodyEn: _body.text.trim(),
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = "Could not post. Check the connection and try again.";
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            "Post homework",
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _subjectId,
            isExpanded: true,
            decoration: const InputDecoration(hintText: "Subject"),
            items: [
              for (final s in widget.subjects)
                DropdownMenuItem(value: s.id, child: Text(s.name)),
            ],
            onChanged: (v) => setState(() => _subjectId = v),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _title,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(hintText: "Title"),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _body,
            maxLines: 4,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              hintText: "Homework details for parents…",
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              _error!,
              style: const TextStyle(color: AppColors.danger, fontSize: 12),
            ),
          ],
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _saving ? null : _submit,
            child: _saving
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text("Publish"),
          ),
        ],
      ),
    );
  }
}
