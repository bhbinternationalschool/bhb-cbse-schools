/// Staff presence background service.
///
/// Runs as an Android foreground service (persistent "Sharing location with
/// school" notification) so pings continue with the app closed and the
/// screen off. Every tick it reads the school's config (interval + timing
/// window) straight from the ERP, takes one GPS fix and POSTs it to
/// /api/staff-geo/ping with the staff session cookie. Outside school timing
/// it idles (no fix taken — location is not read at all off-hours) and on a
/// 401/403 (logged out) it stops itself.
///
/// iOS: best effort — the service runs while the app is foregrounded or
/// briefly backgrounded; Android is the first-class platform for staff.
library;

import "dart:async";
import "dart:convert";

import "package:flutter_background_service/flutter_background_service.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:geolocator/geolocator.dart";
import "package:http/http.dart" as http;

const _cookieName = "bhb_demo_session";
const _cookieKey = "bhb_session_cookie";
const _baseUrlKey = "bhb_presence_base_url";
const presenceNotificationChannelId = "bhb_presence";

class PresenceConfig {
  const PresenceConfig({required this.enabled, required this.tracking, required this.pingIntervalMin, required this.window});
  final bool enabled;
  final bool tracking;
  final int pingIntervalMin;
  final String window;
}

Future<void> initPresenceService() async {
  final service = FlutterBackgroundService();
  await service.configure(
    androidConfiguration: AndroidConfiguration(
      onStart: presenceServiceEntry,
      autoStart: false,
      isForegroundMode: true,
      autoStartOnBoot: true,
      notificationChannelId: presenceNotificationChannelId,
      initialNotificationTitle: "School presence",
      initialNotificationContent: "Sharing location with school during school hours",
      foregroundServiceNotificationId: 8123,
      foregroundServiceTypes: [AndroidForegroundType.location],
    ),
    iosConfiguration: IosConfiguration(autoStart: false, onForeground: presenceServiceEntry),
  );
}

Future<void> startPresenceService(String baseUrl) async {
  const storage = FlutterSecureStorage();
  await storage.write(key: _baseUrlKey, value: baseUrl);
  final service = FlutterBackgroundService();
  if (!await service.isRunning()) await service.startService();
}

Future<void> stopPresenceService() async {
  final service = FlutterBackgroundService();
  if (await service.isRunning()) service.invoke("stop");
}

Future<bool> presenceServiceRunning() => FlutterBackgroundService().isRunning();

@pragma("vm:entry-point")
Future<void> presenceServiceEntry(ServiceInstance service) async {
  service.on("stop").listen((_) async {
    await service.stopSelf();
  });

  const storage = FlutterSecureStorage();
  Timer? timer;
  var intervalMin = 5;

  Future<void> tick() async {
    final baseUrl = await storage.read(key: _baseUrlKey) ?? "https://bhbinternational.school";
    final cookie = await storage.read(key: _cookieKey);
    if (cookie == null || cookie.isEmpty) {
      await service.stopSelf();
      return;
    }
    // 1. Config — cheap GET, tells us the interval and whether we are inside
    //    school timing. Off-hours: do not touch the GPS at all.
    var tracking = true;
    try {
      final cfg = await http.get(Uri.parse("$baseUrl/api/staff-geo/ping")).timeout(const Duration(seconds: 15));
      if (cfg.statusCode == 200) {
        final j = jsonDecode(cfg.body) as Map<String, dynamic>;
        if (j["enabled"] == false) {
          _setNotification(service, "School presence", "Tracking is switched off by the school");
          return;
        }
        tracking = j["tracking"] == true;
        final m = (j["pingIntervalMin"] as num?)?.toInt();
        if (m != null && m >= 2 && m <= 30 && m != intervalMin) {
          intervalMin = m;
          timer?.cancel();
          timer = Timer.periodic(Duration(minutes: intervalMin), (_) => tick());
        }
        if (!tracking) {
          _setNotification(service, "School presence", "Outside school timing (${j["window"] ?? ""}) — location not read");
          return;
        }
      }
    } catch (_) {
      // Network blip — try the ping anyway; the fix below may still queue.
    }

    // 2. One GPS fix.
    Position pos;
    try {
      pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 25)),
      );
    } catch (_) {
      _setNotification(service, "School presence", "Waiting for GPS…");
      return;
    }

    // 3. Ping the ERP.
    try {
      final res = await http
          .post(
            Uri.parse("$baseUrl/api/staff-geo/ping"),
            headers: {"Content-Type": "application/json", "Cookie": "$_cookieName=$cookie"},
            body: jsonEncode({
              "lat": pos.latitude,
              "lng": pos.longitude,
              "accuracyM": pos.accuracy.round(),
              "mocked": pos.isMocked,
              "device": "flutter-bg",
            }),
          )
          .timeout(const Duration(seconds: 20));
      if (res.statusCode == 401 || res.statusCode == 403) {
        await service.stopSelf();
        return;
      }
      if (res.statusCode == 428) {
        _setNotification(service, "School presence", "Open the app once to give consent");
        return;
      }
      if (res.statusCode == 400) {
        final j = jsonDecode(res.body) as Map<String, dynamic>;
        final err = (j["error"] as String?) ?? "Ping rejected";
        _setNotification(service, "School presence — problem", err.length > 90 ? "${err.substring(0, 90)}…" : err);
        return;
      }
      final j = jsonDecode(res.body) as Map<String, dynamic>;
      final inside = j["inside"] == true;
      final dist = (j["distanceM"] as num?)?.toInt();
      final at = TimeOfDayLabel.now();
      _setNotification(
        service,
        "School presence — sharing",
        inside ? "On premises · last sent $at" : "${dist ?? "?"} m from campus · last sent $at",
      );
    } catch (_) {
      _setNotification(service, "School presence", "No network — will retry");
    }
  }

  timer = Timer.periodic(Duration(minutes: intervalMin), (_) => tick());
  await tick();
}

void _setNotification(ServiceInstance service, String title, String content) {
  if (service is AndroidServiceInstance) {
    service.setForegroundNotificationInfo(title: title, content: content);
  }
}

class TimeOfDayLabel {
  static String now() {
    final ist = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
    final h = ist.hour.toString().padLeft(2, "0");
    final m = ist.minute.toString().padLeft(2, "0");
    return "$h:$m IST";
  }
}
