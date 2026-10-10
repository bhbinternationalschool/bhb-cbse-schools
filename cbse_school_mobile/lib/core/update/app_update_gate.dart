import "dart:async";
import "dart:convert";
import "dart:io" show Platform;

import "package:flutter/material.dart";
import "package:http/http.dart" as http;
import "package:in_app_update/in_app_update.dart";
import "package:url_launcher/url_launcher.dart";

import "../i18n/locale_controller.dart";
import "app_build.dart";

/// Keeps the phone on a build the server still works with.
///
/// Play installs updates on its own — usually overnight on Wi-Fi — and can't
/// be told to hurry. So, at launch and whenever the app comes back to the
/// front (at most every 30 minutes):
///  - the server is asked whether this build is too old
///    (/api/public/app-version). If it is, the whole app is replaced by
///    "Update to continue" and Play's full-screen update is started;
///  - otherwise, if Play has a newer build, it downloads in the background
///    and a bar offers to restart into it. Staff can carry on meanwhile.
///
/// Any request the server answers 426 sets [AppBuild.updateRequired] too, so
/// an app left open across a server change is caught at the next tap.
///
/// Play's update API only works for an app Play installed; for a sideloaded
/// copy the button opens the store listing instead.
class AppUpdateGate extends StatefulWidget {
  const AppUpdateGate({
    super.key,
    required this.apiBaseUrl,
    required this.messenger,
    required this.child,
    this.onSignOut,
  });

  /// Signs out and returns to the login screen (the family-inactive screen's
  /// "Use another number").
  final Future<void> Function()? onSignOut;

  final String apiBaseUrl;
  final GlobalKey<ScaffoldMessengerState> messenger;
  final Widget child;

  @override
  State<AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends State<AppUpdateGate>
    with WidgetsBindingObserver {
  static const _recheckAfter = Duration(minutes: 30);

  DateTime? _lastCheck;
  bool _checking = false;
  bool _flexibleStarted = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    AppBuild.updateRequired.addListener(_onRequired);
    unawaited(_check());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    AppBuild.updateRequired.removeListener(_onRequired);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    final last = _lastCheck;
    if (last == null || DateTime.now().difference(last) > _recheckAfter) {
      unawaited(_check());
    }
  }

  void _onRequired() {
    if (AppBuild.updateRequired.value) unawaited(_update(immediate: true));
  }

  Future<void> _check() async {
    if (_checking || AppBuild.flavor.isEmpty) return;
    _checking = true;
    _lastCheck = DateTime.now();
    try {
      if (await _serverSaysTooOld()) {
        AppBuild.updateRequired.value = true; // → _onRequired
      } else {
        await _update(immediate: false);
      }
    } finally {
      _checking = false;
    }
  }

  /// Only a clear "too old" from the server blocks the app. No network, a
  /// server error or an unknown build all leave it running.
  Future<bool> _serverSaysTooOld() async {
    if (AppBuild.build <= 0) return false;
    try {
      final uri = Uri.parse("${widget.apiBaseUrl}/api/public/app-version").replace(
        queryParameters: {"app": AppBuild.flavor, "build": "${AppBuild.build}"},
      );
      final res = await http.get(uri).timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return false;
      final body = jsonDecode(res.body);
      return body is Map && body["updateRequired"] == true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _update({required bool immediate}) async {
    if (!Platform.isAndroid) {
      if (immediate) await _openStore();
      return;
    }
    try {
      final info = await InAppUpdate.checkForUpdate();
      if (info.updateAvailability != UpdateAvailability.updateAvailable) {
        // Required but Play doesn't see a newer build yet (still rolling
        // out to this phone): the listing is the best we can offer.
        if (immediate) await _openStore();
        return;
      }
      if (immediate && info.immediateUpdateAllowed) {
        await InAppUpdate.performImmediateUpdate();
      } else if (immediate) {
        await _openStore();
      } else if (info.flexibleUpdateAllowed && !_flexibleStarted) {
        _flexibleStarted = true;
        final result = await InAppUpdate.startFlexibleUpdate();
        if (result == AppUpdateResult.success) _offerRestart();
      }
    } catch (_) {
      // Not installed by Play, or Play unavailable.
      if (immediate) await _openStore();
    }
  }

  void _offerRestart() {
    final messenger = widget.messenger.currentState;
    final ctx = widget.messenger.currentContext;
    if (messenger == null || ctx == null) return;
    final l = ctx.l10n;
    messenger.showSnackBar(
      SnackBar(
        content: Text(l.updateDownloaded),
        duration: const Duration(days: 1),
        action: SnackBarAction(
          label: l.updateRestart,
          onPressed: () => unawaited(InAppUpdate.completeFlexibleUpdate()),
        ),
      ),
    );
  }

  Future<void> _openStore() async {
    final id = AppBuild.packageName;
    if (id.isEmpty) return;
    final market = Uri.parse("market://details?id=$id");
    final web = Uri.parse("https://play.google.com/store/apps/details?id=$id");
    try {
      if (await launchUrl(market, mode: LaunchMode.externalApplication)) return;
    } catch (_) {
      /* no Play Store app — try the web listing */
    }
    try {
      await launchUrl(web, mode: LaunchMode.externalApplication);
    } catch (_) {
      /* nothing more to try */
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: AppBuild.updateRequired,
      builder: (context, required, child) => required
          ? _UpdateRequiredScreen(onUpdate: () => _update(immediate: true))
          : ValueListenableBuilder<String?>(
              valueListenable: AppBuild.familyInactive,
              builder: (context, reason, child) => reason == null
                  ? child!
                  : _FamilyInactiveScreen(
                      reason: reason,
                      onSignOut: () async {
                        await widget.onSignOut?.call();
                        AppBuild.familyInactive.value = null;
                      },
                    ),
              child: child,
            ),
      child: widget.child,
    );
  }
}

class _UpdateRequiredScreen extends StatelessWidget {
  const _UpdateRequiredScreen({required this.onUpdate});

  final Future<void> Function() onUpdate;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.system_update, size: 48),
                const SizedBox(height: 16),
                Text(
                  l.updateRequiredTitle,
                  style: Theme.of(context).textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 10),
                Text(l.updateRequiredBody, textAlign: TextAlign.center),
                const SizedBox(height: 22),
                FilledButton.icon(
                  onPressed: onUpdate,
                  icon: const Icon(Icons.download),
                  label: Text(l.updateNow),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The school has made every child of this family inactive: the app is
/// closed to them, with the school's own words (Hindi and English) and a way
/// to sign in with another number.
class _FamilyInactiveScreen extends StatelessWidget {
  const _FamilyInactiveScreen({required this.reason, required this.onSignOut});

  final String reason;
  final Future<void> Function() onSignOut;

  @override
  Widget build(BuildContext context) {
    final hi = Localizations.localeOf(context).languageCode == "hi";
    // The server sends "English / हिन्दी"; show the reader's half.
    final parts = reason.split(" / ");
    final text = parts.length == 2 ? (hi ? parts[1] : parts[0]) : reason;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.lock_outline, size: 48),
                const SizedBox(height: 16),
                Text(
                  hi ? "ऐप बंद है" : "App closed for this family",
                  style: Theme.of(context).textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 10),
                Text(text, textAlign: TextAlign.center),
                const SizedBox(height: 22),
                OutlinedButton(
                  onPressed: onSignOut,
                  child: Text(hi ? "दूसरे नंबर से लॉगिन करें" : "Sign in with another number"),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
