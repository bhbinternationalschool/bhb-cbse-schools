import "package:flutter/material.dart";
import "package:image_picker/image_picker.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// Class gallery (director, 10 Oct 2026): the class teacher takes photos and
/// videos — or picks them from the phone's gallery — under an event of their
/// class. An AI check looks at each one first: what passes is shown only to
/// that class's families in the parent app and copied to the school's Drive
/// (Class gallery / year / class / event); anything doubtful is held for the
/// principal, who approves or removes it here.
class ClassGalleryScreen extends StatefulWidget {
  const ClassGalleryScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<ClassGalleryScreen> createState() => _ClassGalleryScreenState();
}

class _ClassGalleryScreenState extends State<ClassGalleryScreen> {
  ClassGallery? _gallery;
  String _section = "";
  String _error = "";
  bool _loading = true;

  bool get _hi => Localizations.localeOf(context).languageCode == "hi";
  String _t(String en, String hi) => _hi ? hi : en;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = "";
    });
    try {
      final g = await widget.api.fetchClassGallery(section: _section);
      if (mounted) {
        setState(() {
          _gallery = g;
          _section = g.section;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _t(
            "Could not load — pull to retry.",
            "लोड नहीं हुआ — फिर से खींचें।",
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _newEvent() async {
    final name = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_t("New event", "नया कार्यक्रम")),
        content: TextField(
          controller: name,
          autofocus: true,
          maxLength: 60,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            hintText: _t("e.g. Sports day", "जैसे खेल दिवस"),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_t("Cancel", "रद्द करें")),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(_t("Create", "बनाएँ")),
          ),
        ],
      ),
    );
    final title = name.text.trim();
    name.dispose();
    if (ok != true || title.isEmpty || !mounted) return;
    try {
      final id = await widget.api.createClassEvent(_section, title);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) =>
              ClassEventScreen(api: widget.api, albumId: id, title: title),
        ),
      );
      _load();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final g = _gallery;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          g == null || g.classLabel.isEmpty
              ? _t("Class gallery", "कक्षा गैलरी")
              : g.classLabel,
        ),
      ),
      floatingActionButton: g == null || _section.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: _newEvent,
              icon: const Icon(Icons.add_a_photo_outlined),
              label: Text(_t("New event", "नया कार्यक्रम")),
            ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          children: [
            Text(
              _t(
                "Photos and videos you add here are checked first, then seen only by your class's parents and saved to the school's Drive.",
                "यहाँ जोड़ी गई फ़ोटो और वीडियो पहले जाँची जाती हैं, फिर केवल आपकी कक्षा के अभिभावक देखते हैं और स्कूल की ड्राइव में सहेजी जाती हैं।",
              ),
              style: AppText.bodySmallMuted,
            ),
            if (g != null && g.classes.length > 1) ...[
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _section,
                items: [
                  for (final c in g.classes)
                    DropdownMenuItem(
                      value: c.section,
                      child: Text(c.classLabel),
                    ),
                ],
                onChanged: (v) {
                  if (v == null) return;
                  setState(() => _section = v);
                  _load();
                },
              ),
            ],
            if (g != null && g.canReview) ...[
              const SizedBox(height: 10),
              Card(
                color: g.heldCount > 0 ? const Color(0xFFFFF4E5) : null,
                child: ListTile(
                  leading: Icon(
                    Icons.shield_outlined,
                    color: g.heldCount > 0
                        ? AppColors.warning
                        : AppColors.muted,
                  ),
                  title: Text(_t("Held for review", "जाँच के लिए रोकी गई")),
                  subtitle: Text(
                    g.heldCount > 0
                        ? _t(
                            "${g.heldCount} waiting for you",
                            "${g.heldCount} आपके निर्णय की प्रतीक्षा में",
                          )
                        : _t("Nothing waiting", "कुछ भी प्रतीक्षा में नहीं"),
                    style: AppText.labelMediumMuted,
                  ),
                  trailing: const Icon(
                    Icons.chevron_right,
                    color: AppColors.muted,
                  ),
                  onTap: () async {
                    await Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => ClassReviewScreen(api: widget.api),
                      ),
                    );
                    _load();
                  },
                ),
              ),
            ],
            const SizedBox(height: 12),
            if (_loading && g == null)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: CircularProgressIndicator(),
                ),
              ),
            if (_error.isNotEmpty)
              Text(_error, style: const TextStyle(color: AppColors.danger)),
            if (g != null && _section.isEmpty)
              Text(
                _t(
                  "The class gallery is for class teachers.",
                  "कक्षा गैलरी कक्षा अध्यापकों के लिए है।",
                ),
              ),
            if (g != null && _section.isNotEmpty && g.events.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 24),
                child: Text(
                  _t(
                    "No events yet — tap New event to start.",
                    "अभी कोई कार्यक्रम नहीं — शुरू करने के लिए नया कार्यक्रम दबाएँ।",
                  ),
                  textAlign: TextAlign.center,
                  style: AppText.bodySmallMuted,
                ),
              ),
            for (final e in g?.events ?? const <ClassGalleryEvent>[])
              Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: ListTile(
                  leading: _Cover(api: widget.api, url: e.coverUrl),
                  title: Text(
                    e.title,
                    style: AppText.bodyMediumInk.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    [
                      _t(
                        "${e.photos} photos · ${e.videos} videos",
                        "${e.photos} फ़ोटो · ${e.videos} वीडियो",
                      ),
                      if (e.checking > 0)
                        _t(
                          "${e.checking} being checked",
                          "${e.checking} जाँच में",
                        ),
                      if (e.held > 0) _t("${e.held} held", "${e.held} रोकी गई"),
                    ].join(" · "),
                    style: AppText.labelMediumMuted,
                  ),
                  trailing: const Icon(
                    Icons.chevron_right,
                    color: AppColors.muted,
                  ),
                  onTap: () async {
                    await Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => ClassEventScreen(
                          api: widget.api,
                          albumId: e.id,
                          title: e.title,
                        ),
                      ),
                    );
                    _load();
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Cover extends StatelessWidget {
  const _Cover({required this.api, required this.url});

  final ApiClient api;
  final String url;

  @override
  Widget build(BuildContext context) {
    const box = SizedBox(
      width: 48,
      height: 48,
      child: ColoredBox(
        color: Color(0xFFECEAE3),
        child: Icon(Icons.photo_library_outlined, color: AppColors.muted),
      ),
    );
    if (url.isEmpty) return box;
    return FutureBuilder<Map<String, String>>(
      future: api.imageHeaders(),
      builder: (context, snap) => snap.data == null
          ? box
          : ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.network(
                url,
                headers: api.isOwnServer(url) ? snap.data : null,
                width: 48,
                height: 48,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => box,
              ),
            ),
    );
  }
}

/// One event: add photos and videos; each uploads with its own progress.
class ClassEventScreen extends StatefulWidget {
  const ClassEventScreen({
    super.key,
    required this.api,
    required this.albumId,
    required this.title,
  });

  final ApiClient api;
  final String albumId;
  final String title;

  @override
  State<ClassEventScreen> createState() => _ClassEventScreenState();
}

class _Upload {
  _Upload(this.file, this.isVideo);
  final XFile file;
  final bool isVideo;
  double progress = 0;
  String error = "";
  bool done = false;

  /// After upload: "ok", "held" or "pending" (still being checked).
  String status = "";
}

class _ClassEventScreenState extends State<ClassEventScreen> {
  final _picker = ImagePicker();
  final List<_Upload> _uploads = [];
  bool _running = false;

  bool get _hi => Localizations.localeOf(context).languageCode == "hi";
  String _t(String en, String hi) => _hi ? hi : en;

  static bool _looksVideo(XFile f) {
    final m = (f.mimeType ?? "").toLowerCase();
    if (m.startsWith("video/")) return true;
    final n = f.name.toLowerCase();
    return n.endsWith(".mp4") ||
        n.endsWith(".mov") ||
        n.endsWith(".webm") ||
        n.endsWith(".3gp");
  }

  Future<void> _add(Future<List<XFile>> Function() pick) async {
    List<XFile> files;
    try {
      files = await pick();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _t(
                "Camera or gallery is not available.",
                "कैमरा या गैलरी उपलब्ध नहीं है।",
              ),
            ),
          ),
        );
      }
      return;
    }
    if (files.isEmpty) return;
    setState(
      () => _uploads.addAll(files.map((f) => _Upload(f, _looksVideo(f)))),
    );
    await _runQueue();
  }

  Future<void> _runQueue() async {
    if (_running) return;
    _running = true;
    try {
      for (final u
          in _uploads.where((u) => !u.done && u.error.isEmpty).toList()) {
        try {
          final length = await u.file.length();
          final status = await widget.api.uploadClassMedia(
            albumId: widget.albumId,
            fileName: u.file.name,
            contentType: u.file.mimeType ?? "",
            length: length,
            open: () => u.file.openRead(),
            onProgress: (p) {
              if (mounted) setState(() => u.progress = p);
            },
          );
          if (mounted) {
            setState(() {
              u.done = true;
              u.status = status;
            });
          }
        } on ApiException catch (e) {
          if (mounted) setState(() => u.error = e.message);
        } catch (_) {
          if (mounted) {
            setState(
              () => u.error = _t(
                "Upload failed — tap to retry.",
                "अपलोड नहीं हुआ — फिर से कोशिश करने के लिए दबाएँ।",
              ),
            );
          }
        }
      }
    } finally {
      _running = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final done = _uploads.where((u) => u.done).length;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              FilledButton.icon(
                icon: const Icon(Icons.photo_camera_outlined),
                label: Text(_t("Take photo", "फ़ोटो लें")),
                onPressed: () => _add(() async {
                  final f = await _picker.pickImage(
                    source: ImageSource.camera,
                    imageQuality: 85,
                    maxWidth: 2560,
                  );
                  return f == null ? <XFile>[] : [f];
                }),
              ),
              FilledButton.tonalIcon(
                icon: const Icon(Icons.videocam_outlined),
                label: Text(_t("Record video", "वीडियो बनाएँ")),
                onPressed: () => _add(() async {
                  final f = await _picker.pickVideo(
                    source: ImageSource.camera,
                    maxDuration: const Duration(minutes: 5),
                  );
                  return f == null ? <XFile>[] : [f];
                }),
              ),
              OutlinedButton.icon(
                icon: const Icon(Icons.photo_library_outlined),
                label: Text(_t("From gallery", "गैलरी से")),
                onPressed: () => _add(
                  () => _picker.pickMultipleMedia(
                    imageQuality: 85,
                    maxWidth: 2560,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            _t(
              "Videos up to 5 minutes (500 MB) — use school Wi-Fi for long ones. Each item is checked before your class's parents see it.",
              "वीडियो 5 मिनट (500 MB) तक — लंबे वीडियो स्कूल वाई-फ़ाई पर भेजें। हर फ़ोटो/वीडियो अभिभावकों तक पहुँचने से पहले जाँचा जाता है।",
            ),
            style: AppText.bodySmallMuted,
          ),
          if (_uploads.isNotEmpty) ...[
            const SizedBox(height: 14),
            Text(
              _t(
                "Added $done of ${_uploads.length}",
                "${_uploads.length} में से $done जोड़े गए",
              ),
              style: AppText.bodyMediumInk.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            for (final u in _uploads)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: Icon(
                    u.isVideo ? Icons.videocam_outlined : Icons.photo_outlined,
                  ),
                  title: Text(
                    u.file.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: u.error.isNotEmpty
                      ? Text(
                          u.error,
                          style: const TextStyle(color: AppColors.danger),
                        )
                      : u.done
                      ? Text(
                          u.status == "ok"
                              ? _t(
                                  "Shared with your class's parents",
                                  "कक्षा के अभिभावकों को दिखाई गई",
                                )
                              : u.status == "held"
                              ? _t(
                                  "Held — the principal will look at it",
                                  "रोकी गई — प्रधानाचार्य देखेंगे",
                                )
                              : _t(
                                  "Saved — being checked, parents see it once it passes",
                                  "सहेजी गई — जाँच के बाद अभिभावकों को दिखेगी",
                                ),
                          style: TextStyle(
                            color: u.status == "held"
                                ? AppColors.warning
                                : AppColors.success,
                          ),
                        )
                      : u.progress >= 1
                      ? Text(
                          _t("Checking…", "जाँच हो रही है…"),
                          style: AppText.labelMediumMuted,
                        )
                      : LinearProgressIndicator(
                          value: u.progress == 0 ? null : u.progress,
                        ),
                  trailing: u.done
                      ? Icon(
                          u.status == "held"
                              ? Icons.shield_outlined
                              : Icons.check_circle,
                          color: u.status == "held"
                              ? AppColors.warning
                              : AppColors.success,
                        )
                      : null,
                  onTap: u.error.isEmpty
                      ? null
                      : () {
                          setState(() {
                            u.error = "";
                            u.progress = 0;
                          });
                          _runQueue();
                        },
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// The principal's list: items the AI check held (and those still being
/// checked). Approve shows it to the class's parents; Remove deletes it.
class ClassReviewScreen extends StatefulWidget {
  const ClassReviewScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<ClassReviewScreen> createState() => _ClassReviewScreenState();
}

class _ClassReviewScreenState extends State<ClassReviewScreen> {
  List<ClassReviewItem> _items = const [];
  bool _loading = true;
  String _error = "";
  final Set<String> _busy = {};

  bool get _hi => Localizations.localeOf(context).languageCode == "hi";
  String _t(String en, String hi) => _hi ? hi : en;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = "";
    });
    try {
      final items = await widget.api.fetchClassReview();
      if (mounted) setState(() => _items = items);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _t(
            "Could not load — pull to retry.",
            "लोड नहीं हुआ — फिर से खींचें।",
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _decide(ClassReviewItem item, String action) async {
    if (action == "remove") {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(_t("Remove this?", "इसे हटाएँ?")),
          content: Text(
            _t(
              "It will be deleted and no parent will see it.",
              "यह हटा दी जाएगी और कोई अभिभावक इसे नहीं देखेगा।",
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(_t("Cancel", "रद्द करें")),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(_t("Remove", "हटाएँ")),
            ),
          ],
        ),
      );
      if (ok != true) return;
    }
    setState(() => _busy.add(item.id));
    try {
      await widget.api.decideClassItem(item.id, action);
      if (mounted) {
        setState(() => _items = _items.where((i) => i.id != item.id).toList());
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Future<void> _play(ClassReviewItem item) async {
    try {
      final link = await widget.api.galleryVideoLink(item.id);
      if (link.isNotEmpty) {
        await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_t("Held for review", "जाँच के लिए रोकी गई"))),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_loading && _items.isEmpty)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: CircularProgressIndicator(),
                ),
              ),
            if (_error.isNotEmpty)
              Text(_error, style: const TextStyle(color: AppColors.danger)),
            if (!_loading && _error.isEmpty && _items.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 24),
                child: Text(
                  _t(
                    "Nothing is waiting for you.",
                    "आपके निर्णय के लिए कुछ भी नहीं है।",
                  ),
                  textAlign: TextAlign.center,
                  style: AppText.bodySmallMuted,
                ),
              ),
            for (final item in _items)
              Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        [
                          item.classLabel,
                          item.event,
                        ].where((x) => x.isNotEmpty).join(" · "),
                        style: AppText.bodyMediumInk.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        item.status == "pending"
                            ? _t("Still being checked", "अभी जाँच हो रही है")
                            : (item.note.isEmpty
                                  ? _t(
                                      "Held by the AI check",
                                      "AI जाँच ने रोका",
                                    )
                                  : item.note),
                        style: TextStyle(
                          color: item.status == "pending"
                              ? AppColors.muted
                              : AppColors.warning,
                        ),
                      ),
                      if (item.uploadedBy.isNotEmpty)
                        Text(
                          _t(
                            "By ${item.uploadedBy}",
                            "${item.uploadedBy} द्वारा",
                          ),
                          style: AppText.labelMediumMuted,
                        ),
                      const SizedBox(height: 8),
                      if (item.isVideo)
                        OutlinedButton.icon(
                          onPressed: () => _play(item),
                          icon: const Icon(Icons.play_circle_outline),
                          label: Text(_t("Play video", "वीडियो चलाएँ")),
                        )
                      else
                        FutureBuilder<Map<String, String>>(
                          future: widget.api.imageHeaders(),
                          builder: (context, snap) => snap.data == null
                              ? const SizedBox(height: 180)
                              : ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: Image.network(
                                    item.url,
                                    headers: widget.api.isOwnServer(item.url)
                                        ? snap.data
                                        : null,
                                    height: 220,
                                    width: double.infinity,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, _, _) => const SizedBox(
                                      height: 80,
                                      child: Center(
                                        child: Icon(
                                          Icons.broken_image_outlined,
                                          color: AppColors.muted,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                        ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: _busy.contains(item.id)
                                  ? null
                                  : () => _decide(item, "approve"),
                              icon: const Icon(Icons.check),
                              label: Text(_t("Approve", "स्वीकृत करें")),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: _busy.contains(item.id)
                                  ? null
                                  : () => _decide(item, "remove"),
                              icon: const Icon(
                                Icons.delete_outline,
                                color: AppColors.danger,
                              ),
                              label: Text(
                                _t("Remove", "हटाएँ"),
                                style: const TextStyle(color: AppColors.danger),
                              ),
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
      ),
    );
  }
}
