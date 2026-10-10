import "dart:async";
import "dart:convert";
import "dart:io" show Platform;

import "package:firebase_core/firebase_core.dart";
import "package:firebase_messaging/firebase_messaging.dart";
import "package:flutter/foundation.dart";
import "package:flutter_local_notifications/flutter_local_notifications.dart";
import "package:package_info_plus/package_info_plus.dart";

import "../api/api_client.dart";
import "../i18n/locale_controller.dart";

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

  /// One channel per spoken line (director, 9 Oct 2026). The server picks
  /// `bhb_voice_<kind>_<hi|en>` per notification (apps/web/src/lib/pushVoice.ts);
  /// each channel's sound is the clip of the same name in res/raw, so Android
  /// speaks it even when the app is closed. Channel sounds cannot be changed
  /// after creation — a new clip needs a new channel id.
  static const _voiceKinds = {
    "homework": ("Homework", "होमवर्क"),
    "attendance": ("Attendance", "हाज़िरी"),
    "fees": ("Fees", "फीस"),
    "message": ("Messages", "संदेश"),
    "leave": ("Leave", "छुट्टी"),
    "notice": ("Notices", "सूचनाएँ"),
  };

  static Iterable<String> get _voiceChannelIds => _voiceKinds.keys.expand(
    (k) => ["bhb_voice_${k}_hi", "bhb_voice_${k}_en"],
  );

  static String _voiceChannelName(String id) {
    final parts = id.split("_"); // bhb voice <kind> <lang>
    final names = _voiceKinds[parts[2]];
    if (names == null) return id;
    return parts[3] == "hi" ? "${names.$2} (हिंदी आवाज़)" : "${names.$1} (English voice)";
  }
  // Shown in the phone's notification settings, so in the app's language.
  // Re-creating the channel at every start renames it after a switch.
  static String get _channelName => LocaleController.strings.sysPushChannelName;
  static String get _channelDescription =>
      LocaleController.strings.sysPushChannelDescription;

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
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(
          AndroidNotificationChannel(
            _channelId,
            _channelName,
            description: _channelDescription,
            importance: Importance.high,
          ),
        );
    final androidLocal = _local
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >();
    for (final id in _voiceChannelIds) {
      await androidLocal?.createNotificationChannel(
        AndroidNotificationChannel(
          id,
          _voiceChannelName(id),
          description: _channelDescription,
          importance: Importance.high,
          playSound: true,
          sound: RawResourceAndroidNotificationSound(id),
        ),
      );
    }

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
    } catch (_) {
      /* optional */
    }
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
    // The spoken line the server chose, when this app has that channel.
    final voice = m.data["voice"];
    final voiced = voice is String && _voiceChannelIds.contains(voice);
    await _local.show(
      m.hashCode,
      title,
      body,
      NotificationDetails(
        android: voiced
            ? AndroidNotificationDetails(
                voice,
                _voiceChannelName(voice),
                channelDescription: _channelDescription,
                importance: Importance.high,
                priority: Priority.high,
                playSound: true,
                sound: RawResourceAndroidNotificationSound(voice),
              )
            : AndroidNotificationDetails(
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
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  void dispose() {
    _openRoute.close();
  }
}
