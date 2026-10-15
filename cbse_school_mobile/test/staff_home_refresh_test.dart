// data-layer 4.4 on a real staff home (TeacherHomeScreen): what it asks the
// server, when, and what it paints while the server is slow or away.
import "dart:async";
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/staff/teacher_home_screen.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:flutter_test/flutter_test.dart";
import "package:http/http.dart" as http;
import "package:http/testing.dart";

const _config = AppConfig(
  apiBaseUrl: "https://erp.example.invalid",
  tenantSlug: "t",
  schoolName: "s",
  supabaseUrl: "",
  supabaseAnonKey: "",
);

Widget _app(Widget child) => LocaleScope(
  controller: LocaleController(),
  child: MaterialApp(
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    home: child,
  ),
);

/// A school server stand-in: counts calls per path; [summary] decides how
/// the summary call answers.
class _Server {
  _Server({this.summary});

  final Future<http.Response> Function()? summary;
  final calls = <String, int>{};

  int n(String path) => calls[path] ?? 0;

  MockClient client() => MockClient((req) async {
    final p = req.url.path;
    calls[p] = n(p) + 1;
    if (p == "/api/v1/staff/summary") {
      return summary?.call() ??
          http.Response(
            jsonEncode({
              "data": {"fullName": "Asha Verma", "date": "2026-10-15"},
            }),
            200,
          );
    }
    if (p == "/api/v1/staff/features") {
      return http.Response('{"data":{"features":["homework"]}}', 200);
    }
    if (p == "/api/v1/staff/approvals") {
      return http.Response('{"data":{"total":0}}', 200);
    }
    if (p == "/api/v1/comms/feed" || p == "/api/v1/app/popups") {
      return http.Response('{"data":{}}', 200);
    }
    return http.Response("{}", 200);
  });
}

/// A cache that never touches the disk (memory only) — enough for a widget
/// test, where file IO does not run under the fake clock.
JsonCache _memoryCache() =>
    JsonCache(baseDir: () async => throw const FileSystemException("test"));

/// The app goes to the background and comes back, through the states a
/// phone really passes.
void _awayAndBack(WidgetTester tester) {
  for (final s in const [
    AppLifecycleState.inactive,
    AppLifecycleState.hidden,
    AppLifecycleState.paused,
    AppLifecycleState.hidden,
    AppLifecycleState.inactive,
    AppLifecycleState.resumed,
  ]) {
    tester.binding.handleAppLifecycleStateChanged(s);
  }
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "cookie-A",
    });
  });

  testWidgets("approvals are asked once when the home opens", (tester) async {
    final server = _Server();
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          TeacherHomeScreen(
            api: ApiClient(_config, cache: _memoryCache()),
            onLogout: () {},
          ),
        ),
      );
      await _settle(tester);
    }, server.client);
    expect(find.text("Asha Verma"), findsOneWidget);
    expect(server.n("/api/v1/staff/summary"), 1);
    expect(
      server.n("/api/v1/staff/approvals"),
      1,
      reason: "the summary arriving must not re-read the waiting counts",
    );
  });

  testWidgets(
    "back in front after 2 min re-reads summary and tiles; sooner, nothing",
    (tester) async {
      var now = DateTime(2026, 10, 15, 9);
      RefreshClock.debugNow = () => now;
      addTearDown(() => RefreshClock.debugNow = DateTime.now);
      final server = _Server();
      await http.runWithClient(() async {
        await tester.pumpWidget(
          _app(
            TeacherHomeScreen(
              api: ApiClient(_config, cache: _memoryCache()),
              onLogout: () {},
            ),
          ),
        );
        await _settle(tester);
        expect(server.n("/api/v1/staff/summary"), 1);
        expect(server.n("/api/v1/staff/features"), 1);

        now = now.add(const Duration(seconds: 90));
        _awayAndBack(tester);
        await _settle(tester);
        expect(server.n("/api/v1/staff/summary"), 1, reason: "90 s: fresh");

        now = now.add(const Duration(seconds: 31));
        _awayAndBack(tester);
        await _settle(tester);
      }, server.client);
      expect(server.n("/api/v1/staff/summary"), 2, reason: "2 min: re-read");
      expect(server.n("/api/v1/staff/features"), 2);
      expect(
        server.n("/api/v1/staff/approvals"),
        1,
        reason: "a resume does not re-read the waiting counts",
      );
    },
  );

  testWidgets("a cold open paints the saved home before the server answers", (
    tester,
  ) async {
    final cache = _memoryCache();
    // Yesterday's session saved Asha's home.
    await http.runWithClient(() async {
      await ApiClient(_config, cache: cache).fetchStaffSummary();
    }, _Server().client);

    final pending = Completer<http.Response>();
    final server = _Server(summary: () => pending.future);
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          TeacherHomeScreen(
            api: ApiClient(_config, cache: cache),
            onLogout: () {},
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 100));
      expect(
        find.text("Asha Verma"),
        findsOneWidget,
        reason: "painted within 200 ms while the server is still thinking",
      );
      expect(find.byType(CircularProgressIndicator), findsNothing);
      pending.complete(
        http.Response(
          jsonEncode({
            "data": {"fullName": "Asha V. Verma", "date": "2026-10-15"},
          }),
          200,
        ),
      );
      await _settle(tester);
    }, server.client);
    expect(find.text("Asha V. Verma"), findsOneWidget, reason: "then fresh");
    expect(find.textContaining("Couldn't reach the school"), findsNothing);
  });

  testWidgets(
    "server away: the saved home stays, labelled old — never an empty home",
    (tester) async {
      final cache = _memoryCache();
      await http.runWithClient(() async {
        await ApiClient(_config, cache: cache).fetchStaffSummary();
      }, _Server().client);

      final server = _Server(
        summary: () async => throw const SocketException("offline"),
      );
      await http.runWithClient(() async {
        await tester.pumpWidget(
          _app(
            TeacherHomeScreen(
              api: ApiClient(_config, cache: cache),
              onLogout: () {},
            ),
          ),
        );
        await _settle(tester);
      }, server.client);
      expect(find.text("Asha Verma"), findsOneWidget);
      expect(find.textContaining("Couldn't reach the school"), findsOneWidget);
      expect(find.text("Could not reach the school server."), findsNothing);
    },
  );

  testWidgets("nothing saved and server away: the error, with Retry", (
    tester,
  ) async {
    final server = _Server(
      summary: () async => throw const SocketException("offline"),
    );
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          TeacherHomeScreen(
            api: ApiClient(_config, cache: _memoryCache()),
            onLogout: () {},
          ),
        ),
      );
      await _settle(tester);
    }, server.client);
    expect(find.text("Could not reach the school server."), findsOneWidget);
  });

  testWidgets("another person's saved home is never painted", (tester) async {
    final cache = _memoryCache();
    await http.runWithClient(() async {
      await ApiClient(_config, cache: cache).fetchStaffSummary();
    }, _Server().client);
    // Bina signs in on the same phone (her session, not Asha's).
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "cookie-B",
    });
    final pending = Completer<http.Response>();
    await http.runWithClient(() async {
      await tester.pumpWidget(
        _app(
          TeacherHomeScreen(
            api: ApiClient(_config, cache: cache),
            onLogout: () {},
          ),
        ),
      );
      await _settle(tester);
      expect(find.text("Asha Verma"), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      pending.complete(http.Response("{}", 503));
      await _settle(tester);
    }, _Server(summary: () => pending.future).client);
  });
}
