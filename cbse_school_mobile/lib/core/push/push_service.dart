import "dart:async";
import "dart:convert";
import "dart:io" show Platform;

import "package:firebase_core/firebase_core.dart";
import "package:firebase_messaging/firebase_messaging.dart";
import "package:flutter/foundation.dart";
import "package:flutter_local_notifications/flutter_local_notifications.dart";
import "package:package_info_plus/package_info_plus.dart";

import "../api/api_client.dart";

/// Runs in a separate isolate when a message arrives while the app is
/// terminated/backgrounded. FCM already displays `notification` messages
/// itself in that state, so there is nothing to render here — the handler
/// only exists so the plugin has one registered.
@pragma("vm:entry-point")
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

/// FCM push for the app. One instance per app; `init()` once at startup,
/// `registerWithServer()` after every sign-in / session resume, and
/// `unregister()` before sign-out.
///
/// Notification taps are turned into an in-app route (`/homework`,
/// `/chat?studentId=…`, `/attendance?studentId=…`, `/notices`) delivered on
/// [onOpenRoute]; the shell decides what to do with it per persona.
class PushService {
  PushService(this.api);

  final ApiClient api;

  static const _channelId = "bhb_default";
  static const _channelName = "School updates";
  static const _channelDescription =
      "Homework, attendance, messages from the class teacher, fee receipts and notices.";

  final _local = FlutterLocalNotificationsPlugin();
  final _openRoute = StreamController<String>.broadcast();
  bool _firebaseReady = false;
  String? _lastRegisteredToken;

  /// Fires with a route string whenever the user taps a notification.
  Stream<String> get onOpenRoute => _openRoute.stream;

  /// Best-effort — a device without Google Play services (or a build
  /// without a google-services.json) must never stop the app from starting.
  Future<void> init() async {
    try {
      await Firebase.initializeApp();
      _firebaseReady = true;
    } catch (e) {
      debugPrint("[push] Firebase init skipped: $e");
      return;
    }

    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

    // Android channel + local-notification plugin (foreground display).
    const androidInit = AndroidInitializationSettings("@mipmap/ic_launcher");
    const darwinInit = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    await _local.initialize(
      const InitializationSettings(android: androidInit, iOS: darwinInit),
      onDidReceiveNotificationResponse: (resp) {
        final route = _routeFromPayload(resp.payload);
        if (route != null) _openRoute.add(route);
      },
    );
    await _local
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(
          const AndroidNotificationChannel(
            _channelId,
            _channelName,
            description: _channelDescription,
            importance: Importance.high,
          ),
        );

    // iOS: show banners while the app is in the foreground too.
    await FirebaseMessaging.instance
        .setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );

    // Foreground messages: FCM does NOT display these on Android, so render
    // them ourselves through the local plugin.
    FirebaseMessaging.onMessage.listen(_showForeground);

    // Taps: background → resumed, and terminated → cold start.
    FirebaseMessaging.onMessageOpenedApp.listen((m) {
      final route = _routeFromMessage(m);
      if (route != null) _openRoute.add(route);
    });
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) {
      final route = _routeFromMessage(initial);
      // Delay so the router exists before the first listener hears it.
      if (route != null) {
        Future.delayed(const Duration(milliseconds: 600), () {
          _openRoute.add(route);
        });
      }
    }

    // Token rotation → keep the server pointed at the live token.
    FirebaseMessaging.instance.onTokenRefresh.listen((t) {
      unawaited(_send(t));
    });
  }

  /// Ask for permission (no-op if already decided) and upload the current
  /// token against the signed-in session. Safe to call repeatedly.
  Future<void> registerWithServer() async {
    if (!_firebaseReady) return;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        return;
      }
      if (Platform.isIOS) {
        // Without an APNs token FCM cannot mint an iOS registration token
        // (simulators never get one) — don't hang on getToken().
        final apns = await FirebaseMessaging.instance.getAPNSToken();
        if (apns == null) return;
      }
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) return;
      await _send(token);
    } catch (e) {
      debugPrint("[push] register failed: $e");
    }
  }

  Future<void> _send(String token) async {
    if (!await api.hasSession()) return;
    String version = "";
    try {
      final info = await PackageInfo.fromPlatform();
      version = "${info.version}+${info.buildNumber}";
    } catch (_) {/* optional */}
    await api.registerPushToken(
      token: token,
      platform: Platform.isIOS ? "ios" : "android",
      appVersion: version,
    );
    _lastRegisteredToken = token;
  }

  /// Detach this device from the account being signed out. Must run BEFORE
  /// the session cookie is cleared (the endpoint needs a session).
  Future<void> unregister() async {
    if (!_firebaseReady) return;
    try {
      final token =
          _lastRegisteredToken ?? await FirebaseMessaging.instance.getToken();
      if (token != null && token.isNotEmpty) {
        await api.unregisterPushToken(token);
      }
      _lastRegisteredToken = null;
    } catch (e) {
      debugPrint("[push] unregister failed: $e");
    }
  }

  Future<void> _showForeground(RemoteMessage m) async {
    final title = m.notification?.title ?? m.data["title"] as String?;
    final body = m.notification?.body ?? m.data["body"] as String?;
    if (title == null && body == null) return;
    // iOS shows its own banner via the presentation options above.
    if (Platform.isIOS) return;
    await _local.show(
      m.hashCode,
      title,
      body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId,
          _channelName,
          channelDescription: _channelDescription,
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
      payload: jsonEncode(m.data),
    );
  }

  static String? _routeFromMessage(RemoteMessage m) {
    final url = m.data["url"];
    if (url is String && url.startsWith("/")) return url;
    return null;
  }

  static String? _routeFromPayload(String? payload) {
    if (payload == null || payload.isEmpty) return null;
    try {
      final data = jsonDecode(payload);
      if (data is Map && data["url"] is String) {
        final url = data["url"] as String;
        if (url.startsWith("/")) return url;
      }
    } catch (_) {/* ignore */}
    return null;
  }

  void dispose() {
    _openRoute.close();
  }
}
