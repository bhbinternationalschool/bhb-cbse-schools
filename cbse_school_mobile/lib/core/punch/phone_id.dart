import "dart:convert";
import "dart:io" show Platform;

import "package:flutter/services.dart";
import "package:pointycastle/digests/sha256.dart";

/// A stable, private id for this phone — the same after the app is
/// reinstalled, so the punch phone check does not ask the office to approve
/// the same phone again (director, 10 Oct 2026).
///
/// SHA-256 of the Android ID (which is per phone, per app-signing key) with
/// a fixed prefix: the server can compare it, but never sees the raw id.
/// "" on iPhone or when the phone will not say.
class PhoneId {
  PhoneId._();

  static const _channel = MethodChannel("bhb/device");
  static String? _cached;

  static Future<String> get() async {
    if (_cached != null) return _cached!;
    var out = "";
    if (Platform.isAndroid) {
      try {
        final raw = await _channel.invokeMethod<String>("androidId") ?? "";
        if (raw.isNotEmpty) {
          final digest = SHA256Digest().process(
            Uint8List.fromList(utf8.encode("bhb-punch:$raw")),
          );
          out = digest.map((b) => b.toRadixString(16).padLeft(2, "0")).join();
        }
      } catch (_) {
        out = "";
      }
    }
    _cached = out;
    return out;
  }
}
