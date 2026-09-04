import "dart:async";

import "package:flutter/material.dart";
import "package:go_router/go_router.dart";

import "../core/api/api_client.dart";
import "../core/config/app_config.dart";
import "../core/push/push_service.dart";
import "../core/theme/app_theme.dart";
import "app_audience.dart";

/// The shared shell for both apps.
///
/// Everything that is the same either side of the parent/staff split lives
/// here — the API client, push registration, session resume and the persona
/// routing. What differs is injected: the [audience] this build serves and the
/// [buildRoutes] that go with it. Keeping the routes out means a parent build
/// never has a staff screen in its import graph, which is what lets it ship
/// without background location. See [AppAudience].
class CbseSchoolApp extends StatefulWidget {
  const CbseSchoolApp({
    super.key,
    required this.audience,
    required this.buildRoutes,
    this.config = AppConfig.production,
  });

  final AppConfig config;
  final AppAudience audience;
  final RoutesBuilder buildRoutes;

  @override
  State<CbseSchoolApp> createState() => _CbseSchoolAppState();
}

class _CbseSchoolAppState extends State<CbseSchoolApp> {
  late final ApiClient _api = ApiClient(widget.config);
  late final PushService _push = PushService(_api);

  late final GoRouter _router = GoRouter(
    initialLocation: "/login",
    routes: widget.buildRoutes(_api, widget.config, _goHomeForPersona),
  );

  Future<String> _homePathForPersona() async {
    final persona = await _api.persona();

    // Signed in to the wrong one of the two apps. Say so plainly rather than
    // routing to a path this build does not register, which would surface as
    // a router error.
    if (!widget.audience.servesPersona(persona)) return "/wrong-app";

    if (widget.audience == AppAudience.parent) return "/home";

    // "field" is honoured because the password login path still reads a
    // stored persona, but nothing mints it today — so the crew check below
    // is what actually gets a driver to the bus home. Without it they land
    // on the teacher home and the route/boarding screens are unreachable.
    if (persona == "field") return "/driver";
    if (await _api.isTransportCrew()) return "/driver";
    return await _api.isPrincipalLike() ? "/principal" : "/staff";
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
      title: widget.audience.appName,
      theme: buildAppTheme(),
      routerConfig: _router,
    );
  }
}
