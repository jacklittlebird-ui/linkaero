// Notes Payable & Short-Term Loans (Phase 1x)
// -------------------------------------------------------------
// Two tabs:
//   1. Notes Payable — post-dated / issued cheques payable to suppliers.
//                       Lifecycle: Draft → Posted → Cleared, or Void.
//   2. Short-Term Loans — staff advances against cash/bank source.
//                       Lifecycle: Draft → Requested → Approved → Disbursed → Settled,
//                       or Rejected. Tracks installments (paid vs total).

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Banknote, Plus, Download, CheckCircle2, XCircle, Send, HandCoins } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format } from "date-fns";

const NP_STATUSES = ["Draft", "Posted", "Cleared", "Void"] as const;
type NpStatus = typeof NP_STATUSES[number];
const NP_VARIANT: Record<NpStatus, "default" | "secondary" | "destructive" | "outline"> = {
  Draft: "outline",
  Posted: "secondary",
  Cleared: "default",
  Void: "destructive",
};

const LOAN_STATUSES = ["Draft", "Requested", "Approved", "Disbursed", "Settled", "Rejected"] as const;
type LoanStatus = typeof LOAN_STATUSES[number];
const LOAN_VARIANT: Record<LoanStatus, "default" | "secondary" | "destructive" | "outline"> = {
  Draft: "outline",
  Requested: "secondary",
  Approved: "secondary",
  Disbursed: "default",
  Settled: "default",
  Rejected: "destructive",
};

const CURRENCIES = ["EGP", "USD", "EUR", "GBP", "AED", "SAR"];

export default function NotesPayableLoans() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"notes" | "loans">("notes");

  // ---------- Reference data ----------
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id,name").order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: banks = [] } = useQuery({
    queryKey: ["bank-accounts-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_accounts").select("id,account_name,bank_name").order("account_name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: cashAccts = [] } = useQuery({
    queryKey: ["cash-accounts-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cash_accounts").select("id,account_name").order("account_name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: stations = [] } = useQuery({
    queryKey: ["finance-stations-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_stations").select("id,code,name").order("code");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // ---------- Notes payable ----------
  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ["notes-payable"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes_payable")
        .select("*")
        .order("cheque_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ["short-term-loans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("short_term_loans")
        .select("*")
        .order("request_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // ---------- KPIs ----------
  const kpis = useMemo(() => {
    const outstandingNotes = notes
      .filter((n: any) => n.status === "Posted")
      .reduce((s: number, n: any) => s + Number(n.amount || 0), 0);
    const clearedNotes = notes.filter((n: any) => n.status === "Cleared").length;
    const openLoans = loans
      .filter((l: any) => ["Approved", "Disbursed"].includes(l.status))
      .reduce((s: number, l: any) => s + Number(l.amount || 0), 0);
    const pendingLoans = loans.filter((l: any) => ["Draft", "Requested"].includes(l.status)).length;
    return { outstandingNotes, clearedNotes, openLoans, pendingLoans };
  }, [notes, loans]);

  // ---------- Note dialog ----------
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteForm, setNoteForm] = useState<any>({
    cheque_no: "",
    cheque_date: format(new Date(), "yyyy-MM-dd"),
    clearance_date: "",
    bank_account_id: "",
    supplier_name: "",
    supplier_category: "",
    payment_type: "Cheque",
    amount: "",
    currency: "EGP",
    company_id: "",
    notes: "",
  });

  const createNote = useMutation({
    mutationFn: async () => {
      const payload = {
        ...noteForm,
        amount: Number(noteForm.amount || 0),
        clearance_date: noteForm.clearance_date || null,
        bank_account_id: noteForm.bank_account_id || null,
        company_id: noteForm.company_id || null,
        status: "Draft",
        created_by: user?.id,
      };
      const { error } = await supabase.from("notes_payable").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Note created");
      setNoteOpen(false);
      qc.invalidateQueries({ queryKey: ["notes-payable"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setNoteStatus = useMutation({
    mutationFn: async ({ id, status, extra }: { id: string; status: NpStatus; extra?: any }) => {
      const patch: any = { status, ...(extra || {}) };
      if (status === "Posted") { patch.posted_by = user?.id; patch.posted_at = new Date().toISOString(); }
      const { error } = await supabase.from("notes_payable").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(`Marked ${v.status}`);
      qc.invalidateQueries({ queryKey: ["notes-payable"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ---------- Loan dialog ----------
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanForm, setLoanForm] = useState<any>({
    loan_no: "",
    request_date: format(new Date(), "yyyy-MM-dd"),
    employee_name: "",
    company_id: "",
    station_id: "",
    source_type: "Cash",
    source_cash_id: "",
    source_bank_id: "",
    amount: "",
    currency: "EGP",
    deduction_plan: "Monthly",
    installments: 1,
    notes: "",
  });

  const createLoan = useMutation({
    mutationFn: async () => {
      const payload = {
        ...loanForm,
        amount: Number(loanForm.amount || 0),
        installments: Number(loanForm.installments || 1),
        installments_paid: 0,
        company_id: loanForm.company_id || null,
        station_id: loanForm.station_id || null,
        source_cash_id: loanForm.source_type === "Cash" ? (loanForm.source_cash_id || null) : null,
        source_bank_id: loanForm.source_type === "Bank" ? (loanForm.source_bank_id || null) : null,
        status: "Draft",
        requested_by: user?.id,
      };
      const { error } = await supabase.from("short_term_loans").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loan request created");
      setLoanOpen(false);
      qc.invalidateQueries({ queryKey: ["short-term-loans"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setLoanStatus = useMutation({
    mutationFn: async ({ id, status, extra }: { id: string; status: LoanStatus; extra?: any }) => {
      const patch: any = { status, ...(extra || {}) };
      if (status === "Approved") { patch.approved_by = user?.id; patch.approved_at = new Date().toISOString(); }
      const { error } = await supabase.from("short_term_loans").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(`Marked ${v.status}`);
      qc.invalidateQueries({ queryKey: ["short-term-loans"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const recordInstallment = useMutation({
    mutationFn: async (loan: any) => {
      const next = Math.min(Number(loan.installments_paid || 0) + 1, Number(loan.installments || 1));
      const patch: any = { installments_paid: next };
      if (next >= Number(loan.installments || 1)) patch.status = "Settled";
      const { error } = await supabase.from("short_term_loans").update(patch).eq("id", loan.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Installment recorded");
      qc.invalidateQueries({ queryKey: ["short-term-loans"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const exportNotes = () => {
    exportToExcel(
      notes.map((n: any) => ({
        Cheque: n.cheque_no, Date: n.cheque_date, Clearance: n.clearance_date,
        Supplier: n.supplier_name, Category: n.supplier_category, Type: n.payment_type,
        Amount: n.amount, Currency: n.currency, Status: n.status,
      })),
      "Notes Payable",
      `notes-payable-${format(new Date(), "yyyyMMdd")}.xlsx`,
    );
  };

  const exportLoans = () => {
    exportToExcel(
      loans.map((l: any) => ({
        LoanNo: l.loan_no, Date: l.request_date, Employee: l.employee_name,
        Source: l.source_type, Amount: l.amount, Currency: l.currency,
        Installments: `${l.installments_paid}/${l.installments}`, Status: l.status,
      })),
      "Short-Term Loans",
      `short-term-loans-${format(new Date(), "yyyyMMdd")}.xlsx`,
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Notes Payable & Short-Term Loans</h1>
        <p className="text-muted-foreground">
          Post-dated cheque payables and staff advance loans with installment tracking.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Outstanding Notes</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis.outstandingNotes.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Posted, not yet cleared</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Cleared Notes</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis.clearedNotes}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Open Loans</CardTitle>
            <HandCoins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis.openLoans.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Approved/Disbursed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending Requests</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis.pendingLoans}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="notes">Notes Payable</TabsTrigger>
          <TabsTrigger value="loans">Short-Term Loans</TabsTrigger>
        </TabsList>

        {/* ---------------- NOTES PAYABLE ---------------- */}
        <TabsContent value="notes" className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={exportNotes}>
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
            <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" /> New Note</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>New Note Payable</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Cheque / Ref No</Label>
                    <Input value={noteForm.cheque_no} onChange={(e) => setNoteForm({ ...noteForm, cheque_no: e.target.value })} />
                  </div>
                  <div>
                    <Label>Payment Type</Label>
                    <Select value={noteForm.payment_type} onValueChange={(v) => setNoteForm({ ...noteForm, payment_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cheque">Cheque</SelectItem>
                        <SelectItem value="Transfer">Bank Transfer</SelectItem>
                        <SelectItem value="Promissory">Promissory Note</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Cheque Date</Label>
                    <DateInput  value={noteForm.cheque_date} onChange={(e) => setNoteForm({ ...noteForm, cheque_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>Clearance Date</Label>
                    <DateInput  value={noteForm.clearance_date} onChange={(e) => setNoteForm({ ...noteForm, clearance_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>Supplier Name</Label>
                    <Input value={noteForm.supplier_name} onChange={(e) => setNoteForm({ ...noteForm, supplier_name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Supplier Category</Label>
                    <Input value={noteForm.supplier_category} onChange={(e) => setNoteForm({ ...noteForm, supplier_category: e.target.value })} />
                  </div>
                  <div>
                    <Label>Bank Account</Label>
                    <Select value={noteForm.bank_account_id} onValueChange={(v) => setNoteForm({ ...noteForm, bank_account_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                      <SelectContent>
                        {banks.map((b: any) => (
                          <SelectItem key={b.id} value={b.id}>{b.account_name} — {b.bank_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Company</Label>
                    <Select value={noteForm.company_id} onValueChange={(v) => setNoteForm({ ...noteForm, company_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                      <SelectContent>
                        {companies.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Amount</Label>
                    <Input type="number" value={noteForm.amount} onChange={(e) => setNoteForm({ ...noteForm, amount: e.target.value })} />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={noteForm.currency} onValueChange={(v) => setNoteForm({ ...noteForm, currency: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label>Notes</Label>
                    <Textarea value={noteForm.notes} onChange={(e) => setNoteForm({ ...noteForm, notes: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setNoteOpen(false)}>Cancel</Button>
                  <Button onClick={() => createNote.mutate()} disabled={createNote.isPending}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cheque #</TableHead>
                    <TableHead>Cheque Date</TableHead>
                    <TableHead>Clearance</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notesLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-6">Loading…</TableCell></TableRow>
                  ) : notes.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">No notes yet</TableCell></TableRow>
                  ) : (
                    notes.map((n: any) => (
                      <TableRow key={n.id}>
                        <TableCell className="font-medium">{n.cheque_no}</TableCell>
                        <TableCell>{n.cheque_date}</TableCell>
                        <TableCell>{n.clearance_date || "—"}</TableCell>
                        <TableCell>{n.supplier_name}</TableCell>
                        <TableCell>{n.payment_type}</TableCell>
                        <TableCell className="text-right">{Number(n.amount || 0).toLocaleString()}</TableCell>
                        <TableCell>{n.currency}</TableCell>
                        <TableCell><Badge variant={NP_VARIANT[n.status as NpStatus] ?? "outline"}>{n.status}</Badge></TableCell>
                        <TableCell className="text-right space-x-1">
                          {n.status === "Draft" && (
                            <Button size="sm" variant="secondary" onClick={() => setNoteStatus.mutate({ id: n.id, status: "Posted" })}>
                              <Send className="h-3 w-3 mr-1" /> Post
                            </Button>
                          )}
                          {n.status === "Posted" && (
                            <>
                              <Button size="sm" onClick={() => setNoteStatus.mutate({ id: n.id, status: "Cleared", extra: { clearance_date: format(new Date(), "yyyy-MM-dd") } })}>
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Clear
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => setNoteStatus.mutate({ id: n.id, status: "Void" })}>
                                <XCircle className="h-3 w-3 mr-1" /> Void
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- LOANS ---------------- */}
        <TabsContent value="loans" className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={exportLoans}>
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
            <Dialog open={loanOpen} onOpenChange={setLoanOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" /> New Loan Request</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>New Short-Term Loan</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Loan No</Label>
                    <Input value={loanForm.loan_no} onChange={(e) => setLoanForm({ ...loanForm, loan_no: e.target.value })} />
                  </div>
                  <div>
                    <Label>Request Date</Label>
                    <DateInput  value={loanForm.request_date} onChange={(e) => setLoanForm({ ...loanForm, request_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>Employee Name</Label>
                    <Input value={loanForm.employee_name} onChange={(e) => setLoanForm({ ...loanForm, employee_name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Company</Label>
                    <Select value={loanForm.company_id} onValueChange={(v) => setLoanForm({ ...loanForm, company_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                      <SelectContent>
                        {companies.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Station</Label>
                    <Select value={loanForm.station_id} onValueChange={(v) => setLoanForm({ ...loanForm, station_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
                      <SelectContent>
                        {stations.map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Source Type</Label>
                    <Select value={loanForm.source_type} onValueChange={(v) => setLoanForm({ ...loanForm, source_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cash">Cash</SelectItem>
                        <SelectItem value="Bank">Bank</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {loanForm.source_type === "Cash" ? (
                    <div>
                      <Label>Cash Account</Label>
                      <Select value={loanForm.source_cash_id} onValueChange={(v) => setLoanForm({ ...loanForm, source_cash_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Select cash acct" /></SelectTrigger>
                        <SelectContent>
                          {cashAccts.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>{c.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div>
                      <Label>Bank Account</Label>
                      <Select value={loanForm.source_bank_id} onValueChange={(v) => setLoanForm({ ...loanForm, source_bank_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                        <SelectContent>
                          {banks.map((b: any) => (
                            <SelectItem key={b.id} value={b.id}>{b.account_name} — {b.bank_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label>Amount</Label>
                    <Input type="number" value={loanForm.amount} onChange={(e) => setLoanForm({ ...loanForm, amount: e.target.value })} />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={loanForm.currency} onValueChange={(v) => setLoanForm({ ...loanForm, currency: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Deduction Plan</Label>
                    <Select value={loanForm.deduction_plan} onValueChange={(v) => setLoanForm({ ...loanForm, deduction_plan: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Monthly">Monthly</SelectItem>
                        <SelectItem value="Weekly">Weekly</SelectItem>
                        <SelectItem value="Lump Sum">Lump Sum</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Installments</Label>
                    <Input type="number" min={1} value={loanForm.installments} onChange={(e) => setLoanForm({ ...loanForm, installments: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <Label>Notes</Label>
                    <Textarea value={loanForm.notes} onChange={(e) => setLoanForm({ ...loanForm, notes: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setLoanOpen(false)}>Cancel</Button>
                  <Button onClick={() => createLoan.mutate()} disabled={createLoan.isPending}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Loan #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Installments</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loansLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-6">Loading…</TableCell></TableRow>
                  ) : loans.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">No loans yet</TableCell></TableRow>
                  ) : (
                    loans.map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.loan_no}</TableCell>
                        <TableCell>{l.request_date}</TableCell>
                        <TableCell>{l.employee_name}</TableCell>
                        <TableCell>{l.source_type}</TableCell>
                        <TableCell className="text-right">{Number(l.amount || 0).toLocaleString()}</TableCell>
                        <TableCell>{l.currency}</TableCell>
                        <TableCell>{l.installments_paid || 0} / {l.installments || 1}</TableCell>
                        <TableCell><Badge variant={LOAN_VARIANT[l.status as LoanStatus] ?? "outline"}>{l.status}</Badge></TableCell>
                        <TableCell className="text-right space-x-1">
                          {l.status === "Draft" && (
                            <Button size="sm" variant="secondary" onClick={() => setLoanStatus.mutate({ id: l.id, status: "Requested" })}>
                              <Send className="h-3 w-3 mr-1" /> Submit
                            </Button>
                          )}
                          {l.status === "Requested" && (
                            <>
                              <Button size="sm" onClick={() => setLoanStatus.mutate({ id: l.id, status: "Approved" })}>
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => {
                                const reason = window.prompt("Rejection reason?") || "";
                                if (!reason) return;
                                setLoanStatus.mutate({ id: l.id, status: "Rejected", extra: { rejection_reason: reason } });
                              }}>
                                <XCircle className="h-3 w-3 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                          {l.status === "Approved" && (
                            <Button size="sm" onClick={() => setLoanStatus.mutate({ id: l.id, status: "Disbursed" })}>
                              Disburse
                            </Button>
                          )}
                          {l.status === "Disbursed" && (
                            <Button size="sm" variant="secondary" onClick={() => recordInstallment.mutate(l)}>
                              Record Installment
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
