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
  recovered_amount?: number | null;
}

const COUNTED = new Set(["approved", "posted", "settled"]);

export const isPending = (v: TVoucher) =>
  v.voucher_type === "pending" || v.payment_subtype === "pending_custody" || v.payment_subtype === "advance";

export const isAdvance = (v: TVoucher) => v.payment_subtype === "advance";
export const isCustody = (v: TVoucher) => isPending(v) && !isAdvance(v);
export const advanceRemaining = (v: TVoucher) => v.status === "void" || v.status === "settled" ? 0 : Math.max(0, Number(v.amount) - Number(v.recovered_amount || 0));

export function costCentresComplete(v: { airline_id?: string | null; station_id?: string | null; service_type?: string | null; supplier_account_id?: string | null }) {
  return Boolean(v.airline_id && v.station_id && ["Security", "Handling"].includes(v.service_type || "") && v.supplier_account_id);
}

export function computeDay(vouchers: TVoucher[], currency: string, date: string) {
  let opening = 0, receipts = 0, payments = 0, pending = 0, advances = 0;
  for (const v of vouchers) {
    if (v.currency !== currency || !COUNTED.has(v.status) && v.status !== "pending_approval") continue;
    const amt = Number(v.amount || 0);
    if (isPending(v)) {
      if (v.status !== "settled" && v.voucher_date <= date) {
        if (isAdvance(v)) advances += advanceRemaining(v); else pending += amt;
      }
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
  return { opening, receipts, payments, cash, pending, advances, final: cash - pending - advances };
}

// Statement for a date range [from, to]: opening = movements before `from`,
// receipts/payments = movements inside the range, pending = unsettled custody as of `to`.
export function computeRange(vouchers: TVoucher[], currency: string, from: string, to: string) {
  let opening = 0, receipts = 0, payments = 0, pending = 0, advances = 0;
  for (const v of vouchers) {
    if (v.currency !== currency) continue;
    const amt = Number(v.amount || 0);
    if (isPending(v)) {
      if ((COUNTED.has(v.status) || v.status === "pending_approval") && v.status !== "settled" && v.voucher_date <= to) {
        if (isAdvance(v)) advances += advanceRemaining(v); else pending += amt;
      }
      continue;
    }
    if (!COUNTED.has(v.status)) continue;
    const sign = v.voucher_type === "receipt" ? 1 : -1;
    if (v.voucher_date < from) opening += sign * amt;
    else if (v.voucher_date <= to) {
      if (sign > 0) receipts += amt; else payments += amt;
    }
  }
  const cash = opening + receipts - payments;
  return { opening, receipts, payments, cash, pending, advances, final: cash - pending - advances };
}
