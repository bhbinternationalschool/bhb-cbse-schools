// data-layer 4.4: the saved copy of each home call — whose it is, when it is
// wiped, how a home paints it and what happens when the server is away.
import "dart:async";
import "dart:convert";
import "dart:io";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/ui/pop_with_changed.dart";
import "package:cbse_school_mobile/core/ui/running_strip.dart";
import "package:cbse_school_mobile/core/ui/stale_banner.dart";
import "package:cbse_school_mobile/core/ui/thumb_size.dart";
import "package:cbse_school_mobile/core/update/app_build.dart";
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

String _summaryBody(String name) => jsonEncode({
  "data": {"fullName": name, "date": "2026-10-15", "homeKind": "teaching"},
});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory tmp;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync("bhb_json_cache_test");
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "cookie-A",
    });
    AppBuild.flavor = "staff";
  });
  tearDown(() {
    AppBuild.flavor = "";
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  JsonCache newCache() => JsonCache(baseDir: () async => tmp);

  group("JsonCache", () {
    test("a copy belongs to one identity — another never reads it", () async {
      final c = newCache();
      await c.write("staff|A", "/api/v1/staff/summary", {"fullName": "Asha"});
      expect(
        (await c.read("staff|A", "/api/v1/staff/summary"))?.data["fullName"],
        "Asha",
      );
      expect(await c.read("staff|B", "/api/v1/staff/summary"), isNull);
      expect(await c.read("parent|A", "/api/v1/staff/summary"), isNull);
      // From the file too (a cold open: a new cache, empty memory).
      final cold = newCache();
      expect(
        (await cold.read("staff|A", "/api/v1/staff/summary"))?.data["fullName"],
        "Asha",
      );
      expect(await cold.read("staff|B", "/api/v1/staff/summary"), isNull);
      expect(await cold.read("", "/api/v1/staff/summary"), isNull);
    });

    test("wipe removes memory and every file", () async {
      final c = newCache();
      await c.write("staff|A", "/p", {"x": 1});
      await c.write("staff|B", "/p", {"x": 2});
      await c.wipe();
      expect(await c.read("staff|A", "/p"), isNull);
      expect(await newCache().read("staff|A", "/p"), isNull);
      expect(await newCache().read("staff|B", "/p"), isNull);
    });

    test("a file that names another owner is ignored", () async {
      final c = newCache();
      await c.write("staff|A", "/p", {"x": 1});
      final f = tmp
          .listSync(recursive: true)
          .whereType<File>()
          .firstWhere((f) => f.path.endsWith(".json"));
      final j = jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
      j["scope"] = JsonCache.hash("staff|B");
      f.writeAsStringSync(jsonEncode(j));
      expect(await newCache().read("staff|A", "/p"), isNull);
    });
  });

  group("ApiClient keeps the last good home reply per identity", () {
    test("a 200 is saved; the same identity reads it back parsed", () async {
      await http.runWithClient(
        () async {
          final api = ApiClient(_config, cache: newCache());
          expect(await api.cachedStaffSummary(), isNull);
          await api.fetchStaffSummary();
          final hit = await api.cachedStaffSummary();
          expect(hit?.value.fullName, "Asha");
          // Another teacher on the same phone sees nothing of Asha's.
          FlutterSecureStorage.setMockInitialValues({
            "bhb_session_cookie": "cookie-B",
          });
          expect(await api.cachedStaffSummary(), isNull);
        },
        () =>
            MockClient((req) async => http.Response(_summaryBody("Asha"), 200)),
      );
    });

    test("a reply that lands after the identity changed is not saved", () async {
      final reply = Completer<http.Response>();
      await http.runWithClient(() async {
        final api = ApiClient(_config, cache: newCache());
        final f = api.fetchStaffSummary();
        await Future<void>.delayed(const Duration(milliseconds: 20));
        // Asha signed out, Bina signed in, while Asha's summary was in flight.
        FlutterSecureStorage.setMockInitialValues({
          "bhb_session_cookie": "cookie-B",
        });
        reply.complete(http.Response(_summaryBody("Asha"), 200));
        await f;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(await api.cachedStaffSummary(), isNull, reason: "not Bina's");
        FlutterSecureStorage.setMockInitialValues({
          "bhb_session_cookie": "cookie-A",
        });
        expect(await api.cachedStaffSummary(), isNull, reason: "dropped");
      }, () => MockClient((req) => reply.future));
    });

    test("sign-out wipes every saved home", () async {
      await http.runWithClient(
        () async {
          final api = ApiClient(_config, cache: newCache());
          await api.fetchStaffSummary();
          expect(await api.cachedStaffSummary(), isNotNull);
          await api.signOut();
          FlutterSecureStorage.setMockInitialValues({
            "bhb_session_cookie": "cookie-A",
          });
          expect(await api.cachedStaffSummary(), isNull);
          expect(tmp.listSync(recursive: true).whereType<File>(), isEmpty);
        },
        () =>
            MockClient((req) async => http.Response(_summaryBody("Asha"), 200)),
      );
    });

    test("a new sign-in starts with no saved homes", () async {
      await http.runWithClient(
        () async {
          final api = ApiClient(_config, cache: newCache());
          await api.fetchStaffSummary();
          expect(await api.cachedStaffSummary(), isNotNull);
          await api.verifyStaffOtp("9876543210", "123456");
          expect(await api.cachedStaffSummary(), isNull);
        },
        () => MockClient((req) async {
          if (req.url.path == "/api/auth/staff-otp/verify") {
            return http.Response(
              jsonEncode({
                "session": {"fullName": "Asha"},
              }),
              200,
              headers: {"set-cookie": "bhb_demo_session=cookie-A; Path=/"},
            );
          }
          return http.Response(_summaryBody("Asha"), 200);
        }),
      );
    });

    test("a failed call saves nothing and leaves the last good copy", () async {
      var fail = false;
      await http.runWithClient(
        () async {
          final api = ApiClient(_config, cache: newCache());
          await api.fetchStaffSummary();
          fail = true;
          await expectLater(
            api.fetchStaffSummary(),
            throwsA(isA<ApiException>()),
          );
          expect((await api.cachedStaffSummary())?.value.fullName, "Asha");
        },
        () => MockClient((req) async {
          if (req.url.path == "/api/client-metrics") {
            return http.Response("{}", 200);
          }
          return fail
              ? http.Response('{"error":"down"}', 503)
              : http.Response(_summaryBody("Asha"), 200);
        }),
      );
    });
  });

  group("loadCachedThenFresh", () {
    final saved = DateTime(2026, 10, 15, 8, 5);

    test("paints the saved copy, then the server's answer", () async {
      final events = <String>[];
      final fresh = Completer<String>();
      final done = loadCachedThenFresh<String>(
        peek: () async => Cached("old", saved),
        fetch: () => fresh.future,
        onCached: (c) => events.add("cached:${c.value}"),
        onFresh: (v) => events.add("fresh:$v"),
        onError: (e, s) => events.add("error"),
      );
      await Future<void>.delayed(Duration.zero);
      expect(events, ["cached:old"], reason: "painted before the server");
      fresh.complete("new");
      await done;
      expect(events, ["cached:old", "fresh:new"]);
    });

    test("server down: keeps the copy and says when it was saved", () async {
      Object? err;
      DateTime? since;
      await loadCachedThenFresh<String>(
        peek: () async => Cached("old", saved),
        fetch: () async => throw const SocketException("offline"),
        onCached: (_) {},
        onFresh: (_) => fail("no fresh value"),
        onError: (e, s) {
          err = e;
          since = s;
        },
      );
      expect(err, isA<SocketException>());
      expect(since, saved);
    });

    test("no copy and server down: an error, never an empty home", () async {
      var painted = false;
      DateTime? since = DateTime(2000);
      var errored = false;
      await loadCachedThenFresh<String>(
        peek: () async => null,
        fetch: () async => throw TimeoutException("15 s"),
        onCached: (_) => painted = true,
        onFresh: (_) => painted = true,
        onError: (e, s) {
          errored = true;
          since = s;
        },
      );
      expect(painted, isFalse);
      expect(errored, isTrue);
      expect(since, isNull, reason: "nothing old on screen to label");
    });

    test("a fresh answer is never painted over by a slow saved copy", () async {
      final events = <String>[];
      final peek = Completer<Cached<String>?>();
      final done = loadCachedThenFresh<String>(
        peek: () => peek.future,
        fetch: () async => "new",
        onCached: (c) => events.add("cached"),
        onFresh: (v) => events.add("fresh:$v"),
        onError: (e, s) => events.add("error"),
      );
      await Future<void>.delayed(const Duration(milliseconds: 5));
      peek.complete(Cached("old", saved));
      await done;
      expect(events, ["fresh:new"]);
    });
  });

  group("resume refetch", () {
    test("RefreshClock: stale before the first answer and after 2 min", () {
      var now = DateTime(2026, 10, 15, 9);
      final clock = RefreshClock(now: () => now);
      expect(clock.isStale, isTrue);
      clock.markFresh();
      now = now.add(const Duration(minutes: 1, seconds: 59));
      expect(clock.isStale, isFalse, reason: "a quick switch asks nothing");
      now = now.add(const Duration(seconds: 1));
      expect(clock.isStale, isTrue, reason: "2 min away → re-read");
    });

    testWidgets("ResumeWatcher fires on resume only, until detached", (
      tester,
    ) async {
      var n = 0;
      final w = ResumeWatcher(() => n += 1)..attach();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      expect(n, 0);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      expect(n, 1);
      w.detach();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      expect(n, 1);
    });
  });

  group("small pieces", () {
    test("the strip polls only in front and in the foreground", () {
      expect(shouldPoll(null, AppLifecycleState.resumed), isTrue);
      expect(shouldPoll(null, AppLifecycleState.paused), isFalse);
      expect(shouldPoll(null, AppLifecycleState.hidden), isFalse);
    });

    testWidgets("…and not while another screen is pushed over it", (
      tester,
    ) async {
      final nav = GlobalKey<NavigatorState>();
      late BuildContext homeCtx;
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: nav,
          home: Builder(
            builder: (ctx) {
              homeCtx = ctx;
              return const SizedBox();
            },
          ),
        ),
      );
      final route = ModalRoute.of(homeCtx);
      expect(shouldPoll(route, AppLifecycleState.resumed), isTrue);
      nav.currentState!.push(
        MaterialPageRoute<void>(builder: (_) => const SizedBox()),
      );
      await tester.pumpAndSettle();
      expect(shouldPoll(route, AppLifecycleState.resumed), isFalse);
      nav.currentState!.pop();
      await tester.pumpAndSettle();
      expect(shouldPoll(route, AppLifecycleState.resumed), isTrue);
    });

    testWidgets("a decision screen closes with true only after a decision", (
      tester,
    ) async {
      final nav = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(navigatorKey: nav, home: const SizedBox()),
      );
      var decided = false;
      Future<Object?> open() => nav.currentState!.push<Object?>(
        MaterialPageRoute(
          builder: (_) => PopWithChanged(
            changed: () => decided,
            child: Scaffold(appBar: AppBar(title: const Text("Leave"))),
          ),
        ),
      );
      var result = open();
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(await result, false);
      decided = true;
      result = open();
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(await result, true);
    });

    test("stale label names the time (and the day when not today)", () {
      final now = DateTime(2026, 10, 15, 10);
      expect(
        StaleBanner.label(DateTime(2026, 10, 15, 8, 5), now, hindi: false),
        "Couldn't reach the school — showing what was saved at 08:05",
      );
      expect(
        StaleBanner.label(DateTime(2026, 10, 14, 18, 30), now, hindi: true),
        contains("14/10 18:30"),
      );
    });

    test("thumbnails decode at the size shown", () {
      expect(thumbPixels(48, 3, slack: 2), 288);
      expect(thumbPixels(400, 2.625), 1050);
      expect(thumbPixels(2000, 3), 2048, reason: "capped");
    });
  });
}
