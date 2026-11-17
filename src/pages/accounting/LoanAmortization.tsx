import { useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, PlayCircle, CheckCircle } from "lucide-react";
import { format } from "date-fns";

type Loan = {
  id: string;
  loan_number: string;
  lender_name: string;
  principal_amount: number;
  currency: string;
  annual_interest_rate: number;
  term_months: number;
  payment_frequency: string;
  start_date: string;
  first_payment_date: string;
  outstanding_balance: number;
  status: string;
};

type Row = {
  id: string;
  period_number: number;
  due_date: string;
  opening_balance: number;
  payment_amount: number;
  interest_amount: number;
  principal_amount: number;
  closing_balance: number;
  status: string;
};

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LoanAmortizationPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    loan_number: "",
    lender_name: "",
    principal_amount: "",
    currency: "EGP",
    annual_interest_rate: "",
    term_months: "12",
    payment_frequency: "monthly",
    start_date: format(new Date(), "yyyy-MM-dd"),
    first_payment_date: format(new Date(), "yyyy-MM-dd"),
  });

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("loans").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Loan[];
    },
  });

  const { data: schedule = [] } = useQuery({
    queryKey: ["loan_schedule", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loan_payment_schedule")
        .select("*")
        .eq("loan_id", selectedId!)
        .order("period_number");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const createLoan = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("loans").insert({
        loan_number: form.loan_number,
        lender_name: form.lender_name,
        principal_amount: Number(form.principal_amount),
        currency: form.currency,
        annual_interest_rate: Number(form.annual_interest_rate) / 100,
        term_months: Number(form.term_months),
        payment_frequency: form.payment_frequency,
        start_date: form.start_date,
        first_payment_date: form.first_payment_date,
        outstanding_balance: Number(form.principal_amount),
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Loan created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const generate = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("generate_loan_schedule", { p_loan_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: (n) => {
      toast.success(`Generated ${n} periods`);
      qc.invalidateQueries({ queryKey: ["loan_schedule", selectedId] });
      qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const post = useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await supabase.rpc("post_loan_period", { p_schedule_id: rowId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Period posted");
      qc.invalidateQueries({ queryKey: ["loan_schedule", selectedId] });
      qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const selected = loans.find(l => l.id === selectedId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Loan Amortization & Interest Accrual</h1>
          <p className="text-muted-foreground">Manage loan schedules and post monthly interest accruals</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Loan</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Register New Loan</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Loan Number</Label><Input value={form.loan_number} onChange={e => setForm({ ...form, loan_number: e.target.value })} /></div>
              <div><Label>Lender Name</Label><Input value={form.lender_name} onChange={e => setForm({ ...form, lender_name: e.target.value })} /></div>
              <div><Label>Principal Amount</Label><Input type="number" value={form.principal_amount} onChange={e => setForm({ ...form, principal_amount: e.target.value })} /></div>
              <div><Label>Currency</Label><Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} /></div>
              <div><Label>Annual Interest Rate (%)</Label><Input type="number" step="0.01" value={form.annual_interest_rate} onChange={e => setForm({ ...form, annual_interest_rate: e.target.value })} /></div>
              <div><Label>Term (months)</Label><Input type="number" value={form.term_months} onChange={e => setForm({ ...form, term_months: e.target.value })} /></div>
              <div>
                <Label>Payment Frequency</Label>
                <Select value={form.payment_frequency} onValueChange={v => setForm({ ...form, payment_frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Start Date</Label><DateInput  value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
              <div><Label>First Payment Date</Label><DateInput  value={form.first_payment_date} onChange={e => setForm({ ...form, first_payment_date: e.target.value })} /></div>
            </div>
            <Button onClick={() => createLoan.mutate()} disabled={createLoan.isPending}>
              {createLoan.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Create Loan
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>Loans</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loader2 className="animate-spin" /> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Loan #</TableHead><TableHead>Lender</TableHead><TableHead>Principal</TableHead>
                <TableHead>Rate</TableHead><TableHead>Term</TableHead><TableHead>Outstanding</TableHead>
                <TableHead>Status</TableHead><TableHead>Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loans.map(l => (
                  <TableRow key={l.id} className={selectedId === l.id ? "bg-muted" : "cursor-pointer"} onClick={() => setSelectedId(l.id)}>
                    <TableCell className="font-medium">{l.loan_number}</TableCell>
                    <TableCell>{l.lender_name}</TableCell>
                    <TableCell>{fmt(l.principal_amount)} {l.currency}</TableCell>
                    <TableCell>{(l.annual_interest_rate * 100).toFixed(2)}%</TableCell>
                    <TableCell>{l.term_months}m</TableCell>
                    <TableCell>{fmt(l.outstanding_balance)}</TableCell>
                    <TableCell><Badge variant={l.status === "closed" ? "secondary" : "default"}>{l.status}</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); generate.mutate(l.id); setSelectedId(l.id); }}>
                        <PlayCircle className="w-4 h-4 mr-1" />Generate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {loans.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No loans registered</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader><CardTitle>Amortization Schedule — {selected.loan_number}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>#</TableHead><TableHead>Due Date</TableHead><TableHead>Opening</TableHead>
                <TableHead>Payment</TableHead><TableHead>Interest</TableHead><TableHead>Principal</TableHead>
                <TableHead>Closing</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {schedule.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{r.period_number}</TableCell>
                    <TableCell>{format(new Date(r.due_date), "dd/MM/yyyy")}</TableCell>
                    <TableCell>{fmt(r.opening_balance)}</TableCell>
                    <TableCell>{fmt(r.payment_amount)}</TableCell>
                    <TableCell>{fmt(r.interest_amount)}</TableCell>
                    <TableCell>{fmt(r.principal_amount)}</TableCell>
                    <TableCell>{fmt(r.closing_balance)}</TableCell>
                    <TableCell><Badge variant={r.status === "scheduled" ? "outline" : "default"}>{r.status}</Badge></TableCell>
                    <TableCell>
                      {r.status === "scheduled" && (
                        <Button size="sm" onClick={() => post.mutate(r.id)}>
                          <CheckCircle className="w-4 h-4 mr-1" />Post
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {schedule.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Click "Generate" on the loan to build the schedule</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
