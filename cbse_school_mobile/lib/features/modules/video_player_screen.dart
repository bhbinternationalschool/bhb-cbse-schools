import "package:flutter/material.dart";
import "package:webview_flutter/webview_flutter.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// Plays a YouTube video inside the app. A watch or embed link handed to
/// the system is claimed by the YouTube app on most phones and drops the
/// parent into ads and autoplay; an embedded player keeps them here and
/// one tap back returns to the tutor.
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
    final id = Uri.encodeComponent(widget.video.videoId);
    // YouTube refuses an embed URL loaded as a bare top-level page
    // ("Video player configuration error 153"): the player must sit in an
    // iframe on a page with a real origin, so it is served as one from the
    // school's domain.
    final html =
        """
<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body>
<iframe src="https://www.youtube.com/embed/$id?rel=0&modestbranding=1&playsinline=1&autoplay=1"
  allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen
  referrerpolicy="strict-origin-when-cross-origin"></iframe>
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: Text(
          widget.video.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 14),
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
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  widget.video.channel,
                  style: const TextStyle(color: Colors.white70, fontSize: 12.5),
                ),
                const SizedBox(height: 14),
                const Text(
                  "From YouTube, not the school — judge it as you watch.",
                  style: TextStyle(color: AppColors.muted, fontSize: 11.5),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
