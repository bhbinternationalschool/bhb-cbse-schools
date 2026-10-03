import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:pointycastle/export.dart';

/// This phone's punch key — the app's twin of the ERP website's
/// lib/punchClient.ts.
///
/// Since 30 Sep 2026 a staff punch needs the office screen's code AND a
/// signature by the phone's registered key, so one phone can never punch
/// for two people (the server keeps the public half; the first punch
/// registers it, any other phone waits for the office).
///
/// The private key is a P-256 scalar kept in the platform's secure storage
/// (Android Keystore-backed / iOS Keychain) and never leaves the phone. A
/// signature is ECDSA P-256 over SHA-256, in the 64-byte r‖s form WebCrypto
/// produces and the server verifies (verifyPunchSignature).
class PunchDeviceKey {
  PunchDeviceKey._(this._private, this._public);

  static const _storageKey = 'bhb_punch_device_key_d';
  static final _curve = ECCurve_secp256r1();

  final ECPrivateKey _private;
  final ECPublicKey _public;

  /// The key kept on this phone, made on first use.
  static Future<PunchDeviceKey> load({FlutterSecureStorage? storage}) async {
    final store = storage ?? const FlutterSecureStorage();
    final saved = await store.read(key: _storageKey);
    if (saved != null && saved.isNotEmpty) {
      final d = BigInt.parse(saved, radix: 16);
      return PunchDeviceKey.fromPrivate(d);
    }
    final key = PunchDeviceKey.generate();
    await store.write(key: _storageKey, value: key._private.d!.toRadixString(16));
    return key;
  }

  factory PunchDeviceKey.fromPrivate(BigInt d) {
    final q = _curve.G * d;
    return PunchDeviceKey._(ECPrivateKey(d, _curve), ECPublicKey(q, _curve));
  }

  factory PunchDeviceKey.generate() {
    final gen = ECKeyGenerator()
      ..init(ParametersWithRandom(ECKeyGeneratorParameters(_curve), _secureRandom()));
    final pair = gen.generateKeyPair();
    return PunchDeviceKey._(pair.privateKey, pair.publicKey);
  }

  /// The public half as the JWK the server stores: {kty, crv, x, y}.
  Map<String, String> get publicJwk => {
        'kty': 'EC',
        'crv': 'P-256',
        'x': _b64url(_fixed32(_public.Q!.x!.toBigInteger()!)),
        'y': _b64url(_fixed32(_public.Q!.y!.toBigInteger()!)),
      };

  /// The exact text the server re-builds and verifies (punchMessage).
  static String message({
    required String staffId,
    required String kind,
    required String code,
    required int ts,
  }) =>
      'punch|$staffId|$kind|$code|$ts';

  /// ECDSA P-256 / SHA-256 signature, r‖s (64 bytes), base64url.
  String sign(String message) {
    final signer = Signer('SHA-256/ECDSA')
      ..init(
        true,
        ParametersWithRandom(PrivateKeyParameter<ECPrivateKey>(_private), _secureRandom()),
      );
    var sig = signer.generateSignature(Uint8List.fromList(utf8.encode(message))) as ECSignature;
    // Low-s form, as WebCrypto verifies either but some verifiers insist.
    final n = _curve.n;
    if (sig.s > (n >> 1)) sig = ECSignature(sig.r, n - sig.s);
    final out = Uint8List(64)
      ..setRange(0, 32, _fixed32(sig.r))
      ..setRange(32, 64, _fixed32(sig.s));
    return _b64url(out);
  }

  /// Verify with the public half — for tests and self-checks.
  bool verify(String message, String signatureB64url) {
    final raw = base64Url.decode(base64Url.normalize(signatureB64url));
    if (raw.length != 64) return false;
    final r = _toBigInt(raw.sublist(0, 32));
    final s = _toBigInt(raw.sublist(32));
    final verifier = Signer('SHA-256/ECDSA')..init(false, PublicKeyParameter<ECPublicKey>(_public));
    return verifier.verifySignature(Uint8List.fromList(utf8.encode(message)), ECSignature(r, s));
  }

  static SecureRandom _secureRandom() {
    final seed = Random.secure();
    return FortunaRandom()..seed(KeyParameter(Uint8List.fromList(List<int>.generate(32, (_) => seed.nextInt(256)))));
  }

  static Uint8List _fixed32(BigInt v) {
    final out = Uint8List(32);
    var x = v;
    for (var i = 31; i >= 0; i--) {
      out[i] = (x & BigInt.from(0xff)).toInt();
      x = x >> 8;
    }
    return out;
  }

  static BigInt _toBigInt(List<int> bytes) =>
      bytes.fold(BigInt.zero, (acc, b) => (acc << 8) | BigInt.from(b));

  static String _b64url(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');
}
