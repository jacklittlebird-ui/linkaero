// Phase 2o: Multi-Currency FX Gain/Loss Automation
// - Unrealised revaluation on open AR (invoices) and AP (vendor_invoices)
// - Realised gain/loss journal-style entries on settlement
// - Historical-rate snapshots via saved run lines
import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, PlayCircle, TrendingUp, TrendingDown, Coins, History } from "lucide-react";
import { format, parseISO } from "date-fns";
import { exportToExcel } from "@/lib/exportExcel";
import { toast } from "sonner";

const BASE = "EGP";

type Rate = { quote_currency: string; base_currency: string; mid_rate: number; rate_date: string };
type OpenDoc = {
  kind: "AR" | "AP";
  id: string;
  document_no: string;
  counterparty: string;
  currency: string;
  amount: number;
  booked_rate: number;
  date: string;
};

type Run = {
  id: string;
  run_no: string;
  as_of_date: string;
  mode: string;
  status: string;
  total_gain: number;
  total_loss: number;
  net_impact: number;
  documents_evaluated: number;
  notes: string | null;
  created_at: string;
};

type RunLine = {
  id: string;
  run_id: string;
  document_type: string;
  document_no: string | null;
  counterparty: string | null;
  currency: string;
  original_amount: number;
  booked_rate: number;
  current_rate: number;
  booked_base: number;
  current_base: number;
  gain_loss: number;
};

type Realized = {
  id: string;
  entry_no: string;
  entry_date: string;
  source_type: string;
  source_no: string | null;
  counterparty: string | null;
  currency: string;
  original_amount: number;
  booked_rate: number;
  settlement_rate: number;
  base_currency: string;
  gain_loss: number;
  notes: string | null;
};

export default function FxGainLoss() {
  const qc = useQueryClient();
  const [asOf, setAsOf] = useState<string>(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<{ lines: any[]; totals: { gain: number; loss: number; net: number } } | null>(null);
  const [realizedDialog, setRealizedDialog] = useState(false);
  const [runViewer, setRunViewer] = useState<Run | null>(null);

  // Latest rates per quote currency (base = EGP)
  const { data: rates = [] } = useQuery({
    queryKey: ["fx-rates-latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exchange_rates")
        .select("quote_currency,base_currency,mid_rate,rate_date")
        .order("rate_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      const seen = new Set<string>();
      const latest: Rate[] = [];
      for (const r of (data ?? []) as any as Rate[]) {
        const key = `${r.quote_currency}->${r.base_currency}`;
        if (!seen.has(key)) { seen.add(key); latest.push(r); }
      }
      return latest;
    },
  });

  const rateFor = (currency: string): number => {
    if (currency === BASE) return 1;
    const r = rates.find(x => x.quote_currency === currency && x.base_currency === BASE);
    return r ? Number(r.mid_rate) : 1;
  };

  // Open AR — unpaid client invoices
  const { data: openAR = [] } = useQuery({
    queryKey: ["fx-open-ar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,invoice_no,date,operator,currency,total,exchange_rate,status")
        .neq("status", "Paid")
        .neq("status", "Cancelled")
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map((r: any): OpenDoc => ({
        kind: "AR",
        id: r.id,
        document_no: r.invoice_no,
        counterparty: r.operator ?? "—",
        currency: r.currency ?? BASE,
        amount: Number(r.total ?? 0),
        booked_rate: Number(r.exchange_rate ?? 1),
        date: r.date,
      })).filter(d => d.currency !== BASE);
    },
  });

  // Open AP — unpaid vendor invoices
  const { data: openAP = [] } = useQuery({
    queryKey: ["fx-open-ap"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_invoices")
        .select("id,invoice_no,date,vendor_name,currency,total,status")
        .neq("status", "Paid")
        .neq("status", "Cancelled")
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map((r: any): OpenDoc => ({
        kind: "AP",
        id: r.id,
        document_no: r.invoice_no,
        counterparty: r.vendor_name ?? "—",
        currency: r.currency ?? BASE,
        amount: Number(r.total ?? 0),
        booked_rate: 1, // AP has no explicit booked rate; use 1 as baseline
        date: r.date,
      })).filter(d => d.currency !== BASE);
    },
  });

  // Historical runs & realised entries
  const { data: runs = [] } = useQuery({
    queryKey: ["fx-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fx_revaluation_runs").select("*")
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as Run[];
    },
  });

  const { data: runLines = [] } = useQuery({
    queryKey: ["fx-run-lines", runViewer?.id],
    enabled: !!runViewer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fx_revaluation_lines").select("*")
        .eq("run_id", runViewer!.id).order("gain_loss");
      if (error) throw error;
      return (data ?? []) as RunLine[];
    },
  });

  const { data: realized = [] } = useQuery({
    queryKey: ["fx-realized"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fx_realized_entries").select("*")
        .order("entry_date", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Realized[];
    },
  });

  // Build preview
  const buildPreview = () => {
    const all = [...openAR, ...openAP];
    const lines = all.map(d => {
      const currentRate = rateFor(d.currency);
      const bookedRate = d.booked_rate || 1;
      const bookedBase = d.amount * bookedRate;
      const currentBase = d.amount * currentRate;
      const gl = currentBase - bookedBase;
      // AP: a rise in FX cost = LOSS to us, so invert sign
      const gainLoss = d.kind === "AP" ? -gl : gl;
      return {
        document_type: d.kind,
        document_id: d.id,
        document_no: d.document_no,
        counterparty: d.counterparty,
        currency: d.currency,
        original_amount: d.amount,
        booked_rate: bookedRate,
        current_rate: currentRate,
        booked_base: bookedBase,
        current_base: currentBase,
        gain_loss: gainLoss,
      };
    });
    const gain = lines.filter(l => l.gain_loss > 0).reduce((s, l) => s + l.gain_loss, 0);
    const loss = lines.filter(l => l.gain_loss < 0).reduce((s, l) => s + l.gain_loss, 0);
    setPreview({ lines, totals: { gain, loss, net: gain + loss } });
    toast.success(`Previewed ${lines.length} document(s)`);
  };

  // Commit run
  const commitRun = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Preview first");
      const runNo = `FXR-${Date.now()}`;
      const { data: run, error: e1 } = await supabase.from("fx_revaluation_runs").insert({
        run_no: runNo,
        as_of_date: asOf,
        base_currency: BASE,
        mode: "committed",
        status: "completed",
        total_gain: preview.totals.gain,
        total_loss: preview.totals.loss,
        net_impact: preview.totals.net,
        documents_evaluated: preview.lines.length,
      } as any).select().single();
      if (e1) throw e1;
      if (preview.lines.length) {
        const linesPayload = preview.lines.map(l => ({ ...l, run_id: (run as any).id }));
        const { error: e2 } = await supabase.from("fx_revaluation_lines").insert(linesPayload as any);
        if (e2) throw e2;
      }
      return run;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fx-runs"] });
      toast.success("Revaluation run committed");
      setPreview(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const addRealized = useMutation({
    mutationFn: async (p: Partial<Realized>) => {
      const gl = (Number(p.original_amount ?? 0)) *
        ((Number(p.settlement_rate ?? 1)) - (Number(p.booked_rate ?? 1)));
      const source = p.source_type === "AP" ? -gl : gl;
      const { error } = await supabase.from("fx_realized_entries").insert({
        ...p,
        entry_no: `FXE-${Date.now()}`,
        base_currency: BASE,
        gain_loss: source,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fx-realized"] });
      setRealizedDialog(false);
      toast.success("Realised entry recorded");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const kpis = useMemo(() => {
    const realizedYTDGain = realized.filter(r => r.gain_loss > 0).reduce((s, r) => s + Number(r.gain_loss), 0);
    const realizedYTDLoss = realized.filter(r => r.gain_loss < 0).reduce((s, r) => s + Number(r.gain_loss), 0);
    return {
      openArDocs: openAR.length,
      openApDocs: openAP.length,
      realizedYTDGain,
      realizedYTDLoss,
    };
  }, [openAR, openAP, realized]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Coins className="h-6 w-6" /> FX Gain / Loss Automation
          </h1>
          <p className="text-muted-foreground text-sm">
            Revalue open foreign-currency AR &amp; AP, and record realised gain/loss on settlement.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div>
            <Label className="text-xs">As-of date</Label>
            <DateInput  value={asOf} onChange={e => setAsOf(e.target.value)} className="w-40" />
          </div>
          <Button onClick={buildPreview}><PlayCircle className="h-4 w-4 mr-1" /> Preview Revaluation</Button>
          <Button variant="outline" onClick={() => setRealizedDialog(true)}>+ Realised Entry</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Open AR (FX)</div>
          <div className="text-2xl font-bold">{kpis.openArDocs}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Open AP (FX)</div>
          <div className="text-2xl font-bold">{kpis.openApDocs}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3 text-green-600" /> Realised Gain (all)</div>
          <div className="text-2xl font-bold text-green-600">{kpis.realizedYTDGain.toFixed(2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3 text-destructive" /> Realised Loss (all)</div>
          <div className="text-2xl font-bold text-destructive">{kpis.realizedYTDLoss.toFixed(2)}</div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="preview">
        <TabsList>
          <TabsTrigger value="preview">Unrealised Preview</TabsTrigger>
          <TabsTrigger value="realized">Realised Entries</TabsTrigger>
          <TabsTrigger value="history"><History className="h-4 w-4 mr-1" /> Run History</TabsTrigger>
          <TabsTrigger value="rates">Current Rates</TabsTrigger>
        </TabsList>

        <TabsContent value="preview">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>
                Preview {preview ? `— net ${preview.totals.net.toFixed(2)} ${BASE} (gain ${preview.totals.gain.toFixed(2)} / loss ${preview.totals.loss.toFixed(2)})` : ""}
              </CardTitle>
              <div className="flex gap-2">
                {preview && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => exportToExcel(preview.lines, "FX Preview", "fx_preview.xlsx")}>
                      <Download className="h-4 w-4 mr-1" /> Export
                    </Button>
                    <Button size="sm" onClick={() => commitRun.mutate()} disabled={commitRun.isPending}>Commit Run</Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Type</TableHead><TableHead>Doc</TableHead>
                  <TableHead>Counterparty</TableHead><TableHead>Ccy</TableHead>
                  <TableHead>Amount</TableHead><TableHead>Booked</TableHead>
                  <TableHead>Current</TableHead><TableHead>Gain/Loss ({BASE})</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {!preview && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Click Preview to compute unrealised FX impact.</TableCell></TableRow>}
                  {preview?.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell><Badge variant={l.document_type === "AR" ? "default" : "outline"}>{l.document_type}</Badge></TableCell>
                      <TableCell>{l.document_no}</TableCell>
                      <TableCell>{l.counterparty}</TableCell>
                      <TableCell>{l.currency}</TableCell>
                      <TableCell>{Number(l.original_amount).toFixed(2)}</TableCell>
                      <TableCell>{Number(l.booked_rate).toFixed(4)}</TableCell>
                      <TableCell>{Number(l.current_rate).toFixed(4)}</TableCell>
                      <TableCell className={l.gain_loss >= 0 ? "text-green-600 font-medium" : "text-destructive font-medium"}>
                        {Number(l.gain_loss).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="realized">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Realised Entries ({realized.length})</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => exportToExcel(realized as any, "Realised", "fx_realized.xlsx")}>
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Entry</TableHead><TableHead>Date</TableHead>
                  <TableHead>Source</TableHead><TableHead>Counterparty</TableHead>
                  <TableHead>Ccy</TableHead><TableHead>Amount</TableHead>
                  <TableHead>Booked</TableHead><TableHead>Settled</TableHead>
                  <TableHead>Gain/Loss</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {realized.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No realised entries yet.</TableCell></TableRow>}
                  {realized.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.entry_no}</TableCell>
                      <TableCell>{format(parseISO(r.entry_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell><Badge variant={r.source_type === "AR" ? "default" : "outline"}>{r.source_type}</Badge> <span className="text-xs text-muted-foreground">{r.source_no}</span></TableCell>
                      <TableCell>{r.counterparty ?? "—"}</TableCell>
                      <TableCell>{r.currency}</TableCell>
                      <TableCell>{Number(r.original_amount).toFixed(2)}</TableCell>
                      <TableCell>{Number(r.booked_rate).toFixed(4)}</TableCell>
                      <TableCell>{Number(r.settlement_rate).toFixed(4)}</TableCell>
                      <TableCell className={r.gain_loss >= 0 ? "text-green-600 font-medium" : "text-destructive font-medium"}>
                        {Number(r.gain_loss).toFixed(2)} {r.base_currency}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle>Revaluation Run History</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Run</TableHead><TableHead>As-of</TableHead>
                  <TableHead>Docs</TableHead><TableHead>Gain</TableHead>
                  <TableHead>Loss</TableHead><TableHead>Net</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {runs.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No runs yet.</TableCell></TableRow>}
                  {runs.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.run_no}</TableCell>
                      <TableCell>{format(parseISO(r.as_of_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{r.documents_evaluated}</TableCell>
                      <TableCell className="text-green-600">{Number(r.total_gain).toFixed(2)}</TableCell>
                      <TableCell className="text-destructive">{Number(r.total_loss).toFixed(2)}</TableCell>
                      <TableCell className={Number(r.net_impact) >= 0 ? "text-green-600 font-medium" : "text-destructive font-medium"}>
                        {Number(r.net_impact).toFixed(2)}
                      </TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={() => setRunViewer(r)}>View</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates">
          <Card>
            <CardHeader><CardTitle>Latest Rates (base {BASE})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Currency</TableHead><TableHead>Rate</TableHead><TableHead>Date</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rates.filter(r => r.base_currency === BASE).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.quote_currency}</TableCell>
                      <TableCell className="font-mono">{Number(r.mid_rate).toFixed(4)}</TableCell>
                      <TableCell>{format(parseISO(r.rate_date), "dd/MM/yyyy")}</TableCell>
                    </TableRow>
                  ))}
                  {rates.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No rates configured. Add rates under Exchange Rates.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Realised Entry Dialog */}
      <Dialog open={realizedDialog} onOpenChange={setRealizedDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Realised FX Entry</DialogTitle></DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            addRealized.mutate({
              entry_date: String(fd.get("entry_date")),
              source_type: String(fd.get("source_type")) as any,
              source_no: String(fd.get("source_no") || "") || null,
              counterparty: String(fd.get("counterparty") || "") || null,
              currency: String(fd.get("currency") || BASE),
              original_amount: Number(fd.get("original_amount") || 0),
              booked_rate: Number(fd.get("booked_rate") || 1),
              settlement_rate: Number(fd.get("settlement_rate") || 1),
              notes: String(fd.get("notes") || "") || null,
            });
          }} className="grid grid-cols-2 gap-3">
            <div><Label>Date</Label><DateInput name="entry_date"  required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
            <div>
              <Label>Source</Label>
              <Select name="source_type" defaultValue="AR">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="AR">AR (Client)</SelectItem><SelectItem value="AP">AP (Vendor)</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Reference Doc</Label><Input name="source_no" /></div>
            <div><Label>Counterparty</Label><Input name="counterparty" /></div>
            <div><Label>Currency</Label><Input name="currency" defaultValue="USD" /></div>
            <div><Label>Original Amount</Label><Input name="original_amount" type="number" step="0.01" required /></div>
            <div><Label>Booked Rate</Label><Input name="booked_rate" type="number" step="0.0001" required /></div>
            <div><Label>Settlement Rate</Label><Input name="settlement_rate" type="number" step="0.0001" required /></div>
            <div className="col-span-2"><Label>Notes</Label><Textarea name="notes" /></div>
            <DialogFooter className="col-span-2">
              <Button type="button" variant="outline" onClick={() => setRealizedDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={addRealized.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Run Viewer */}
      <Dialog open={!!runViewer} onOpenChange={(o) => !o && setRunViewer(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Run {runViewer?.run_no} — {runViewer && format(parseISO(runViewer.as_of_date), "dd/MM/yyyy")}</DialogTitle></DialogHeader>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Type</TableHead><TableHead>Doc</TableHead>
              <TableHead>Counterparty</TableHead><TableHead>Ccy</TableHead>
              <TableHead>Amount</TableHead><TableHead>Booked</TableHead>
              <TableHead>Current</TableHead><TableHead>Gain/Loss</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {runLines.map(l => (
                <TableRow key={l.id}>
                  <TableCell><Badge variant={l.document_type === "AR" ? "default" : "outline"}>{l.document_type}</Badge></TableCell>
                  <TableCell>{l.document_no}</TableCell>
                  <TableCell>{l.counterparty}</TableCell>
                  <TableCell>{l.currency}</TableCell>
                  <TableCell>{Number(l.original_amount).toFixed(2)}</TableCell>
                  <TableCell>{Number(l.booked_rate).toFixed(4)}</TableCell>
                  <TableCell>{Number(l.current_rate).toFixed(4)}</TableCell>
                  <TableCell className={l.gain_loss >= 0 ? "text-green-600 font-medium" : "text-destructive font-medium"}>
                    {Number(l.gain_loss).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </div>
  );
}
