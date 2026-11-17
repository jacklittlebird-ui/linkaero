// Phase 1j — Cost Center Reports
// Pivots journal_entry_lines by the remaining 4D dimensions (airline_id,
// service_type) with Company × Station × date-range scope filters. Revenue is
// derived from 4xxx accounts (credit − debit), expenses from 5xxx accounts
// (debit − credit). Profit = revenue − expenses.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download, TrendingUp, TrendingDown, Layers } from "lucide-react";
import * as XLSX from "xlsx";

type Line = {
  account_id: string;
  airline_id: string | null;
  service_type: string | null;
  company_id: string | null;
  station_id: string | null;
  base_amount: number | null;
  debit: number;
  credit: number;
  entry_id: string;
};
type Account = { id: string; code: string; name: string; account_type: string };
type Entry = { id: string; status: string; entry_date: string };
type Lookup = { id: string; name: string; company_id?: string | null };

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CostCenterReportsPage() {
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [stationFilter, setStationFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const { data: accounts = [] } = useQuery({
    queryKey: ["coa_min"],
    queryFn: async () => { const { data } = await supabase.from("chart_of_accounts" as any).select("id,code,name,account_type"); return (data || []) as unknown as Account[]; },
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["je_posted_min"],
    queryFn: async () => { const { data } = await supabase.from("journal_entries" as any).select("id,status,entry_date"); return (data || []) as unknown as Entry[]; },
  });
  const { data: lines = [] } = useQuery({
    queryKey: ["jel_costcenter"],
    queryFn: async () => { const { data } = await supabase.from("journal_entry_lines" as any).select("account_id,airline_id,service_type,company_id,station_id,base_amount,debit,credit,entry_id"); return (data || []) as unknown as Line[]; },
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies_lookup"],
    queryFn: async () => { const { data } = await supabase.from("companies" as any).select("id,name").order("name"); return (data || []) as unknown as Lookup[]; },
  });
  const { data: stations = [] } = useQuery({
    queryKey: ["fin_stations_lookup"],
    queryFn: async () => { const { data } = await supabase.from("finance_stations" as any).select("id,name,company_id").order("name"); return (data || []) as unknown as Lookup[]; },
  });
  const { data: airlines = [] } = useQuery({
    queryKey: ["airlines_lookup_cc"],
    queryFn: async () => { const { data } = await supabase.from("airlines").select("id,name").order("name"); return (data || []) as unknown as Lookup[]; },
  });

  const entryMap = useMemo(() => Object.fromEntries(entries.map(e => [e.id, e])), [entries]);
  const acctMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts]);
  const airlineName = (id: string | null) => (id && airlines.find(a => a.id === id)?.name) || "Unassigned";

  // Filter lines by scope + posted entries only
  const filtered = useMemo(() => lines.filter(l => {
    const e = entryMap[l.entry_id];
    if (!e || (e.status || "").toLowerCase() !== "posted") return false;
    if (companyFilter !== "all" && l.company_id !== companyFilter) return false;
    if (stationFilter !== "all" && l.station_id !== stationFilter) return false;
    if (dateFrom && e.entry_date < dateFrom) return false;
    if (dateTo && e.entry_date > dateTo) return false;
    return true;
  }), [lines, entryMap, companyFilter, stationFilter, dateFrom, dateTo]);

  const classify = (accountId: string): "revenue" | "expense" | null => {
    const a = acctMap[accountId];
    if (!a) return null;
    const t = (a.account_type || "").toLowerCase();
    if (t === "revenue" || t === "income") return "revenue";
    if (t === "expense" || t === "expenses" || t === "cost of sales" || t === "cogs") return "expense";
    if (a.code?.startsWith("4")) return "revenue";
    if (a.code?.startsWith("5") || a.code?.startsWith("6")) return "expense";
    return null;
  };

  const amountOf = (l: Line) => Number(l.base_amount ?? (l.debit - l.credit)) || 0;

  const pivot = (keyFn: (l: Line) => string) => {
    const map = new Map<string, { revenue: number; expense: number }>();
    filtered.forEach(l => {
      const cls = classify(l.account_id);
      if (!cls) return;
      const k = keyFn(l);
      const row = map.get(k) ?? { revenue: 0, expense: 0 };
      const amt = Math.abs(amountOf(l));
      // Revenue: credit − debit is positive when income posted correctly
      if (cls === "revenue") row.revenue += (Number(l.credit) - Number(l.debit));
      else row.expense += (Number(l.debit) - Number(l.credit));
      map.set(k, row);
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, revenue: v.revenue, expense: v.expense, profit: v.revenue - v.expense }))
      .sort((a, b) => b.profit - a.profit);
  };

  const byAirline = useMemo(() => pivot(l => l.airline_id || "__unassigned__").map(r => ({ ...r, label: r.key === "__unassigned__" ? "Unassigned" : airlineName(r.key) })), [filtered, airlines, acctMap]);
  const byServiceType = useMemo(() => pivot(l => l.service_type || "__unassigned__").map(r => ({ ...r, label: r.key === "__unassigned__" ? "Unassigned" : r.key })), [filtered, acctMap]);
  const byAirlineService = useMemo(() => pivot(l => `${l.airline_id || "-"}|${l.service_type || "-"}`).map(r => {
    const [aid, svc] = r.key.split("|");
    return { ...r, airline: aid === "-" ? "Unassigned" : airlineName(aid), service: svc === "-" ? "Unassigned" : svc };
  }), [filtered, airlines, acctMap]);

  const totals = useMemo(() => byAirline.reduce((acc, r) => ({ revenue: acc.revenue + r.revenue, expense: acc.expense + r.expense, profit: acc.profit + r.profit }), { revenue: 0, expense: 0, profit: 0 }), [byAirline]);

  const stationsForCompany = useMemo(() => companyFilter === "all" ? stations : stations.filter(s => s.company_id === companyFilter), [stations, companyFilter]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byAirline.map(r => ({ Airline: r.label, Revenue: r.revenue, Expense: r.expense, Profit: r.profit }))), "By Airline");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byServiceType.map(r => ({ Service: r.label, Revenue: r.revenue, Expense: r.expense, Profit: r.profit }))), "By Service");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byAirlineService.map(r => ({ Airline: r.airline, Service: r.service, Revenue: r.revenue, Expense: r.expense, Profit: r.profit }))), "Airline x Service");
    XLSX.writeFile(wb, `cost-center-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="text-primary" /> Cost Center Reports</h1>
          <p className="text-sm text-muted-foreground">Profitability by Airline · Service Type (4D cost-center analysis)</p>
        </div>
        <Button onClick={exportExcel} variant="outline" className="gap-2"><Download size={14} /> Export Excel</Button>
      </div>

      {/* Scope filters */}
      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Company</label>
            <Select value={companyFilter} onValueChange={(v) => { setCompanyFilter(v); setStationFilter("all"); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Station</label>
            <Select value={stationFilter} onValueChange={setStationFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stations</SelectItem>
                {stationsForCompany.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">From</label>
            <DateInput  value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full border border-input rounded-md h-10 px-3 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">To</label>
            <DateInput  value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full border border-input rounded-md h-10 px-3 text-sm bg-background" />
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground uppercase font-semibold">Revenue</div><div className="text-2xl font-bold text-success flex items-center gap-1"><TrendingUp size={18} /> {fmt(totals.revenue)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground uppercase font-semibold">Expense</div><div className="text-2xl font-bold text-destructive flex items-center gap-1"><TrendingDown size={18} /> {fmt(totals.expense)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground uppercase font-semibold">Profit</div><div className={`text-2xl font-bold ${totals.profit >= 0 ? "text-success" : "text-destructive"}`}>{fmt(totals.profit)}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="airline">
        <TabsList>
          <TabsTrigger value="airline">By Airline</TabsTrigger>
          <TabsTrigger value="service">By Service Type</TabsTrigger>
          <TabsTrigger value="matrix">Airline × Service</TabsTrigger>
        </TabsList>

        <TabsContent value="airline">
          <Card><CardHeader><CardTitle className="text-sm">Profitability by Airline</CardTitle></CardHeader><CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Airline</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Expense</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin %</TableHead></TableRow></TableHeader>
              <TableBody>
                {byAirline.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No posted journal lines match the filters.</TableCell></TableRow> : byAirline.map(r => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.revenue)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.expense)}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${r.profit >= 0 ? "text-success" : "text-destructive"}`}>{fmt(r.profit)}</TableCell>
                    <TableCell className="text-right font-mono">{r.revenue ? ((r.profit / r.revenue) * 100).toFixed(1) : "—"}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="service">
          <Card><CardHeader><CardTitle className="text-sm">Profitability by Service Type</CardTitle></CardHeader><CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Service Type</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Expense</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin %</TableHead></TableRow></TableHeader>
              <TableBody>
                {byServiceType.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No posted journal lines match the filters.</TableCell></TableRow> : byServiceType.map(r => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.revenue)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.expense)}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${r.profit >= 0 ? "text-success" : "text-destructive"}`}>{fmt(r.profit)}</TableCell>
                    <TableCell className="text-right font-mono">{r.revenue ? ((r.profit / r.revenue) * 100).toFixed(1) : "—"}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="matrix">
          <Card><CardHeader><CardTitle className="text-sm">Airline × Service Type Matrix</CardTitle></CardHeader><CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Airline</TableHead><TableHead>Service</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Expense</TableHead><TableHead className="text-right">Profit</TableHead></TableRow></TableHeader>
              <TableBody>
                {byAirlineService.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No posted journal lines match the filters.</TableCell></TableRow> : byAirlineService.map(r => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.airline}</TableCell>
                    <TableCell>{r.service}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.revenue)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.expense)}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${r.profit >= 0 ? "text-success" : "text-destructive"}`}>{fmt(r.profit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
