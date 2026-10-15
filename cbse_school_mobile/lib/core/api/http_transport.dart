import "dart:async";

import "package:http/http.dart" as http;

/// data-layer 4.4: every ERP call goes through ONE long-lived `http.Client`
/// (so the phone keeps its TLS connection to the server alive between calls
/// instead of opening a new one for each), and every call has a deadline.
///
/// [TimeoutClient] is a thin view over that shared client: it bounds the
/// wait for the response headers AND every gap while the body streams in.
/// Several views with different deadlines share one inner client; closing a
/// view never closes the shared connection pool.
class TimeoutClient extends http.BaseClient {
  TimeoutClient(this.inner, this.timeout);

  /// The shared, long-lived client. Owned by whoever created it.
  final http.Client inner;

  /// How long to wait for the headers, and for each chunk of the body.
  final Duration timeout;

  /// The everyday deadline: a phone that has not heard back in 30 s gets an
  /// error it can show and retry, not a spinner forever.
  ///
  /// 30 s, not 15 s: a cold Cloud Run instance rebuilds the whole-school
  /// mirror before answering any /api/v1 route (14 Oct: homework/feed took
  /// 15.7 s once in 76 calls; principal/snapshot p95 6.2 s). Lower to 15 s
  /// once the Phase 4 `ensureSchoolMirrorHydrated` ratchet under
  /// app/api/v1 reaches 0.
  static const standard = Duration(seconds: 30);

  /// Calls where the server itself runs a model or sends to many families
  /// (command desk, lesson plan, syllabus scan, broadcasts).
  static const slow = Duration(seconds: 120);

  /// Photo / video / document uploads — the headers only come back after the
  /// whole file has gone up on a school-day mobile connection.
  static const upload = Duration(minutes: 5);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final res = await inner
        .send(request)
        .timeout(
          timeout,
          onTimeout: () => throw TimeoutException(
            "No reply from ${request.url.path} in ${timeout.inSeconds}s",
            timeout,
          ),
        );
    return http.StreamedResponse(
      _idleTimeout(res.stream, request.url.path),
      res.statusCode,
      contentLength: res.contentLength,
      request: res.request,
      headers: res.headers,
      isRedirect: res.isRedirect,
      persistentConnection: res.persistentConnection,
      reasonPhrase: res.reasonPhrase,
    );
  }

  /// The body, failing with a [TimeoutException] when no chunk arrives for
  /// [timeout]. A plain Timer per gap (not Stream.timeout), so it behaves
  /// the same under the test clock as on the phone.
  Stream<List<int>> _idleTimeout(Stream<List<int>> body, String path) {
    late StreamController<List<int>> out;
    StreamSubscription<List<int>>? sub;
    Timer? timer;
    var finished = false;
    void arm() {
      timer?.cancel();
      timer = Timer(timeout, () {
        finished = true;
        sub?.cancel();
        out.addError(
          TimeoutException(
            "Reply from $path stalled for ${timeout.inSeconds}s",
            timeout,
          ),
        );
        out.close();
      });
    }

    out = StreamController<List<int>>(
      onListen: () {
        arm();
        sub = body.listen(
          (chunk) {
            arm();
            out.add(chunk);
          },
          onError: (Object e, StackTrace st) {
            timer?.cancel();
            out.addError(e, st);
          },
          onDone: () {
            finished = true;
            timer?.cancel();
            out.close();
          },
          cancelOnError: false,
        );
      },
      onPause: () => sub?.pause(),
      onResume: () => sub?.resume(),
      onCancel: () {
        timer?.cancel();
        // A finished body has nothing to cancel; returning its cancel future
        // would only hold back the done event.
        return finished ? null : sub?.cancel();
      },
    );
    return out.stream;
  }

  /// A view never closes the shared client — the app holds it for its life.
  @override
  void close() {}
}
