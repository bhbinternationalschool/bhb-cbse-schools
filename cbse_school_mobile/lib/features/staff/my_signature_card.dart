
import "package:flutter/foundation.dart";
import "package:flutter/material.dart";
import "package:image_picker/image_picker.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "signature_cleanup.dart";

/// Picks a picture of the signature: camera or gallery; null = cancelled.
typedef SignaturePicker = Future<Uint8List?> Function(ImageSource source);

/// Turns the picked picture into the PNG that is uploaded (trimmed, transparent).
typedef SignatureCleaner = Future<Uint8List> Function(Uint8List picked);

Future<Uint8List?> _pickWithImagePicker(ImageSource source) async {
  // Big enough for a crisp signature; the cleaner crops and shrinks it.
  final shot = await ImagePicker().pickImage(
    source: source,
    maxWidth: 2000,
    maxHeight: 2000,
    imageQuality: 92,
    preferredCameraDevice: CameraDevice.rear,
  );
  return shot == null ? null : await shot.readAsBytes();
}

Future<Uint8List> _cleanInBackground(Uint8List picked) => compute(cleanSignaturePng, picked);

/// The server's limit (lib/staffSignature.ts SIGNATURE_MAX_BYTES).
const kSignatureMaxBytes = 1024 * 1024;

/// "My signature" on the staff app profile (director, 15 Oct 2026): teachers
/// and the principal put their signature on their own record — the same
/// field the office edits on the web staff form — to be printed on the
/// school's papers. Add, preview before saving, replace, remove.
class MySignatureCard extends StatefulWidget {
  const MySignatureCard({
    super.key,
    required this.api,
    required this.signatureUrl,
    required this.onChanged,
    this.pick = _pickWithImagePicker,
    this.clean = _cleanInBackground,
  });

  final ApiClient api;

  /// Full URL of the saved signature, or "".
  final String signatureUrl;

  /// After a save or a removal, with the new URL ("" = removed).
  final ValueChanged<String> onChanged;
  final SignaturePicker pick;
  final SignatureCleaner clean;

  @override
  State<MySignatureCard> createState() => _MySignatureCardState();
}

class _MySignatureCardState extends State<MySignatureCard> {
  bool _busy = false;
  int _rev = 0;
  late final Future<Map<String, String>> _headers = widget.api.imageHeaders();

  bool get _hi => Localizations.localeOf(context).languageCode == "hi";
  String _t(String en, String hi) => _hi ? hi : en;

  void _toast(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text), backgroundColor: error ? AppColors.danger : null),
    );
  }

  Future<void> _add() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
              child: Text(
                _t(
                  "Sign in dark ink on plain white paper, then photograph it flat, close up, in good light.",
                  "सफ़ेद कागज़ पर गहरी स्याही से हस्ताक्षर करें, फिर अच्छी रोशनी में पास से सीधी फ़ोटो लें।",
                ),
                style: AppText.bodySmallMuted,
              ),
            ),
            ListTile(
              key: const Key("signature-camera"),
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(_t("Take a photo", "फ़ोटो खींचें")),
              onTap: () => Navigator.pop(sheet, ImageSource.camera),
            ),
            ListTile(
              key: const Key("signature-gallery"),
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(_t("Choose from gallery", "गैलरी से चुनें")),
              onTap: () => Navigator.pop(sheet, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;

    Uint8List? picked;
    try {
      picked = await widget.pick(source);
    } catch (_) {
      if (mounted) _toast(_t("Could not open the camera or gallery.", "कैमरा/गैलरी नहीं खुली।"), error: true);
      return;
    }
    if (picked == null || !mounted) return;

    setState(() => _busy = true);
    Uint8List png;
    try {
      png = await widget.clean(picked);
    } on SignatureCleanupException catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        _toast(e.message, error: true);
      }
      return;
    } catch (_) {
      if (mounted) {
        setState(() => _busy = false);
        _toast(_t("This picture could not be read.", "यह तस्वीर पढ़ी नहीं जा सकी।"), error: true);
      }
      return;
    }
    if (!mounted) return;
    setState(() => _busy = false);
    if (png.length > kSignatureMaxBytes) {
      _toast(
        _t("The signature is larger than 1 MB — photograph it closer.", "हस्ताक्षर 1 MB से बड़ा है — पास से फ़ोटो लें।"),
        error: true,
      );
      return;
    }

    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(_t("Your signature", "आपके हस्ताक्षर")),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Paper(child: Image.memory(png, key: const Key("signature-preview"), fit: BoxFit.contain)),
            const SizedBox(height: 10),
            Text(
              _t(
                "Trimmed to the ink, paper made see-through. This is how it will print.",
                "स्याही तक काटा गया, कागज़ पारदर्शी। छपने पर ऐसा दिखेगा।",
              ),
              style: AppText.bodySmallMuted,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(_t("Try again", "फिर से"))),
          FilledButton(
            key: const Key("signature-save"),
            onPressed: () => Navigator.pop(d, true),
            child: Text(_t("Save signature", "हस्ताक्षर सहेजें")),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    try {
      final url = await widget.api.uploadMySignature(png);
      if (!mounted) return;
      setState(() => _rev += 1);
      widget.onChanged(url);
      _toast(_t("Signature saved.", "हस्ताक्षर सहेजे गए।"));
    } on ApiException catch (e) {
      if (mounted) _toast(e.message, error: true);
    } catch (_) {
      if (mounted) _toast(_t("The signature was not saved. Try again.", "हस्ताक्षर नहीं सहेजे गए।"), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(_t("Remove your signature?", "हस्ताक्षर हटाएँ?")),
        content: Text(
          _t(
            "Papers will print without it until you add one again.",
            "जब तक आप फिर से नहीं जोड़ते, कागज़ बिना हस्ताक्षर छपेंगे।",
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(_t("Keep", "रहने दें"))),
          FilledButton(
            key: const Key("signature-remove-confirm"),
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(d, true),
            child: Text(_t("Remove", "हटाएँ")),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.api.removeMySignature();
      if (!mounted) return;
      widget.onChanged("");
      _toast(_t("Signature removed.", "हस्ताक्षर हटाए गए।"));
    } on ApiException catch (e) {
      if (mounted) _toast(e.message, error: true);
    } catch (_) {
      if (mounted) _toast(_t("The signature was not removed. Try again.", "हस्ताक्षर नहीं हटे।"), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final url = widget.signatureUrl;
    final has = url.isNotEmpty;
    return Card(
      key: const Key("my-signature-card"),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_t("My signature", "मेरे हस्ताक्षर"), style: AppText.titleMediumInk.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(
              _t(
                "Printed on the school's papers that you sign. Only you can set it.",
                "आपके हस्ताक्षर वाले स्कूल के कागज़ों पर छपेगा। इसे केवल आप बदल सकते हैं।",
              ),
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 12),
            _Paper(
              child: !has
                  ? Center(
                      child: Text(
                        _t("No signature yet", "अभी हस्ताक्षर नहीं"),
                        key: const Key("signature-empty"),
                        style: AppText.labelMediumMuted,
                      ),
                    )
                  : FutureBuilder<Map<String, String>>(
                      future: _headers,
                      builder: (context, snap) => snap.data == null
                          ? const SizedBox.shrink()
                          : Image.network(
                              url,
                              key: ValueKey("signature-saved#$url#$_rev"),
                              headers: widget.api.isOwnServer(url) ? snap.data : null,
                              fit: BoxFit.contain,
                              errorBuilder: (_, _, _) => Center(
                                child: Text(
                                  _t("Saved — could not show it just now", "सहेजा गया — अभी दिखा नहीं सके"),
                                  style: AppText.labelMediumMuted,
                                ),
                              ),
                            ),
                    ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                FilledButton.tonalIcon(
                  key: const Key("signature-add"),
                  onPressed: _busy ? null : _add,
                  icon: _busy
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.draw_outlined, size: 18),
                  label: Text(has ? _t("Replace", "बदलें") : _t("Add signature", "हस्ताक्षर जोड़ें")),
                ),
                if (has)
                  TextButton.icon(
                    key: const Key("signature-remove"),
                    onPressed: _busy ? null : _remove,
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: Text(_t("Remove", "हटाएँ")),
                    style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// White "paper" with a faint grid, so a transparent signature reads as it
/// will print, in light and dark themes alike.
class _Paper extends StatelessWidget {
  const _Paper({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    height: 110,
    padding: const EdgeInsets.all(8),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: const Color(0xFFD9DEE8)),
      borderRadius: BorderRadius.circular(12),
    ),
    child: child,
  );
}
