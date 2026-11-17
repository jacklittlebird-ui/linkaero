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
import { Plus, ShieldAlert } from "lucide-react";

const TYPES = ["legal", "warranty", "restructuring", "onerous_contract", "decommissioning", "other"];
const CLASSIFICATIONS = ["provision", "contingent_liability", "contingent_asset"];
const PROBABILITIES = ["probable", "possible", "remote"];
const MOVEMENT_TYPES = ["addition", "utilization", "reversal", "unwinding"];
const STATUSES = ["open", "settled", "reversed"];

export default function ProvisionsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [openMv, setOpenMv] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["provisions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("provisions").select("*").order("recognition_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const current = rows.find((r) => r.id === selected);

  const { data: movements = [] } = useQuery({
    queryKey: ["provision_movements", selected],
    enabled: !!selected,
    queryFn: async () =>
      (await supabase.from("provision_movements").select("*").eq("provision_id", selected).order("movement_date")).data || [],
  });

  const totals = rows.reduce(
    (a, r) => ({
      open: a.open + Number(r.opening_balance || 0),
      close: a.close + Number(r.closing_balance || 0),
      add: a.add + Number(r.additions || 0),
      util: a.util + Number(r.utilizations || 0),
    }),
    { open: 0, close: 0, add: 0, util: 0 }
  );

  const createProvision = async (f: FormData) => {
    const payload: any = {
      company_code: f.get("company_code"),
      provision_ref: f.get("provision_ref"),
      provision_type: f.get("provision_type"),
      classification: f.get("classification"),
      probability: f.get("probability"),
      description: f.get("description") || null,
      currency: f.get("currency") || "USD",
      recognition_date: f.get("recognition_date"),
      expected_settlement_date: f.get("expected_settlement_date") || null,
      discount_rate: Number(f.get("discount_rate") || 0),
      opening_balance: Number(f.get("opening_balance") || 0),
      closing_balance: Number(f.get("opening_balance") || 0),
      status: "open",
    };
    const { error } = await supabase.from("provisions").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Provision created");
    setOpenNew(false);
    qc.invalidateQueries({ queryKey: ["provisions"] });
  };

  const addMovement = async (f: FormData) => {
    if (!selected) return;
    const payload: any = {
      provision_id: selected,
      movement_date: f.get("movement_date"),
      movement_type: f.get("movement_type"),
      amount: Number(f.get("amount") || 0),
      memo: f.get("memo") || null,
    };
    const { error } = await supabase.from("provision_movements").insert(payload);
    if (error) return toast.error(error.message);
    await supabase.rpc("recompute_provision", { _provision_id: selected });
    toast.success("Movement recorded");
    setOpenMv(false);
    qc.invalidateQueries({ queryKey: ["provisions"] });
    qc.invalidateQueries({ queryKey: ["provision_movements", selected] });
  };

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("provisions").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${status}`);
    qc.invalidateQueries({ queryKey: ["provisions"] });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Provisions & Contingencies (IAS 37)</h1>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />New Provision</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New Provision</DialogTitle></DialogHeader>
            <form
              onSubmit={(e) => { e.preventDefault(); createProvision(new FormData(e.currentTarget)); }}
              className="grid grid-cols-2 gap-3"
            >
              <div><Label>Company Code</Label><Input name="company_code" required /></div>
              <div><Label>Provision Ref</Label><Input name="provision_ref" required /></div>
              <div>
                <Label>Type</Label>
                <Select name="provision_type" defaultValue="legal">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Classification</Label>
                <Select name="classification" defaultValue="provision">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CLASSIFICATIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Probability</Label>
                <Select name="probability" defaultValue="probable">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PROBABILITIES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Currency</Label><Input name="currency" defaultValue="USD" /></div>
              <div><Label>Recognition Date</Label><DateInput  name="recognition_date" required /></div>
              <div><Label>Expected Settlement Date</Label><DateInput  name="expected_settlement_date" /></div>
              <div><Label>Discount Rate (%)</Label><Input type="number" step="0.01" name="discount_rate" defaultValue="0" /></div>
              <div><Label>Opening Balance</Label><Input type="number" step="0.01" name="opening_balance" defaultValue="0" /></div>
              <div className="col-span-2"><Label>Description</Label><Textarea name="description" /></div>
              <div className="col-span-2 flex justify-end"><Button type="submit">Create</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Total Opening</div><div className="text-xl font-bold">{totals.open.toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Additions</div><div className="text-xl font-bold">{totals.add.toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Utilizations</div><div className="text-xl font-bold">{totals.util.toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Total Closing</div><div className="text-xl font-bold">{totals.close.toFixed(2)}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Register</TabsTrigger>
          <TabsTrigger value="detail" disabled={!selected}>Movements</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <Card>
            <CardHeader><CardTitle>Provisions Register</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Probability</TableHead>
                    <TableHead>Recognized</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className={selected === r.id ? "bg-muted/50" : ""}>
                      <TableCell className="font-medium">{r.provision_ref}</TableCell>
                      <TableCell>{r.company_code}</TableCell>
                      <TableCell>{r.provision_type}</TableCell>
                      <TableCell><Badge variant="outline">{r.classification}</Badge></TableCell>
                      <TableCell>{r.probability}</TableCell>
                      <TableCell>{r.recognition_date}</TableCell>
                      <TableCell className="text-right">{Number(r.opening_balance).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-semibold">{Number(r.closing_balance).toFixed(2)}</TableCell>
                      <TableCell><Badge>{r.status}</Badge></TableCell>
                      <TableCell className="space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => setSelected(r.id)}>Open</Button>
                        {r.status === "open" && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => updateStatus(r.id, "settled")}>Settle</Button>
                            <Button size="sm" variant="ghost" onClick={() => updateStatus(r.id, "reversed")}>Reverse</Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="detail">
          {current && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{current.provision_ref} — Movements</CardTitle>
                <Dialog open={openMv} onOpenChange={setOpenMv}>
                  <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Movement</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Record Movement</DialogTitle></DialogHeader>
                    <form
                      onSubmit={(e) => { e.preventDefault(); addMovement(new FormData(e.currentTarget)); }}
                      className="grid gap-3"
                    >
                      <div><Label>Date</Label><DateInput  name="movement_date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
                      <div>
                        <Label>Type</Label>
                        <Select name="movement_type" defaultValue="addition">
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{MOVEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label>Amount</Label><Input type="number" step="0.01" name="amount" required /></div>
                      <div><Label>Memo</Label><Textarea name="memo" /></div>
                      <div className="flex justify-end"><Button type="submit">Record</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-3 mb-4 text-sm">
                  <div><div className="text-muted-foreground">Opening</div><div className="font-semibold">{Number(current.opening_balance).toFixed(2)}</div></div>
                  <div><div className="text-muted-foreground">Additions</div><div className="font-semibold">{Number(current.additions).toFixed(2)}</div></div>
                  <div><div className="text-muted-foreground">Utilizations</div><div className="font-semibold">{Number(current.utilizations).toFixed(2)}</div></div>
                  <div><div className="text-muted-foreground">Reversals</div><div className="font-semibold">{Number(current.reversals).toFixed(2)}</div></div>
                  <div><div className="text-muted-foreground">Unwinding</div><div className="font-semibold">{Number(current.unwinding_of_discount).toFixed(2)}</div></div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Memo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell>{m.movement_date}</TableCell>
                        <TableCell><Badge variant="outline">{m.movement_type}</Badge></TableCell>
                        <TableCell className="text-right">{Number(m.amount).toFixed(2)}</TableCell>
                        <TableCell>{m.memo}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
