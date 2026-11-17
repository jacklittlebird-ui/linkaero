// Phase 3w — Segment / Divisional P&L Reporting
// Pivots posted journal_entry_lines by a chosen segment dimension
// (Company, Station, Airline, Service Type) with date-range filters.
// Revenue = 4xxx accounts (credit − debit); Expense = 5xxx/6xxx (debit − credit).

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download, PieChart, TrendingUp, TrendingDown } from "lucide-react";
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
type Lookup = { id: string; name: string };

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Segment = "company" | "station" | "airline" | "service_type";

export default function SegmentPnLPage() {
  const [segment, setSegment] = useState<Segment>("company");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const { data: accounts = [] } = useQuery({
    queryKey: ["coa_segment"],
    queryFn: async () => { const { data } = await supabase.from("chart_of_accounts" as any).select("id,code,name,account_type"); return (data || []) as unknown as Account[]; },
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["je_segment"],
    queryFn: async () => { const { data } = await supabase.from("journal_entries" as any).select("id,status,entry_date"); return (data || []) as unknown as Entry[]; },
  });
  const { data: lines = [] } = useQuery({
    queryKey: ["jel_segment"],
    queryFn: async () => { const { data } = await supabase.from("journal_entry_lines" as any).select("account_id,airline_id,service_type,company_id,station_id,base_amount,debit,credit,entry_id"); return (data || []) as unknown as Line[]; },
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies_seg"],
    queryFn: async () => { const { data } = await supabase.from("companies" as any).select("id,name").order("name"); return (data || []) as unknown as Lookup[]; },
  });
  const { data: stations = [] } = useQuery({
    queryKey: ["stations_seg"],
    queryFn: async () => { const { data } = await supabase.from("finance_stations" as any).select("id,name").order("name"); return (data || []) as unknown as Lookup[]; },
  });
  const { data: airlines = [] } = useQuery({
    queryKey: ["airlines_seg"],
    queryFn: async () => { const { data } = await supabase.from("airlines").select("id,name").order("name"); return (data || []) as unknown as Lookup[]; },
  });

  const entryMap = useMemo(() => Object.fromEntries(entries.map(e => [e.id, e])), [entries]);
  const acctMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts]);
  const nameMaps = useMemo(() => ({
    company: Object.fromEntries(companies.map(c => [c.id, c.name])),
    station: Object.fromEntries(stations.map(s => [s.id, s.name])),
    airline: Object.fromEntries(airlines.map(a => [a.id, a.name])),
  }), [companies, stations, airlines]);

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

  const filtered = useMemo(() => lines.filter(l => {
    const e = entryMap[l.entry_id];
    if (!e || (e.status || "").toLowerCase() !== "posted") return false;
    if (dateFrom && e.entry_date < dateFrom) return false;
    if (dateTo && e.entry_date > dateTo) return false;
    return true;
  }), [lines, entryMap, dateFrom, dateTo]);

  const keyOf = (l: Line) => {
    switch (segment) {
      case "company": return l.company_id || "__unassigned__";
      case "station": return l.station_id || "__unassigned__";
      case "airline": return l.airline_id || "__unassigned__";
      case "service_type": return l.service_type || "__unassigned__";
    }
  };
  const labelOf = (key: string) => {
    if (key === "__unassigned__") return "Unassigned";
    if (segment === "service_type") return key;
    return (nameMaps as any)[segment]?.[key] || key;
  };

  const rows = useMemo(() => {
    const map = new Map<string, { revenue: number; expense: number }>();
    filtered.forEach(l => {
      const cls = classify(l.account_id);
      if (!cls) return;
      const k = keyOf(l);
      const row = map.get(k) ?? { revenue: 0, expense: 0 };
      if (cls === "revenue") row.revenue += (Number(l.credit) - Number(l.debit));
      else row.expense += (Number(l.debit) - Number(l.credit));
      map.set(k, row);
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, label: labelOf(key), revenue: v.revenue, expense: v.expense, profit: v.revenue - v.expense }))
      .sort((a, b) => b.profit - a.profit);
  }, [filtered, segment, nameMaps]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({ revenue: acc.revenue + r.revenue, expense: acc.expense + r.expense, profit: acc.profit + r.profit }), { revenue: 0, expense: 0, profit: 0 }), [rows]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({
      Segment: r.label, Revenue: r.revenue, Expense: r.expense, Profit: r.profit,
      "Margin %": r.revenue ? ((r.profit / r.revenue) * 100).toFixed(2) : "",
    }))), "Segment P&L");
    XLSX.writeFile(wb, `segment-pnl-${segment}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><PieChart className="text-primary" /> Segment / Divisional P&L</h1>
          <p className="text-sm text-muted-foreground">Profitability pivot by Company · Station · Airline · Service Type</p>
        </div>
        <Button onClick={exportExcel} variant="outline" className="gap-2"><Download size={14} /> Export Excel</Button>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Segment</label>
            <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="company">Company</SelectItem>
                <SelectItem value="station">Station</SelectItem>
                <SelectItem value="airline">Airline</SelectItem>
                <SelectItem value="service_type">Service Type</SelectItem>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground uppercase font-semibold">Revenue</div><div className="text-2xl font-bold text-success flex items-center gap-1"><TrendingUp size={18} /> {fmt(totals.revenue)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground uppercase font-semibold">Expense</div><div className="text-2xl font-bold text-destructive flex items-center gap-1"><TrendingDown size={18} /> {fmt(totals.expense)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground uppercase font-semibold">Profit</div><div className={`text-2xl font-bold ${totals.profit >= 0 ? "text-success" : "text-destructive"}`}>{fmt(totals.profit)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">P&L by {segment === "service_type" ? "Service Type" : segment.charAt(0).toUpperCase() + segment.slice(1)}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Segment</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Expense</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Margin %</TableHead>
              <TableHead className="text-right">% of Total Profit</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No posted journal lines match the filters.</TableCell></TableRow>
              ) : rows.map(r => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.revenue)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.expense)}</TableCell>
                  <TableCell className={`text-right font-mono font-bold ${r.profit >= 0 ? "text-success" : "text-destructive"}`}>{fmt(r.profit)}</TableCell>
                  <TableCell className="text-right font-mono">{r.revenue ? ((r.profit / r.revenue) * 100).toFixed(1) : "—"}%</TableCell>
                  <TableCell className="text-right font-mono">{totals.profit ? ((r.profit / totals.profit) * 100).toFixed(1) : "—"}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
