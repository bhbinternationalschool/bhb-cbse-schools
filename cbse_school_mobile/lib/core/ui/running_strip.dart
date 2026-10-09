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

class _RunningStripState extends State<RunningStrip>
    with SingleTickerProviderStateMixin {
  List<CommsItem> _items = const [];
  late final AnimationController _anim = AnimationController(vsync: this);
  final _textKey = GlobalKey();
  double _textWidth = 0;
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    _load();
    // A notice published while the app is open appears within ten minutes.
    _refresh = Timer.periodic(const Duration(minutes: 10), (_) => _load());
  }

  @override
  void dispose() {
    _refresh?.cancel();
    _anim.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final all = await widget.api.fetchCommsFeed();
      final sorted = [...all]
        ..sort((a, b) {
          if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
          return b.publishedAt.compareTo(a.publishedAt);
        });
      if (!mounted) return;
      setState(() => _items = sorted.take(8).toList());
      WidgetsBinding.instance.addPostFrameCallback((_) => _start());
    } catch (_) {
      // The strip is extra; a failed load simply leaves it hidden.
    }
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
