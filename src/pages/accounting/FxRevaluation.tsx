// Phase 1k — FX Revaluation
// Period-end revaluation of open AR (invoices) and AP (vendor_invoices)
// balances denominated in a foreign transaction currency. For each open
// document we compare the base value stamped at issue-time against the base
// value implied by the latest exchange_rate as of the revaluation date. The
// delta is an unrealized FX gain/loss and can be posted as a journal entry.
//
// Sign convention (base currency perspective):
//   AR (asset)      : new_base > old_base  ⇒ unrealized GAIN   (Dr AR / Cr Gain)
//   AP (liability)  : new_base > old_base  ⇒ unrealized LOSS   (Dr Loss / Cr AP)
// (inverse for a drop in rate)

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Download, TrendingUp, TrendingDown, RefreshCw, FileCheck2 } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";

type Invoice = {
  id: string; invoice_no: string; date: string; operator: string | null;
  total: number | null; base_total: number | null; status: string | null;
  transaction_currency: string | null; base_currency: string | null;
  exchange_rate: number | null; company_id: string | null; station_id: string | null;
};
type Vendor = {
  id: string; invoice_no: string; date: string; vendor_name: string | null;
  total: number | null; status: string | null; currency: string | null;
};
type Rate = {
  rate_date: string; base_currency: string; quote_currency: string; mid_rate: number;
};
type Account = { id: string; code: string; name: string };
type Lookup = { id: string; name: string };

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Latest rate on or before `asOf` converting `from` → `to` (1 unit of `from` in `to`). */
function rateAt(rates: Rate[], from: string, to: string, asOf: string): number | null {
  if (!from || !to || from === to) return 1;
  const direct = rates
    .filter(r => r.base_currency === from && r.quote_currency === to && r.rate_date <= asOf)
    .sort((a, b) => b.rate_date.localeCompare(a.rate_date))[0];
  if (direct?.mid_rate) return Number(direct.mid_rate);
  const inverse = rates
    .filter(r => r.base_currency === to && r.quote_currency === from && r.rate_date <= asOf)
    .sort((a, b) => b.rate_date.localeCompare(a.rate_date))[0];
  if (inverse?.mid_rate) return 1 / Number(inverse.mid_rate);
  return null;
}

export default function FxRevaluationPage() {
  const qc = useQueryClient();
  const [asOf, setAsOf] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [baseCurrency, setBaseCurrency] = useState<string>("EGP");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [posting, setPosting] = useState(false);

  const { data: invoices = [] } = useQuery({
    queryKey: ["fx_invoices_open"],
    queryFn: async () => {
      const { data } = await supabase.from("invoices" as any)
        .select("id,invoice_no,date,operator,total,base_total,status,transaction_currency,base_currency,exchange_rate,company_id,station_id");
      return (data || []) as unknown as Invoice[];
    },
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["fx_vendor_invoices_open"],
    queryFn: async () => {
      const { data } = await supabase.from("vendor_invoices" as any)
        .select("id,invoice_no,date,vendor_name,total,status,currency");
      return (data || []) as unknown as Vendor[];
    },
  });
  const { data: rates = [] } = useQuery({
    queryKey: ["fx_rates_all"],
    queryFn: async () => {
      const { data } = await supabase.from("exchange_rates" as any).select("rate_date,base_currency,quote_currency,mid_rate");
      return (data || []) as unknown as Rate[];
    },
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["fx_coa"],
    queryFn: async () => {
      const { data } = await supabase.from("chart_of_accounts" as any).select("id,code,name");
      return (data || []) as unknown as Account[];
    },
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["fx_companies"],
    queryFn: async () => {
      const { data } = await supabase.from("companies" as any).select("id,name").order("name");
      return (data || []) as unknown as Lookup[];
    },
  });

  const acctByCode = useMemo(() => {
    const map: Record<string, Account> = {};
    for (const a of accounts) if (a.code) map[a.code] = a;
    return map;
  }, [accounts]);

  const arRows = useMemo(() => {
    return invoices
      .filter(i => (i.status || "").toLowerCase() !== "paid")
      .filter(i => (i.transaction_currency || i.base_currency || baseCurrency) !== baseCurrency)
      .filter(i => companyFilter === "all" || i.company_id === companyFilter)
      .map(i => {
        const txnCcy = i.transaction_currency || i.base_currency || baseCurrency;
        const txnAmt = Number(i.total || 0);
        const oldRate = Number(i.exchange_rate || 0) || null;
        const newRate = rateAt(rates, txnCcy, baseCurrency, asOf);
        const oldBase = oldRate ? txnAmt * oldRate : Number(i.base_total || 0);
        const newBase = newRate ? txnAmt * newRate : oldBase;
        const delta = newBase - oldBase; // AR: positive = gain
        return { ...i, txnCcy, txnAmt, oldRate, newRate, oldBase, newBase, delta };
      });
  }, [invoices, rates, asOf, baseCurrency, companyFilter]);

  const apRows = useMemo(() => {
    return vendors
      .filter(v => (v.status || "").toLowerCase() !== "paid")
      .filter(v => (v.currency || baseCurrency) !== baseCurrency)
      .map(v => {
        const txnCcy = v.currency || baseCurrency;
        const txnAmt = Number(v.total || 0);
        // vendor_invoices doesn't stamp an issue-time rate; use the rate on
        // the invoice date as the "old" baseline so revaluation still works.
        const oldRate = rateAt(rates, txnCcy, baseCurrency, v.date);
        const newRate = rateAt(rates, txnCcy, baseCurrency, asOf);
        const oldBase = oldRate ? txnAmt * oldRate : 0;
        const newBase = newRate ? txnAmt * newRate : oldBase;
        const delta = newBase - oldBase; // AP: positive = loss
        return { ...v, txnCcy, txnAmt, oldRate, newRate, oldBase, newBase, delta };
      });
  }, [vendors, rates, asOf, baseCurrency]);

  const arGain = arRows.filter(r => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const arLoss = arRows.filter(r => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0);
  const apLoss = apRows.filter(r => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const apGain = apRows.filter(r => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0);
  const netGain = arGain + apGain;
  const netLoss = arLoss + apLoss;
  const netImpact = netGain - netLoss;

  const missingRateCount = [...arRows, ...apRows].filter(r => !r.newRate).length;

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(arRows.map(r => ({
      Invoice: r.invoice_no, Date: r.date, Customer: r.operator,
      Currency: r.txnCcy, Amount: r.txnAmt, "Old Rate": r.oldRate, "New Rate": r.newRate,
      "Old Base": r.oldBase, "New Base": r.newBase, "Delta (Gain+ / Loss-)": r.delta,
    }))), "AR Revaluation");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(apRows.map(r => ({
      Invoice: r.invoice_no, Date: r.date, Vendor: r.vendor_name,
      Currency: r.txnCcy, Amount: r.txnAmt, "Old Rate": r.oldRate, "New Rate": r.newRate,
      "Old Base": r.oldBase, "New Base": r.newBase, "Delta (Loss+ / Gain-)": r.delta,
    }))), "AP Revaluation");
    XLSX.writeFile(wb, `fx-revaluation-${asOf}.xlsx`);
  }

  async function postRevaluation() {
    if (Math.abs(netImpact) < 0.01) {
      toast({ title: "Nothing to post", description: "Net FX impact is zero." });
      return;
    }
    const arAcct = acctByCode["1200"] || acctByCode["1210"] || Object.values(acctByCode).find(a => /receivab/i.test(a.name));
    const apAcct = acctByCode["2100"] || acctByCode["2110"] || Object.values(acctByCode).find(a => /payab/i.test(a.name));
    const gainAcct = acctByCode["4900"] || Object.values(acctByCode).find(a => /fx.*gain|forex.*gain|exchange.*gain/i.test(a.name));
    const lossAcct = acctByCode["5900"] || Object.values(acctByCode).find(a => /fx.*loss|forex.*loss|exchange.*loss/i.test(a.name));

    if (!arAcct || !apAcct || !gainAcct || !lossAcct) {
      toast({
        title: "Missing chart of accounts entries",
        description: "Need AR, AP, FX Gain, and FX Loss accounts. Configure them in Chart of Accounts first.",
        variant: "destructive",
      });
      return;
    }

    setPosting(true);
    try {
      const arDelta = arRows.reduce((s, r) => s + r.delta, 0); // + gain, − loss
      const apDelta = apRows.reduce((s, r) => s + r.delta, 0); // + loss, − gain

      const { data: entry, error: eErr } = await (supabase.from("journal_entries" as any).insert({
        entry_no: `FX-${asOf.replace(/-/g, "")}`,
        entry_date: asOf,
        description: `FX Revaluation as of ${asOf}`,
        reference_type: "fx_revaluation",
        status: "Posted",
        posted_at: new Date().toISOString(),
        base_currency: baseCurrency,
      }).select("id").single()) as any;
      if (eErr) throw eErr;
      const entryId = entry.id;

      const lines: any[] = [];
      // AR side
      if (Math.abs(arDelta) >= 0.01) {
        if (arDelta > 0) {
          lines.push({ entry_id: entryId, account_id: arAcct.id, debit: arDelta, credit: 0, description: "AR FX revaluation" });
          lines.push({ entry_id: entryId, account_id: gainAcct.id, debit: 0, credit: arDelta, description: "Unrealized FX gain (AR)" });
        } else {
          lines.push({ entry_id: entryId, account_id: lossAcct.id, debit: -arDelta, credit: 0, description: "Unrealized FX loss (AR)" });
          lines.push({ entry_id: entryId, account_id: arAcct.id, debit: 0, credit: -arDelta, description: "AR FX revaluation" });
        }
      }
      // AP side
      if (Math.abs(apDelta) >= 0.01) {
        if (apDelta > 0) {
          lines.push({ entry_id: entryId, account_id: lossAcct.id, debit: apDelta, credit: 0, description: "Unrealized FX loss (AP)" });
          lines.push({ entry_id: entryId, account_id: apAcct.id, debit: 0, credit: apDelta, description: "AP FX revaluation" });
        } else {
          lines.push({ entry_id: entryId, account_id: apAcct.id, debit: -apDelta, credit: 0, description: "AP FX revaluation" });
          lines.push({ entry_id: entryId, account_id: gainAcct.id, debit: 0, credit: -apDelta, description: "Unrealized FX gain (AP)" });
        }
      }

      const { error: lErr } = await (supabase.from("journal_entry_lines" as any).insert(lines));
      if (lErr) throw lErr;

      toast({ title: "Posted", description: `FX Revaluation journal entry posted (${lines.length} lines).` });
      qc.invalidateQueries();
    } catch (err: any) {
      toast({ title: "Failed to post", description: err.message || String(err), variant: "destructive" });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><RefreshCw className="h-6 w-6" /> FX Revaluation</h1>
          <p className="text-sm text-muted-foreground">Period-end revaluation of open AR / AP balances against the latest exchange rates.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">As of</span>
            <DateInput  value={asOf} onChange={e => setAsOf(e.target.value)} className="w-40" />
          </div>
          <Select value={baseCurrency} onValueChange={setBaseCurrency}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["EGP", "USD", "EUR", "AED", "SAR", "GBP", "JOD", "MAD", "KWD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Company" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportExcel}><Download className="h-4 w-4 mr-1" />Export</Button>
          <Button onClick={postRevaluation} disabled={posting}><FileCheck2 className="h-4 w-4 mr-1" />{posting ? "Posting…" : "Post Revaluation"}</Button>
        </div>
      </div>

      {missingRateCount > 0 && (
        <Card><CardContent className="py-3 text-sm text-amber-700 dark:text-amber-400">
          {missingRateCount} document(s) have no exchange rate available on or before {asOf}. They are shown with zero delta.
        </CardContent></Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Unrealized Gain</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-emerald-600 flex items-center gap-2"><TrendingUp className="h-5 w-5" />{fmt(netGain)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Unrealized Loss</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-rose-600 flex items-center gap-2"><TrendingDown className="h-5 w-5" />{fmt(netLoss)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Net Impact ({baseCurrency})</CardTitle></CardHeader>
          <CardContent className={`text-2xl font-semibold ${netImpact >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(netImpact)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Open Docs</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{arRows.length + apRows.length}</CardContent></Card>
      </div>

      <Tabs defaultValue="ar">
        <TabsList>
          <TabsTrigger value="ar">Receivables ({arRows.length})</TabsTrigger>
          <TabsTrigger value="ap">Payables ({apRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ar">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
                <TableHead>Ccy</TableHead><TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Old Rate</TableHead><TableHead className="text-right">New Rate</TableHead>
                <TableHead className="text-right">Old Base</TableHead><TableHead className="text-right">New Base</TableHead>
                <TableHead className="text-right">Δ Gain/Loss</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {arRows.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No open foreign-currency receivables.</TableCell></TableRow>}
                {arRows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.invoice_no}</TableCell>
                    <TableCell>{r.date}</TableCell>
                    <TableCell>{r.operator || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{r.txnCcy}</Badge></TableCell>
                    <TableCell className="text-right">{fmt(r.txnAmt)}</TableCell>
                    <TableCell className="text-right">{r.oldRate ? r.oldRate.toFixed(4) : "—"}</TableCell>
                    <TableCell className="text-right">{r.newRate ? r.newRate.toFixed(4) : "—"}</TableCell>
                    <TableCell className="text-right">{fmt(r.oldBase)}</TableCell>
                    <TableCell className="text-right">{fmt(r.newBase)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(r.delta)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="ap">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Vendor</TableHead>
                <TableHead>Ccy</TableHead><TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Old Rate</TableHead><TableHead className="text-right">New Rate</TableHead>
                <TableHead className="text-right">Old Base</TableHead><TableHead className="text-right">New Base</TableHead>
                <TableHead className="text-right">Δ Loss/Gain</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {apRows.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No open foreign-currency payables.</TableCell></TableRow>}
                {apRows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.invoice_no}</TableCell>
                    <TableCell>{r.date}</TableCell>
                    <TableCell>{r.vendor_name || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{r.txnCcy}</Badge></TableCell>
                    <TableCell className="text-right">{fmt(r.txnAmt)}</TableCell>
                    <TableCell className="text-right">{r.oldRate ? r.oldRate.toFixed(4) : "—"}</TableCell>
                    <TableCell className="text-right">{r.newRate ? r.newRate.toFixed(4) : "—"}</TableCell>
                    <TableCell className="text-right">{fmt(r.oldBase)}</TableCell>
                    <TableCell className="text-right">{fmt(r.newBase)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.delta <= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(r.delta)}</TableCell>
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
