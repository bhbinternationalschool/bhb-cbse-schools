"use client";

/**
 * Counter — sell to a student, staff member or walk-in.
 *
 * The flow is deliberately one screen: find the buyer, their class kit is
 * offered, adjust the cart, take money or leave a balance. Prices come from
 * the price list, the discount cap comes with them, and the margin on the
 * cart is visible while you sell rather than discovered at year end.
 *
 * Everything typed here is local component state. The network is touched by a
 * debounced buyer search and by the explicit "Take payment" — never per
 * keystroke.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import {
  FIELD_CLASS,
  InvAlert,
  InvDrawer,
  InvSpinner,
  MoneyField,
  NumberField,
  Pill,
  SelectField,
  StatTile,
  TextField,
} from "@/components/inventory/InvUi";
import {
  invApi,
  useAsync,
  useDebounced,
  useSaver,
} from "@/lib/inventory/client";
import {
  printStoreReceipt,
  StoreReceiptSheet,
} from "@/components/inventory/StoreReceiptSheet";
import {
  formatPaise,
  inputToPaise,
  marginPct,
  paiseToInput,
  saleLineAmounts,
  saleStatusLabel,
  tenderLabel,
  type InvBootstrap,
  type InvBuyerKind,
  type InvBuyerStudent,
  type InvItemRow,
  type InvKitDetail,
  type InvSale,
  type InvTenderMode,
} from "@/lib/inventory/types";

type Section = "sell" | "sales" | "dues";

type TenderRow = {
  id: string;
  mode: InvTenderMode;
  amountInput: string;
  reference: string;
  /** Set once the clerk edits the amount, so auto-defaulting stops. */
  touched?: boolean;
};

let tenderSeq = 0;
const newTenderId = () => `t${++tenderSeq}`;

type CartLine = {
  itemId: string;
  name: string;
  sku: string;
  qty: number;
  unitPricePaise: number;
  maxDiscountPct: number;
  /**
   * Always the value sent to the server — the cap lives on the price list as
   * a percentage, so a flat ₹ discount travels as its exact equivalent
   * percentage and the same cap holds either way.
   */
  discountPct: number;
  /** How the clerk is typing the discount: as a % or as flat rupees. */
  discMode: "pct" | "flat";
  /** The flat ₹ amount as typed, kept so a qty change can re-derive the %. */
  flatInput: string;
  gstRate: number;
  costPaise: number;
};

/** The most a flat discount can be: exactly what the percentage cap allows. */
function flatCapPaise(l: { qty: number; unitPricePaise: number; maxDiscountPct: number }) {
  return Math.floor((l.qty * l.unitPricePaise * l.maxDiscountPct) / 100);
}

/**
 * Re-derive discountPct from what was typed. In flat mode the % is the exact
 * equivalent of the rupees — clamped to the cap when within it, and left OVER
 * the cap when not, so the same "above the allowed" refusal fires either way.
 */
function withDisc(l: CartLine): CartLine {
  if (l.discMode !== "flat") return l;
  const gross = l.qty * l.unitPricePaise;
  const flat = inputToPaise(l.flatInput);
  if (gross <= 0 || flat <= 0) return { ...l, discountPct: 0 };
  const pct = (flat * 100) / gross;
  return {
    ...l,
    discountPct:
      flat <= flatCapPaise(l) ? Math.min(pct, l.maxDiscountPct) : pct,
  };
}

const TENDERS: InvTenderMode[] = ["cash", "upi", "card", "cheque", "bank"];

export function CounterTab({
  boot,
  classes,
  sections,
}: {
  boot: InvBootstrap;
  classes: { id: string; label: string }[];
  sections: { id: string; classId: string; label: string }[];
}) {
  const [section, setSection] = useState<Section>("sell");
  const summary = useAsync(() => invApi.counterSummary(), []);

  const s = summary.data;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Sold today"
          value={s ? formatPaise(s.billedTodayPaise) : "—"}
          sub={s ? `${s.salesToday} sale${s.salesToday === 1 ? "" : "s"}` : ""}
        />
        <StatTile
          label="Collected today"
          value={s ? formatPaise(s.collectedTodayPaise) : "—"}
          tone="good"
          sub="includes older dues"
        />
        <StatTile
          label="Margin today"
          value={s ? formatPaise(s.marginTodayPaise) : "—"}
          tone={s && s.marginTodayPaise < 0 ? "bad" : "neutral"}
        />
        <StatTile
          label="Outstanding"
          value={s ? formatPaise(s.outstandingPaise) : "—"}
          tone={s && s.outstandingPaise > 0 ? "warn" : "neutral"}
          sub={s ? `${s.outstandingCount} unpaid` : ""}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { id: "sell", label: "New sale" },
            { id: "sales", label: "Sales" },
            { id: "dues", label: "Unpaid" },
          ] as { id: Section; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id)}
            className={
              section === t.id
                ? "rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                : "rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "sell" ? (
        <SellSection
          boot={boot}
          classes={classes}
          sections={sections}
          onSold={() => {
            summary.reload();
            setSection("sales");
          }}
        />
      ) : null}
      {section === "sales" ? (
        <SalesSection classes={classes} sections={sections} onChanged={summary.reload} />
      ) : null}
      {section === "dues" ? (
        <SalesSection
          classes={classes}
          sections={sections}
          onlyUnpaid
          onChanged={summary.reload}
        />
      ) : null}
    </div>
  );
}

/* ─── New sale ─────────────────────────────────────────────── */

function SellSection({
  boot,
  classes,
  sections,
  onSold,
}: {
  boot: InvBootstrap;
  classes: { id: string; label: string }[];
  sections: { id: string; classId: string; label: string }[];
  onSold: () => void;
}) {
  const saver = useSaver();

  const [buyerKind, setBuyerKind] = useState<InvBuyerKind>("student");
  const [student, setStudent] = useState<InvBuyerStudent | null>(null);
  const [walkinName, setWalkinName] = useState("");
  const [walkinPhone, setWalkinPhone] = useState("");
  const [staffName, setStaffName] = useState("");

  const [buyerSearch, setBuyerSearch] = useState("");
  const debouncedBuyer = useDebounced(buyerSearch, 300);
  // Browsing by class/section lists that roster with no typing at all — the
  // clerk serving a queue of one class should not have to spell each name.
  const [browseClass, setBrowseClass] = useState("");
  const [browseSection, setBrowseSection] = useState("");
  const buyers = useAsync(
    () =>
      buyerKind === "student" &&
      (debouncedBuyer.trim().length >= 2 || browseClass)
        ? invApi.findStudents(debouncedBuyer, browseClass, browseSection)
        : Promise.resolve([] as InvBuyerStudent[]),
    [debouncedBuyer, buyerKind, browseClass, browseSection],
  );

  const [locationId, setLocationId] = useState(
    boot.settings.defaultLocationId || boot.locations[0]?.id || "",
  );
  const priceListId =
    boot.settings.defaultPriceListId ||
    boot.priceLists.find((l) => l.isDefault)?.id ||
    boot.priceLists[0]?.id ||
    "";

  const catalogue = useAsync(
    () =>
      invApi.listItems({
        status: "active",
        pageSize: 300,
        sort: "name",
        priceListId,
      }),
    [priceListId],
  );
  const kits = useAsync(() => invApi.listKits({ status: "active" }), []);

  /**
   * What this child already took this year. Fetched when they are chosen, so
   * the clerk sees "already has this" while the cart is still open rather than
   * after the receipt is printed.
   */
  const [alreadyBought, setAlreadyBought] = useState<
    { itemId: string; itemName: string; totalQty: number; lastSaleDate: string; lastSaleNo: string }[]
  >([]);
  /**
   * This student's sales THIS session, shown under the buyer the moment they
   * are picked — the clerk sees what the child already took (and can open the
   * receipt) before ringing anything up, instead of finding out afterwards.
   */
  const [priorSales, setPriorSales] = useState<InvSale[]>([]);

  // Who else is in this family. Fetched alongside the purchase history so the
  // clerk can serve all of them without searching for each child by name.
  useEffect(() => {
    const hh = buyerKind === "student" ? student?.householdId : "";
    if (!hh) {
      setSiblings([]);
      setFamilyMode(false);
      return;
    }
    let live = true;
    void invApi
      .householdSiblings(hh)
      .then((rows) => {
        if (live) setSiblings(rows);
      })
      .catch(() => {
        if (live) setSiblings([]);
      });
    return () => {
      live = false;
    };
  }, [buyerKind, student?.id, student?.householdId]);

  useEffect(() => {
    const id = buyerKind === "student" ? student?.id : "";
    if (!id) {
      setPriorSales([]);
      return;
    }
    let live = true;
    void invApi
      .listSales({ studentId: id, status: "all", pageSize: 50 })
      .then((page) => {
        if (live) setPriorSales(page.rows.filter((s) => s.status !== "void"));
      })
      .catch(() => {
        if (live) setPriorSales([]);
      });
    return () => {
      live = false;
    };
  }, [buyerKind, student?.id]);

  useEffect(() => {
    const id = buyerKind === "student" ? student?.id : "";
    if (!id) {
      setAlreadyBought([]);
      return;
    }
    let live = true;
    void invApi
      .studentPurchases(id)
      .then((rows) => {
        if (live) setAlreadyBought(rows);
      })
      // A failed lookup must not stop a sale. The warning is a courtesy; the
      // "bought twice" report still catches whatever slips through.
      .catch(() => {
        if (live) setAlreadyBought([]);
      });
    return () => {
      live = false;
    };
  }, [buyerKind, student?.id]);

  const [soloCart, setSoloCart] = useState<CartLine[]>([]);

  /**
   * Serving a whole family.
   *
   * One cart per child, because the sale posted for each of them is their own —
   * their receipt, their dues line at the fee counter, their ledger party. Only
   * the payment is shared. `cart` below is a facade over whichever child is in
   * front of the clerk, so every existing cart action keeps working unchanged
   * whether one child is being served or four.
   */
  const [familyMode, setFamilyMode] = useState(false);
  const [siblings, setSiblings] = useState<InvBuyerStudent[]>([]);
  const [carts, setCarts] = useState<Record<string, CartLine[]>>({});
  const [activeChild, setActiveChild] = useState("");

  const cart: CartLine[] = familyMode ? (carts[activeChild] ?? []) : soloCart;
  const setCart = useCallback(
    (next: CartLine[] | ((prev: CartLine[]) => CartLine[])) => {
      if (!familyMode) {
        setSoloCart(next as never);
        return;
      }
      setCarts((prev) => {
        const current = prev[activeChild] ?? [];
        const value =
          typeof next === "function"
            ? (next as (p: CartLine[]) => CartLine[])(current)
            : next;
        return { ...prev, [activeChild]: value };
      });
    },
    [familyMode, activeChild],
  );
  const [kitId, setKitId] = useState("");
  const [note, setNote] = useState("");
  const [manualReceiptNo, setManualReceiptNo] = useState("");
  const [saleDate, setSaleDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  /** The just-posted sale(s), fetched back in full for the printable receipt. */
  const [receiptSales, setReceiptSales] = useState<InvSale[] | null>(null);

  /**
   * One row per way the money arrived. A parent paying ₹800 cash and ₹1,200
   * by UPI is one sale with two tenders, the same shape the fee counter uses,
   * and the same shape inv_sale_payments has always stored.
   */
  const [tenders, setTenders] = useState<TenderRow[]>([
    { id: newTenderId(), mode: "cash", amountInput: "", reference: "" },
  ]);
  const [onAccount, setOnAccount] = useState(false);

  const itemsById = useMemo(() => {
    const m = new Map<string, InvItemRow>();
    for (const r of catalogue.data?.rows ?? []) m.set(r.id, r);
    return m;
  }, [catalogue.data]);

  /** Kits assigned to this buyer's class — what they are due to receive. */
  const suggestedKits = useMemo(() => {
    const all = kits.data ?? [];
    if (buyerKind !== "student" || !student?.classId) return [];
    return all.filter((k) => k.classIds.includes(student.classId));
  }, [kits.data, buyerKind, student?.classId]);

  function toLine(item: InvItemRow, qty: number): CartLine {
    return {
      itemId: item.id,
      name: item.name + (item.variantLabel ? ` — ${item.variantLabel}` : ""),
      sku: item.sku,
      qty,
      unitPricePaise: item.salePaise,
      maxDiscountPct: item.maxDiscountPct,
      discountPct: 0,
      discMode: "pct",
      flatInput: "",
      gstRate: item.gstRate,
      costPaise: item.avgCostPaise,
    };
  }

  function addItem(itemId: string) {
    const item = itemsById.get(itemId);
    if (!item) return;
    // Already taken this session? Ask before it goes in the cart — the clerk
    // decides with the earlier receipt in front of them, rather than
    // discovering the repeat after the money is taken.
    const prior = alreadyBought.find((p) => p.itemId === itemId);
    const inCart = cart.some((l) => l.itemId === itemId);
    if (prior && !inCart) {
      const ok = window.confirm(
        `${student?.fullName ?? "This student"} already took ${prior.itemName}` +
          ` × ${prior.totalQty} this session` +
          (prior.lastSaleNo
            ? ` (last on ${prior.lastSaleDate}, receipt ${prior.lastSaleNo})`
            : "") +
          `.\n\nSell it again — a replacement or an extra copy?`,
      );
      if (!ok) return;
    }
    setCart((c) =>
      c.some((l) => l.itemId === itemId)
        ? c.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + 1 } : l))
        : [...c, toLine(item, 1)],
    );
  }

  /** Load a kit's required lines into the cart in one action. */
  function loadKit(kit: InvKitDetail) {
    setKitId(kit.id);
    setCart((existing) => {
      const next = [...existing];
      for (const kl of kit.items) {
        if (kl.isOptional) continue;
        const item = itemsById.get(kl.itemId);
        if (!item) continue;
        const at = next.findIndex((l) => l.itemId === kl.itemId);
        if (at >= 0) next[at] = { ...next[at], qty: next[at].qty + kl.qty };
        else next.push(toLine(item, kl.qty));
      }
      return next;
    });
  }

  /**
   * Give every child their class kit in one action — only carts that are
   * still empty are filled, so a second click cannot double anything.
   */
  function loadFamilyKits() {
    const all = kits.data ?? [];
    setCarts((prev) => {
      const next = { ...prev };
      for (const child of siblings) {
        if ((next[child.id] ?? []).length > 0) continue;
        const kit = all.find((k) => k.classIds.includes(child.classId));
        if (!kit) continue;
        const lines: CartLine[] = [];
        for (const kl of kit.items) {
          if (kl.isOptional) continue;
          const item = itemsById.get(kl.itemId);
          if (!item) continue;
          const at = lines.findIndex((l) => l.itemId === kl.itemId);
          if (at >= 0) lines[at] = { ...lines[at], qty: lines[at].qty + kl.qty };
          else lines.push(toLine(item, kl.qty));
        }
        if (lines.length > 0) next[child.id] = lines;
      }
      return next;
    });
  }

  const totals = useMemo(() => {
    let gross = 0;
    let discount = 0;
    let tax = 0;
    let cost = 0;
    for (const l of cart) {
      const a = saleLineAmounts({
        qty: l.qty,
        unitPricePaise: l.unitPricePaise,
        discountPct: l.discountPct,
        gstRate: l.gstRate,
      });
      gross += a.grossPaise;
      discount += a.discountPaise;
      tax += a.taxPaise;
      cost += Math.round(l.costPaise * l.qty);
    }
    const total = gross - discount + tax;
    return { gross, discount, tax, total, cost, margin: total - cost };
  }, [cart]);

  /** Per-child totals, so a chip can show what that child's books come to. */
  const childTotals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, lines] of Object.entries(carts)) {
      out[id] = lines.reduce((n, l) => {
        const gross = l.qty * l.unitPricePaise;
        const disc = Math.round((gross * l.discountPct) / 100);
        const net = gross - disc;
        return n + net + Math.round((net * l.gstRate) / 100);
      }, 0);
    }
    return out;
  }, [carts]);

  const familyTotal = useMemo(
    () => Object.values(childTotals).reduce((n, v) => n + v, 0),
    [childTotals],
  );

  const familyChildrenWithItems = useMemo(
    () => siblings.filter((c) => (carts[c.id] ?? []).length > 0),
    [siblings, carts],
  );

  /**
   * What the parent is actually paying for. In family mode that is every
   * child's cart, not just the one on screen — tendering against the child in
   * front of the clerk would refuse the family's own money as an overpayment.
   */
  const payableTotal = familyMode ? familyTotal : totals.total;

  // Default the FIRST tender to the full amount, until the clerk edits it,
  // splits the payment, or puts the sale on account. Only the first row is
  // touched: once a second way of paying exists the clerk is driving.
  useEffect(() => {
    if (onAccount) return;
    setTenders((rows) => {
      if (rows.length !== 1) return rows;
      const only = rows[0]!;
      if (only.touched) return rows;
      return [
        {
          ...only,
          amountInput: payableTotal > 0 ? paiseToInput(payableTotal) : "",
        },
      ];
    });
  }, [payableTotal, onAccount]);

  const tenderPaise = onAccount
    ? 0
    : tenders.reduce((n, t) => n + inputToPaise(t.amountInput), 0);
  const balancePaise = Math.max(0, payableTotal - tenderPaise);

  /**
   * A payment that is not cash left a trail somewhere — a UPI reference, a
   * cheque number, a card slip. Without it a disputed payment cannot be traced
   * to the bank, so the counter refuses rather than recording money it cannot
   * later prove arrived.
   */
  const missingRef = tenders.some(
    (t) =>
      !onAccount &&
      t.mode !== "cash" &&
      inputToPaise(t.amountInput) > 0 &&
      t.reference.trim() === "",
  );

  const buyerReady =
    buyerKind === "student"
      ? !!student
      : buyerKind === "walkin"
        ? walkinName.trim().length > 0
        : staffName.trim().length > 0;

  /**
   * Items in the cart this child has already been sold this year. A warning,
   * deliberately not a block — a replacement set in March is ordinary, and a
   * counter that refuses honest work simply gets worked around.
   */
  const repeats = useMemo(() => {
    if (alreadyBought.length === 0) return [];
    const prior = new Map(alreadyBought.map((p) => [p.itemId, p]));
    return cart
      .map((l) => ({ line: l, prior: prior.get(l.itemId) }))
      .filter((x): x is { line: CartLine; prior: NonNullable<typeof x.prior> } =>
        Boolean(x.prior),
      );
  }, [cart, alreadyBought]);

  const capBreach = cart.find((l) => l.discountPct > l.maxDiscountPct);
  const overTender = tenderPaise > payableTotal;

  function reset() {
    setSoloCart([]);
    setCarts({});
    setFamilyMode(false);
    setActiveChild("");
    setSiblings([]);
    setKitId("");
    setStudent(null);
    setWalkinName("");
    setWalkinPhone("");
    setStaffName("");
    setBuyerSearch("");
    setBrowseClass("");
    setBrowseSection("");
    setNote("");
    setManualReceiptNo("");
    setSaleDate(new Date().toISOString().slice(0, 10));
    setTenders([
      { id: newTenderId(), mode: "cash", amountInput: "", reference: "" },
    ]);
    setOnAccount(false);
  }

  /** Serve every child who has something in their cart, on one payment. */
  async function sellFamily() {
    if (capBreach || overTender || missingRef) return;
    if (familyChildrenWithItems.length === 0) return;

    const res = await saver.run(() =>
      invApi.postHouseholdSale({
        sales: familyChildrenWithItems.map((child) => ({
          sale_date: saleDate,
          buyer_kind: "student",
          student_id: child.id,
          buyer_name: child.fullName,
          buyer_phone: child.phone,
          class_id: child.classId,
          section_id: child.sectionId,
          location_id: locationId,
          price_list_id: priceListId,
          note,
          lines: (carts[child.id] ?? []).map((l) => ({
            item_id: l.itemId,
            qty: l.qty,
            unit_price_paise: l.unitPricePaise,
            discount_pct: l.discountPct,
            gst_rate: l.gstRate,
          })),
        })),
        payments: onAccount
          ? []
          : tenders
              .filter((t) => inputToPaise(t.amountInput) > 0)
              .map((t) => ({
                amountPaise: inputToPaise(t.amountInput),
                mode: t.mode,
                reference: t.reference.trim(),
                paidOn: saleDate,
              })),
        manualReceiptNo: manualReceiptNo.trim() || undefined,
      }),
    );

    if (res) {
      saver.setNotice(
        `${res.sales.length} receipts — ${res.sales
          .map((x) => `${x.buyerName} ${x.saleNo}`)
          .join(", ")}${
          res.balancePaise > 0
            ? `. ${formatPaise(res.balancePaise)} left on account.`
            : ". Paid in full."
        }`,
      );
      reset();
      const fetched = (
        await Promise.all(
          res.sales.map((x) =>
            invApi
              .listSales({ saleId: x.saleId })
              .then((r) => r.rows)
              .catch(() => [] as InvSale[]),
          ),
        )
      ).flat();
      if (fetched.length > 0) setReceiptSales(fetched);
      else onSold();
    }
  }

  async function sell() {
    if (familyMode) {
      await sellFamily();
      return;
    }
    if (!buyerReady || cart.length === 0 || capBreach || overTender) return;
    if (missingRef) return;

    const res = await saver.run(() =>
      invApi.postSale({
        buyerKind,
        studentId: buyerKind === "student" ? student?.id : "",
        buyerName:
          buyerKind === "student"
            ? (student?.fullName ?? "")
            : buyerKind === "walkin"
              ? walkinName.trim()
              : staffName.trim(),
        buyerPhone: buyerKind === "walkin" ? walkinPhone.trim() : (student?.phone ?? ""),
        classId: buyerKind === "student" ? (student?.classId ?? "") : "",
        sectionId: buyerKind === "student" ? (student?.sectionId ?? "") : "",
        locationId,
        priceListId,
        kitId: kitId || undefined,
        saleDate,
        manualReceiptNo: manualReceiptNo.trim() || undefined,
        note,
        lines: cart.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          unitPricePaise: l.unitPricePaise,
          discountPct: l.discountPct,
          gstRate: l.gstRate,
        })),
        payments: onAccount
          ? []
          : tenders
              .filter((t) => inputToPaise(t.amountInput) > 0)
              .map((t) => ({
                amountPaise: inputToPaise(t.amountInput),
                mode: t.mode,
                reference: t.reference.trim(),
              })),
      }),
    );

    if (res) {
      saver.setNotice(
        res.balancePaise > 0
          ? `${res.saleNo} — ${formatPaise(res.paidPaise)} taken, ${formatPaise(res.balancePaise)} left on account`
          : `${res.saleNo} — paid in full, ${formatPaise(res.totalPaise)}`,
      );
      reset();
      const fetched = await invApi
        .listSales({ saleId: res.saleId })
        .then((r) => r.rows)
        .catch(() => [] as InvSale[]);
      if (fetched.length > 0) setReceiptSales(fetched);
      else onSold();
    }
  }

  const classLabel = useMemo(() => {
    const m = new Map(classes.map((c) => [c.id, c.label]));
    return (id: string) => m.get(id) ?? id;
  }, [classes]);

  const sectionLabel = useMemo(() => {
    const m = new Map(sections.map((x) => [x.id, x.label]));
    return (id: string) => (id ? (m.get(id) ?? "") : "");
  }, [sections]);

  const classSectionOf = useCallback(
    (classId: string, sectionId: string) => {
      const cls = classLabel(classId);
      const sec = sectionLabel(sectionId);
      return sec ? `${cls}-${sec}` : cls;
    },
    [classLabel, sectionLabel],
  );

  const unpricedInCart = cart.filter((l) => l.unitPricePaise <= 0);

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <InvAlert
          error={saver.error}
          notice={saver.notice}
          onDismiss={() => {
            saver.setError("");
            saver.setNotice("");
          }}
        />

        {/* Buyer */}
        <section className="space-y-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: "student", label: "Student" },
                { id: "staff", label: "Staff" },
                { id: "walkin", label: "Walk-in" },
              ] as const
            )
              .filter((b) => b.id !== "walkin" || boot.settings.walkinSalesEnabled)
              .map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setBuyerKind(b.id);
                    setStudent(null);
                  }}
                  className={
                    buyerKind === b.id
                      ? "rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white"
                      : "rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
                  }
                >
                  {b.label}
                </button>
              ))}
          </div>

          {buyerKind === "student" ? (
            student ? (
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <div>
                  <div className="font-medium">
                    {student.fullName}
                    {student.fatherName ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {student.fatherName}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {classSectionOf(student.classId, student.sectionId)}
                    {student.rollNo ? ` · Roll ${student.rollNo}` : ""}
                    {student.admissionNo ? ` · Adm ${student.admissionNo}` : ""}
                    {student.phone ? ` · ${student.phone}` : ""}
                  </div>
                </div>
                <Button variant="ghost" size="xs" onClick={() => setStudent(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      className={`${FIELD_CLASS} w-full pl-8`}
                      placeholder="Search by name, admission no., roll or parent's phone"
                      value={buyerSearch}
                      onChange={(e) => setBuyerSearch(e.target.value)}
                    />
                  </div>
                  <SelectField
                    label=""
                    className="w-[130px]"
                    value={browseClass}
                    placeholder="Any class"
                    options={classes.map((c) => ({ value: c.id, label: c.label }))}
                    onChange={(v) => {
                      setBrowseClass(v);
                      setBrowseSection("");
                    }}
                  />
                  {browseClass ? (
                    <SelectField
                      label=""
                      className="w-[110px]"
                      value={browseSection}
                      placeholder="All sections"
                      options={sections
                        .filter((x) => x.classId === browseClass)
                        .map((x) => ({ value: x.id, label: x.label }))}
                      onChange={setBrowseSection}
                    />
                  ) : null}
                </div>
                {buyers.loading &&
                (debouncedBuyer.trim().length >= 2 || browseClass) ? (
                  <p className="px-1 text-xs text-muted-foreground">Searching…</p>
                ) : null}
                {(buyers.data ?? []).length > 0 ? (
                  <ul className="max-h-52 divide-y overflow-y-auto rounded-lg border">
                    {(buyers.data ?? []).map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setStudent(s);
                            setBuyerSearch("");
                          }}
                        >
                          <div className="font-medium">{s.fullName}</div>
                          <div className="text-xs text-muted-foreground">
                            {classSectionOf(s.classId, s.sectionId)}
                            {s.rollNo ? ` · Roll ${s.rollNo}` : ""}
                            {s.admissionNo ? ` · Adm ${s.admissionNo}` : ""}
                            {s.fatherName ? ` · ${s.fatherName}` : ""}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (debouncedBuyer.trim().length >= 2 || browseClass) &&
                  !buyers.loading ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    No student matches that.
                  </p>
                ) : null}
              </div>
            )
          ) : buyerKind === "walkin" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <TextField
                label="Buyer name"
                required
                value={walkinName}
                onChange={setWalkinName}
              />
              <TextField label="Phone" value={walkinPhone} onChange={setWalkinPhone} />
            </div>
          ) : (
            <TextField
              label="Staff member"
              required
              value={staffName}
              onChange={setStaffName}
            />
          )}

          {/* What this child already took this session — with their receipts */}
          {buyerKind === "student" && student && priorSales.length > 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
              <p className="text-xs font-semibold">
                {student.fullName.split(" ")[0]} already bought{" "}
                {priorSales.length} time{priorSales.length === 1 ? "" : "s"} this
                session
              </p>
              <ul className="mt-1.5 space-y-1">
                {priorSales.slice(0, 6).map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5 text-xs"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{s.saleNo}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {s.saleDate} ·{" "}
                        {s.lines
                          .map((l) => `${l.itemName}${l.qty > 1 ? ` ×${l.qty}` : ""}`)
                          .join(", ")}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums">
                        {formatPaise(s.totalPaise)}
                      </span>
                      {s.balancePaise > 0 ? (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
                          {formatPaise(s.balancePaise)} due
                        </span>
                      ) : null}
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setReceiptSales([s])}
                      >
                        Receipt
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* Kit suggestion */}
        {suggestedKits.length > 0 ? (
          <section className="space-y-2 rounded-xl border border-sky-500/40 bg-sky-500/5 p-3">
            <p className="text-xs font-medium">
              Kits for {classLabel(student?.classId ?? "")}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestedKits.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => loadKit(k)}
                  className="rounded-lg border bg-background px-3 py-2 text-left text-sm hover:border-ring"
                >
                  <div className="font-medium">{k.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {k.items.filter((i) => !i.isOptional).length} items ·{" "}
                    {formatPaise(k.effectivePricePaise)}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Cart */}
        <section className="space-y-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${FIELD_CLASS} w-full flex-1`}
              value=""
              onChange={(e) => {
                addItem(e.target.value);
                e.currentTarget.selectedIndex = 0;
              }}
            >
              <option value="">
                {catalogue.loading ? "Loading catalogue…" : "Add an item…"}
              </option>
              {(catalogue.data?.rows ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.variantLabel ? ` — ${r.variantLabel}` : ""} ·{" "}
                  {r.salePaise ? formatPaise(r.salePaise) : "not priced"}
                </option>
              ))}
            </select>
            <SelectField
              label=""
              className="w-[150px]"
              value={locationId}
              options={boot.locations
                .filter((l) => l.isActive)
                .map((l) => ({ value: l.id, label: l.name }))}
              onChange={setLocationId}
            />
          </div>

          {/* Serving the family: one tab per child, each with their own cart. */}
          {siblings.length > 1 && buyerKind === "student" ? (
            <div className="space-y-2 rounded-lg border p-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={familyMode}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setFamilyMode(on);
                    if (on) {
                      // Carry what is already in the cart over to the child it
                      // was being built for, so switching mode never loses work.
                      const id = student?.id ?? "";
                      setActiveChild(id);
                      setCarts((prev) =>
                        soloCart.length > 0 && !prev[id]
                          ? { ...prev, [id]: soloCart }
                          : prev,
                      );
                    }
                  }}
                />
                Serve all {siblings.length} children of this family on one
                payment
              </label>

              {familyMode ? (
                <>
                  <div className="flex flex-wrap gap-1">
                    {siblings.map((child) => {
                      const lines = (carts[child.id] ?? []).length;
                      const active = child.id === activeChild;
                      return (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => setActiveChild(child.id)}
                          className={
                            active
                              ? "rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background"
                              : "rounded-md border px-2 py-1 text-xs hover:bg-muted"
                          }
                        >
                          {child.fullName}
                          {child.classId ? (
                            <span className="ml-1 opacity-70">
                              {classSectionOf(child.classId, child.sectionId)}
                            </span>
                          ) : null}
                          {lines > 0 ? (
                            <span className="ml-1 font-semibold">
                              · {formatPaise(childTotals[child.id] ?? 0)}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      Each child gets their own receipt and their own balance —
                      only the payment is shared. Nothing is posted until every
                      child&rsquo;s books go through together.
                    </p>
                    <Button
                      variant="outline"
                      size="xs"
                      className="shrink-0"
                      onClick={loadFamilyKits}
                      disabled={kits.loading}
                    >
                      Give each child their class kit
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {cart.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {familyMode
                ? "Nothing for this child yet — add their items, or pick another child above."
                : "Nothing in the cart yet."}
            </p>
          ) : (
            <div className="space-y-2">
              {cart.map((l, idx) => {
                const a = saleLineAmounts({
                  qty: l.qty,
                  unitPricePaise: l.unitPricePaise,
                  discountPct: l.discountPct,
                  gstRate: l.gstRate,
                });
                const over = l.discountPct > l.maxDiscountPct;
                const capFlat = flatCapPaise(l);
                const patch = (p: Partial<CartLine>) =>
                  setCart((c) =>
                    c.map((x, i) => (i === idx ? withDisc({ ...x, ...p }) : x)),
                  );
                return (
                  <div key={l.itemId} className="rounded-lg border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{l.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {l.sku} · {formatPaise(l.unitPricePaise)} each
                          {l.maxDiscountPct
                            ? ` · up to ${l.maxDiscountPct}% (${formatPaise(capFlat)}) off`
                            : " · no discount allowed"}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setCart((c) => c.filter((_, i) => i !== idx))}
                        aria-label="Remove"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-end gap-2">
                      <NumberField
                        label="Qty"
                        className="w-20"
                        value={String(l.qty)}
                        onChange={(v) => patch({ qty: Number(v) || 0 })}
                      />
                      <div className="w-32">
                        <div className="mb-1 flex items-center gap-1">
                          <span className="text-[11px] text-muted-foreground">
                            Discount
                          </span>
                          {(["pct", "flat"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() =>
                                patch(
                                  m === "flat"
                                    ? {
                                        discMode: "flat",
                                        // Carry the current % over as rupees,
                                        // so switching modes changes nothing.
                                        flatInput: l.discountPct
                                          ? paiseToInput(
                                              Math.round(
                                                (l.qty *
                                                  l.unitPricePaise *
                                                  l.discountPct) /
                                                  100,
                                              ),
                                            )
                                          : "",
                                      }
                                    : {
                                        discMode: "pct",
                                        discountPct:
                                          Math.round(l.discountPct * 100) / 100,
                                      },
                                )
                              }
                              className={
                                l.discMode === m
                                  ? "rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background"
                                  : "rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted"
                              }
                            >
                              {m === "pct" ? "%" : "₹"}
                            </button>
                          ))}
                        </div>
                        {l.discMode === "flat" ? (
                          <MoneyField
                            label=""
                            value={l.flatInput}
                            onChange={(v) => patch({ flatInput: v })}
                          />
                        ) : (
                          <NumberField
                            label=""
                            suffix="%"
                            value={l.discountPct ? String(l.discountPct) : ""}
                            onChange={(v) => patch({ discountPct: Number(v) || 0 })}
                          />
                        )}
                      </div>
                      <div className="flex-1 text-right text-sm">
                        <div className="font-medium tabular-nums">
                          {formatPaise(a.lineTotalPaise + a.taxPaise)}
                        </div>
                        {a.discountPaise ? (
                          <div className="text-[11px] text-muted-foreground">
                            less {formatPaise(a.discountPaise)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {over ? (
                      <p className="mt-1 text-[11px] text-destructive">
                        {l.discMode === "flat"
                          ? `More than the ${formatPaise(capFlat)} (${l.maxDiscountPct}%) allowed on this item — this sale will be refused.`
                          : `Above the ${l.maxDiscountPct}% allowed on this item — this sale will be refused.`}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Payment panel */}
      <aside className="space-y-3">
        <div className="sticky top-2 space-y-3 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">Payment</h3>

          <div className="space-y-1 text-sm">
            <Row label="Items" value={formatPaise(totals.gross)} />
            {totals.discount ? (
              <Row
                label="Discount"
                value={`− ${formatPaise(totals.discount)}`}
                muted
              />
            ) : null}
            {totals.tax ? (
              <Row label="GST" value={formatPaise(totals.tax)} muted />
            ) : null}
            <div className="mt-1 flex justify-between border-t pt-1 text-base font-semibold">
              <span>{familyMode ? "This child" : "Total"}</span>
              <span className="tabular-nums">{formatPaise(totals.total)}</span>
            </div>
            {familyMode ? (
              <div className="flex justify-between border-t pt-1 text-base font-semibold">
                <span>
                  Family total
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                    {familyChildrenWithItems.length} child
                    {familyChildrenWithItems.length === 1 ? "" : "ren"}
                  </span>
                </span>
                <span className="tabular-nums">{formatPaise(familyTotal)}</span>
              </div>
            ) : null}
            {totals.total > 0 && totals.cost > 0 ? (
              <div className="text-[11px] text-muted-foreground">
                Margin {formatPaise(totals.margin)} (
                {marginPct(totals.total, totals.cost)}%)
              </div>
            ) : null}
          </div>

          {repeats.length > 0 ? (
            <div className="rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
              <p className="font-semibold">
                {student?.fullName || "This student"} already has{" "}
                {repeats.length === 1 ? "this" : "some of this"} year:
              </p>
              <ul className="mt-1 space-y-0.5">
                {repeats.map(({ prior }) => (
                  <li key={prior.itemId}>
                    {prior.itemName} × {prior.totalQty} — last on{" "}
                    {prior.lastSaleDate} ({prior.lastSaleNo})
                  </li>
                ))}
              </ul>
              <p className="mt-1 opacity-90">
                Sell it again if it is a genuine replacement; check the earlier
                receipt first if it is not.
              </p>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={onAccount}
              disabled={!boot.settings.allowCreditSales}
              onChange={(e) => {
                setOnAccount(e.target.checked);
                // Putting it all on account clears the tenders, so a
                // half-typed amount cannot survive as a phantom payment.
                if (e.target.checked)
                  setTenders([
                    {
                      id: newTenderId(),
                      mode: "cash",
                      amountInput: "",
                      reference: "",
                    },
                  ]);
              }}
            />
            Put the whole amount on account
          </label>

          {!onAccount ? (
            <div className="space-y-3">
              {tenders.map((row, idx) => {
                const needsRef =
                  row.mode !== "cash" &&
                  inputToPaise(row.amountInput) > 0 &&
                  row.reference.trim() === "";
                const patch = (next: Partial<TenderRow>) =>
                  setTenders((rows) =>
                    rows.map((r) => (r.id === row.id ? { ...r, ...next } : r)),
                  );
                return (
                  <div
                    key={row.id}
                    className="space-y-2 rounded-lg border p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {TENDERS.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => patch({ mode: t })}
                            className={
                              row.mode === t
                                ? "rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background"
                                : "rounded-md border px-2 py-1 text-xs hover:bg-muted"
                            }
                          >
                            {tenderLabel(t)}
                          </button>
                        ))}
                      </div>
                      {tenders.length > 1 ? (
                        <button
                          type="button"
                          className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                          onClick={() =>
                            setTenders((rows) =>
                              rows.filter((r) => r.id !== row.id),
                            )
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <MoneyField
                      label={
                        tenders.length > 1
                          ? `Amount by ${tenderLabel(row.mode)}`
                          : "Amount taken"
                      }
                      hint={
                        idx === 0 && tenders.length === 1
                          ? "Leave less than the total to bill the rest"
                          : undefined
                      }
                      value={row.amountInput}
                      onChange={(v) => patch({ amountInput: v, touched: true })}
                    />

                    {row.mode !== "cash" ? (
                      <>
                        <TextField
                          label="Transaction ID"
                          value={row.reference}
                          onChange={(v) => patch({ reference: v })}
                        />
                        {needsRef ? (
                          <p className="text-xs text-destructive">
                            A {tenderLabel(row.mode)} payment needs its
                            transaction ID before this sale can be taken.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              })}

              <button
                type="button"
                className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                onClick={() =>
                  setTenders((rows) => [
                    ...rows,
                    {
                      id: newTenderId(),
                      mode: "cash",
                      amountInput: "",
                      reference: "",
                      touched: true,
                    },
                  ])
                }
              >
                Add another way of paying
              </button>

              {tenders.length > 1 ? (
                <p className="text-xs text-muted-foreground">
                  Taken in total: {formatPaise(tenderPaise)} of{" "}
                  {formatPaise(payableTotal)}
                </p>
              ) : null}
            </div>
          ) : null}

          {balancePaise > 0 ? (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {formatPaise(balancePaise)} will stay owing on this sale.
              <div className="mt-1 text-[11px] opacity-90">
                It will also appear on this child&rsquo;s fee counter card, and
                can be settled with a fee receipt.
              </div>
            </div>
          ) : null}

          {missingRef ? (
            <p className="text-xs text-destructive">
              Add the transaction ID for every payment that is not cash.
            </p>
          ) : null}

          {overTender ? (
            <p className="text-xs text-destructive">
              More than the total — reduce the amount taken.
            </p>
          ) : null}
          {unpricedInCart.length > 0 ? (
            <p className="text-xs text-amber-600">
              {unpricedInCart.length} item
              {unpricedInCart.length === 1 ? " has" : "s have"} no price on this
              list.
            </p>
          ) : null}

          <TextField
            label="Sold on"
            type="date"
            value={saleDate}
            onChange={setSaleDate}
          />
          <TextField
            label="Book receipt no (manual)"
            value={manualReceiptNo}
            onChange={setManualReceiptNo}
          />
          <TextField label="Note" value={note} onChange={setNote} />

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={reset}>
              Clear
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={sell}
              disabled={
                saver.saving ||
                !buyerReady ||
                (familyMode
                  ? familyChildrenWithItems.length === 0
                  : cart.length === 0) ||
                !!capBreach ||
                overTender ||
                missingRef
              }
            >
              {saver.saving
                ? "Saving…"
                : familyMode
                  ? `Sell to ${familyChildrenWithItems.length} child${
                      familyChildrenWithItems.length === 1 ? "" : "ren"
                    }`
                  : "Complete sale"}
            </Button>
          </div>
        </div>
      </aside>

      {/* The printed proof of the sale — paid, partly paid or on account. */}
      <InvDrawer
        open={!!receiptSales}
        wide
        title={
          receiptSales && receiptSales.length > 1
            ? `${receiptSales.length} receipts`
            : "Receipt"
        }
        subtitle={(receiptSales ?? []).map((x) => x.saleNo).join(" · ")}
        onClose={() => {
          setReceiptSales(null);
          onSold();
        }}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setReceiptSales(null);
                onSold();
              }}
            >
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => printStoreReceipt("counter-receipt-print")}
            >
              Print / save PDF
            </Button>
          </>
        }
      >
        <div id="counter-receipt-print" className="store-receipt-sheet space-y-3">
          {(receiptSales ?? []).map((x) => (
            <StoreReceiptSheet
              key={x.id}
              sale={x}
              classSection={classSectionOf(x.classId, x.sectionId)}
            />
          ))}
        </div>
      </InvDrawer>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/* ─── Sales list ───────────────────────────────────────────── */

function SalesSection({
  classes,
  sections,
  onlyUnpaid,
  onChanged,
}: {
  classes: { id: string; label: string }[];
  sections: { id: string; classId: string; label: string }[];
  onlyUnpaid?: boolean;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 300);
  const sales = useAsync(
    () =>
      invApi.listSales({
        search: debounced,
        status: onlyUnpaid ? "unpaid" : "all",
        pageSize: 50,
      }),
    [debounced, onlyUnpaid],
  );
  const saver = useSaver();

  const [collect, setCollect] = useState<InvSale | null>(null);
  const [collectInput, setCollectInput] = useState("");
  const [collectMode, setCollectMode] = useState<InvTenderMode>("cash");
  const [collectOn, setCollectOn] = useState("");

  const [ret, setRet] = useState<InvSale | null>(null);
  const [retReason, setRetReason] = useState("");
  const [retOn, setRetOn] = useState("");
  const [retRefundMode, setRetRefundMode] = useState<InvTenderMode>("cash");
  const [retRefundRef, setRetRefundRef] = useState("");
  const [retSettlement, setRetSettlement] = useState<"reduce_balance" | "refund">(
    "reduce_balance",
  );
  const [retRestock, setRetRestock] = useState(true);
  const [retQty, setRetQty] = useState<Record<string, string>>({});

  const [voidSale, setVoidSale] = useState<InvSale | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const [receiptOf, setReceiptOf] = useState<InvSale | null>(null);

  const classLabel = useMemo(() => {
    const m = new Map(classes.map((c) => [c.id, c.label]));
    return (id: string) => m.get(id) ?? id;
  }, [classes]);

  const sectionLabel = useMemo(() => {
    const m = new Map(sections.map((x) => [x.id, x.label]));
    return (id: string) => (id ? (m.get(id) ?? "") : "");
  }, [sections]);

  async function submitCollect() {
    if (!collect) return;
    const amount = inputToPaise(collectInput);
    if (amount <= 0) return;
    const res = await saver.run(() =>
      invApi.collectOnSale({
        saleId: collect.id,
        amountPaise: amount,
        mode: collectMode,
        paidOn: collectOn || undefined,
      }),
    );
    if (res) {
      saver.setNotice(
        res.balancePaise > 0
          ? `Collected — ${formatPaise(res.balancePaise)} still owing`
          : "Collected in full",
      );
      setCollect(null);
      sales.reload();
      onChanged();
    }
  }

  /**
   * Money going back out needs the same trail as money coming in. A refund by
   * UPI or cheque with no reference cannot be matched to the bank later, and
   * an unexplained payment OUT is the harder one to answer for.
   */
  const retNeedsRef =
    retSettlement === "refund" &&
    retRefundMode !== "cash" &&
    retRefundRef.trim() === "";

  async function submitReturn() {
    if (!ret || !retReason.trim()) return;
    if (retNeedsRef) return;
    const lines = ret.lines
      .map((l) => ({ saleLineId: l.id, qty: Number(retQty[l.id]) || 0 }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) return;

    const res = await saver.run(() =>
      invApi.postSaleReturn({
        saleId: ret.id,
        reason: retReason.trim(),
        returnDate: retOn || undefined,
        settlement: retSettlement,
        refundMode: retSettlement === "refund" ? retRefundMode : "cash",
        refundReference:
          retSettlement === "refund" ? retRefundRef.trim() : "",
        restock: retRestock,
        lines,
      }),
    );
    if (res) {
      saver.setNotice(
        `${res.returnNo} — ${formatPaise(res.totalPaise)} credited` +
          (res.refundedPaise > 0
            ? `, ${formatPaise(res.refundedPaise)} refunded by ${tenderLabel(
                retRefundMode,
              )}${res.refundReference ? ` (${res.refundReference})` : ""}`
            : ""),
      );
      setRet(null);
      setRetReason("");
      setRetRefundMode("cash");
      setRetRefundRef("");
      setRetQty({});
      sales.reload();
      onChanged();
    }
  }

  async function submitVoid() {
    if (!voidSale || !voidReason.trim()) return;
    const res = await saver.run(() =>
      invApi.voidSale(voidSale.id, voidReason.trim()),
    );
    if (res) {
      saver.setNotice(`${res.saleNo} cancelled — stock put back`);
      setVoidSale(null);
      setVoidReason("");
      sales.reload();
      onChanged();
    }
  }

  const rows = sales.data?.rows ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${FIELD_CLASS} w-full pl-8`}
            placeholder="Search receipt no., buyer or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => sales.reload()}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <InvAlert
        error={sales.error || saver.error}
        notice={saver.notice}
        onDismiss={() => {
          saver.setError("");
          saver.setNotice("");
        }}
      />

      {sales.loading ? (
        <InvSpinner label="Loading sales" />
      ) : sales.error ? null : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {onlyUnpaid ? "Nothing outstanding." : "No sales yet."}
        </div>
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto">
          <ErpTable minWidth="min-w-[940px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left font-medium">Receipt</th>
                <th className="px-3 py-2 text-left font-medium">Buyer</th>
                <th className="px-3 py-2 text-left font-medium">Items</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Paid</th>
                <th className="px-3 py-2 text-right font-medium">Owing</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {rows.map((s) => (
                <tr key={s.id} className={s.status === "void" ? "opacity-60" : ""}>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{s.saleNo}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.saleDate}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-sm">{s.buyerName || "—"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.buyerKind === "student"
                        ? `${classLabel(s.classId)}${
                            sectionLabel(s.sectionId)
                              ? `-${sectionLabel(s.sectionId)}`
                              : ""
                          }`
                        : s.buyerKind === "walkin"
                          ? "Walk-in"
                          : "Staff"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.lines.map((l) => (
                      <div key={l.id}>
                        {l.itemName} × {l.qty}
                        {l.qtyReturned ? (
                          <span className="text-muted-foreground">
                            {" "}
                            ({l.qtyReturned} returned)
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatPaise(s.totalPaise)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatPaise(s.paidPaise)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {s.balancePaise > 0 ? formatPaise(s.balancePaise) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Pill
                      tone={
                        s.status === "paid"
                          ? "good"
                          : s.status === "void"
                            ? "bad"
                            : "warn"
                      }
                    >
                      {saleStatusLabel(s.status)}
                    </Pill>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setReceiptOf(s)}
                    >
                      Receipt
                    </Button>
                    {s.status !== "void" && s.balancePaise > 0 ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setCollect(s);
                          setCollectInput(paiseToInput(s.balancePaise));
                          setCollectOn(new Date().toISOString().slice(0, 10));
                        }}
                      >
                        Collect
                      </Button>
                    ) : null}
                    {s.status !== "void" ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setRet(s);
                          setRetQty({});
                          setRetReason("");
                          setRetOn(new Date().toISOString().slice(0, 10));
                        }}
                      >
                        Return
                      </Button>
                    ) : null}
                    {s.status !== "void" ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive"
                        onClick={() => {
                          setVoidSale(s);
                          setVoidReason("");
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}

      {/* Receipt — reprint any sale, current balance and all payments on it. */}
      <InvDrawer
        open={!!receiptOf}
        wide
        title="Receipt"
        subtitle={receiptOf ? `${receiptOf.saleNo} · ${receiptOf.buyerName}` : ""}
        onClose={() => setReceiptOf(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setReceiptOf(null)}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => printStoreReceipt("sales-receipt-print")}
            >
              Print / save PDF
            </Button>
          </>
        }
      >
        <div id="sales-receipt-print" className="store-receipt-sheet">
          {receiptOf ? (
            <StoreReceiptSheet
              sale={receiptOf}
              classSection={
                receiptOf.buyerKind === "student"
                  ? `${classLabel(receiptOf.classId)}${
                      sectionLabel(receiptOf.sectionId)
                        ? `-${sectionLabel(receiptOf.sectionId)}`
                        : ""
                    }`
                  : ""
              }
            />
          ) : null}
        </div>
      </InvDrawer>

      {/* Collect */}
      <InvDrawer
        open={!!collect}
        title="Collect payment"
        subtitle={
          collect
            ? `${collect.saleNo} · ${formatPaise(collect.balancePaise)} owing`
            : ""
        }
        onClose={() => setCollect(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setCollect(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitCollect} disabled={saver.saving}>
              {saver.saving ? "Saving…" : "Record"}
            </Button>
          </>
        }
      >
        {collect ? (
          <div className="space-y-3">
            <InvAlert error={saver.error} />
            <MoneyField
              label="Amount"
              value={collectInput}
              onChange={setCollectInput}
            />
            <TextField
              label="Received on"
              type="date"
              value={collectOn}
              onChange={setCollectOn}
            />
            <SelectField
              label="Taken by"
              value={collectMode}
              placeholder="Cash"
              options={TENDERS.map((t) => ({ value: t, label: tenderLabel(t) }))}
              onChange={(v) => setCollectMode(v as InvTenderMode)}
            />
          </div>
        ) : null}
      </InvDrawer>

      {/* Return */}
      <InvDrawer
        open={!!ret}
        wide
        title="Take goods back"
        subtitle={ret ? `${ret.saleNo} · ${ret.buyerName}` : ""}
        onClose={() => setRet(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setRet(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitReturn}
              disabled={saver.saving || !retReason.trim() || retNeedsRef}
            >
              {saver.saving ? "Saving…" : "Post return"}
            </Button>
          </>
        }
      >
        {ret ? (
          <div className="space-y-3">
            <InvAlert error={saver.error} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Reason"
                required
                value={retReason}
                onChange={setRetReason}
                placeholder="e.g. Wrong size"
              />
              <TextField
                label="Returned on"
                type="date"
                value={retOn}
                onChange={setRetOn}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Settle by"
                value={retSettlement}
                placeholder="Reduce what they owe"
                options={[
                  { value: "reduce_balance", label: "Reduce what they owe" },
                  { value: "refund", label: "Refund the money" },
                ]}
                onChange={(v) =>
                  setRetSettlement(v === "refund" ? "refund" : "reduce_balance")
                }
              />
              <label className="flex items-end gap-2 pb-2 text-xs">
                <input
                  type="checkbox"
                  checked={retRestock}
                  onChange={(e) => setRetRestock(e.target.checked)}
                />
                Put the goods back in stock
              </label>
            </div>

            {/* How the money actually leaves. Recorded because the books post
                the refund to the account it went out of — cash out of the
                drawer, UPI out of the bank — and a wrong one leaves the day's
                cash count short with nothing to explain it. */}
            {retSettlement === "refund" ? (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  How is the money going back?
                </p>
                <div className="flex flex-wrap gap-1">
                  {TENDERS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setRetRefundMode(t)}
                      className={
                        retRefundMode === t
                          ? "rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background"
                          : "rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      }
                    >
                      {tenderLabel(t)}
                    </button>
                  ))}
                </div>
                {retRefundMode !== "cash" ? (
                  <>
                    <TextField
                      label="Transaction ID"
                      value={retRefundRef}
                      onChange={setRetRefundRef}
                    />
                    {retNeedsRef ? (
                      <p className="text-xs text-destructive">
                        A {tenderLabel(retRefundMode)} refund needs its
                        transaction ID before it can be paid out.
                      </p>
                    ) : null}
                  </>
                ) : null}
                <p className="text-[11px] text-muted-foreground">
                  Only what they actually paid can come back — anything beyond
                  that reduces what they still owe instead.
                </p>
              </div>
            ) : null}

            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                What is coming back
              </legend>
              {ret.lines.map((l) => {
                const left = l.qty - (l.qtyReturned ?? 0);
                const entered = Number(retQty[l.id]) || 0;
                return (
                  <div
                    key={l.id}
                    className="flex flex-wrap items-end justify-between gap-2 border-b py-2 last:border-0"
                  >
                    <div>
                      <div className="text-sm font-medium">{l.itemName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        sold {l.qty}
                        {l.qtyReturned ? `, ${l.qtyReturned} already back` : ""} ·{" "}
                        {formatPaise(
                          l.qty > 0 ? Math.round(l.lineTotalPaise / l.qty) : 0,
                        )}{" "}
                        each
                      </div>
                    </div>
                    <div className="w-28">
                      <NumberField
                        label={`Return (max ${left})`}
                        value={retQty[l.id] ?? ""}
                        onChange={(v) => setRetQty((q) => ({ ...q, [l.id]: v }))}
                      />
                      {entered > left ? (
                        <p className="text-[11px] text-destructive">
                          Only {left} can come back
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          </div>
        ) : null}
      </InvDrawer>

      {/* Void */}
      <InvDrawer
        open={!!voidSale}
        title="Cancel this sale"
        subtitle={voidSale ? `${voidSale.saleNo} · ${voidSale.buyerName}` : ""}
        onClose={() => setVoidSale(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setVoidSale(null)}>
              Keep it
            </Button>
            <Button
              size="sm"
              onClick={submitVoid}
              disabled={saver.saving || !voidReason.trim()}
            >
              {saver.saving ? "Cancelling…" : "Cancel sale"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <InvAlert error={saver.error} />
          <p className="text-sm text-muted-foreground">
            The receipt is kept and marked cancelled, and the stock it took out
            goes back on the shelf. A sale that already has returns against it
            cannot be cancelled.
          </p>
          <TextField
            label="Reason"
            required
            value={voidReason}
            onChange={setVoidReason}
            placeholder="e.g. Rang up twice"
          />
        </div>
      </InvDrawer>
    </div>
  );
}
