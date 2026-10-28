import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";
import "notice_compose_screen.dart";
import "notice_detail_screen.dart";
import "../../core/i18n/locale_controller.dart";

class NoticesScreen extends StatelessWidget {
  const NoticesScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<CommsItem>>(
      guideId: "notices",
      title: context.l10n.homeNoticesAndNews,
      // Pinned first, then newest — the running strip's order, so tapping
      // the strip lands on the notice it led with, at the top.
      load: () async =>
          [...await api.fetchCommsFeed()]..sort(CommsItem.stripOrder),
      emptyIcon: Icons.campaign_outlined,
      emptyText: context.l10n.noNoticesPublishedYetSchoolCirculars,
      isEmpty: (items) => items.isEmpty,
      floatingActionButton: (context, _, reload) =>
          _ComposeButton(api: api, onPublished: reload),
      builder: (context, items, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        // Room under the last notice for the create button.
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
        children: [
          for (final item in items)
            Card(
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => NoticeDetailScreen(api: api, item: item),
                  ),
                ),
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
                              item.isNews
                                  ? context.l10n.homeNews
                                  : context.l10n.homeNotice,
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
                        maxLines: 4,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.bodySmallInk.copyWith(height: 1.4),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        Localizations.localeOf(context).languageCode == "hi"
                            ? "पूरा पढ़ें ›"
                            : "Read more ›",
                        style: AppText.labelMediumInk.copyWith(
                          color: AppColors.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// "+ Create notice / news" (request mr_mv9y435vx6e5) — only for staff who
/// may create them on the web: the staff home's features answer carries
/// `notices_create` / `news_create` (/api/v1/staff/features). Read from the
/// copy the home saved, so the parent app (no staff features) never shows
/// it; the server refuses anyone else whatever a phone shows.
class _ComposeButton extends StatefulWidget {
  const _ComposeButton({required this.api, required this.onPublished});

  final ApiClient api;
  final Future<void> Function() onPublished;

  @override
  State<_ComposeButton> createState() => _ComposeButtonState();
}

class _ComposeButtonState extends State<_ComposeButton> {
  bool _notice = false;
  bool _news = false;

  @override
  void initState() {
    super.initState();
    widget.api
        .cachedStaffFeatures()
        .then((c) {
          if (!mounted || c == null) return;
          setState(() {
            _notice = c.value.has("notices_create");
            _news = c.value.has("news_create");
          });
        })
        .catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    if (!_notice && !_news) return const SizedBox.shrink();
    return FloatingActionButton.extended(
      heroTag: "notice-compose",
      backgroundColor: AppColors.primary,
      foregroundColor: Colors.white,
      icon: const Icon(Icons.add),
      label: Text(context.l10n.hcCreateNotice),
      onPressed: () async {
        final done = await Navigator.of(context).push<bool>(
          MaterialPageRoute(
            builder: (_) => NoticeComposeScreen(
              api: widget.api,
              canNotice: _notice,
              canNews: _news,
            ),
          ),
        );
        if (done == true) await widget.onPublished();
      },
    );
  }
}
