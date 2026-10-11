import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";
import "package:webview_flutter/webview_flutter.dart";

import "../../core/theme/app_theme.dart";

/// Pinnacle Smart Teach inside the staff app (director, 12 Oct 2026): the
/// publisher's animations, mind maps, games and worksheets for a chapter,
/// opened on the book's Assets page.
///
/// The teacher signs in to Smart Teach here once, with their own mobile
/// number and OTP — the app never sees or fills that login. The web view keeps
/// Smart Teach's own sign-in (its storage and cookies) between visits, so
/// later taps open straight onto the book.
///
/// Smart Teach and its sign-in pages (LEAD's Nucleus) stay in this screen;
/// a PDF, or any other site, goes to the phone so it can be saved or printed.
class SmartTeachScreen extends StatefulWidget {
  const SmartTeachScreen({super.key, required this.title, required this.url});

  final String title;
  final String url;

  static const _hosts = [
    "pinnaclelearning.in",
    "leadgroup.co.in",
    "leadschool.in",
  ];

  /// Smart Teach's own pages and its sign-in, which stay in the app.
  static bool isSmartTeachUrl(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || !(uri.isScheme("https") || uri.isScheme("http"))) {
      return false;
    }
    final host = uri.host.toLowerCase();
    return _hosts.any((h) => host == h || host.endsWith(".$h"));
  }

  @override
  State<SmartTeachScreen> createState() => _SmartTeachScreenState();
}

class _SmartTeachScreenState extends State<SmartTeachScreen> {
  late final WebViewController _controller;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) {
            if (mounted) setState(() => _loading = true);
          },
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
          onNavigationRequest: (req) {
            final url = req.url;
            final isPdf =
                Uri.tryParse(url)?.path.toLowerCase().endsWith(".pdf") ?? false;
            if (url.startsWith("about:") ||
                url.startsWith("blob:") ||
                url.startsWith("data:")) {
              return NavigationDecision.navigate;
            }
            if (!isPdf &&
                (SmartTeachScreen.isSmartTeachUrl(url) || !req.isMainFrame)) {
              return NavigationDecision.navigate;
            }
            // A worksheet PDF or another site: the phone opens it, where it
            // can be saved, shared or printed.
            final uri = Uri.tryParse(url);
            if (uri != null) {
              launchUrl(uri, mode: LaunchMode.externalApplication);
            }
            return NavigationDecision.prevent;
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.url));
  }

  Future<bool> _back() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await _back();
        if (leave && context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            widget.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.bodyLarge,
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () => _controller.reload(),
            ),
          ],
        ),
        body: Stack(
          children: [
            WebViewWidget(controller: _controller),
            if (_loading) const LinearProgressIndicator(minHeight: 2),
          ],
        ),
      ),
    );
  }
}
