import { useEffect, useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Clock, CheckCircle2, DollarSign, Plus, Trash2 } from "lucide-react";

type TS = { id: string; employee_name: string; week_start: string; week_end: string; status: string; total_hours: number; billable_hours: number; total_cost: number; billable_amount: number; currency: string };
type Entry = { id: string; timesheet_id: string; entry_date: string; project_id: string | null; task_id: string | null; hours: number; is_billable: boolean; hourly_cost_rate: number; hourly_bill_rate: number; cost_amount: number; bill_amount: number; description: string | null };
type Project = { id: string; code: string; name: string };
type Task = { id: string; project_id: string; name: string };

const monday = (d: Date) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x.toISOString().slice(0, 10); };
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function TimesheetsPage() {
  const [sheets, setSheets] = useState<TS[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<TS | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dlg, setDlg] = useState(false);
  const [newTs, setNewTs] = useState<any>({ employee_name: "", week_start: monday(new Date()), currency: "USD" });

  const loadSheets = async () => {
    const { data } = await supabase.from("timesheets").select("*").order("week_start", { ascending: false });
    if (data) setSheets(data as any);
  };
  const loadEntries = async (id: string) => {
    const { data } = await supabase.from("timesheet_entries").select("*").eq("timesheet_id", id).order("entry_date");
    if (data) setEntries(data as any);
  };
  useEffect(() => {
    loadSheets();
    supabase.from("projects").select("id,code,name").order("code").then(({ data }) => data && setProjects(data as any));
    supabase.from("project_tasks").select("id,project_id,name").then(({ data }) => data && setTasks(data as any));
  }, []);
  useEffect(() => { if (selected) loadEntries(selected.id); else setEntries([]); }, [selected?.id]);

  const kpi = useMemo(() => ({
    open: sheets.filter(s => s.status === "draft" || s.status === "submitted").length,
    approved: sheets.filter(s => s.status === "approved" || s.status === "posted").length,
    hours: sheets.reduce((a, s) => a + Number(s.total_hours || 0), 0),
    billable: sheets.reduce((a, s) => a + Number(s.billable_amount || 0), 0),
  }), [sheets]);

  const createTs = async () => {
    if (!newTs.employee_name || !newTs.week_start) return toast.error("Employee and week required");
    const end = addDays(newTs.week_start, 6);
    const { data, error } = await supabase.from("timesheets").insert({ ...newTs, week_end: end }).select().single();
    if (error) return toast.error(error.message);
    toast.success("Timesheet created"); setDlg(false); setNewTs({ employee_name: "", week_start: monday(new Date()), currency: "USD" });
    await loadSheets(); setSelected(data as any);
  };

  const addEntry = async () => {
    if (!selected) return;
    const { error } = await supabase.from("timesheet_entries").insert({ timesheet_id: selected.id, entry_date: selected.week_start, hours: 0, is_billable: true, hourly_cost_rate: 0, hourly_bill_rate: 0 });
    if (error) return toast.error(error.message);
    loadEntries(selected.id); loadSheets();
  };
  const updateEntry = async (id: string, patch: Partial<Entry>) => {
    const { error } = await supabase.from("timesheet_entries").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    loadEntries(selected!.id); loadSheets();
  };
  const deleteEntry = async (id: string) => {
    await supabase.from("timesheet_entries").delete().eq("id", id);
    loadEntries(selected!.id); loadSheets();
  };

  const setStatus = async (status: string) => {
    if (!selected) return;
    const patch: any = { status };
    if (status === "submitted") patch.submitted_at = new Date().toISOString();
    if (status === "approved") patch.approved_at = new Date().toISOString();
    const { error } = await supabase.from("timesheets").update(patch).eq("id", selected.id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${status}`); loadSheets();
    const { data } = await supabase.from("timesheets").select("*").eq("id", selected.id).single();
    if (data) setSelected(data as any);
  };
  const postToProject = async () => {
    if (!selected) return;
    const { data, error } = await supabase.rpc("post_timesheet_to_project", { _timesheet_id: selected.id });
    if (error) return toast.error(error.message);
    toast.success(`Posted ${data} entries to project costing`);
    loadSheets();
    const { data: s } = await supabase.from("timesheets").select("*").eq("id", selected.id).single();
    if (s) setSelected(s as any);
  };

  const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Time & Timesheet Tracking</h1>
        <p className="text-sm text-muted-foreground">Weekly timesheets with project/task allocation, approvals, and posting to Job Costing</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Open</CardTitle><Clock className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpi.open}</div></CardContent></Card>
        <Card><CardHeader className="flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Approved/Posted</CardTitle><CheckCircle2 className="h-4 w-4 text-green-600" /></CardHeader><CardContent><div className="text-2xl font-bold text-green-600">{kpi.approved}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Hours</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(kpi.hours)}</div></CardContent></Card>
        <Card><CardHeader className="flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Billable</CardTitle><DollarSign className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(kpi.billable)}</div></CardContent></Card>
      </div>

      <Tabs value={selected ? "edit" : "list"} onValueChange={v => v === "list" && setSelected(null)}>
        <TabsList>
          <TabsTrigger value="list">Timesheets</TabsTrigger>
          {selected && <TabsTrigger value="edit">Edit: {selected.employee_name} · {selected.week_start}</TabsTrigger>}
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={dlg} onOpenChange={setDlg}>
              <DialogTrigger asChild><Button>New Timesheet</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Timesheet</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Employee</Label><Input value={newTs.employee_name} onChange={e => setNewTs({ ...newTs, employee_name: e.target.value })} /></div>
                  <div><Label>Week Starting (Mon)</Label><DateInput  value={newTs.week_start} onChange={e => setNewTs({ ...newTs, week_start: e.target.value })} /></div>
                  <div><Label>Currency</Label><Input value={newTs.currency} onChange={e => setNewTs({ ...newTs, currency: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={createTs}>Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Week</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Billable Hrs</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Billable</TableHead></TableRow></TableHeader>
              <TableBody>
                {sheets.map(s => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setSelected(s)}>
                    <TableCell>{s.employee_name}</TableCell>
                    <TableCell>{s.week_start} → {s.week_end}</TableCell>
                    <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                    <TableCell className="text-right">{fmt(s.total_hours)}</TableCell>
                    <TableCell className="text-right">{fmt(s.billable_hours)}</TableCell>
                    <TableCell className="text-right">{fmt(s.total_cost)} {s.currency}</TableCell>
                    <TableCell className="text-right">{fmt(s.billable_amount)} {s.currency}</TableCell>
                  </TableRow>
                ))}
                {sheets.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No timesheets yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {selected && (
          <TabsContent value="edit" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setSelected(null)}>← Back</Button>
              <Badge variant="outline">{selected.status}</Badge>
              <div className="flex-1" />
              {selected.status === "draft" && <Button size="sm" onClick={() => setStatus("submitted")}>Submit</Button>}
              {selected.status === "submitted" && <>
                <Button size="sm" onClick={() => setStatus("approved")}>Approve</Button>
                <Button size="sm" variant="destructive" onClick={() => setStatus("rejected")}>Reject</Button>
              </>}
              {selected.status === "approved" && <Button size="sm" onClick={postToProject}>Post to Project Costing</Button>}
            </div>

            <Card><CardContent className="pt-6">
              <div className="flex justify-end mb-3"><Button size="sm" variant="outline" onClick={addEntry}><Plus className="h-4 w-4 mr-1" />Add Row</Button></div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Project</TableHead><TableHead>Task</TableHead>
                  <TableHead className="w-24">Hours</TableHead><TableHead>Billable</TableHead>
                  <TableHead className="w-28">Cost Rate</TableHead><TableHead className="w-28">Bill Rate</TableHead>
                  <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Bill</TableHead>
                  <TableHead>Notes</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {entries.map(e => (
                    <TableRow key={e.id}>
                      <TableCell><DateInput  value={e.entry_date} onChange={ev => updateEntry(e.id, { entry_date: ev.target.value })} /></TableCell>
                      <TableCell>
                        <Select value={e.project_id || ""} onValueChange={v => updateEntry(e.id, { project_id: v, task_id: null })}>
                          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={e.task_id || ""} onValueChange={v => updateEntry(e.id, { task_id: v })}>
                          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>{tasks.filter(t => t.project_id === e.project_id).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input type="number" value={e.hours} onChange={ev => updateEntry(e.id, { hours: Number(ev.target.value) })} /></TableCell>
                      <TableCell><Switch checked={e.is_billable} onCheckedChange={v => updateEntry(e.id, { is_billable: v })} /></TableCell>
                      <TableCell><Input type="number" value={e.hourly_cost_rate} onChange={ev => updateEntry(e.id, { hourly_cost_rate: Number(ev.target.value) })} /></TableCell>
                      <TableCell><Input type="number" value={e.hourly_bill_rate} onChange={ev => updateEntry(e.id, { hourly_bill_rate: Number(ev.target.value) })} /></TableCell>
                      <TableCell className="text-right">{fmt(e.cost_amount)}</TableCell>
                      <TableCell className="text-right">{fmt(e.bill_amount)}</TableCell>
                      <TableCell><Input value={e.description || ""} onChange={ev => updateEntry(e.id, { description: ev.target.value })} /></TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => deleteEntry(e.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                  {entries.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">No entries — add rows</TableCell></TableRow>}
                </TableBody>
              </Table>
              <div className="mt-4 flex justify-end gap-6 text-sm">
                <div>Hours: <span className="font-medium">{fmt(selected.total_hours)}</span></div>
                <div>Billable Hrs: <span className="font-medium">{fmt(selected.billable_hours)}</span></div>
                <div>Cost: <span className="font-medium">{fmt(selected.total_cost)} {selected.currency}</span></div>
                <div>Bill: <span className="font-medium">{fmt(selected.billable_amount)} {selected.currency}</span></div>
              </div>
            </CardContent></Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
