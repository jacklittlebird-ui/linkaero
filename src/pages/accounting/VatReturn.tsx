// Phase 1l — VAT Return
// Reconciles Output VAT (sales / client invoices) against Input VAT
// (purchases / vendor invoices) for a chosen period, scoped by
// Company × Station × Date-range. Net VAT payable = Output − Input.
//
// Output VAT source : public.invoices           (vat column, per line)
// Input VAT source  : public.vendor_invoices    (vat column, per line)
//
// Notes:
// - `vendor_invoices` currently has no company_id / station_id in schema,
//   so Company/Station filters apply only to Output VAT. Input VAT stays
//   at the group level and the UI shows a small note explaining this.
// - "Included" status = anything except Draft/Void/Cancelled.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Download, Receipt, ArrowDownCircle, ArrowUpCircle, Scale } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";

type Invoice = {
  id: string; invoice_no: string; date: string; operator: string | null;
  station: string | null; company_id: string | null; station_id: string | null;
  subtotal: number | null; vat: number | null; total: number | null;
  currency: string | null; status: string | null;
};
type Vendor = {
  id: string; invoice_no: string; date: string; vendor_name: string | null;
  amount: number | null; vat: number | null; total: number | null;
  currency: string | null; status: string | null;
};
type Lookup = { id: string; name: string; code?: string | null };

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const EXCLUDED = new Set(["draft", "void", "cancelled", "canceled"]);
const isIncluded = (s: string | null | undefined) =>
  !EXCLUDED.has(String(s ?? "").trim().toLowerCase());

function monthDefaults() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function VatReturnPage() {
  const def = monthDefaults();
  const [fromDate, setFromDate] = useState<string>(def.from);
  const [toDate, setToDate] = useState<string>(def.to);
  const [companyId, setCompanyId] = useState<string>("all");
  const [stationId, setStationId] = useState<string>("all");

  const { data: companies = [] } = useQuery({
    queryKey: ["vat", "companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id,name,code").order("name");
      if (error) throw error;
      return (data ?? []) as Lookup[];
    },
  });

  const { data: stations = [] } = useQuery({
    queryKey: ["vat", "stations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_stations").select("id,name,code").order("name");
      if (error) throw error;
      return (data ?? []) as Lookup[];
    },
  });

  const { data: invoices = [], isLoading: loadingInv } = useQuery({
    queryKey: ["vat", "invoices", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,invoice_no,date,operator,station,company_id,station_id,subtotal,vat,total,currency,status")
        .gte("date", fromDate)
        .lte("date", toDate)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });

  const { data: vendorInvoices = [], isLoading: loadingVen } = useQuery({
    queryKey: ["vat", "vendor_invoices", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_invoices")
        .select("id,invoice_no,date,vendor_name,amount,vat,total,currency,status")
        .gte("date", fromDate)
        .lte("date", toDate)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Vendor[];
    },
  });

  const filteredOutput = useMemo(() => {
    return invoices.filter(inv => {
      if (!isIncluded(inv.status)) return false;
      if (companyId !== "all" && inv.company_id !== companyId) return false;
      if (stationId !== "all" && inv.station_id !== stationId) return false;
      return true;
    });
  }, [invoices, companyId, stationId]);

  const filteredInput = useMemo(() => {
    return vendorInvoices.filter(v => isIncluded(v.status));
  }, [vendorInvoices]);

  const totals = useMemo(() => {
    const outSub = filteredOutput.reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
    const outVat = filteredOutput.reduce((s, i) => s + (Number(i.vat) || 0), 0);
    const inSub = filteredInput.reduce((s, v) => s + (Number(v.amount) || 0), 0);
    const inVat = filteredInput.reduce((s, v) => s + (Number(v.vat) || 0), 0);
    return {
      outSub, outVat, inSub, inVat,
      net: outVat - inVat,
      effectiveOutRate: outSub > 0 ? (outVat / outSub) * 100 : 0,
      effectiveInRate: inSub > 0 ? (inVat / inSub) * 100 : 0,
    };
  }, [filteredOutput, filteredInput]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    const summary = [
      ["VAT Return"],
      [`Period: ${fromDate} → ${toDate}`],
      [
        `Company: ${companyId === "all" ? "All" : companies.find(c => c.id === companyId)?.name ?? companyId}`,
      ],
      [
        `Station: ${stationId === "all" ? "All" : stations.find(s => s.id === stationId)?.name ?? stationId}`,
      ],
      [],
      ["Section", "Taxable Base", "VAT", "Effective %"],
      ["Output VAT (Sales)", totals.outSub, totals.outVat, totals.effectiveOutRate],
      ["Input VAT (Purchases)", totals.inSub, totals.inVat, totals.effectiveInRate],
      ["Net VAT Payable / (Refund)", "", totals.net, ""],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        filteredOutput.map(i => ({
          Date: i.date, "Invoice No": i.invoice_no, Customer: i.operator,
          Station: i.station, Currency: i.currency,
          "Taxable Base": Number(i.subtotal) || 0, VAT: Number(i.vat) || 0,
          Total: Number(i.total) || 0, Status: i.status,
        })),
      ),
      "Output VAT",
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        filteredInput.map(v => ({
          Date: v.date, "Invoice No": v.invoice_no, Vendor: v.vendor_name,
          Currency: v.currency,
          "Taxable Base": Number(v.amount) || 0, VAT: Number(v.vat) || 0,
          Total: Number(v.total) || 0, Status: v.status,
        })),
      ),
      "Input VAT",
    );

    XLSX.writeFile(wb, `VAT_Return_${fromDate}_${toDate}.xlsx`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Receipt className="h-6 w-6" /> VAT Return
          </h1>
          <p className="text-sm text-muted-foreground">
            Output vs Input VAT reconciliation for the selected period
          </p>
        </div>
        <Button onClick={exportExcel} variant="outline">
          <Download className="h-4 w-4 mr-2" /> Export
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <DateInput  value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <DateInput  value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Company</label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Station</label>
            <Select value={stationId} onValueChange={setStationId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stations</SelectItem>
                {stations.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <div className="text-xs text-muted-foreground">
              {loadingInv || loadingVen ? "Loading…" : `${filteredOutput.length} sales · ${filteredInput.length} purchases`}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><ArrowUpCircle className="h-4 w-4 text-emerald-500" /> Output VAT</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-600">{fmt(totals.outVat)}</div><div className="text-xs text-muted-foreground">Base: {fmt(totals.outSub)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><ArrowDownCircle className="h-4 w-4 text-sky-500" /> Input VAT</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-sky-600">{fmt(totals.inVat)}</div><div className="text-xs text-muted-foreground">Base: {fmt(totals.inSub)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><Scale className="h-4 w-4" /> Net VAT</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totals.net >= 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(totals.net)}</div>
            <div className="text-xs text-muted-foreground">{totals.net >= 0 ? "Payable" : "Refundable"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Effective Rates</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Output: <span className="font-semibold">{totals.effectiveOutRate.toFixed(2)}%</span></div>
            <div>Input: <span className="font-semibold">{totals.effectiveInRate.toFixed(2)}%</span></div>
          </CardContent>
        </Card>
      </div>

      {(companyId !== "all" || stationId !== "all") && (
        <div className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/40">
          Note: Company / Station filters apply to Output VAT only — vendor invoices are not scoped by finance station in the current schema.
        </div>
      )}

      <Tabs defaultValue="output">
        <TabsList>
          <TabsTrigger value="output">Output VAT — Sales ({filteredOutput.length})</TabsTrigger>
          <TabsTrigger value="input">Input VAT — Purchases ({filteredInput.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="output">
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Station</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Taxable Base</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOutput.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No sales invoices in this period</TableCell></TableRow>
                  ) : filteredOutput.map(i => (
                    <TableRow key={i.id}>
                      <TableCell className="whitespace-nowrap">{i.date ? format(new Date(i.date), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{i.invoice_no}</TableCell>
                      <TableCell>{i.operator}</TableCell>
                      <TableCell>{i.station}</TableCell>
                      <TableCell>{i.currency}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(Number(i.subtotal) || 0)}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-700">{fmt(Number(i.vat) || 0)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(Number(i.total) || 0)}</TableCell>
                      <TableCell><Badge variant="outline">{i.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="input">
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Taxable Base</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInput.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No vendor invoices in this period</TableCell></TableRow>
                  ) : filteredInput.map(v => (
                    <TableRow key={v.id}>
                      <TableCell className="whitespace-nowrap">{v.date ? format(new Date(v.date), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{v.invoice_no}</TableCell>
                      <TableCell>{v.vendor_name}</TableCell>
                      <TableCell>{v.currency}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(Number(v.amount) || 0)}</TableCell>
                      <TableCell className="text-right font-mono text-sky-700">{fmt(Number(v.vat) || 0)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(Number(v.total) || 0)}</TableCell>
                      <TableCell><Badge variant="outline">{v.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
