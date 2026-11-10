// Fetches the daily official rates from the Central Bank of Egypt page and stores them in exchange_rates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CBE_URL = "https://www.cbe.org.eg/en/economic-research/statistics/cbe-exchange-rates";
const NAME_TO_CODE: Record<string, string> = {
  "US Dollar": "USD", "Euro": "EUR", "Pound Sterling": "GBP", "Swiss Franc": "CHF",
  "Saudi Riyal": "SAR", "UAE Dirham": "AED", "Jordanian Dinar": "JOD",
};

export function parseCbe(html: string) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const dm = text.match(/Rates for Date:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const rate_date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;
  const rates: { code: string; buy: number; sell: number }[] = [];
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    const m = text.match(new RegExp(`${name}\\s+([\\d.]+)\\s+([\\d.]+)`));
    if (m) rates.push({ code, buy: Number(m[1]), sell: Number(m[2]) });
  }
  return { rate_date, rates };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const res = await fetch(CBE_URL, { headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9",
    } });
    const html = await res.text();
    const { rate_date, rates } = parseCbe(html);
    if (!rate_date || rates.length === 0) throw new Error("تعذر قراءة أسعار البنك المركزي");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rows = rates.map((r) => ({
      rate_date, base_currency: "EGP", quote_currency: r.code, buy_rate: r.buy, sell_rate: r.sell,
      mid_rate: Number(((r.buy + r.sell) / 2).toFixed(6)), source: "CBE",
    }));
    const { error } = await admin.from("exchange_rates").upsert(rows, { onConflict: "rate_date,base_currency,quote_currency,source" });
    if (error) throw error;
    return new Response(JSON.stringify({ rate_date, count: rows.length }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
