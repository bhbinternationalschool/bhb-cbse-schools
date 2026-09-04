import "package:file_selector/file_selector.dart";
import "package:flutter/material.dart";
import "package:image_picker/image_picker.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// One child: the full record as the school holds it, and the document
/// checklist with upload.
///
/// Uploading sends the file to the server, which checks it — real file
/// type, legible size, and for identity documents the printed name and
/// date of birth against the child's record — then stores it and marks it
/// "awaiting verification" for the office. What the parent sees afterwards
/// is the office's decision: Verified, or Rejected with the reason and a
/// way to upload again.
class ChildProfileScreen extends StatelessWidget {
  const ChildProfileScreen({
    super.key,
    required this.api,
    required this.studentId,
  });

  final ApiClient api;
  final String studentId;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<ParentProfile>(
      title: "Student profile",
      load: api.fetchProfile,
      builder: (context, profile, reload) {
        final child = profile.children
            .where((c) => c.id == studentId)
            .firstOrNull;
        if (child == null) {
          return const Center(
            child: Text("This child is no longer on your account."),
          );
        }
        final hints = {for (final d in profile.documents) d.key: d};
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            _Header(api: api, child: child),
            const SizedBox(height: 16),
            const _Section("Documents the school needs"),
            const Padding(
              padding: EdgeInsets.fromLTRB(4, 0, 4, 8),
              child: Text(
                "Upload a clear photo or scan of each. The office verifies every "
                "document; you will see the result here.",
                style: TextStyle(
                  fontSize: 12,
                  color: AppColors.muted,
                  height: 1.4,
                ),
              ),
            ),
            for (final doc in child.docs)
              _DocTile(
                doc: doc,
                checklist: hints[doc.key],
                onUpload: () =>
                    _upload(context, child, doc, hints[doc.key], reload),
              ),
            const SizedBox(height: 16),
            const _Section("Details on record"),
            Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                child: Column(
                  children: [
                    for (final f in child.fields)
                      _Row(label: f.$1, value: f.$2),
                  ],
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(4, 8, 4, 0),
              child: Text(
                "Something wrong in the record? Tell the school office — these "
                "details are changed there, with your documents in hand.",
                style: TextStyle(
                  fontSize: 12,
                  color: AppColors.muted,
                  height: 1.4,
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Future<void> _upload(
    BuildContext context,
    StudentProfile child,
    StudentDocInfo doc,
    DocChecklistItem? item,
    Future<void> Function() reload,
  ) async {
    if (doc.isVerified) {
      final sure = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text("Replace a verified document?"),
          content: const Text(
            "The office has already verified this one. A new upload goes back "
            "to them for verification.",
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text("Keep"),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text("Replace"),
            ),
          ],
        ),
      );
      if (sure != true) return;
    }
    if (!context.mounted) return;

    final picked = await _pick(context, doc.key, item?.allowsPdf ?? false);
    if (picked == null || !context.mounted) return;

    // The whole round trip — validate, read, store, record — happens on the
    // server, so the app just waits, visibly.
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const AlertDialog(
        content: Row(
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 16),
            Expanded(child: Text("Checking and uploading…")),
          ],
        ),
      ),
    );
    try {
      final result = await api.uploadStudentDocument(
        studentId: child.id,
        docKey: doc.key,
        filePath: picked.path,
        fileName: picked.name,
        mimeType: picked.mimeType,
      );
      if (!context.mounted) return;
      Navigator.of(context).pop(); // progress
      Haptics.success();
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          icon: const Icon(
            Icons.check_circle,
            color: AppColors.success,
            size: 40,
          ),
          title: const Text("Submitted successfully"),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(result.message, style: const TextStyle(height: 1.4)),
              if (result.checks.isNotEmpty) ...[
                const SizedBox(height: 12),
                const Text(
                  "Automatic check",
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                ),
                for (final c in result.checks)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(
                      children: [
                        Icon(
                          c.status == "match"
                              ? Icons.check
                              : c.status == "mismatch"
                              ? Icons.close
                              : Icons.remove,
                          size: 16,
                          color: c.status == "match"
                              ? AppColors.success
                              : c.status == "mismatch"
                              ? AppColors.danger
                              : AppColors.muted,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          "${c.label}: ${switch (c.status) {
                            "match" => "matches",
                            "mismatch" => "does not match",
                            "missing_ocr" => "not readable",
                            "missing_record" => "not on record",
                            _ => c.status,
                          }}",
                          style: const TextStyle(fontSize: 12.5),
                        ),
                      ],
                    ),
                  ),
              ],
            ],
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text("Done"),
            ),
          ],
        ),
      );
      await reload();
    } on ApiException catch (e) {
      if (!context.mounted) return;
      Navigator.of(context).pop();
      if ((e.statusCode ?? 0) < 500) Haptics.warning();
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          icon: const Icon(
            Icons.error_outline,
            color: AppColors.danger,
            size: 40,
          ),
          // A 4xx is the school saying no to this file; a 5xx is the school's
          // side failing, and the parent should not think their file was bad.
          title: Text(
            (e.statusCode ?? 0) >= 500 ? "Could not upload" : "Not accepted",
          ),
          content: Text(e.message, style: const TextStyle(height: 1.4)),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text("OK"),
            ),
          ],
        ),
      );
    } catch (_) {
      if (!context.mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            "Could not reach the school server. Nothing was uploaded.",
          ),
        ),
      );
    }
  }

  /// Camera, gallery, or (for documents, not the photo) a PDF file.
  Future<_Picked?> _pick(
    BuildContext context,
    String docKey,
    bool allowPdf,
  ) async {
    final source = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text("Take a photo"),
              onTap: () => Navigator.pop(context, "camera"),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text("Choose from gallery"),
              onTap: () => Navigator.pop(context, "gallery"),
            ),
            if (allowPdf)
              ListTile(
                leading: const Icon(Icons.picture_as_pdf_outlined),
                title: const Text("Choose a PDF or file"),
                onTap: () => Navigator.pop(context, "file"),
              ),
          ],
        ),
      ),
    );
    if (source == null) return null;

    if (source == "file") {
      // The system document picker (Storage Access Framework): no storage
      // permission needed, and it can reach Downloads and Drive alike.
      final xfile = await openFile(
        acceptedTypeGroups: const [
          XTypeGroup(
            label: "Document",
            mimeTypes: [
              "application/pdf",
              "image/jpeg",
              "image/png",
              "image/webp",
            ],
            extensions: ["pdf", "jpg", "jpeg", "png", "webp"],
          ),
        ],
      );
      if (xfile == null) return null;
      return _Picked(
        path: xfile.path,
        name: xfile.name,
        mimeType: xfile.mimeType ?? _mimeOf(xfile.name),
      );
    }
    final shot = await ImagePicker().pickImage(
      source: source == "camera" ? ImageSource.camera : ImageSource.gallery,
      imageQuality: 88,
      maxWidth: 2400,
    );
    if (shot == null) return null;
    // The picker hands back a temp name like "scaled_20.jpg"; the office
    // should see what the file is, not where it came from.
    final mime = shot.mimeType ?? _mimeOf(shot.name);
    final ext = mime == "image/png"
        ? "png"
        : mime == "image/webp"
        ? "webp"
        : "jpg";
    final d = DateTime.now();
    final stamp =
        "${d.year}${d.month.toString().padLeft(2, "0")}${d.day.toString().padLeft(2, "0")}";
    return _Picked(
      path: shot.path,
      name: "$docKey-$stamp.$ext",
      mimeType: mime,
    );
  }

  static String _mimeOf(String name) {
    final ext = name.split(".").last.toLowerCase();
    return switch (ext) {
      "pdf" => "application/pdf",
      "png" => "image/png",
      "webp" => "image/webp",
      _ => "image/jpeg",
    };
  }
}

class _Picked {
  const _Picked({
    required this.path,
    required this.name,
    required this.mimeType,
  });
  final String path;
  final String name;
  final String mimeType;
}

class _Header extends StatelessWidget {
  const _Header({required this.api, required this.child});

  final ApiClient api;
  final StudentProfile child;

  @override
  Widget build(BuildContext context) {
    final photo = child.docs
        .where((d) => d.key == "photo" && d.previewUrl != null)
        .firstOrNull;
    return Card(
      color: AppColors.primary,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            _PhotoAvatar(
              api: api,
              previewUrl: photo?.previewUrl,
              name: child.fullName,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    child.fullName,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    "${child.classLabel} · Adm. ${child.admissionNo}",
                    style: const TextStyle(
                      color: Color(0xFFB8C0D4),
                      fontSize: 12.5,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      value: child.completeness / 100,
                      minHeight: 6,
                      backgroundColor: Colors.white24,
                      color: AppColors.accentSoft,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    "Profile ${child.completeness}% complete",
                    style: const TextStyle(
                      color: Color(0xFFB8C0D4),
                      fontSize: 11.5,
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

/// The stored passport photo, fetched with the session — it is served
/// through the school's ownership-checked proxy, never a public link.
class _PhotoAvatar extends StatelessWidget {
  const _PhotoAvatar({
    required this.api,
    required this.previewUrl,
    required this.name,
  });

  final ApiClient api;
  final String? previewUrl;
  final String name;

  @override
  Widget build(BuildContext context) {
    final initials = name
        .split(" ")
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    final fallback = CircleAvatar(
      radius: 30,
      backgroundColor: AppColors.accentSoft,
      child: Text(
        initials,
        style: const TextStyle(
          color: AppColors.primary,
          fontWeight: FontWeight.w600,
          fontSize: 18,
        ),
      ),
    );
    final url = previewUrl;
    if (url == null) return fallback;
    return FutureBuilder<Map<String, String>>(
      future: api.imageHeaders(),
      builder: (context, snap) {
        if (!snap.hasData) return fallback;
        return CircleAvatar(
          radius: 30,
          backgroundColor: AppColors.accentSoft,
          backgroundImage: NetworkImage(
            "${api.baseUrl}$url",
            headers: snap.data,
          ),
          onBackgroundImageError: (_, _) {},
        );
      },
    );
  }
}

class _DocTile extends StatelessWidget {
  const _DocTile({
    required this.doc,
    required this.checklist,
    required this.onUpload,
  });

  final StudentDocInfo doc;
  final DocChecklistItem? checklist;
  final VoidCallback onUpload;

  @override
  Widget build(BuildContext context) {
    final (chipLabel, tone) = switch (doc.status) {
      "verified" => ("Verified", ModuleTone.green),
      "pending" || "received" => ("Awaiting verification", ModuleTone.amber),
      "rejected" => ("Rejected", ModuleTone.coral),
      _ => (
        doc.required ? "Required" : "Optional",
        doc.required ? ModuleTone.coral : ModuleTone.gray,
      ),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    doc.label,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: tone.background,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    chipLabel,
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: tone.foreground,
                    ),
                  ),
                ),
              ],
            ),
            if (checklist != null && !doc.hasFile) ...[
              const SizedBox(height: 4),
              Text(
                checklist!.hint,
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.muted,
                  height: 1.4,
                ),
              ),
            ],
            if (doc.hasFile) ...[
              const SizedBox(height: 4),
              Text(
                "${doc.fileName}${doc.uploadedAt.isNotEmpty ? " · ${formatDateLabel(doc.uploadedAt.split("T").first)}" : ""}",
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ],
            if (doc.isRejected && doc.reviewNote.isNotEmpty) ...[
              const SizedBox(height: 6),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: ModuleTone.coral.background,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  "Office: ${doc.reviewNote}",
                  style: TextStyle(
                    fontSize: 12,
                    color: ModuleTone.coral.foreground,
                    height: 1.4,
                  ),
                ),
              ),
            ],
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: onUpload,
                icon: Icon(
                  doc.hasFile ? Icons.refresh : Icons.upload_outlined,
                  size: 18,
                ),
                label: Text(doc.hasFile ? "Upload again" : "Upload"),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 128,
            child: Text(
              label,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? "—" : value,
              style: TextStyle(
                fontSize: 13,
                color: value.isEmpty ? AppColors.muted : AppColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 6),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
      ),
    );
  }
}
