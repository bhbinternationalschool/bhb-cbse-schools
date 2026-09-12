"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { field } from "@/components/ui/erp-ui";
import { RowActionMenu } from "@/components/ui/erp-grid";
import {
  WaDeliveryTicks,
  type WaTickStage,
} from "@/components/comms/WaDeliveryTicks";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

type Row = {
  voucherId: string;
  receiptNo: string;
  mobile: string;
  error: string;
  sentAt: string;
  stage: WaTickStage;
  stageLabel: string;
  ladder: { deliveredAt: string | null; readAt: string | null } | null;
};

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * A day's receipts, and what WhatsApp did with each.
 *
 * The point of the screen is the exceptions, not the total: a receipt stuck
 * at Sent, or one that failed outright, is a family who does not have their
 * proof of payment and does not know it. Those sort to the top.
 *
 * "Delivered but not read" is deliberately NOT treated as a problem — a
 * family with read receipts switched off in WhatsApp will never reach Read,
 * and chasing them would be chasing WhatsApp's privacy setting.
 */
export function ReceiptDeliveryPanel({
  onOpenReceipt,
}: {
  /** Open this receipt in the preview. The row's reason for existing is a
   *  family, so the office needs a way to get from the row to them. */
  onOpenReceipt?: (voucherId: string) => void;
}) {
  const [date, setDate] = useState(todayIso);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (on: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/fees/receipt-wa?since=${encodeURIComponent(on)}`,
      );
      const json = (await res.json()) as { receipts?: Row[]; error?: string };
      if (json.error) throw new Error(json.error);
      setRows(json.receipts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read delivery status");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.stage] = (c[r.stage] ?? 0) + 1;
    return c;
  }, [rows]);

  const ORDER: Record<string, number> = {
    failed: 0,
    unknown: 1,
    sent: 2,
    delivered: 3,
    read: 4,
  };
  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (ORDER[a.stage] ?? 9) - (ORDER[b.stage] ?? 9) ||
          b.sentAt.localeCompare(a.sentAt),
      ),
    [rows],
  );

  // Sorting by WhatsApp stage groups the receipts that never reached a phone.
  const delSort = useTableSort(
    sorted,
    {
      receipt: (r) => r.receiptNo || "",
      to: (r) => r.mobile || "",
      sent: (r) => r.sentAt || "",
      stage: (r) => r.stage,
    },
    "sent",
    "desc",
  );

  const needsAttention = (counts.failed ?? 0) + (counts.unknown ?? 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Receipts sent on
          </span>
          <input
            type="date"
            className={field}
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--muted)]">
          <span>{rows.length} messaged</span>
          <WaDeliveryTicks stage="read" showLabel={false} />
          <span>{counts.read ?? 0} read</span>
          <WaDeliveryTicks stage="delivered" showLabel={false} />
          <span>{counts.delivered ?? 0} delivered</span>
          {needsAttention > 0 ? (
            <span className="font-semibold text-[var(--danger)]">
              {needsAttention} need a look
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="text-xs text-[var(--danger)]">{error}</p>
      ) : null}

      {loading ? (
        <p className="text-xs text-[var(--muted)]">Reading delivery status…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          No receipts were messaged on this date.
        </p>
      ) : (
        <ErpTableShell className="overflow-x-auto">
          <ErpTable minWidth="min-w-[560px]">
            <ErpTableHead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                <ErpSortTh sort={delSort} field="receipt" className="px-3 py-2.5">Receipt</ErpSortTh>
                <ErpSortTh sort={delSort} field="to" className="px-3 py-2.5">To</ErpSortTh>
                <ErpSortTh sort={delSort} field="sent" className="px-3 py-2.5">Sent</ErpSortTh>
                <ErpSortTh sort={delSort} field="stage" className="px-3 py-2.5">WhatsApp</ErpSortTh>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {delSort.rows.map((r) => (
                <tr key={r.voucherId} className="text-[var(--brand-deep)]">
                  <td className="px-3 py-2 font-medium">{r.receiptNo || "—"}</td>
                  <td className="px-3 py-2">{r.mobile || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--muted)]">
                    {r.sentAt ? new Date(r.sentAt).toLocaleTimeString("en-IN") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <WaDeliveryTicks
                      stage={r.stage}
                      at={r.ladder?.readAt || r.ladder?.deliveredAt}
                    />
                    {r.error ? (
                      <div className="text-[10px] text-[var(--danger)]">
                        {r.error}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <RowActionMenu
                      row={r}
                      actions={[
                        {
                          id: "open",
                          label: "Open receipt",
                          onSelect: (row) => onOpenReceipt?.(row.voucherId),
                          hidden: () => !onOpenReceipt,
                        },
                        {
                          id: "copy",
                          label: "Copy mobile",
                          onSelect: (row) => {
                            void navigator.clipboard
                              ?.writeText(row.mobile)
                              .catch(() => undefined);
                          },
                          disabled: (row) => !row.mobile,
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}
    </div>
  );
}
