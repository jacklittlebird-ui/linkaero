// Petty Cash Management (Phase 1w)
// -------------------------------------------------------------
// Two tabs:
//   1. Funds     — custodian floats per station/company with limit + running balance.
//   2. Expenses  — expense claims and replenishments against a fund with lifecycle:
//                  Draft → Submitted → Approved → Reimbursed, or Rejected.
//                  Approved entries adjust the fund's current_balance
//                  (Expense subtracts, Replenishment adds).

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
import { Wallet, Plus, Download, CheckCircle2, XCircle, Send } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format } from "date-fns";

const STATUSES = ["Draft", "Submitted", "Approved", "Reimbursed", "Rejected"] as const;
type Status = typeof STATUSES[number];
const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  Draft: "outline",
  Submitted: "secondary",
  Approved: "default",
  Reimbursed: "default",
  Rejected: "destructive",
};

const ENTRY_TYPES = ["Expense", "Replenishment"] as const;
type EntryType = typeof ENTRY_TYPES[number];

const CATEGORIES = [
  "Office Supplies", "Fuel", "Transport", "Meals", "Postage",
  "Repairs", "Cleaning", "Miscellaneous",
];

interface Company { id: string; name: string; }
interface Fund {
  id: string;
  fund_code: string;
  custodian_name: string;
  station: string | null;
  company_id: string | null;
  currency: string;
  float_limit: number;
  current_balance: number;
  status: string;
  notes: string | null;
}
interface Expense {
  id: string;
  fund_id: string;
  entry_type: string;
  expense_date: string;
  category: string | null;
  description: string;
  amount: number;
  currency: string;
  receipt_ref: string | null;
  status: string;
  notes: string | null;
  petty_cash_funds?: { fund_code: string; custodian_name: string } | null;
}

export default function PettyCash() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"funds" | "expenses">("funds");

  const companiesQ = useQuery({
    queryKey: ["companies"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as Company[];
    },
  });

  const fundsQ = useQuery({
    queryKey: ["petty_cash_funds"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_funds")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Fund[];
    },
  });

  const expensesQ = useQuery({
    queryKey: ["petty_cash_expenses"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_expenses")
        .select("*, petty_cash_funds(fund_code,custodian_name)")
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Expense[];
    },
  });

  const funds = fundsQ.data ?? [];
  const expenses = expensesQ.data ?? [];
  const companies = companiesQ.data ?? [];

  const kpis = useMemo(() => {
    const activeFunds = funds.filter((f) => f.status === "Active").length;
    const totalBalance = funds.reduce((s, f) => s + Number(f.current_balance || 0), 0);
    const totalLimit = funds.reduce((s, f) => s + Number(f.float_limit || 0), 0);
    const pending = expenses.filter((e) => e.status === "Submitted").length;
    const ytd = expenses
      .filter((e) => e.entry_type === "Expense" && (e.status === "Approved" || e.status === "Reimbursed"))
      .filter((e) => new Date(e.expense_date).getFullYear() === new Date().getFullYear())
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    return { activeFunds, totalBalance, totalLimit, pending, ytd };
  }, [funds, expenses]);

  // --- Mutations ---
  const upsertFund = useMutation({
    mutationFn: async (payload: Partial<Fund>) => {
      const row = { ...payload };
      const { error } = payload.id
        ? await supabase.from("petty_cash_funds").update(row).eq("id", payload.id)
        : await supabase.from("petty_cash_funds").insert(row as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["petty_cash_funds"] });
      toast.success("Fund saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const upsertExpense = useMutation({
    mutationFn: async (payload: Partial<Expense>) => {
      const { petty_cash_funds: _pcf, ...row } = payload as any;
      const { error } = payload.id
        ? await supabase.from("petty_cash_expenses").update(row).eq("id", payload.id)
        : await supabase.from("petty_cash_expenses").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["petty_cash_expenses"] });
      toast.success("Entry saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const setStatus = useMutation({
    mutationFn: async ({ row, next }: { row: Expense; next: Status }) => {
      const { error } = await supabase
        .from("petty_cash_expenses")
        .update({ status: next, approved_at: next === "Approved" ? new Date().toISOString() : null })
        .eq("id", row.id);
      if (error) throw error;

      // Adjust fund balance when Approved
      if (next === "Approved") {
        const fund = funds.find((f) => f.id === row.fund_id);
        if (fund) {
          const delta = row.entry_type === "Expense" ? -Number(row.amount) : Number(row.amount);
          const newBal = Number(fund.current_balance || 0) + delta;
          const { error: e2 } = await supabase
            .from("petty_cash_funds")
            .update({ current_balance: newBal })
            .eq("id", fund.id);
          if (e2) throw e2;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["petty_cash_expenses"] });
      qc.invalidateQueries({ queryKey: ["petty_cash_funds"] });
      toast.success("Status updated");
    },
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet size={24} /> Petty Cash Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Custodian floats, expense claims, and replenishment cycle.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <KpiCard label="Active Funds" value={kpis.activeFunds} />
        <KpiCard label="Total Balance" value={kpis.totalBalance.toFixed(2)} />
        <KpiCard label="Total Float Limit" value={kpis.totalLimit.toFixed(2)} />
        <KpiCard label="Pending Approvals" value={kpis.pending} />
        <KpiCard label="YTD Expenses" value={kpis.ytd.toFixed(2)} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="funds">Funds</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
        </TabsList>

        <TabsContent value="funds" className="space-y-4">
          <FundsTab
            funds={funds}
            companies={companies}
            onSave={(p) => upsertFund.mutate(p)}
          />
        </TabsContent>

        <TabsContent value="expenses" className="space-y-4">
          <ExpensesTab
            expenses={expenses}
            funds={funds}
            onSave={(p) => upsertExpense.mutate(p)}
            onStatus={(row, next) => setStatus.mutate({ row, next })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

// ------------------- Funds Tab -------------------
function FundsTab({
  funds, companies, onSave,
}: {
  funds: Fund[];
  companies: Company[];
  onSave: (payload: Partial<Fund>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Fund> | null>(null);

  const openNew = () => {
    setEditing({
      fund_code: "",
      custodian_name: "",
      station: "",
      currency: "EGP",
      float_limit: 0,
      current_balance: 0,
      status: "Active",
    });
    setOpen(true);
  };

  const submit = () => {
    if (!editing?.fund_code || !editing?.custodian_name) {
      toast.error("Code and Custodian are required");
      return;
    }
    onSave(editing);
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Petty Cash Funds</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportToExcel(funds, "Funds", "petty_cash_funds")}>
            <Download size={16} className="mr-1" /> Export
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNew}>
                <Plus size={16} className="mr-1" /> New Fund
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing?.id ? "Edit Fund" : "New Fund"}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-1">
                  <Label>Fund Code</Label>
                  <Input
                    value={editing?.fund_code ?? ""}
                    onChange={(e) => setEditing({ ...editing!, fund_code: e.target.value })}
                  />
                </div>
                <div className="col-span-1">
                  <Label>Custodian Name</Label>
                  <Input
                    value={editing?.custodian_name ?? ""}
                    onChange={(e) => setEditing({ ...editing!, custodian_name: e.target.value })}
                  />
                </div>
                <div className="col-span-1">
                  <Label>Station</Label>
                  <Input
                    value={editing?.station ?? ""}
                    onChange={(e) => setEditing({ ...editing!, station: e.target.value })}
                  />
                </div>
                <div className="col-span-1">
                  <Label>Company</Label>
                  <Select
                    value={editing?.company_id ?? ""}
                    onValueChange={(v) => setEditing({ ...editing!, company_id: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1">
                  <Label>Currency</Label>
                  <Input
                    value={editing?.currency ?? "EGP"}
                    onChange={(e) => setEditing({ ...editing!, currency: e.target.value })}
                  />
                </div>
                <div className="col-span-1">
                  <Label>Float Limit</Label>
                  <Input
                    type="number"
                    value={editing?.float_limit ?? 0}
                    onChange={(e) => setEditing({ ...editing!, float_limit: Number(e.target.value) })}
                  />
                </div>
                <div className="col-span-1">
                  <Label>Current Balance</Label>
                  <Input
                    type="number"
                    value={editing?.current_balance ?? 0}
                    onChange={(e) => setEditing({ ...editing!, current_balance: Number(e.target.value) })}
                  />
                </div>
                <div className="col-span-1">
                  <Label>Status</Label>
                  <Select
                    value={editing?.status ?? "Active"}
                    onValueChange={(v) => setEditing({ ...editing!, status: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={editing?.notes ?? ""}
                    onChange={(e) => setEditing({ ...editing!, notes: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={submit}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Custodian</TableHead>
              <TableHead>Station</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead className="text-right">Limit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {funds.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.fund_code}</TableCell>
                <TableCell>{f.custodian_name}</TableCell>
                <TableCell>{f.station ?? "—"}</TableCell>
                <TableCell>{f.currency}</TableCell>
                <TableCell className="text-right">{Number(f.float_limit).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(f.current_balance).toFixed(2)}</TableCell>
                <TableCell>
                  <Badge variant={f.status === "Active" ? "default" : "outline"}>{f.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(f); setOpen(true); }}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {funds.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No funds registered yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ------------------- Expenses Tab -------------------
function ExpensesTab({
  expenses, funds, onSave, onStatus,
}: {
  expenses: Expense[];
  funds: Fund[];
  onSave: (payload: Partial<Expense>) => void;
  onStatus: (row: Expense, next: Status) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);

  const openNew = () => {
    setEditing({
      entry_type: "Expense",
      expense_date: format(new Date(), "yyyy-MM-dd"),
      category: "Miscellaneous",
      description: "",
      amount: 0,
      currency: "EGP",
      status: "Draft",
      fund_id: funds[0]?.id,
    });
    setOpen(true);
  };

  const submit = () => {
    if (!editing?.fund_id || !editing?.description || !editing?.amount) {
      toast.error("Fund, description and amount are required");
      return;
    }
    onSave(editing);
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Expense Entries</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportToExcel(expenses, "Expenses", "petty_cash_expenses")}>
            <Download size={16} className="mr-1" /> Export
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNew} disabled={funds.length === 0}>
                <Plus size={16} className="mr-1" /> New Entry
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing?.id ? "Edit Entry" : "New Entry"}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Fund</Label>
                  <Select
                    value={editing?.fund_id ?? ""}
                    onValueChange={(v) => setEditing({ ...editing!, fund_id: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {funds.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.fund_code} — {f.custodian_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Type</Label>
                  <Select
                    value={editing?.entry_type ?? "Expense"}
                    onValueChange={(v) => setEditing({ ...editing!, entry_type: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ENTRY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date</Label>
                  <DateInput
                    
                    value={editing?.expense_date ?? ""}
                    onChange={(e) => setEditing({ ...editing!, expense_date: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select
                    value={editing?.category ?? ""}
                    onValueChange={(v) => setEditing({ ...editing!, category: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    value={editing?.amount ?? 0}
                    onChange={(e) => setEditing({ ...editing!, amount: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Input
                    value={editing?.currency ?? "EGP"}
                    onChange={(e) => setEditing({ ...editing!, currency: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Description</Label>
                  <Input
                    value={editing?.description ?? ""}
                    onChange={(e) => setEditing({ ...editing!, description: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Receipt Reference</Label>
                  <Input
                    value={editing?.receipt_ref ?? ""}
                    onChange={(e) => setEditing({ ...editing!, receipt_ref: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={submit}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Fund</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map((e) => {
              const status = e.status as Status;
              return (
                <TableRow key={e.id}>
                  <TableCell>{format(new Date(e.expense_date), "dd/MM/yyyy")}</TableCell>
                  <TableCell>{e.petty_cash_funds?.fund_code ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={e.entry_type === "Expense" ? "outline" : "secondary"}>
                      {e.entry_type}
                    </Badge>
                  </TableCell>
                  <TableCell>{e.category ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate">{e.description}</TableCell>
                  <TableCell className="text-right">
                    {Number(e.amount).toFixed(2)} {e.currency}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{e.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {status === "Draft" && (
                      <Button size="sm" variant="ghost" onClick={() => onStatus(e, "Submitted")}>
                        <Send size={14} className="mr-1" /> Submit
                      </Button>
                    )}
                    {status === "Submitted" && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => onStatus(e, "Approved")}>
                          <CheckCircle2 size={14} className="mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onStatus(e, "Rejected")}>
                          <XCircle size={14} className="mr-1" /> Reject
                        </Button>
                      </>
                    )}
                    {status === "Approved" && (
                      <Button size="sm" variant="ghost" onClick={() => onStatus(e, "Reimbursed")}>
                        Mark Reimbursed
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {expenses.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No entries yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
