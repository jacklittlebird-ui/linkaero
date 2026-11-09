// Treasury balance equation (per currency):
// opening + receipts − payments = cash balance; cash − pending = final balance.
// Cheques under collection are never part of this equation.
export interface TVoucher {
  voucher_type: "receipt" | "payment" | "pending";
  payment_subtype: string | null;
  status: string;
  currency: string;
  amount: number;
  voucher_date: string;
  settled_amount?: number | null;
}

const COUNTED = new Set(["approved", "posted", "settled"]);

export const isPending = (v: TVoucher) =>
  v.voucher_type === "pending" || v.payment_subtype === "pending_custody" || v.payment_subtype === "advance";

export function computeDay(vouchers: TVoucher[], currency: string, date: string) {
  let opening = 0, receipts = 0, payments = 0, pending = 0;
  for (const v of vouchers) {
    if (v.currency !== currency || !COUNTED.has(v.status) && v.status !== "pending_approval") continue;
    const amt = Number(v.amount || 0);
    if (isPending(v)) {
      if (v.status !== "settled" && v.voucher_date <= date) pending += amt;
      continue;
    }
    if (!COUNTED.has(v.status)) continue;
    const sign = v.voucher_type === "receipt" ? 1 : -1;
    if (v.voucher_date < date) opening += sign * amt;
    else if (v.voucher_date === date) {
      if (sign > 0) receipts += amt; else payments += amt;
    }
  }
  const cash = opening + receipts - payments;
  return { opening, receipts, payments, cash, pending, final: cash - pending };
}
