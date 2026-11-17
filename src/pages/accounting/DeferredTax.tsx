import { useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Calculator, CheckCircle2 } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));

export default function DeferredTaxPage() {
  const qc = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [newItemOpen, setNewItemOpen] = useState(false);

  const { data: runs = [] } = useQuery({
    queryKey: ["deferred_tax_runs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("deferred_tax_runs").select("*").order("run_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["deferred_tax_items", selectedRun],
    enabled: !!selectedRun,
    queryFn: async () => {
      const { data, error } = await supabase.from("deferred_tax_items").select("*").eq("run_id", selectedRun).order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  const currentRun = runs.find((r) => r.id === selectedRun);

  const createRun = async (form: FormData) => {
    const payload = {
      run_date: String(form.get("run_date")),
      opening_dta: Number(form.get("opening_dta") || 0),
      opening_dtl: Number(form.get("opening_dtl") || 0),
      notes: String(form.get("notes") || ""),
    };
    const { data, error } = await supabase.from("deferred_tax_runs").insert(payload).select().single();
    if (error) return toast.error(error.message);
    toast.success("Run created");
    setNewRunOpen(false);
    setSelectedRun(data.id);
    qc.invalidateQueries({ queryKey: ["deferred_tax_runs"] });
  };

  const addItem = async (form: FormData) => {
    if (!selectedRun) return;
    const accounting_base = Number(form.get("accounting_base") || 0);
    const tax_base = Number(form.get("tax_base") || 0);
    const tax_rate = Number(form.get("tax_rate") || 0.225);
    const diff = accounting_base - tax_base;
    const dt_type = String(form.get("dt_type"));
    const deferred_tax_amount = Math.abs(diff) * tax_rate;
    const payload = {
      run_id: selectedRun,
      item_name: String(form.get("item_name")),
      category: String(form.get("category")),
      accounting_base,
      tax_base,
      tax_rate,
      dt_type,
      deferred_tax_amount,
      notes: String(form.get("notes") || ""),
    };
    const { error } = await supabase.from("deferred_tax_items").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Item added");
    setNewItemOpen(false);
    qc.invalidateQueries({ queryKey: ["deferred_tax_items", selectedRun] });
  };

  const compute = async () => {
    if (!selectedRun) return;
    const { error } = await supabase.rpc("compute_deferred_tax_run", { p_run_id: selectedRun });
    if (error) return toast.error(error.message);
    toast.success("Recomputed");
    qc.invalidateQueries({ queryKey: ["deferred_tax_runs"] });
  };

  const post = async () => {
    if (!selectedRun) return;
    const { error } = await supabase.rpc("post_deferred_tax_run", { p_run_id: selectedRun });
    if (error) return toast.error(error.message);
    toast.success("Posted");
    qc.invalidateQueries({ queryKey: ["deferred_tax_runs"] });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Deferred Tax (IAS 12)</h1>
          <p className="text-muted-foreground text-sm">Temporary differences, DTA/DTL computation, and posting</p>
        </div>
        <Dialog open={newRunOpen} onOpenChange={setNewRunOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />New Run</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Deferred Tax Run</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createRun(new FormData(e.currentTarget)); }} className="space-y-4">
              <div><Label>Run Date</Label><DateInput  name="run_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Opening DTA</Label><Input type="number" step="0.01" name="opening_dta" defaultValue="0" /></div>
                <div><Label>Opening DTL</Label><Input type="number" step="0.01" name="opening_dtl" defaultValue="0" /></div>
              </div>
              <div><Label>Notes</Label><Input name="notes" /></div>
              <Button type="submit" className="w-full">Create</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Runs</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[500px] overflow-auto">
            {runs.map((r) => (
              <button key={r.id} onClick={() => setSelectedRun(r.id)}
                className={`w-full text-left p-3 rounded border ${selectedRun === r.id ? "border-primary bg-primary/5" : "border-border"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{r.run_date}</span>
                  <Badge variant={r.status === "posted" ? "default" : "secondary"}>{r.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  DTA {fmt(r.closing_dta)} / DTL {fmt(r.closing_dtl)}
                </div>
                <div className="text-xs mt-1">Movement P&amp;L: <span className={r.movement_pnl >= 0 ? "text-destructive" : "text-green-600"}>{fmt(r.movement_pnl)}</span></div>
              </button>
            ))}
            {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Temporary Differences</CardTitle>
            {currentRun && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={compute}><Calculator className="h-4 w-4 mr-1" />Recompute</Button>
                {currentRun.status !== "posted" && (
                  <Button size="sm" onClick={post}><CheckCircle2 className="h-4 w-4 mr-1" />Post</Button>
                )}
                <Dialog open={newItemOpen} onOpenChange={setNewItemOpen}>
                  <DialogTrigger asChild><Button size="sm" variant="secondary"><Plus className="h-4 w-4 mr-1" />Item</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Temporary Difference</DialogTitle></DialogHeader>
                    <form onSubmit={(e) => { e.preventDefault(); addItem(new FormData(e.currentTarget)); }} className="space-y-3">
                      <div><Label>Item Name</Label><Input name="item_name" required placeholder="e.g. Accelerated depreciation" /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Category</Label>
                          <Select name="category" defaultValue="asset">
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="asset">Asset</SelectItem>
                              <SelectItem value="liability">Liability</SelectItem>
                              <SelectItem value="provision">Provision</SelectItem>
                              <SelectItem value="loss_carryforward">Tax Loss C/F</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div><Label>DT Type</Label>
                          <Select name="dt_type" defaultValue="DTL">
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="DTA">DTA (Asset)</SelectItem>
                              <SelectItem value="DTL">DTL (Liability)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Accounting Base</Label><Input type="number" step="0.01" name="accounting_base" required /></div>
                        <div><Label>Tax Base</Label><Input type="number" step="0.01" name="tax_base" required /></div>
                      </div>
                      <div><Label>Tax Rate</Label><Input type="number" step="0.0001" name="tax_rate" defaultValue="0.225" required /></div>
                      <div><Label>Notes</Label><Input name="notes" /></div>
                      <Button type="submit" className="w-full">Add</Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {!currentRun ? (
              <p className="text-sm text-muted-foreground">Select a run to view items.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Acct Base</TableHead>
                    <TableHead className="text-right">Tax Base</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">DT Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.item_name}</TableCell>
                      <TableCell>{i.category}</TableCell>
                      <TableCell className="text-right">{fmt(i.accounting_base)}</TableCell>
                      <TableCell className="text-right">{fmt(i.tax_base)}</TableCell>
                      <TableCell className="text-right">{fmt(i.temporary_difference)}</TableCell>
                      <TableCell className="text-right">{(i.tax_rate * 100).toFixed(2)}%</TableCell>
                      <TableCell><Badge variant={i.dt_type === "DTA" ? "secondary" : "default"}>{i.dt_type}</Badge></TableCell>
                      <TableCell className="text-right font-medium">{fmt(i.deferred_tax_amount)}</TableCell>
                    </TableRow>
                  ))}
                  {items.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No items — add temporary differences.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
