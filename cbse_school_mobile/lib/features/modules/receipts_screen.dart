import "dart:typed_data";

import "package:flutter/material.dart";
import "package:pdfx/pdfx.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

/// Every fee receipt the family has been issued, newest first, each one
/// openable as the same PDF the school keeps in its archive.
class ReceiptsScreen extends StatelessWidget {
  const ReceiptsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<ReceiptInfo>>(
      title: "Fee receipts",
      load: api.fetchReceipts,
      emptyIcon: Icons.receipt_long_outlined,
      emptyText:
          "No receipts yet. Every payment made at the counter or online appears here.",
      isEmpty: (list) => list.isEmpty,
      builder: (context, list, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final r in list)
            Card(
              child: ListTile(
                onTap: () => _open(context, r),
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: (r.voided ? ModuleTone.coral : ModuleTone.blue)
                        .background,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    Icons.receipt_long_outlined,
                    color: (r.voided ? ModuleTone.coral : ModuleTone.blue)
                        .foreground,
                    size: 22,
                  ),
                ),
                title: Row(
                  children: [
                    Expanded(
                      child: Text(
                        r.receiptNo,
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Text(
                      r.totalLabel,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: r.voided ? AppColors.muted : AppColors.ink,
                        decoration: r.voided
                            ? TextDecoration.lineThrough
                            : null,
                      ),
                    ),
                  ],
                ),
                subtitle: Text(
                  "${formatDateLabel(r.date)} · ${r.paidBy}"
                  "${r.students.isNotEmpty ? "\n${r.students.join(", ")}" : ""}"
                  "${r.voided ? "\nVOID — cancelled by the office" : ""}",
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.muted,
                    height: 1.4,
                  ),
                ),
                isThreeLine: true,
                trailing: const Icon(
                  Icons.picture_as_pdf_outlined,
                  color: AppColors.muted,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _open(BuildContext context, ReceiptInfo r) async {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const AlertDialog(
        content: Row(
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 16),
            Expanded(child: Text("Fetching receipt…")),
          ],
        ),
      ),
    );
    try {
      final bytes = await api.fetchReceiptPdf(r.pdfUrl);
      if (!context.mounted) return;
      Navigator.of(context).pop();
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ReceiptPdfScreen(
            title: r.receiptNo,
            bytes: Uint8List.fromList(bytes),
          ),
        ),
      );
    } on ApiException catch (e) {
      if (!context.mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (!context.mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text("Could not fetch the receipt. Check your connection."),
        ),
      );
    }
  }
}

/// The receipt PDF, rendered in the app. Pinch to zoom.
class ReceiptPdfScreen extends StatefulWidget {
  const ReceiptPdfScreen({super.key, required this.title, required this.bytes});

  final String title;
  final Uint8List bytes;

  @override
  State<ReceiptPdfScreen> createState() => _ReceiptPdfScreenState();
}

class _ReceiptPdfScreenState extends State<ReceiptPdfScreen> {
  late final PdfControllerPinch _controller = PdfControllerPinch(
    document: PdfDocument.openData(widget.bytes),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          "Receipt ${widget.title}",
          style: const TextStyle(fontSize: 16),
        ),
      ),
      body: PdfViewPinch(controller: _controller),
    );
  }
}
