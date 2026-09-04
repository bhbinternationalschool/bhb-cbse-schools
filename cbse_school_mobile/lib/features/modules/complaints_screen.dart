import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "module_shell.dart";

/// The household's complaints, and a form to raise one.
///
/// A ticket raised here reaches the office's complaints desk the same way a
/// WhatsApp one does; the office assigns and resolves it there, and the
/// status and resolution note show up here. Complaints are per household,
/// not per child, though one can be about a particular child.
class ComplaintsScreen extends StatelessWidget {
  const ComplaintsScreen({
    super.key,
    required this.api,
    required this.children,
    required this.defaultChild,
  });

  final ApiClient api;
  final List<ParentChild> children;
  final ParentChild defaultChild;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<ComplaintList>(
      title: "Complaints",
      load: api.fetchComplaints,
      emptyIcon: Icons.support_agent_outlined,
      emptyText:
          "No complaints raised. If something at school needs the office's "
          "attention, use the button below.",
      isEmpty: (list) => list.tickets.isEmpty,
      floatingActionButton: (context, list, reload) =>
          FloatingActionButton.extended(
            onPressed: () => _openForm(context, list.categories, reload),
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            icon: const Icon(Icons.add),
            label: const Text("Raise a complaint"),
          ),
      builder: (context, list, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          for (final t in list.tickets)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            t.subject,
                            style: const TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                        _StatusChip(status: t.status, label: t.statusLabel),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [
                        t.categoryLabel,
                        formatDateLabel(t.date),
                        if (t.studentName.isNotEmpty) "about ${t.studentName}",
                      ].join(" · "),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      t.description,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.ink,
                        height: 1.4,
                      ),
                    ),
                    if (t.resolutionNote.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: ModuleTone.green.background,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          "School's response: ${t.resolutionNote}",
                          style: TextStyle(
                            fontSize: 12,
                            color: ModuleTone.green.foreground,
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _openForm(
    BuildContext context,
    List<ComplaintCategoryInfo> categories,
    Future<void> Function() reload,
  ) async {
    final submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _ComplaintForm(
        api: api,
        categories: categories,
        children: children,
        defaultChild: defaultChild,
      ),
    );
    if (submitted == true) {
      Haptics.success();
      await reload();
    }
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status, required this.label});

  final String status;
  final String label;

  @override
  Widget build(BuildContext context) {
    final tone = switch (status) {
      "resolved" || "closed" => ModuleTone.green,
      "assigned" || "in_progress" => ModuleTone.blue,
      _ => ModuleTone.amber,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label.isEmpty ? status : label,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: tone.foreground,
        ),
      ),
    );
  }
}

class _ComplaintForm extends StatefulWidget {
  const _ComplaintForm({
    required this.api,
    required this.categories,
    required this.children,
    required this.defaultChild,
  });

  final ApiClient api;
  final List<ComplaintCategoryInfo> categories;
  final List<ParentChild> children;
  final ParentChild defaultChild;

  @override
  State<_ComplaintForm> createState() => _ComplaintFormState();
}

class _ComplaintFormState extends State<_ComplaintForm> {
  late String _category = widget.categories.first.value;

  /// Empty string = a general complaint, not about one child.
  late String _studentId = widget.defaultChild.id;
  final _subject = TextEditingController();
  final _description = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _subject.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final subject = _subject.text.trim();
    final description = _description.text.trim();
    if (subject.isEmpty || description.isEmpty) {
      Haptics.warning();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text("Please fill in the subject and the details."),
        ),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.api.createComplaint(
        studentId: _studentId.isEmpty ? null : _studentId,
        category: _category,
        subject: subject,
        description: description,
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Could not reach the school server.")),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + inset),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              "Raise a complaint",
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: "What is it about?"),
              items: [
                for (final c in widget.categories)
                  DropdownMenuItem(value: c.value, child: Text(c.label)),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _category = v);
              },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _studentId,
              decoration: const InputDecoration(labelText: "Concerning"),
              items: [
                for (final c in widget.children)
                  DropdownMenuItem(value: c.id, child: Text(c.fullName)),
                const DropdownMenuItem(
                  value: "",
                  child: Text("General — not about one child"),
                ),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _studentId = v);
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _subject,
              maxLength: 120,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: "Subject"),
            ),
            TextField(
              controller: _description,
              maxLines: 4,
              maxLength: 2000,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: "Details",
                hintText:
                    "What happened, when, and what you would like the school to do",
              ),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _busy ? null : _submit,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
              ),
              child: Text(_busy ? "Sending…" : "Send to the school"),
            ),
          ],
        ),
      ),
    );
  }
}
