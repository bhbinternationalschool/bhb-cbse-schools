import "package:flutter/material.dart";
import "package:go_router/go_router.dart";

import "../core/api/api_client.dart";
import "../core/config/app_config.dart";
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
        ),
      ),
      GoRoute(
        path: "/staff",
        builder: (context, state) => TeacherHomeScreen(
          api: _api,
          onLogout: () => context.go("/login"),
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

  Future<void> _goHomeForPersona() async {
    final persona = await _api.persona();
    if (!mounted) return;
    if (persona == "field") {
      _router.go("/driver");
    } else if (persona == "staff") {
      _router.go(await _api.isPrincipalLike() ? "/principal" : "/staff");
    } else {
      _router.go("/home");
    }
  }

  @override
  void initState() {
    super.initState();
    // Resume a stored session straight into the right dashboard.
    _api.hasSession().then((has) {
      if (has && mounted) _goHomeForPersona();
    });
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
