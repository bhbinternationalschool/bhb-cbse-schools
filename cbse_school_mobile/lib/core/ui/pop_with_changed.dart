import "package:flutter/widgets.dart";

/// data-layer 4.4: a screen where staff decide things (leave, complaints,
/// documents) closes with `true` when a decision was made there, so the home
/// re-reads its "Waiting for you" counts only then — not after every visit.
class PopWithChanged extends StatelessWidget {
  const PopWithChanged({super.key, required this.changed, required this.child});

  /// Read at the moment the screen closes.
  final bool Function() changed;
  final Widget child;

  @override
  Widget build(BuildContext context) => PopScope<Object?>(
    canPop: false,
    onPopInvokedWithResult: (didPop, _) {
      if (didPop) return;
      Navigator.of(context).pop(changed());
    },
    child: child,
  );
}
