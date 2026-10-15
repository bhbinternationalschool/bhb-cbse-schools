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

  /// The everyday deadline: a phone that has not heard back in 15 s gets an
  /// error it can show and retry, not a spinner forever.
  static const standard = Duration(seconds: 15);

  /// Calls where the server itself runs a model or sends to many families
  /// (command desk, lesson plan, syllabus scan, broadcasts).
  static const slow = Duration(seconds: 120);

  /// Photo / video / document uploads — the headers only come back after the
  /// whole file has gone up on a school-day mobile connection.
  static const upload = Duration(minutes: 5);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final res = await inner.send(request).timeout(
      timeout,
      onTimeout: () => throw TimeoutException(
        "No reply from ${request.url.path} in ${timeout.inSeconds}s",
        timeout,
      ),
    );
    return http.StreamedResponse(
      res.stream.timeout(
        timeout,
        onTimeout: (sink) {
          sink.addError(
            TimeoutException(
              "Reply from ${request.url.path} stalled for ${timeout.inSeconds}s",
              timeout,
            ),
          );
          sink.close();
        },
      ),
      res.statusCode,
      contentLength: res.contentLength,
      request: res.request,
      headers: res.headers,
      isRedirect: res.isRedirect,
      persistentConnection: res.persistentConnection,
      reasonPhrase: res.reasonPhrase,
    );
  }

  /// A view never closes the shared client — the app holds it for its life.
  @override
  void close() {}
}
