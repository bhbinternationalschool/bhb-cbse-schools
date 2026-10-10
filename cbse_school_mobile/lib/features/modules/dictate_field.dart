import "package:flutter/material.dart";
import "package:speech_to_text/speech_to_text.dart";

import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";

/// A text field with a mic button that appends what the teacher says.
///
/// Recognition runs on the device, so nothing is uploaded and it keeps
/// working on a weak school connection. Dictation always *appends* to
/// what is already typed — a second sentence must never wipe the first.
///
/// Recognition follows the language the person chose for the app. It used to
/// be hard-pinned to `hi_IN` under a comment claiming it was "a default with
/// English fallback" — it was neither, so an English-preferring teacher got
/// Hindi recognition and no way to change it. If the device has no pack for
/// that language it is asked for the system default instead, rather than
/// failing silently.
class DictateField extends StatefulWidget {
  const DictateField({
    super.key,
    this.label,
    required this.controller,
    this.hint,
    this.minLines = 2,
    this.maxLines = 5,
    this.onChanged,
    this.enabled = true,
    this.autofocus = false,
    this.textCapitalization = TextCapitalization.sentences,
  });

  /// Null renders the mic on its own — for fields whose meaning is already
  /// carried by a hint or by the row above them.
  final String? label;
  final TextEditingController controller;
  final String? hint;
  final int minLines;
  final int maxLines;
  final ValueChanged<String>? onChanged;
  final bool enabled;
  final bool autofocus;
  final TextCapitalization textCapitalization;

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

  /// The locale to recognise in: the app's language if the device has a pack
  /// for it, otherwise whatever the device would use anyway. Asking for a
  /// locale that is not installed makes some devices return nothing at all.
  Future<String?> _recognitionLocale() async {
    if (!mounted) return null;
    final code =
        LocaleScope.of(context).value?.languageCode ??
        Localizations.localeOf(context).languageCode;
    final want = code == "hi" ? "hi_IN" : "en_IN";
    try {
      final installed = await _speech.locales();
      for (final l in installed) {
        if (l.localeId.replaceAll("-", "_") == want) return want;
      }
      // Same language, any region — en_GB will do when en_IN is absent.
      for (final l in installed) {
        if (l.localeId.toLowerCase().startsWith(code.toLowerCase())) {
          return l.localeId;
        }
      }
    } catch (_) {
      // Fall through to the device default.
    }
    return null;
  }

  Future<void> _toggle() async {
    if (!widget.enabled) return;
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
              _error = context.l10n.couldNotHearYou;
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
      setState(() => _error = context.l10n.dictationNotAvailable);
      return;
    }

    setState(() => _listening = true);
    await _speech.listen(
      listenOptions: SpeechListenOptions(
        localeId: await _recognitionLocale(),
        partialResults: false,
      ),
      onResult: (result) {
        if (!result.finalResult || !widget.enabled) return;
        final said = result.recognizedWords.trim();
        if (said.isEmpty) return;
        final existing = widget.controller.text.trim();
        widget.controller.text = existing.isEmpty ? said : "$existing $said";
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
              if (widget.label != null) ...[
                Text(widget.label!, style: AppText.labelLargeInk),
                const SizedBox(width: 8),
              ],
              InkWell(
                borderRadius: BorderRadius.circular(20),
                onTap: _toggle,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
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
                        color: _listening ? AppColors.danger : AppColors.muted,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _listening
                            ? context.l10n.listening
                            : context.l10n.speak,
                        style: AppText.labelMedium.copyWith(
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
                    style: AppText.labelSmall.copyWith(color: AppColors.danger),
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
            onChanged: widget.onChanged,
            enabled: widget.enabled,
            autofocus: widget.autofocus,
            textCapitalization: widget.textCapitalization,
            style: AppText.bodyMedium,
            decoration: InputDecoration(
              hintText: widget.hint,
              hintStyle: AppText.bodySmallMuted,
              border: const OutlineInputBorder(),
              isDense: true,
            ),
          ),
        ],
      ),
    );
  }
}
