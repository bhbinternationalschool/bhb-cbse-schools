import "package:flutter/material.dart";
import "package:webview_flutter/webview_flutter.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/i18n/locale_controller.dart";

/// Plays a tutor video inside the app: a YouTube video in YouTube's
/// embedded player, or a lesson file DIKSHA hosts itself in the web view's
/// own video player. A watch or embed link handed to the system is claimed
/// by the YouTube app on most phones and drops the parent into ads and
/// autoplay; playing here keeps them in the app and one tap back returns
/// to the tutor.
class VideoPlayerScreen extends StatefulWidget {
  const VideoPlayerScreen({super.key, required this.video});

  final TutorVideo video;

  @override
  State<VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<VideoPlayerScreen> {
  late final WebViewController _controller;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final v = widget.video;
    final id = Uri.encodeComponent(v.isFile ? "diksha" : v.videoId);
    // YouTube refuses an embed URL loaded as a bare top-level page
    // ("Video player configuration error 153"): the player must sit in an
    // iframe on a page with a real origin, so it is served as one from the
    // school's domain. A DIKSHA file needs no origin but uses the same page.
    // The download and full-screen buttons are hidden because the web view
    // has nowhere to put either, and a button that does nothing reads as broken.
    final player = v.isFile
        ? """<video src="${_attr(v.mediaUrl)}" poster="${_attr(v.thumbnail)}"
  controls playsinline autoplay preload="metadata"
  controlslist="nodownload nofullscreen"></video>"""
        : """<iframe src="https://www.youtube.com/embed/$id?rel=0&modestbranding=1&playsinline=1&autoplay=1"
  allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen
  referrerpolicy="strict-origin-when-cross-origin"></iframe>""";
    final html =
        """
<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}
iframe,video{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}</style>
</head><body>
$player
</body></html>""";
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
          // Keep the parent on the player: the embed's own links (channel,
          // "watch on YouTube", suggestions) would otherwise navigate away.
          onNavigationRequest: (req) =>
              !req.isMainFrame ||
                  req.url.startsWith(_origin) ||
                  req.url.startsWith("about:")
              ? NavigationDecision.navigate
              : NavigationDecision.prevent,
        ),
      )
      ..loadHtmlString(html, baseUrl: "$_origin/tutor/video/$id");
  }

  static const _origin = "https://bhbinternational.school";

  static String _attr(String s) => s
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: Text(
          widget.video.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppText.bodyLarge,
        ),
      ),
      body: Column(
        children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: Stack(
              fit: StackFit.expand,
              children: [
                WebViewWidget(controller: _controller),
                if (_loading)
                  const Center(
                    child: CircularProgressIndicator(color: Colors.white70),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.video.title,
                  style: AppText.titleSmall.copyWith(
                    height: 1.35,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  // A Creative Commons licence asks for credit: who made
                  // it and under which licence, next to the video.
                  [
                    widget.video.channel,
                    widget.video.license,
                  ].where((s) => s.isNotEmpty).join(" · "),
                  style: AppText.bodySmall.copyWith(color: Colors.white70),
                ),
                const SizedBox(height: 14),
                Text(
                  widget.video.fromDiksha
                      ? context.l10n.fromDikshaGovernmentLessons
                      : context.l10n.fromYoutubeNotTheSchoolJudge,
                  style: AppText.labelMediumMuted,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
