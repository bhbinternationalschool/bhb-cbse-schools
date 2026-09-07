/// Runtime config — override via `--dart-define` for staging/production builds.
class AppConfig {
  const AppConfig({
    required this.apiBaseUrl,
    required this.tenantSlug,
    required this.schoolName,
    required this.supabaseUrl,
    required this.supabaseAnonKey,
  });

  final String apiBaseUrl;
  final String tenantSlug;
  final String schoolName;
  final String supabaseUrl;
  final String supabaseAnonKey;

  static const AppConfig production = AppConfig(
    apiBaseUrl: String.fromEnvironment(
      "API_BASE_URL",
      defaultValue: "https://bhbinternational.school",
    ),
    tenantSlug: String.fromEnvironment(
      "TENANT_SLUG",
      defaultValue: "bhb-international",
    ),
    schoolName: String.fromEnvironment(
      "SCHOOL_NAME",
      defaultValue: "BHB INTERNATIONAL SCHOOL",
    ),
    supabaseUrl: String.fromEnvironment("SUPABASE_URL", defaultValue: ""),
    supabaseAnonKey: String.fromEnvironment(
      "SUPABASE_ANON_KEY",
      defaultValue: "",
    ),
  );

  bool get supabaseConfigured =>
      supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty;

  /// Dev-only: show the demo-household login button. Works only against a
  /// server with demo auth enabled (local dev), never production.
  static const bool devLogin = bool.fromEnvironment("DEV_LOGIN");

  /// True in the build distributed through Google Play.
  ///
  /// Play requires its own billing for digital content consumed inside the
  /// app, so the tutor pass is bought through Play there. The sideloaded APK
  /// keeps the Cashfree checkout — Play's rules do not reach an app Play did
  /// not deliver — and school FEES stay on Cashfree in both, because paying
  /// for a real-world education service is exempt.
  static const bool playBilling = bool.fromEnvironment("PLAY_BILLING");
}
