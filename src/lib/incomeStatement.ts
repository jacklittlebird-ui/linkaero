// Income statement structure used by Link Aero:
// Revenue − Direct costs = Net revenue; − Station costs = Gross profit;
// − General & admin = Operating profit; ± Other items (interest, FX) = Net profit.

export type IncomeSection = "revenue" | "direct" | "station" | "admin" | "other";

export const INCOME_SECTIONS: { key: IncomeSection; ar: string; en: string }[] = [
  { key: "revenue", ar: "الإيرادات", en: "Revenue" },
  { key: "direct", ar: "التكاليف", en: "Direct Costs" },
  { key: "station", ar: "تكاليف / مصروفات المحطات", en: "Station Costs" },
  { key: "admin", ar: "المصروفات العمومية والإدارية", en: "General & Admin Expenses" },
  { key: "other", ar: "بنود أخرى (فوائد دائنة، فروق عملة...)", en: "Other Items" },
];

const OTHER_NAME = /فوائد|فروق|فرق عمل|interest|fx|exchange/i;

export function classifyIncomeAccount(code: string, accountType: string, name = ""): IncomeSection | null {
  const t = (accountType || "").toLowerCase();
  const c = String(code || "");
  if (t === "revenue") {
    if (c.startsWith("603") || OTHER_NAME.test(name)) return "other";
    return "revenue";
  }
  if (t === "expense") {
    if (OTHER_NAME.test(name)) return "other";
    if (c.startsWith("82")) return "station";
    if (c.startsWith("8") || c.startsWith("3")) return "direct";
    return "admin";
  }
  return null;
}

/** Amounts are signed natural balances (revenue positive, expenses positive; "other" = income − expense). */
export function incomeTotals(s: Record<IncomeSection, number>) {
  const netRevenue = s.revenue - s.direct;
  const grossProfit = netRevenue - s.station;
  const operatingProfit = grossProfit - s.admin;
  const netProfit = operatingProfit + s.other;
  return { netRevenue, grossProfit, operatingProfit, netProfit };
}
