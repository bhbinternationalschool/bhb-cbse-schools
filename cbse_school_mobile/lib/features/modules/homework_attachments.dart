import "dart:math" as math;

import "package:cunning_document_scanner/cunning_document_scanner.dart";
import "package:file_selector/file_selector.dart";
import "package:flutter/foundation.dart";
import "package:flutter/material.dart";
import "package:image/image.dart" as img;
import "package:image_picker/image_picker.dart";
import "package:pdfx/pdfx.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";

/// Homework attachments in the app — the same files as the web composer's:
/// a photo / scanned page or a PDF, stored privately under the section's
/// homework folder (apps/web/src/lib/homeworkAttachments.ts).
///
/// Limits mirror the server: at most [kHomeworkMaxAttachments] files on one
/// post, [kHomeworkMaxBytes] each.
const kHomeworkMaxAttachments = 10;
const kHomeworkMaxBytes = 20 * 1024 * 1024;

/// Longest edge, and the size aimed for — the web's `shrinkImage` numbers,
/// so a page photographed in the app is the same weight as one uploaded on
/// the web.
const kHomeworkMaxEdge = 1600;
const kHomeworkTargetBytes = 600000;

String? homeworkMimeOf(String name, [String? given]) {
  final g = (given ?? "").toLowerCase();
  if (const {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  }.contains(g)) {
    return g;
  }
  final ext = name.split(".").last.toLowerCase();
  return switch (ext) {
    "jpg" || "jpeg" => "image/jpeg",
    "png" => "image/png",
    "webp" => "image/webp",
    "pdf" => "application/pdf",
    _ => null,
  };
}

String homeworkExtOf(String mime) => switch (mime) {
  "image/png" => "png",
  "image/webp" => "webp",
  "application/pdf" => "pdf",
  _ => "jpg",
};

/// A file ready to upload.
class HomeworkFileBytes {
  const HomeworkFileBytes(this.bytes, this.mime);

  final Uint8List bytes;
  final String mime;
}

/// Make a phone photo fit to send: upright (EXIF), at most
/// [kHomeworkMaxEdge] on its long side, JPEG stepped down from quality 85
/// until it is under [kHomeworkTargetBytes]. A PNG keeps its format (a
/// scanned diagram's transparency); a PDF, or anything that will not decode,
/// passes through untouched; a result bigger than the original is dropped
/// in favour of the original. Pure, so it runs in [compute] and in tests.
HomeworkFileBytes shrinkHomeworkFile(HomeworkFileBytes input) {
  if (input.mime == "application/pdf") return input;
  final decoded = img.decodeImage(input.bytes);
  if (decoded == null) return input;
  // A camera JPEG is often stored sideways with an EXIF "rotate me" tag;
  // re-encoding drops the tag, so the rotation is applied to the pixels.
  final orientation = decoded.exif.imageIfd.orientation ?? 1;
  final rotated = orientation != 1;
  final upright = rotated ? img.bakeOrientation(decoded) : decoded;
  final longEdge = math.max(upright.width, upright.height);
  final scale = math.min(1.0, kHomeworkMaxEdge / longEdge);
  if (scale == 1.0 &&
      input.bytes.length <= kHomeworkTargetBytes &&
      !rotated &&
      input.mime != "image/webp") {
    return input;
  }
  final resized = scale < 1.0
      ? img.copyResize(
          upright,
          width: (upright.width * scale).round(),
          height: (upright.height * scale).round(),
          interpolation: img.Interpolation.average,
        )
      : upright;
  if (input.mime == "image/png") {
    final png = Uint8List.fromList(img.encodePng(resized, level: 6));
    return png.length < input.bytes.length
        ? HomeworkFileBytes(png, "image/png")
        : input;
  }
  var quality = 85;
  var out = Uint8List.fromList(img.encodeJpg(resized, quality: quality));
  while (out.length > kHomeworkTargetBytes && quality > 45) {
    quality -= 10;
    out = Uint8List.fromList(img.encodeJpg(resized, quality: quality));
  }
  // WebP cannot be written here, so it always becomes a JPEG.
  if (input.mime != "image/webp" && out.length >= input.bytes.length) {
    return input;
  }
  return HomeworkFileBytes(out, "image/jpeg");
}

/// One file picked on the compose form, from pick to upload.
class PickedHomeworkFile {
  PickedHomeworkFile({
    required this.label,
    required this.mime,
    required this.bytes,
  });

  String label;
  String mime;
  Uint8List bytes;
  UploadedHomeworkFile? uploaded;
  String? error;
  bool uploading = false;

  bool get isPdf => mime == "application/pdf";
}

/// "Scan page": the phone's document scanner (ML Kit on Android, VisionKit
/// on iOS) — finds the page's edges, crops and straightens it, several pages
/// in one go. Where it cannot run (no Play services UI, an error), falls back
/// to a plain camera photo. Returns JPEG/PNG bytes per page, unshrunk.
Future<List<(Uint8List, String)>> scanHomeworkPages(int maxPages) async {
  if (maxPages <= 0) return const [];
  List<String>? paths;
  try {
    paths = await CunningDocumentScanner.getPictures(
      noOfPages: maxPages,
      scannerSource: ScannerSource.camera,
      iosScannerOptions: IosScannerOptions(
        imageFormat: IosImageFormat.jpg,
        jpgCompressionQuality: 0.85,
      ),
    );
  } on CunningDocumentScannerException {
    paths = null;
    final shot = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 88,
      maxWidth: 2400,
    );
    if (shot == null) return const [];
    return [
      (
        await shot.readAsBytes(),
        homeworkMimeOf(shot.name, shot.mimeType) ?? "image/jpeg",
      ),
    ];
  }
  if (paths == null || paths.isEmpty) return const [];
  final out = <(Uint8List, String)>[];
  for (final p in paths.take(maxPages)) {
    final f = XFile(p);
    out.add((await f.readAsBytes(), homeworkMimeOf(p) ?? "image/jpeg"));
  }
  return out;
}

/// "Upload file": the system picker (no storage permission), photos or PDFs.
Future<List<XFile>> pickHomeworkFiles() => openFiles(
  acceptedTypeGroups: const [
    XTypeGroup(
      label: "Photo or PDF",
      mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
      extensions: ["pdf", "jpg", "jpeg", "png", "webp"],
      uniformTypeIdentifiers: ["com.adobe.pdf", "public.image"],
    ),
  ],
);

Future<HomeworkFileBytes> shrinkInBackground(HomeworkFileBytes f) =>
    compute(shrinkHomeworkFile, f);

/// The files on a homework card — tap one to open it.
class HomeworkAttachmentChips extends StatelessWidget {
  const HomeworkAttachmentChips({
    super.key,
    required this.api,
    required this.attachments,
  });

  final ApiClient api;
  final List<HomeworkAttachment> attachments;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (final a in attachments)
          ActionChip(
            avatar: Icon(
              a.isLink
                  ? Icons.link
                  : a.isPdf
                  ? Icons.picture_as_pdf_outlined
                  : Icons.image_outlined,
              size: 16,
            ),
            label: Text(
              a.label.isEmpty ? "—" : a.label,
              overflow: TextOverflow.ellipsis,
              style: AppText.labelSmall,
            ),
            visualDensity: VisualDensity.compact,
            onPressed: () => openHomeworkAttachment(context, api, a),
          ),
      ],
    );
  }
}

Future<void> openHomeworkAttachment(
  BuildContext context,
  ApiClient api,
  HomeworkAttachment a,
) async {
  if (a.isLink) {
    final ok = await launchUrl(
      Uri.parse(a.url),
      mode: LaunchMode.externalApplication,
    );
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.homeworkCouldNotOpenFile)),
      );
    }
    return;
  }
  await Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => _AttachmentViewer(api: api, attachment: a),
    ),
  );
}

/// Fetched with the app's own sign-in (the route checks the child / the
/// section), then shown in the app: a pinch-zoom picture or the PDF.
class _AttachmentViewer extends StatefulWidget {
  const _AttachmentViewer({required this.api, required this.attachment});

  final ApiClient api;
  final HomeworkAttachment attachment;

  @override
  State<_AttachmentViewer> createState() => _AttachmentViewerState();
}

class _AttachmentViewerState extends State<_AttachmentViewer> {
  late final Future<(Uint8List, String)> _load = widget.api.fetchFileBytes(
    widget.attachment.url,
  );
  PdfControllerPinch? _pdf;

  @override
  void dispose() {
    _pdf?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.attachment.label)),
      body: FutureBuilder<(Uint8List, String)>(
        future: _load,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError || snap.data == null) {
            return Center(
              child: Text(
                snap.error is ApiException
                    ? (snap.error as ApiException).message
                    : context.l10n.homeworkCouldNotOpenFile,
                textAlign: TextAlign.center,
              ),
            );
          }
          final (bytes, type) = snap.data!;
          if (type.contains("pdf") || widget.attachment.isPdf) {
            _pdf ??= PdfControllerPinch(document: PdfDocument.openData(bytes));
            return PdfViewPinch(controller: _pdf!);
          }
          return InteractiveViewer(
            maxScale: 5,
            child: Center(
              child: Image.memory(
                bytes,
                errorBuilder: (_, _, _) =>
                    Text(context.l10n.homeworkCouldNotOpenFile),
              ),
            ),
          );
        },
      ),
    );
  }
}
