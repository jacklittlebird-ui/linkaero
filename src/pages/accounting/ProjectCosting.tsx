import { useEffect, useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Briefcase, DollarSign, TrendingUp, Layers } from "lucide-react";

type Project = { id: string; code: string; name: string; customer_name: string | null; manager: string | null; currency: string; budget_amount: number; start_date: string | null; end_date: string | null; status: string; notes: string | null };
type Task = { id: string; project_id: string; code: string | null; name: string; budget_amount: number; progress_pct: number; status: string };
type Txn = { id: string; project_id: string; task_id: string | null; txn_type: string; txn_date: string; description: string | null; amount: number; currency: string };
type PnL = { project_id: string; code: string; name: string; status: string; currency: string; budget_amount: number; actual_cost: number; revenue: number; billed: number; wip: number; margin: number; margin_pct: number };

export default function ProjectCostingPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [pnl, setPnl] = useState<PnL[]>([]);

  const [prjDlg, setPrjDlg] = useState(false);
  const [taskDlg, setTaskDlg] = useState(false);
  const [txnDlg, setTxnDlg] = useState(false);

  const [prjForm, setPrjForm] = useState<Partial<Project>>({ currency: "USD", budget_amount: 0, status: "planned" });
  const [taskForm, setTaskForm] = useState<Partial<Task>>({ budget_amount: 0, progress_pct: 0, status: "open" });
  const [txnForm, setTxnForm] = useState<any>({ txn_type: "cost", txn_date: new Date().toISOString().slice(0, 10), amount: 0, currency: "USD" });

  const loadAll = async () => {
    const [p, t, x, pl] = await Promise.all([
      supabase.from("projects").select("*").order("code"),
      supabase.from("project_tasks").select("*").order("created_at"),
      supabase.from("project_transactions").select("*").order("txn_date", { ascending: false }).limit(300),
      supabase.rpc("get_project_pnl", { _project_id: null }),
    ]);
    if (p.data) setProjects(p.data as any);
    if (t.data) setTasks(t.data as any);
    if (x.data) setTxns(x.data as any);
    if (pl.data) setPnl(pl.data as any);
  };
  useEffect(() => { loadAll(); }, []);

  const kpi = useMemo(() => ({
    projects: projects.length,
    active: projects.filter(p => p.status === "active").length,
    budget: pnl.reduce((a, r) => a + Number(r.budget_amount || 0), 0),
    cost: pnl.reduce((a, r) => a + Number(r.actual_cost || 0), 0),
    revenue: pnl.reduce((a, r) => a + Number(r.revenue || 0), 0),
    wip: pnl.reduce((a, r) => a + Number(r.wip || 0), 0),
  }), [projects, pnl]);

  const saveProject = async () => {
    if (!prjForm.code || !prjForm.name) return toast.error("Code and name required");
    const { error } = await supabase.from("projects").upsert(prjForm as any);
    if (error) return toast.error(error.message);
    toast.success("Project saved"); setPrjDlg(false); setPrjForm({ currency: "USD", budget_amount: 0, status: "planned" }); loadAll();
  };
  const saveTask = async () => {
    if (!taskForm.project_id || !taskForm.name) return toast.error("Project and name required");
    const { error } = await supabase.from("project_tasks").upsert(taskForm as any);
    if (error) return toast.error(error.message);
    toast.success("Task saved"); setTaskDlg(false); setTaskForm({ budget_amount: 0, progress_pct: 0, status: "open" }); loadAll();
  };
  const saveTxn = async () => {
    if (!txnForm.project_id || !txnForm.amount) return toast.error("Project and amount required");
    const { error } = await supabase.from("project_transactions").insert({ ...txnForm, task_id: txnForm.task_id || null });
    if (error) return toast.error(error.message);
    toast.success("Transaction posted"); setTxnDlg(false);
    setTxnForm({ txn_type: "cost", txn_date: new Date().toISOString().slice(0, 10), amount: 0, currency: "USD" }); loadAll();
  };

  const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Project & Job Costing</h1>
        <p className="text-sm text-muted-foreground">Track project budgets, actual costs, revenue and WIP</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card><CardHeader className="flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Projects</CardTitle><Briefcase className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpi.projects}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Active</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{kpi.active}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Budget</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(kpi.budget)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Actual Cost</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">{fmt(kpi.cost)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Revenue</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-green-600">{fmt(kpi.revenue)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">WIP</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(kpi.wip)}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="pnl">
        <TabsList>
          <TabsTrigger value="pnl">Project P&L</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="tasks">Tasks / WBS</TabsTrigger>
          <TabsTrigger value="txns">Transactions</TabsTrigger>
        </TabsList>

        <TabsContent value="pnl">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Code</TableHead><TableHead>Project</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Budget</TableHead><TableHead className="text-right">Actual Cost</TableHead>
                <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">WIP</TableHead><TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pnl.map(r => (
                  <TableRow key={r.project_id}>
                    <TableCell className="font-mono">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                    <TableCell className="text-right">{fmt(r.budget_amount)}</TableCell>
                    <TableCell className="text-right text-destructive">{fmt(r.actual_cost)}</TableCell>
                    <TableCell className="text-right text-green-600">{fmt(r.revenue)}</TableCell>
                    <TableCell className="text-right">{fmt(r.billed)}</TableCell>
                    <TableCell className="text-right">{fmt(r.wip)}</TableCell>
                    <TableCell className={"text-right font-medium " + (r.margin >= 0 ? "text-green-600" : "text-destructive")}>{fmt(r.margin)}</TableCell>
                    <TableCell className="text-right">{Number(r.margin_pct || 0).toFixed(2)}%</TableCell>
                  </TableRow>
                ))}
                {pnl.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No projects yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="projects" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={prjDlg} onOpenChange={setPrjDlg}>
              <DialogTrigger asChild><Button>New Project</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Project</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Code</Label><Input value={prjForm.code || ""} onChange={e => setPrjForm({ ...prjForm, code: e.target.value })} /></div>
                  <div><Label>Currency</Label><Input value={prjForm.currency || "USD"} onChange={e => setPrjForm({ ...prjForm, currency: e.target.value })} /></div>
                  <div className="col-span-2"><Label>Name</Label><Input value={prjForm.name || ""} onChange={e => setPrjForm({ ...prjForm, name: e.target.value })} /></div>
                  <div><Label>Customer</Label><Input value={prjForm.customer_name || ""} onChange={e => setPrjForm({ ...prjForm, customer_name: e.target.value })} /></div>
                  <div><Label>Manager</Label><Input value={prjForm.manager || ""} onChange={e => setPrjForm({ ...prjForm, manager: e.target.value })} /></div>
                  <div><Label>Budget</Label><Input type="number" value={prjForm.budget_amount ?? 0} onChange={e => setPrjForm({ ...prjForm, budget_amount: Number(e.target.value) })} /></div>
                  <div><Label>Status</Label>
                    <Select value={prjForm.status || "planned"} onValueChange={v => setPrjForm({ ...prjForm, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["planned","active","on_hold","completed","cancelled"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Start</Label><DateInput  value={prjForm.start_date || ""} onChange={e => setPrjForm({ ...prjForm, start_date: e.target.value })} /></div>
                  <div><Label>End</Label><DateInput  value={prjForm.end_date || ""} onChange={e => setPrjForm({ ...prjForm, end_date: e.target.value })} /></div>
                  <div className="col-span-2"><Label>Notes</Label><Textarea value={prjForm.notes || ""} onChange={e => setPrjForm({ ...prjForm, notes: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={saveProject}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Customer</TableHead><TableHead>Manager</TableHead><TableHead className="text-right">Budget</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {projects.map(p => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => { setPrjForm(p); setPrjDlg(true); }}>
                    <TableCell className="font-mono">{p.code}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.customer_name}</TableCell>
                    <TableCell>{p.manager}</TableCell>
                    <TableCell className="text-right">{fmt(p.budget_amount)}</TableCell>
                    <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {projects.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No projects yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={taskDlg} onOpenChange={setTaskDlg}>
              <DialogTrigger asChild><Button>New Task</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Task / WBS</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2"><Label>Project</Label>
                    <Select value={taskForm.project_id} onValueChange={v => setTaskForm({ ...taskForm, project_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Task Code</Label><Input value={taskForm.code || ""} onChange={e => setTaskForm({ ...taskForm, code: e.target.value })} /></div>
                  <div><Label>Status</Label>
                    <Select value={taskForm.status || "open"} onValueChange={v => setTaskForm({ ...taskForm, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{["open","in_progress","completed","cancelled"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2"><Label>Name</Label><Input value={taskForm.name || ""} onChange={e => setTaskForm({ ...taskForm, name: e.target.value })} /></div>
                  <div><Label>Budget</Label><Input type="number" value={taskForm.budget_amount ?? 0} onChange={e => setTaskForm({ ...taskForm, budget_amount: Number(e.target.value) })} /></div>
                  <div><Label>Progress %</Label><Input type="number" value={taskForm.progress_pct ?? 0} onChange={e => setTaskForm({ ...taskForm, progress_pct: Number(e.target.value) })} /></div>
                </div>
                <DialogFooter><Button onClick={saveTask}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Code</TableHead><TableHead>Task</TableHead><TableHead className="text-right">Budget</TableHead><TableHead className="text-right">Progress</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {tasks.map(t => {
                  const p = projects.find(x => x.id === t.project_id);
                  return (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => { setTaskForm(t); setTaskDlg(true); }}>
                      <TableCell>{p?.code} — {p?.name}</TableCell>
                      <TableCell className="font-mono">{t.code}</TableCell>
                      <TableCell>{t.name}</TableCell>
                      <TableCell className="text-right">{fmt(t.budget_amount)}</TableCell>
                      <TableCell className="text-right">{Number(t.progress_pct).toFixed(1)}%</TableCell>
                      <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                    </TableRow>
                  );
                })}
                {tasks.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No tasks yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="txns" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={txnDlg} onOpenChange={setTxnDlg}>
              <DialogTrigger asChild><Button>Post Transaction</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Project Transaction</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2"><Label>Project</Label>
                    <Select value={txnForm.project_id} onValueChange={v => setTxnForm({ ...txnForm, project_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2"><Label>Task (optional)</Label>
                    <Select value={txnForm.task_id || ""} onValueChange={v => setTxnForm({ ...txnForm, task_id: v || null })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>{tasks.filter(t => t.project_id === txnForm.project_id).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Type</Label>
                    <Select value={txnForm.txn_type} onValueChange={v => setTxnForm({ ...txnForm, txn_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cost">Cost</SelectItem>
                        <SelectItem value="revenue">Revenue (earned)</SelectItem>
                        <SelectItem value="billed">Billed</SelectItem>
                        <SelectItem value="wip">WIP adjustment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Date</Label><DateInput  value={txnForm.txn_date} onChange={e => setTxnForm({ ...txnForm, txn_date: e.target.value })} /></div>
                  <div><Label>Amount</Label><Input type="number" value={txnForm.amount} onChange={e => setTxnForm({ ...txnForm, amount: Number(e.target.value) })} /></div>
                  <div><Label>Currency</Label><Input value={txnForm.currency} onChange={e => setTxnForm({ ...txnForm, currency: e.target.value })} /></div>
                  <div className="col-span-2"><Label>Description</Label><Input value={txnForm.description || ""} onChange={e => setTxnForm({ ...txnForm, description: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={saveTxn}>Post</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Project</TableHead><TableHead>Task</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Description</TableHead></TableRow></TableHeader>
              <TableBody>
                {txns.map(t => {
                  const p = projects.find(x => x.id === t.project_id);
                  const tk = tasks.find(x => x.id === t.task_id);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>{t.txn_date}</TableCell>
                      <TableCell>{p?.code}</TableCell>
                      <TableCell>{tk?.name}</TableCell>
                      <TableCell><Badge variant="outline">{t.txn_type}</Badge></TableCell>
                      <TableCell className="text-right">{fmt(t.amount)} {t.currency}</TableCell>
                      <TableCell className="text-muted-foreground">{t.description}</TableCell>
                    </TableRow>
                  );
                })}
                {txns.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No transactions yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
