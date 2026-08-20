import "package:flutter/material.dart";

import "app/cbse_school_app.dart";
import "features/staff/presence_service.dart";

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initPresenceService();
  runApp(const CbseSchoolApp());
}
