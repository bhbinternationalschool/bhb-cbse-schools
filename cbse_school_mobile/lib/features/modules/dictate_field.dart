import "package:flutter/material.dart";
import "package:speech_to_text/speech_to_text.dart";

import "../../core/theme/app_theme.dart";

/// A text field with a mic button that appends what the teacher says.
///
/// Recognition runs on the device, so nothing is uploaded and it keeps
/// working on a weak school connection. Dictation always *appends* to
/// what is already typed — a second sentence must never wipe the first.
///
/// The locale defaults to Hindi with English fallback, matching how
/// teachers here actually mix the two; the device picks the closest it
/// has installed.
class DictateField extends StatefulWidget {
  const DictateField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.minLines = 2,
    this.maxLines = 5,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final int minLines;
  final int maxLines;

  @override
  State<DictateField> createState() => _DictateFieldState();
}

class _DictateFieldState extends State<DictateField> {
  final _speech = SpeechToText();
  bool _available = false;
  bool _listening = false;
  String? _error;

  @override
  void dispose() {
    // Leaving the recogniser running holds the microphone open and keeps
    // the OS recording indicator lit after the screen is gone.
    if (_listening) _speech.stop();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_listening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }

    setState(() => _error = null);
    if (!_available) {
      _available = await _speech.initialize(
        onError: (e) {
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
    if (!_available) {
      setState(
        () => _error = "Dictation is not available on this phone",
      );
      return;
    }

    setState(() => _listening = true);
    await _speech.listen(
      listenOptions: SpeechListenOptions(
        localeId: "hi_IN",
        partialResults: false,
      ),
      onResult: (result) {
        if (!result.finalResult) return;
        final said = result.recognizedWords.trim();
        if (said.isEmpty) return;
        final existing = widget.controller.text.trim();
        widget.controller.text =
            existing.isEmpty ? said : "$existing $said";
        widget.controller.selection = TextSelection.fromPosition(
          TextPosition(offset: widget.controller.text.length),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                widget.label,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(width: 8),
              InkWell(
                borderRadius: BorderRadius.circular(20),
                onTap: _toggle,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: _listening
                        ? ModuleTone.coral.background
                        : ModuleTone.gray.background,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _listening ? Icons.stop : Icons.mic_none,
                        size: 14,
                        color: _listening
                            ? AppColors.danger
                            : AppColors.muted,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _listening ? "Listening…" : "Speak",
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: _listening
                              ? AppColors.danger
                              : AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _error!,
                    style: const TextStyle(
                        fontSize: 10.5, color: AppColors.danger),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 5),
          TextField(
            controller: widget.controller,
            minLines: widget.minLines,
            maxLines: widget.maxLines,
            style: const TextStyle(fontSize: 13),
            decoration: InputDecoration(
              hintText: widget.hint,
              hintStyle:
                  const TextStyle(fontSize: 12.5, color: AppColors.muted),
              border: const OutlineInputBorder(),
              isDense: true,
            ),
          ),
        ],
      ),
    );
  }
}
