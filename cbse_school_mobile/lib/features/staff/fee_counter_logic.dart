/// Pure rules behind the phone's fee counter, kept apart from the widget so
/// they can be tested:
///
///  * a "total paying now" is split across dues in the web counter's order —
///    oldest due date first, then due key (`allocateCollectionToDues`). The
///    server sends each due's rank in that order; this file only follows it,
///    and the server re-derives the split and refuses a mismatch anyway;
///  * every payment that is not cash needs a reference;
///  * a discount the server could not read is "not loaded", never ₹0.
library;

/// One due the total may be spread over.
class AllocDue {
  const AllocDue({
    required this.key,
    required this.dueKey,
    required this.dueOn,
    required this.balancePaise,
    this.rank,
  });

  /// "studentId|dueKey" — the counter's own key for a line.
  final String key;
  final String dueKey;
  final String dueOn;
  final int balancePaise;

  /// Server-sent position in the allocation order; null on an older server.
  final int? rank;
}

class PayingNowSplit {
  const PayingNowSplit._(this.amounts, this.basisPaise, this.error);

  /// key → paise. Every basis due appears, with 0 where nothing reached it.
  final Map<String, int> amounts;

  /// Sum of the basis balances — the most that can be paid now.
  final int basisPaise;

  /// null when the split is good.
  final String? error;

  bool get ok => error == null;
}

/// Spread [totalPaise] over [basis], oldest first. Over-payment is refused
/// (`error` = "over"), as is nothing (`error` = "empty").
PayingNowSplit splitPayingNow(List<AllocDue> basis, int totalPaise) {
  final basisPaise = basis.fold<int>(0, (n, d) => n + d.balancePaise);
  final amounts = {for (final d in basis) d.key: 0};
  if (totalPaise <= 0 || basis.isEmpty) {
    return PayingNowSplit._(amounts, basisPaise, "empty");
  }
  if (totalPaise > basisPaise) {
    return PayingNowSplit._(amounts, basisPaise, "over");
  }
  final indexed = [for (var i = 0; i < basis.length; i++) (i, basis[i])];
  final useRank = basis.every((d) => d.rank != null);
  // Dart's sort is not stable; the index breaks ties the way JS's stable
  // sort keeps input order.
  indexed.sort((a, b) {
    final x = a.$2, y = b.$2;
    int c;
    if (useRank) {
      c = x.rank!.compareTo(y.rank!);
    } else {
      c = x.dueOn.compareTo(y.dueOn);
      if (c == 0) c = x.dueKey.compareTo(y.dueKey);
    }
    return c != 0 ? c : a.$1.compareTo(b.$1);
  });
  var remain = totalPaise;
  for (final (_, d) in indexed) {
    if (remain <= 0) break;
    final take = d.balancePaise < remain ? d.balancePaise : remain;
    if (take <= 0) continue;
    amounts[d.key] = take;
    remain -= take;
  }
  return PayingNowSplit._(amounts, basisPaise, null);
}

/// Parse whole rupees typed into the "total paying now" box. null = empty.
int? payingNowPaiseFrom(String typed) {
  final t = typed.trim();
  if (t.isEmpty) return null;
  final r = int.tryParse(t);
  if (r == null) return null;
  return r * 100;
}

/// True when [mode] needs a reference and [ref] is blank. Cash never does;
/// every other mode does, whatever flags an older server sends.
bool referenceMissing(String mode, String ref) =>
    mode != "cash" && ref.trim().isEmpty;

/// What the fee table says about a due's discount.
enum DiscountState { notLoaded, none, some }

DiscountState discountStateOf(int? discountPaise) {
  if (discountPaise == null) return DiscountState.notLoaded;
  return discountPaise > 0 ? DiscountState.some : DiscountState.none;
}
