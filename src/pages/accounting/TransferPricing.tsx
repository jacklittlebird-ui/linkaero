import { useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, FileText } from "lucide-react";

const METHODS = [
  { v: "CUP", l: "CUP — Comparable Uncontrolled Price" },
  { v: "RPM", l: "RPM — Resale Price" },
  { v: "CPM", l: "CPM — Cost Plus" },
  { v: "TNMM", l: "TNMM — Transactional Net Margin" },
  { v: "PSM", l: "PSM — Profit Split" },
];

export default function TransferPricingPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [openAdj, setOpenAdj] = useState(false);

  const { data: parties = [] } = useQuery({
    queryKey: ["related_parties_list"],
    queryFn: async () => (await supabase.from("related_parties").select("id, party_name").order("party_name")).data || [],
  });

  const { data: studies = [] } = useQuery({
    queryKey: ["tp_studies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("transfer_pricing_studies").select("*").order("study_year", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const current = studies.find((s) => s.id === selected);

  const { data: adjustments = [] } = useQuery({
    queryKey: ["tp_adjustments", selected],
    enabled: !!selected,
    queryFn: async () => (await supabase.from("transfer_pricing_adjustments").select("*").eq("study_id", selected).order("adjustment_date", { ascending: false })).data || [],
  });

  const createStudy = async (f: FormData) => {
    const payload = Object.fromEntries(f.entries()) as any;
    payload.study_year = Number(payload.study_year);
    ["benchmarking_range_low", "benchmarking_range_high", "tested_margin"].forEach((k) => {
      payload[k] = payload[k] ? Number(payload[k]) : null;
    });
    if (!payload.related_party_id) delete payload.related_party_id;
    const { data, error } = await supabase.from("transfer_pricing_studies").insert(payload).select().single();
    if (error) return toast.error(error.message);
    toast.success("Study created");
    setOpenNew(false);
    setSelected(data.id);
    qc.invalidateQueries({ queryKey: ["tp_studies"] });
  };

  const finalize = async () => {
    if (!selected) return;
    const { error } = await supabase.from("transfer_pricing_studies").update({ status: "finalized" }).eq("id", selected);
    if (error) return toast.error(error.message);
    toast.success("Finalized");
    qc.invalidateQueries({ queryKey: ["tp_studies"] });
  };

  const addAdjustment = async (f: FormData) => {
    if (!selected) return;
    const payload: any = {
      study_id: selected,
      adjustment_date: f.get("adjustment_date"),
      adjustment_amount: Number(f.get("adjustment_amount") || 0),
      direction: f.get("direction"),
      rationale: f.get("rationale"),
    };
    const { error } = await supabase.from("transfer_pricing_adjustments").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Adjustment recorded");
    setOpenAdj(false);
    qc.invalidateQueries({ queryKey: ["tp_adjustments", selected] });
  };

  const outOfRange = current && current.tested_margin != null && current.benchmarking_range_low != null && current.benchmarking_range_high != null &&
    (current.tested_margin < current.benchmarking_range_low || current.tested_margin > current.benchmarking_range_high);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transfer Pricing Documentation</h1>
          <p className="text-muted-foreground text-sm">OECD BEPS-aligned benchmarking, arm's-length testing & true-up adjustments</p>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New Study</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New Transfer Pricing Study</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createStudy(new FormData(e.currentTarget)); }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Study Year</Label><Input type="number" name="study_year" defaultValue={new Date().getFullYear()} required /></div>
                <div><Label>Related Party</Label>
                  <Select name="related_party_id">
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{parties.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.party_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Transaction Type</Label><Input name="transaction_type" required placeholder="e.g. Management fees" /></div>
                <div><Label>Method</Label>
                  <Select name="method" defaultValue="TNMM">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Tested Party</Label><Input name="tested_party" placeholder="Which entity is tested" /></div>
              <div><Label>Functional Analysis</Label><Textarea name="functional_analysis" placeholder="Functions performed, assets used, risks assumed" /></div>
              <div><Label>Comparables Source</Label><Input name="comparables_source" placeholder="e.g. Orbis, Bloomberg, TP Catalyst" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Range Low</Label><Input type="number" step="0.0001" name="benchmarking_range_low" /></div>
                <div><Label>Range High</Label><Input type="number" step="0.0001" name="benchmarking_range_high" /></div>
                <div><Label>Tested Margin</Label><Input type="number" step="0.0001" name="tested_margin" /></div>
              </div>
              <div><Label>Conclusion</Label><Textarea name="arms_length_conclusion" /></div>
              <Button type="submit" className="w-full">Create</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Studies</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[600px] overflow-auto">
            {studies.map((s) => (
              <button key={s.id} onClick={() => setSelected(s.id)}
                className={`w-full text-left p-3 rounded border ${selected === s.id ? "border-primary bg-primary/5" : "border-border"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{s.study_year} — {s.transaction_type}</span>
                  <Badge variant={s.status === "finalized" ? "default" : "secondary"}>{s.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{s.method} · {s.tested_party || "—"}</div>
              </button>
            ))}
            {studies.length === 0 && <p className="text-sm text-muted-foreground">No studies yet.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />Study Detail</CardTitle></CardHeader>
          <CardContent>
            {!current ? (
              <p className="text-sm text-muted-foreground">Select a study.</p>
            ) : (
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="adjustments">Adjustments ({adjustments.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="space-y-3 pt-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><Label className="text-muted-foreground">Year</Label><div>{current.study_year}</div></div>
                    <div><Label className="text-muted-foreground">Method</Label><div>{current.method}</div></div>
                    <div><Label className="text-muted-foreground">Transaction</Label><div>{current.transaction_type}</div></div>
                    <div><Label className="text-muted-foreground">Tested Party</Label><div>{current.tested_party || "—"}</div></div>
                    <div><Label className="text-muted-foreground">Comparables Source</Label><div>{current.comparables_source || "—"}</div></div>
                    <div><Label className="text-muted-foreground">Status</Label><div><Badge>{current.status}</Badge></div></div>
                  </div>
                  <div className="border rounded p-3 bg-muted/30">
                    <div className="text-sm font-semibold mb-2">Benchmarking Range</div>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>Low: {current.benchmarking_range_low != null ? `${(current.benchmarking_range_low * 100).toFixed(2)}%` : "—"}</div>
                      <div>High: {current.benchmarking_range_high != null ? `${(current.benchmarking_range_high * 100).toFixed(2)}%` : "—"}</div>
                      <div>Tested: {current.tested_margin != null ? `${(current.tested_margin * 100).toFixed(2)}%` : "—"}</div>
                    </div>
                    {outOfRange && <div className="mt-2 text-sm text-destructive font-medium">⚠ Tested margin is outside arm's-length range — an adjustment may be required.</div>}
                  </div>
                  {current.functional_analysis && <div><Label className="text-muted-foreground">Functional Analysis</Label><div className="text-sm whitespace-pre-wrap">{current.functional_analysis}</div></div>}
                  {current.arms_length_conclusion && <div><Label className="text-muted-foreground">Conclusion</Label><div className="text-sm whitespace-pre-wrap">{current.arms_length_conclusion}</div></div>}
                  {current.status !== "finalized" && <Button onClick={finalize}>Finalize Study</Button>}
                </TabsContent>
                <TabsContent value="adjustments" className="space-y-3 pt-4">
                  <Dialog open={openAdj} onOpenChange={setOpenAdj}>
                    <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Adjustment</Button></DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Year-End True-Up Adjustment</DialogTitle></DialogHeader>
                      <form onSubmit={(e) => { e.preventDefault(); addAdjustment(new FormData(e.currentTarget)); }} className="space-y-3">
                        <div><Label>Date</Label><DateInput  name="adjustment_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
                        <div><Label>Amount</Label><Input type="number" step="0.01" name="adjustment_amount" required /></div>
                        <div><Label>Direction</Label>
                          <Select name="direction" defaultValue="increase">
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="increase">Increase Income</SelectItem>
                              <SelectItem value="decrease">Decrease Income</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div><Label>Rationale</Label><Textarea name="rationale" required /></div>
                        <Button type="submit" className="w-full">Record</Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Direction</TableHead><TableHead>Rationale</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {adjustments.map((a: any) => (
                        <TableRow key={a.id}>
                          <TableCell>{a.adjustment_date}</TableCell>
                          <TableCell className="text-right">{Number(a.adjustment_amount).toLocaleString()}</TableCell>
                          <TableCell><Badge variant={a.direction === "increase" ? "default" : "secondary"}>{a.direction}</Badge></TableCell>
                          <TableCell className="text-sm">{a.rationale}</TableCell>
                        </TableRow>
                      ))}
                      {adjustments.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No adjustments.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
