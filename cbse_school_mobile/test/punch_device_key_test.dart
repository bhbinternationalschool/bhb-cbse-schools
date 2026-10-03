import 'dart:convert';
import 'dart:io';

import 'package:cbse_school_mobile/core/punch/punch_device_key.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('signs a punch message the way the server verifies (r||s, base64url)', () {
    final key = PunchDeviceKey.generate();
    final msg = PunchDeviceKey.message(staffId: 'stf_crbnoz8', kind: 'in', code: '482913', ts: 1791000000000);
    final sig = key.sign(msg);
    expect(base64Url.decode(base64Url.normalize(sig)).length, 64);
    expect(key.verify(msg, sig), isTrue);
    expect(key.verify('${msg}x', sig), isFalse, reason: 'a changed message must fail');
    final jwk = key.publicJwk;
    expect(jwk['kty'], 'EC');
    expect(jwk['crv'], 'P-256');
    expect(base64Url.decode(base64Url.normalize(jwk['x']!)).length, 32);
    // For the cross-check against WebCrypto (server side).
    final out = Platform.environment['PUNCH_SIG_OUT'];
    if (out != null) File(out).writeAsStringSync(jsonEncode({'jwk': jwk, 'msg': msg, 'sig': sig}));
  });

  test('the same private key gives the same public key', () {
    final a = PunchDeviceKey.generate();
    final d = BigInt.parse('1f3a', radix: 16);
    expect(PunchDeviceKey.fromPrivate(d).publicJwk, PunchDeviceKey.fromPrivate(d).publicJwk);
    expect(a.publicJwk, isNot(PunchDeviceKey.fromPrivate(d).publicJwk));
  });
}
