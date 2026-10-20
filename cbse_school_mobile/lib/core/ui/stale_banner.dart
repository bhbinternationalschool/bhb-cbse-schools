import "package:flutter/material.dart";

import "../theme/app_theme.dart";

/// data-layer 4.4: the home could not reach the school server, so it is
/// showing the copy saved at [since]. Says so plainly — an old copy is never
/// passed off as today's, and never replaced by an empty "nothing here".
/// Nothing at all when [since] is null.
class StaleBanner extends StatelessWidget {
  const StaleBanner({
    super.key,
    required this.since,
    required this.onRetry,
    this.bottomGap = 0,
  });

  final DateTime? since;
  final VoidCallback onRetry;

  /// Room below for a card the screen pulls up over the header (the teacher
  /// home's attendance banner sits 20 px higher than its slot).
  final double bottomGap;

  static String label(DateTime since, DateTime now, {required bool hindi}) {
    final hh = since.hour.toString().padLeft(2, "0");
    final mm = since.minute.toString().padLeft(2, "0");
    final sameDay =
        since.year == now.year &&
        since.month == now.month &&
        since.day == now.day;
    final when = sameDay
        ? "$hh:$mm"
        : "${since.day.toString().padLeft(2, "0")}/${since.month.toString().padLeft(2, "0")} $hh:$mm";
    return hindi
        ? "सर्वर से संपर्क नहीं हुआ — $when की सहेजी जानकारी दिख रही है"
        : "Couldn't reach the school — showing what was saved at $when";
  }

  @override
  Widget build(BuildContext context) {
    final at = since;
    if (at == null) return const SizedBox.shrink();
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 12, 16, bottomGap),
      child: Material(
        color: ModuleTone.amber.background,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onRetry,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
            child: Row(
              children: [
                Icon(
                  Icons.cloud_off_outlined,
                  size: 18,
                  color: ModuleTone.amber.foreground,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label(at, DateTime.now(), hindi: hindi),
                    style: AppText.bodySmall.copyWith(
                      color: ModuleTone.amber.foreground,
                    ),
                  ),
                ),
                Text(
                  hindi ? "फिर कोशिश" : "Retry",
                  style: AppText.bodySmall.copyWith(
                    color: ModuleTone.amber.foreground,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
