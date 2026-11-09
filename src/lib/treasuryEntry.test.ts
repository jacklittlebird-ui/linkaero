import { describe, expect, it } from "vitest";
import { filterTreasuryAccounts, selectTreasuryRate, treasuryRateSide } from "./treasuryEntry";

const accounts = [
  { id: "current", code: "12110011", name: "جارى الشريك لينك مصر جنيه", name_ar: "جارى الشريك لينك مصر جنيه" },
  { id: "bank", code: "1201220001", name: "CIB", name_ar: "البنك التجارى الدولى" },
];
describe("treasury entry rules", () => {
  it("finds current accounts regardless of Arabic ya spelling", () => {
    expect(filterTreasuryAccounts(accounts, "جاري الشريك").map((a) => a.id)).toEqual(["current"]);
  });
  it("searches account code fragments including Arabic numerals", () => {
    expect(filterTreasuryAccounts(accounts, "١٢١١٠٠١١").map((a) => a.id)).toEqual(["current"]);
  });
  it("searches English account name fragments", () => {
    expect(filterTreasuryAccounts(accounts, "ci").map((a) => a.id)).toEqual(["bank"]);
  });
  it("uses the selling rate for receipts", () => {
    expect(treasuryRateSide("receipt")).toBe("sell");
    expect(selectTreasuryRate("USD", "receipt", { buy_rate: 50, sell_rate: 51 })).toBe(51);
  });
  it("uses the buying rate for payments", () => {
    expect(selectTreasuryRate("USD", "payment", { buy_rate: 50, sell_rate: 51 })).toBe(50);
  });
  it("uses the buying rate for pending vouchers", () => {
    expect(selectTreasuryRate("USD", "pending", { buy_rate: 50, sell_rate: 51 })).toBe(50);
  });
  it("uses parity only for EGP", () => {
    expect(selectTreasuryRate("EGP", "receipt", null)).toBe(1);
  });
  it("does not substitute parity or a mid rate when a quote is missing", () => {
    expect(selectTreasuryRate("USD", "receipt", null)).toBeNull();
    expect(selectTreasuryRate("USD", "receipt", { buy_rate: 50, sell_rate: null })).toBeNull();
  });
});