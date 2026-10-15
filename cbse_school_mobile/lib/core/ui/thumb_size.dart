import "dart:math" as math;

import "package:flutter/widgets.dart";

/// data-layer 4.4: decode a gallery thumbnail at the size it is shown, not
/// at the camera's 4000 px — a carousel of full-size photos is what made the
/// gallery slow and memory-hungry on school phones.
///
/// [logicalWidth] is the widest the picture is drawn; [slack] covers a
/// BoxFit.cover box whose height, not width, binds (a landscape photo in a
/// square thumbnail). Capped at 2048 px.
int thumbCacheWidth(
  BuildContext context,
  double logicalWidth, {
  double slack = 1,
}) => thumbPixels(
  logicalWidth,
  MediaQuery.devicePixelRatioOf(context),
  slack: slack,
);

@visibleForTesting
int thumbPixels(double logicalWidth, double dpr, {double slack = 1}) =>
    math.min(2048, math.max(1, (logicalWidth * dpr * slack).round()));
