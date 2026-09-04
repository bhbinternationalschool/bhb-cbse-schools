import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

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
      emptyText:
          "The school's e-book shelf is not switched on yet. Books appear here "
          "as soon as the library sets it up.",
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
                  title: const Text(
                    "Open the whole shelf",
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
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
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  "No individual books catalogued yet — the shelf link above "
                  "has everything the library has published.",
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                ),
              ),
            for (final entry in bySubject.entries) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 14, 4, 6),
                child: Text(
                  entry.key,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
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
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
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
                            style: const TextStyle(
                              fontSize: 11.5,
                              color: AppColors.muted,
                            ),
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
        const SnackBar(content: Text("Could not open this book.")),
      );
    }
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
        Text("$label: $value", style: TextStyle(fontSize: 11.5, color: color)),
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
