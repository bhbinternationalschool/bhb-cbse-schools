import "dart:ui" show PlatformDispatcher;

import "package:flutter/material.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";

import "../../l10n/app_localizations.dart";

/// The app's language, and where it is remembered.
///
/// The staff who most need this app — the gateman, the driver, the attendant —
/// do not read English. Until now the code guessed for them: the driver
/// screens were written in Hindi and everything else in English, so a peon
/// handed the fee counter, or a gateman opening the visitor gate, hit a screen
/// he could not read. Language belongs to the person, not the job title.
///
/// Null means "follow the phone". Anything else is a deliberate choice and is
/// remembered across launches and sign-outs — a driver should not have to
/// re-pick Hindi every morning.
///
/// [fallback] is what a person who has never picked gets. The parent app
/// passes Hindi: the school's language for parents is Hindi unless the family
/// chose English (the director, 2026-09-13 — the same rule the WhatsApp
/// messages follow), and most parents' phones are set to English, so
/// "follow the phone" showed them English. The staff app keeps following the
/// phone.
class LocaleController extends ValueNotifier<Locale?> {
  LocaleController({this.fallback}) : super(fallback) {
    _active = this;
  }

  final Locale? fallback;

  /// The controller of the running app, for code with no BuildContext.
  static LocaleController? _active;

  /// Strings in the language on screen, for code with no BuildContext —
  /// an API error message, a notification body. Widgets use `context.l10n`.
  static L get strings {
    final chosen = _active?.value;
    if (chosen != null) return lookupL(chosen);
    final phone = PlatformDispatcher.instance.locale;
    final match = supported.firstWhere(
      (l) => l.languageCode == phone.languageCode,
      orElse: () => supported.first,
    );
    return lookupL(match);
  }

  static const _key = "bhb_app_locale";
  static const _storage = FlutterSecureStorage();

  /// Every language the app offers, in the order the toggle shows them.
  static const supported = <Locale>[Locale("en"), Locale("hi")];

  /// Read the stored choice. Safe to call before `runApp`.
  Future<void> load() async {
    try {
      final code = await _storage.read(key: _key);
      if (code != null && supported.any((l) => l.languageCode == code)) {
        value = Locale(code);
      }
    } catch (_) {
      // A locked keystore is not worth blocking startup for — the phone's
      // own language is a reasonable answer until they pick again.
    }
  }

  Future<void> set(Locale? locale) async {
    value = locale ?? fallback;
    try {
      if (locale == null) {
        await _storage.delete(key: _key);
      } else {
        await _storage.write(key: _key, value: locale.languageCode);
      }
    } catch (_) {
      // Kept for this run even if it could not be written.
    }
  }

  /// The other language — what the one-tap toggle switches to. Falls back to
  /// Hindi when following the phone, since English is the current default.
  Locale otherThan(Locale? current) {
    final code = current?.languageCode;
    return code == "hi" ? const Locale("en") : const Locale("hi");
  }
}

/// Hands [LocaleController] down the tree so any screen can offer the toggle.
class LocaleScope extends InheritedNotifier<LocaleController> {
  const LocaleScope({
    super.key,
    required LocaleController controller,
    required super.child,
  }) : super(notifier: controller);

  static LocaleController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<LocaleScope>();
    assert(scope?.notifier != null, "No LocaleScope above this widget");
    return scope!.notifier!;
  }
}

/// `context.l10n.someKey` — shorter than the generated call at 600-odd sites.
extension L10nContext on BuildContext {
  L get l10n => L.of(this);
}

/// A one-tap English ⇄ हिन्दी switch.
///
/// It shows the language you would switch TO, in that language's own script,
/// so it reads to somebody who cannot read the language currently on screen.
/// That is the whole point: a gateman staring at an English app has to be
/// able to find this without reading English.
class LanguageToggle extends StatelessWidget {
  const LanguageToggle({super.key, this.onLight = false});

  /// True when it sits on a dark app bar and needs light ink.
  final bool onLight;

  @override
  Widget build(BuildContext context) {
    final controller = LocaleScope.of(context);
    final current = controller.value ?? Localizations.localeOf(context);
    final next = controller.otherThan(current);
    final label = next.languageCode == "hi" ? "हिन्दी" : "English";
    return TextButton.icon(
      onPressed: () => controller.set(next),
      icon: Icon(
        Icons.translate,
        size: 18,
        color: onLight ? Colors.white : null,
      ),
      label: Text(
        label,
        style: onLight ? const TextStyle(color: Colors.white) : null,
      ),
      style: TextButton.styleFrom(
        foregroundColor: onLight ? Colors.white : null,
        visualDensity: VisualDensity.compact,
      ),
    );
  }
}
