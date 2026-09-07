import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";
import "../../core/i18n/locale_controller.dart";

/// The school's e-book shelf for a signed-in parent.
///
/// Books live on FlipHTML5 and open in the browser; some need a pass key,
/// which the server hands out only to a signed-in reader. The key is shown
/// next to the book with a copy button so the parent is not left guessing on
/// the publisher's page.
class EbookShelfScreen extends StatelessWidget {
  const EbookShelfScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<EbookShelf>(
      title: "Library",
      subtitle: "E-books",
      load: api.fetchEbookShelf,
      emptyIcon: Icons.local_library_outlined,
      emptyText: context.l10n.theSchoolSEBookShelf,
      isEmpty: (shelf) => !shelf.configured,
      builder: (context, shelf, _) {
        final bySubject = <String, List<LibraryEbook>>{};
        for (final b in shelf.books) {
          bySubject
              .putIfAbsent(b.subject.isEmpty ? "General" : b.subject, () => [])
              .add(b);
        }
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            if (shelf.shelfUrl.isNotEmpty)
              Card(
                color: AppColors.primary,
                child: ListTile(
                  onTap: () => _open(context, shelf.shelfUrl),
                  leading: const Icon(Icons.auto_stories, color: Colors.white),
                  title: Text(
                    context.l10n.openTheWholeShelf,
                    style: AppText.bodyLarge.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: shelf.shelfKey.isEmpty
                      ? null
                      : _KeyLine(
                          label: "Shelf key",
                          value: shelf.shelfKey,
                          light: true,
                        ),
                  trailing: const Icon(
                    Icons.open_in_new,
                    color: Colors.white,
                    size: 18,
                  ),
                ),
              ),
            if (shelf.books.isEmpty)
              Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  context.l10n.noIndividualBooksCataloguedYetThe,
                  textAlign: TextAlign.center,
                  style: AppText.bodySmallMuted,
                ),
              ),
            // Each subject is a shelf you browse by cover, which is the one
            // shape a carousel is actually for: few items, all of equal rank,
            // and the spine is the content. The list below it stays, because a
            // carousel hides how many books there are and a parent looking for
            // one particular title should not have to swipe to find out.
            for (final entry in bySubject.entries) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 14, 4, 6),
                child: Text(
                  entry.key,
                  style: AppText.bodyMediumInk.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (entry.value.length > 1)
                _SubjectCarousel(
                  books: entry.value,
                  onOpen: (b) => _open(context, b.url),
                ),
              for (final b in entry.value)
                Card(
                  child: ListTile(
                    onTap: b.url.isEmpty ? null : () => _open(context, b.url),
                    leading: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: ModuleTone.green.background,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        Icons.menu_book_outlined,
                        color: ModuleTone.green.foreground,
                        size: 22,
                      ),
                    ),
                    title: Text(
                      b.title,
                      style: AppText.bodyMediumInk.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (b.author.isNotEmpty || b.classLabels.isNotEmpty)
                          Text(
                            [
                              if (b.author.isNotEmpty) b.author,
                              if (b.classLabels.isNotEmpty)
                                "Class ${b.classLabels.join(", ")}",
                            ].join(" · "),
                            style: AppText.labelMediumMuted,
                          ),
                        if (b.passKey.isNotEmpty)
                          _KeyLine(
                            label: b.passKeyLabel.isEmpty
                                ? "Key"
                                : b.passKeyLabel,
                            value: b.passKey,
                          ),
                      ],
                    ),
                    trailing: const Icon(
                      Icons.open_in_new,
                      color: AppColors.muted,
                      size: 18,
                    ),
                  ),
                ),
            ],
          ],
        );
      },
    );
  }

  Future<void> _open(BuildContext context, String url) async {
    final uri = Uri.tryParse(url);
    final ok =
        uri != null &&
        await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.couldNotOpenThisBook)),
      );
    }
  }
}

/// A subject's books as Material 3 spines.
///
/// `CarouselView.weighted` gives the leading item the most room and tapers
/// the rest, so it reads as "here is a shelf, there is more to the right"
/// rather than as a row of equal tiles that might be the whole set.
class _SubjectCarousel extends StatelessWidget {
  const _SubjectCarousel({required this.books, required this.onOpen});

  final List<LibraryEbook> books;
  final void Function(LibraryEbook) onOpen;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SizedBox(
        height: 150,
        child: CarouselView.weighted(
          flexWeights: const [3, 2, 1],
          itemSnapping: true,
          shrinkExtent: 90,
          backgroundColor: ModuleTone.green.background,
          overlayColor: WidgetStatePropertyAll(
            ModuleTone.green.foreground.withValues(alpha: 0.08),
          ),
          onTap: (i) {
            final b = books[i];
            if (b.url.isNotEmpty) onOpen(b);
          },
          children: [
            for (final b in books)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Icon(
                      Icons.menu_book_outlined,
                      color: ModuleTone.green.foreground,
                      size: 26,
                    ),
                    // A spine is narrow by design, so the title is clipped
                    // rather than wrapped into an unreadable column. The full
                    // title is in the list underneath.
                    Text(
                      b.title,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.labelLarge.copyWith(
                        height: 1.25,
                        color: ModuleTone.green.foreground,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _KeyLine extends StatelessWidget {
  const _KeyLine({
    required this.label,
    required this.value,
    this.light = false,
  });

  final String label;
  final String value;
  final bool light;

  @override
  Widget build(BuildContext context) {
    final color = light ? const Color(0xFFB8C0D4) : AppColors.muted;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          "$label: $value",
          style: AppText.labelMedium.copyWith(color: color),
        ),
        const SizedBox(width: 4),
        InkWell(
          onTap: () async {
            await Clipboard.setData(ClipboardData(text: value));
            if (context.mounted) {
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(SnackBar(content: Text("$label copied")));
            }
          },
          child: Padding(
            padding: const EdgeInsets.all(2),
            child: Icon(Icons.copy, size: 14, color: color),
          ),
        ),
      ],
    );
  }
}
