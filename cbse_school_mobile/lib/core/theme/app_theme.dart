import "package:flutter/material.dart";

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
  );
  return base.copyWith(
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
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: AppColors.accent.withValues(alpha: 0.22),
      labelTextStyle: WidgetStatePropertyAll(
        TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
      ),
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
