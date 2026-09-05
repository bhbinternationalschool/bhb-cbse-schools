import "dart:typed_data";

import "package:flutter/material.dart";
import "package:pdfx/pdfx.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// Parent-uploaded documents waiting for verification — the class
/// teacher's queue (everything for the office). Open the file, then verify
/// or reject with a note the parent sees.
class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  String _filter = "pending";

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<DocReviewItem>>(
      key: ValueKey(_filter),
      title: "Documents",
      subtitle: _filter == "pending" ? "Waiting for verification" : "Reviewed",
      load: () => widget.api.fetchDocumentQueue(status: _filter),
      emptyIcon: Icons.folder_open_outlined,
      emptyText: _filter == "pending"
          ? "Nothing to verify. Documents parents upload from their app appear here."
          : "Nothing reviewed yet.",
      isEmpty: (l) => l.isEmpty,
      builder: (context, list, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 8,
            children: [
              for (final (k, label) in const [
                ("pending", "Pending"),
                ("reviewed", "Reviewed"),
              ])
                ChoiceChip(
                  label: Text(label),
                  selected: _filter == k,
                  onSelected: (_) => setState(() => _filter = k),
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (final d in list)
            Card(
              child: ListTile(
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: switch (d.status) {
                      "verified" => ModuleTone.green.background,
                      "rejected" => ModuleTone.coral.background,
                      _ => ModuleTone.amber.background,
                    },
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    d.mimeType.startsWith("image/")
                        ? Icons.image_outlined
                        : Icons.picture_as_pdf_outlined,
                    color: switch (d.status) {
                      "verified" => ModuleTone.green.foreground,
                      "rejected" => ModuleTone.coral.foreground,
                      _ => ModuleTone.amber.foreground,
                    },
                  ),
                ),
                title: Text(
                  "${d.label} · ${d.studentName}",
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                subtitle: Text(
                  "${d.classLabel}${d.submittedAt.isNotEmpty ? " · ${formatDateLabel(d.submittedAt.substring(0, 10))}" : ""}"
                  "${d.status == "pending" ? "" : " · ${d.status}${d.reviewNote.isNotEmpty ? ": ${d.reviewNote}" : ""}"}",
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                trailing: const Icon(
                  Icons.chevron_right,
                  color: AppColors.muted,
                ),
                onTap: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => _ReviewScreen(api: widget.api, d: d),
                    ),
                  );
                  await reload();
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _ReviewScreen extends StatefulWidget {
  const _ReviewScreen({required this.api, required this.d});

  final ApiClient api;
  final DocReviewItem d;

  @override
  State<_ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<_ReviewScreen> {
  Uint8List? _bytes;
  String _mime = "";
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final (bytes, mime) = await widget.api.fetchFileBytes(widget.d.fileUrl);
      if (mounted) {
        setState(() {
          _bytes = bytes;
          _mime = mime.isEmpty ? widget.d.mimeType : mime;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = "Could not load the file.");
    }
  }

  Future<void> _decide(bool verify) async {
    var note = "";
    if (!verify) {
      final ctl = TextEditingController();
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text("Reject document"),
          content: TextField(
            controller: ctl,
            autofocus: true,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: "Why — the parent reads this",
              hintText: "e.g. blurred, wrong child, expired",
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text("Back"),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(context, true),
              child: const Text("Reject"),
            ),
          ],
        ),
      );
      if (ok != true) return;
      note = ctl.text.trim();
      if (note.isEmpty) return;
    }
    if (!mounted) return;
    setState(() => _busy = true);
    try {
      await widget.api.reviewDocument(
        studentId: widget.d.studentId,
        key: widget.d.key,
        verdict: verify ? "verified" : "rejected",
        note: note,
      );
      Haptics.success();
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.d;
    final bytes = _bytes;
    final isImage = _mime.startsWith("image/");
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(d.label, style: const TextStyle(fontSize: 15)),
            Text(
              "${d.studentName} · ${d.classLabel}",
              style: const TextStyle(fontSize: 11, color: AppColors.muted),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: bytes == null
                ? Center(
                    child: _error == null
                        ? const CircularProgressIndicator(
                            color: AppColors.primary,
                          )
                        : Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(_error!, textAlign: TextAlign.center),
                          ),
                  )
                : isImage
                ? InteractiveViewer(
                    maxScale: 6,
                    child: Center(
                      child: Image.memory(bytes, fit: BoxFit.contain),
                    ),
                  )
                : _PdfPane(bytes: bytes),
          ),
          if (d.status == "pending")
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _busy ? null : () => _decide(false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.danger,
                        ),
                        child: const Text("Reject"),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        onPressed: _busy || bytes == null
                            ? null
                            : () => _decide(true),
                        child: Text(_busy ? "Saving…" : "Verify"),
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

class _PdfPane extends StatefulWidget {
  const _PdfPane({required this.bytes});

  final Uint8List bytes;

  @override
  State<_PdfPane> createState() => _PdfPaneState();
}

class _PdfPaneState extends State<_PdfPane> {
  late final PdfControllerPinch _controller = PdfControllerPinch(
    document: PdfDocument.openData(widget.bytes),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PdfViewPinch(controller: _controller);
}
