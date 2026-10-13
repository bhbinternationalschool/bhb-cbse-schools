import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/push/broadcast_inbox.dart";
import "../../core/theme/app_theme.dart";
import "../../core/i18n/locale_controller.dart";
import "module_shell.dart";
import "notices_screen.dart";

/// One notice, news item or broadcast in full — title, date, pinned badge,
/// the whole body (selectable, never cut) and a news cover when there is one.
/// Director, 13 Oct 2026: "full notice is not opening in parent as well as
/// staff app".
class NoticeDetailScreen extends StatelessWidget {
  const NoticeDetailScreen({super.key, required this.api, required this.item});

  final ApiClient api;
  final CommsItem item;

  @override
  Widget build(BuildContext context) {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    final isBroadcast = item.sender.isNotEmpty;
    final kindLabel = isBroadcast
        ? (hindi ? "संदेश" : "Message")
        : item.isNews
        ? context.l10n.homeNews
        : context.l10n.homeNotice;
    final tone = item.isNews ? ModuleTone.blue : ModuleTone.coral;
    final date = item.publishedAt.split("T").first;
    final text = item.body.trim().isNotEmpty ? item.body : item.summary;
    return Scaffold(
      appBar: AppBar(title: Text(kindLabel)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (item.coverUrl.isNotEmpty) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: FutureBuilder<Map<String, String>>(
                future: api.imageHeaders(),
                builder: (context, snap) => snap.data == null
                    ? const AspectRatio(aspectRatio: 16 / 9)
                    : Image.network(
                        item.coverUrl,
                        headers: api.isOwnServer(item.coverUrl)
                            ? snap.data
                            : null,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => const SizedBox.shrink(),
                      ),
              ),
            ),
            const SizedBox(height: 14),
          ],
          Row(
            children: [
              if (item.pinned) ...[
                const Icon(Icons.push_pin, size: 16, color: AppColors.warning),
                const SizedBox(width: 4),
                Text(
                  hindi ? "पिन किया" : "Pinned",
                  style: AppText.labelSmall.copyWith(
                    color: AppColors.warning,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 8),
              ],
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: tone.background,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  kindLabel,
                  style: AppText.labelSmall.copyWith(
                    color: tone.foreground,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const Spacer(),
              if (date.isNotEmpty)
                Text(formatDateLabel(date), style: AppText.labelMediumMuted),
            ],
          ),
          const SizedBox(height: 12),
          SelectableText(
            item.title,
            style: AppText.titleMediumInk.copyWith(fontWeight: FontWeight.w700),
          ),
          if (isBroadcast) ...[
            const SizedBox(height: 4),
            Text(
              "${hindi ? "भेजने वाले" : "From"}: ${item.sender}",
              style: AppText.bodySmallMuted,
            ),
          ],
          if (item.isNews && item.summary.isNotEmpty && item.body.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: SelectableText(
                item.summary,
                style: AppText.bodyMediumInk.copyWith(
                  fontWeight: FontWeight.w600,
                  height: 1.45,
                ),
              ),
            ),
          const SizedBox(height: 12),
          SelectableText(
            text,
            style: AppText.bodyMediumInk.copyWith(height: 1.55),
          ),
        ],
      ),
    );
  }
}

/// The screen a "/notices" deep link opens: the full broadcast a tapped
/// notification carried (see BroadcastInbox), else the notices list.
Widget noticesScreenForRoute(ApiClient api, Uri? uri) {
  final broadcast = uri == null ? null : BroadcastInbox.take(uri);
  if (broadcast != null) return NoticeDetailScreen(api: api, item: broadcast);
  return NoticesScreen(api: api);
}
