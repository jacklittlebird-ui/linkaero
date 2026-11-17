// Customer & Vendor Statements of Account
// -------------------------------------------------------------
// Per-partner ledger with opening balance, chronological activity,
// running balance, and aging bucket snapshot at the statement date.
//
// Sources:
//   Customers → invoices (AR) + receipts (cash-in against invoice_id)
//   Vendors   → vendor_invoices (AP) + payments (cash-out against vendor_invoice_id)
//
// The "opening balance" is the net outstanding for the partner up to
// (but excluding) the From date. Everything on/after From is listed as
// activity with a running balance. Aging buckets are computed from the
// remaining open document balances as of the To date.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileText, Users } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format, parseISO, differenceInDays } from "date-fns";

type Mode = "customer" | "vendor";

interface LedgerLine {
  date: string;
  doc_no: string;
  doc_type: "Invoice" | "Receipt" | "Payment";
  reference: string;
  debit: number;
  credit: number;
  running: number;
  currency: string;
}

interface OpenDoc {
  doc_no: string;
  date: string;
  total: number;
  paid: number;
  outstanding: number;
  currency: string;
}

const AGING_BUCKETS = [
  { label: "Current", min: 0, max: 30 },
  { label: "31–60", min: 31, max: 60 },
  { label: "61–90", min: 61, max: 90 },
  { label: "91–120", min: 91, max: 120 },
  { label: "120+", min: 121, max: Infinity },
] as const;

function toMoney(n: number, ccy = "USD") {
  return `${ccy} ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeDate(d: string | null | undefined) {
  if (!d) return "";
  try {
    return format(parseISO(d), "dd/MM/yyyy");
  } catch {
    return d;
  }
}

export default function PartnerStatements() {
  const [mode, setMode] = useState<Mode>("customer");
  const [partner, setPartner] = useState<string>("");
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // ------------ Partner list ------------
  const { data: partners = [] } = useQuery({
    queryKey: ["partner-statements", "partners", mode],
    queryFn: async () => {
      if (mode === "customer") {
        const { data } = await supabase
          .from("invoices")
          .select("operator, airline")
          .not("operator", "is", null)
          .limit(5000);
        const set = new Set<string>();
        (data || []).forEach((r: any) => {
          const name = (r.operator || r.airline || "").trim();
          if (name) set.add(name);
        });
        return Array.from(set).sort();
      } else {
        const { data } = await supabase
          .from("vendor_invoices")
          .select("vendor_name")
          .not("vendor_name", "is", null)
          .limit(5000);
        const set = new Set<string>();
        (data || []).forEach((r: any) => {
          const name = (r.vendor_name || "").trim();
          if (name) set.add(name);
        });
        return Array.from(set).sort();
      }
    },
  });

  // ------------ Ledger data ------------
  const { data: ledger, isLoading } = useQuery({
    queryKey: ["partner-statements", "ledger", mode, partner, from, to],
    enabled: !!partner,
    queryFn: async () => {
      const openingLines: { date: string; debit: number; credit: number }[] = [];
      const activityLines: LedgerLine[] = [];
      const openDocs: OpenDoc[] = [];

      if (mode === "customer") {
        // Invoices (debit customer)
        const { data: invs } = await supabase
          .from("invoices")
          .select("id, invoice_no, date, due_date, total, paid_amount, currency, status, operator, airline")
          .or(`operator.eq.${partner},airline.eq.${partner}`)
          .lte("date", to)
          .order("date", { ascending: true });

        // Receipts (credit customer) — filter after fetch by invoice_id membership
        const invIds = (invs || []).map((i: any) => i.id);
        let receipts: any[] = [];
        if (invIds.length) {
          const { data } = await supabase
            .from("receipts")
            .select("id, receipt_no, receipt_date, amount, currency, invoice_id, status")
            .in("invoice_id", invIds)
            .eq("status", "Posted")
            .lte("receipt_date", to)
            .order("receipt_date", { ascending: true });
          receipts = data || [];
        }

        (invs || []).forEach((inv: any) => {
          const total = Number(inv.total || 0);
          const line = {
            date: inv.date,
            doc_no: inv.invoice_no || inv.id.slice(0, 8),
            doc_type: "Invoice" as const,
            reference: inv.status || "",
            debit: total,
            credit: 0,
            running: 0,
            currency: inv.currency || "USD",
          };
          if (inv.date < from) openingLines.push({ date: inv.date, debit: total, credit: 0 });
          else activityLines.push(line);

          const paid = Number(inv.paid_amount || 0);
          const outstanding = total - paid;
          if (outstanding > 0.005) {
            openDocs.push({
              doc_no: inv.invoice_no || inv.id.slice(0, 8),
              date: inv.due_date || inv.date,
              total,
              paid,
              outstanding,
              currency: inv.currency || "USD",
            });
          }
        });

        receipts.forEach((rc: any) => {
          const amt = Number(rc.amount || 0);
          const line = {
            date: rc.receipt_date,
            doc_no: rc.receipt_no || rc.id.slice(0, 8),
            doc_type: "Receipt" as const,
            reference: `Applied to invoice`,
            debit: 0,
            credit: amt,
            running: 0,
            currency: rc.currency || "USD",
          };
          if (rc.receipt_date < from) openingLines.push({ date: rc.receipt_date, debit: 0, credit: amt });
          else activityLines.push(line);
        });
      } else {
        // Vendor invoices (credit vendor = we owe)
        const { data: vinvs } = await supabase
          .from("vendor_invoices")
          .select("id, invoice_no, date, due_date, total, currency, status, vendor_name")
          .eq("vendor_name", partner)
          .lte("date", to)
          .order("date", { ascending: true });

        const vIds = (vinvs || []).map((v: any) => v.id);
        let pays: any[] = [];
        if (vIds.length) {
          const { data } = await supabase
            .from("payments")
            .select("id, payment_no, payment_date, amount, currency, vendor_invoice_id, status")
            .in("vendor_invoice_id", vIds)
            .eq("status", "Posted")
            .lte("payment_date", to)
            .order("payment_date", { ascending: true });
          pays = data || [];
        }

        // For vendors we flip convention: credit = we owe, debit = we paid.
        (vinvs || []).forEach((v: any) => {
          const total = Number(v.total || 0);
          const paidTotal = pays
            .filter((p) => p.vendor_invoice_id === v.id)
            .reduce((s, p) => s + Number(p.amount || 0), 0);
          const line = {
            date: v.date,
            doc_no: v.invoice_no || v.id.slice(0, 8),
            doc_type: "Invoice" as const,
            reference: v.status || "",
            debit: 0,
            credit: total,
            running: 0,
            currency: v.currency || "USD",
          };
          if (v.date < from) openingLines.push({ date: v.date, debit: 0, credit: total });
          else activityLines.push(line);

          const outstanding = total - paidTotal;
          if (outstanding > 0.005) {
            openDocs.push({
              doc_no: v.invoice_no || v.id.slice(0, 8),
              date: v.due_date || v.date,
              total,
              paid: paidTotal,
              outstanding,
              currency: v.currency || "USD",
            });
          }
        });

        pays.forEach((p: any) => {
          const amt = Number(p.amount || 0);
          const line = {
            date: p.payment_date,
            doc_no: p.payment_no || p.id.slice(0, 8),
            doc_type: "Payment" as const,
            reference: `Applied to vendor invoice`,
            debit: amt,
            credit: 0,
            running: 0,
            currency: p.currency || "USD",
          };
          if (p.payment_date < from) openingLines.push({ date: p.payment_date, debit: amt, credit: 0 });
          else activityLines.push(line);
        });
      }

      // Opening balance = sum(debit) - sum(credit) for customer,
      // for vendor we invert display so positive = we owe them.
      const openingRaw = openingLines.reduce((s, l) => s + l.debit - l.credit, 0);
      const opening = mode === "customer" ? openingRaw : -openingRaw;

      // Sort activity chronologically then compute running balance
      activityLines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      let running = opening;
      const withRunning = activityLines.map((l) => {
        const delta = mode === "customer" ? l.debit - l.credit : l.credit - l.debit;
        running += delta;
        return { ...l, running };
      });

      // Aging as of "to"
      const toDate = parseISO(to);
      const buckets = AGING_BUCKETS.map((b) => ({ ...b, amount: 0 }));
      openDocs.forEach((d) => {
        const age = differenceInDays(toDate, parseISO(d.date));
        const bucket = buckets.find((b) => age >= b.min && age <= b.max) || buckets[buckets.length - 1];
        bucket.amount += d.outstanding;
      });

      const closing = running;
      const currency = withRunning[0]?.currency || openDocs[0]?.currency || "USD";

      return { opening, closing, lines: withRunning, buckets, openDocs, currency };
    },
  });

  const exportRows = useMemo(() => {
    if (!ledger) return [];
    return [
      { Date: safeDate(from), Doc: "OPENING BALANCE", Type: "", Ref: "", Debit: "", Credit: "", Balance: ledger.opening.toFixed(2) },
      ...ledger.lines.map((l) => ({
        Date: safeDate(l.date),
        Doc: l.doc_no,
        Type: l.doc_type,
        Ref: l.reference,
        Debit: l.debit ? l.debit.toFixed(2) : "",
        Credit: l.credit ? l.credit.toFixed(2) : "",
        Balance: l.running.toFixed(2),
      })),
      { Date: safeDate(to), Doc: "CLOSING BALANCE", Type: "", Ref: "", Debit: "", Credit: "", Balance: ledger.closing.toFixed(2) },
    ];
  }, [ledger, from, to]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" /> Statements of Account
          </h1>
          <p className="text-sm text-muted-foreground">
            Per-partner ledger with opening balance, running balance, and aging.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            exportToExcel(
              exportRows,
              `${mode}_${partner || "statement"}`,
              `statement_${mode}_${partner || "all"}_${to}.xlsx`,
            )
          }
          disabled={!ledger}
        >
          <Download className="h-4 w-4 mr-2" /> Export Excel
        </Button>
      </div>

      <Tabs value={mode} onValueChange={(v) => { setMode(v as Mode); setPartner(""); }}>
        <TabsList>
          <TabsTrigger value="customer">Customer (AR)</TabsTrigger>
          <TabsTrigger value="vendor">Vendor (AP)</TabsTrigger>
        </TabsList>

        <TabsContent value={mode} className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label>{mode === "customer" ? "Customer" : "Vendor"}</Label>
                <Select value={partner} onValueChange={setPartner}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent className="max-h-96">
                    {partners.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>From</Label>
                <DateInput  value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <DateInput  value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {ledger && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Opening</CardTitle></CardHeader>
                  <CardContent><div className="text-xl font-bold">{toMoney(ledger.opening, ledger.currency)}</div></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Closing</CardTitle></CardHeader>
                  <CardContent><div className="text-xl font-bold">{toMoney(ledger.closing, ledger.currency)}</div></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Activity Lines</CardTitle></CardHeader>
                  <CardContent><div className="text-xl font-bold">{ledger.lines.length}</div></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Open Documents</CardTitle></CardHeader>
                  <CardContent><div className="text-xl font-bold">{ledger.openDocs.length}</div></CardContent></Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Ledger</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Doc #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-muted/30">
                        <TableCell>{safeDate(from)}</TableCell>
                        <TableCell className="font-semibold" colSpan={5}>OPENING BALANCE</TableCell>
                        <TableCell className="text-right font-semibold">{toMoney(ledger.opening, ledger.currency)}</TableCell>
                      </TableRow>
                      {ledger.lines.map((l, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{safeDate(l.date)}</TableCell>
                          <TableCell className="font-mono text-xs">{l.doc_no}</TableCell>
                          <TableCell>{l.doc_type}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{l.reference}</TableCell>
                          <TableCell className="text-right">{l.debit ? l.debit.toFixed(2) : ""}</TableCell>
                          <TableCell className="text-right">{l.credit ? l.credit.toFixed(2) : ""}</TableCell>
                          <TableCell className="text-right font-medium">{l.running.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50">
                        <TableCell>{safeDate(to)}</TableCell>
                        <TableCell className="font-semibold" colSpan={5}>CLOSING BALANCE</TableCell>
                        <TableCell className="text-right font-bold">{toMoney(ledger.closing, ledger.currency)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Aging (as of {safeDate(to)})</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {ledger.buckets.map((b) => (
                      <div key={b.label} className="p-3 rounded-md border">
                        <div className="text-xs text-muted-foreground">{b.label}</div>
                        <div className="text-lg font-bold">{toMoney(b.amount, ledger.currency)}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {isLoading && <div className="text-sm text-muted-foreground">Loading...</div>}
          {!partner && <div className="text-sm text-muted-foreground">Pick a {mode} to view the statement.</div>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
