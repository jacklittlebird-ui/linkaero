import { describe, it, expect } from "vitest";
import { computeDay, TVoucher } from "./treasuryBalance";

const v = (p: Partial<TVoucher>): TVoucher => ({
  voucher_type: "receipt", payment_subtype: null, status: "posted",
  currency: "EGP", amount: 0, voucher_date: "2025-06-11", ...p,
});

describe("treasury balance equation", () => {
  it("opening + receipts − payments − pending = final", () => {
    const r = computeDay([
      v({ amount: 45200, voucher_date: "2025-06-10" }),
      v({ amount: 12500 }), v({ amount: 8200 }),
      v({ voucher_type: "payment", payment_subtype: "general", amount: 9500 }),
      v({ voucher_type: "payment", payment_subtype: "pending_custody", status: "approved", amount: 2000 }),
    ], "EGP", "2025-06-11");
    expect(r.opening).toBe(45200);
    expect(r.receipts).toBe(20700);
    expect(r.payments).toBe(9500);
    expect(r.cash).toBe(56400);
    expect(r.final).toBe(54400);
  });
  it("settled pending vouchers drop out of pending", () => {
    const r = computeDay([v({ voucher_type: "pending", status: "settled", amount: 500 })], "EGP", "2025-06-11");
    expect(r.pending).toBe(0);
  });
});

import { computeRange } from "./treasuryBalance";
import { monthBounds } from "./flightCostReport";
describe("treasury range statement", () => {
  const v = (t: "receipt" | "payment", d: string, a: number) => ({ voucher_type: t, payment_subtype: t === "receipt" ? null : "general", status: "posted", currency: "EGP", amount: a, voucher_date: d });
  it("opening counts movements before from; range sums inside from..to", () => {
    const r = computeRange([v("receipt", "2026-11-01", 1000), v("payment", "2026-11-05", 200), v("receipt", "2026-11-10", 50), v("payment", "2026-11-20", 99)], "EGP", "2026-11-05", "2026-11-10");
    expect(r).toMatchObject({ opening: 1000, receipts: 50, payments: 200, cash: 850 });
  });
  it("monthBounds gives full month", () => {
    expect(monthBounds("02/2028")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthBounds("13/2026")).toBeNull();
  });
});
