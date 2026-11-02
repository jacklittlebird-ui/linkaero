import { describe, it, expect } from "vitest";
import { egpTotal, isEthiopianOperator, parseRate, hasEgpTotal } from "./invoiceEgp";

describe("Ethiopian EGP invoice total", () => {
  it("EGP total = USD total × rate", () => {
    expect(egpTotal(136.5, 48.5)).toBe(6620.25);
  });
  it("detects Ethiopian by name or ET code only", () => {
    expect(isEthiopianOperator("Ethiopian Airlines")).toBe(true);
    expect(isEthiopianOperator("", "ET")).toBe(true);
    expect(isEthiopianOperator("Air Cairo", "SM")).toBe(false);
  });
  it("rejects rates of 0 or below", () => {
    expect(parseRate("0")).toBeNull();
    expect(parseRate("-2")).toBeNull();
    expect(parseRate("48.5")).toBe(48.5);
  });
  it("only shows EGP when rate and EGP base are saved", () => {
    expect(hasEgpTotal({ exchange_rate: 48.5, base_currency: "EGP" })).toBe(true);
    expect(hasEgpTotal({ exchange_rate: null, base_currency: "EGP" })).toBe(false);
  });
});
