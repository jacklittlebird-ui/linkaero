import { useState, useMemo } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Landmark, Download } from "lucide-react";

type Account = { id: string; code: string; name: string; account_type: string; opening_balance: number | null };
type Line = { account_id: string; debit: number | null; credit: number | null };

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Column = "share_capital" | "share_premium" | "retained_earnings" | "reserves" | "oci" | "treasury";

const classifyEquity = (a: Account): Column | null => {
  if ((a.account_type || "").toLowerCase() !== "equity") return null;
  const n = (a.name || "").toLowerCase();
  if (n.includes("share capital") || n.includes("common stock") || n.includes("paid-in") || n.includes("paid in")) return "share_capital";
  if (n.includes("premium") || n.includes("apic")) return "share_premium";
  if (n.includes("retained") || n.includes("accumulated") || n.includes("earnings")) return "retained_earnings";
  if (n.includes("treasury")) return "treasury";
  if (n.includes("oci") || n.includes("comprehensive") || n.includes("translation") || n.includes("hedging") || n.includes("revaluation")) return "oci";
  return "reserves";
};

const COLS: { key: Column; label: string }[] = [
  { key: "share_capital", label: "Share Capital" },
  { key: "share_premium", label: "Share Premium" },
  { key: "retained_earnings", label: "Retained Earnings" },
  { key: "reserves", label: "Other Reserves" },
  { key: "oci", label: "OCI" },
  { key: "treasury", label: "Treasury Shares" },
];

export default function StatementOfEquityPage() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const lastDay = today.toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(lastDay);

  const { data: accounts = [] } = useQuery({
    queryKey: ["coa_soe"],
    queryFn: async () => {
      const { data, error } = await supabase.from("chart_of_accounts").select("id,code,name,account_type,opening_balance").order("code");
      if (error) throw error;
      return data as Account[];
    },
  });

  const fetchLines = async (start: string, end: string) => {
    const { data: entries, error: e1 } = await supabase
      .from("journal_entries").select("id")
      .gte("entry_date", start).lte("entry_date", end).eq("status", "Posted");
    if (e1) throw e1;
    const ids = (entries || []).map((e: any) => e.id);
    if (ids.length === 0) return [] as Line[];
    const { data, error } = await supabase.from("journal_entry_lines").select("account_id,debit,credit").in("entry_id", ids);
    if (error) throw error;
    return data as Line[];
  };

  const yesterday = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);

  const { data: toStartLines = [] } = useQuery({
    queryKey: ["jel_soe_start", from],
    queryFn: () => fetchLines("1900-01-01", yesterday),
  });
  const { data: periodLines = [] } = useQuery({
    queryKey: ["jel_soe_period", from, to],
    queryFn: () => fetchLines(from, to),
  });

  const view = useMemo(() => {
    const netByAccount = (ls: Line[]) => {
      const m = new Map<string, number>();
      for (const l of ls) m.set(l.account_id, (m.get(l.account_id) || 0) + Number(l.debit || 0) - Number(l.credit || 0));
      return m;
    };
    const startMap = netByAccount(toStartLines);
    const periodMap = netByAccount(periodLines);

    // Equity: credit-normal. Balance shown as positive = credit balance = equity.
    const opening: Record<Column, number> = { share_capital: 0, share_premium: 0, retained_earnings: 0, reserves: 0, oci: 0, treasury: 0 };
    const movements: Record<Column, { name: string; amount: number }[]> = { share_capital: [], share_premium: [], retained_earnings: [], reserves: [], oci: [], treasury: [] };

    for (const a of accounts) {
      const col = classifyEquity(a);
      if (!col) continue;
      const start = -(Number(a.opening_balance || 0) + (startMap.get(a.id) || 0));
      const period = -(periodMap.get(a.id) || 0);
      opening[col] += start;
      if (Math.abs(period) > 0.01) movements[col].push({ name: a.name, amount: period });
    }

    // Compute Net Income from period movements on revenue/expense accounts
    let netIncome = 0;
    for (const a of accounts) {
      const t = (a.account_type || "").toLowerCase();
      if (t !== "revenue" && t !== "expense") continue;
      const pm = periodMap.get(a.id) || 0;
      netIncome += -pm; // credit balance = income; expense debit reduces
    }

    // Add Net Income line to retained earnings movements
    if (Math.abs(netIncome) > 0.01) movements.retained_earnings.unshift({ name: "Profit for the period", amount: netIncome });

    const closing: Record<Column, number> = { ...opening };
    for (const c of Object.keys(closing) as Column[]) {
      closing[c] = opening[c] + movements[c].reduce((s, m) => s + m.amount, 0);
    }

    return { opening, movements, closing, netIncome };
  }, [accounts, toStartLines, periodLines]);

  const totalOpening = COLS.reduce((s, c) => s + view.opening[c.key], 0);
  const totalClosing = COLS.reduce((s, c) => s + view.closing[c.key], 0);

  // Build unified movement rows
  const allMovementNames = Array.from(new Set(COLS.flatMap(c => view.movements[c.key].map(m => m.name))));

  const exportCsv = () => {
    const header = ["Line", ...COLS.map(c => c.label), "Total"];
    const rows: string[][] = [header];
    rows.push(["Opening balance", ...COLS.map(c => String(view.opening[c.key])), String(totalOpening)]);
    for (const name of allMovementNames) {
      const vals = COLS.map(c => view.movements[c.key].find(m => m.name === name)?.amount || 0);
      rows.push([name, ...vals.map(String), String(vals.reduce((s, v) => s + v, 0))]);
    }
    rows.push(["Closing balance", ...COLS.map(c => String(view.closing[c.key])), String(totalClosing)]);
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "statement_of_changes_in_equity.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Landmark className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Statement of Changes in Equity</h1>
            <p className="text-muted-foreground">IAS 1 primary statement — movements in equity for the period</p>
          </div>
        </div>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
          <div><Label>From</Label><DateInput  value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><DateInput  value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Opening Equity</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{fmt(totalOpening)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Profit for the Period</CardTitle></CardHeader><CardContent className={`text-2xl font-bold ${view.netIncome < 0 ? "text-destructive" : "text-primary"}`}>{fmt(view.netIncome)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Closing Equity</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{fmt(totalClosing)}</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Movements — {from} to {to}</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  {COLS.map(c => <TableHead key={c.key} className="text-right">{c.label}</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="font-semibold bg-muted/50">
                  <TableCell>Opening balance at {from}</TableCell>
                  {COLS.map(c => <TableCell key={c.key} className="text-right">{fmt(view.opening[c.key])}</TableCell>)}
                  <TableCell className="text-right">{fmt(totalOpening)}</TableCell>
                </TableRow>
                {allMovementNames.map((name) => {
                  const vals = COLS.map(c => view.movements[c.key].find(m => m.name === name)?.amount || 0);
                  const tot = vals.reduce((s, v) => s + v, 0);
                  return (
                    <TableRow key={name}>
                      <TableCell>{name}</TableCell>
                      {vals.map((v, i) => <TableCell key={i} className="text-right">{Math.abs(v) > 0.01 ? fmt(v) : ""}</TableCell>)}
                      <TableCell className="text-right font-medium">{fmt(tot)}</TableCell>
                    </TableRow>
                  );
                })}
                {allMovementNames.length === 0 && (
                  <TableRow><TableCell colSpan={COLS.length + 2} className="text-center text-muted-foreground">No equity movements in period</TableCell></TableRow>
                )}
                <TableRow className="font-bold border-t-2 bg-muted/50">
                  <TableCell>Closing balance at {to}</TableCell>
                  {COLS.map(c => <TableCell key={c.key} className="text-right">{fmt(view.closing[c.key])}</TableCell>)}
                  <TableCell className="text-right">{fmt(totalClosing)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
