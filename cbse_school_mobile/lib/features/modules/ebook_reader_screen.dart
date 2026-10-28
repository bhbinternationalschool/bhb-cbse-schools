import "dart:convert";

import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";
import "package:webview_flutter/webview_flutter.dart";

import "../../core/theme/app_theme.dart";

/// Opens a FlipHTML5 shelf or book inside the app and types its password
/// into the publisher's password box by itself (director, 12 Oct 2026).
///
/// The parent never sees the password: it is not printed on the shelf
/// screen, the box only ever shows dots, and the publisher's "show
/// password" eye is hidden so nobody looking at the phone can reveal it.
/// A shelf asks for the shelf password; each book on it asks for the book
/// password, so both are tried — the page's own kind first.
///
/// The password is only ever typed into a FlipHTML5 page. Any other link
/// goes to the phone's browser with nothing filled in.
class EbookReaderScreen extends StatefulWidget {
  const EbookReaderScreen({
    super.key,
    required this.title,
    required this.url,
    required this.shelfKey,
    required this.bookKey,
  });

  final String title;
  final String url;
  final String shelfKey;
  final String bookKey;

  /// Only FlipHTML5's own pages ever receive a password.
  static bool isPublisherUrl(String url) {
    final host = Uri.tryParse(url)?.host.toLowerCase() ?? "";
    return host == "fliphtml5.com" || host.endsWith(".fliphtml5.com");
  }

  @override
  State<EbookReaderScreen> createState() => _EbookReaderScreenState();
}

class _EbookReaderScreenState extends State<EbookReaderScreen> {
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
          onPageFinished: (url) {
            if (mounted) setState(() => _loading = false);
            _fill(url);
          },
          onNavigationRequest: (req) {
            if (!req.isMainFrame ||
                EbookReaderScreen.isPublisherUrl(req.url) ||
                req.url.startsWith("about:")) {
              return NavigationDecision.navigate;
            }
            // Leaving FlipHTML5: the phone's browser, with no password.
            final uri = Uri.tryParse(req.url);
            if (uri != null) {
              launchUrl(uri, mode: LaunchMode.externalApplication);
            }
            return NavigationDecision.prevent;
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.url));
  }

  /// The passwords to try on [url], its own kind first, blanks dropped.
  List<String> _keysFor(String url) {
    final shelfFirst = url.contains("/bookcase/");
    final ordered = shelfFirst
        ? [widget.shelfKey, widget.bookKey]
        : [widget.bookKey, widget.shelfKey];
    return ordered.where((k) => k.isNotEmpty).toSet().toList();
  }

  Future<void> _fill(String url) async {
    if (!EbookReaderScreen.isPublisherUrl(url)) return;
    final keys = _keysFor(url);
    try {
      await _controller.runJavaScript(_fillScript(jsonEncode(keys)));
    } catch (_) {
      // A page that will not run the script just shows its own password
      // box; nothing is printed in its place.
    }
  }

  /// Fills the visible password box and presses Verify; if the box is still
  /// there after a moment (wrong kind of password), tries the next key once.
  /// Re-checks for a while because the box is drawn after the page loads.
  static String _fillScript(String keysJson) =>
      """
(function (keys) {
  if (!/(^|\\.)fliphtml5\\.com\$/i.test(location.hostname)) return;
  if (window.__bhbKeyFill) return;
  window.__bhbKeyFill = true;
  var css = document.createElement('style');
  css.textContent = '.encription_eye_box,.eye_icon{display:none!important}';
  (document.head || document.documentElement).appendChild(css);
  // A book on a shelf opens in a new window, which the app has not got.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[target]') : null;
    if (a) a.target = '_self';
  }, true);
  window.open = function (u) { if (u) location.href = u; return window; };
  var idx = 0, lastTry = 0, started = Date.now();
  var setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  function shown(e) { return !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length); }
  function box() {
    var all = document.querySelectorAll('input[type=password], input.encription_password_input');
    for (var i = 0; i < all.length; i++) if (shown(all[i])) return all[i];
    return null;
  }
  function verify(inp) {
    var root = (inp.closest && inp.closest('.encription_container')) || document;
    var b = root.querySelector('.encription_password_button');
    if (b) return b;
    var c = root.querySelectorAll('button, [role=button], input[type=submit]');
    for (var i = 0; i < c.length; i++) {
      if (shown(c[i]) && /^(verify|ok|submit|confirm|open|enter)\$/i.test((c[i].textContent || c[i].value || '').trim())) return c[i];
    }
    return null;
  }
  function tick() {
    var inp = box();
    if (inp) {
      // Never let the box show the password in letters.
      if (inp.type !== 'password') inp.type = 'password';
      if (idx < keys.length && Date.now() - lastTry > 1800) {
        setValue.call(inp, keys[idx++]);
        lastTry = Date.now();
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        var b = verify(inp);
        if (b) b.click();
        else inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      }
    }
    if (Date.now() - started < 30000) setTimeout(tick, 400);
  }
  tick();
})($keysJson);
""";

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
