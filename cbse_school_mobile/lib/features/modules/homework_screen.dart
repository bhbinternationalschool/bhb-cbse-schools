import "dart:typed_data";

import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";
import "tutor_screen.dart";
import "../../core/i18n/locale_controller.dart";
import "../modules/dictate_field.dart";
import "homework_attachments.dart";

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
    this.child,
  });

  final ApiClient api;
  final String subtitle;

  /// The child this feed belongs to, when a parent opened it — enables
  /// "Ask tutor" on each item, with the assignment as the tutor's context.
  final ParentChild? child;
  final String? studentId;
  final String? classId;
  final String? sectionId;
  final bool canPost;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<HomeworkFeed>(
      guideId: "homework",
      title: context.l10n.modHomeworkTitle,
      subtitle: subtitle,
      load: () => api.fetchHomeworkFeed(
        studentId: studentId,
        classId: classId,
        sectionId: sectionId,
      ),
      emptyIcon: Icons.menu_book_outlined,
      emptyText: canPost
          ? context.l10n.modHomeworkEmptyTeacher
          : context.l10n.modHomeworkEmptyParent,
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
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(24),
                    ),
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
              label: Text(context.l10n.postHomework),
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
                            item.isDiary
                                ? context.l10n.modDiaryLabel
                                : item.subjectName.isEmpty
                                ? context.l10n.modHomeworkLabel
                                : item.subjectName,
                            style: AppText.labelSmall.copyWith(
                              color: item.isDiary
                                  ? ModuleTone.amber.foreground
                                  : ModuleTone.purple.foreground,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const Spacer(),
                        Text(
                          formatDateLabel(item.date),
                          style: AppText.labelMediumMuted,
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      item.title,
                      style: AppText.bodyMediumInk.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (item.body.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        item.body,
                        style: AppText.bodySmallInk.copyWith(height: 1.4),
                      ),
                    ],
                    if (item.attachments.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      HomeworkAttachmentChips(
                        api: api,
                        attachments: item.attachments,
                      ),
                    ],
                    if (item.leadRevision != null) ...[
                      const SizedBox(height: 10),
                      _LeadRevisionCard(revision: item.leadRevision!),
                    ],
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            [
                              if (item.teacherName.isNotEmpty) item.teacherName,
                              if ((item.dueAt ?? "").isNotEmpty)
                                context.l10n.modHomeworkDueOn(
                                  formatDateLabel(item.dueAt!),
                                ),
                            ].join(" · "),
                            style: AppText.labelMediumMuted,
                          ),
                        ),
                        if (child != null)
                          TextButton.icon(
                            onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => TutorScreen(
                                  api: api,
                                  context: TutorContext(
                                    child: child!,
                                    subjectLabel: item.subjectName,
                                    homeworkTitle: item.title,
                                    homeworkBody: item.body,
                                  ),
                                ),
                              ),
                            ),
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                              ),
                            ),
                            icon: const Icon(Icons.school_outlined, size: 16),
                            label: Text(
                              context.l10n.askTutor,
                              style: AppText.bodySmall,
                            ),
                          ),
                      ],
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
  bool _picking = false;
  String? _error;

  /// Scanned pages and picked files, uploaded as soon as they are added so
  /// Publish only has to send their refs.
  final _files = <PickedHomeworkFile>[];
  int _pagesScanned = 0;

  int get _room => kHomeworkMaxAttachments - _files.length;

  Future<void> _scan() async {
    if (_picking) return;
    if (_room <= 0) {
      setState(
        () =>
            _error = context.l10n.homeworkAttachLimit(kHomeworkMaxAttachments),
      );
      return;
    }
    setState(() => _picking = true);
    try {
      final pages = await scanHomeworkPages(_room);
      for (final (bytes, mime) in pages) {
        if (!mounted) return;
        _pagesScanned++;
        await _add(bytes, mime, context.l10n.homeworkPageLabel(_pagesScanned));
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = context.l10n.homeworkCameraUnavailable);
      }
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  Future<void> _pickFiles() async {
    if (_picking) return;
    if (_room <= 0) {
      setState(
        () =>
            _error = context.l10n.homeworkAttachLimit(kHomeworkMaxAttachments),
      );
      return;
    }
    setState(() => _picking = true);
    try {
      final picked = await pickHomeworkFiles();
      for (final x in picked) {
        if (!mounted) return;
        if (_room <= 0) {
          setState(
            () => _error = context.l10n.homeworkAttachLimit(
              kHomeworkMaxAttachments,
            ),
          );
          break;
        }
        final mime = homeworkMimeOf(x.name, x.mimeType);
        if (mime == null) {
          setState(() => _error = context.l10n.homeworkFileWrongType);
          continue;
        }
        await _add(await x.readAsBytes(), mime, x.name);
      }
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  Future<void> _add(Uint8List raw, String mime, String label) async {
    final shrunk = await shrinkInBackground(HomeworkFileBytes(raw, mime));
    if (!mounted) return;
    if (shrunk.bytes.length > kHomeworkMaxBytes) {
      setState(() => _error = context.l10n.homeworkFileTooLarge(label));
      return;
    }
    final f = PickedHomeworkFile(
      label: label,
      mime: shrunk.mime,
      bytes: shrunk.bytes,
    );
    setState(() {
      _files.add(f);
      _error = null;
    });
    await _upload(f);
  }

  Future<void> _upload(PickedHomeworkFile f) async {
    setState(() {
      f.uploading = true;
      f.error = null;
    });
    try {
      final base = f.label.contains(".")
          ? f.label.substring(0, f.label.lastIndexOf("."))
          : f.label;
      f.uploaded = await widget.api.uploadHomeworkAttachment(
        classId: widget.classId,
        sectionId: widget.sectionId,
        bytes: f.bytes,
        fileName:
            "${base.replaceAll(RegExp(r"[^A-Za-z0-9_-]"), "_")}.${homeworkExtOf(f.mime)}",
        mime: f.mime,
        label: f.label,
      );
    } on ApiException catch (e) {
      f.error = e.message;
    } catch (_) {
      f.error = mounted ? context.l10n.homeworkUploadFailedRetry : "";
    }
    if (mounted) setState(() => f.uploading = false);
  }

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving) return;
    if (_files.any((f) => f.uploaded == null)) {
      setState(() => _error = context.l10n.homeworkWaitForUploads);
      return;
    }
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
        attachments: [for (final f in _files) f.uploaded!],
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
          _error = context.l10n.modHomeworkCouldNotPost;
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
          Text(context.l10n.postHomework, style: AppText.titleMediumInk),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _subjectId,
            isExpanded: true,
            decoration: InputDecoration(hintText: context.l10n.subject),
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
            decoration: InputDecoration(hintText: context.l10n.title),
          ),
          const SizedBox(height: 10),
          DictateField(
            controller: _body,
            maxLines: 4,
            textCapitalization: TextCapitalization.sentences,
            hint: context.l10n.homeworkDetailsForParents,
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _picking || _saving ? null : _scan,
                  icon: const Icon(Icons.document_scanner_outlined, size: 18),
                  label: Text(context.l10n.homeworkScanPage),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _picking || _saving ? null : _pickFiles,
                  icon: const Icon(Icons.attach_file, size: 18),
                  label: Text(context.l10n.homeworkUploadFile),
                ),
              ),
            ],
          ),
          if (_files.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                context.l10n.homeworkAttachmentsHint,
                style: AppText.labelSmallMuted,
              ),
            )
          else
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 200),
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final f in _files)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: SizedBox(
                        width: 44,
                        height: 44,
                        child: f.isPdf
                            ? const Icon(Icons.picture_as_pdf_outlined)
                            : ClipRRect(
                                borderRadius: BorderRadius.circular(6),
                                child: Image.memory(
                                  f.bytes,
                                  fit: BoxFit.cover,
                                  cacheWidth: 120,
                                ),
                              ),
                      ),
                      title: Text(f.label, overflow: TextOverflow.ellipsis),
                      subtitle: f.error != null
                          ? Text(
                              "${f.error} · ${context.l10n.homeworkUploadFailedRetry}",
                              style: AppText.labelSmall.copyWith(
                                color: AppColors.danger,
                              ),
                            )
                          : null,
                      onTap: f.error != null && !f.uploading
                          ? () => _upload(f)
                          : null,
                      trailing: f.uploading
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : IconButton(
                              icon: const Icon(Icons.close, size: 18),
                              onPressed: _saving
                                  ? null
                                  : () => setState(() => _files.remove(f)),
                            ),
                    ),
                ],
              ),
            ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              _error!,
              style: AppText.bodySmall.copyWith(color: AppColors.danger),
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
                : Text(context.l10n.publish),
          ),
        ],
      ),
    );
  }
}

/// The chapter's animations, games and mind maps in the LEAD Group Student
/// App (director, 12 Oct 2026). The app holds and plays them under the
/// family's own LEAD sign-in; the button opens it from its store page
/// ("Open" when installed, "Install" when not).
class _LeadRevisionCard extends StatelessWidget {
  const _LeadRevisionCard({required this.revision});

  final LeadRevision revision;

  static const _android =
      "https://play.google.com/store/apps/details?id=com.leadschool.parentapp";
  static const _ios = "https://apps.apple.com/app/id1571090872";

  Future<void> _open(BuildContext context) async {
    final ios = Theme.of(context).platform == TargetPlatform.iOS;
    final ok = await launchUrl(
      Uri.parse(ios ? _ios : _android),
      mode: LaunchMode.externalApplication,
    );
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.l10n.couldNotOpenLeadApp)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: ModuleTone.blue.background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            context.l10n.leadRevisionHint(revision.book, revision.chapter),
            style: AppText.labelMedium.copyWith(
              color: ModuleTone.blue.foreground,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          for (final a in revision.items)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                a.title.isEmpty || a.title == a.type
                    ? "• ${a.type}"
                    : "• ${a.type}: ${a.title}",
                style: AppText.labelSmallMuted,
              ),
            ),
          const SizedBox(height: 6),
          FilledButton.tonalIcon(
            onPressed: () => _open(context),
            icon: const Icon(Icons.play_circle_outline, size: 18),
            label: Text(context.l10n.reviseInLeadApp),
          ),
        ],
      ),
    );
  }
}
