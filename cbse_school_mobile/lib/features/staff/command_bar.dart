import "package:flutter/material.dart";
import "package:speech_to_text/speech_to_text.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// One line to the ERP — typed or spoken — and the answer underneath.
///
/// Sits at the top of the staff home screens. Sends the text to
/// `POST /api/v1/commands`, the same engine that answers staff on
/// WhatsApp, so "5A me aaj kaun absent hai" means the same thing here.
/// A write command comes back as a card with Confirm / Cancel; the tap
/// posts the card's button id back, exactly as a WhatsApp button would.
///
/// Speech runs on the device (Hindi with English fallback) and a finished
/// utterance is sent straight away — the point of the mic is not having
/// to look at the phone. Typed text waits for the send button or Enter.
class StaffCommandBar extends StatefulWidget {
  const StaffCommandBar({
    super.key,
    required this.api,
    this.suggestions = const ["COMMANDS"],
  });

  final ApiClient api;

  /// Tappable examples under the field — the class teacher's own section
  /// first, so the first command is one tap.
  final List<String> suggestions;

  @override
  State<StaffCommandBar> createState() => _StaffCommandBarState();
}

class _StaffCommandBarState extends State<StaffCommandBar> {
  final _controller = TextEditingController();
  final _speech = SpeechToText();
  bool _speechReady = false;
  bool _listening = false;
  bool _busy = false;
  String? _sentText;
  StaffCommandResult? _result;
  String? _error;

  @override
  void dispose() {
    if (_listening) _speech.stop();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send(String raw, {String? shownAs}) async {
    final text = raw.trim();
    if (text.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _sentText = shownAs ?? text;
    });
    try {
      final r = await widget.api.runStaffCommand(text);
      if (!mounted) return;
      setState(() {
        _result = r;
        if (shownAs == null) _controller.clear();
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

  Future<void> _toggleMic() async {
    if (_listening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }
    setState(() => _error = null);
    if (!_speechReady) {
      _speechReady = await _speech.initialize(
        onError: (_) {
          if (mounted) {
            setState(() {
              _error = "Could not hear you";
              _listening = false;
            });
          }
        },
        onStatus: (status) {
          if (status == "done" || status == "notListening") {
            if (mounted) setState(() => _listening = false);
          }
        },
      );
    }
    if (!_speechReady) {
      setState(() => _error = "Voice is not available on this phone");
      return;
    }
    setState(() => _listening = true);
    await _speech.listen(
      listenOptions: SpeechListenOptions(
        localeId: "hi_IN",
        partialResults: true,
      ),
      onResult: (result) {
        final said = result.recognizedWords.trim();
        if (said.isEmpty) return;
        _controller.text = said;
        _controller.selection = TextSelection.fromPosition(
          TextPosition(offset: said.length),
        );
        if (result.finalResult) _send(said);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.bolt_outlined, size: 16, color: AppColors.accent),
                const SizedBox(width: 6),
                const Text(
                  "Ask the ERP",
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                const Spacer(),
                if (_busy)
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.primary,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    enabled: !_busy,
                    textInputAction: TextInputAction.send,
                    onSubmitted: _send,
                    style: const TextStyle(fontSize: 13.5),
                    decoration: InputDecoration(
                      hintText: _listening
                          ? "Listening…"
                          : "e.g. 5A me aaj kaun absent hai",
                      hintStyle: TextStyle(
                        fontSize: 12.5,
                        color: _listening ? AppColors.danger : AppColors.muted,
                      ),
                      isDense: true,
                      border: const OutlineInputBorder(),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 10,
                      ),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: _listening ? "Stop" : "Speak",
                  onPressed: _busy ? null : _toggleMic,
                  icon: Icon(
                    _listening ? Icons.stop_circle_outlined : Icons.mic_none,
                    color: _listening ? AppColors.danger : AppColors.primary,
                  ),
                ),
                IconButton(
                  tooltip: "Send",
                  onPressed: _busy ? null : () => _send(_controller.text),
                  icon: const Icon(Icons.send_rounded, color: AppColors.primary),
                ),
              ],
            ),
            if (widget.suggestions.isNotEmpty) ...[
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: -6,
                children: [
                  for (final s in widget.suggestions)
                    ActionChip(
                      label: Text(s, style: const TextStyle(fontSize: 11.5)),
                      visualDensity: VisualDensity.compact,
                      onPressed: _busy ? null : () => _send(s),
                    ),
                ],
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: const TextStyle(fontSize: 12, color: AppColors.danger),
              ),
            ],
            if (result != null) ...[
              const SizedBox(height: 10),
              _ReplyBubble(
                asked: _sentText ?? "",
                result: result,
                busy: _busy,
                onDecision: (id, label) => _send(id, shownAs: label),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ReplyBubble extends StatelessWidget {
  const _ReplyBubble({
    required this.asked,
    required this.result,
    required this.busy,
    required this.onDecision,
  });

  final String asked;
  final StaffCommandResult result;
  final bool busy;
  final void Function(String id, String label) onDecision;

  @override
  Widget build(BuildContext context) {
    final confirm = result.confirm;
    final tone = confirm != null
        ? ModuleTone.amber
        : result.handled
            ? ModuleTone.teal
            : ModuleTone.gray;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (asked.isNotEmpty)
            Text(
              asked,
              style: TextStyle(
                fontSize: 11,
                fontStyle: FontStyle.italic,
                color: tone.foreground.withValues(alpha: 0.75),
              ),
            ),
          const SizedBox(height: 4),
          SelectableText.rich(
            _rich(result.text, tone.foreground),
            style: TextStyle(fontSize: 13, height: 1.4, color: tone.foreground),
          ),
          if (confirm != null) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: busy
                        ? null
                        : () => onDecision(confirm.yesId, "Confirm"),
                    child: const Text("Confirm"),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed:
                        busy ? null : () => onDecision(confirm.noId, "Cancel"),
                    child: const Text("Cancel"),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              "Expires in 5 minutes",
              style: TextStyle(
                fontSize: 10.5,
                color: tone.foreground.withValues(alpha: 0.7),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// WhatsApp-style markers, as the engine writes them: *bold* and _italic_.
TextSpan _rich(String text, Color color) {
  final spans = <TextSpan>[];
  final re = RegExp(r"\*([^*\n]+)\*|_([^_\n]+)_");
  var last = 0;
  for (final m in re.allMatches(text)) {
    if (m.start > last) spans.add(TextSpan(text: text.substring(last, m.start)));
    if (m.group(1) != null) {
      spans.add(
        TextSpan(
          text: m.group(1),
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      );
    } else {
      spans.add(
        TextSpan(
          text: m.group(2),
          style: const TextStyle(fontStyle: FontStyle.italic),
        ),
      );
    }
    last = m.end;
  }
  if (last < text.length) spans.add(TextSpan(text: text.substring(last)));
  return TextSpan(children: spans, style: TextStyle(color: color));
}
