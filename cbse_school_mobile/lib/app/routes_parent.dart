import "package:go_router/go_router.dart";

import "../core/api/api_client.dart";
import "../core/config/app_config.dart";
import "../features/auth/login_screen.dart";
import "../features/home/home_screen.dart";
import "app_audience.dart";

/// Routes for the parent app.
///
/// Deliberately does not import a single screen under features/staff. Those
/// screens pull in geolocator, flutter_background_service, speech_to_text and
/// image_picker, and a parent build that never references them can be shipped
/// without the permissions those plugins carry.
List<RouteBase> parentRoutes(
  ApiClient api,
  AppConfig config,
  Future<void> Function() onSignedIn,
) =>
    [
      GoRoute(
        path: "/login",
        builder: (context, state) => LoginScreen(
          config: config,
          api: api,
          onSignedIn: onSignedIn,
        ),
      ),
      GoRoute(
        path: "/home",
        builder: (context, state) => HomeScreen(
          config: config,
          api: api,
          onLogout: () => context.go("/login"),
          openRoute: state.uri.queryParameters["open"],
        ),
      ),
      GoRoute(
        path: "/wrong-app",
        builder: (context, state) => WrongAppScreen(
          audience: AppAudience.parent,
          api: api,
        ),
      ),
    ];
