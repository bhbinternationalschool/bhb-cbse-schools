import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

class NoticesScreen extends StatelessWidget {
  const NoticesScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<CommsItem>>(
      title: "Notices & news",
      load: api.fetchCommsFeed,
      emptyIcon: Icons.campaign_outlined,
      emptyText:
          "No notices published yet. School circulars and news will appear here.",
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
                          const Icon(Icons.push_pin,
                              size: 14, color: AppColors.warning),
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
                            style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: item.isNews
                                  ? ModuleTone.blue.foreground
                                  : ModuleTone.coral.foreground,
                            ),
                          ),
                        ),
                        const Spacer(),
                        Text(
                          formatDateLabel(item.publishedAt.split("T").first),
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      item.title,
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.summary.isNotEmpty ? item.summary : item.body,
                      maxLines: 6,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.ink,
                        height: 1.4,
                      ),
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
