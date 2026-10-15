import "dart:async";

import "package:flutter/material.dart";

import "../api/api_client.dart";
import "../theme/app_theme.dart";

/// The running strip (director, 9 Oct 2026): published notices and news
/// scrolling across the top of the home screen, the way the web ERP shows
/// them. Pinned notices first. Tap it to open the notices list. Shows
/// nothing when there is nothing published — an empty strip is noise.
class RunningStrip extends StatefulWidget {
  const RunningStrip({super.key, required this.api, required this.onOpen});

  final ApiClient api;

  /// Opens the notices screen.
  final VoidCallback onOpen;

  @override
  State<RunningStrip> createState() => _RunningStripState();
}

/// The strip's ten-minute poll runs only while its screen is the one in
/// front and the app is in the foreground (data-layer 4.4).
@visibleForTesting
bool shouldPoll(ModalRoute<Object?>? route, AppLifecycleState? app) =>
    (route == null || route.isCurrent) &&
    (app == null || app == AppLifecycleState.resumed);

class _RunningStripState extends State<RunningStrip>
    with SingleTickerProviderStateMixin {
  List<CommsItem> _items = const [];
  // Made on first use; a strip that never showed anything has none to
  // dispose (creating one in dispose() looked up a deactivated ancestor).
  AnimationController? _animCtl;
  AnimationController get _anim =>
      _animCtl ??= AnimationController(vsync: this);
  final _textKey = GlobalKey();
  double _textWidth = 0;
  Timer? _refresh;

  ModalRoute<Object?>? _route;

  /// The server has answered; a saved copy read late never paints over it.
  bool _fresh = false;

  @override
  void initState() {
    super.initState();
    // Last session's strip at once (data-layer 4.4), then the server's.
    widget.api.cachedCommsFeed().then((c) {
      if (c != null && mounted && !_fresh) _show(c.value);
    });
    _load();
    // A notice published while the app is open appears within ten minutes —
    // but only while the home is the screen in front and the app is open;
    // a strip under a pushed screen or in the background asks nothing.
    _refresh = Timer.periodic(const Duration(minutes: 10), (_) {
      if (shouldPoll(_route, WidgetsBinding.instance.lifecycleState)) _load();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
  }

  @override
  void dispose() {
    _refresh?.cancel();
    _animCtl?.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final all = await widget.api.fetchCommsFeed();
      _fresh = true;
      if (!mounted) return;
      _show(all);
    } catch (_) {
      // The strip is extra; a failed load leaves it as it was (hidden, or
      // last session's notices).
    }
  }

  void _show(List<CommsItem> all) {
    // The same order the notices list opens in, so a tap on the strip
    // lands on the notice it led with, at the top, one tap from in full.
    final sorted = [...all]..sort(CommsItem.stripOrder);
    setState(() => _items = sorted.take(8).toList());
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  void _start() {
    final box = _textKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !mounted) return;
    _textWidth = box.size.width;
    // About 45 logical pixels a second — readable on a small phone.
    final seconds = ((_textWidth + 300) / 45).clamp(8, 120).round();
    _anim
      ..duration = Duration(seconds: seconds)
      ..repeat();
  }

  @override
  Widget build(BuildContext context) {
    if (_items.isEmpty) return const SizedBox.shrink();
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    final text = _items
        .map(
          (i) =>
              "${i.pinned ? "📌 " : ""}${i.isNews ? (hindi ? "समाचार: " : "News: ") : ""}${i.title}",
        )
        .join("     •     ");
    const style = TextStyle(
      color: AppColors.ink,
      fontSize: 13,
      fontWeight: FontWeight.w600,
    );
    return Semantics(
      button: true,
      label: (hindi ? "सूचनाएँ: " : "Notices: ") + text,
      child: InkWell(
        onTap: widget.onOpen,
        child: Container(
          height: 34,
          decoration: BoxDecoration(
            color: AppColors.accent.withValues(alpha: 0.14),
            border: Border(
              bottom: BorderSide(
                color: AppColors.accent.withValues(alpha: 0.45),
              ),
            ),
          ),
          child: Row(
            children: [
              Container(
                height: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                color: AppColors.primary,
                alignment: Alignment.center,
                child: Text(
                  hindi ? "📢 सूचना" : "📢 Notices",
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Expanded(
                child: ClipRect(
                  child: LayoutBuilder(
                    builder: (context, box) => AnimatedBuilder(
                      animation: _anim,
                      builder: (context, child) {
                        final travel = box.maxWidth + _textWidth;
                        final dx = box.maxWidth - _anim.value * travel;
                        return Transform.translate(
                          offset: Offset(dx, 0),
                          child: child,
                        );
                      },
                      child: OverflowBox(
                        alignment: Alignment.centerLeft,
                        maxWidth: double.infinity,
                        child: Text(
                          text,
                          key: _textKey,
                          style: style,
                          maxLines: 1,
                          softWrap: false,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
