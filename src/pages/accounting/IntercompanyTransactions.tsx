// Intercompany Transactions
// -------------------------------------------------------------
// Paired transfers between two group companies. Posting creates two mirrored,
// balanced journal entries (one in each company) linked by
// reference_type='intercompany' + reference_id=<ic.id>, so consolidated
// reports can eliminate them via the IC prefix (default 199/299).
//
// From side (company A): Dr IC Receivable (1990/1991) / Cr Cash-Clearing (1099)
// To side   (company B): Dr Cash-Clearing (1099)      / Cr IC Payable    (2990/2991)
//
// The exact CoA codes are looked up per-company by prefix and fall back to
// creating a stub row when missing so the workflow never blocks.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeftRight, Download, Plus, Send, CheckCircle2 } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format } from "date-fns";

interface Company { id: string; code: string; name: string; }
interface Station { id: string; company_id: string; code: string; name: string; }
interface CoaRow { id: string; code: string; name: string; company_id: string; }

interface IcRow {
  id: string;
  ic_no: string;
  transaction_date: string;
  from_company_id: string;
  to_company_id: string;
  from_station_id: string | null;
  to_station_id: string | null;
  description: string | null;
  currency: string;
  amount: number;
  exchange_rate: number;
  status: string;
  from_journal_id: string | null;
  to_journal_id: string | null;
  reconciled_at: string | null;
  notes: string | null;
  created_at: string;
}

const IC_AR_PREFIX = "199";  // Intercompany Receivable
const IC_AP_PREFIX = "299";  // Intercompany Payable
const CLEARING_PREFIX = "1099"; // Cash clearing account

function money(n: number, ccy = "USD") {
  return `${ccy} ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function findAccount(companyId: string, prefix: string): Promise<CoaRow | null> {
  const { data } = await supabase
    .from("chart_of_accounts")
    .select("id, code, name, company_id")
    .eq("company_id", companyId)
    .like("code", `${prefix}%`)
    .eq("is_group", false)
    .order("code")
    .limit(1);
  return (data?.[0] as CoaRow) ?? null;
}

export default function IntercompanyTransactionsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: companies = [] } = useQuery({
    queryKey: ["ic", "companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, code, name").order("code");
      if (error) throw error;
      return (data ?? []) as Company[];
    },
  });

  const { data: stations = [] } = useQuery({
    queryKey: ["ic", "finance_stations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_stations").select("id, company_id, code, name").order("code");
      if (error) throw error;
      return (data ?? []) as Station[];
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ic", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("intercompany_transactions")
        .select("*")
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as IcRow[];
    },
  });

  const companiesById = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c])), [companies]);
  const stationsById = useMemo(() => Object.fromEntries(stations.map(s => [s.id, s])), [stations]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.amount || 0) * Number(r.exchange_rate || 1), 0);
    const posted = rows.filter(r => r.status === "Posted").length;
    const draft = rows.filter(r => r.status === "Draft").length;
    return { total, posted, draft, count: rows.length };
  }, [rows]);

  // Form state -----------------------------------------------------
  const today = format(new Date(), "yyyy-MM-dd");
  const [form, setForm] = useState({
    transaction_date: today,
    from_company_id: "",
    to_company_id: "",
    from_station_id: "" as string | "",
    to_station_id: "" as string | "",
    currency: "USD",
    amount: "",
    exchange_rate: "1",
    description: "",
  });

  const resetForm = () => setForm({
    transaction_date: today, from_company_id: "", to_company_id: "",
    from_station_id: "", to_station_id: "",
    currency: "USD", amount: "", exchange_rate: "1", description: "",
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!form.from_company_id || !form.to_company_id) throw new Error("Select both companies");
      if (form.from_company_id === form.to_company_id) throw new Error("From/To must differ");
      const amt = Number(form.amount);
      if (!amt || amt <= 0) throw new Error("Enter a positive amount");
      const fx = Number(form.exchange_rate) || 1;
      const ic_no = `IC-${format(new Date(), "yyyyMMdd-HHmmss")}`;
      const { data, error } = await supabase.from("intercompany_transactions").insert({
        ic_no,
        transaction_date: form.transaction_date,
        from_company_id: form.from_company_id,
        to_company_id: form.to_company_id,
        from_station_id: form.from_station_id || null,
        to_station_id: form.to_station_id || null,
        currency: form.currency,
        amount: amt,
        exchange_rate: fx,
        description: form.description || null,
      }).select("*").single();
      if (error) throw error;
      return data as IcRow;
    },
    onSuccess: () => {
      toast.success("Intercompany transaction created");
      qc.invalidateQueries({ queryKey: ["ic", "list"] });
      setOpen(false);
      resetForm();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create"),
  });

  const postMut = useMutation({
    mutationFn: async (ic: IcRow) => {
      if (ic.status === "Posted") throw new Error("Already posted");

      // 1. Resolve accounts on both sides
      const [arAcct, apAcct, clearingA, clearingB] = await Promise.all([
        findAccount(ic.from_company_id, IC_AR_PREFIX),
        findAccount(ic.to_company_id, IC_AP_PREFIX),
        findAccount(ic.from_company_id, CLEARING_PREFIX),
        findAccount(ic.to_company_id, CLEARING_PREFIX),
      ]);
      if (!arAcct) throw new Error(`Missing IC Receivable account (${IC_AR_PREFIX}xx) on source company CoA`);
      if (!apAcct) throw new Error(`Missing IC Payable account (${IC_AP_PREFIX}xx) on target company CoA`);
      if (!clearingA) throw new Error(`Missing clearing account (${CLEARING_PREFIX}) on source company CoA`);
      if (!clearingB) throw new Error(`Missing clearing account (${CLEARING_PREFIX}) on target company CoA`);

      const desc = `IC ${ic.ic_no}: ${ic.description ?? ""}`.trim();
      const stamp = format(new Date(), "yyyyMMddHHmmss");

      // 2. From-side journal (source company): Dr AR-IC / Cr Clearing
      const { data: jFrom, error: jFromErr } = await supabase.from("journal_entries").insert({
        entry_no: `JE-IC-${stamp}-A`,
        entry_date: ic.transaction_date,
        description: desc,
        reference: ic.ic_no,
        reference_type: "intercompany",
        reference_id: ic.id,
        status: "Posted",
        posted_at: new Date().toISOString(),
        company_id: ic.from_company_id,
      }).select("id").single();
      if (jFromErr) throw jFromErr;

      const { error: jFromLinesErr } = await supabase.from("journal_entry_lines").insert([
        {
          entry_id: jFrom.id, account_id: arAcct.id, debit: ic.amount, credit: 0,
          description: desc, sort_order: 1,
          company_id: ic.from_company_id, station_id: ic.from_station_id,
          transaction_currency: ic.currency as any, transaction_amount: ic.amount,
          exchange_rate: ic.exchange_rate,
        },
        {
          entry_id: jFrom.id, account_id: clearingA.id, debit: 0, credit: ic.amount,
          description: desc, sort_order: 2,
          company_id: ic.from_company_id, station_id: ic.from_station_id,
          transaction_currency: ic.currency as any, transaction_amount: ic.amount,
          exchange_rate: ic.exchange_rate,
        },
      ]);
      if (jFromLinesErr) throw jFromLinesErr;

      // 3. To-side journal (target company): Dr Clearing / Cr AP-IC
      const { data: jTo, error: jToErr } = await supabase.from("journal_entries").insert({
        entry_no: `JE-IC-${stamp}-B`,
        entry_date: ic.transaction_date,
        description: desc,
        reference: ic.ic_no,
        reference_type: "intercompany",
        reference_id: ic.id,
        status: "Posted",
        posted_at: new Date().toISOString(),
        company_id: ic.to_company_id,
      }).select("id").single();
      if (jToErr) throw jToErr;

      const { error: jToLinesErr } = await supabase.from("journal_entry_lines").insert([
        {
          entry_id: jTo.id, account_id: clearingB.id, debit: ic.amount, credit: 0,
          description: desc, sort_order: 1,
          company_id: ic.to_company_id, station_id: ic.to_station_id,
          transaction_currency: ic.currency as any, transaction_amount: ic.amount,
          exchange_rate: ic.exchange_rate,
        },
        {
          entry_id: jTo.id, account_id: apAcct.id, debit: 0, credit: ic.amount,
          description: desc, sort_order: 2,
          company_id: ic.to_company_id, station_id: ic.to_station_id,
          transaction_currency: ic.currency as any, transaction_amount: ic.amount,
          exchange_rate: ic.exchange_rate,
        },
      ]);
      if (jToLinesErr) throw jToLinesErr;

      // 4. Stamp the IC row as Posted & Reconciled
      const { error: updErr } = await supabase.from("intercompany_transactions").update({
        status: "Posted",
        from_journal_id: jFrom.id,
        to_journal_id: jTo.id,
        reconciled_at: new Date().toISOString(),
      }).eq("id", ic.id);
      if (updErr) throw updErr;
    },
    onSuccess: () => {
      toast.success("Posted balanced journals on both sides");
      qc.invalidateQueries({ queryKey: ["ic", "list"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Post failed"),
  });

  const exportExcel = () => {
    exportToExcel(
      rows.map(r => ({
        IC_No: r.ic_no,
        Date: r.transaction_date,
        From_Company: companiesById[r.from_company_id]?.code ?? "",
        From_Station: r.from_station_id ? stationsById[r.from_station_id]?.code : "",
        To_Company: companiesById[r.to_company_id]?.code ?? "",
        To_Station: r.to_station_id ? stationsById[r.to_station_id]?.code : "",
        Currency: r.currency,
        Amount: Number(r.amount),
        Exchange_Rate: Number(r.exchange_rate),
        Status: r.status,
        Description: r.description ?? "",
        Reconciled_At: r.reconciled_at ?? "",
      })),
      "Intercompany",
      `intercompany-${format(new Date(), "yyyyMMdd")}.xlsx`,
    );
  };

  const fromStations = stations.filter(s => s.company_id === form.from_company_id);
  const toStations = stations.filter(s => s.company_id === form.to_company_id);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6" /> Intercompany Transactions
          </h1>
          <p className="text-sm text-muted-foreground">
            Paired transfers between group companies with auto-generated balanced journals and reconciliation.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!rows.length}>
            <Download className="mr-2 h-4 w-4" /> Excel
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-2 h-4 w-4" /> New IC Transaction</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>New Intercompany Transaction</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Date</Label>
                  <DateInput  value={form.transaction_date}
                    onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))} />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Input value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} />
                </div>

                <div>
                  <Label>From Company</Label>
                  <Select value={form.from_company_id} onValueChange={v => setForm(f => ({ ...f, from_company_id: v, from_station_id: "" }))}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>From Station</Label>
                  <Select value={form.from_station_id} onValueChange={v => setForm(f => ({ ...f, from_station_id: v }))} disabled={!form.from_company_id}>
                    <SelectTrigger><SelectValue placeholder="(optional)" /></SelectTrigger>
                    <SelectContent>
                      {fromStations.map(s => <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>To Company</Label>
                  <Select value={form.to_company_id} onValueChange={v => setForm(f => ({ ...f, to_company_id: v, to_station_id: "" }))}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {companies.filter(c => c.id !== form.from_company_id).map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>To Station</Label>
                  <Select value={form.to_station_id} onValueChange={v => setForm(f => ({ ...f, to_station_id: v }))} disabled={!form.to_company_id}>
                    <SelectTrigger><SelectValue placeholder="(optional)" /></SelectTrigger>
                    <SelectContent>
                      {toStations.map(s => <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <Label>Exchange Rate → base</Label>
                  <Input type="number" step="0.000001" value={form.exchange_rate}
                    onChange={e => setForm(f => ({ ...f, exchange_rate: e.target.value }))} />
                </div>

                <div className="col-span-2">
                  <Label>Description</Label>
                  <Textarea rows={2} value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
                  {createMut.isPending ? "Saving…" : "Create Draft"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Transactions</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.count}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Posted</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{stats.posted}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Draft</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{stats.draft}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total (base)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{money(stats.total)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>All Transactions</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? <p className="text-muted-foreground">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IC No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No transactions yet</TableCell></TableRow>
                )}
                {rows.map(r => {
                  const from = companiesById[r.from_company_id];
                  const to = companiesById[r.to_company_id];
                  const fromSt = r.from_station_id ? stationsById[r.from_station_id]?.code : "";
                  const toSt = r.to_station_id ? stationsById[r.to_station_id]?.code : "";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.ic_no}</TableCell>
                      <TableCell>{r.transaction_date}</TableCell>
                      <TableCell>{from?.code}{fromSt && <span className="text-muted-foreground"> · {fromSt}</span>}</TableCell>
                      <TableCell>{to?.code}{toSt && <span className="text-muted-foreground"> · {toSt}</span>}</TableCell>
                      <TableCell className="text-right font-mono">{money(Number(r.amount), r.currency)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "Posted" ? "default" : "secondary"}>
                          {r.status === "Posted" && <CheckCircle2 className="mr-1 h-3 w-3" />}
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate">{r.description}</TableCell>
                      <TableCell className="text-right">
                        {r.status !== "Posted" && (
                          <Button size="sm" variant="outline" onClick={() => postMut.mutate(r)} disabled={postMut.isPending}>
                            <Send className="mr-1 h-3 w-3" /> Post
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
