/**
 * A fee was received (the staff app's counter, an online payment settled
 * from a pay-link) → the family gets their receipt, and whoever may edit
 * fees gets it too, folded per day into one unread row ("12 fees received
 * today") that rings once (lib/notify/events.ts). Both keyed on the voucher
 * id, so a replayed webhook or a retried request notifies nobody twice.
 */
import "server-only";

import { feeReceipt, feeReceivedForOffice } from "./events";
import { notify } from "./notify.server";
import { istDate } from "./policy";

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

export async function notifyFeeReceived(p: {
  voucherId: string;
  receiptNo: string;
  householdId: string;
  totalPaise: number;
  studentName: string;
  classLabel?: string;
  /** "Cash", "UPI", "Online (Cashfree)" … */
  mode: string;
  /** The member of staff who took it (not told about their own receipt). */
  collectedByStaffId?: string;
}): Promise<void> {
  const amountLabel = inr(p.totalPaise);
  const classLabel = p.classLabel ?? "";
  if (p.householdId) {
    await notify(
      feeReceipt({ voucherId: p.voucherId, householdId: p.householdId, receiptNo: p.receiptNo, amountLabel, studentName: p.studentName, classLabel }),
    );
  }
  await notify(
    feeReceivedForOffice({
      voucherId: p.voucherId,
      receiptNo: p.receiptNo,
      amountLabel,
      studentName: p.studentName,
      classLabel,
      mode: p.mode,
      collectedByStaffId: p.collectedByStaffId,
      istDate: istDate(Date.now()),
    }),
  );
}
