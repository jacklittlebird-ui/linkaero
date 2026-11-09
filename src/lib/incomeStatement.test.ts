import { describe, it, expect } from "vitest";
import { classifyIncomeAccount, incomeTotals } from "./incomeStatement";

describe("income statement structure", () => {
  it("classifies accounts into the five main sections", () => {
    expect(classifyIncomeAccount("602001", "Revenue", "ايرادات")).toBe("revenue");
    expect(classifyIncomeAccount("603001", "Revenue", "فوائد ودائع")).toBe("other");
    expect(classifyIncomeAccount("810001", "Expense", "عمليات")).toBe("direct");
    expect(classifyIncomeAccount("820001", "Expense", "محطات")).toBe("station");
    expect(classifyIncomeAccount("500801", "Expense", "ايجار")).toBe("admin");
    expect(classifyIncomeAccount("120110000", "Asset")).toBeNull();
  });

  it("computes net revenue, gross profit and net profit in order", () => {
    const r = incomeTotals({ revenue: 1000, direct: 300, station: 200, admin: 100, other: 50 });
    expect(r.netRevenue).toBe(700);
    expect(r.grossProfit).toBe(500);
    expect(r.operatingProfit).toBe(400);
    expect(r.netProfit).toBe(450);
  });
});
