// Phase 1m — Recurring Journal Entries
// Automates monthly / quarterly / annual entries (accruals, depreciation,
// prepaid amortization). Each template stores a balanced set of lines that
// are materialized into `journal_entries` + `journal_entry_lines` on demand
// via "Post Now" or whenever `next_run_date` is <= today.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Plus, Play, Pencil, Trash2, RefreshCw, Repeat, CalendarClock, CheckCircle2 } from "lucide-react";
import { format, addMonths, parseISO } from "date-fns";

type Frequency = "Monthly" | "Quarterly" | "Annual";

interface TemplateLine {
  account_id: string;
  debit: number;
  credit: number;
  description?: string;
}

interface Recurring {
  id: string;
  name: string;
  description: string | null;
  frequency: Frequency;
  day_of_month: number;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  last_run_date: string | null;
  active: boolean;
  currency: string | null;
  reference_prefix: string | null;
  template_lines: TemplateLine[];
  run_count: number;
}

interface Account { id: string; code: string; name: string; }

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function computeNextRun(from: string, freq: Frequency, dayOfMonth: number): string {
  const base = parseISO(from);
  const step = freq === "Monthly" ? 1 : freq === "Quarterly" ? 3 : 12;
  const next = addMonths(base, step);
  next.setDate(Math.min(dayOfMonth, 28));
  return next.toISOString().slice(0, 10);
}

const emptyLine = (): TemplateLine => ({ account_id: "", debit: 0, credit: 0, description: "" });

const emptyForm = {
  name: "",
  description: "",
  frequency: "Monthly" as Frequency,
  day_of_month: 1,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  next_run_date: new Date().toISOString().slice(0, 10),
  active: true,
  currency: "EGP",
  reference_prefix: "REC",
  template_lines: [emptyLine(), emptyLine()],
};

export default function RecurringJournalsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Recurring | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["recurring_journal_entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_journal_entries" as any)
        .select("*")
        .order("next_run_date", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Recurring[];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["chart_of_accounts_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chart_of_accounts" as any)
        .select("id, code, name")
        .order("code");
      if (error) throw error;
      return (data || []) as unknown as Account[];
    },
  });

  const totals = useMemo(() => {
    const debit = form.template_lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = form.template_lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 && debit > 0 };
  }, [form.template_lines]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const validLines = form.template_lines.filter(l => l.account_id && (l.debit > 0 || l.credit > 0));
      if (validLines.length < 2) throw new Error("At least 2 lines required");
      const d = validLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
      const c = validLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
      if (Math.abs(d - c) > 0.005) throw new Error("Template must be balanced");

      const payload: any = {
        name: form.name.trim(),
        description: form.description || null,
        frequency: form.frequency,
        day_of_month: form.day_of_month,
        start_date: form.start_date,
        end_date: form.end_date || null,
        next_run_date: form.next_run_date,
        active: form.active,
        currency: form.currency,
        reference_prefix: form.reference_prefix,
        template_lines: validLines,
      };

      if (editItem) {
        const { error } = await supabase
          .from("recurring_journal_entries" as any)
          .update(payload)
          .eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("recurring_journal_entries" as any)
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_journal_entries"] });
      toast({ title: editItem ? "Template updated" : "Template created" });
      setDialogOpen(false);
      setEditItem(null);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recurring_journal_entries" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_journal_entries"] });
      toast({ title: "Deleted" });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (row: Recurring) => {
      const { error } = await supabase
        .from("recurring_journal_entries" as any)
        .update({ active: !row.active })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_journal_entries"] }),
  });

  const postMutation = useMutation({
    mutationFn: async (row: Recurring) => {
      const lines = (row.template_lines || []).filter(l => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
      if (lines.length < 2) throw new Error("Template has no valid lines");
      const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
      const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.005) throw new Error("Template unbalanced");

      const runDate = row.next_run_date || new Date().toISOString().slice(0, 10);
      const entryNo = `${row.reference_prefix || "REC"}-${runDate.replace(/-/g, "")}-${String(row.run_count + 1).padStart(3, "0")}`;

      const { data: entry, error: e1 } = await supabase
        .from("journal_entries" as any)
        .insert({
          entry_no: entryNo,
          entry_date: runDate,
          description: `${row.name}${row.description ? " — " + row.description : ""}`,
          reference: row.name,
          reference_type: "Recurring",
          status: "Posted",
          total_debit: totalDebit,
          total_credit: totalCredit,
        })
        .select()
        .single();
      if (e1) throw e1;
      const entryId = (entry as any).id as string;

      const { error: e2 } = await supabase
        .from("journal_entry_lines" as any)
        .insert(lines.map((l, i) => ({
          entry_id: entryId,
          account_id: l.account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || row.name,
          sort_order: i,
        })));
      if (e2) throw e2;

      const next = computeNextRun(runDate, row.frequency, row.day_of_month);
      const stillActive = row.end_date ? next <= row.end_date : true;
      const { error: e3 } = await supabase
        .from("recurring_journal_entries" as any)
        .update({
          last_run_date: runDate,
          next_run_date: next,
          run_count: row.run_count + 1,
          active: stillActive && row.active,
        })
        .eq("id", row.id);
      if (e3) throw e3;

      return entryNo;
    },
    onSuccess: (entryNo) => {
      qc.invalidateQueries({ queryKey: ["recurring_journal_entries"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast({ title: "Journal entry posted", description: entryNo });
    },
    onError: (e: any) => toast({ title: "Post failed", description: e.message, variant: "destructive" }),
  });

  const openNew = () => { setEditItem(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (r: Recurring) => {
    setEditItem(r);
    setForm({
      name: r.name,
      description: r.description || "",
      frequency: r.frequency,
      day_of_month: r.day_of_month,
      start_date: r.start_date,
      end_date: r.end_date || "",
      next_run_date: r.next_run_date,
      active: r.active,
      currency: r.currency || "EGP",
      reference_prefix: r.reference_prefix || "REC",
      template_lines: r.template_lines?.length ? r.template_lines : [emptyLine(), emptyLine()],
    });
    setDialogOpen(true);
  };

  const updateLine = (i: number, patch: Partial<TemplateLine>) => {
    setForm(f => ({
      ...f,
      template_lines: f.template_lines.map((l, idx) => idx === i ? { ...l, ...patch } : l),
    }));
  };
  const addLine = () => setForm(f => ({ ...f, template_lines: [...f.template_lines, emptyLine()] }));
  const removeLine = (i: number) => setForm(f => ({
    ...f,
    template_lines: f.template_lines.length > 2 ? f.template_lines.filter((_, idx) => idx !== i) : f.template_lines,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const dueCount = rows.filter(r => r.active && r.next_run_date <= today).length;

  const runAllDue = async () => {
    const due = rows.filter(r => r.active && r.next_run_date <= today);
    if (!due.length) { toast({ title: "Nothing due to run" }); return; }
    for (const r of due) {
      try { await postMutation.mutateAsync(r); } catch { /* toasted */ }
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Repeat size={22} /> Recurring Journal Entries
          </h1>
          <p className="text-sm text-muted-foreground">
            Templates that auto-generate journal entries (accruals, depreciation, prepaid amortization).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={runAllDue} disabled={!dueCount}>
            <Play size={16} className="mr-1" /> Run all due ({dueCount})
          </Button>
          <Button onClick={openNew}>
            <Plus size={16} className="mr-1" /> New Template
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Active Templates</div>
          <div className="text-2xl font-semibold">{rows.filter(r => r.active).length}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Due for Posting</div>
          <div className="text-2xl font-semibold text-orange-600">{dueCount}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Total Templates</div>
          <div className="text-2xl font-semibold">{rows.length}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No recurring templates yet.</TableCell></TableRow>
              ) : rows.map(r => {
                const due = r.active && r.next_run_date <= today;
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      {r.description ? <div className="text-xs text-muted-foreground truncate max-w-xs">{r.description}</div> : null}
                    </TableCell>
                    <TableCell><Badge variant="outline">{r.frequency}</Badge></TableCell>
                    <TableCell>{r.day_of_month}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <CalendarClock size={14} className={due ? "text-orange-600" : "text-muted-foreground"} />
                        <span className={due ? "text-orange-600 font-medium" : ""}>{r.next_run_date}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.last_run_date || "—"}</TableCell>
                    <TableCell>{r.run_count}</TableCell>
                    <TableCell>
                      <Switch checked={r.active} onCheckedChange={() => toggleActive.mutate(r)} />
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant={due ? "default" : "outline"} onClick={() => postMutation.mutate(r)} disabled={postMutation.isPending}>
                        <Play size={14} className="mr-1" /> Post Now
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete "${r.name}"?`)) removeMutation.mutate(r.id); }}>
                        <Trash2 size={14} className="text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditItem(null); setForm(emptyForm); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit Recurring Template" : "New Recurring Template"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">Name *</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Monthly Depreciation" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Reference Prefix</label>
              <Input value={form.reference_prefix} onChange={e => setForm({ ...form, reference_prefix: e.target.value })} />
            </div>
            <div className="col-span-3">
              <label className="text-xs text-muted-foreground">Description</label>
              <Textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Frequency</label>
              <Select value={form.frequency} onValueChange={(v: Frequency) => setForm({ ...form, frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Monthly">Monthly</SelectItem>
                  <SelectItem value="Quarterly">Quarterly</SelectItem>
                  <SelectItem value="Annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Day of Month (1–28)</label>
              <Input type="number" min={1} max={28} value={form.day_of_month} onChange={e => setForm({ ...form, day_of_month: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Currency</label>
              <Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Start Date</label>
              <DateInput  value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Next Run Date</label>
              <DateInput  value={form.next_run_date} onChange={e => setForm({ ...form, next_run_date: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End Date (optional)</label>
              <DateInput  value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <span className="text-sm">Active</span>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-sm">Template Lines</div>
              <Button size="sm" variant="outline" onClick={addLine}><Plus size={14} className="mr-1" /> Add Line</Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="w-28 text-right">Debit</TableHead>
                  <TableHead className="w-28 text-right">Credit</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.template_lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select value={l.account_id} onValueChange={(v) => updateLine(i, { account_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {accounts.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="0.01" className="text-right" value={l.debit || ""} onChange={e => updateLine(i, { debit: Number(e.target.value) || 0, credit: Number(e.target.value) > 0 ? 0 : l.credit })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="0.01" className="text-right" value={l.credit || ""} onChange={e => updateLine(i, { credit: Number(e.target.value) || 0, debit: Number(e.target.value) > 0 ? 0 : l.debit })} />
                    </TableCell>
                    <TableCell>
                      <Input value={l.description || ""} onChange={e => updateLine(i, { description: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => removeLine(i)} disabled={form.template_lines.length <= 2}>
                        <Trash2 size={14} className="text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium bg-muted/40">
                  <TableCell className="text-right">Totals</TableCell>
                  <TableCell className="text-right">{fmt(totals.debit)}</TableCell>
                  <TableCell className="text-right">{fmt(totals.credit)}</TableCell>
                  <TableCell colSpan={2}>
                    {totals.balanced ? (
                      <span className="text-green-600 text-sm flex items-center gap-1"><CheckCircle2 size={14} /> Balanced</span>
                    ) : (
                      <span className="text-red-600 text-sm">Difference: {fmt(totals.debit - totals.credit)}</span>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!totals.balanced || !form.name.trim() || saveMutation.isPending}>
              {saveMutation.isPending ? <RefreshCw size={14} className="mr-1 animate-spin" /> : null}
              {editItem ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
