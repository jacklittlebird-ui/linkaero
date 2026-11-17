// Multi-Bank Cheque Management (Phase 1v)
// -------------------------------------------------------------
// Two tabs:
//   1. Cheque Books — register books per bank account (series prefix + range).
//   2. Cheques      — issued/received cheques with lifecycle status:
//                     Draft → Issued → Deposited → Cleared, or Bounced/Void.

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
import { BookOpen, CheckCircle2, Download, Plus, XCircle } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format } from "date-fns";

const STATUSES = ["Draft", "Issued", "Deposited", "Cleared", "Bounced", "Void"] as const;
type Status = typeof STATUSES[number];

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  Draft: "outline",
  Issued: "secondary",
  Deposited: "secondary",
  Cleared: "default",
  Bounced: "destructive",
  Void: "outline",
};

interface BankAccount { id: string; account_name: string; bank_name: string; currency: string | null; }
interface ChequeBook {
  id: string;
  bank_account_id: string;
  series_prefix: string | null;
  start_number: number;
  end_number: number;
  next_number: number;
  status: string;
  notes: string | null;
  bank_accounts?: BankAccount | null;
}
interface Cheque {
  id: string;
  cheque_book_id: string | null;
  bank_account_id: string | null;
  cheque_number: string;
  direction: string;
  party_name: string;
  amount: number;
  currency: string;
  issue_date: string;
  due_date: string | null;
  cleared_date: string | null;
  bounced_date: string | null;
  bounce_reason: string | null;
  status: Status;
  notes: string | null;
  bank_accounts?: BankAccount | null;
}

export default function ChequeManagement() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [tab, setTab] = useState<"books" | "cheques">("books");

  const { data: banks = [] } = useQuery<BankAccount[]>({
    queryKey: ["cheque", "banks"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_accounts")
        .select("id, account_name, bank_name, currency")
        .order("bank_name");
      if (error) throw error;
      return (data ?? []) as BankAccount[];
    },
  });

  const { data: books = [], isLoading: booksLoading } = useQuery<ChequeBook[]>({
    queryKey: ["cheque", "books"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cheque_books")
        .select("*, bank_accounts(id, account_name, bank_name, currency)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ChequeBook[];
    },
  });

  const { data: cheques = [], isLoading: chequesLoading } = useQuery<Cheque[]>({
    queryKey: ["cheque", "list"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cheques")
        .select("*, bank_accounts(id, account_name, bank_name, currency)")
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Cheque[];
    },
  });

  // --- Book form ---
  const [bookOpen, setBookOpen] = useState(false);
  const [bookForm, setBookForm] = useState({
    bank_account_id: "", series_prefix: "", start_number: "1", end_number: "50", notes: "",
  });
  const createBook = useMutation({
    mutationFn: async () => {
      if (!bookForm.bank_account_id) throw new Error("Select bank account");
      const start = Number(bookForm.start_number);
      const end = Number(bookForm.end_number);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error("Invalid range");
      const { error } = await supabase.from("cheque_books").insert({
        bank_account_id: bookForm.bank_account_id,
        series_prefix: bookForm.series_prefix || null,
        start_number: start,
        end_number: end,
        next_number: start,
        status: "Active",
        notes: bookForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cheque book registered");
      qc.invalidateQueries({ queryKey: ["cheque", "books"] });
      setBookOpen(false);
      setBookForm({ bank_account_id: "", series_prefix: "", start_number: "1", end_number: "50", notes: "" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  // --- Cheque form ---
  const [chqOpen, setChqOpen] = useState(false);
  const [chqForm, setChqForm] = useState({
    direction: "issued",
    cheque_book_id: "",
    bank_account_id: "",
    cheque_number: "",
    party_name: "",
    amount: "0",
    currency: "EGP",
    issue_date: format(new Date(), "yyyy-MM-dd"),
    due_date: "",
    notes: "",
  });

  const selectedBook = useMemo(
    () => books.find((b) => b.id === chqForm.cheque_book_id) ?? null,
    [books, chqForm.cheque_book_id],
  );

  const suggestChequeNo = (book: ChequeBook | null) => {
    if (!book) return "";
    const prefix = book.series_prefix ? `${book.series_prefix}-` : "";
    return `${prefix}${book.next_number}`;
  };

  const createCheque = useMutation({
    mutationFn: async () => {
      if (!chqForm.party_name.trim()) throw new Error("Party name is required");
      const bankId = chqForm.direction === "issued"
        ? (selectedBook?.bank_account_id ?? chqForm.bank_account_id)
        : chqForm.bank_account_id;
      if (!bankId) throw new Error("Select a bank account");
      const chequeNo = chqForm.cheque_number.trim() || suggestChequeNo(selectedBook);
      if (!chequeNo) throw new Error("Cheque number is required");

      const payload = {
        cheque_book_id: chqForm.direction === "issued" ? (chqForm.cheque_book_id || null) : null,
        bank_account_id: bankId,
        cheque_number: chequeNo,
        direction: chqForm.direction,
        party_name: chqForm.party_name.trim(),
        amount: Number(chqForm.amount) || 0,
        currency: chqForm.currency,
        issue_date: chqForm.issue_date,
        due_date: chqForm.due_date || null,
        status: "Issued" as Status,
        notes: chqForm.notes || null,
        created_by: session?.user?.id ?? null,
      };
      const { error } = await supabase.from("cheques").insert(payload);
      if (error) throw error;

      // Advance next_number when a book was consumed
      if (chqForm.direction === "issued" && selectedBook) {
        const next = Math.min(selectedBook.next_number + 1, selectedBook.end_number + 1);
        await supabase.from("cheque_books").update({ next_number: next }).eq("id", selectedBook.id);
      }
    },
    onSuccess: () => {
      toast.success("Cheque recorded");
      qc.invalidateQueries({ queryKey: ["cheque", "list"] });
      qc.invalidateQueries({ queryKey: ["cheque", "books"] });
      setChqOpen(false);
      setChqForm({
        direction: "issued", cheque_book_id: "", bank_account_id: "",
        cheque_number: "", party_name: "", amount: "0", currency: "EGP",
        issue_date: format(new Date(), "yyyy-MM-dd"), due_date: "", notes: "",
      });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: Status; reason?: string }) => {
      const patch: any = { status };
      if (status === "Cleared") patch.cleared_date = format(new Date(), "yyyy-MM-dd");
      if (status === "Bounced") { patch.bounced_date = format(new Date(), "yyyy-MM-dd"); patch.bounce_reason = reason || "Bounced"; }
      const { error } = await supabase.from("cheques").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cheque updated");
      qc.invalidateQueries({ queryKey: ["cheque", "list"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const kpis = useMemo(() => {
    const issued = cheques.filter((c) => c.direction === "issued");
    const received = cheques.filter((c) => c.direction === "received");
    const pending = cheques.filter((c) => ["Issued", "Deposited"].includes(c.status));
    const bounced = cheques.filter((c) => c.status === "Bounced");
    return {
      books: books.length,
      issuedTotal: issued.reduce((s, c) => s + Number(c.amount || 0), 0),
      receivedTotal: received.reduce((s, c) => s + Number(c.amount || 0), 0),
      pending: pending.length,
      bounced: bounced.length,
    };
  }, [books, cheques]);

  const exportCheques = () => {
    exportToExcel(
      cheques.map((c) => ({
        Number: c.cheque_number,
        Direction: c.direction,
        Party: c.party_name,
        Bank: c.bank_accounts?.bank_name ?? "",
        Account: c.bank_accounts?.account_name ?? "",
        Amount: c.amount,
        Currency: c.currency,
        Issue: c.issue_date,
        Due: c.due_date ?? "",
        Status: c.status,
        Cleared: c.cleared_date ?? "",
        Bounced: c.bounced_date ?? "",
        Reason: c.bounce_reason ?? "",
      })),
      "Cheques",
      "cheques",
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="h-6 w-6" /> Cheque Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Multi-bank cheque books, issued/received registers, and clearing lifecycle.
          </p>
        </div>
        <Button variant="outline" onClick={exportCheques} disabled={!cheques.length}>
          <Download className="h-4 w-4 mr-2" /> Export
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Cheque Books</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.books}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Issued (Total)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.issuedTotal.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Received (Total)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.receivedTotal.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Pending</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.pending}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">Bounced</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive">{kpis.bounced}</div></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="books">Cheque Books</TabsTrigger>
          <TabsTrigger value="cheques">Cheques</TabsTrigger>
        </TabsList>

        <TabsContent value="books" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={bookOpen} onOpenChange={setBookOpen}>
              <DialogTrigger asChild>
                <Button disabled={!banks.length}><Plus className="h-4 w-4 mr-2" /> New Book</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Register Cheque Book</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Bank Account</Label>
                    <Select value={bookForm.bank_account_id} onValueChange={(v) => setBookForm({ ...bookForm, bank_account_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select bank account" /></SelectTrigger>
                      <SelectContent>
                        {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Series Prefix</Label><Input value={bookForm.series_prefix} onChange={(e) => setBookForm({ ...bookForm, series_prefix: e.target.value })} /></div>
                    <div><Label>Start #</Label><Input type="number" value={bookForm.start_number} onChange={(e) => setBookForm({ ...bookForm, start_number: e.target.value })} /></div>
                    <div><Label>End #</Label><Input type="number" value={bookForm.end_number} onChange={(e) => setBookForm({ ...bookForm, end_number: e.target.value })} /></div>
                  </div>
                  <div><Label>Notes</Label><Textarea value={bookForm.notes} onChange={(e) => setBookForm({ ...bookForm, notes: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBookOpen(false)}>Cancel</Button>
                  <Button onClick={() => createBook.mutate()} disabled={createBook.isPending}>Register</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bank / Account</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead className="text-right">Start</TableHead>
                    <TableHead className="text-right">End</TableHead>
                    <TableHead className="text-right">Next</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {booksLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                  ) : books.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No cheque books yet</TableCell></TableRow>
                  ) : books.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.bank_accounts?.bank_name} — {b.bank_accounts?.account_name}</TableCell>
                      <TableCell className="font-mono">{b.series_prefix ?? "—"}</TableCell>
                      <TableCell className="text-right">{b.start_number}</TableCell>
                      <TableCell className="text-right">{b.end_number}</TableCell>
                      <TableCell className="text-right font-semibold">{b.next_number}</TableCell>
                      <TableCell className="text-right">{Math.max(0, b.end_number - b.next_number + 1)}</TableCell>
                      <TableCell><Badge variant={b.status === "Active" ? "default" : "secondary"}>{b.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cheques" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={chqOpen} onOpenChange={setChqOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" /> New Cheque</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Record Cheque</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Direction</Label>
                    <Select value={chqForm.direction} onValueChange={(v) => setChqForm({ ...chqForm, direction: v, cheque_book_id: "", bank_account_id: "" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="issued">Issued (Outgoing)</SelectItem>
                        <SelectItem value="received">Received (Incoming)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {chqForm.direction === "issued" ? (
                    <div><Label>Cheque Book</Label>
                      <Select
                        value={chqForm.cheque_book_id}
                        onValueChange={(v) => {
                          const book = books.find((b) => b.id === v) ?? null;
                          setChqForm({
                            ...chqForm,
                            cheque_book_id: v,
                            bank_account_id: book?.bank_account_id ?? "",
                            cheque_number: suggestChequeNo(book),
                            currency: book?.bank_accounts?.currency ?? chqForm.currency,
                          });
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Select book" /></SelectTrigger>
                        <SelectContent>
                          {books.filter((b) => b.status === "Active").map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.bank_accounts?.bank_name} — next {b.series_prefix ? `${b.series_prefix}-` : ""}{b.next_number}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div><Label>Deposit Bank Account</Label>
                      <Select value={chqForm.bank_account_id} onValueChange={(v) => setChqForm({ ...chqForm, bank_account_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Select bank account" /></SelectTrigger>
                        <SelectContent>
                          {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div><Label>Cheque Number</Label><Input value={chqForm.cheque_number} onChange={(e) => setChqForm({ ...chqForm, cheque_number: e.target.value })} /></div>
                  <div><Label>Party (Payee / Drawer)</Label><Input value={chqForm.party_name} onChange={(e) => setChqForm({ ...chqForm, party_name: e.target.value })} /></div>
                  <div><Label>Amount</Label><Input type="number" step="0.01" value={chqForm.amount} onChange={(e) => setChqForm({ ...chqForm, amount: e.target.value })} /></div>
                  <div><Label>Currency</Label>
                    <Select value={chqForm.currency} onValueChange={(v) => setChqForm({ ...chqForm, currency: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{["EGP", "USD", "EUR", "GBP", "AED", "SAR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Issue Date</Label><DateInput  value={chqForm.issue_date} onChange={(e) => setChqForm({ ...chqForm, issue_date: e.target.value })} /></div>
                  <div><Label>Due Date</Label><DateInput  value={chqForm.due_date} onChange={(e) => setChqForm({ ...chqForm, due_date: e.target.value })} /></div>
                  <div className="col-span-2"><Label>Notes</Label><Textarea value={chqForm.notes} onChange={(e) => setChqForm({ ...chqForm, notes: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setChqOpen(false)}>Cancel</Button>
                  <Button onClick={() => createCheque.mutate()} disabled={createCheque.isPending}>Record</Button>
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
                    <TableHead>Direction</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chequesLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                  ) : cheques.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No cheques recorded</TableCell></TableRow>
                  ) : cheques.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono">{c.cheque_number}</TableCell>
                      <TableCell><Badge variant="outline">{c.direction}</Badge></TableCell>
                      <TableCell>{c.party_name}</TableCell>
                      <TableCell>{c.bank_accounts?.bank_name ?? "—"}</TableCell>
                      <TableCell className="text-right">{Number(c.amount).toLocaleString()} {c.currency}</TableCell>
                      <TableCell>{format(new Date(c.issue_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{c.due_date ? format(new Date(c.due_date), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          {c.status === "Issued" && c.direction === "received" && (
                            <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: c.id, status: "Deposited" })}>Deposit</Button>
                          )}
                          {(c.status === "Issued" || c.status === "Deposited") && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: c.id, status: "Cleared" })}>
                                <CheckCircle2 className="h-3 w-3 mr-1" />Clear
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => {
                                const reason = window.prompt("Bounce reason?") ?? "";
                                if (reason.trim()) updateStatus.mutate({ id: c.id, status: "Bounced", reason });
                              }}>
                                <XCircle className="h-3 w-3 mr-1" />Bounce
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
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
