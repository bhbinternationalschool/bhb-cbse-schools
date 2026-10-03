import "package:flutter/material.dart";

import "app/app_audience.dart";
import "app/cbse_school_app.dart";
import "app/routes_parent.dart";
import "core/update/app_build.dart";

/// Entry point for the parent app.
///
/// Note what is missing: no presence service. That call is what starts the
/// background location foreground service, and a parent build must never
/// reach it — the whole point of the split.
///
///   flutter build appbundle --release --flavor parent -t lib/main_parent.dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppBuild.load("parent");
  runApp(
    const CbseSchoolApp(
      audience: AppAudience.parent,
      buildRoutes: parentRoutes,
    ),
  );
}
