import "package:flutter/material.dart";

/// Motion tokens. Every animated thing in the app picks one of these so the
/// whole product moves at the same tempo — nothing bespoke, nothing bouncy.
class AppMotion {
  static const fast = Duration(milliseconds: 160);
  static const base = Duration(milliseconds: 260);
  static const slow = Duration(milliseconds: 380);

  /// Entering elements decelerate into place; leaving ones simply fade.
  static const enter = Curves.easeOutCubic;
  static const exit = Curves.easeIn;

  /// How far an entering element travels, as a fraction of its own height.
  static const slideFraction = 0.04;
}

/// Screen-to-screen transition: the new page fades in while drifting up a
/// few pixels; the page underneath holds still. Registered on the theme, so
/// every MaterialPageRoute and go_router page gets it without opting in.
///
/// The reverse (pop) is the same in mirror — the outgoing page fades out
/// and settles back down — which keeps the back gesture feeling honest.
class FadeThroughPageTransitionsBuilder extends PageTransitionsBuilder {
  const FadeThroughPageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final curved = CurvedAnimation(
      parent: animation,
      curve: AppMotion.enter,
      reverseCurve: AppMotion.exit,
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, AppMotion.slideFraction),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }
}

/// Swap between states (loading → content, one child → another) with a
/// crossfade and a small upward drift instead of a hard layout swap. Give
/// each state a distinct [Key] on the child so the switcher knows it changed.
class AppCrossfade extends StatelessWidget {
  const AppCrossfade({
    super.key,
    required this.child,
    this.duration = AppMotion.base,
    this.alignment = Alignment.topCenter,
  });

  final Widget child;
  final Duration duration;
  final Alignment alignment;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: duration,
      switchInCurve: AppMotion.enter,
      switchOutCurve: AppMotion.exit,
      layoutBuilder: (current, previous) => Stack(
        alignment: alignment,
        children: [...previous, ?current],
      ),
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, AppMotion.slideFraction),
            end: Offset.zero,
          ).animate(animation),
          child: child,
        ),
      ),
      child: child,
    );
  }
}

/// Fade-and-rise a block into view the first time it is built, staggered by
/// [index] so a column of sections arrives top to bottom rather than all at
/// once. Runs once per widget lifetime; rebuilds do not replay it.
class EntranceReveal extends StatefulWidget {
  const EntranceReveal({
    super.key,
    required this.child,
    this.index = 0,
    this.stagger = const Duration(milliseconds: 55),
  });

  final Widget child;
  final int index;
  final Duration stagger;

  @override
  State<EntranceReveal> createState() => _EntranceRevealState();
}

class _EntranceRevealState extends State<EntranceReveal>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: AppMotion.slow,
  );
  late final Animation<double> _curve = CurvedAnimation(
    parent: _controller,
    curve: AppMotion.enter,
  );

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(widget.stagger * widget.index, () {
      if (mounted) _controller.forward();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _curve,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, AppMotion.slideFraction * 2),
          end: Offset.zero,
        ).animate(_curve),
        child: widget.child,
      ),
    );
  }
}
