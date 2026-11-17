// Phase 2m: Fixed Asset Register Enhancements
// -------------------------------------------------------------
// - Barcode/QR tagging (asset_code / barcode / serial)
// - Transfer workflow (location, custodian, department)
// - Disposal workflow (sale/scrap/donation) with gain/loss
// - Physical count sessions with variance detection
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, Plus, ArrowRightLeft, Trash2, ClipboardCheck, ScanLine, Package } from "lucide-react";
import { format } from "date-fns";
import { exportToExcel } from "@/lib/exportExcel";
import { toast } from "sonner";

type Asset = {
  id: string;
  asset_code: string;
  asset_name: string;
  location: string | null;
  department: string | null;
  custodian: string | null;
  serial_number: string | null;
  barcode: string | null;
  status: string | null;
  cost: number | null;
  accumulated_depreciation: number | null;
};

const statusColor: Record<string, string> = {
  draft: "secondary", approved: "default", completed: "default",
  posted: "default", cancelled: "outline", in_progress: "default",
};

const varianceColor: Record<string, string> = {
  match: "default",
  location_mismatch: "outline",
  condition_issue: "outline",
  not_in_register: "destructive",
  missing: "destructive",
};

export default function FixedAssetsEnhanced() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("transfers");

  const { data: assets = [] } = useQuery({
    queryKey: ["fixed_assets", "min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fixed_assets" as any)
        .select("id,asset_code,asset_name,location,department,custodian,serial_number,barcode,status,cost,accumulated_depreciation")
        .order("asset_code");
      if (error) throw error;
      return (data ?? []) as any as Asset[];
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="h-6 w-6" /> Fixed Asset Register — Advanced
        </h1>
        <p className="text-sm text-muted-foreground">
          Transfers, disposals, physical counts, and barcode/QR tagging.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="transfers"><ArrowRightLeft className="h-4 w-4 mr-1" />Transfers</TabsTrigger>
          <TabsTrigger value="disposals"><Trash2 className="h-4 w-4 mr-1" />Disposals</TabsTrigger>
          <TabsTrigger value="counts"><ClipboardCheck className="h-4 w-4 mr-1" />Physical Counts</TabsTrigger>
          <TabsTrigger value="tags"><ScanLine className="h-4 w-4 mr-1" />Barcode / QR Tags</TabsTrigger>
        </TabsList>

        <TabsContent value="transfers"><TransfersPanel assets={assets} /></TabsContent>
        <TabsContent value="disposals"><DisposalsPanel assets={assets} /></TabsContent>
        <TabsContent value="counts"><PhysicalCountsPanel assets={assets} /></TabsContent>
        <TabsContent value="tags"><TagsPanel assets={assets} onSaved={() => qc.invalidateQueries({ queryKey: ["fixed_assets"] })} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------- Transfers ----------------
function TransfersPanel({ assets }: { assets: Asset[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["asset_transfers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("asset_transfers" as any).select("*").order("transfer_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from("asset_transfers" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_transfers"] });
      setOpen(false);
      toast.success("Transfer recorded");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const complete = useMutation({
    mutationFn: async (row: any) => {
      const { error: e1 } = await supabase.from("asset_transfers" as any)
        .update({ status: "completed" }).eq("id", row.id);
      if (e1) throw e1;
      const patch: any = {};
      if (row.to_location) patch.location = row.to_location;
      if (row.to_custodian) patch.custodian = row.to_custodian;
      if (row.to_department) patch.department = row.to_department;
      if (Object.keys(patch).length) {
        const { error: e2 } = await supabase.from("fixed_assets" as any).update(patch).eq("id", row.asset_id);
        if (e2) throw e2;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_transfers"] });
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      toast.success("Transfer completed");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const assetOf = (id: string) => assets.find(a => a.id === id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Asset Transfers</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportToExcel(rows.map((r: any) => ({
            Date: r.transfer_date, Asset: assetOf(r.asset_id)?.asset_code ?? "-",
            From: r.from_location, To: r.to_location, Custodian: r.to_custodian, Status: r.status,
          })), "Transfers", `asset-transfers-${format(new Date(), "yyyy-MM-dd")}`)}>
            <Download className="h-4 w-4 mr-2" />Export
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New Transfer</Button></DialogTrigger>
            <TransferDialog assets={assets} onSave={(p) => save.mutate(p)} saving={save.isPending} />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="overflow-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Asset</TableHead>
            <TableHead>From</TableHead><TableHead>To</TableHead>
            <TableHead>Custodian</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
              : rows.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No transfers.</TableCell></TableRow>
              : rows.map((r: any) => {
                const a = assetOf(r.asset_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell>{format(new Date(r.transfer_date), "dd/MM/yyyy")}</TableCell>
                    <TableCell><div className="font-medium">{a?.asset_name ?? "—"}</div><div className="text-xs text-muted-foreground font-mono">{a?.asset_code ?? ""}</div></TableCell>
                    <TableCell>{r.from_location ?? "-"}</TableCell>
                    <TableCell>{r.to_location}</TableCell>
                    <TableCell>{r.to_custodian ?? "-"}</TableCell>
                    <TableCell><Badge variant={statusColor[r.status] as any}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {r.status !== "completed" && r.status !== "cancelled" && (
                        <Button size="sm" variant="outline" onClick={() => complete.mutate(r)}>Complete</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TransferDialog({ assets, onSave, saving }: { assets: Asset[]; onSave: (p: any) => void; saving: boolean }) {
  const [form, setForm] = useState<any>({
    asset_id: assets[0]?.id ?? "", transfer_date: new Date().toISOString().slice(0, 10),
    from_location: "", to_location: "", from_custodian: "", to_custodian: "",
    from_department: "", to_department: "", reason: "", reference_no: "", status: "draft",
  });
  const asset = assets.find(a => a.id === form.asset_id);
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>New Asset Transfer</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Asset</Label>
          <Select value={form.asset_id} onValueChange={(v) => {
            const a = assets.find(x => x.id === v);
            setForm({ ...form, asset_id: v, from_location: a?.location ?? "", from_custodian: a?.custodian ?? "", from_department: a?.department ?? "" });
          }}>
            <SelectTrigger><SelectValue placeholder="Select asset…" /></SelectTrigger>
            <SelectContent>{assets.map(a => <SelectItem key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Transfer Date</Label><DateInput  value={form.transfer_date} onChange={(e) => setForm({ ...form, transfer_date: e.target.value })} /></div>
        <div><Label>Reference No</Label><Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
        <div><Label>From Location</Label><Input value={form.from_location} onChange={(e) => setForm({ ...form, from_location: e.target.value })} /></div>
        <div><Label>To Location</Label><Input value={form.to_location} onChange={(e) => setForm({ ...form, to_location: e.target.value })} /></div>
        <div><Label>From Custodian</Label><Input value={form.from_custodian} onChange={(e) => setForm({ ...form, from_custodian: e.target.value })} /></div>
        <div><Label>To Custodian</Label><Input value={form.to_custodian} onChange={(e) => setForm({ ...form, to_custodian: e.target.value })} /></div>
        <div><Label>From Department</Label><Input value={form.from_department} onChange={(e) => setForm({ ...form, from_department: e.target.value })} /></div>
        <div><Label>To Department</Label><Input value={form.to_department} onChange={(e) => setForm({ ...form, to_department: e.target.value })} /></div>
        <div className="col-span-2"><Label>Reason</Label><Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
      </div>
      <DialogFooter>
        <Button disabled={!form.asset_id || !form.to_location || saving} onClick={() => onSave(form)}>{saving ? "Saving…" : "Save Transfer"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------- Disposals ----------------
function DisposalsPanel({ assets }: { assets: Asset[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["asset_disposals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("asset_disposals" as any).select("*").order("disposal_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from("asset_disposals" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_disposals"] });
      setOpen(false);
      toast.success("Disposal recorded");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const post = useMutation({
    mutationFn: async (row: any) => {
      const { error: e1 } = await supabase.from("asset_disposals" as any).update({ status: "posted" }).eq("id", row.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("fixed_assets" as any).update({ status: "Disposed" }).eq("id", row.asset_id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_disposals"] });
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      toast.success("Disposal posted");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const assetOf = (id: string) => assets.find(a => a.id === id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Asset Disposals</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportToExcel(rows.map((r: any) => ({
            Date: r.disposal_date, Asset: assetOf(r.asset_id)?.asset_code ?? "-",
            Type: r.disposal_type, Amount: r.disposal_amount, "Book Value": r.book_value,
            "Gain/Loss": r.gain_loss, Status: r.status,
          })), "Disposals", `asset-disposals-${format(new Date(), "yyyy-MM-dd")}`)}>
            <Download className="h-4 w-4 mr-2" />Export
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New Disposal</Button></DialogTrigger>
            <DisposalDialog assets={assets} onSave={(p) => save.mutate(p)} saving={save.isPending} />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="overflow-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Asset</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Sale Amount</TableHead>
            <TableHead className="text-right">Book Value</TableHead>
            <TableHead className="text-right">Gain/Loss</TableHead>
            <TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No disposals.</TableCell></TableRow>
              : rows.map((r: any) => {
                const a = assetOf(r.asset_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell>{format(new Date(r.disposal_date), "dd/MM/yyyy")}</TableCell>
                    <TableCell><div className="font-medium">{a?.asset_name ?? "—"}</div><div className="text-xs text-muted-foreground font-mono">{a?.asset_code ?? ""}</div></TableCell>
                    <TableCell><Badge variant="outline">{r.disposal_type}</Badge></TableCell>
                    <TableCell className="text-right">{Number(r.disposal_amount).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{Number(r.book_value).toLocaleString()}</TableCell>
                    <TableCell className={`text-right ${Number(r.gain_loss) < 0 ? "text-destructive" : "text-emerald-600"}`}>
                      {Number(r.gain_loss).toLocaleString()}
                    </TableCell>
                    <TableCell><Badge variant={statusColor[r.status] as any}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {r.status !== "posted" && r.status !== "cancelled" && (
                        <Button size="sm" variant="outline" onClick={() => post.mutate(r)}>Post</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DisposalDialog({ assets, onSave, saving }: { assets: Asset[]; onSave: (p: any) => void; saving: boolean }) {
  const [form, setForm] = useState<any>({
    asset_id: assets[0]?.id ?? "", disposal_date: new Date().toISOString().slice(0, 10),
    disposal_type: "sale", disposal_amount: 0, buyer: "",
    book_value: 0, accumulated_depreciation: 0, gain_loss: 0,
    reason: "", reference_no: "", status: "draft",
  });
  const chooseAsset = (id: string) => {
    const a = assets.find(x => x.id === id);
    const bv = Number(a?.cost ?? 0) - Number(a?.accumulated_depreciation ?? 0);
    setForm((f: any) => ({
      ...f, asset_id: id, book_value: bv,
      accumulated_depreciation: Number(a?.accumulated_depreciation ?? 0),
      gain_loss: Number(f.disposal_amount || 0) - bv,
    }));
  };
  const setAmount = (v: number) => setForm((f: any) => ({ ...f, disposal_amount: v, gain_loss: v - Number(f.book_value || 0) }));
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>New Asset Disposal</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Asset</Label>
          <Select value={form.asset_id} onValueChange={chooseAsset}>
            <SelectTrigger><SelectValue placeholder="Select asset…" /></SelectTrigger>
            <SelectContent>{assets.map(a => <SelectItem key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Disposal Date</Label><DateInput  value={form.disposal_date} onChange={(e) => setForm({ ...form, disposal_date: e.target.value })} /></div>
        <div>
          <Label>Type</Label>
          <Select value={form.disposal_type} onValueChange={(v) => setForm({ ...form, disposal_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">Sale</SelectItem>
              <SelectItem value="scrap">Scrap</SelectItem>
              <SelectItem value="donation">Donation</SelectItem>
              <SelectItem value="loss">Loss</SelectItem>
              <SelectItem value="trade_in">Trade In</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Sale Amount</Label><Input type="number" step="0.01" value={form.disposal_amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div><Label>Buyer</Label><Input value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} /></div>
        <div><Label>Book Value</Label><Input type="number" step="0.01" value={form.book_value} onChange={(e) => setForm({ ...form, book_value: Number(e.target.value), gain_loss: Number(form.disposal_amount) - Number(e.target.value) })} /></div>
        <div><Label>Accum. Depreciation</Label><Input type="number" step="0.01" value={form.accumulated_depreciation} onChange={(e) => setForm({ ...form, accumulated_depreciation: Number(e.target.value) })} /></div>
        <div>
          <Label>Gain / (Loss)</Label>
          <Input type="number" step="0.01" value={form.gain_loss} readOnly className={Number(form.gain_loss) < 0 ? "text-destructive" : "text-emerald-600"} />
        </div>
        <div><Label>Reference No</Label><Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
        <div className="col-span-2"><Label>Reason</Label><Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
      </div>
      <DialogFooter>
        <Button disabled={!form.asset_id || saving} onClick={() => onSave(form)}>{saving ? "Saving…" : "Save Disposal"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------- Physical Counts ----------------
function PhysicalCountsPanel({ assets }: { assets: Asset[] }) {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [selectedCountId, setSelectedCountId] = useState<string | null>(null);

  const { data: counts = [] } = useQuery({
    queryKey: ["asset_physical_counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("asset_physical_counts" as any).select("*").order("count_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (payload: any) => {
      const { data, error } = await supabase.from("asset_physical_counts" as any).insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["asset_physical_counts"] });
      setNewOpen(false);
      setSelectedCountId(row.id);
      toast.success("Count session created");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("asset_physical_counts" as any).update({ status: "completed" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_physical_counts"] });
      toast.success("Count completed");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Count Sessions</CardTitle>
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-2" />New</Button></DialogTrigger>
            <NewCountDialog onSave={(p) => create.mutate(p)} saving={create.isPending} />
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-2">
          {counts.length === 0 && <p className="text-sm text-muted-foreground">No count sessions yet.</p>}
          {counts.map((c: any) => (
            <div key={c.id}
              className={`p-3 rounded border cursor-pointer ${selectedCountId === c.id ? "border-primary bg-accent" : ""}`}
              onClick={() => setSelectedCountId(c.id)}>
              <div className="flex justify-between items-center">
                <div className="font-medium text-sm">{c.count_no}</div>
                <Badge variant={statusColor[c.status] as any}>{c.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(c.count_date), "dd/MM/yyyy")} · {c.location ?? "—"}
              </div>
              {c.status === "in_progress" && (
                <Button size="sm" variant="outline" className="mt-2 w-full" onClick={(e) => { e.stopPropagation(); complete.mutate(c.id); }}>
                  Complete Session
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Scan / Record Lines</CardTitle></CardHeader>
        <CardContent>
          {selectedCountId ? <CountLinesPanel countId={selectedCountId} assets={assets} />
            : <p className="text-sm text-muted-foreground">Select or create a session to start scanning.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function NewCountDialog({ onSave, saving }: { onSave: (p: any) => void; saving: boolean }) {
  const [form, setForm] = useState<any>({
    count_no: `PC-${format(new Date(), "yyyyMMdd-HHmm")}`,
    count_date: new Date().toISOString().slice(0, 10),
    location: "", department: "", notes: "", status: "in_progress",
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New Physical Count Session</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Count Number</Label><Input value={form.count_no} onChange={(e) => setForm({ ...form, count_no: e.target.value })} /></div>
        <div><Label>Count Date</Label><DateInput  value={form.count_date} onChange={(e) => setForm({ ...form, count_date: e.target.value })} /></div>
        <div><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
        <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
        <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </div>
      <DialogFooter><Button disabled={saving} onClick={() => onSave(form)}>{saving ? "Creating…" : "Create"}</Button></DialogFooter>
    </DialogContent>
  );
}

function CountLinesPanel({ countId, assets }: { countId: string; assets: Asset[] }) {
  const qc = useQueryClient();
  const [scan, setScan] = useState("");
  const [actualLocation, setActualLocation] = useState("");
  const [condition, setCondition] = useState<string>("good");

  const { data: lines = [] } = useQuery({
    queryKey: ["asset_physical_count_lines", countId],
    queryFn: async () => {
      const { data, error } = await supabase.from("asset_physical_count_lines" as any)
        .select("*").eq("count_id", countId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const addLine = useMutation({
    mutationFn: async () => {
      const code = scan.trim();
      if (!code) throw new Error("Scan a code");
      const match = assets.find(a =>
        a.asset_code?.toLowerCase() === code.toLowerCase() ||
        a.barcode?.toLowerCase() === code.toLowerCase() ||
        a.serial_number?.toLowerCase() === code.toLowerCase()
      );
      let variance = "not_in_register";
      if (match) {
        const locOK = !actualLocation || !match.location || actualLocation.toLowerCase() === match.location.toLowerCase();
        const condOK = condition === "good" || condition === "fair";
        variance = !locOK ? "location_mismatch" : !condOK ? "condition_issue" : "match";
      }
      const { error } = await supabase.from("asset_physical_count_lines" as any).insert({
        count_id: countId,
        asset_id: match?.id ?? null,
        scanned_code: code,
        found: !!match,
        expected_location: match?.location ?? null,
        actual_location: actualLocation || null,
        condition,
        variance,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_physical_count_lines", countId] });
      setScan("");
      setActualLocation("");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const summary = useMemo(() => {
    const s: Record<string, number> = { match: 0, location_mismatch: 0, condition_issue: 0, not_in_register: 0, missing: 0 };
    lines.forEach((l: any) => { s[l.variance] = (s[l.variance] ?? 0) + 1; });
    return s;
  }, [lines]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2">
          <Label>Scan / enter code</Label>
          <Input
            autoFocus value={scan}
            placeholder="Barcode, asset code, or serial"
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLine.mutate()}
          />
        </div>
        <div>
          <Label>Actual location</Label>
          <Input value={actualLocation} onChange={(e) => setActualLocation(e.target.value)} />
        </div>
        <div>
          <Label>Condition</Label>
          <Select value={condition} onValueChange={setCondition}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="good">Good</SelectItem>
              <SelectItem value="fair">Fair</SelectItem>
              <SelectItem value="poor">Poor</SelectItem>
              <SelectItem value="damaged">Damaged</SelectItem>
              <SelectItem value="missing">Missing</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={() => addLine.mutate()} disabled={addLine.isPending || !scan.trim()}>
        <ScanLine className="h-4 w-4 mr-2" />Record Scan
      </Button>

      <div className="grid grid-cols-5 gap-2">
        {Object.entries(summary).map(([k, v]) => (
          <Card key={k}><CardContent className="p-3">
            <div className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</div>
            <div className="text-lg font-semibold">{v}</div>
          </CardContent></Card>
        ))}
      </div>

      <div className="max-h-96 overflow-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Scanned</TableHead><TableHead>Expected Loc</TableHead>
            <TableHead>Actual Loc</TableHead><TableHead>Condition</TableHead>
            <TableHead>Variance</TableHead></TableRow></TableHeader>
          <TableBody>
            {lines.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No scans yet.</TableCell></TableRow>
              : lines.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.scanned_code}</TableCell>
                  <TableCell>{l.expected_location ?? "-"}</TableCell>
                  <TableCell>{l.actual_location ?? "-"}</TableCell>
                  <TableCell><Badge variant="outline">{l.condition}</Badge></TableCell>
                  <TableCell><Badge variant={varianceColor[l.variance] as any}>{l.variance?.replace(/_/g, " ")}</Badge></TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------- Barcode / QR Tags ----------------
function TagsPanel({ assets, onSaved }: { assets: Asset[]; onSaved: () => void }) {
  const [editing, setEditing] = useState<Record<string, { barcode: string; serial: string }>>({});
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: async ({ id, barcode, serial }: { id: string; barcode: string; serial: string }) => {
      const { error } = await supabase.from("fixed_assets" as any)
        .update({ barcode: barcode || null, serial_number: serial || null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      onSaved();
      toast.success("Tag saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Barcode / QR / Serial Tagging</CardTitle>
        <Button variant="outline" onClick={() => window.print()}>
          <Download className="h-4 w-4 mr-2" />Print Tags
        </Button>
      </CardHeader>
      <CardContent className="overflow-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Asset Code</TableHead><TableHead>Name</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Barcode / QR</TableHead>
            <TableHead>Serial No</TableHead>
            <TableHead className="w-[80px]" /></TableRow></TableHeader>
          <TableBody>
            {assets.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No assets. Add assets in the Fixed Assets page.</TableCell></TableRow>
              : assets.map(a => {
                const st = editing[a.id] ?? { barcode: a.barcode ?? "", serial: a.serial_number ?? "" };
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono">{a.asset_code}</TableCell>
                    <TableCell>{a.asset_name}</TableCell>
                    <TableCell>{a.location ?? "-"}</TableCell>
                    <TableCell>
                      <Input value={st.barcode} onChange={(e) => setEditing({ ...editing, [a.id]: { ...st, barcode: e.target.value } })} />
                    </TableCell>
                    <TableCell>
                      <Input value={st.serial} onChange={(e) => setEditing({ ...editing, [a.id]: { ...st, serial: e.target.value } })} />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => save.mutate({ id: a.id, barcode: st.barcode, serial: st.serial })}>Save</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
