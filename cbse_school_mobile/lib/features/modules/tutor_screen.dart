import "package:flutter/material.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:speech_to_text/speech_to_text.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../../core/ui/motion.dart";
import "../../core/ui/spacing.dart";
import "video_player_screen.dart";

/// What the tutor is told about the child and, when opened from a
/// homework item, the assignment.
class TutorContext {
  const TutorContext({
    required this.child,
    this.subjectLabel = "",
    this.homeworkTitle = "",
    this.homeworkBody = "",
  });

  final ParentChild child;
  final String subjectLabel;
  final String homeworkTitle;
  final String homeworkBody;

  Map<String, String> toJson() => {
    "childName": child.fullName,
    "className": [
      child.className,
      if (child.sectionName.isNotEmpty) child.sectionName,
    ].join(" "),
    if (subjectLabel.isNotEmpty) "subjectLabel": subjectLabel,
    if (homeworkTitle.isNotEmpty) "homeworkTitle": homeworkTitle,
    if (homeworkBody.isNotEmpty) "homeworkBody": homeworkBody,
  };
}

/// The AI tutor for parents. Hints are free (a daily allowance); the full
/// tutor — teaching, examples, practice, checking answers, homework help,
/// exam prep — runs for the length of a pass. Replies stream in as the
/// tutor writes them.
class TutorScreen extends StatefulWidget {
  const TutorScreen({
    super.key,
    required this.api,
    required this.context,
    this.initialMode = "hint",
  });

  final ApiClient api;
  final TutorContext context;
  final String initialMode;

  @override
  State<TutorScreen> createState() => _TutorScreenState();
}

class _Msg {
  _Msg(this.role, this.text, {this.mode = "", this.topic = ""});

  final String role;
  String text;
  final String mode;

  /// For an assistant reply: the question it answered — the video topic.
  final String topic;
  String charge = "";
}

/// The few UI strings a Hindi-first parent must be able to read.
const _hi = <String, String>{
  "watch": "वीडियो देखें",
  "videosTitle": "इस विषय के वीडियो",
  "search": "YouTube पर खोजें",
  "noVideos": "अभी कोई वीडियो नहीं मिला — YouTube पर खोजें।",
  "hint_prompt": "जैसे: भिन्न कैसे समझाऊँ?",
  "teach_prompt": "जैसे: कक्षा 5 के लिए प्रकाश संश्लेषण सिखाइए",
  "examples_prompt": "जैसे: भाग के तीन हल किए हुए उदाहरण",
  "practice_prompt": "जैसे: कक्षा 4 के लिए काल पर 5 प्रश्न",
  "score_prompt": "प्रश्न और बच्चे के उत्तर यहाँ लिखें",
  "homework_prompt": "जैसे: आज के गणित के होमवर्क में मदद",
  "exam_prompt": "जैसे: कक्षा 3 की EVS यूनिट टेस्ट की तैयारी",
};

class _TutorScreenState extends State<TutorScreen> {
  TutorStatus? _status;
  String? _error;
  late String _mode = widget.initialMode;

  /// "hi", "both" (Hindi then English) or "en"; starts from the family's
  /// preference on record.
  String _language = "en";
  final _messages = <_Msg>[];
  final _input = TextEditingController();
  final _scroll = ScrollController();
  bool _busy = false;

  static const _guideSeenKey = "tutor_guide_seen_v1";

  @override
  void initState() {
    super.initState();
    _load();
    _maybeShowGuide();
  }

  /// The tuition guide opens by itself the first time a family opens the
  /// tutor, and lives behind the ? in the app bar after that.
  Future<void> _maybeShowGuide() async {
    const storage = FlutterSecureStorage();
    String? seen;
    try {
      seen = await storage.read(key: _guideSeenKey);
    } catch (_) {
      seen = "1";
    }
    if (seen != null || !mounted) return;
    await Future<void>.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    await _showGuide();
    try {
      await storage.write(key: _guideSeenKey, value: "1");
    } catch (_) {
      /* a phone that refuses storage just sees it again next time */
    }
  }

  Future<void> _showGuide() => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (context) => _GuideSheet(
      hindi: _language != "en",
      childFirstName: widget.context.child.fullName.split(" ").first,
    ),
  );

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final s = await widget.api.fetchTutorStatus(widget.context.child.id);
      if (!mounted) return;
      setState(() {
        _status = s;
        if (_messages.isEmpty) _language = s.defaultLanguage;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    }
  }

  TutorModeInfo? get _modeInfo {
    final s = _status;
    if (s == null) return null;
    for (final m in s.modes) {
      if (m.code == _mode) return m;
    }
    return s.modes.isEmpty ? null : s.modes.first;
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: AppMotion.base,
        curve: AppMotion.enter,
      );
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    final status = _status;
    if (text.isEmpty || _busy || status == null) return;
    final mode = _modeInfo;
    // A paid mode without a pass is refused by the server; say so before
    // the round trip and open the passes instead.
    if (mode != null && mode.paid && !status.allowance.hasPass) {
      Haptics.warning();
      _showPasses(
        reason:
            "${mode.label} is part of the full tutor. Get a pass for ${widget.context.child.fullName.split(" ").first} — a day, a week or a month — to unlock it.",
      );
      return;
    }
    Haptics.tap();
    _input.clear();
    final history = [
      for (final m in _messages.where((m) => m.text.isNotEmpty))
        TutorTurn(m.role, m.text),
    ];
    final reply = _Msg("assistant", "", mode: _mode, topic: text);
    setState(() {
      _busy = true;
      _messages.add(_Msg("user", text, mode: _mode));
      _messages.add(reply);
    });
    _scrollToEnd();
    try {
      await for (final ev in widget.api.askTutorStream(
        message: text,
        mode: _mode,
        history: history,
        context: widget.context.toJson(),
        studentId: widget.context.child.id,
        language: _language,
      )) {
        if (!mounted) return;
        switch (ev) {
          case TutorDelta(:final text):
            setState(() => reply.text += text);
            _scrollToEnd();
          case TutorDone(reply: final full, :final charge, :final allowance):
            setState(() {
              if (full.isNotEmpty) reply.text = full;
              reply.charge = charge;
              if (allowance != null) {
                _status = _withAllowance(status, allowance);
              }
            });
        }
      }
      Haptics.success();
    } on TutorRefused catch (e) {
      Haptics.warning();
      if (!mounted) return;
      setState(() {
        _messages.removeLast();
        if (e.allowance != null) _status = _withAllowance(status, e.allowance!);
      });
      if (e.needsPass) {
        _showPasses(reason: e.message);
      } else {
        _toast(e.message);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _toast(e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _toast("Could not reach the tutor. Check your connection.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showVideos(String topic) async {
    Haptics.tap();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _VideosSheet(
        api: widget.api,
        studentId: widget.context.child.id,
        topic: topic,
        language: _language,
      ),
    );
  }

  TutorStatus _withAllowance(TutorStatus s, TutorAllowance a) => TutorStatus(
    configured: s.configured,
    defaultLanguage: s.defaultLanguage,
    videosAvailable: s.videosAvailable,
    modes: s.modes,
    allowance: a,
    plans: s.plans,
    orders: s.orders,
    note: s.note,
  );

  void _toast(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _showPasses({String? reason}) async {
    final status = _status;
    if (status == null) return;
    final bought = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _PassSheet(
        api: widget.api,
        status: status,
        child: widget.context.child,
        reason: reason,
      ),
    );
    if (bought == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    final child = widget.context.child;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text("AI tutor", style: TextStyle(fontSize: 16)),
            Text(
              widget.context.homeworkTitle.isNotEmpty
                  ? widget.context.homeworkTitle
                  : child.fullName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: Color(0xFFB8C0D4)),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: "How to use the tutor",
            onPressed: () {
              Haptics.tap();
              _showGuide();
            },
            icon: const Icon(Icons.help_outline),
          ),
          if (status != null)
            TextButton.icon(
              onPressed: () => _showPasses(),
              icon: const Icon(Icons.workspace_premium_outlined, size: 18),
              label: Text(
                status.allowance.hasPass
                    ? status.allowance.validLabel
                    : "Get a pass",
              ),
              style: TextButton.styleFrom(foregroundColor: Colors.white),
            ),
        ],
      ),
      body: AppCrossfade(
        child: status == null
            ? Center(
                key: ValueKey(_error == null ? "loading" : "error"),
                child: _error == null
                    ? const CircularProgressIndicator(color: AppColors.primary)
                    : Padding(
                        padding: Insets.state,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.cloud_off_outlined,
                              size: 40,
                              color: AppColors.muted,
                            ),
                            const SizedBox(height: Space.md),
                            Text(_error!, textAlign: TextAlign.center),
                            const SizedBox(height: Space.md),
                            FilledButton(
                              onPressed: _load,
                              child: const Text("Retry"),
                            ),
                          ],
                        ),
                      ),
              )
            : !status.configured
            ? Center(
                key: const ValueKey("off"),
                child: Padding(
                  padding: Insets.state,
                  child: const Text(
                    "The tutor is not switched on yet. Please check back later.",
                    textAlign: TextAlign.center,
                  ),
                ),
              )
            : Column(
                key: const ValueKey("chat"),
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      Space.xl,
                      Space.sm,
                      Space.lg,
                      0,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            _language == "en"
                                ? "Reply language"
                                : "उत्तर की भाषा · Reply language",
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.muted,
                            ),
                          ),
                        ),
                        _LanguageToggle(
                          language: _language,
                          dark: false,
                          onChanged: (v) {
                            Haptics.tap();
                            setState(() => _language = v);
                          },
                        ),
                      ],
                    ),
                  ),
                  _ModeBar(
                    modes: status.modes,
                    selected: _mode,
                    hasPass: status.allowance.hasPass,
                    onSelect: (code) {
                      if (code == _mode) return;
                      Haptics.tap();
                      setState(() => _mode = code);
                    },
                  ),
                  _AllowanceStrip(allowance: status.allowance, mode: _modeInfo),
                  Expanded(
                    child: _messages.isEmpty
                        ? _Welcome(
                            mode: _modeInfo,
                            note: status.note,
                            onGuide: () {
                              Haptics.tap();
                              _showGuide();
                            },
                          )
                        : ListView.builder(
                            controller: _scroll,
                            padding: const EdgeInsets.fromLTRB(
                              Space.lg,
                              Space.md,
                              Space.md,
                              Space.xl,
                            ),
                            itemCount: _messages.length,
                            itemBuilder: (context, i) => _Bubble(
                              msg: _messages[i],
                              busy: _busy && i == _messages.length - 1,
                              hindi: _language != "en",
                              onVideos: _messages[i].topic.isEmpty
                                  ? null
                                  : () => _showVideos(_messages[i].topic),
                            ),
                          ),
                  ),
                  _Composer(
                    controller: _input,
                    hint: _language != "en"
                        ? (_hi["${_mode}_prompt"] ?? "शिक्षक से पूछें…")
                        : (_modeInfo?.prompt ?? "Ask the tutor…"),
                    busy: _busy,
                    onSend: _send,
                    // Spoken questions are recognised in the reply language;
                    // "both" listens in Hindi, which also catches Hinglish.
                    speechLocale: _language == "en" ? "en_IN" : "hi_IN",
                  ),
                ],
              ),
      ),
    );
  }
}

class _ModeBar extends StatelessWidget {
  const _ModeBar({
    required this.modes,
    required this.selected,
    required this.hasPass,
    required this.onSelect,
  });

  final List<TutorModeInfo> modes;
  final String selected;
  final bool hasPass;
  final void Function(String code) onSelect;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 46,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.md, 0),
        itemCount: modes.length,
        separatorBuilder: (_, _) => const SizedBox(width: Space.sm),
        itemBuilder: (context, i) {
          final m = modes[i];
          final on = m.code == selected;
          final locked = m.paid && !hasPass;
          return AnimatedContainer(
            duration: AppMotion.fast,
            decoration: BoxDecoration(
              color: on ? AppColors.primary : Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: on
                    ? AppColors.primary
                    : AppColors.ink.withValues(alpha: 0.12),
              ),
            ),
            clipBehavior: Clip.antiAlias,
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => onSelect(m.code),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  child: Row(
                    children: [
                      if (locked) ...[
                        Icon(
                          Icons.lock_outline,
                          size: 13,
                          color: on ? Colors.white70 : AppColors.muted,
                        ),
                        const SizedBox(width: 4),
                      ],
                      Text(
                        m.label,
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: on ? Colors.white : AppColors.ink,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _AllowanceStrip extends StatelessWidget {
  const _AllowanceStrip({required this.allowance, required this.mode});

  final TutorAllowance allowance;
  final TutorModeInfo? mode;

  @override
  Widget build(BuildContext context) {
    final String text;
    if (allowance.hasPass) {
      text =
          "Full tutor on for ${allowance.studentFirstName} · ${allowance.validLabel}"
          "${allowance.passUsedToday >= allowance.passMessagesPerDay ? " · today's limit reached" : ""}";
    } else if (mode != null && mode!.paid) {
      text = "${mode!.label} needs a pass — hints stay free";
    } else {
      text =
          "${allowance.freeLeft} of ${allowance.freeHintsPerDay} free hints left today";
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.xl,
        Space.sm,
        Space.lg,
        Space.xs,
      ),
      child: Row(
        children: [
          Icon(
            allowance.hasPass ? Icons.verified_outlined : Icons.info_outline,
            size: 14,
            color: allowance.hasPass ? AppColors.success : AppColors.muted,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 11.5,
                color: allowance.hasPass ? AppColors.success : AppColors.muted,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Welcome extends StatelessWidget {
  const _Welcome({required this.mode, required this.note, this.onGuide});

  final TutorModeInfo? mode;
  final String note;
  final VoidCallback? onGuide;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: Insets.page,
      children: [
        Container(
          padding: Insets.card,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.ink.withValues(alpha: 0.08)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                mode?.label ?? "Tutor",
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: Space.xs),
              Text(
                mode?.blurb ?? "",
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.ink,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Space.md),
        if (onGuide != null)
          OutlinedButton.icon(
            onPressed: onGuide,
            icon: const Icon(Icons.menu_book_outlined, size: 18),
            label: const Text(
              "How to use the tutor as daily tuition · रोज़ की ट्यूशन कैसे करें",
            ),
          ),
        const SizedBox(height: Space.lg),
        Text(
          note,
          style: const TextStyle(
            fontSize: 12,
            color: AppColors.muted,
            height: 1.45,
          ),
        ),
        const SizedBox(height: Space.sm),
        const Text(
          "Replies are written by an AI and can be wrong. Check anything that matters with the class teacher.",
          style: TextStyle(fontSize: 12, color: AppColors.muted, height: 1.45),
        ),
      ],
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({
    required this.msg,
    required this.busy,
    required this.hindi,
    this.onVideos,
  });

  final _Msg msg;
  final bool busy;
  final bool hindi;
  final VoidCallback? onVideos;

  @override
  Widget build(BuildContext context) {
    final mine = msg.role == "user";
    final waiting = !mine && msg.text.isEmpty && busy;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.82,
        ),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.fromLTRB(14, 10, 12, 10),
        decoration: BoxDecoration(
          color: mine ? AppColors.primary : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(mine ? 16 : 4),
            bottomRight: Radius.circular(mine ? 4 : 16),
          ),
          border: mine
              ? null
              : Border.all(color: AppColors.ink.withValues(alpha: 0.08)),
        ),
        child: waiting
            ? const SizedBox(
                width: 36,
                height: 14,
                child: Center(
                  child: SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.muted,
                    ),
                  ),
                ),
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SelectableText(
                    // The model is asked for plain text but still bolds with
                    // asterisks now and then; a parent should never see them.
                    msg.text.replaceAll("**", ""),
                    style: TextStyle(
                      fontSize: 13.5,
                      height: 1.45,
                      color: mine ? Colors.white : AppColors.ink,
                    ),
                  ),
                  if (!mine && msg.charge.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Text(
                          msg.charge == "free" ? "Free hint" : "Full tutor",
                          style: const TextStyle(
                            fontSize: 10,
                            color: AppColors.muted,
                          ),
                        ),
                        const Spacer(),
                        if (onVideos != null)
                          InkWell(
                            onTap: onVideos,
                            borderRadius: BorderRadius.circular(12),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(
                                    Icons.play_circle_outline,
                                    size: 15,
                                    color: AppColors.danger,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    hindi ? _hi["watch"]! : "Watch videos",
                                    style: const TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.danger,
                                    ),
                                  ),
                                ],
                              ),
                            ),
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

class _Composer extends StatefulWidget {
  const _Composer({
    required this.controller,
    required this.hint,
    required this.busy,
    required this.onSend,
    required this.speechLocale,
  });

  final TextEditingController controller;
  final String hint;
  final bool busy;
  final VoidCallback onSend;
  final String speechLocale;

  @override
  State<_Composer> createState() => _ComposerState();
}

/// The composer with a microphone: a parent who would rather speak than
/// type — or cannot type Hindi easily — taps the mic, speaks, and the
/// words land in the box to check before sending. Recognition runs on
/// the phone's own speech service; the app records and uploads nothing.
class _ComposerState extends State<_Composer> {
  final _speech = SpeechToText();
  bool _ready = false;
  bool _listening = false;
  String _baseText = "";

  @override
  void dispose() {
    if (_listening) _speech.stop();
    super.dispose();
  }

  Future<void> _toggleMic() async {
    if (_listening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }
    Haptics.tap();
    if (!_ready) {
      _ready = await _speech.initialize(
        onError: (_) {
          if (mounted) setState(() => _listening = false);
        },
        onStatus: (status) {
          if ((status == "done" || status == "notListening") && mounted) {
            setState(() => _listening = false);
          }
        },
      );
    }
    if (!_ready) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              "Voice input is not available on this phone. Please type your question.",
            ),
          ),
        );
      }
      return;
    }
    _baseText = widget.controller.text.trim();
    setState(() => _listening = true);
    await _speech.listen(
      listenOptions: SpeechListenOptions(
        localeId: widget.speechLocale,
        partialResults: true,
        listenMode: ListenMode.dictation,
      ),
      onResult: (result) {
        final heard = result.recognizedWords.trim();
        final joined = [
          if (_baseText.isNotEmpty) _baseText,
          if (heard.isNotEmpty) heard,
        ].join(" ");
        widget.controller.text = joined;
        widget.controller.selection = TextSelection.fromPosition(
          TextPosition(offset: joined.length),
        );
        if (result.finalResult && mounted) {
          Haptics.success();
          setState(() => _listening = false);
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final hindi = widget.speechLocale.startsWith("hi");
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          Space.md,
          Space.sm,
          Space.md,
          Space.md,
        ),
        child: Row(
          children: [
            AnimatedContainer(
              duration: AppMotion.fast,
              decoration: BoxDecoration(
                color: _listening ? AppColors.danger : Colors.white,
                shape: BoxShape.circle,
                border: Border.all(
                  color: _listening
                      ? AppColors.danger
                      : AppColors.ink.withValues(alpha: 0.12),
                ),
              ),
              child: IconButton(
                tooltip: _listening ? "Stop" : "Speak your question",
                onPressed: widget.busy ? null : _toggleMic,
                icon: Icon(
                  _listening ? Icons.stop : Icons.mic_none,
                  color: _listening ? Colors.white : AppColors.primary,
                ),
              ),
            ),
            const SizedBox(width: Space.sm),
            Expanded(
              child: TextField(
                controller: widget.controller,
                minLines: 1,
                maxLines: 5,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => widget.onSend(),
                decoration: InputDecoration(
                  hintText: _listening
                      ? (hindi ? "सुन रहा हूँ… बोलिए" : "Listening… speak now")
                      : widget.hint,
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: Space.sm),
            IconButton.filled(
              onPressed: widget.busy ? null : widget.onSend,
              style: IconButton.styleFrom(backgroundColor: AppColors.primary),
              icon: widget.busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.arrow_upward, color: Colors.white),
            ),
          ],
        ),
      ),
    );
  }
}

/// The passes on sale. Buying opens the school's payment page; the pass
/// switches on by itself once the bank confirms.
class _PassSheet extends StatefulWidget {
  const _PassSheet({
    required this.api,
    required this.status,
    required this.child,
    this.reason,
  });

  final ApiClient api;
  final TutorStatus status;
  final ParentChild child;
  final String? reason;

  @override
  State<_PassSheet> createState() => _PassSheetState();
}

class _PassSheetState extends State<_PassSheet> {
  String? _buying;

  Future<void> _buy(TutorPlanInfo plan) async {
    if (_buying != null) return;
    setState(() => _buying = plan.code);
    try {
      final r = await widget.api.buyTutorPass(
        planCode: plan.code,
        studentId: widget.child.id,
      );
      final uri = Uri.tryParse(r.checkoutUrl);
      if (uri == null) {
        throw ApiException("Could not open the payment page", 502);
      }
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened) {
        throw ApiException("No browser available to open the payment page", 0);
      }
      Haptics.success();
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Could not reach the school server.")),
        );
      }
    } finally {
      if (mounted) setState(() => _buying = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.status.allowance;
    final first = widget.child.fullName.split(" ").first;
    final classLabel = [
      widget.child.className,
      if (widget.child.sectionName.isNotEmpty) widget.child.sectionName,
    ].join(" ");
    final pending = widget.status.orders
        .where((o) => o.status == "pending")
        .toList();
    return SafeArea(
      child: Padding(
        padding: Insets.sheet,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Tutor pass for $first",
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: Space.xs),
            Text(
              widget.reason ??
                  "Unlock the full tutor for $first — teaching, worked examples, practice questions, answer checking, homework help and exam preparation, all at the $classLabel level.",
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.ink,
                height: 1.45,
              ),
            ),
            if (a.hasPass) ...[
              const SizedBox(height: Space.md),
              Row(
                children: [
                  const Icon(
                    Icons.verified,
                    size: 16,
                    color: AppColors.success,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    "${a.passPlanLabel.isNotEmpty ? "${a.passPlanLabel} pass · " : ""}${a.validLabel}. A new pass starts when this one ends.",
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.success,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: Space.lg),
            for (final p in widget.status.plans) ...[
              _PlanTile(
                plan: p,
                busy: _buying == p.code,
                enabled: _buying == null,
                onTap: () => _buy(p),
              ),
              const SizedBox(height: Space.sm),
            ],
            if (pending.isNotEmpty) ...[
              const SizedBox(height: Space.sm),
              Text(
                "Waiting for the bank: ${pending.map((o) => "${o.days}-day pass (${o.amountLabel})").join(", ")}. The pass switches on by itself once the payment is confirmed.",
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.muted,
                  height: 1.4,
                ),
              ),
            ],
            const SizedBox(height: Space.sm),
            Text(
              "A pass is for one child and covers $first's class ($classLabel) only — a brother or sister needs their own pass. Fair use: up to 60 tutor messages a day. Hints stay free every day.",
              style: const TextStyle(
                fontSize: 11.5,
                color: AppColors.muted,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlanTile extends StatelessWidget {
  const _PlanTile({
    required this.plan,
    required this.busy,
    required this.enabled,
    required this.onTap,
  });

  final TutorPlanInfo plan;
  final bool busy;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      plan.label,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      "Full tutor for ${plan.days == 1 ? "one day" : "${plan.days} days"}",
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              if (busy)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Text(
                  plan.priceLabel,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              const SizedBox(width: 6),
              const Icon(Icons.chevron_right, color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}

/// हिं / EN — the reply language. Sits in the app bar so a parent who does
/// not read English finds it before typing anything.
class _LanguageToggle extends StatelessWidget {
  const _LanguageToggle({
    required this.language,
    required this.onChanged,
    this.dark = true,
  });

  final String language;
  final void Function(String) onChanged;

  /// On the navy app bar (light text) or on the page (ink text).
  final bool dark;

  @override
  Widget build(BuildContext context) {
    Widget seg(String code, String label) {
      final on = language == code;
      return InkWell(
        onTap: () => onChanged(code),
        borderRadius: BorderRadius.circular(14),
        child: AnimatedContainer(
          duration: AppMotion.fast,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: on ? AppColors.accentSoft : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: on
                  ? AppColors.primary
                  : dark
                  ? Colors.white
                  : AppColors.ink,
            ),
          ),
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.only(right: 4),
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: dark
            ? Colors.white.withValues(alpha: 0.14)
            : AppColors.ink.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [seg("hi", "हिं"), seg("both", "हिं+EN"), seg("en", "EN")],
      ),
    );
  }
}

/// Videos for the topic of one reply. Each opens inside the app (an
/// in-app browser tab), never in a separate YouTube app the parent may
/// not have.
class _VideosSheet extends StatefulWidget {
  const _VideosSheet({
    required this.api,
    required this.studentId,
    required this.topic,
    required this.language,
  });

  final ApiClient api;
  final String studentId;
  final String topic;
  final String language;

  @override
  State<_VideosSheet> createState() => _VideosSheetState();
}

class _VideosSheetState extends State<_VideosSheet> {
  TutorVideos? _videos;
  String? _error;

  bool get _hindi => widget.language != "en";

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final v = await widget.api.fetchTutorVideos(
        studentId: widget.studentId,
        topic: widget.topic,
        language: widget.language,
      );
      if (mounted) setState(() => _videos = v);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    }
  }

  Future<void> _open(String url) async {
    Haptics.tap();
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.inAppBrowserView);
  }

  /// Plays inside the app: a link handed to the system is claimed by the
  /// YouTube app on most phones and pulls the parent out of ours.
  Future<void> _play(TutorVideo v) {
    Haptics.tap();
    return Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => VideoPlayerScreen(video: v)));
  }

  @override
  Widget build(BuildContext context) {
    final v = _videos;
    return SafeArea(
      child: Padding(
        padding: Insets.sheet,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _hindi ? _hi["videosTitle"]! : "Videos on this topic",
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: Space.xs),
            Text(
              widget.topic,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
            const SizedBox(height: Space.lg),
            if (v == null && _error == null)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(Space.lg),
                  child: CircularProgressIndicator(color: AppColors.primary),
                ),
              )
            else if (_error != null)
              Text(_error!, style: const TextStyle(color: AppColors.danger))
            else ...[
              if (v!.items.isEmpty)
                Text(
                  _hindi
                      ? _hi["noVideos"]!
                      : "No videos found yet — search YouTube instead.",
                  style: const TextStyle(fontSize: 13, color: AppColors.ink),
                ),
              for (final item in v.items) ...[
                _VideoTile(video: item, onTap: () => _play(item)),
                const SizedBox(height: Space.sm),
              ],
              const SizedBox(height: Space.xs),
              OutlinedButton.icon(
                onPressed: () => _open(v.searchUrl),
                icon: const Icon(Icons.search, size: 18),
                label: Text(_hindi ? _hi["search"]! : "Search on YouTube"),
              ),
              const SizedBox(height: Space.sm),
              Text(
                _hindi
                    ? "वीडियो YouTube के हैं, स्कूल के नहीं — देखकर ही भरोसा करें।"
                    : "Videos are from YouTube, not the school — judge them as you watch.",
                style: const TextStyle(fontSize: 11, color: AppColors.muted),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _VideoTile extends StatelessWidget {
  const _VideoTile({required this.video, required this.onTap});

  final TutorVideo video;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Row(
          children: [
            SizedBox(
              width: 112,
              height: 66,
              child: video.thumbnail.isEmpty
                  ? const ColoredBox(color: Color(0xFFE6E4DC))
                  : Image.network(
                      video.thumbnail,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) =>
                          const ColoredBox(color: Color(0xFFE6E4DC)),
                    ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 10, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      video.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                        height: 1.3,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      video.channel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.only(right: 8),
              child: Icon(Icons.play_circle_fill, color: AppColors.danger),
            ),
          ],
        ),
      ),
    );
  }
}

/// The tuition routine, in the parent's language: what to do each day
/// with the tutor instead of paying for a tuition teacher.
class _GuideSheet extends StatelessWidget {
  const _GuideSheet({required this.hindi, required this.childFirstName});

  final bool hindi;
  final String childFirstName;

  @override
  Widget build(BuildContext context) {
    final n = childFirstName;
    final steps = hindi
        ? <(IconData, String, String)>[
            (
              Icons.menu_book_outlined,
              "1. आज का पाठ (10 मिनट)",
              "\"Teach a topic\" चुनें और आज स्कूल में पढ़ाया विषय लिखें — जैसे \"भिन्न\"। ट्यूटर $n की कक्षा के स्तर पर छोटा पाठ देगा।",
            ),
            (
              Icons.functions,
              "2. हल किए उदाहरण (5 मिनट)",
              "\"Worked examples\" में वही विषय लिखें। हर कदम दिखेगा — $n के साथ बैठकर पढ़ें।",
            ),
            (
              Icons.edit_note,
              "3. अभ्यास (10 मिनट)",
              "\"Practice questions\" से 5 प्रश्न लें। $n उन्हें कॉपी में हल करे — उत्तर तब तक नहीं दिखेंगे।",
            ),
            (
              Icons.fact_check_outlined,
              "4. उत्तर जाँच (5 मिनट)",
              "\"Check answers\" में प्रश्न और $n के उत्तर लिखें। अंक और क्या सुधारना है, दोनों मिलेंगे।",
            ),
            (
              Icons.home_work_outlined,
              "5. होमवर्क",
              "Homework स्क्रीन पर किसी भी काम के आगे \"Ask tutor\" दबाएँ — वह काम ट्यूटर के सामने पहले से होगा।",
            ),
            (
              Icons.event_available_outlined,
              "6. परीक्षा से पहले",
              "\"Exam preparation\" में विषय और तारीख लिखें — दोहराने की सूची, दिन-वार योजना और संभावित प्रश्न मिलेंगे।",
            ),
            (
              Icons.play_circle_outline,
              "7. समझ न आए तो वीडियो",
              "हर उत्तर के नीचे \"वीडियो देखें\" — उसी विषय के हिंदी वीडियो, ऐप के अंदर ही चलते हैं।",
            ),
            (
              Icons.lightbulb_outline,
              "मुफ़्त संकेत",
              "\"Hints\" रोज़ 20 बार मुफ़्त हैं — जब $n अटके तो अगला कदम पूछें। पूरा ट्यूटर पास से खुलता है: एक दिन, हफ़्ता या महीना, एक बच्चे के लिए।",
            ),
          ]
        : <(IconData, String, String)>[
            (
              Icons.menu_book_outlined,
              "1. Today's lesson (10 min)",
              "Choose \"Teach a topic\" and type what was taught in school today, e.g. \"fractions\". The tutor gives a short lesson at $n's class level.",
            ),
            (
              Icons.functions,
              "2. Worked examples (5 min)",
              "In \"Worked examples\", type the same topic. Every step is shown — read them with $n.",
            ),
            (
              Icons.edit_note,
              "3. Practice (10 min)",
              "\"Practice questions\" gives 5 questions. $n solves them in a notebook — answers stay hidden until you ask.",
            ),
            (
              Icons.fact_check_outlined,
              "4. Check answers (5 min)",
              "In \"Check answers\", type the questions with $n's answers. You get marks and what to fix.",
            ),
            (
              Icons.home_work_outlined,
              "5. Homework",
              "On the Homework screen, tap \"Ask tutor\" next to any item — that assignment is already in front of the tutor.",
            ),
            (
              Icons.event_available_outlined,
              "6. Before a test",
              "In \"Exam preparation\", type the subject and date — you get a revision list, a day-wise plan and likely questions.",
            ),
            (
              Icons.play_circle_outline,
              "7. Stuck? Watch a video",
              "Under every reply, \"Watch videos\" finds videos on that topic and plays them inside the app.",
            ),
            (
              Icons.lightbulb_outline,
              "Free hints",
              "\"Hints\" are free, 20 a day — when $n is stuck, ask for the next step. The full tutor opens with a pass: a day, a week or a month, for one child.",
            ),
          ];
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.86,
      maxChildSize: 0.95,
      builder: (context, controller) => SafeArea(
        child: ListView(
          controller: controller,
          padding: Insets.sheet,
          children: [
            Text(
              hindi
                  ? "ट्यूशन की ज़रूरत नहीं — ट्यूटर से रोज़ 30 मिनट"
                  : "No tuition needed — 30 minutes a day with the tutor",
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
                height: 1.3,
              ),
            ),
            const SizedBox(height: Space.xs),
            Text(
              hindi
                  ? "$n के साथ बैठें, यह क्रम रोज़ दोहराएँ। ट्यूटर उसकी कक्षा (CBSE) के हिसाब से पढ़ाता है, हिंदी या अंग्रेज़ी में।"
                  : "Sit with $n and follow this routine every day. The tutor teaches at $n's class level (CBSE), in Hindi or English.",
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.muted,
                height: 1.45,
              ),
            ),
            const SizedBox(height: Space.lg),
            for (final (icon, title, body) in steps) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: ModuleTone.amber.background,
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Icon(
                      icon,
                      size: 19,
                      color: ModuleTone.amber.foreground,
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          body,
                          style: const TextStyle(
                            fontSize: 12.5,
                            color: AppColors.ink,
                            height: 1.45,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Space.lg),
            ],
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: Text(hindi ? "समझ गया, शुरू करें" : "Got it, let's start"),
            ),
          ],
        ),
      ),
    );
  }
}
