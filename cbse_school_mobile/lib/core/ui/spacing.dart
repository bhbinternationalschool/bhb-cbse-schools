import "package:flutter/widgets.dart";

/// Spacing scale. Pick from here rather than typing numbers so gaps across
/// screens fall on one grid.
class Space {
  Space._();

  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const xxl = 28.0;
  static const xxxl = 36.0;
}

/// Padding guideline: content is set asymmetrically on purpose.
///
/// * The leading (left) edge is one step wider than the trailing edge. Text
///   reads from the left, and a slightly deeper left gutter keeps a page from
///   feeling boxed in while the right edge stays close to scroll affordances.
/// * The bottom of a page is always deeper than its top so the last card
///   never kisses the navigation bar or the home indicator.
/// * Inside a card, the top is tighter than the bottom for the same reason:
///   headings sit up, the body breathes below.
class Insets {
  Insets._();

  /// A scrolling page body under an app bar.
  static const page = EdgeInsets.fromLTRB(Space.xl, Space.lg, Space.lg, Space.xxxl);

  /// A page section that sits below a header block and needs no top inset.
  static const pageBelowHeader =
      EdgeInsets.fromLTRB(Space.xl, 0, Space.lg, Space.xxxl);

  /// A horizontal gutter with no vertical inset — rows inside a page.
  static const gutter = EdgeInsets.fromLTRB(Space.xl, 0, Space.lg, 0);

  /// The inside of a card.
  static const card = EdgeInsets.fromLTRB(Space.lg, Space.md, Space.md, Space.lg);

  /// A modal bottom sheet's content.
  static const sheet =
      EdgeInsets.fromLTRB(Space.xl, Space.xl, Space.lg, Space.xxl);

  /// A centred state (error, empty) that needs room on every side.
  static const state = EdgeInsets.fromLTRB(Space.xxl, Space.xl, Space.xxl, Space.xxxl);
}
