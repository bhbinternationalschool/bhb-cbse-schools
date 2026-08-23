import "dart:async";

import "package:flutter/material.dart";
import "package:go_router/go_router.dart";

import "../core/api/api_client.dart";
import "../core/config/app_config.dart";
import "../core/push/push_service.dart";
import "../core/theme/app_theme.dart";
import "../features/auth/login_screen.dart";
import "../features/home/home_screen.dart";
import "../features/staff/driver_home_screen.dart";
import "../features/staff/principal_home_screen.dart";
import "../features/staff/teacher_home_screen.dart";

class CbseSchoolApp extends StatefulWidget {
  const CbseSchoolApp({super.key, this.config = AppConfig.production});

  final AppConfig config;

  @override
  State<CbseSchoolApp> createState() => _CbseSchoolAppState();
}

class _CbseSchoolAppState extends State<CbseSchoolApp> {
  late final ApiClient _api = ApiClient(widget.config);
  late final PushService _push = PushService(_api);

  late final GoRouter _router = GoRouter(
    initialLocation: "/login",
    routes: [
      GoRoute(
        path: "/login",
        builder: (context, state) => LoginScreen(
          config: widget.config,
          api: _api,
          onSignedIn: _goHomeForPersona,
        ),
      ),
      GoRoute(
        path: "/home",
        builder: (context, state) => HomeScreen(
          config: widget.config,
          api: _api,
          onLogout: () => context.go("/login"),
          openRoute: state.uri.queryParameters["open"],
        ),
      ),
      GoRoute(
        path: "/staff",
        builder: (context, state) => TeacherHomeScreen(
          api: _api,
          onLogout: () => context.go("/login"),
          openRoute: state.uri.queryParameters["open"],
        ),
      ),
      GoRoute(
        path: "/principal",
        builder: (context, state) => PrincipalHomeScreen(
          api: _api,
          onLogout: () => context.go("/login"),
        ),
      ),
      GoRoute(
        path: "/driver",
        builder: (context, state) => DriverHomeScreen(
          api: _api,
          onLogout: () => context.go("/login"),
        ),
      ),
    ],
  );

  Future<String> _homePathForPersona() async {
    final persona = await _api.persona();
    // "field" is honoured because the password login path still reads a
    // stored persona, but nothing mints it today — so the crew check below
    // is what actually gets a driver to the bus home. Without it they land
    // on the teacher home and the route/boarding screens are unreachable.
    if (persona == "field") return "/driver";
    if (persona == "staff") {
      if (await _api.isTransportCrew()) return "/driver";
      return await _api.isPrincipalLike() ? "/principal" : "/staff";
    }
    return "/home";
  }

  Future<void> _goHomeForPersona() async {
    final path = await _homePathForPersona();
    if (!mounted) return;
    _router.go(path);
    // Every sign-in / resume re-registers this device's push token against
    // the current subject (idempotent; also asks for permission first time).
    unawaited(_push.registerWithServer());
  }

  /// A notification tap → the persona's home with an `open` deep link the
  /// home screen consumes once its data has loaded.
  Future<void> _openFromNotification(String route) async {
    if (!await _api.hasSession()) return;
    final path = await _homePathForPersona();
    if (!mounted) return;
    _router.go("$path?open=${Uri.encodeQueryComponent(route)}");
  }

  @override
  void initState() {
    super.initState();
    _api.beforeSignOut = _push.unregister;
    _push.init().then((_) {
      _push.onOpenRoute.listen(_openFromNotification);
    });
    // Resume a stored session straight into the right dashboard.
    _api.hasSession().then((has) {
      if (has && mounted) _goHomeForPersona();
    });
  }

  @override
  void dispose() {
    _push.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: widget.config.schoolName,
      theme: buildAppTheme(),
      routerConfig: _router,
    );
  }
}
