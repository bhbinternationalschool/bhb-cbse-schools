import "../api/api_client.dart";

/// Broadcasts tapped in a notification, waiting for the home to open them.
///
/// A broadcast is not saved as a notice on the ERP, so the full text only
/// exists in the push's data (`kind: "broadcast"`, `fullText`, `sender`).
/// The push service parks it here and hands the home a route
/// `/notices?broadcast=<key>`; the home takes it back out and opens the
/// full message instead of the notices list (director, 13 Oct 2026: "full
/// notice is not opening").
class BroadcastInbox {
  BroadcastInbox._();

  static final _items = <String, CommsItem>{};
  static int _next = 0;

  /// The route for a push's data, parking a broadcast when it is one.
  /// Null when the data names no in-app route.
  static String? routeFor(Map<String, dynamic> data) {
    final url = data["url"];
    if (url is! String || !url.startsWith("/")) return null;
    final full = data["fullText"];
    if (data["kind"] != "broadcast" || full is! String || full.trim().isEmpty) {
      return url;
    }
    final key = "b${_next++}";
    // A handful at most — keep memory bounded if taps never get consumed.
    if (_items.length > 20) _items.remove(_items.keys.first);
    _items[key] = CommsItem(
      title: "${data["title"] ?? ""}".trim().isNotEmpty
          ? "${data["title"]}"
          : "${data["sender"] ?? ""}",
      body: full,
      publishedAt: DateTime.now().toIso8601String(),
      pinned: false,
      isNews: false,
      summary: "",
      sender: "${data["sender"] ?? ""}",
    );
    final uri = Uri.parse(url);
    return uri
        .replace(queryParameters: {...uri.queryParameters, "broadcast": key})
        .toString();
  }

  /// The parked broadcast a route names, removed once taken.
  static CommsItem? take(Uri uri) {
    final key = uri.queryParameters["broadcast"];
    if (key == null) return null;
    return _items.remove(key);
  }
}
