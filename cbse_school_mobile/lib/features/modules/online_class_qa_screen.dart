import "package:flutter/material.dart";
import "package:image_picker/image_picker.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "module_shell.dart";

/// The teacher's questions during an online class. The child writes the
/// answer in the copy, the parent photographs it here, and the teacher's
/// mark comes back on the same card.
class OnlineClassQaScreen extends StatefulWidget {
  const OnlineClassQaScreen({
    super.key,
    required this.api,
    required this.child,
    required this.sessionId,
    required this.title,
  });

  final ApiClient api;
  final ParentChild child;
  final String sessionId;
  final String title;

  @override
  State<OnlineClassQaScreen> createState() => _OnlineClassQaScreenState();
}

class _OnlineClassQaScreenState extends State<OnlineClassQaScreen> {
  final _picker = ImagePicker();
  String? _sendingFor;

  Future<void> _answer(
    BuildContext context,
    ParentClassQuestion q,
    Future<void> Function() reload,
  ) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text("Take a photo of the copy"),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text("Choose from gallery"),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    final shot = await _picker.pickImage(source: source, imageQuality: 85, maxWidth: 2000);
    if (shot == null) return;
    setState(() => _sendingFor = q.id);
    try {
      await widget.api.submitOnlineClassAnswer(
        sessionId: widget.sessionId,
        questionId: q.id,
        studentId: widget.child.id,
        filePath: shot.path,
        mimeType: shot.mimeType ?? "image/jpeg",
      );
      Haptics.success();
      await reload();
    } on ApiException catch (e) {
      Haptics.warning();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _sendingFor = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<ParentClassQuestion>>(
      title: "Questions from the teacher",
      subtitle: "${widget.title} · ${widget.child.fullName}",
      load: () => widget.api.fetchOnlineClassQuestions(
        sessionId: widget.sessionId,
        studentId: widget.child.id,
      ),
      emptyIcon: Icons.quiz_outlined,
      emptyText: "The teacher has not asked a question yet. Pull down to refresh.",
      isEmpty: (qs) => qs.isEmpty,
      builder: (context, qs, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final q in qs.reversed) ...[
            _QuestionCard(
              q: q,
              api: widget.api,
              sending: _sendingFor == q.id,
              onAnswer: q.closed ? null : () => _answer(context, q, reload),
            ),
            const SizedBox(height: 10),
          ],
          Text(
            "Write the answer in the copy, then send a clear photo. You can send again until the teacher closes the question.",
            style: AppText.labelMediumMuted,
          ),
        ],
      ),
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({
    required this.q,
    required this.api,
    required this.sending,
    required this.onAnswer,
  });

  final ParentClassQuestion q;
  final ApiClient api;
  final bool sending;
  final VoidCallback? onAnswer;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (q.verdict) {
      "right" => ("Correct ✓", AppColors.success),
      "wrong" => ("Not correct — try again", AppColors.warning),
      "partial" => ("Partly right", AppColors.warning),
      _ => q.answered ? ("Sent · waiting for the teacher", AppColors.muted) : ("", AppColors.muted),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("Question ${q.orderNo}${q.closed ? " · closed" : ""}", style: AppText.labelMediumMuted),
            const SizedBox(height: 4),
            Text(q.text, style: AppText.titleMedium),
            if (q.answerPhotoUrl.isNotEmpty) ...[
              const SizedBox(height: 10),
              FutureBuilder<Map<String, String>>(
                future: api.imageHeaders(),
                builder: (context, snap) => snap.data == null
                    ? const SizedBox(height: 120)
                    : ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.network(
                          "${api.config.apiBaseUrl}${q.answerPhotoUrl}",
                          headers: snap.data,
                          height: 160,
                          width: double.infinity,
                          fit: BoxFit.cover,
                        ),
                      ),
              ),
            ],
            if (label.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(label, style: AppText.bodyMedium.copyWith(color: color, fontWeight: FontWeight.w700)),
            ],
            if (onAnswer != null) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: sending ? null : onAnswer,
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: Text(sending ? "Sending…" : (q.answered ? "Send again" : "Send answer photo")),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
