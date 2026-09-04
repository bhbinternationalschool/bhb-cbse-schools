import "package:flutter/material.dart";

import "../../core/theme/app_theme.dart";

/// Shared chrome for module screens: navy app bar, pull-to-refresh list,
/// one loading/error/empty pattern so every module behaves the same way.
class ModuleShell<T> extends StatefulWidget {
  const ModuleShell({
    super.key,
    required this.title,
    this.subtitle,
    required this.load,
    required this.builder,
    this.emptyIcon = Icons.inbox_outlined,
    this.emptyText = "Nothing here yet.",
    this.isEmpty,
    this.floatingActionButton,
    this.bottomBar,
  });

  final String title;
  final String? subtitle;
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;
  final IconData emptyIcon;
  final String emptyText;
  final bool Function(T data)? isEmpty;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload)?
      floatingActionButton;

  /// Sticky footer under the list — a pay button, say. Only shown once data
  /// has loaded and the screen is not in its empty state.
  final Widget Function(BuildContext context, T data, Future<void> Function() reload)?
      bottomBar;

  @override
  State<ModuleShell<T>> createState() => _ModuleShellState<T>();
}

class _ModuleShellState<T> extends State<ModuleShell<T>> {
  T? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final data = await widget.load();
      if (mounted) setState(() => _data = data);
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().isEmpty
            ? "Could not reach the school server."
            : e.toString());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return Scaffold(
      appBar: AppBar(
        title: widget.subtitle == null
            ? Text(widget.title, style: const TextStyle(fontSize: 16))
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.title, style: const TextStyle(fontSize: 16)),
                  Text(
                    widget.subtitle!,
                    style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFFB8C0D4),
                    ),
                  ),
                ],
              ),
      ),
      floatingActionButton: data == null
          ? null
          : widget.floatingActionButton?.call(context, data, _load),
      bottomNavigationBar: data == null || (widget.isEmpty?.call(data) ?? false)
          ? null
          : widget.bottomBar?.call(context, data, _load),
      body: data == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator(color: AppColors.primary)
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.cloud_off_outlined,
                              size: 40, color: AppColors.muted),
                          const SizedBox(height: 12),
                          Text(_error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: _load,
                            child: const Text("Retry"),
                          ),
                        ],
                      ),
                    ),
            )
          : (widget.isEmpty?.call(data) ?? false)
              ? RefreshIndicator(
                  onRefresh: _load,
                  color: AppColors.primary,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      SizedBox(
                        height: MediaQuery.sizeOf(context).height * 0.6,
                        child: Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(widget.emptyIcon,
                                  size: 44, color: AppColors.muted),
                              const SizedBox(height: 12),
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 32),
                                child: Text(
                                  widget.emptyText,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    color: AppColors.muted,
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  color: AppColors.primary,
                  child: widget.builder(context, data, _load),
                ),
    );
  }
}

/// Honest "not live yet" sheet for modules whose data the school has not
/// started capturing — never fake numbers, per the ERP's ground rules.
void showComingSoon(BuildContext context, String module, String reason) {
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.hourglass_empty, size: 36, color: AppColors.muted),
            const SizedBox(height: 12),
            Text(
              "$module is coming soon",
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              reason,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          ],
        ),
      ),
    ),
  );
}

String formatDateLabel(String isoDate) {
  final d = DateTime.tryParse(isoDate);
  if (d == null) return isoDate;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return "${d.day} ${months[d.month - 1]} ${d.year}";
}

String formatTimeLabel(String iso) {
  final d = DateTime.tryParse(iso);
  if (d == null) return "";
  final h12 = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final mm = d.minute.toString().padLeft(2, "0");
  return "$h12:$mm ${d.hour < 12 ? "AM" : "PM"}";
}
