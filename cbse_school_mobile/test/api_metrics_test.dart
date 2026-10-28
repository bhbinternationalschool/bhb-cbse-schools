// data-layer 1.2: the app reports how long its home-screen calls take to
// POST /api/client-metrics — every failure, one in five successes — without
// changing what the caller gets. Drives the real ApiClient through
// package:http's zone client (runWithClient), so the requests are real
// http.Request objects; nothing leaves the machine.
import "dart:convert";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/update/app_build.dart";
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

Future<void> _settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "signed.cookie",
    });
    AppBuild.flavor = "parent";
    AppBuild.build = 28;
  });
  tearDown(() {
    AppBuild.flavor = "";
    AppBuild.build = 0;
  });

  test(
    "a failed home call is always reported, with the app's build and session",
    () async {
      final seen = <http.Request>[];
      await http.runWithClient(
        () async {
          final api = ApiClient(_config);
          await expectLater(
            api.fetchParentSummary(),
            throwsA(isA<ApiException>()),
          );
          await _settle();
        },
        () => MockClient((req) async {
          seen.add(req);
          if (req.url.path == "/api/client-metrics") {
            return http.Response("", 204);
          }
          return http.Response('{"error":"boom"}', 503);
        }),
      );
      expect(seen.map((r) => r.url.path), [
        "/api/v1/parent/summary",
        "/api/client-metrics",
      ]);
      final metric = seen[1];
      expect(metric.method, "POST");
      expect(metric.headers["Cookie"], "bhb_demo_session=signed.cookie");
      expect(
        metric.headers["X-App-Build"],
        "28",
        reason: "the existing app header, reused",
      );
      final body = jsonDecode(metric.body) as Map<String, dynamic>;
      expect(body["event"], "query-error");
      expect(body["route"], "/api/v1/parent/summary");
      expect(body["platform"], "flutter");
      expect(body["build"], "parent-28");
      expect(body["ms"], isA<int>());
      expect(body["bytes"], 16);
    },
  );

  test(
    "a network failure is reported and the same error reaches the caller",
    () async {
      final seen = <String>[];
      await http.runWithClient(
        () async {
          final api = ApiClient(_config);
          await expectLater(
            api.fetchStaffSummary(),
            throwsA(isA<http.ClientException>()),
          );
          await _settle();
        },
        () => MockClient((req) async {
          seen.add(req.url.path);
          if (req.url.path == "/api/client-metrics") {
            return http.Response("", 204);
          }
          throw http.ClientException("offline");
        }),
      );
      expect(seen, ["/api/v1/staff/summary", "/api/client-metrics"]);
    },
  );

  test("successes are sampled about one in five; results unchanged", () async {
    var metrics = 0;
    var homeCalls = 0;
    await http.runWithClient(
      () async {
        final api = ApiClient(_config);
        for (var i = 0; i < 300; i++) {
          final s = await api.fetchParentSummary();
          expect(s, isNotNull);
        }
        await _settle();
      },
      () => MockClient((req) async {
        if (req.url.path == "/api/client-metrics") {
          metrics++;
          final b = jsonDecode(req.body) as Map<String, dynamic>;
          expect(b["event"], "query");
          return http.Response("", 204);
        }
        homeCalls++;
        return http.Response(
          jsonEncode({
            "data": {"children": [], "guardianName": "x"},
          }),
          200,
        );
      }),
    );
    expect(homeCalls, 300);
    expect(
      metrics,
      inInclusiveRange(25, 100),
      reason: "~60 of 300 expected; got $metrics",
    );
  });

  test("a call that is not a home-screen call is never reported", () async {
    final seen = <String>[];
    await http.runWithClient(
      () async {
        final api = ApiClient(_config);
        await expectLater(
          api.fetchSubjectRequests(),
          throwsA(isA<ApiException>()),
        );
        await _settle();
      },
      () => MockClient((req) async {
        seen.add(req.url.path);
        return http.Response("{}", 500);
      }),
    );
    expect(seen, ["/api/v1/staff/subject-requests"]);
  });

  test("a failed metric post never reaches the caller", () async {
    await http.runWithClient(
      () async {
        final api = ApiClient(_config);
        await expectLater(
          api.fetchParentSummary(),
          throwsA(isA<ApiException>()),
        );
        await _settle();
      },
      () => MockClient((req) async {
        if (req.url.path == "/api/client-metrics") {
          throw http.ClientException("metrics down");
        }
        return http.Response("{}", 500);
      }),
    );
  });
}
