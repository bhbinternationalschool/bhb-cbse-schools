import "dart:convert";
import "dart:io";
import "dart:typed_data";

import "package:path_provider/path_provider.dart";
import "package:pointycastle/digests/sha256.dart";

/// One saved reply: the `data` of a home call and when it arrived.
class CachedJson {
  const CachedJson(this.data, this.savedAt);

  final Map<String, dynamic> data;
  final DateTime savedAt;
}

/// A value read from [JsonCache], parsed for the screen.
class Cached<T> {
  const Cached(this.value, this.savedAt);

  final T value;
  final DateTime savedAt;
}

/// data-layer 4.4: the last good reply of each home call, so a home screen
/// paints what it showed last time the moment it opens and refreshes behind
/// it.
///
/// Every entry belongs to ONE signed-in identity + app flavour (the [scope]
/// the caller passes — a hash of the session and the flavour). A read under
/// another scope never sees it, a reply that arrives after the identity
/// changed is never written, and [wipe] (sign-in / sign-out) deletes every
/// file. A family's or a teacher's data is never painted for somebody else.
///
/// Memory first, then one small JSON file per (scope, path) in the app's
/// private support directory. Any error reading or writing is a miss — the
/// cache is only ever a head start, never the truth.
class JsonCache {
  JsonCache({Future<Directory> Function()? baseDir})
    : _baseDir = baseDir ?? getApplicationSupportDirectory;

  final Future<Directory> Function() _baseDir;
  final _memory = <String, CachedJson>{};

  /// Bumped by [wipe]: a write started before a wipe is dropped.
  int _generation = 0;

  static String hash(String s) {
    final out = SHA256Digest().process(Uint8List.fromList(utf8.encode(s)));
    final b = StringBuffer();
    for (final x in out) {
      b.write(x.toRadixString(16).padLeft(2, "0"));
    }
    return b.toString();
  }

  Future<Directory> _dir() async =>
      Directory("${(await _baseDir()).path}/bhb_json_cache");

  String _key(String scope, String path) => hash("$scope\n$path");

  /// The last reply saved for [path] under [scope]; null when there is none
  /// (or [scope] is empty — no signed-in identity, nothing to show).
  Future<CachedJson?> read(String scope, String path) async {
    if (scope.isEmpty) return null;
    final key = _key(scope, path);
    final hit = _memory[key];
    if (hit != null) return hit;
    try {
      final f = File("${(await _dir()).path}/$key.json");
      if (!await f.exists()) return null;
      final j = jsonDecode(await f.readAsString());
      if (j is! Map<String, dynamic>) return null;
      // The file names its owner; a file of anyone else is not ours to show.
      if (j["scope"] != hash(scope) || j["path"] != path) return null;
      final data = j["data"];
      final at = j["savedAt"];
      if (data is! Map<String, dynamic> || at is! int) return null;
      final entry = CachedJson(data, DateTime.fromMillisecondsSinceEpoch(at));
      _memory[key] = entry;
      return entry;
    } catch (_) {
      return null;
    }
  }

  /// Save [data] as the last good reply for [path] under [scope].
  Future<void> write(
    String scope,
    String path,
    Map<String, dynamic> data, {
    DateTime? at,
  }) async {
    if (scope.isEmpty) return;
    final gen = _generation;
    final key = _key(scope, path);
    final entry = CachedJson(data, at ?? DateTime.now());
    _memory[key] = entry;
    try {
      final dir = await _dir();
      if (gen != _generation) return;
      await dir.create(recursive: true);
      final tmp = File("${dir.path}/$key.json.tmp");
      await tmp.writeAsString(
        jsonEncode({
          "scope": hash(scope),
          "path": path,
          "savedAt": entry.savedAt.millisecondsSinceEpoch,
          "data": data,
        }),
        flush: true,
      );
      if (gen != _generation) {
        await tmp.delete();
        return;
      }
      await tmp.rename("${dir.path}/$key.json");
    } catch (_) {
      /* a failed save is a miss next time, nothing more */
    }
  }

  /// Forget everything — memory and every file, for every identity.
  Future<void> wipe() async {
    _generation += 1;
    _memory.clear();
    try {
      final dir = await _dir();
      if (await dir.exists()) await dir.delete(recursive: true);
    } catch (_) {
      /* nothing on disk, or nothing we can do */
    }
  }
}
