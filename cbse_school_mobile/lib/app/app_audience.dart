import "package:flutter/material.dart";
import "package:go_router/go_router.dart";

import "../core/api/api_client.dart";
import "../core/config/app_config.dart";

/// Who a build is for.
///
/// The school ships two apps from this one codebase. They differ in what the
/// Play listing has to declare, which is the whole reason they are separate:
/// the staff app tracks location in the background for presence, records audio
/// for lesson-plan dictation and opens the camera for syllabus scans, while the
/// parent app needs none of that. Bundling them meant a parent installing the
/// app to check fees was asked for background location because of a staff
/// feature they would never see — the exact pattern Play's restricted-permission
/// review exists to stop.
///
/// The split is enforced in two places, and both matter:
///  - here, so a build only compiles in the screens its audience can reach; and
///  - in the per-flavour AndroidManifest, which removes the permissions the
///    plugins inject of their own accord. Not importing geolocator is not
///    enough on its own — its manifest merges ACCESS_FINE_LOCATION in whether
///    you call it or not.
enum AppAudience {
  parent,
  staff;

  String get appName => switch (this) {
        AppAudience.parent => "BHB School — Parents",
        AppAudience.staff => "BHB School — Staff",
      };

  /// Whether this build can serve the persona the ERP hands back.
  ///
  /// `persona()` is null for a parent signed in by OTP — nothing writes the key
  /// on that path — so null counts as a parent, matching how the router has
  /// always treated it.
  bool servesPersona(String? persona) => switch (this) {
        AppAudience.parent => persona != "staff" && persona != "field",
        AppAudience.staff => persona == "staff" || persona == "field",
      };
}

/// Routes are supplied by the entry point rather than built here, so a parent
/// build never imports a staff screen and the tree-shaker can drop them.
typedef RoutesBuilder = List<RouteBase> Function(
  ApiClient api,
  AppConfig config,
  Future<void> Function() onSignedIn,
);

/// Shown when someone signs in to the wrong one of the two apps.
///
/// Without this they land on a route the build does not register and see a
/// router error, which is both alarming and unhelpful. It matters for store
/// review too: a reviewer given a parent login will try it against whichever
/// app they are reviewing.
class WrongAppScreen extends StatelessWidget {
  const WrongAppScreen({
    super.key,
    required this.audience,
    required this.api,
  });

  final AppAudience audience;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final wanted = audience == AppAudience.parent
        ? "BHB School — Staff"
        : "BHB School — Parents";
    final theirs = audience == AppAudience.parent ? "a staff" : "a parent";
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.swap_horiz, size: 44),
              const SizedBox(height: 16),
              Text(
                "That's $theirs sign-in",
                style: Theme.of(context).textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 10),
              Text(
                "This is the ${audience.appName} app. Install $wanted and "
                "sign in there instead.",
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 22),
              FilledButton(
                onPressed: () async {
                  await api.signOut();
                  if (context.mounted) context.go("/login");
                },
                child: const Text("Back to sign in"),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
