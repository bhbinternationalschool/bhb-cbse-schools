import "package:flutter/material.dart";

import "app/app_audience.dart";
import "app/cbse_school_app.dart";
import "app/routes_staff.dart";
import "core/update/app_build.dart";

/// Entry point for the staff app. No background location since 1.0.16: attendance is
/// proven at the moment of the punch (gate QR + phone key + live GPS), which needs
/// no restricted permission, so the app can pass Play review (director, 5 Oct 2026).
///
///   flutter build appbundle --release --flavor staff -t lib/main_staff.dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppBuild.load("staff");
  runApp(
    const CbseSchoolApp(audience: AppAudience.staff, buildRoutes: staffRoutes),
  );
}
