import "dart:async";

import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";

/// Ask the class a question and watch the answers come in by name; tap
/// right / wrong / partly on each. Polls while the class is on.
class OnlineClassQaTeacherScreen extends StatefulWidget {
  const OnlineClassQaTeacherScreen({super.key, required this.api, required this.c});

  final ApiClient api;
  final StaffOnlineClass c;

  @override
  State<OnlineClassQaTeacherScreen> createState() => _OnlineClassQaTeacherScreenState();
}

class _OnlineClassQaTeacherScreenState extends State<OnlineClassQaTeacherScreen> {
  AnswerWall? _wall;
  String? _error;
  final _text = TextEditingController();
  bool _asking = false;
  Timer? _poll;
  Map<String, String>? _headers;

  bool get _canAsk => widget.c.status == "live" || widget.c.status == "scheduled";

  @override
  void initState() {
    super.initState();
    widget.api.imageHeaders().then((h) {
      if (mounted) setState(() => _headers = h);
    });
    _load();
    if (_canAsk) {
      _poll = Timer.periodic(const Duration(seconds: 8), (_) => _load());
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final w = await widget.api.fetchOnlineClassWall(widget.c.id);
      if (mounted) {
        setState(() {
          _wall = w;
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _ask() async {
    final t = _text.text.trim();
    if (t.length < 2) return;
    setState(() => _asking = true);
    try {
      final n = await widget.api.askOnlineClassQuestion(widget.c.id, t);
      Haptics.success();
      _text.clear();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Sent to the class · $n phones reached")),
        );
      }
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  Future<void> _mark(WallAnswer a, String verdict) async {
    final next = a.verdict == verdict ? "" : verdict;
    setState(() => a.verdict = next);
    try {
      await widget.api.markOnlineClassAnswer(widget.c.id, a.id, next);
      Haptics.tap();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = _wall;
    return Scaffold(
      appBar: AppBar(title: Text("Q&A · ${widget.c.sectionLabel}")),
      body: Column(
        children: [
          if (_canAsk)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _text,
                      minLines: 1,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        hintText: "Ask the class a question…",
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: _asking ? null : _ask,
                    child: Text(_asking ? "…" : "Ask"),
                  ),
                ],
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Text("The class is over — questions can only be asked during a class.", style: AppText.labelMediumMuted),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(_error!, style: TextStyle(color: AppColors.warning)),
            ),
          Expanded(
            child: w == null
                ? const Center(child: CircularProgressIndicator())
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      children: [
                        if (w.questions.isEmpty)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 32),
                            child: Center(child: Text("No questions asked yet.", style: AppText.bodyMedium)),
                          ),
                        for (final q in w.questions.reversed) ...[
                          _QuestionBlock(
                            q: q,
                            rosterCount: w.rosterCount,
                            headers: _headers,
                            baseUrl: widget.api.config.apiBaseUrl,
                            onMark: _mark,
                            onToggleClose: _canAsk
                                ? () async {
                                    await widget.api.closeOnlineClassQuestion(widget.c.id, q.id, !q.closed);
                                    await _load();
                                  }
                                : null,
                          ),
                          const SizedBox(height: 12),
                        ],
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _QuestionBlock extends StatelessWidget {
  const _QuestionBlock({
    required this.q,
    required this.rosterCount,
    required this.headers,
    required this.baseUrl,
    required this.onMark,
    required this.onToggleClose,
  });

  final WallQuestion q;
  final int rosterCount;
  final Map<String, String>? headers;
  final String baseUrl;
  final Future<void> Function(WallAnswer a, String verdict) onMark;
  final Future<void> Function()? onToggleClose;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("Q${q.orderNo}${q.closed ? " · closed" : ""}", style: AppText.labelMediumMuted),
            Text(q.text, style: AppText.titleMedium),
            const SizedBox(height: 4),
            Text(
              "${q.answered}/$rosterCount answered · ${q.right} right · ${q.wrong} wrong"
              "${q.unchecked > 0 ? " · ${q.unchecked} to check" : ""}",
              style: AppText.bodyMedium,
            ),
            if (q.notAnswered.isNotEmpty)
              Text(
                "Not yet: ${q.notAnswered.map((n) => n.split(" ").first).join(", ")}",
                style: AppText.labelMediumMuted,
              ),
            if (onToggleClose != null)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: onToggleClose,
                  child: Text(q.closed ? "Reopen" : "Close question"),
                ),
              ),
            for (final a in q.answers) ...[
              const Divider(height: 16),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      "${a.rollNo.isEmpty ? "" : "${a.rollNo} · "}${a.fullName}",
                      style: AppText.bodyMedium.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
              if (a.photoUrl.isNotEmpty && headers != null) ...[
                const SizedBox(height: 6),
                GestureDetector(
                  onTap: () => showDialog<void>(
                    context: context,
                    builder: (_) => Dialog(
                      child: InteractiveViewer(
                        child: Image.network("$baseUrl${a.photoUrl}", headers: headers),
                      ),
                    ),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network(
                      "$baseUrl${a.photoUrl}",
                      headers: headers,
                      height: 180,
                      width: double.infinity,
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 6),
              Row(
                children: [
                  for (final v in const [("right", "✓ Right"), ("wrong", "✗ Wrong"), ("partial", "Partly")]) ...[
                    Expanded(
                      child: _VerdictButton(
                        label: v.$2,
                        on: a.verdict == v.$1,
                        color: v.$1 == "right"
                            ? AppColors.success
                            : v.$1 == "wrong"
                                ? AppColors.warning
                                : AppColors.ink,
                        onTap: () => onMark(a, v.$1),
                      ),
                    ),
                    if (v.$1 != "partial") const SizedBox(width: 6),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _VerdictButton extends StatelessWidget {
  const _VerdictButton({required this.label, required this.on, required this.color, required this.onTap});
  final String label;
  final bool on;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        height: 34,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: on ? color.withValues(alpha: 0.14) : Colors.transparent,
          border: Border.all(color: on ? color : AppColors.muted.withValues(alpha: 0.4)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          style: AppText.labelMediumMuted.copyWith(
            color: on ? color : AppColors.muted,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}
