import { useState, useMemo } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Play, Check, X, Send, DollarSign, Users, Receipt } from "lucide-react";

type Employee = {
  id: string; employee_no: string; full_name: string; email: string | null;
  department: string | null; position: string | null; base_salary: number;
  currency: string; status: string; company_id: string | null;
};

type PayrollRun = {
  id: string; company_id: string | null; period_year: number; period_month: number;
  currency: string; status: string;
  total_gross: number; total_deductions: number; total_tax: number;
  total_social: number; total_net: number;
};

type PayrollLine = {
  id: string; run_id: string; employee_id: string;
  gross_salary: number; allowances: number; overtime: number; bonuses: number;
  deductions: number; income_tax: number; social_insurance: number; net_pay: number;
  employees?: { full_name: string; employee_no: string };
};

type ExpenseReport = {
  id: string; report_no: string; employee_id: string; title: string;
  currency: string; total_amount: number; status: string;
  submitted_at: string | null; approved_at: string | null; reimbursed_at: string | null;
  rejection_reason: string | null;
  employees?: { full_name: string; employee_no: string };
};

const fmt = (n: number, c = "EGP") => `${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function PayrollExpensesPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [empDialog, setEmpDialog] = useState(false);
  const [expDialog, setExpDialog] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  const { data: companies = [] } = useQuery({
    queryKey: ["payroll-companies"],
    queryFn: async () => (await supabase.from("companies").select("id,name").order("name")).data || [],
  });

  const { data: employees = [], refetch: refetchEmps } = useQuery<Employee[]>({
    queryKey: ["employees"],
    queryFn: async () => ((await supabase.from("employees").select("*").order("employee_no")).data as Employee[]) || [],
  });

  const { data: runs = [] } = useQuery<PayrollRun[]>({
    queryKey: ["payroll-runs"],
    queryFn: async () => ((await supabase.from("payroll_runs").select("*").order("period_year", { ascending: false }).order("period_month", { ascending: false })).data as PayrollRun[]) || [],
  });

  const { data: runLines = [] } = useQuery<PayrollLine[]>({
    queryKey: ["payroll-lines", selectedRun],
    enabled: !!selectedRun,
    queryFn: async () => ((await supabase.from("payroll_run_lines").select("*, employees(full_name, employee_no)").eq("run_id", selectedRun!)).data as PayrollLine[]) || [],
  });

  const { data: reports = [] } = useQuery<ExpenseReport[]>({
    queryKey: ["expense-reports"],
    queryFn: async () => ((await supabase.from("expense_reports").select("*, employees(full_name, employee_no)").order("created_at", { ascending: false })).data as ExpenseReport[]) || [],
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("generate_payroll_run", { _company: null, _year: year, _month: month });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Payroll run generated");
      setSelectedRun(id);
      qc.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setRunStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === "Approved") { patch.approved_at = new Date().toISOString(); patch.approved_by = (await supabase.auth.getUser()).data.user?.id; }
      if (status === "Posted") { patch.posted_at = new Date().toISOString(); patch.posted_by = (await supabase.auth.getUser()).data.user?.id; }
      const { error } = await supabase.from("payroll_runs").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Status updated"); qc.invalidateQueries({ queryKey: ["payroll-runs"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const setExpStatus = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const patch: any = { status };
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const nowIso = new Date().toISOString();
      if (status === "Submitted") patch.submitted_at = nowIso;
      if (status === "Approved") { patch.approved_at = nowIso; patch.approved_by = uid; }
      if (status === "Rejected") { patch.rejected_at = nowIso; patch.rejected_by = uid; patch.rejection_reason = reason || null; }
      if (status === "Reimbursed") patch.reimbursed_at = nowIso;
      const { error } = await supabase.from("expense_reports").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Status updated"); qc.invalidateQueries({ queryKey: ["expense-reports"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const stats = useMemo(() => ({
    employees: employees.filter(e => e.status === "Active").length,
    monthlyPayroll: runs.filter(r => r.period_year === year && r.period_month === month).reduce((s, r) => s + Number(r.total_net || 0), 0),
    pendingExpenses: reports.filter(r => r.status === "Submitted").length,
    pendingAmount: reports.filter(r => r.status === "Submitted").reduce((s, r) => s + Number(r.total_amount || 0), 0),
  }), [employees, runs, reports, year, month]);

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      Draft: "secondary", Submitted: "default", Approved: "default",
      Rejected: "destructive", Reimbursed: "outline", Posted: "outline",
    };
    return <Badge variant={(map[s] as any) || "secondary"}>{s}</Badge>;
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payroll & Employee Expenses</h1>
        <p className="text-muted-foreground">Manage employees, run monthly payroll, and process expense claims.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><Users className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Active Employees</div><div className="text-2xl font-bold">{stats.employees}</div></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><DollarSign className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Net Payroll ({MONTHS[month-1]} {year})</div><div className="text-2xl font-bold">{fmt(stats.monthlyPayroll)}</div></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><Receipt className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Pending Expenses</div><div className="text-2xl font-bold">{stats.pendingExpenses}</div></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><DollarSign className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Pending Amount</div><div className="text-2xl font-bold">{fmt(stats.pendingAmount)}</div></div></div></CardContent></Card>
      </div>

      <Tabs defaultValue="payroll">
        <TabsList>
          <TabsTrigger value="payroll">Payroll Runs</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="expenses">Expense Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="payroll" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Generate Payroll Run</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(+e.target.value)} className="w-28" /></div>
              <div>
                <Label>Month</Label>
                <Select value={String(month)} onValueChange={v => setMonth(+v)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button onClick={() => generate.mutate()} disabled={generate.isPending}><Play className="h-4 w-4 mr-1" />Generate</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Runs</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Period</TableHead><TableHead>Status</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Social</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {runs.map(r => (
                    <TableRow key={r.id} className={selectedRun === r.id ? "bg-muted/50" : "cursor-pointer"} onClick={() => setSelectedRun(r.id)}>
                      <TableCell>{MONTHS[r.period_month-1]} {r.period_year}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-right">{fmt(r.total_gross, r.currency)}</TableCell>
                      <TableCell className="text-right">{fmt(r.total_tax, r.currency)}</TableCell>
                      <TableCell className="text-right">{fmt(r.total_social, r.currency)}</TableCell>
                      <TableCell className="text-right font-semibold">{fmt(r.total_net, r.currency)}</TableCell>
                      <TableCell className="space-x-1" onClick={e => e.stopPropagation()}>
                        {r.status === "Draft" && <Button size="sm" variant="outline" onClick={() => setRunStatus.mutate({ id: r.id, status: "Approved" })}><Check className="h-3 w-3 mr-1" />Approve</Button>}
                        {r.status === "Approved" && <Button size="sm" onClick={() => setRunStatus.mutate({ id: r.id, status: "Posted" })}>Post</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {runs.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No payroll runs yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {selectedRun && (
            <Card>
              <CardHeader><CardTitle>Payroll Lines</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Allowances</TableHead>
                    <TableHead className="text-right">Overtime</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Social</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {runLines.map(l => (
                      <TableRow key={l.id}>
                        <TableCell>{l.employees?.full_name} <span className="text-xs text-muted-foreground">({l.employees?.employee_no})</span></TableCell>
                        <TableCell className="text-right">{fmt(l.gross_salary)}</TableCell>
                        <TableCell className="text-right">{fmt(l.allowances)}</TableCell>
                        <TableCell className="text-right">{fmt(l.overtime)}</TableCell>
                        <TableCell className="text-right">{fmt(l.deductions)}</TableCell>
                        <TableCell className="text-right">{fmt(l.income_tax)}</TableCell>
                        <TableCell className="text-right">{fmt(l.social_insurance)}</TableCell>
                        <TableCell className="text-right font-semibold">{fmt(l.net_pay)}</TableCell>
                      </TableRow>
                    ))}
                    {runLines.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No lines</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="employees" className="space-y-4">
          <div className="flex justify-end"><Button onClick={() => setEmpDialog(true)}><Plus className="h-4 w-4 mr-1" />Add Employee</Button></div>
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Employee #</TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead>
                <TableHead>Department</TableHead><TableHead>Position</TableHead>
                <TableHead className="text-right">Base Salary</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {employees.map(e => (
                  <TableRow key={e.id}>
                    <TableCell>{e.employee_no}</TableCell>
                    <TableCell>{e.full_name}</TableCell>
                    <TableCell>{e.email || "—"}</TableCell>
                    <TableCell>{e.department || "—"}</TableCell>
                    <TableCell>{e.position || "—"}</TableCell>
                    <TableCell className="text-right">{fmt(e.base_salary, e.currency)}</TableCell>
                    <TableCell>{statusBadge(e.status)}</TableCell>
                  </TableRow>
                ))}
                {employees.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No employees</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="expenses" className="space-y-4">
          <div className="flex justify-end"><Button onClick={() => setExpDialog(true)}><Plus className="h-4 w-4 mr-1" />New Expense Report</Button></div>
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Report #</TableHead><TableHead>Employee</TableHead><TableHead>Title</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {reports.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.report_no}</TableCell>
                    <TableCell>{r.employees?.full_name || "—"}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell className="text-right">{fmt(r.total_amount, r.currency)}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="space-x-1">
                      {r.status === "Draft" && <Button size="sm" variant="outline" onClick={() => setExpStatus.mutate({ id: r.id, status: "Submitted" })}><Send className="h-3 w-3 mr-1" />Submit</Button>}
                      {r.status === "Submitted" && <>
                        <Button size="sm" onClick={() => setExpStatus.mutate({ id: r.id, status: "Approved" })}><Check className="h-3 w-3 mr-1" />Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => { const reason = prompt("Reason?"); if (reason) setExpStatus.mutate({ id: r.id, status: "Rejected", reason }); }}><X className="h-3 w-3 mr-1" />Reject</Button>
                      </>}
                      {r.status === "Approved" && <Button size="sm" onClick={() => setExpStatus.mutate({ id: r.id, status: "Reimbursed" })}>Mark Reimbursed</Button>}
                    </TableCell>
                  </TableRow>
                ))}
                {reports.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No expense reports</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <EmployeeDialog open={empDialog} onOpenChange={setEmpDialog} companies={companies as any} onSaved={() => refetchEmps()} />
      <ExpenseDialog open={expDialog} onOpenChange={setExpDialog} employees={employees} onSaved={() => qc.invalidateQueries({ queryKey: ["expense-reports"] })} />
    </div>
  );
}

function EmployeeDialog({ open, onOpenChange, companies, onSaved }: { open: boolean; onOpenChange: (b: boolean) => void; companies: { id: string; name: string }[]; onSaved: () => void }) {
  const [f, setF] = useState({ employee_no: "", full_name: "", email: "", department: "", position: "", base_salary: 0, currency: "EGP", company_id: "" });
  const save = async () => {
    if (!f.employee_no || !f.full_name) { toast.error("Employee # and name required"); return; }
    const { error } = await supabase.from("employees").insert({ ...f, company_id: f.company_id || null });
    if (error) return toast.error(error.message);
    toast.success("Employee added"); onSaved(); onOpenChange(false);
    setF({ employee_no: "", full_name: "", email: "", department: "", position: "", base_salary: 0, currency: "EGP", company_id: "" });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent><DialogHeader><DialogTitle>Add Employee</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Employee #</Label><Input value={f.employee_no} onChange={e => setF({ ...f, employee_no: e.target.value })} /></div>
          <div><Label>Full Name</Label><Input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} /></div>
          <div><Label>Email</Label><Input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          <div><Label>Department</Label><Input value={f.department} onChange={e => setF({ ...f, department: e.target.value })} /></div>
          <div><Label>Position</Label><Input value={f.position} onChange={e => setF({ ...f, position: e.target.value })} /></div>
          <div><Label>Base Salary</Label><Input type="number" value={f.base_salary} onChange={e => setF({ ...f, base_salary: +e.target.value })} /></div>
          <div><Label>Currency</Label><Input value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })} /></div>
          <div><Label>Company</Label>
            <Select value={f.company_id} onValueChange={v => setF({ ...f, company_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDialog({ open, onOpenChange, employees, onSaved }: { open: boolean; onOpenChange: (b: boolean) => void; employees: Employee[]; onSaved: () => void }) {
  const [f, setF] = useState({ employee_id: "", title: "", purpose: "", currency: "EGP" });
  const [lines, setLines] = useState<{ line_date: string; category: string; description: string; amount: number }[]>([
    { line_date: new Date().toISOString().slice(0,10), category: "", description: "", amount: 0 },
  ]);
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const save = async () => {
    if (!f.employee_id || !f.title) { toast.error("Employee and title required"); return; }
    const { data, error } = await supabase.from("expense_reports").insert({ ...f, total_amount: total }).select("id").single();
    if (error) return toast.error(error.message);
    if (lines.length) {
      const { error: e2 } = await supabase.from("expense_report_lines").insert(lines.filter(l => l.category).map(l => ({ ...l, report_id: data.id, currency: f.currency })));
      if (e2) return toast.error(e2.message);
    }
    toast.success("Expense report created"); onSaved(); onOpenChange(false);
    setF({ employee_id: "", title: "", purpose: "", currency: "EGP" });
    setLines([{ line_date: new Date().toISOString().slice(0,10), category: "", description: "", amount: 0 }]);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>New Expense Report</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Employee</Label>
            <Select value={f.employee_id} onValueChange={v => setF({ ...f, employee_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.full_name} ({e.employee_no})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Title</Label><Input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
          <div className="col-span-2"><Label>Purpose</Label><Textarea value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })} /></div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between items-center"><Label>Line Items</Label>
            <Button size="sm" variant="outline" onClick={() => setLines([...lines, { line_date: new Date().toISOString().slice(0,10), category: "", description: "", amount: 0 }])}><Plus className="h-3 w-3 mr-1" />Add Line</Button></div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <DateInput  className="col-span-3" value={l.line_date} onChange={e => { const c = [...lines]; c[i].line_date = e.target.value; setLines(c); }} />
              <Input className="col-span-3" placeholder="Category" value={l.category} onChange={e => { const c = [...lines]; c[i].category = e.target.value; setLines(c); }} />
              <Input className="col-span-4" placeholder="Description" value={l.description} onChange={e => { const c = [...lines]; c[i].description = e.target.value; setLines(c); }} />
              <Input type="number" className="col-span-2 text-right" value={l.amount} onChange={e => { const c = [...lines]; c[i].amount = +e.target.value; setLines(c); }} />
            </div>
          ))}
          <div className="text-right font-semibold">Total: {fmt(total, f.currency)}</div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
