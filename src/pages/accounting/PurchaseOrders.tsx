import { useState, useMemo } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, ArrowRight, PackageCheck, CheckCircle2 } from "lucide-react";

type Line = { id?: string; item_description: string; quantity: number; unit_price: number; discount_pct: number; tax_pct: number; received_qty?: number; };

const emptyLine = (): Line => ({ item_description: "", quantity: 1, unit_price: 0, discount_pct: 0, tax_pct: 14 });

const money = (n: number | null | undefined, cur = "EGP") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(Number(n || 0));

const lineTotal = (l: Line) =>
  l.quantity * l.unit_price * (1 - l.discount_pct / 100) * (1 + l.tax_pct / 100);

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700",
    submitted: "bg-blue-100 text-blue-700",
    approved: "bg-emerald-100 text-emerald-700",
    sent: "bg-indigo-100 text-indigo-700",
    partially_received: "bg-amber-100 text-amber-700",
    received: "bg-teal-100 text-teal-700",
    invoiced: "bg-purple-100 text-purple-700",
    closed: "bg-gray-100 text-gray-700",
    rejected: "bg-red-100 text-red-700",
    converted: "bg-cyan-100 text-cyan-700",
  };
  return <Badge className={map[status] || "bg-slate-100 text-slate-700"}>{status.replace(/_/g, " ")}</Badge>;
}

export default function PurchaseOrders() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("requisitions");

  // ---------- Requisitions ----------
  const { data: reqs = [] } = useQuery({
    queryKey: ["purchase_requisitions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_requisitions").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: pos = [] } = useQuery({
    queryKey: ["purchase_orders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const [reqDialog, setReqDialog] = useState(false);
  const [reqEdit, setReqEdit] = useState<any>(null);
  const [reqLines, setReqLines] = useState<Line[]>([emptyLine()]);
  const [reqForm, setReqForm] = useState({ department: "", requested_by: "", needed_by: "", currency: "EGP", notes: "" });

  const openReq = (r?: any) => {
    if (r) {
      setReqEdit(r);
      setReqForm({ department: r.department || "", requested_by: r.requested_by || "", needed_by: r.needed_by || "", currency: r.currency, notes: r.notes || "" });
      supabase.from("purchase_requisition_lines").select("*").eq("requisition_id", r.id).then(({ data }) => setReqLines(data?.length ? data : [emptyLine()]));
    } else {
      setReqEdit(null);
      setReqForm({ department: "", requested_by: "", needed_by: "", currency: "EGP", notes: "" });
      setReqLines([emptyLine()]);
    }
    setReqDialog(true);
  };

  const saveReq = useMutation({
    mutationFn: async () => {
      let id = reqEdit?.id;
      if (!id) {
        const no = "PR-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
        const { data, error } = await supabase.from("purchase_requisitions").insert({ requisition_no: no, ...reqForm, needed_by: reqForm.needed_by || null }).select().single();
        if (error) throw error;
        id = data.id;
      } else {
        await supabase.from("purchase_requisitions").update({ ...reqForm, needed_by: reqForm.needed_by || null }).eq("id", id);
        await supabase.from("purchase_requisition_lines").delete().eq("requisition_id", id);
      }
      const lines = reqLines.filter((l) => l.item_description).map((l) => ({ requisition_id: id, item_description: l.item_description, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, tax_pct: l.tax_pct }));
      if (lines.length) await supabase.from("purchase_requisition_lines").insert(lines);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_requisitions"] });
      setReqDialog(false);
      toast({ title: "Saved", description: "Requisition saved." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setReqStatus = useMutation({
    mutationFn: async ({ id, status }: any) => {
      const patch: any = { status };
      if (status === "approved") patch.approved_at = new Date().toISOString();
      const { error } = await supabase.from("purchase_requisitions").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase_requisitions"] }),
  });

  const convertReq = useMutation({
    mutationFn: async ({ id, vendor }: any) => {
      const { data, error } = await supabase.rpc("convert_requisition_to_po", { _req_id: id, _vendor_name: vendor });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_requisitions"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      toast({ title: "Converted", description: "Requisition converted to PO." });
      setTab("orders");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ---------- Purchase Orders ----------
  const [poDialog, setPoDialog] = useState(false);
  const [poEdit, setPoEdit] = useState<any>(null);
  const [poLines, setPoLines] = useState<Line[]>([emptyLine()]);
  const [poForm, setPoForm] = useState({ vendor_name: "", order_date: new Date().toISOString().slice(0, 10), expected_delivery: "", currency: "EGP", payment_terms: "Net 30", notes: "" });

  const openPo = (p?: any) => {
    if (p) {
      setPoEdit(p);
      setPoForm({ vendor_name: p.vendor_name, order_date: p.order_date, expected_delivery: p.expected_delivery || "", currency: p.currency, payment_terms: p.payment_terms || "Net 30", notes: p.notes || "" });
      supabase.from("purchase_order_lines").select("*").eq("po_id", p.id).then(({ data }) => setPoLines(data?.length ? data : [emptyLine()]));
    } else {
      setPoEdit(null);
      setPoForm({ vendor_name: "", order_date: new Date().toISOString().slice(0, 10), expected_delivery: "", currency: "EGP", payment_terms: "Net 30", notes: "" });
      setPoLines([emptyLine()]);
    }
    setPoDialog(true);
  };

  const savePo = useMutation({
    mutationFn: async () => {
      let id = poEdit?.id;
      if (!id) {
        const no = "PO-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
        const { data, error } = await supabase.from("purchase_orders").insert({ po_no: no, ...poForm, expected_delivery: poForm.expected_delivery || null }).select().single();
        if (error) throw error;
        id = data.id;
      } else {
        await supabase.from("purchase_orders").update({ ...poForm, expected_delivery: poForm.expected_delivery || null }).eq("id", id);
        await supabase.from("purchase_order_lines").delete().eq("po_id", id);
      }
      const lines = poLines.filter((l) => l.item_description).map((l) => ({ po_id: id, item_description: l.item_description, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, tax_pct: l.tax_pct }));
      if (lines.length) await supabase.from("purchase_order_lines").insert(lines);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      setPoDialog(false);
      toast({ title: "Saved", description: "Purchase order saved." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setPoStatus = useMutation({
    mutationFn: async ({ id, status }: any) => {
      const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase_orders"] }),
  });

  // ---------- Receive dialog ----------
  const [recvDialog, setRecvDialog] = useState(false);
  const [recvPo, setRecvPo] = useState<any>(null);
  const [recvLines, setRecvLines] = useState<any[]>([]);

  const openRecv = async (p: any) => {
    setRecvPo(p);
    const { data } = await supabase.from("purchase_order_lines").select("*").eq("po_id", p.id);
    setRecvLines((data || []).map((l) => ({ ...l, to_receive: Math.max(0, Number(l.quantity) - Number(l.received_qty || 0)) })));
    setRecvDialog(true);
  };

  const receive = useMutation({
    mutationFn: async () => {
      const lines = recvLines.filter((l) => Number(l.to_receive) > 0).map((l) => ({ po_line_id: l.id, received_qty: Number(l.to_receive) }));
      if (!lines.length) throw new Error("Nothing to receive");
      const { error } = await supabase.rpc("receive_purchase_order", { _po_id: recvPo.id, _lines: lines, _received_by: null, _notes: null });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      setRecvDialog(false);
      toast({ title: "Received", description: "Goods receipt recorded." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const kpi = useMemo(() => ({
    openReqs: reqs.filter((r: any) => ["draft", "submitted", "approved"].includes(r.status)).length,
    openPos: pos.filter((p: any) => !["closed", "invoiced"].includes(p.status)).length,
    poValue: pos.reduce((s: number, p: any) => s + Number(p.grand_total || 0), 0),
    pendingReceipt: pos.filter((p: any) => ["approved", "sent", "partially_received"].includes(p.status)).length,
  }), [reqs, pos]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Purchase Requisitions & Orders</h1>
        <p className="text-muted-foreground">Procurement workflow with 3-way matching (PO ↔ Receipt ↔ Invoice).</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Open Requisitions</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{kpi.openReqs}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Open POs</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{kpi.openPos}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">PO Value</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{money(kpi.poValue)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Awaiting Receipt</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{kpi.pendingReceipt}</CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requisitions">Requisitions</TabsTrigger>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="requisitions" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openReq()}><Plus className="h-4 w-4 mr-2" />New Requisition</Button>
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>No</TableHead><TableHead>Department</TableHead><TableHead>Requested By</TableHead>
                <TableHead>Date</TableHead><TableHead>Needed By</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {reqs.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.requisition_no}</TableCell>
                    <TableCell>{r.department || "—"}</TableCell>
                    <TableCell>{r.requested_by || "—"}</TableCell>
                    <TableCell>{r.request_date}</TableCell>
                    <TableCell>{r.needed_by || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{money(r.grand_total, r.currency)}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => openReq(r)}>Edit</Button>
                      {r.status === "draft" && <Button size="sm" variant="outline" onClick={() => setReqStatus.mutate({ id: r.id, status: "submitted" })}>Submit</Button>}
                      {r.status === "submitted" && <Button size="sm" onClick={() => setReqStatus.mutate({ id: r.id, status: "approved" })}>Approve</Button>}
                      {r.status === "approved" && <Button size="sm" onClick={() => {
                        const v = window.prompt("Vendor name for this PO:");
                        if (v) convertReq.mutate({ id: r.id, vendor: v });
                      }}><ArrowRight className="h-4 w-4 mr-1" />Convert to PO</Button>}
                    </TableCell>
                  </TableRow>
                ))}
                {!reqs.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No requisitions yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="orders" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openPo()}><Plus className="h-4 w-4 mr-2" />New Purchase Order</Button>
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>PO No</TableHead><TableHead>Vendor</TableHead><TableHead>Order Date</TableHead>
                <TableHead>Expected</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Received</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pos.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.po_no}</TableCell>
                    <TableCell>{p.vendor_name}</TableCell>
                    <TableCell>{p.order_date}</TableCell>
                    <TableCell>{p.expected_delivery || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{money(p.grand_total, p.currency)}</TableCell>
                    <TableCell className="text-right">{money(p.received_total, p.currency)}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => openPo(p)}>Edit</Button>
                      {p.status === "draft" && <Button size="sm" onClick={() => setPoStatus.mutate({ id: p.id, status: "approved" })}>Approve</Button>}
                      {p.status === "approved" && <Button size="sm" onClick={() => setPoStatus.mutate({ id: p.id, status: "sent" })}>Send</Button>}
                      {["approved", "sent", "partially_received"].includes(p.status) && <Button size="sm" onClick={() => openRecv(p)}><PackageCheck className="h-4 w-4 mr-1" />Receive</Button>}
                      {p.status === "received" && <Button size="sm" variant="outline" onClick={() => setPoStatus.mutate({ id: p.id, status: "closed" })}><CheckCircle2 className="h-4 w-4 mr-1" />Close</Button>}
                    </TableCell>
                  </TableRow>
                ))}
                {!pos.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No purchase orders yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Requisition dialog */}
      <Dialog open={reqDialog} onOpenChange={setReqDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{reqEdit ? "Edit Requisition" : "New Requisition"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Department</Label><Input value={reqForm.department} onChange={(e) => setReqForm({ ...reqForm, department: e.target.value })} /></div>
            <div><Label>Requested By</Label><Input value={reqForm.requested_by} onChange={(e) => setReqForm({ ...reqForm, requested_by: e.target.value })} /></div>
            <div><Label>Needed By</Label><DateInput  value={reqForm.needed_by} onChange={(e) => setReqForm({ ...reqForm, needed_by: e.target.value })} /></div>
            <div><Label>Currency</Label>
              <Select value={reqForm.currency} onValueChange={(v) => setReqForm({ ...reqForm, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="EGP">EGP</SelectItem><SelectItem value="USD">USD</SelectItem><SelectItem value="EUR">EUR</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Notes</Label><Input value={reqForm.notes} onChange={(e) => setReqForm({ ...reqForm, notes: e.target.value })} /></div>
          </div>
          <LineEditor lines={reqLines} setLines={setReqLines} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqDialog(false)}>Cancel</Button>
            <Button onClick={() => saveReq.mutate()} disabled={saveReq.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO dialog */}
      <Dialog open={poDialog} onOpenChange={setPoDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{poEdit ? "Edit Purchase Order" : "New Purchase Order"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Vendor</Label><Input value={poForm.vendor_name} onChange={(e) => setPoForm({ ...poForm, vendor_name: e.target.value })} /></div>
            <div><Label>Payment Terms</Label><Input value={poForm.payment_terms} onChange={(e) => setPoForm({ ...poForm, payment_terms: e.target.value })} /></div>
            <div><Label>Order Date</Label><DateInput  value={poForm.order_date} onChange={(e) => setPoForm({ ...poForm, order_date: e.target.value })} /></div>
            <div><Label>Expected Delivery</Label><DateInput  value={poForm.expected_delivery} onChange={(e) => setPoForm({ ...poForm, expected_delivery: e.target.value })} /></div>
            <div><Label>Currency</Label>
              <Select value={poForm.currency} onValueChange={(v) => setPoForm({ ...poForm, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="EGP">EGP</SelectItem><SelectItem value="USD">USD</SelectItem><SelectItem value="EUR">EUR</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Notes</Label><Input value={poForm.notes} onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })} /></div>
          </div>
          <LineEditor lines={poLines} setLines={setPoLines} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPoDialog(false)}>Cancel</Button>
            <Button onClick={() => savePo.mutate()} disabled={savePo.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive dialog */}
      <Dialog open={recvDialog} onOpenChange={setRecvDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Receive Goods · {recvPo?.po_no}</DialogTitle></DialogHeader>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Item</TableHead><TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Already Received</TableHead><TableHead className="text-right">Receive Now</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {recvLines.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell>{l.item_description}</TableCell>
                  <TableCell className="text-right">{l.quantity}</TableCell>
                  <TableCell className="text-right">{l.received_qty}</TableCell>
                  <TableCell className="text-right">
                    <Input type="number" className="w-24 ml-auto text-right" value={l.to_receive}
                      onChange={(e) => { const arr = [...recvLines]; arr[i].to_receive = Number(e.target.value); setRecvLines(arr); }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecvDialog(false)}>Cancel</Button>
            <Button onClick={() => receive.mutate()} disabled={receive.isPending}>Record Receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LineEditor({ lines, setLines }: { lines: Line[]; setLines: (l: Line[]) => void }) {
  const update = (i: number, patch: Partial<Line>) => {
    const arr = [...lines]; arr[i] = { ...arr[i], ...patch }; setLines(arr);
  };
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  return (
    <div className="border rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-base">Lines</Label>
        <Button size="sm" variant="outline" onClick={() => setLines([...lines, emptyLine()])}><Plus className="h-4 w-4 mr-1" />Add Line</Button>
      </div>
      <Table>
        <TableHeader><TableRow>
          <TableHead>Description</TableHead><TableHead className="w-20">Qty</TableHead>
          <TableHead className="w-28">Unit Price</TableHead><TableHead className="w-20">Disc %</TableHead>
          <TableHead className="w-20">Tax %</TableHead><TableHead className="w-28 text-right">Total</TableHead><TableHead className="w-10"></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {lines.map((l, i) => (
            <TableRow key={i}>
              <TableCell><Input value={l.item_description} onChange={(e) => update(i, { item_description: e.target.value })} /></TableCell>
              <TableCell><Input type="number" value={l.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} /></TableCell>
              <TableCell><Input type="number" value={l.unit_price} onChange={(e) => update(i, { unit_price: Number(e.target.value) })} /></TableCell>
              <TableCell><Input type="number" value={l.discount_pct} onChange={(e) => update(i, { discount_pct: Number(e.target.value) })} /></TableCell>
              <TableCell><Input type="number" value={l.tax_pct} onChange={(e) => update(i, { tax_pct: Number(e.target.value) })} /></TableCell>
              <TableCell className="text-right">{money(lineTotal(l))}</TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="text-right font-semibold">Grand Total: {money(total)}</div>
    </div>
  );
}
