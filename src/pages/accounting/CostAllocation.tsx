// Cost Allocation & Overhead Distribution (Phase 2e)
// -------------------------------------------------------------
// Define reusable rules that distribute a shared cost across target
// companies/cost-centers by fixed percentage or driver-based weights,
// then post a run for a period which generates a balanced journal entry
// (Cr source account / Dr each target's account by its share).

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
import { Plus, Download, Trash2, Play, Split } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format } from "date-fns";

const METHODS = [
  { value: "percentage", label: "Fixed Percentage" },
  { value: "equal", label: "Equal Split" },
  { value: "headcount", label: "Weighted (Headcount)" },
  { value: "revenue", label: "Weighted (Revenue)" },
  { value: "flights", label: "Weighted (Flights)" },
] as const;

interface RuleLine {
  id?: string;
  rule_id?: string;
  target_company: string;
  target_cost_center: string | null;
  target_account_code: string | null;
  weight: number;
  percentage: number | null;
}

interface Rule {
  id: string;
  name: string;
  description: string | null;
  source_company: string | null;
  source_account_code: string;
  method: string;
  driver: string | null;
  active: boolean;
  created_at: string;
  cost_allocation_rule_lines?: RuleLine[];
}

interface Run {
  id: string;
  rule_id: string;
  period: string;
  source_amount: number;
  currency: string;
  status: string;
  journal_entry_id: string | null;
  distribution: any;
  notes: string | null;
  created_at: string;
  cost_allocation_rules?: { name: string } | null;
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function lastOfMonth(iso: string) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export default function CostAllocationPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("rules");
  const [ruleDialog, setRuleDialog] = useState(false);
  const [runDialog, setRunDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["cost-allocation-rules"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_allocation_rules")
        .select("*, cost_allocation_rule_lines(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Rule[];
    },
  });

  const runsQuery = useQuery({
    queryKey: ["cost-allocation-runs"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_allocation_runs")
        .select("*, cost_allocation_rules(name)")
        .order("period", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Run[];
    },
  });

  const companiesQuery = useQuery({
    queryKey: ["companies-lite"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const rules = rulesQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const companies = companiesQuery.data ?? [];

  // ---------- Rule form ----------
  const emptyRule = {
    name: "", description: "", source_company: "", source_account_code: "",
    method: "percentage", driver: "", active: true,
    lines: [{ target_company: "", target_cost_center: "", target_account_code: "", weight: 0, percentage: 0 }] as RuleLine[],
  };
  const [ruleForm, setRuleForm] = useState<typeof emptyRule>(emptyRule);

  const openRuleDialog = (rule?: Rule) => {
    if (rule) {
      setEditingRule(rule);
      setRuleForm({
        name: rule.name,
        description: rule.description ?? "",
        source_company: rule.source_company ?? "",
        source_account_code: rule.source_account_code,
        method: rule.method,
        driver: rule.driver ?? "",
        active: rule.active,
        lines: (rule.cost_allocation_rule_lines ?? []).map(l => ({
          target_company: l.target_company,
          target_cost_center: l.target_cost_center,
          target_account_code: l.target_account_code,
          weight: Number(l.weight ?? 0),
          percentage: l.percentage == null ? 0 : Number(l.percentage),
        })),
      });
    } else {
      setEditingRule(null);
      setRuleForm(emptyRule);
    }
    setRuleDialog(true);
  };

  const saveRule = useMutation({
    mutationFn: async () => {
      if (!ruleForm.name.trim()) throw new Error("Rule name is required");
      if (!ruleForm.source_account_code.trim()) throw new Error("Source account code is required");
      if (!ruleForm.lines.length) throw new Error("Add at least one target line");
      if (ruleForm.method === "percentage") {
        const total = ruleForm.lines.reduce((s, l) => s + Number(l.percentage ?? 0), 0);
        if (Math.abs(total - 100) > 0.01) throw new Error(`Percentages must sum to 100 (currently ${total.toFixed(2)})`);
      } else {
        const total = ruleForm.lines.reduce((s, l) => s + Number(l.weight ?? 0), 0);
        if (total <= 0) throw new Error("Total weight must be greater than zero");
      }
      for (const l of ruleForm.lines) {
        if (!l.target_company?.trim()) throw new Error("Every line needs a target company");
      }

      let ruleId = editingRule?.id;
      const payload = {
        name: ruleForm.name.trim(),
        description: ruleForm.description || null,
        source_company: ruleForm.source_company || null,
        source_account_code: ruleForm.source_account_code.trim(),
        method: ruleForm.method,
        driver: ruleForm.driver || null,
        active: ruleForm.active,
      };
      if (ruleId) {
        const { error } = await supabase.from("cost_allocation_rules").update(payload).eq("id", ruleId);
        if (error) throw error;
        await supabase.from("cost_allocation_rule_lines").delete().eq("rule_id", ruleId);
      } else {
        const { data, error } = await supabase.from("cost_allocation_rules")
          .insert({ ...payload, created_by: session?.user?.id })
          .select("id").single();
        if (error) throw error;
        ruleId = data.id;
      }
      const lines = ruleForm.lines.map(l => ({
        rule_id: ruleId!,
        target_company: l.target_company.trim(),
        target_cost_center: l.target_cost_center || null,
        target_account_code: l.target_account_code || null,
        weight: Number(l.weight ?? 0),
        percentage: ruleForm.method === "percentage" ? Number(l.percentage ?? 0) : null,
      }));
      const { error: linesErr } = await supabase.from("cost_allocation_rule_lines").insert(lines);
      if (linesErr) throw linesErr;
    },
    onSuccess: () => {
      toast.success(editingRule ? "Rule updated" : "Rule created");
      qc.invalidateQueries({ queryKey: ["cost-allocation-rules"] });
      setRuleDialog(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save rule"),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cost_allocation_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rule deleted");
      qc.invalidateQueries({ queryKey: ["cost-allocation-rules"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  // ---------- Run form ----------
  const [runForm, setRunForm] = useState({
    rule_id: "",
    period: firstOfMonth(),
    source_amount: 0,
    currency: "EGP",
    notes: "",
  });

  const distributionPreview = useMemo(() => {
    const rule = rules.find(r => r.id === runForm.rule_id);
    if (!rule) return [];
    const lines = rule.cost_allocation_rule_lines ?? [];
    const amount = Number(runForm.source_amount) || 0;
    if (rule.method === "percentage") {
      return lines.map(l => ({
        target_company: l.target_company,
        target_cost_center: l.target_cost_center,
        target_account_code: l.target_account_code,
        share_pct: Number(l.percentage ?? 0),
        share_amount: +(amount * (Number(l.percentage ?? 0) / 100)).toFixed(2),
      }));
    }
    if (rule.method === "equal") {
      const n = lines.length || 1;
      const each = +(amount / n).toFixed(2);
      return lines.map(l => ({
        target_company: l.target_company,
        target_cost_center: l.target_cost_center,
        target_account_code: l.target_account_code,
        share_pct: +(100 / n).toFixed(2),
        share_amount: each,
      }));
    }
    const totalW = lines.reduce((s, l) => s + Number(l.weight ?? 0), 0) || 1;
    return lines.map(l => ({
      target_company: l.target_company,
      target_cost_center: l.target_cost_center,
      target_account_code: l.target_account_code,
      share_pct: +((Number(l.weight ?? 0) / totalW) * 100).toFixed(2),
      share_amount: +(amount * (Number(l.weight ?? 0) / totalW)).toFixed(2),
    }));
  }, [rules, runForm.rule_id, runForm.source_amount]);

  const postRun = useMutation({
    mutationFn: async () => {
      const rule = rules.find(r => r.id === runForm.rule_id);
      if (!rule) throw new Error("Select a rule");
      if (!(runForm.source_amount > 0)) throw new Error("Source amount must be greater than zero");
      const periodEnd = lastOfMonth(runForm.period);

      // Build balanced JE: credit source, debit each target's share
      const jeLines: any[] = [{
        account_code: rule.source_account_code,
        description: `Allocation source · ${rule.name}`,
        debit: 0,
        credit: Number(runForm.source_amount),
      }];
      let debitSum = 0;
      distributionPreview.forEach(d => {
        debitSum += d.share_amount;
        jeLines.push({
          account_code: d.target_account_code || rule.source_account_code,
          description: `Allocated to ${d.target_company}${d.target_cost_center ? ` · ${d.target_cost_center}` : ""}`,
          debit: d.share_amount,
          credit: 0,
        });
      });
      // Rounding balance – tweak last debit if fractional drift.
      const diff = +(Number(runForm.source_amount) - debitSum).toFixed(2);
      if (Math.abs(diff) >= 0.01 && jeLines.length > 1) {
        jeLines[jeLines.length - 1].debit = +(jeLines[jeLines.length - 1].debit + diff).toFixed(2);
      }

      const stamp = Date.now().toString(36).toUpperCase();
      const { data: je, error: jeErr } = await supabase.from("journal_entries").insert({
        entry_no: `JE-ALLOC-${stamp}`,
        entry_date: periodEnd,
        reference: `ALLOC-${rule.name}-${runForm.period.slice(0, 7)}`,
        description: runForm.notes || `Cost allocation · ${rule.name} · ${format(new Date(periodEnd), "MMM yyyy")}`,
        status: "Posted",
        posted_at: new Date().toISOString(),
        created_by: session?.user?.id,
      }).select("id").single();
      if (jeErr) throw jeErr;

      const linesPayload = jeLines.map(l => ({ entry_id: je.id, ...l }));
      const { error: linesErr } = await supabase.from("journal_entry_lines").insert(linesPayload);
      if (linesErr) throw linesErr;

      const { error: runErr } = await supabase.from("cost_allocation_runs").insert({
        rule_id: rule.id,
        period: periodEnd,
        source_amount: Number(runForm.source_amount),
        currency: runForm.currency,
        status: "Posted",
        journal_entry_id: je.id,
        distribution: distributionPreview,
        notes: runForm.notes || null,
        created_by: session?.user?.id,
      });
      if (runErr) throw runErr;
    },
    onSuccess: () => {
      toast.success("Allocation posted");
      qc.invalidateQueries({ queryKey: ["cost-allocation-runs"] });
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      setRunDialog(false);
      setTab("runs");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to post allocation"),
  });

  // ---------- Rule form helpers ----------
  const addLine = () => setRuleForm(f => ({
    ...f,
    lines: [...f.lines, { target_company: "", target_cost_center: "", target_account_code: "", weight: 0, percentage: 0 }],
  }));
  const removeLine = (idx: number) => setRuleForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  const updateLine = (idx: number, patch: Partial<RuleLine>) => setRuleForm(f => ({
    ...f,
    lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l),
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Split className="h-6 w-6" /> Cost Allocation</h1>
          <p className="text-sm text-muted-foreground">Distribute shared overhead across companies and cost centers.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openRuleDialog()}><Plus className="h-4 w-4 mr-1" />New Rule</Button>
          <Button onClick={() => { setRunForm({ rule_id: "", period: firstOfMonth(), source_amount: 0, currency: "EGP", notes: "" }); setRunDialog(true); }}>
            <Play className="h-4 w-4 mr-1" />Post Allocation
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader><CardTitle className="text-sm">Active Rules</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{rules.filter(r => r.active).length}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Total Rules</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{rules.length}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Runs Posted</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{runs.filter(r => r.status === "Posted").length}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Allocated (posted)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">
            {runs.filter(r => r.status === "Posted").reduce((s, r) => s + Number(r.source_amount || 0), 0).toLocaleString()}
          </CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="runs">Run History</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportToExcel(rules.map(r => ({
              Name: r.name, Method: r.method, Source: r.source_account_code, Active: r.active, Lines: r.cost_allocation_rule_lines?.length ?? 0,
            })), "AllocationRules", "cost-allocation-rules")}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Name</TableHead><TableHead>Method</TableHead><TableHead>Source Acct</TableHead>
                <TableHead>Targets</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rules.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{r.method}</Badge></TableCell>
                    <TableCell>{r.source_account_code}</TableCell>
                    <TableCell>{r.cost_allocation_rule_lines?.length ?? 0}</TableCell>
                    <TableCell>{r.active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openRuleDialog(r)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm("Delete this rule?")) deleteRule.mutate(r.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rules.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No rules yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="runs" className="space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportToExcel(runs.map(r => ({
              Rule: r.cost_allocation_rules?.name, Period: r.period, Amount: r.source_amount, Currency: r.currency, Status: r.status,
            })), "AllocationRuns", "cost-allocation-runs")}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Period</TableHead><TableHead>Rule</TableHead><TableHead>Amount</TableHead>
                <TableHead>Currency</TableHead><TableHead>Status</TableHead><TableHead>Posted</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {runs.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{format(new Date(r.period), "MMM yyyy")}</TableCell>
                    <TableCell>{r.cost_allocation_rules?.name}</TableCell>
                    <TableCell>{Number(r.source_amount).toLocaleString()}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell><Badge variant={r.status === "Posted" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell>{format(new Date(r.created_at), "dd/MM/yyyy")}</TableCell>
                  </TableRow>
                ))}
                {!runs.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No runs yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Rule dialog */}
      <Dialog open={ruleDialog} onOpenChange={setRuleDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingRule ? "Edit Rule" : "New Allocation Rule"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Name</Label><Input value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} /></div>
              <div><Label>Method</Label>
                <Select value={ruleForm.method} onValueChange={v => setRuleForm({ ...ruleForm, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Source Company (optional)</Label>
                <Select value={ruleForm.source_company || "none"} onValueChange={v => setRuleForm({ ...ruleForm, source_company: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any</SelectItem>
                    {companies.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Source Account Code</Label>
                <Input value={ruleForm.source_account_code} onChange={e => setRuleForm({ ...ruleForm, source_account_code: e.target.value })} placeholder="e.g. 5900" />
              </div>
              <div className="col-span-2"><Label>Description</Label>
                <Textarea value={ruleForm.description} onChange={e => setRuleForm({ ...ruleForm, description: e.target.value })} rows={2} />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>Targets</Label>
                <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-4 w-4 mr-1" />Add Line</Button>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Company</TableHead><TableHead>Cost Center</TableHead>
                  <TableHead>Debit Account</TableHead>
                  <TableHead>{ruleForm.method === "percentage" ? "%" : "Weight"}</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {ruleForm.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Select value={l.target_company || "none"} onValueChange={v => updateLine(i, { target_company: v === "none" ? "" : v })}>
                          <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">—</SelectItem>
                            {companies.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input value={l.target_cost_center ?? ""} onChange={e => updateLine(i, { target_cost_center: e.target.value })} /></TableCell>
                      <TableCell><Input value={l.target_account_code ?? ""} onChange={e => updateLine(i, { target_account_code: e.target.value })} placeholder="Optional" /></TableCell>
                      <TableCell>
                        {ruleForm.method === "percentage"
                          ? <Input type="number" value={l.percentage ?? 0} onChange={e => updateLine(i, { percentage: Number(e.target.value) })} />
                          : <Input type="number" value={l.weight ?? 0} onChange={e => updateLine(i, { weight: Number(e.target.value) })} />}
                      </TableCell>
                      <TableCell><Button variant="ghost" size="sm" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleDialog(false)}>Cancel</Button>
            <Button onClick={() => saveRule.mutate()} disabled={saveRule.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run dialog */}
      <Dialog open={runDialog} onOpenChange={setRunDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Post Cost Allocation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Rule</Label>
              <Select value={runForm.rule_id} onValueChange={v => setRunForm({ ...runForm, rule_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select rule" /></SelectTrigger>
                <SelectContent>{rules.filter(r => r.active).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Period (month)</Label><DateInput  value={runForm.period} onChange={e => setRunForm({ ...runForm, period: e.target.value })} /></div>
              <div><Label>Source Amount</Label><Input type="number" value={runForm.source_amount} onChange={e => setRunForm({ ...runForm, source_amount: Number(e.target.value) })} /></div>
              <div><Label>Currency</Label><Input value={runForm.currency} onChange={e => setRunForm({ ...runForm, currency: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={runForm.notes} onChange={e => setRunForm({ ...runForm, notes: e.target.value })} rows={2} /></div>

            {!!distributionPreview.length && (
              <div>
                <Label>Preview</Label>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Company</TableHead><TableHead>Cost Center</TableHead>
                    <TableHead>Debit Acct</TableHead><TableHead>Share %</TableHead><TableHead>Amount</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {distributionPreview.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell>{d.target_company}</TableCell>
                        <TableCell>{d.target_cost_center ?? "—"}</TableCell>
                        <TableCell>{d.target_account_code ?? "—"}</TableCell>
                        <TableCell>{d.share_pct.toFixed(2)}%</TableCell>
                        <TableCell>{d.share_amount.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunDialog(false)}>Cancel</Button>
            <Button onClick={() => postRun.mutate()} disabled={postRun.isPending}>Post</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
