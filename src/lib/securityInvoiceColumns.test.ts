import { describe, it, expect } from "vitest";
import { columnsForOperator, SECURITY_ANNEX_COLUMNS } from "./securityInvoiceDetail";
describe("Ethiopian invoice columns", () => {
  it("removes Service Type, SKD and OT (h) for Ethiopian", () => {
    const c = columnsForOperator(SECURITY_ANNEX_COLUMNS, true);
    expect(c).not.toContain("Service Type"); expect(c).not.toContain("SKD"); expect(c).not.toContain("OT (h)");
    expect(c).toContain("Amount");
  });
  it("keeps them for other airlines", () => {
    expect(columnsForOperator(SECURITY_ANNEX_COLUMNS, false)).toContain("SKD");
  });
});
