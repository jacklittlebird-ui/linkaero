// Ethiopian Airlines invoices stay in USD but also show an EGP total at an
// exchange rate entered by the user when the invoice is created.
export const isEthiopianOperator = (name?: string | null, code?: string | null) =>
  /^ethiopian/i.test((name || "").trim()) || (code || "").trim().toUpperCase() === "ET";

export const egpTotal = (total: number, rate: number) =>
  Math.round((Number(total) || 0) * (Number(rate) || 0) * 100) / 100;

export const hasEgpTotal = (inv: { exchange_rate?: number | null; base_currency?: string | null }) =>
  (Number(inv?.exchange_rate) || 0) > 0 && (inv?.base_currency || "").toUpperCase() === "EGP";

export const parseRate = (v: string | null): number | null => {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Ask for the USD→EGP rate. Returns null if cancelled. Re-asks on invalid input. */
export const askEgpRate = (current?: number | null): number | null => {
  for (;;) {
    const v = window.prompt("Ethiopian Airlines invoice — enter the exchange rate (EGP for 1 USD):", current ? String(current) : "");
    if (v === null) return null;
    const r = parseRate(v);
    if (r) return r;
    window.alert("Please enter a rate greater than 0.");
  }
};

export const fmtEgp = (n: number) =>
  `EGP ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
