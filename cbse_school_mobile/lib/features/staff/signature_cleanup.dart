import "dart:math" as math;
import "dart:typed_data";

import "package:image/image.dart" as img;

/// What a signature photo becomes before it is sent (director, 15 Oct 2026:
/// teachers and the principal put their signature on their profile).
///
/// A photo of a signature on paper is mostly paper: grey-white, shadowed,
/// with the ink somewhere in the middle. Printed as-is on a report card it is
/// a grey box. So, on the phone, before anything is uploaded:
///   1. **trim** — crop to the ink, with a small margin;
///   2. **transparent** — paper becomes see-through; the ink keeps its own
///      colour (blue stays blue), its edges fading smoothly;
///   3. **size** — at most [maxWidth] px wide, a PNG of 10–80 KB.
/// Pure Dart (package:image), so it runs in a background isolate and in tests.
class SignatureCleanupException implements Exception {
  const SignatureCleanupException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Brightness 0–255 (Rec. 601 luma).
int _luma(num r, num g, num b) => (0.299 * r + 0.587 * g + 0.114 * b).round();

/// The cleaned signature as PNG bytes. Throws [SignatureCleanupException]
/// when the picture cannot be read or holds no ink.
Uint8List cleanSignaturePng(Uint8List input, {int maxWidth = 900}) {
  final decoded = img.decodeImage(input);
  if (decoded == null) {
    throw const SignatureCleanupException("This picture could not be read. Try a PNG or JPG photo.");
  }
  var src = img.bakeOrientation(decoded).convert(numChannels: 4);

  // Work on a copy no larger than ~2000 px: a 12 MP photo would be slow and
  // gains nothing for a signature.
  if (src.width > 2000 || src.height > 2000) {
    src = src.width >= src.height ? img.copyResize(src, width: 2000) : img.copyResize(src, height: 2000);
  }

  // The paper's own brightness: the 90th percentile of the picture, so a
  // shadow or a dim room does not count as ink.
  final hist = List<int>.filled(256, 0);
  for (final p in src) {
    if (p.a < 16) continue;
    hist[_luma(p.r, p.g, p.b).clamp(0, 255)]++;
  }
  final total = hist.fold<int>(0, (a, b) => a + b);
  if (total == 0) throw const SignatureCleanupException("The picture is empty.");
  var seen = 0;
  var paper = 255;
  for (var v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= total * 0.9) {
      paper = v;
      break;
    }
  }
  // Ink is clearly darker than the paper; between "ink" and "paper" the
  // alpha ramps, which keeps the strokes' edges smooth.
  final inkBelow = math.max(20, paper - 70);
  final paperAbove = math.max(inkBelow + 10, paper - 25);

  var minX = src.width, minY = src.height, maxX = -1, maxY = -1;
  for (final p in src) {
    if (p.a < 16) continue;
    if (_luma(p.r, p.g, p.b) <= inkBelow) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (maxX < 0) {
    throw const SignatureCleanupException(
      "No signature found in the picture. Sign in dark ink on white paper and try again.",
    );
  }
  final pad = math.max(6, ((maxX - minX) * 0.03).round());
  final x0 = math.max(0, minX - pad);
  final y0 = math.max(0, minY - pad);
  final x1 = math.min(src.width - 1, maxX + pad);
  final y1 = math.min(src.height - 1, maxY + pad);
  var out = img.copyCrop(src, x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1);

  for (final p in out) {
    final l = _luma(p.r, p.g, p.b);
    final double a;
    if (l <= inkBelow) {
      a = 255;
    } else if (l >= paperAbove) {
      a = 0;
    } else {
      a = 255 * (paperAbove - l) / (paperAbove - inkBelow);
    }
    p.a = math.min(p.a.toDouble(), a);
  }

  if (out.width > maxWidth) out = img.copyResize(out, width: maxWidth, interpolation: img.Interpolation.average);
  return Uint8List.fromList(img.encodePng(out, level: 6));
}
