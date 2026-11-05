import { describe, it, expect } from "vitest";
import { splitAirFranceRows } from "./AirFranceInvoicePrintView";

describe("splitAirFranceRows", () => {
  it("puts Air France Cargo flights on the cargo page and sums each total", () => {
    const r = splitAirFranceRows([
      { airline: "Air France", flight: "AF570", total: 486 },
      { airline: "Air France Cargo", flight: "AF6742", total: 300 },
      { airline: "Air France", flight: "AF571", total: 486 },
    ]);
    expect(r.pax.length).toBe(2);
    expect(r.cargo.length).toBe(1);
    expect(r.paxTotal).toBe(972);
    expect(r.cargoTotal).toBe(300);
  });
});
