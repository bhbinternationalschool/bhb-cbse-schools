import "package:go_router/go_router.dart";

import "../core/api/api_client.dart";
import "../core/config/app_config.dart";
import "../features/auth/login_screen.dart";
import "../features/staff/desk_home_screen.dart";
import "../features/staff/driver_home_screen.dart";
import "../features/staff/principal_home_screen.dart";
import "../features/staff/teacher_home_screen.dart";
import "app_audience.dart";

/// Routes for the staff app — teachers, the principal and transport crew.
///
/// This is the build that carries the sensitive permissions: background
/// location for presence pings, audio for dictating lesson plans, and the
/// camera for syllabus scans. Each is core to a staff feature, which is the
/// case that has to be made to Play's reviewers; none of it belongs in a build
/// parents install.
List<RouteBase> staffRoutes(
  ApiClient api,
  AppConfig config,
  Future<void> Function() onSignedIn,
) => [
  GoRoute(
    path: "/login",
    builder: (context, state) =>
        LoginScreen(config: config, api: api, onSignedIn: onSignedIn),
  ),
  GoRoute(
    path: "/staff",
    builder: (context, state) => TeacherHomeScreen(
      api: api,
      onLogout: () => context.go("/login"),
      openRoute: state.uri.queryParameters["open"],
    ),
  ),
  GoRoute(
    path: "/principal",
    builder: (context, state) => PrincipalHomeScreen(
      api: api,
      onLogout: () => context.go("/login"),
      openRoute: state.uri.queryParameters["open"],
    ),
  ),
  GoRoute(
    path: "/desk",
    builder: (context, state) => DeskHomeScreen(
      api: api,
      onLogout: () => context.go("/login"),
      openRoute: state.uri.queryParameters["open"],
    ),
  ),
  GoRoute(
    path: "/driver",
    builder: (context, state) =>
        DriverHomeScreen(api: api, onLogout: () => context.go("/login")),
  ),
  GoRoute(
    path: "/wrong-app",
    builder: (context, state) =>
        WrongAppScreen(audience: AppAudience.staff, api: api),
  ),
];
