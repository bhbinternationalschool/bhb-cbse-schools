import "package:flutter/material.dart";

import "api_client.dart";

/// Message a family from the SCHOOL's WhatsApp, and say what happened.
///
/// Every staff screen that used to open `https://wa.me/…` comes here instead.
/// That mattered: a parent chased for fees heard from whichever teacher was
/// holding a phone, on a number the school does not control and keeps no
/// record of — so the family saw three different senders for three kinds of
/// message, and only some of them were on the school's books.
///
/// There is deliberately NO fallback to the staff member's own WhatsApp. If
/// the school cannot send, the reason is shown and nothing is sent, because a
/// silent fallback is exactly how nobody noticed for months.
Future<void> sendSchoolWhatsApp(
  BuildContext context,
  ApiClient api, {
  required String mobile,
  String familyKey = "",
  String text = "",
  Map<String, String> variables = const {},
  bool urgent = false,
}) async {
  final digits = mobile.replaceAll(RegExp(r"\D"), "");
  final messenger = ScaffoldMessenger.of(context);
  if (digits.length < 10) {
    messenger.showSnackBar(
      const SnackBar(content: Text("No valid WhatsApp number on record")),
    );
    return;
  }

  messenger.showSnackBar(
    const SnackBar(content: Text("Sending from the school's WhatsApp…")),
  );

  try {
    final r = await api.sendSchoolWhatsApp(
      mobile: digits,
      familyKey: familyKey,
      text: text,
      variables: variables,
      urgent: urgent,
    );
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          r.deferred
              ? (r.reason.isEmpty
                    ? "Queued — it goes out after the family's quiet hours."
                    : r.reason)
              : "Sent from the school's WhatsApp.",
        ),
      ),
    );
  } catch (e) {
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 8),
        content: Text(
          "Not sent: ${e.toString().replaceFirst("Exception: ", "")}. "
          "Nothing was sent from your own WhatsApp either.",
        ),
      ),
    );
  }
}
