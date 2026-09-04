import "package:flutter/material.dart";

import "app/app_audience.dart";
import "app/cbse_school_app.dart";
import "app/routes_staff.dart";
import "features/staff/presence_service.dart";

/// Entry point for the staff app — the build that carries background location.
///
///   flutter build appbundle --release --flavor staff -t lib/main_staff.dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initPresenceService();
  runApp(
    const CbseSchoolApp(
      audience: AppAudience.staff,
      buildRoutes: staffRoutes,
    ),
  );
}
