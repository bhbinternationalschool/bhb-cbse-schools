import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";
import "../../core/i18n/locale_controller.dart";

class NoticesScreen extends StatelessWidget {
  const NoticesScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<CommsItem>>(
      title: "Notices & news",
      load: api.fetchCommsFeed,
      emptyIcon: Icons.campaign_outlined,
      emptyText: context.l10n.noNoticesPublishedYetSchoolCirculars,
      isEmpty: (items) => items.isEmpty,
      builder: (context, items, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final item in items)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (item.pinned) ...[
                          const Icon(
                            Icons.push_pin,
                            size: 14,
                            color: AppColors.warning,
                          ),
                          const SizedBox(width: 4),
                        ],
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: item.isNews
                                ? ModuleTone.blue.background
                                : ModuleTone.coral.background,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            item.isNews ? "News" : "Notice",
                            style: AppText.labelSmall.copyWith(
                              color: item.isNews
                                  ? ModuleTone.blue.foreground
                                  : ModuleTone.coral.foreground,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const Spacer(),
                        Text(
                          formatDateLabel(item.publishedAt.split("T").first),
                          style: AppText.labelMediumMuted,
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      item.title,
                      style: AppText.bodyMediumInk.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.summary.isNotEmpty ? item.summary : item.body,
                      maxLines: 6,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.bodySmallInk.copyWith(height: 1.4),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
