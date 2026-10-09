import "package:flutter/material.dart";

import "../api/api_client.dart";
import "../theme/app_theme.dart";

/// App pop-ups (director, 9 Oct 2026): a poster, an announcement or a short
/// form the school posts from the web ERP (Comms → App pop-ups), shown once
/// when the app opens. Some are aimed by a rule on the family's own record —
/// a missing document, a missing Aadhaar number, a consent not answered —
/// and stop by themselves once the record is complete.
///
/// At most one pop-up per app open: a queue of them on every launch would
/// teach people to tap "Later" without reading.
class AppPopup {
  AppPopup.fromJson(Map<String, dynamic> j)
    : id = "${j["id"] ?? ""}",
      title = "${j["title"] ?? ""}",
      titleHi = "${j["titleHi"] ?? ""}",
      body = "${j["body"] ?? ""}",
      bodyHi = "${j["bodyHi"] ?? ""}",
      imageUrl = "${j["imageUrl"] ?? ""}",
      form = "${j["form"] ?? "none"}",
      consentText = "${j["consentText"] ?? ""}",
      consentTextHi = "${j["consentTextHi"] ?? ""}",
      ctaLabel = "${j["ctaLabel"] ?? ""}",
      ctaRoute = "${j["ctaRoute"] ?? ""}",
      targets = ((j["targets"] as List?) ?? const [])
          .map(
            (t) => (
              key: "${(t as Map)["key"]}",
              label: "${t["label"]}",
              labelHi: "${t["labelHi"] ?? t["label"]}",
            ),
          )
          .toList();

  final String id, title, titleHi, body, bodyHi, imageUrl, form;
  final String consentText, consentTextHi, ctaLabel, ctaRoute;

  /// Aadhaar: whose number is missing ("stu_…", "father", "mother").
  /// Documents: the children with documents missing ("stu_…").
  final List<({String key, String label, String labelHi})> targets;
}

class AppPopups {
  AppPopups._();

  static bool _shownThisRun = false;

  /// Call once the home screen has loaded. Shows the first pop-up meant for
  /// this person, if any. `openDocuments` opens a child's documents screen;
  /// `openRoute` an app screen named by the pop-up's button.
  static Future<void> maybeShow(
    BuildContext context,
    ApiClient api, {
    void Function(String studentId)? openDocuments,
    void Function(String route)? openRoute,
  }) async {
    if (_shownThisRun) return;
    _shownThisRun = true;
    List<AppPopup> list;
    try {
      list = await api.fetchAppPopups();
    } catch (_) {
      return; // A pop-up is never worth an error on the home screen.
    }
    if (list.isEmpty || !context.mounted) return;
    final p = list.first;
    api.appPopupEvent(p.id, "shown");
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _PopupDialog(
        popup: p,
        api: api,
        openDocuments: openDocuments,
        openRoute: openRoute,
      ),
    );
  }
}

class _PopupDialog extends StatefulWidget {
  const _PopupDialog({
    required this.popup,
    required this.api,
    this.openDocuments,
    this.openRoute,
  });
  final AppPopup popup;
  final ApiClient api;
  final void Function(String studentId)? openDocuments;
  final void Function(String route)? openRoute;

  @override
  State<_PopupDialog> createState() => _PopupDialogState();
}

class _PopupDialogState extends State<_PopupDialog> {
  final Map<String, TextEditingController> _aadhaar = {};
  bool _busy = false;
  String _error = "";

  bool get _hi => Localizations.localeOf(context).languageCode == "hi";
  String _t(String en, String hi) => _hi && hi.isNotEmpty ? hi : en;

  @override
  void initState() {
    super.initState();
    for (final t in widget.popup.targets) {
      _aadhaar[t.key] = TextEditingController();
    }
  }

  @override
  void dispose() {
    for (final c in _aadhaar.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _later() async {
    widget.api.appPopupEvent(widget.popup.id, "dismissed");
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _done(Map<String, dynamic> value) async {
    setState(() {
      _busy = true;
      _error = "";
    });
    try {
      await widget.api.appPopupDone(widget.popup.id, value);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _t(
            "Not saved — could not reach the school server.",
            "सेव नहीं हुआ — स्कूल के सर्वर से जुड़ नहीं पाए।",
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveAadhaar() async {
    final numbers = <String, String>{};
    for (final e in _aadhaar.entries) {
      final n = e.value.text.replaceAll(RegExp(r"\D"), "");
      if (n.isEmpty) continue;
      if (!aadhaarLooksValid(n)) {
        final who = widget.popup.targets.firstWhere((t) => t.key == e.key);
        setState(
          () => _error = _t(
            "Check ${who.label}'s Aadhaar number — it is not a valid 12-digit Aadhaar.",
            "${who.labelHi} का आधार नंबर जाँचें — यह सही 12 अंकों का आधार नहीं है।",
          ),
        );
        return;
      }
      numbers[e.key] = n;
    }
    if (numbers.isEmpty) {
      setState(
        () => _error = _t(
          "Type at least one Aadhaar number, or tap Later.",
          "कम से कम एक आधार नंबर लिखें, या बाद में दबाएँ।",
        ),
      );
      return;
    }
    await _done({"aadhaar": numbers});
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.popup;
    final base = Theme.of(context).textTheme.bodyMedium ?? const TextStyle();
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.88,
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (p.imageUrl.isNotEmpty)
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(
                    p.imageUrl,
                    fit: BoxFit.contain,
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                ),
              if (p.imageUrl.isNotEmpty) const SizedBox(height: 12),
              Text(
                _t(p.title, p.titleHi),
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.primary,
                ),
              ),
              if (_t(p.body, p.bodyHi).isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(_t(p.body, p.bodyHi), style: base),
              ],
              const SizedBox(height: 12),
              if (p.form == "aadhaar") ...[
                Text(
                  _t(
                    "Used only for the school's records, UDISE+ and APAAR. The app shows it hidden (XXXX-XXXX-1234).",
                    "यह केवल स्कूल के रिकॉर्ड, UDISE+ और APAAR के लिए है। ऐप में यह छिपा दिखेगा (XXXX-XXXX-1234)।",
                  ),
                  style: base.copyWith(color: AppColors.muted, fontSize: 12),
                ),
                const SizedBox(height: 8),
                for (final t in p.targets)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TextField(
                      controller: _aadhaar[t.key],
                      keyboardType: TextInputType.number,
                      maxLength: 14,
                      decoration: InputDecoration(
                        labelText: _t(
                          "${t.label} — Aadhaar number",
                          "${t.labelHi} — आधार नंबर",
                        ),
                        border: const OutlineInputBorder(),
                        counterText: "",
                      ),
                    ),
                  ),
              ],
              if (p.form == "consent") ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(_t(p.consentText, p.consentTextHi), style: base),
                ),
                const SizedBox(height: 12),
              ],
              if (p.form == "documents")
                for (final t in p.targets)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.upload_file),
                      label: Text(
                        _t(
                          "Upload documents — ${t.label}",
                          "दस्तावेज़ अपलोड करें — ${t.labelHi}",
                        ),
                      ),
                      onPressed: widget.openDocuments == null
                          ? null
                          : () {
                              Navigator.of(context).pop();
                              widget.openDocuments!(t.key);
                            },
                    ),
                  ),
              if (_error.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    _error,
                    style: base.copyWith(color: AppColors.danger),
                  ),
                ),
              if (p.form == "aadhaar")
                FilledButton(
                  onPressed: _busy ? null : _saveAadhaar,
                  child: Text(_t("Save", "सेव करें")),
                ),
              if (p.form == "consent") ...[
                FilledButton(
                  onPressed: _busy ? null : () => _done({"consent": "yes"}),
                  child: Text(_t("I agree", "मैं सहमत हूँ")),
                ),
                const SizedBox(height: 6),
                OutlinedButton(
                  onPressed: _busy ? null : () => _done({"consent": "no"}),
                  child: Text(_t("I do not agree", "मैं सहमत नहीं हूँ")),
                ),
              ],
              if (p.form == "none" &&
                  p.ctaLabel.isNotEmpty &&
                  p.ctaRoute.isNotEmpty &&
                  widget.openRoute != null)
                FilledButton(
                  onPressed: () {
                    widget.api.appPopupEvent(p.id, "done");
                    Navigator.of(context).pop();
                    widget.openRoute!(p.ctaRoute);
                  },
                  child: Text(p.ctaLabel),
                ),
              if (p.form == "none" &&
                  (p.ctaLabel.isEmpty ||
                      p.ctaRoute.isEmpty ||
                      widget.openRoute == null))
                FilledButton(
                  onPressed: () {
                    widget.api.appPopupEvent(p.id, "done");
                    Navigator.of(context).pop();
                  },
                  child: Text(_t("OK", "ठीक है")),
                ),
              TextButton(
                onPressed: _busy ? null : _later,
                child: Text(_t("Later", "बाद में")),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Aadhaar's own checksum (Verhoeff), so a mistyped digit is caught on the
/// phone. The server checks again.
bool aadhaarLooksValid(String raw) {
  final n = raw.replaceAll(RegExp(r"\D"), "");
  if (!RegExp(r"^[2-9]\d{11}$").hasMatch(n)) return false;
  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  var c = 0;
  final digits = n.split("").reversed.map(int.parse).toList();
  for (var i = 0; i < digits.length; i++) {
    c = d[c][p[i % 8][digits[i]]];
  }
  return c == 0;
}
