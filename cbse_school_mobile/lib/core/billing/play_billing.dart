import "dart:async";

export "package:in_app_purchase/in_app_purchase.dart" show ProductDetails;

import "package:in_app_purchase/in_app_purchase.dart";

import "../api/api_client.dart";

/// What the store knew about the products we asked for.
class PlayProducts {
  const PlayProducts({
    required this.found,
    required this.notFound,
    required this.storeUnavailable,
    required this.error,
  });

  final Map<String, ProductDetails> found;

  /// Ids Play does not recognise. Almost always a product that exists in Play
  /// Console but has never been set Active, or one whose id is misspelled —
  /// and, for hours after a first upload, one Play simply has not published
  /// to its billing service yet.
  final List<String> notFound;

  /// The Play Store itself could not be reached: no Play services, a build
  /// Play did not deliver, or no signed-in account.
  final bool storeUnavailable;
  final String? error;

  /// What to tell the parent, naming the actual fault.
  String get problem {
    if (storeUnavailable) {
      return "Google Play is not available on this phone. The app must be "
          "installed from Play, with a Google account signed in.";
    }
    if (error != null) return "Google Play returned an error: $error";
    if (notFound.isNotEmpty) {
      return "Google Play does not have these passes yet: "
          "${notFound.join(", ")}. They may still be publishing.";
    }
    return "Google Play has no passes to sell right now.";
  }
}

/// Buying a tutor pass through Google Play.
///
/// Play requires its own billing for digital content consumed inside an app it
/// distributes, and a tutor pass is exactly that. School fees are a real-world
/// service and stay on Cashfree everywhere — this class exists only for the
/// pass, and only in the Play build. The sideloaded APK keeps the Cashfree
/// checkout, because Play's rules do not reach an app Play did not deliver.
///
/// The purchase is never trusted here. Play hands us a token; the server asks
/// Google whether it is real and grants the pass. This class's job is to run
/// the store flow and hand that token over — nothing it decides can open the
/// tutor on its own.
class PlayBilling {
  PlayBilling(this._api);

  final ApiClient _api;
  final InAppPurchase _iap = InAppPurchase.instance;
  StreamSubscription<List<PurchaseDetails>>? _sub;

  /// Resolved once, because the store round-trip is slow and the answer does
  /// not change within a session.
  bool? _available;

  Future<bool> available() async {
    _available ??= await _iap.isAvailable();
    return _available!;
  }

  /// Prices as the STORE states them — "₹49.00", localised, including any
  /// tax Play adds. Never show the app's own price here: what Play charges is
  /// what the parent must see, and the two can differ by country.
  ///
  /// Returns WHY as well as what. The first version threw away
  /// `notFoundIDs`, so a store that answered "I have never heard of
  /// tutor_day" and a store that could not be reached at all produced the
  /// same shrug — "not ready, try again" — and there was no way to tell a
  /// propagation delay from a product that was never activated.
  Future<PlayProducts> products(Set<String> ids) async {
    if (!await available()) {
      return const PlayProducts(
        found: {},
        notFound: [],
        storeUnavailable: true,
        error: null,
      );
    }
    final res = await _iap.queryProductDetails(ids);
    return PlayProducts(
      found: {for (final p in res.productDetails) p.id: p},
      notFound: res.notFoundIDs,
      storeUnavailable: false,
      error: res.error?.message,
    );
  }

  /// Start listening BEFORE any purchase is launched.
  ///
  /// Play delivers pending purchases from previous runs on this stream too —
  /// an app killed mid-payment, or a card that cleared later — so a listener
  /// attached only around a tap would lose them and the parent would have paid
  /// for nothing.
  void listen({
    required String studentId,
    required void Function(String planCode, String endsAt) onGranted,
    required void Function(String message) onFailed,
  }) {
    _sub?.cancel();
    _sub = _iap.purchaseStream.listen((list) async {
      for (final purchase in list) {
        if (purchase.status == PurchaseStatus.pending) continue;

        if (purchase.status == PurchaseStatus.error ||
            purchase.status == PurchaseStatus.canceled) {
          if (purchase.pendingCompletePurchase) {
            await _iap.completePurchase(purchase);
          }
          if (purchase.status == PurchaseStatus.error) {
            onFailed(
              purchase.error?.message ?? "The payment did not go through",
            );
          }
          continue;
        }

        // purchased or restored — hand the token to the server, which is the
        // only thing that may decide a pass was bought.
        try {
          final granted = await _api.grantTutorPassFromPlay(
            productId: purchase.productID,
            purchaseToken: purchase.verificationData.serverVerificationData,
            studentId: studentId,
          );
          onGranted(purchase.productID, granted);
        } on ApiException catch (e) {
          onFailed(e.message);
          // Deliberately NOT completed: leaving it pending makes Play redeliver
          // on the next launch, which is the parent's second chance. Play
          // refunds it after three days if we never succeed, which is the right
          // outcome — better a refund than money taken for no pass.
          continue;
        } catch (_) {
          onFailed("Could not reach the school server");
          continue;
        }

        // Completed only after the server has granted the pass.
        if (purchase.pendingCompletePurchase) {
          await _iap.completePurchase(purchase);
        }
      }
    });
  }

  /// Launch the store sheet. The outcome arrives on the stream, not here.
  Future<void> buy(ProductDetails product) async {
    await _iap.buyNonConsumable(
      purchaseParam: PurchaseParam(productDetails: product),
    );
  }

  void dispose() {
    _sub?.cancel();
    _sub = null;
  }
}
