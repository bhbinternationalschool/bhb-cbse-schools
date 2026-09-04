import "package:flutter/services.dart";

/// One vocabulary of haptics for the whole app, so a parent learns what each
/// pulse means: a light tick for choosing something, a firm double tap when
/// the school has accepted an action, a heavy thud when it has refused one.
///
/// Every call is fire-and-forget — the platform swallows it on devices with
/// no vibrator and nothing here should ever block or throw into UI code.
class Haptics {
  Haptics._();

  /// Choosing among peers: a child chip, a tab, a module tile.
  static void tap() {
    HapticFeedback.selectionClick();
  }

  /// A major action the server accepted — attendance saved, fee checkout
  /// started, a document verified, a request sent.
  static void success() {
    HapticFeedback.mediumImpact();
    Future<void>.delayed(const Duration(milliseconds: 90), () {
      HapticFeedback.lightImpact();
    });
  }

  /// The school (or a validator) said no: a rejected document, a form that
  /// cannot be sent as filled in.
  static void warning() {
    HapticFeedback.heavyImpact();
  }
}
