import "package:flutter/material.dart";

import "../ui/motion.dart";

/// Brand colours aligned with apps/web TENANT tokens.
class AppColors {
  static const primary = Color(0xFF203050);
  static const primaryMid = Color(0xFF384870);
  static const accent = Color(0xFFC5A028);
  static const accentSoft = Color(0xFFD4B84A);
  static const cream = Color(0xFFF8F8F0);
  static const surface = Color(0xFFF6F5EF);
  static const ink = Color(0xFF203050);
  static const muted = Color(0xFF5C6478);

  static const success = Color(0xFF0F7A4C);
  static const warning = Color(0xFFB45309);
  static const danger = Color(0xFFB42318);
  static const info = Color(0xFF1D4ED8);
}

/// Soft tint + icon colour pairs for module tiles (Edunext-style grid).
class ModuleTone {
  const ModuleTone(this.background, this.foreground);

  final Color background;
  final Color foreground;

  static const blue = ModuleTone(Color(0xFFE6F1FB), Color(0xFF185FA5));
  static const teal = ModuleTone(Color(0xFFE1F5EE), Color(0xFF0F6E56));
  static const purple = ModuleTone(Color(0xFFEEEDFE), Color(0xFF534AB7));
  static const coral = ModuleTone(Color(0xFFFAECE7), Color(0xFF993C1D));
  static const pink = ModuleTone(Color(0xFFFBEAF0), Color(0xFF993556));
  static const amber = ModuleTone(Color(0xFFFAEEDA), Color(0xFF854F0B));
  static const green = ModuleTone(Color(0xFFEAF3DE), Color(0xFF3B6D11));
  static const gray = ModuleTone(Color(0xFFF1EFE8), Color(0xFF5F5E5A));
}

/// The app's type scale, in one place.
///
/// Before this existed the screens carried 533 inline `TextStyle`s spelling
/// out **eighteen** font sizes — 11 and 11.5, 12 and 12.5, 13 and 13.5, 14 and
/// 14.5, 16 and 16.5 and 17. Nobody chose those half-points; they are what a
/// year of copy-paste looks like. Twelve roles cover every one of them, and
/// the value kept from each pair is whichever the screens already used most,
/// so the change is invisible almost everywhere it lands.
///
/// **Colour is a separate axis, deliberately.** The base role carries no
/// colour and inherits — a lot of this text sits on tinted `ModuleTone` cards
/// and coloured app bars, and a role that forced `ink` in would have turned
/// those unreadable. `…Ink` and `…Muted` name the two the screens actually
/// asked for; anything else stays a `copyWith` at the call site.
///
/// The `…Ink` styles are what `ThemeData.textTheme` is built from, so
/// `Theme.of(context).textTheme.bodySmall` is [AppText.bodySmallInk]. Call
/// sites use [AppText] directly because 336 of them sit inside `const`
/// widgets, and `Theme.of(context)` would cost that `const` — and the const
/// of every widget above it — for nothing.
///
/// The scale is denser than Material's defaults (M3 puts bodySmall at 12
/// against a 14 bodyMedium): these are register and ledger screens, read at
/// arm's length, not marketing pages.
abstract final class AppText {
  /// Timestamps, counts, the smallest chips. (was 10, 10.5)
  static const labelSmall = TextStyle(
    fontSize: 10.5,
    fontWeight: FontWeight.w600,
  );
  static const labelSmallInk = TextStyle(
    fontSize: 10.5,
    fontWeight: FontWeight.w600,
    color: AppColors.ink,
  );
  static const labelSmallMuted = TextStyle(
    fontSize: 10.5,
    fontWeight: FontWeight.w600,
    color: AppColors.muted,
  );

  /// Chip and badge labels, table column heads. (was 11, 11.5)
  static const labelMedium = TextStyle(
    fontSize: 11.5,
    fontWeight: FontWeight.w600,
  );
  static const labelMediumInk = TextStyle(
    fontSize: 11.5,
    fontWeight: FontWeight.w600,
    color: AppColors.ink,
  );
  static const labelMediumMuted = TextStyle(
    fontSize: 11.5,
    fontWeight: FontWeight.w600,
    color: AppColors.muted,
  );

  /// Buttons and tabs — 12.5 where the text is an action. (was 12.5)
  static const labelLarge = TextStyle(
    fontSize: 12.5,
    fontWeight: FontWeight.w600,
  );
  static const labelLargeInk = TextStyle(
    fontSize: 12.5,
    fontWeight: FontWeight.w600,
    color: AppColors.ink,
  );
  static const labelLargeMuted = TextStyle(
    fontSize: 12.5,
    fontWeight: FontWeight.w600,
    color: AppColors.muted,
  );

  /// The workhorse: the secondary line under a title. (was 12, 12.5)
  static const bodySmall = TextStyle(fontSize: 12);
  static const bodySmallInk = TextStyle(fontSize: 12, color: AppColors.ink);
  static const bodySmallMuted = TextStyle(fontSize: 12, color: AppColors.muted);

  /// Ordinary paragraph text. (was 13, 13.5)
  static const bodyMedium = TextStyle(fontSize: 13);
  static const bodyMediumInk = TextStyle(fontSize: 13, color: AppColors.ink);
  static const bodyMediumMuted = TextStyle(
    fontSize: 13,
    color: AppColors.muted,
  );

  /// Emphasised body, empty-state sentences. (was 14, 14.5)
  static const bodyLarge = TextStyle(fontSize: 14);
  static const bodyLargeInk = TextStyle(fontSize: 14, color: AppColors.ink);
  static const bodyLargeMuted = TextStyle(fontSize: 14, color: AppColors.muted);

  /// List-row titles. (was 15)
  static const titleSmall = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w600,
  );
  static const titleSmallInk = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    color: AppColors.ink,
  );
  static const titleSmallMuted = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    color: AppColors.muted,
  );

  /// Card headings and app-bar titles. (was 16, 16.5, 17)
  static const titleMedium = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w600,
  );
  static const titleMediumInk = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w600,
    color: AppColors.ink,
  );
  static const titleMediumMuted = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w600,
    color: AppColors.muted,
  );

  /// Screen headings. (was 18)
  static const titleLarge = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w700,
  );
  static const titleLargeInk = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w700,
    color: AppColors.ink,
  );
  static const titleLargeMuted = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w700,
    color: AppColors.muted,
  );

  /// The one-per-screen number: a balance, a total. (was 20)
  static const headlineSmall = TextStyle(
    fontSize: 20,
    fontWeight: FontWeight.w700,
  );
  static const headlineSmallInk = TextStyle(
    fontSize: 20,
    fontWeight: FontWeight.w700,
    color: AppColors.ink,
  );
  static const headlineSmallMuted = TextStyle(
    fontSize: 20,
    fontWeight: FontWeight.w700,
    color: AppColors.muted,
  );

  /// (was 22)
  static const headlineMedium = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.w700,
  );
  static const headlineMediumInk = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.w700,
    color: AppColors.ink,
  );
  static const headlineMediumMuted = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.w700,
    color: AppColors.muted,
  );

  /// (was 24)
  static const headlineLarge = TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.w700,
  );
  static const headlineLargeInk = TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.w700,
    color: AppColors.ink,
  );
  static const headlineLargeMuted = TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.w700,
    color: AppColors.muted,
  );

  /// The Material text theme — the `…Ink` styles, so any Material widget that
  /// reads `Theme.of(context).textTheme` gets the same type the screens use.
  static const textTheme = TextTheme(
    labelSmall: labelSmallInk,
    labelMedium: labelMediumInk,
    labelLarge: labelLargeInk,
    bodySmall: bodySmallInk,
    bodyMedium: bodyMediumInk,
    bodyLarge: bodyLargeInk,
    titleSmall: titleSmallInk,
    titleMedium: titleMediumInk,
    titleLarge: titleLargeInk,
    headlineSmall: headlineSmallInk,
    headlineMedium: headlineMediumInk,
    headlineLarge: headlineLargeInk,
  );
}

ThemeData buildAppTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      primary: AppColors.primary,
      secondary: AppColors.accent,
      surface: AppColors.surface,
      error: AppColors.danger,
    ),
    scaffoldBackgroundColor: AppColors.surface,
    textTheme: AppText.textTheme,
  );
  return base.copyWith(
    // One fade-through transition for every route on every platform, so a
    // pushed module and a go_router destination move the same way.
    pageTransitionsTheme: PageTransitionsTheme(
      builders: {
        for (final platform in TargetPlatform.values)
          platform: const FadeThroughPageTransitionsBuilder(),
      },
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.primary,
      foregroundColor: Colors.white,
      elevation: 0,
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: AppColors.ink.withValues(alpha: 0.08)),
      ),
      margin: EdgeInsets.zero,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: AppColors.ink.withValues(alpha: 0.18)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: AppColors.ink.withValues(alpha: 0.18)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.accent, width: 1.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 15),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: AppText.titleSmall,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: AppColors.accent.withValues(alpha: 0.22),
      labelTextStyle: const WidgetStatePropertyAll(AppText.labelMediumInk),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected)
              ? AppColors.primary
              : AppColors.muted,
        ),
      ),
    ),
  );
}
