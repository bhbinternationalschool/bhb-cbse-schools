import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

/// The school's published photo albums.
///
/// Each album is a Material 3 carousel of its own pictures. This is the one
/// place in the parent app where a carousel is the right shape: the photos
/// are the content, they are few, none ranks above another, and nobody needs
/// to count them or act on one. Everywhere a parent must not miss an item —
/// notices, dues, homework — stays a list.
///
/// Drafts never reach here; the server sends published albums only.
class GalleryScreen extends StatelessWidget {
  const GalleryScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<GalleryAlbum>>(
      title: "Gallery",
      subtitle: "School photos",
      load: api.fetchGalleryAlbums,
      emptyIcon: Icons.photo_library_outlined,
      emptyText:
          "No albums published yet. Photos from school events appear here.",
      isEmpty: (albums) => albums.isEmpty,
      builder: (context, albums, _) {
        return ListView.builder(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          itemCount: albums.length,
          itemBuilder: (context, i) => _AlbumBlock(album: albums[i]),
        );
      },
    );
  }
}

class _AlbumBlock extends StatelessWidget {
  const _AlbumBlock({required this.album});

  final GalleryAlbum album;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            album.title,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 2, bottom: 10),
            child: Text(
              [
                if (album.description.isNotEmpty) album.description,
                "${album.photos.length} photo${album.photos.length == 1 ? "" : "s"}",
              ].join(" · "),
              style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
            ),
          ),
          SizedBox(
            height: 210,
            child: CarouselView.weighted(
              // One large picture with the next two tapering. A single photo
              // gets the whole width instead, because a lone tapering slice
              // reads as a loading state.
              flexWeights: album.photos.length == 1
                  ? const [1]
                  : const [5, 3, 2],
              itemSnapping: true,
              shrinkExtent: 100,
              backgroundColor: AppColors.ink.withValues(alpha: 0.06),
              onTap: (i) => _openViewer(context, i),
              children: [
                for (final photo in album.photos) _PhotoTile(photo: photo),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openViewer(BuildContext context, int index) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => _PhotoViewer(album: album, initialIndex: index),
      ),
    );
  }
}

class _PhotoTile extends StatelessWidget {
  const _PhotoTile({required this.photo});

  final GalleryPhoto photo;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Image.network(
          photo.url,
          fit: BoxFit.cover,
          // A carousel of broken tiles is worse than a carousel of grey ones:
          // the parent cannot tell whether the school posted nothing or the
          // phone lost the connection.
          errorBuilder: (_, _, _) => const ColoredBox(
            color: Color(0xFFECEAE3),
            child: Icon(
              Icons.image_not_supported_outlined,
              color: AppColors.muted,
            ),
          ),
          loadingBuilder: (context, child, progress) => progress == null
              ? child
              : const ColoredBox(color: Color(0xFFECEAE3)),
        ),
        if (photo.caption.isNotEmpty)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.fromLTRB(10, 14, 10, 8),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0x00000000), Color(0xB3000000)],
                ),
              ),
              child: Text(
                photo.caption,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 11.5),
              ),
            ),
          ),
      ],
    );
  }
}

/// Full-screen album, swiped one picture at a time.
///
/// A PageView and not a carousel: here the parent is looking AT a photo, not
/// choosing between photos, so a tapering neighbour would be a distraction.
class _PhotoViewer extends StatefulWidget {
  const _PhotoViewer({required this.album, required this.initialIndex});

  final GalleryAlbum album;
  final int initialIndex;

  @override
  State<_PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<_PhotoViewer> {
  late final PageController _controller = PageController(
    initialPage: widget.initialIndex,
  );
  late int _index = widget.initialIndex;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final photos = widget.album.photos;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(
          widget.album.title,
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
        // Position, because a parent swiping through thirty photos of a sports
        // day should be able to tell how far along they are.
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 14),
            child: Center(
              child: Text(
                "${_index + 1} / ${photos.length}",
                style: const TextStyle(color: Colors.white70, fontSize: 12.5),
              ),
            ),
          ),
        ],
      ),
      body: PageView.builder(
        controller: _controller,
        itemCount: photos.length,
        onPageChanged: (i) => setState(() => _index = i),
        itemBuilder: (context, i) {
          final photo = photos[i];
          return Column(
            children: [
              Expanded(
                child: InteractiveViewer(
                  minScale: 1,
                  maxScale: 4,
                  child: Center(
                    child: Image.network(
                      photo.url,
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const Icon(
                        Icons.image_not_supported_outlined,
                        color: Colors.white38,
                        size: 44,
                      ),
                    ),
                  ),
                ),
              ),
              if (photo.caption.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
                  child: Text(
                    photo.caption,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 12.5,
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
