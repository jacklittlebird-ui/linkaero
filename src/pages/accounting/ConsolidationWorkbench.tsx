// Consolidation Workbench (Phase 2j)
// -------------------------------------------------------------
// - Create period-scoped consolidation runs
// - Auto-suggest inter-company eliminations from intercompany_transactions
// - Track elimination entries (IC AR/AP, revenue/expense, investment/equity)
// - Non-controlling (minority) interest table per subsidiary
// - Consolidated summary view
import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Wand2, Lock, Download, Building2, ArrowRightLeft, Percent } from "lucide-react";
import { format } from "date-fns";
import { exportToExcel } from "@/lib/exportExcel";
import { toast } from "sonner";

const ELIM_TYPES: Record<string, string> = {
  ic_ar_ap: "IC AR/AP",
  ic_revenue_expense: "IC Revenue/Expense",
  investment_equity: "Investment ↔ Equity",
  unrealized_profit: "Unrealized Profit",
  other: "Other",
};

const money = (n: number, c = "EGP") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: c || "EGP" }).format(n || 0);

export default function ConsolidationWorkbenchPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [tab, setTab] = useState("eliminations");
  const [createOpen, setCreateOpen] = useState(false);
  const [newRun, setNewRun] = useState({ run_no: "", period_start: "", period_end: "" });
  const [miDialogOpen, setMiDialogOpen] = useState(false);
  const [miDraft, setMiDraft] = useState<any>({ subsidiary_company_id: "", ownership_pct: 100, subsidiary_net_income: 0, subsidiary_equity: 0 });

  const companiesQ = useQuery({
    queryKey: ["companies"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, code, name, is_headquarters").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const runsQ = useQuery({
    queryKey: ["consolidation_runs"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.from("consolidation_runs").select("*").order("period_end", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const run = runsQ.data?.find((r: any) => r.id === runId) || null;

  const elimsQ = useQuery({
    queryKey: ["elimination_entries", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase.from("elimination_entries").select("*").eq("run_id", runId).order("created_at");
      if (error) throw error;
      return data || [];
    },
  });

  const miQ = useQuery({
    queryKey: ["minority_interests", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase.from("minority_interests").select("*").eq("run_id", runId);
      if (error) throw error;
      return data || [];
    },
  });

  const suggestionsQ = useQuery({
    queryKey: ["ic_suggestions", run?.period_start, run?.period_end],
    enabled: !!run,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("suggest_ic_eliminations", {
        _from: run.period_start,
        _to: run.period_end,
      });
      if (error) throw error;
      return data || [];
    },
  });

  const createRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("consolidation_runs").insert({
        run_no: newRun.run_no || `CONS-${Date.now()}`,
        period_start: newRun.period_start,
        period_end: newRun.period_end,
      }).select("*").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (r: any) => {
      toast.success("Run created");
      setRunId(r.id);
      setCreateOpen(false);
      setNewRun({ run_no: "", period_start: "", period_end: "" });
      qc.invalidateQueries({ queryKey: ["consolidation_runs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addElim = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.from("elimination_entries").insert({ ...row, run_id: runId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Elimination added");
      qc.invalidateQueries({ queryKey: ["elimination_entries", runId] });
      recalcTotals();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delElim = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("elimination_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["elimination_entries", runId] });
      recalcTotals();
    },
  });

  const upsertMI = useMutation({
    mutationFn: async () => {
      const minority_pct = 100 - Number(miDraft.ownership_pct || 0);
      const mi_amount = (Number(miDraft.subsidiary_equity || 0) * minority_pct) / 100;
      const { error } = await supabase.from("minority_interests").upsert({
        run_id: runId,
        subsidiary_company_id: miDraft.subsidiary_company_id,
        ownership_pct: miDraft.ownership_pct,
        minority_pct,
        subsidiary_net_income: miDraft.subsidiary_net_income,
        subsidiary_equity: miDraft.subsidiary_equity,
        minority_interest_amount: mi_amount,
      }, { onConflict: "run_id,subsidiary_company_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Minority interest saved");
      setMiDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["minority_interests", runId] });
      recalcTotals();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delMI = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("minority_interests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["minority_interests", runId] });
      recalcTotals();
    },
  });

  const finalizeRun = useMutation({
    mutationFn: async () => {
      if (!runId) return;
      const { error } = await supabase.from("consolidation_runs").update({
        status: "finalized",
        finalized_at: new Date().toISOString(),
      }).eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Run finalized");
      qc.invalidateQueries({ queryKey: ["consolidation_runs"] });
    },
  });

  async function recalcTotals() {
    if (!runId) return;
    const [{ data: elims }, { data: mis }] = await Promise.all([
      supabase.from("elimination_entries").select("amount").eq("run_id", runId),
      supabase.from("minority_interests").select("minority_interest_amount").eq("run_id", runId),
    ]);
    const total_elim = (elims || []).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const total_mi = (mis || []).reduce((s: number, m: any) => s + Number(m.minority_interest_amount || 0), 0);
    await supabase.from("consolidation_runs").update({
      total_elimination: total_elim,
      total_minority_interest: total_mi,
    }).eq("id", runId);
    qc.invalidateQueries({ queryKey: ["consolidation_runs"] });
  }

  const companyName = (id?: string | null) =>
    companiesQ.data?.find((c: any) => c.id === id)?.name || (id ? id.slice(0, 6) : "—");

  const applySuggestion = (s: any) => {
    addElim.mutate({
      entry_type: "ic_ar_ap",
      from_company_id: s.from_company_id,
      to_company_id: s.to_company_id,
      amount: s.base_amount || s.amount,
      currency: s.currency,
      ic_transaction_id: s.ic_id,
      description: `IC elim: ${s.ic_no} · ${s.description || ""}`,
    });
  };

  const applyAllSuggestions = async () => {
    const rows = (suggestionsQ.data || []).map((s: any) => ({
      run_id: runId,
      entry_type: "ic_ar_ap",
      from_company_id: s.from_company_id,
      to_company_id: s.to_company_id,
      amount: s.base_amount || s.amount,
      currency: s.currency,
      ic_transaction_id: s.ic_id,
      description: `IC elim: ${s.ic_no}`,
    }));
    if (!rows.length) return;
    const { error } = await supabase.from("elimination_entries").insert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success(`Applied ${rows.length} eliminations`);
    qc.invalidateQueries({ queryKey: ["elimination_entries", runId] });
    recalcTotals();
  };

  const totalElim = useMemo(() => (elimsQ.data || []).reduce((s: number, e: any) => s + Number(e.amount || 0), 0), [elimsQ.data]);
  const totalMI = useMemo(() => (miQ.data || []).reduce((s: number, m: any) => s + Number(m.minority_interest_amount || 0), 0), [miQ.data]);
  const locked = run?.status === "finalized";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Consolidation Workbench</h1>
          <p className="text-sm text-muted-foreground">Multi-company elimination entries, minority interest & inter-company reconciliation.</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={runId || ""} onValueChange={setRunId}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Select consolidation run" /></SelectTrigger>
            <SelectContent>
              {(runsQ.data || []).map((r: any) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.run_no} · {r.period_start} → {r.period_end} {r.status === "finalized" ? "🔒" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Run</Button>
        </div>
      </div>

      {run && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-4 flex items-center gap-3"><Building2 className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Companies</div><div className="text-lg font-semibold">{companiesQ.data?.length || 0}</div></div></CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3"><ArrowRightLeft className="h-5 w-5" /><div><div className="text-xs text-muted-foreground">Eliminations</div><div className="text-lg font-semibold">{money(totalElim, run.base_currency)}</div></div></CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3"><Percent className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Minority Interest</div><div className="text-lg font-semibold">{money(totalMI, run.base_currency)}</div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Status</div><Badge variant={locked ? "secondary" : "default"}>{run.status}</Badge>{!locked && <Button size="sm" className="mt-2 w-full" onClick={() => finalizeRun.mutate()}><Lock className="h-4 w-4 mr-1" /> Finalize</Button>}</CardContent></Card>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="eliminations">Eliminations ({elimsQ.data?.length || 0})</TabsTrigger>
              <TabsTrigger value="suggestions">IC Suggestions ({suggestionsQ.data?.length || 0})</TabsTrigger>
              <TabsTrigger value="minority">Minority Interest ({miQ.data?.length || 0})</TabsTrigger>
            </TabsList>

            <TabsContent value="eliminations">
              <div className="flex justify-end mb-2 gap-2">
                <Button variant="outline" size="sm" disabled={locked} onClick={() => addElim.mutate({ entry_type: "other", amount: 0, currency: run.base_currency, description: "Manual" })}>
                  <Plus className="h-4 w-4 mr-1" /> Add manual
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportToExcel(
                  (elimsQ.data || []).map((e: any) => ({
                    Type: ELIM_TYPES[e.entry_type],
                    From: companyName(e.from_company_id),
                    To: companyName(e.to_company_id),
                    Amount: e.amount,
                    Currency: e.currency,
                    Description: e.description,
                  })), "Eliminations", `eliminations_${run.run_no}.xlsx`
                )}><Download className="h-4 w-4 mr-1" /> Export</Button>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Type</TableHead><TableHead>From</TableHead><TableHead>To</TableHead>
                    <TableHead className="text-right">Amount</TableHead><TableHead>Description</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(elimsQ.data || []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No eliminations yet</TableCell></TableRow>}
                    {(elimsQ.data || []).map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <Select disabled={locked} value={e.entry_type} onValueChange={async (v) => {
                            await supabase.from("elimination_entries").update({ entry_type: v }).eq("id", e.id);
                            qc.invalidateQueries({ queryKey: ["elimination_entries", runId] });
                          }}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>{Object.entries(ELIM_TYPES).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>{companyName(e.from_company_id)}</TableCell>
                        <TableCell>{companyName(e.to_company_id)}</TableCell>
                        <TableCell className="text-right">
                          <Input type="number" defaultValue={e.amount} disabled={locked} className="h-8 text-right"
                            onBlur={async (ev) => {
                              await supabase.from("elimination_entries").update({ amount: Number(ev.target.value || 0) }).eq("id", e.id);
                              qc.invalidateQueries({ queryKey: ["elimination_entries", runId] });
                              recalcTotals();
                            }} />
                        </TableCell>
                        <TableCell className="text-xs">{e.description}</TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" disabled={locked} onClick={() => delElim.mutate(e.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="suggestions">
              <div className="flex justify-end mb-2">
                <Button size="sm" disabled={locked || !(suggestionsQ.data?.length)} onClick={applyAllSuggestions}>
                  <Wand2 className="h-4 w-4 mr-1" /> Apply all
                </Button>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>IC No</TableHead><TableHead>From</TableHead><TableHead>To</TableHead>
                    <TableHead className="text-right">Amount</TableHead><TableHead>Reconciled</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(suggestionsQ.data || []).length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No intercompany transactions in period</TableCell></TableRow>}
                    {(suggestionsQ.data || []).map((s: any) => (
                      <TableRow key={s.ic_id}>
                        <TableCell>{format(new Date(s.transaction_date), "dd/MM/yyyy")}</TableCell>
                        <TableCell className="font-medium">{s.ic_no}</TableCell>
                        <TableCell>{companyName(s.from_company_id)}</TableCell>
                        <TableCell>{companyName(s.to_company_id)}</TableCell>
                        <TableCell className="text-right">{money(s.base_amount || s.amount, s.currency)}</TableCell>
                        <TableCell><Badge variant={s.reconciled ? "secondary" : "outline"}>{s.reconciled ? "Yes" : "No"}</Badge></TableCell>
                        <TableCell><Button size="sm" variant="outline" disabled={locked} onClick={() => applySuggestion(s)}>Add</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="minority">
              <div className="flex justify-end mb-2">
                <Button size="sm" disabled={locked} onClick={() => { setMiDraft({ subsidiary_company_id: "", ownership_pct: 100, subsidiary_net_income: 0, subsidiary_equity: 0 }); setMiDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Add subsidiary
                </Button>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Subsidiary</TableHead><TableHead className="text-right">Ownership %</TableHead>
                    <TableHead className="text-right">Minority %</TableHead><TableHead className="text-right">Net Income</TableHead>
                    <TableHead className="text-right">Equity</TableHead><TableHead className="text-right">MI Amount</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(miQ.data || []).length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No subsidiaries added</TableCell></TableRow>}
                    {(miQ.data || []).map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell>{companyName(m.subsidiary_company_id)}</TableCell>
                        <TableCell className="text-right">{m.ownership_pct}%</TableCell>
                        <TableCell className="text-right">{m.minority_pct}%</TableCell>
                        <TableCell className="text-right">{money(m.subsidiary_net_income, run.base_currency)}</TableCell>
                        <TableCell className="text-right">{money(m.subsidiary_equity, run.base_currency)}</TableCell>
                        <TableCell className="text-right font-semibold">{money(m.minority_interest_amount, run.base_currency)}</TableCell>
                        <TableCell><Button size="icon" variant="ghost" disabled={locked} onClick={() => delMI.mutate(m.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* New run dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Consolidation Run</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Run Number</Label><Input value={newRun.run_no} onChange={(e) => setNewRun(s => ({ ...s, run_no: e.target.value }))} placeholder="Auto if blank" /></div>
            <div><Label>Period Start</Label><DateInput  value={newRun.period_start} onChange={(e) => setNewRun(s => ({ ...s, period_start: e.target.value }))} /></div>
            <div><Label>Period End</Label><DateInput  value={newRun.period_end} onChange={(e) => setNewRun(s => ({ ...s, period_end: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createRun.mutate()} disabled={!newRun.period_start || !newRun.period_end}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Minority interest dialog */}
      <Dialog open={miDialogOpen} onOpenChange={setMiDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Subsidiary Minority Interest</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Subsidiary</Label>
              <Select value={miDraft.subsidiary_company_id} onValueChange={(v) => setMiDraft((s: any) => ({ ...s, subsidiary_company_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose company" /></SelectTrigger>
                <SelectContent>
                  {(companiesQ.data || []).filter((c: any) => !c.is_headquarters).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Parent Ownership %</Label><Input type="number" value={miDraft.ownership_pct} onChange={(e) => setMiDraft((s: any) => ({ ...s, ownership_pct: Number(e.target.value) }))} /></div>
            <div><Label>Subsidiary Net Income</Label><Input type="number" value={miDraft.subsidiary_net_income} onChange={(e) => setMiDraft((s: any) => ({ ...s, subsidiary_net_income: Number(e.target.value) }))} /></div>
            <div><Label>Subsidiary Equity</Label><Input type="number" value={miDraft.subsidiary_equity} onChange={(e) => setMiDraft((s: any) => ({ ...s, subsidiary_equity: Number(e.target.value) }))} /></div>
            <div className="text-sm text-muted-foreground">
              Minority % = {(100 - Number(miDraft.ownership_pct || 0)).toFixed(2)}% · MI Amount = {money((Number(miDraft.subsidiary_equity || 0) * (100 - Number(miDraft.ownership_pct || 0))) / 100)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMiDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => upsertMI.mutate()} disabled={!miDraft.subsidiary_company_id}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
