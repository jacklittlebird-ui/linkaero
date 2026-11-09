export interface SearchableTreasuryAccount {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
}

export function normalizeAccountSearch(value: string): string {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export function filterTreasuryAccounts<T extends SearchableTreasuryAccount>(accounts: T[], query: string): T[] {
  const terms = normalizeAccountSearch(query).trim().split(/\s+/).filter(Boolean);
  return accounts.filter((account) => {
    const searchable = normalizeAccountSearch(`${account.code} ${account.name ?? ""} ${account.name_ar ?? ""}`);
    return terms.every((term) => searchable.includes(term));
  });
}

export function treasuryRateSide(voucherType: "receipt" | "payment" | "pending"): "sell" | "buy" {
  return voucherType === "receipt" ? "sell" : "buy";
}

export function selectTreasuryRate(
  currency: string,
  voucherType: "receipt" | "payment" | "pending",
  quote: { buy_rate: number | null; sell_rate: number | null } | null,
): number | null {
  if (currency === "EGP") return 1;
  const value = treasuryRateSide(voucherType) === "sell" ? quote?.sell_rate : quote?.buy_rate;
  return value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
}