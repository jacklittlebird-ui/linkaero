import { useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

type Asset = { id: string; asset_code: string; asset_name: string; purchase_cost: number; accumulated_depreciation: number; currency?: string | null };
type Test = {
  id: string; asset_id: string; test_date: string; carrying_amount: number;
  fair_value_less_costs: number | null; value_in_use: number | null;
  recoverable_amount: number; impairment_loss: number; status: string;
  triggering_event: string | null; notes: string | null;
};

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const carryingOf = (a?: Asset | null) => a ? Number(a.purchase_cost || 0) - Number(a.accumulated_depreciation || 0) : 0;

export default function AssetImpairmentPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    asset_id: "",
    test_date: format(new Date(), "yyyy-MM-dd"),
    fair_value_less_costs: "",
    value_in_use: "",
    triggering_event: "",
    notes: "",
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["fixed_assets_for_impairment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("id,asset_code,asset_name,purchase_cost,accumulated_depreciation,currency")
        .order("asset_code");
      if (error) throw error;
      return (data ?? []) as Asset[];
    },
  });

  const { data: tests = [], isLoading } = useQuery({
    queryKey: ["asset_impairment_tests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_impairment_tests")
        .select("*")
        .order("test_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Test[];
    },
  });

  const assetMap = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const selectedAsset = assetMap.get(form.asset_id);
  const carrying = carryingOf(selectedAsset);
  const fv = parseFloat(form.fair_value_less_costs) || 0;
  const viu = parseFloat(form.value_in_use) || 0;
  const recoverable = Math.max(fv, viu);
  const loss = Math.max(0, carrying - recoverable);

  const createTest = useMutation({
    mutationFn: async () => {
      if (!form.asset_id) throw new Error("Select an asset");
      const { error } = await supabase.from("asset_impairment_tests").insert({
        asset_id: form.asset_id,
        test_date: form.test_date,
        carrying_amount: carrying,
        fair_value_less_costs: form.fair_value_less_costs ? fv : null,
        value_in_use: form.value_in_use ? viu : null,
        recoverable_amount: recoverable,
        impairment_loss: loss,
        triggering_event: form.triggering_event || null,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Impairment test recorded");
      qc.invalidateQueries({ queryKey: ["asset_impairment_tests"] });
      setOpen(false);
      setForm({ asset_id: "", test_date: format(new Date(), "yyyy-MM-dd"), fair_value_less_costs: "", value_in_use: "", triggering_event: "", notes: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const postTest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("post_impairment_test", { _test_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Impairment posted");
      qc.invalidateQueries({ queryKey: ["asset_impairment_tests"] });
      qc.invalidateQueries({ queryKey: ["fixed_assets_for_impairment"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalLoss = tests.filter(t => t.status === "posted").reduce((s, t) => s + Number(t.impairment_loss || 0), 0);
  const drafts = tests.filter(t => t.status === "draft").length;
  const flagged = tests.filter(t => t.status === "draft" && Number(t.impairment_loss) > 0).length;

  const statusBadge = (s: string) => {
    if (s === "posted") return <Badge>Posted</Badge>;
    if (s === "no_impairment") return <Badge variant="secondary">No Impairment</Badge>;
    return <Badge variant="outline">Draft</Badge>;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fixed Asset Impairment Testing</h1>
          <p className="text-sm text-muted-foreground">IAS 36 recoverable amount reviews — higher of fair value less costs and value in use.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />New Test</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Record Impairment Test</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Asset</Label>
                <Select value={form.asset_id} onValueChange={(v) => setForm({ ...form, asset_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
                  <SelectContent>
                    {assets.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.asset_code} — {a.asset_name} (carrying {fmt(carryingOf(a))})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Test Date</Label>
                <DateInput  value={form.test_date} onChange={(e) => setForm({ ...form, test_date: e.target.value })} />
              </div>
              <div>
                <Label>Carrying Amount</Label>
                <Input value={fmt(carrying)} readOnly />
              </div>
              <div>
                <Label>Fair Value less Costs to Sell</Label>
                <Input type="number" step="0.01" value={form.fair_value_less_costs} onChange={(e) => setForm({ ...form, fair_value_less_costs: e.target.value })} />
              </div>
              <div>
                <Label>Value in Use</Label>
                <Input type="number" step="0.01" value={form.value_in_use} onChange={(e) => setForm({ ...form, value_in_use: e.target.value })} />
              </div>
              <div>
                <Label>Recoverable Amount</Label>
                <Input value={fmt(recoverable)} readOnly />
              </div>
              <div>
                <Label>Impairment Loss</Label>
                <Input value={fmt(loss)} readOnly className={loss > 0 ? "text-destructive font-semibold" : ""} />
              </div>
              <div className="col-span-2">
                <Label>Triggering Event</Label>
                <Input value={form.triggering_event} onChange={(e) => setForm({ ...form, triggering_event: e.target.value })} placeholder="e.g. Physical damage, market decline, obsolescence" />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => createTest.mutate()} disabled={createTest.isPending || !form.asset_id}>
                {createTest.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save Test
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card><CardHeader><CardTitle className="text-sm">Total Tests</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{tests.length}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Draft</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{drafts}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2">Awaiting Posting {flagged > 0 && <AlertTriangle className="w-4 h-4 text-destructive" />}</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-destructive">{flagged}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Posted Impairment Losses</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{fmt(totalLoss)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Impairment Tests</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test Date</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Carrying</TableHead>
                  <TableHead className="text-right">Recoverable</TableHead>
                  <TableHead className="text-right">Loss</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tests.map(t => {
                  const a = assetMap.get(t.asset_id);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>{t.test_date}</TableCell>
                      <TableCell>{a ? `${a.asset_code} — ${a.asset_name}` : t.asset_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-right">{fmt(t.carrying_amount)}</TableCell>
                      <TableCell className="text-right">{fmt(t.recoverable_amount)}</TableCell>
                      <TableCell className={`text-right ${Number(t.impairment_loss) > 0 ? "text-destructive font-semibold" : ""}`}>{fmt(t.impairment_loss)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{t.triggering_event || "—"}</TableCell>
                      <TableCell>{statusBadge(t.status)}</TableCell>
                      <TableCell>
                        {t.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => postTest.mutate(t.id)} disabled={postTest.isPending}>
                            {Number(t.impairment_loss) > 0 ? "Post Loss" : "Close"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {tests.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No impairment tests yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
