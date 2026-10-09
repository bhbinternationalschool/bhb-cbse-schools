import "package:flutter/material.dart";

import "../api/api_client.dart";
import "../theme/app_theme.dart";
import "../update/app_build.dart";
import "parent_guides.dart";
import "staff_guides.dart";

/// The screen guide (director, 9 Oct 2026: a guide "for parent as well as
/// staff app" like the web ERP's). Every screen can show numbered steps in
/// English or Hindi from the ? button; the same error twice offers help;
/// and anyone signed in can suggest a change, which the AI writes up and
/// sends to the director's inbox (Modules → Requests on the web). A
/// suggestion is built only after the director approves it.
class ScreenGuide {
  const ScreenGuide({
    required this.id,
    required this.titleEn,
    required this.titleHi,
    required this.stepsEn,
    required this.stepsHi,
    this.tipsEn = const [],
    this.tipsHi = const [],
  });

  final String id;
  final String titleEn;
  final String titleHi;
  final List<String> stepsEn;
  final List<String> stepsHi;
  final List<String> tipsEn;
  final List<String> tipsHi;
}

class _OnScreen {
  _OnScreen(this.id, this.label, this.context);
  final String id;
  final String label;
  final BuildContext context;
}

/// Which guided screen is showing, and the "same error twice" watch.
class ScreenGuides {
  ScreenGuides._();

  /// Set once by the app so the guide can send suggestions and stuck points.
  static ApiClient? api;

  static final Map<String, ScreenGuide> _all = {
    for (final g in [...parentScreenGuides, ...staffScreenGuides]) g.id: g,
  };

  /// A screen shared by both apps (homework, notices, PTM…) passes one id;
  /// the guide for the running app wins: "homework" → "homework-parent" in
  /// the parent app, "homework-staff" in the staff app, else "homework".
  static ScreenGuide? byId(String id) {
    final flavor = AppBuild.flavor == "staff" ? "staff" : "parent";
    return _all["$id-$flavor"] ?? _all[id];
  }

  static final List<_OnScreen> _stack = [];
  static final List<(String, DateTime)> _errors = [];
  static final Set<String> _reported = {};

  /// A guided screen came into view (ModuleShell / ScreenGuideButton).
  static void enter(String id, String label, BuildContext context) {
    _stack.add(_OnScreen(id, label, context));
  }

  static void leave(BuildContext context) {
    _stack.removeWhere((s) => s.context == context);
  }

  /// Called for every error the server returns (ApiClient._throwFrom). The
  /// same message again within ten minutes means the user is stuck: offer
  /// the guide for this screen, and count it for the director once.
  static void noteError(String message) {
    final now = DateTime.now();
    _errors.removeWhere((e) => now.difference(e.$2).inMinutes >= 10);
    final repeated = _errors.any((e) => e.$1 == message);
    _errors.add((message, now));
    if (!repeated || _stack.isEmpty) return;
    final top = _stack.last;
    if (!top.context.mounted) return;
    final key = "${top.id}|$message";
    if (_reported.add(key)) {
      api?.appGuideStuck(screen: top.id, message: message);
    }
    final hindi = Localizations.localeOf(top.context).languageCode == "hi";
    // After the screen's own error bar has had its moment.
    Future.delayed(const Duration(milliseconds: 600), () {
      if (!top.context.mounted) return;
      ScaffoldMessenger.maybeOf(top.context)?.showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 8),
          content: Text(
            hindi
                ? "अटक गए? यह स्क्रीन कैसे काम करती है, देखें।"
                : "Stuck? See how this screen works.",
          ),
          action: SnackBarAction(
            label: hindi ? "मदद" : "Help",
            onPressed: () => showScreenGuide(
              top.context,
              top.id,
              top.label,
              stuckOn: message,
            ),
          ),
        ),
      );
    });
  }
}

/// The ? button for an app bar. Registers its screen with the tracker so the
/// stuck watch knows where the user is.
class ScreenGuideButton extends StatefulWidget {
  const ScreenGuideButton({
    super.key,
    required this.guideId,
    required this.screenLabel,
    this.onLight = true,
  });

  final String guideId;
  final String screenLabel;
  final bool onLight;

  @override
  State<ScreenGuideButton> createState() => _ScreenGuideButtonState();
}

class _ScreenGuideButtonState extends State<ScreenGuideButton> {
  @override
  void initState() {
    super.initState();
    ScreenGuides.enter(widget.guideId, widget.screenLabel, context);
  }

  @override
  void dispose() {
    ScreenGuides.leave(context);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    return IconButton(
      tooltip: hindi ? "यह स्क्रीन कैसे चलाएँ" : "How this screen works",
      icon: Icon(
        Icons.help_outline,
        color: widget.onLight ? Colors.white : AppColors.primary,
      ),
      onPressed: () =>
          showScreenGuide(context, widget.guideId, widget.screenLabel),
    );
  }
}

/// **bold** → bold spans, the way the guides mark button names.
List<TextSpan> _rich(String text, TextStyle base) {
  final parts = text.split(RegExp(r"(\*\*[^*]+\*\*)"));
  return [
    for (final p in parts)
      if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
        TextSpan(
          text: p.substring(2, p.length - 2),
          style: base.copyWith(fontWeight: FontWeight.w700),
        )
      else
        TextSpan(text: p, style: base),
  ];
}

Future<void> showScreenGuide(
  BuildContext context,
  String guideId,
  String screenLabel, {
  String? stuckOn,
}) {
  final guide = ScreenGuides.byId(guideId);
  final hindi = Localizations.localeOf(context).languageCode == "hi";
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) {
      final base = Theme.of(ctx).textTheme.bodyMedium ?? const TextStyle();
      final steps = guide == null
          ? const <String>[]
          : (hindi ? guide.stepsHi : guide.stepsEn);
      final tips = guide == null
          ? const <String>[]
          : (hindi ? guide.tipsHi : guide.tipsEn);
      return SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(ctx).size.height * 0.85,
          ),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            children: [
              Text(
                guide == null
                    ? screenLabel
                    : (hindi ? guide.titleHi : guide.titleEn),
                style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.primary,
                ),
              ),
              if (stuckOn != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.danger.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    "${hindi ? "आपको यह संदेश दिखा" : "You saw this message"}: “$stuckOn”",
                    style: base,
                  ),
                ),
              ],
              const SizedBox(height: 12),
              if (steps.isEmpty)
                Text(
                  hindi
                      ? "इस स्क्रीन की गाइड अभी तैयार हो रही है।"
                      : "A guide for this screen is on its way.",
                  style: base,
                ),
              for (var i = 0; i < steps.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      CircleAvatar(
                        radius: 11,
                        backgroundColor: AppColors.primary,
                        child: Text(
                          "${i + 1}",
                          style: const TextStyle(
                            fontSize: 11,
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text.rich(
                          TextSpan(children: _rich(steps[i], base)),
                        ),
                      ),
                    ],
                  ),
                ),
              if (tips.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  hindi ? "अगर अटक जाएँ" : "If you get stuck",
                  style: base.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                for (final t in tips)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(text: "• ", style: base),
                          ..._rich(t, base),
                        ],
                      ),
                    ),
                  ),
              ],
              const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.lightbulb_outline),
                label: Text(
                  hindi
                      ? "इस स्क्रीन में बदलाव सुझाएँ"
                      : "Suggest a change to this screen",
                ),
                onPressed: () {
                  Navigator.of(ctx).pop();
                  showSuggestChange(
                    context,
                    guideId,
                    screenLabel,
                    seed: stuckOn,
                  );
                },
              ),
            ],
          ),
        ),
      );
    },
  );
}

/// The user describes a change; the AI asks one question if it must, then
/// shows the request for them to send to the director.
Future<void> showSuggestChange(
  BuildContext context,
  String guideId,
  String screenLabel, {
  String? seed,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: _SuggestChangeSheet(
        guideId: guideId,
        screenLabel: screenLabel,
        seed: seed,
      ),
    ),
  );
}

class _SuggestChangeSheet extends StatefulWidget {
  const _SuggestChangeSheet({
    required this.guideId,
    required this.screenLabel,
    this.seed,
  });
  final String guideId;
  final String screenLabel;
  final String? seed;

  @override
  State<_SuggestChangeSheet> createState() => _SuggestChangeSheetState();
}

class _SuggestChangeSheetState extends State<_SuggestChangeSheet> {
  final _text = TextEditingController();
  final List<Map<String, String>> _history = [];
  Map<String, dynamic>? _card;
  bool _busy = false;
  bool _sent = false;
  String _error = "";

  @override
  void initState() {
    super.initState();
    if (widget.seed != null) {
      _history.add({
        "role": "user",
        "text": "I keep getting this message: ${widget.seed}",
      });
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final api = ScreenGuides.api;
    final t = _text.text.trim();
    if (api == null || t.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = "";
      _history.add({"role": "user", "text": t});
      _text.clear();
    });
    try {
      final d = await api.appGuideDraft(
        screen: widget.guideId,
        screenLabel: widget.screenLabel,
        history: _history,
      );
      if (!mounted) return;
      setState(() {
        if (d["ready"] == true) {
          _card = d;
        } else {
          _history.add({"role": "assistant", "text": "${d["question"] ?? ""}"});
        }
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    final api = ScreenGuides.api;
    final card = _card;
    if (api == null || card == null || _busy) return;
    setState(() => _busy = true);
    try {
      await api.appGuideSubmit(
        screen: widget.guideId,
        screenLabel: widget.screenLabel,
        history: _history,
        card: card,
      );
      if (mounted) setState(() => _sent = true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    final base = Theme.of(context).textTheme.bodyMedium ?? const TextStyle();
    final card = _card;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.85,
        ),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          children: [
            Text(
              hindi
                  ? "बदलाव सुझाएँ — ${widget.screenLabel}"
                  : "Suggest a change — ${widget.screenLabel}",
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 8),
            if (_sent)
              Text(
                hindi
                    ? "✅ स्कूल को भेज दिया गया। मंज़ूरी के बाद यह बदलाव ऐप में आ जाएगा।"
                    : "✅ Sent to the school. Once it is approved, the change will come to the app.",
                style: base,
              )
            else ...[
              if (_history.isEmpty)
                Text(
                  hindi
                      ? "क्या ठीक नहीं है या क्या कमी है, और आप क्या चाहते हैं — अपने शब्दों में लिखें।"
                      : "Tell us what is wrong or missing, and what you would like instead — in your own words.",
                  style: base,
                ),
              for (final m in _history)
                Align(
                  alignment: m["role"] == "user"
                      ? Alignment.centerRight
                      : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 6),
                    padding: const EdgeInsets.all(10),
                    constraints: const BoxConstraints(maxWidth: 320),
                    decoration: BoxDecoration(
                      color: m["role"] == "user"
                          ? AppColors.primary
                          : AppColors.surface,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      m["text"] ?? "",
                      style: base.copyWith(
                        color: m["role"] == "user"
                            ? Colors.white
                            : AppColors.ink,
                      ),
                    ),
                  ),
                ),
              if (card != null) ...[
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.accent),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "💡 ${card["title"] ?? ""}",
                        style: base.copyWith(fontWeight: FontWeight.w700),
                      ),
                      if ("${card["problem"] ?? ""}".isNotEmpty)
                        Text(
                          "${hindi ? "समस्या" : "Problem"}: ${card["problem"]}",
                          style: base,
                        ),
                      if ("${card["wanted"] ?? ""}".isNotEmpty)
                        Text(
                          "${hindi ? "चाहिए" : "Wanted"}: ${card["wanted"]}",
                          style: base,
                        ),
                      Text(
                        "${hindi ? "बदलाव" : "Change"}: ${card["suggestion"] ?? ""}",
                        style: base,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: Text(hindi ? "स्कूल को भेजें" : "Send to the school"),
                ),
                Text(
                  hindi
                      ? "कुछ बदलना है? नीचे लिखें, मैं दोबारा लिख दूँगा।"
                      : "Want it different? Type below and I'll rewrite it.",
                  style: base.copyWith(color: AppColors.muted, fontSize: 12),
                ),
              ],
              if (_error.isNotEmpty)
                Text(_error, style: base.copyWith(color: AppColors.danger)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _text,
                      minLines: 1,
                      maxLines: 4,
                      decoration: InputDecoration(
                        hintText: hindi ? "यहाँ लिखें…" : "Type here…",
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _busy ? null : _send,
                    icon: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.send),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
