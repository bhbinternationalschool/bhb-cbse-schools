import "package:url_launcher/url_launcher.dart";

/// Opens a payment page (fee checkout, auto-pay approval, tutor pass) INSIDE
/// the app — a Chrome Custom Tab on Android, Safari View on iPhone — instead
/// of sending the parent out to the browser (director, 8 Oct 2026).
///
/// Not a WebView on purpose: the gateway hands UPI payments to GPay/PhonePe
/// with upi:// and intent:// links, and a Custom Tab follows those (and
/// shows the real bank pages, saved cards and OTP autofill) where a WebView
/// would need every scheme handled by hand. When the parent closes the tab,
/// the screen underneath resumes and re-reads the dues, as before.
///
/// Falls back to the external browser if the phone has no Custom Tab
/// provider. Returns false only when neither could open.
Future<bool> openCheckout(Uri uri) async {
  try {
    if (await launchUrl(uri, mode: LaunchMode.inAppBrowserView)) return true;
  } catch (_) {
    // No Custom Tab provider (rare) — fall through to the browser.
  }
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}
