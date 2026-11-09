import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  Landmark, Wallet, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight,
  ClipboardCheck, ChevronRight, TrendingUp, TrendingDown, AlertTriangle, Scale,
  CalendarIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import TreasuryDailyBoard from "@/components/treasury/TreasuryDailyBoard";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts";

const links = [
  { to: "/treasury/bank-accounts", label: "Bank Accounts", desc: "Manage bank accounts, IBAN, balances", icon: Landmark, color: "text-blue-600" },
  { to: "/treasury/cash-accounts", label: "Cash Accounts", desc: "Petty cash & cash on hand", icon: Wallet, color: "text-emerald-600" },
  { to: "/treasury/receipts", label: "Receipts", desc: "Customer collections & receipts", icon: ArrowDownToLine, color: "text-green-600" },
  { to: "/treasury/payments", label: "Payments", desc: "Vendor & supplier payments", icon: ArrowUpFromLine, color: "text-rose-600" },
  { to: "/treasury/bank-transfers", label: "Bank Transfers", desc: "Inter-account transfers", icon: ArrowLeftRight, color: "text-violet-600" },
  { to: "/treasury/bank-reconciliation", label: "Bank Reconciliation", desc: "Reconcile statements vs system", icon: ClipboardCheck, color: "text-amber-600" },
];

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const ddmm = (iso: string) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`; };
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const fmtDdmmyyyy = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;

const COLORS = ["hsl(217 91% 60%)", "hsl(160 84% 39%)", "hsl(280 75% 60%)", "hsl(38 92% 50%)", "hsl(0 84% 60%)", "hsl(190 95% 39%)"];

type Preset = "7d" | "30d" | "90d" | "mtd" | "ytd" | "custom";

function presetRange(p: Preset): { from: Date; to: Date } {
  const to = new Date(); to.setHours(23, 59, 59, 999);
  const from = new Date(); from.setHours(0, 0, 0, 0);
  if (p === "7d") from.setDate(from.getDate() - 6);
  else if (p === "30d") from.setDate(from.getDate() - 29);
  else if (p === "90d") from.setDate(from.getDate() - 89);
  else if (p === "mtd") from.setDate(1);
  else if (p === "ytd") { from.setMonth(0); from.setDate(1); }
  return { from, to };
}

export default function TreasuryPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  const range = useMemo(() => {
    if (preset === "custom" && customRange.from && customRange.to) {
      return { from: customRange.from, to: customRange.to };
    }
    return presetRange(preset === "custom" ? "30d" : preset);
  }, [preset, customRange]);
  const fromIso = toIso(range.from);
  const toIsoStr = toIso(range.to);
  const dayCount = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000) + 1);

  const presetLabels: Record<Preset, string> = {
    "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days",
    mtd: "Month to date", ytd: "Year to date", custom: "Custom",
  };

  const [data, setData] = useState<{ banks: any[]; cash: any[]; payments: any[]; receipts: any[]; transfers: any[]; recs: any[] }>({
    banks: [], cash: [], payments: [], receipts: [], transfers: [], recs: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const [b, c, p, r, t, rec] = await Promise.all([
        (supabase.from as any)("bank_accounts").select("*"),
        (supabase.from as any)("cash_accounts").select("*"),
        (supabase.from as any)("payments").select("*").gte("payment_date", fromIso).lte("payment_date", toIsoStr).order("payment_date", { ascending: true }),
        (supabase.from as any)("receipts").select("*").gte("receipt_date", fromIso).lte("receipt_date", toIsoStr).order("receipt_date", { ascending: true }),
        (supabase.from as any)("bank_transfers").select("*").gte("transfer_date", fromIso).lte("transfer_date", toIsoStr),
        (supabase.from as any)("bank_reconciliations").select("*").order("statement_date", { ascending: false }).limit(20),
      ]);
      setData({
        banks: b.data || [], cash: c.data || [],
        payments: p.data || [], receipts: r.data || [], transfers: t.data || [], recs: rec.data || [],
      });
      setLoading(false);
    })();
  }, [fromIso, toIsoStr]);

  const sum = (rows: any[], k: string) => rows.reduce((s, x) => s + Number(x[k] || 0), 0);

  const bankBal = sum(data.banks, "current_balance");
  const cashBal = sum(data.cash, "current_balance");
  const totalLiquidity = bankBal + cashBal;
  const receiptsPeriod = sum(data.receipts, "amount");
  const paymentsPeriod = sum(data.payments, "amount");
  const transfersPeriod = sum(data.transfers, "amount");
  const netCashflowPeriod = receiptsPeriod - paymentsPeriod;

  // Reconciliation
  const openRecs = data.recs.filter(r => r.status === "Open");
  const totalDifference = sum(data.recs.filter(r => r.status === "Open"), "difference");
  const lastRec = data.recs[0];

  // Cashflow series across selected range
  const flowSeries = useMemo(() => {
    const days: Record<string, { date: string; receipts: number; payments: number; net: number }> = {};
    const start = new Date(range.from); start.setHours(0, 0, 0, 0);
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const key = toIso(d);
      days[key] = { date: key, receipts: 0, payments: 0, net: 0 };
    }
    data.receipts.forEach(r => { if (days[r.receipt_date]) days[r.receipt_date].receipts += Number(r.amount || 0); });
    data.payments.forEach(p => { if (days[p.payment_date]) days[p.payment_date].payments += Number(p.amount || 0); });
    return Object.values(days).map(d => ({ ...d, label: ddmm(d.date), net: d.receipts - d.payments }));
  }, [data, range.from, dayCount]);

  // Account distribution
  const accountDist = useMemo(() => {
    return [
      ...data.banks.map(b => ({ name: b.account_name || b.bank_name, value: Number(b.current_balance || 0), type: "Bank" })),
      ...data.cash.map(c => ({ name: c.account_name, value: Number(c.current_balance || 0), type: "Cash" })),
    ].filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [data]);

  // Currency breakdown
  const currencyBreakdown = useMemo(() => {
    const m: Record<string, number> = {};
    [...data.banks, ...data.cash].forEach(a => {
      const cur = a.currency || "USD";
      m[cur] = (m[cur] || 0) + Number(a.current_balance || 0);
    });
    return Object.entries(m).map(([currency, balance]) => ({ currency, balance }));
  }, [data]);

  const periodSuffix = preset === "custom" && customRange.from && customRange.to
    ? `${fmtDdmmyyyy(customRange.from)} – ${fmtDdmmyyyy(customRange.to)}`
    : presetLabels[preset];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Treasury Overview</h1>
          <p className="text-sm text-muted-foreground">Cash, banking, payments, receipts and reconciliation</p>
        </div>

        {/* Date range filter */}
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={preset}
            onValueChange={(v) => v && setPreset(v as Preset)}
            size="sm"
            variant="outline"
          >
            <ToggleGroupItem value="7d">7d</ToggleGroupItem>
            <ToggleGroupItem value="30d">30d</ToggleGroupItem>
            <ToggleGroupItem value="90d">90d</ToggleGroupItem>
            <ToggleGroupItem value="mtd">MTD</ToggleGroupItem>
            <ToggleGroupItem value="ytd">YTD</ToggleGroupItem>
          </ToggleGroup>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={preset === "custom" ? "default" : "outline"}
                size="sm"
                className={cn("h-9 justify-start text-left font-normal", preset !== "custom" && "text-muted-foreground")}
                onClick={() => setPreset("custom")}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {preset === "custom" && customRange.from && customRange.to
                  ? `${fmtDdmmyyyy(customRange.from)} – ${fmtDdmmyyyy(customRange.to)}`
                  : "Custom range"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={customRange as any}
                onSelect={(r: any) => { setCustomRange(r || {}); if (r?.from && r?.to) setPreset("custom"); }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="text-xs text-muted-foreground -mt-4">Showing data for: <span className="font-medium text-foreground">{periodSuffix}</span> ({dayCount} days)</div>

      <TreasuryDailyBoard />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Liquidity</div>
          <div className="text-xl font-bold">{fmt(totalLiquidity)}</div>
          <div className="text-[11px] text-muted-foreground">{data.banks.length + data.cash.length} accounts</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Landmark size={12}/> Bank Balance</div>
          <div className="text-xl font-bold text-blue-600">{fmt(bankBal)}</div>
          <div className="text-[11px] text-muted-foreground">{data.banks.length} accounts</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet size={12}/> Cash Balance</div>
          <div className="text-xl font-bold text-emerald-600">{fmt(cashBal)}</div>
          <div className="text-[11px] text-muted-foreground">{data.cash.length} accounts</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp size={12}/> Receipts</div>
          <div className="text-xl font-bold text-green-600">{fmt(receiptsPeriod)}</div>
          <div className="text-[11px] text-muted-foreground">{data.receipts.length} entries · {periodSuffix}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown size={12}/> Payments</div>
          <div className="text-xl font-bold text-rose-600">{fmt(paymentsPeriod)}</div>
          <div className="text-[11px] text-muted-foreground">{data.payments.length} entries · {periodSuffix}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Scale size={12}/> Net Cashflow</div>
          <div className={`text-xl font-bold ${netCashflowPeriod >= 0 ? "text-green-600" : "text-rose-600"}`}>{netCashflowPeriod >= 0 ? "+" : ""}{fmt(netCashflowPeriod)}</div>
          <div className="text-[11px] text-muted-foreground">Receipts − Payments</div>
        </CardContent></Card>
      </div>

      {/* Reconciliation status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><ClipboardCheck size={16}/> Reconciliation Status</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Last 20 reconciliations</p>
          </div>
          <Link to="/treasury/bank-reconciliation" className="text-xs text-primary hover:underline">View all →</Link>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-xs text-muted-foreground">Open</div>
            <div className="text-2xl font-bold text-amber-600">{openRecs.length}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-xs text-muted-foreground">Reconciled</div>
            <div className="text-2xl font-bold text-green-600">{data.recs.filter(r => r.status === "Reconciled" || r.status === "Closed").length}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle size={12}/> Open Difference</div>
            <div className={`text-2xl font-bold ${Math.abs(totalDifference) > 0 ? "text-rose-600" : "text-green-600"}`}>{fmt(totalDifference)}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-xs text-muted-foreground">Last Statement</div>
            <div className="text-sm font-semibold">{lastRec ? new Date(lastRec.statement_date).toLocaleDateString("en-GB") : "—"}</div>
            {lastRec && <Badge variant="outline" className="mt-1 text-[10px]">{lastRec.status}</Badge>}
          </div>
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Cashflow — {periodSuffix}</CardTitle></CardHeader>
          <CardContent className="h-72">
            {loading ? <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading…</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flowSeries}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="receipts" stroke="hsl(160 84% 39%)" fill="hsl(160 84% 39%)" fillOpacity={0.25} name="Receipts" />
                  <Area type="monotone" dataKey="payments" stroke="hsl(0 84% 60%)" fill="hsl(0 84% 60%)" fillOpacity={0.25} name="Payments" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Account Distribution</CardTitle></CardHeader>
          <CardContent className="h-72">
            {accountDist.length === 0 ? <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No balances yet</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={accountDist} dataKey="value" nameKey="name" outerRadius={80} label={(e: any) => e.name}>
                    {accountDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Currency + 30d totals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Balance by Currency</CardTitle></CardHeader>
          <CardContent className="h-64">
            {currencyBreakdown.length === 0 ? <div className="flex items-center justify-center h-full text-sm text-muted-foreground">—</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={currencyBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="currency" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="balance" fill="hsl(217 91% 60%)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Activity — {periodSuffix}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-lg bg-green-500/10">
              <div className="text-xs text-muted-foreground">Receipts</div>
              <div className="text-2xl font-bold text-green-600">{fmt(receiptsPeriod)}</div>
              <div className="text-[11px] text-muted-foreground">{data.receipts.length} entries</div>
            </div>
            <div className="p-4 rounded-lg bg-rose-500/10">
              <div className="text-xs text-muted-foreground">Payments</div>
              <div className="text-2xl font-bold text-rose-600">{fmt(paymentsPeriod)}</div>
              <div className="text-[11px] text-muted-foreground">{data.payments.length} entries</div>
            </div>
            <div className="p-4 rounded-lg bg-violet-500/10">
              <div className="text-xs text-muted-foreground">Transfers</div>
              <div className="text-2xl font-bold text-violet-600">{fmt(transfersPeriod)}</div>
              <div className="text-[11px] text-muted-foreground">{data.transfers.length} entries</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick Access</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {links.map((l) => {
            const Icon = l.icon;
            return (
              <Link key={l.to} to={l.to}>
                <Card className="hover:shadow-md transition-all hover:-translate-y-0.5 cursor-pointer h-full">
                  <CardHeader className="flex flex-row items-center gap-3 pb-2">
                    <div className={`p-2 rounded-lg bg-muted ${l.color}`}><Icon size={20} /></div>
                    <CardTitle className="text-base flex-1">{l.label}</CardTitle>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">{l.desc}</CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
