/// Default entry point, kept so a bare `flutter run` still works.
///
/// The school ships two apps from this codebase and each has its own entry —
/// lib/main_parent.dart and lib/main_staff.dart. Release builds must name one
/// explicitly with `-t`, together with the matching `--flavor`, or the
/// permissions in the manifest will not match the code that is running.
///
/// This delegates to staff because that is what the single combined app used
/// to be, so existing scripts and muscle memory keep behaving as before.
library;

import "main_staff.dart" as staff;

Future<void> main() => staff.main();
