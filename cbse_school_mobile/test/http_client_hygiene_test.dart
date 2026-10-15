// data-layer 4.4: the app's calls share ONE long-lived http.Client (one
// kept-alive connection, not a TLS handshake per call) and every call has a
// deadline — 15 s, longer only where the server runs a model.
//
// These tests use only API that existed before 4.4 (ApiClient(config) and its
// fetch methods), so they run unchanged against the old code — where they
// fail: old code built a new client per call and waited forever.
import "dart:async";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/api/http_transport.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
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

class _Outcome {
  bool done = false;
  Object? error;
}

_Outcome _watch(Future<Object?> f) {
  final o = _Outcome();
  f.then<void>(
    (_) => o.done = true,
    onError: (Object e) {
      o.error = e;
      o.done = true;
    },
  );
  return o;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "signed.cookie",
    });
  });

  test("five calls in a row go through one client, created once", () async {
    var created = 0;
    final paths = <String>[];
    await http.runWithClient(
      () async {
        final api = ApiClient(_config);
        await api.fetchStaffSummary();
        await api.fetchStaffFeatures();
        await api.fetchApprovals();
        await api.fetchCommsFeed();
        await api.postSubjectRequest({"action": "withdraw", "id": "x"});
      },
      () {
        created += 1;
        return MockClient((req) async {
          paths.add(req.url.path);
          return http.Response('{"data":{}}', 200);
        });
      },
    );
    expect(
      paths.where((p) => p != "/api/client-metrics").length,
      5,
      reason: "every call reached the server",
    );
    expect(created, 1, reason: "one long-lived client for the app's life");
  });

  testWidgets("a home call with no reply gives up after 15 s", (tester) async {
    late _Outcome o;
    await http.runWithClient(
      () async => o = _watch(ApiClient(_config).fetchStaffSummary()),
      () => MockClient((req) => Completer<http.Response>().future),
    );
    await tester.pump(const Duration(seconds: 14));
    expect(o.done, isFalse, reason: "still waiting at 14 s");
    await tester.pump(const Duration(seconds: 2));
    expect(o.done, isTrue, reason: "not waiting forever");
    expect(o.error, isA<TimeoutException>());
    // The failure report (1.2 client-metrics) has its own deadline.
    await tester.pump(const Duration(seconds: 30));
  });

  test("a body that stalls half-way also gives up (TimeoutClient)", () async {
    // Real time with a short deadline: FakeAsync does not drive
    // Stream.timeout's timer, so the body deadline is proven on the client
    // the app wraps every call in, with the same code path.
    final c = TimeoutClient(
      MockClient.streaming((req, body) async {
        final ctl = StreamController<List<int>>();
        ctl.add('{"data":'.codeUnits); // …and nothing more
        return http.StreamedResponse(ctl.stream, 200);
      }),
      const Duration(milliseconds: 200),
    );
    final watch = Stopwatch()..start();
    await expectLater(
      c.get(Uri.parse("https://erp.example.invalid/api/v1/staff/features")),
      throwsA(isA<TimeoutException>()),
    );
    expect(watch.elapsedMilliseconds, lessThan(2000));
    expect(TimeoutClient.standard, const Duration(seconds: 15));
  });

  testWidgets("the command desk (server runs a model) gets 120 s, not 15 s", (
    tester,
  ) async {
    late _Outcome o;
    await http.runWithClient(
      () async => o = _watch(
        ApiClient(_config).runStaffCommand("5A me aaj kaun absent hai"),
      ),
      () => MockClient((req) => Completer<http.Response>().future),
    );
    await tester.pump(const Duration(seconds: 60));
    expect(o.done, isFalse, reason: "a model may take a minute");
    await tester.pump(const Duration(seconds: 61));
    expect(o.done, isTrue, reason: "not waiting forever");
    expect(o.error, isA<TimeoutException>());
    // The failure report (1.2 client-metrics) has its own deadline.
    await tester.pump(const Duration(seconds: 30));
  });
}
