import "package:flutter/foundation.dart";
import "package:package_info_plus/package_info_plus.dart";

/// Which app this is and which build — sent with every signed-in request so
/// the server can tell a phone that it is too old (see the ERP's
/// lib/appMinBuild.ts), and read by [AppUpdateGate].
class AppBuild {
  AppBuild._();

  /// "staff" or "parent"; empty until [load].
  static String flavor = "";

  /// The Android versionCode (the number after + in pubspec.yaml); 0 when
  /// unknown, which the server never treats as old.
  static int build = 0;

  /// The Play package name, for the store link.
  static String packageName = "";

  /// Set when the server says this build no longer works — at launch, or by
  /// any request answered 426. [AppUpdateGate] then blocks the app.
  static final ValueNotifier<bool> updateRequired = ValueNotifier(false);

  static Future<void> load(String appFlavor) async {
    flavor = appFlavor;
    try {
      final info = await PackageInfo.fromPlatform();
      build = int.tryParse(info.buildNumber) ?? 0;
      packageName = info.packageName;
    } catch (_) {
      // Unknown build: requests go without it and are never refused for it.
    }
  }

  static Map<String, String> get headers => {
    if (flavor.isNotEmpty) "X-App-Flavor": flavor,
    if (build > 0) "X-App-Build": "$build",
  };
}
