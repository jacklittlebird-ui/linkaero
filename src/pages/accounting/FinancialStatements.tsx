import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileBarChart, Download } from "lucide-react";
import { INCOME_SECTIONS, classifyIncomeAccount, incomeTotals, type IncomeSection } from "@/lib/incomeStatement";

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  opening_balance: number | null;
};

type Line = {
  account_id: string;
  debit: number | null;
  credit: number | null;
  entry_id: string;
};

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function FinancialStatementsPage() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const lastDay = today.toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(lastDay);

  const { data: accounts = [] } = useQuery({
    queryKey: ["coa_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id,code,name,account_type,opening_balance")
        .order("code");
      if (error) throw error;
      return data as Account[];
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["jel_range", from, to],
    queryFn: async () => {
      const { data: entries, error: e1 } = await supabase
        .from("journal_entries")
        .select("id")
        .gte("entry_date", from)
        .lte("entry_date", to)
        .eq("status", "Posted");
      if (e1) throw e1;
      const ids = (entries || []).map((e: any) => e.id);
      if (ids.length === 0) return [] as Line[];
      const { data, error } = await supabase
        .from("journal_entry_lines")
        .select("account_id,debit,credit,entry_id")
        .in("entry_id", ids);
      if (error) throw error;
      return data as Line[];
    },
  });

  const trialBalance = useMemo(() => {
    const map = new Map<string, { debit: number; credit: number }>();
    for (const l of lines) {
      const cur = map.get(l.account_id) || { debit: 0, credit: 0 };
      cur.debit += Number(l.debit || 0);
      cur.credit += Number(l.credit || 0);
      map.set(l.account_id, cur);
    }
    return accounts.map((a) => {
      const m = map.get(a.id) || { debit: 0, credit: 0 };
      const opening = Number(a.opening_balance || 0);
      const net = opening + m.debit - m.credit;
      return { ...a, debit: m.debit, credit: m.credit, balance: net };
    });
  }, [accounts, lines]);

  const grouped = useMemo(() => {
    const g: Record<string, typeof trialBalance> = {
      asset: [], liability: [], equity: [], revenue: [], expense: [],
    };
    for (const r of trialBalance) {
      const t = (r.account_type || "").toLowerCase();
      if (g[t]) g[t].push(r);
    }
    const sum = (rows: typeof trialBalance) => rows.reduce((s, r) => s + r.balance, 0);
    // Standard sign conventions: assets & expenses = debit; liab/equity/revenue = credit
    const totals = {
      assets: sum(g.asset),
      liabilities: -sum(g.liability),
      equity: -sum(g.equity),
      revenue: -sum(g.revenue),
      expenses: sum(g.expense),
    };
    const netIncome = totals.revenue - totals.expenses;
    return { g, totals, netIncome };
  }, [trialBalance]);

  const income = useMemo(() => {
    const rows: Record<IncomeSection, { id: string; code: string; name: string; amount: number }[]> = {
      revenue: [], direct: [], station: [], admin: [], other: [],
    };
    const sums: Record<IncomeSection, number> = { revenue: 0, direct: 0, station: 0, admin: 0, other: 0 };
    for (const r of trialBalance) {
      const sec = classifyIncomeAccount(r.code, r.account_type, r.name);
      if (!sec || Math.abs(r.balance) <= 0.01) continue;
      // revenue & other items shown as credit-positive; cost sections debit-positive
      const amount = sec === "revenue" || sec === "other" ? -r.balance : r.balance;
      rows[sec].push({ id: r.id, code: r.code, name: r.name, amount });
      sums[sec] += amount;
    }
    return { rows, sums, totals: incomeTotals(sums) };
  }, [trialBalance]);

  const tbTotals = trialBalance.reduce(
    (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
    { debit: 0, credit: 0 }
  );

  const exportCsv = (rows: any[], name: string) => {
    const header = Object.keys(rows[0] || {}).join(",");
    const body = rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <FileBarChart className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Financial Statements</h1>
          <p className="text-muted-foreground">Trial Balance, Balance Sheet, Income Statement</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Assets</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{fmt(grouped.totals.assets)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Liabilities</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{fmt(grouped.totals.liabilities)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Equity</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{fmt(grouped.totals.equity + grouped.netIncome)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Net Income</CardTitle></CardHeader><CardContent className={`text-2xl font-bold ${grouped.netIncome < 0 ? "text-destructive" : "text-primary"}`}>{fmt(grouped.netIncome)}</CardContent></Card>
      </div>

      <Tabs defaultValue="tb">
        <TabsList>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="is">Income Statement</TabsTrigger>
        </TabsList>

        <TabsContent value="tb">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Trial Balance</CardTitle>
              <Button size="sm" variant="outline" onClick={() => exportCsv(trialBalance.map(r => ({ code: r.code, name: r.name, type: r.account_type, debit: r.debit, credit: r.credit, balance: r.balance })), "trial_balance")}><Download className="h-4 w-4 mr-2" />Export</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead>
                  <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Balance</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {trialBalance.filter(r => r.debit || r.credit || r.balance).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="capitalize">{r.account_type}</TableCell>
                      <TableCell className="text-right">{r.debit ? fmt(r.debit) : ""}</TableCell>
                      <TableCell className="text-right">{r.credit ? fmt(r.credit) : ""}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell colSpan={3}>Totals</TableCell>
                    <TableCell className="text-right">{fmt(tbTotals.debit)}</TableCell>
                    <TableCell className="text-right">{fmt(tbTotals.credit)}</TableCell>
                    <TableCell className="text-right">{Math.abs(tbTotals.debit - tbTotals.credit) < 0.01 ? "Balanced" : `Diff ${fmt(tbTotals.debit - tbTotals.credit)}`}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bs">
          <Card>
            <CardHeader><CardTitle>Balance Sheet as of {to}</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              {(["asset", "liability", "equity"] as const).map((t) => (
                <div key={t}>
                  <h3 className="font-semibold capitalize mb-2">{t === "asset" ? "Assets" : t === "liability" ? "Liabilities" : "Equity"}</h3>
                  <Table>
                    <TableBody>
                      {grouped.g[t].filter(r => Math.abs(r.balance) > 0.01).map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono w-24">{r.code}</TableCell>
                          <TableCell>{r.name}</TableCell>
                          <TableCell className="text-right w-40">{fmt(t === "asset" ? r.balance : -r.balance)}</TableCell>
                        </TableRow>
                      ))}
                      {t === "equity" && (
                        <TableRow>
                          <TableCell></TableCell>
                          <TableCell className="italic">Retained Earnings (current period)</TableCell>
                          <TableCell className="text-right">{fmt(grouped.netIncome)}</TableCell>
                        </TableRow>
                      )}
                      <TableRow className="font-bold border-t-2">
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right">
                          {fmt(t === "asset" ? grouped.totals.assets : t === "liability" ? grouped.totals.liabilities : grouped.totals.equity + grouped.netIncome)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="is">
          <Card>
            <CardHeader><CardTitle>Income Statement — {from} to {to}</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              {INCOME_SECTIONS.map((sec) => {
                const subtotal =
                  sec.key === "direct" ? { label: "صافي الإيرادات — Net Revenue", value: income.totals.netRevenue }
                  : sec.key === "station" ? { label: "مجمل الربح — Gross Profit", value: income.totals.grossProfit }
                  : sec.key === "admin" ? { label: "ربح النشاط — Operating Profit", value: income.totals.operatingProfit }
                  : null;
                return (
                  <div key={sec.key}>
                    <h3 className="font-semibold mb-2">{sec.ar} — {sec.en}</h3>
                    <Table>
                      <TableBody>
                        {income.rows[sec.key].map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono w-24">{r.code}</TableCell>
                            <TableCell>{r.name}</TableCell>
                            <TableCell className="text-right w-40">{fmt(r.amount)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="font-bold border-t-2">
                          <TableCell colSpan={2}>إجمالي {sec.ar}</TableCell>
                          <TableCell className="text-right">{fmt(income.sums[sec.key])}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                    {subtotal && (
                      <div className="mt-2 flex justify-between rounded bg-muted px-3 py-2 font-bold">
                        <span>{subtotal.label}</span>
                        <span className={subtotal.value < 0 ? "text-destructive" : ""}>{fmt(subtotal.value)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="border-t-4 pt-3 flex justify-between font-bold text-lg">
                <span>صافي الربح / الخسارة — Net Profit</span>
                <span className={income.totals.netProfit < 0 ? "text-destructive" : "text-primary"}>{fmt(income.totals.netProfit)}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
