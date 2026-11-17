import { useState } from "react";
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
import { format, differenceInDays } from "date-fns";

type BG = {
  id: string; reference_number: string; guarantee_type: string; issuing_bank: string;
  beneficiary: string; amount: number; currency: string; issue_date: string; expiry_date: string;
  margin_held: number; commission_rate: number; status: string; purpose: string | null;
};

type Ev = {
  id: string; event_type: string; event_date: string; amount_delta: number;
  new_expiry_date: string | null; notes: string | null;
};

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankGuaranteesPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [evOpen, setEvOpen] = useState(false);

  const [form, setForm] = useState({
    reference_number: "", guarantee_type: "LG", issuing_bank: "", beneficiary: "",
    amount: "", currency: "EGP", issue_date: format(new Date(), "yyyy-MM-dd"),
    expiry_date: format(new Date(), "yyyy-MM-dd"), margin_held: "0", commission_rate: "0", purpose: "",
  });

  const [ev, setEv] = useState({
    event_type: "amended", event_date: format(new Date(), "yyyy-MM-dd"),
    amount_delta: "0", new_expiry_date: "", notes: "",
  });

  const { data: bgs = [], isLoading } = useQuery({
    queryKey: ["bank_guarantees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_guarantees").select("*").order("expiry_date");
      if (error) throw error;
      return (data ?? []) as BG[];
    },
  });

  const { data: events = [] } = useQuery({
    queryKey: ["bg_events", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_guarantee_events")
        .select("*").eq("guarantee_id", selectedId!).order("event_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Ev[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("bank_guarantees").insert({
        reference_number: form.reference_number, guarantee_type: form.guarantee_type,
        issuing_bank: form.issuing_bank, beneficiary: form.beneficiary,
        amount: Number(form.amount), currency: form.currency,
        issue_date: form.issue_date, expiry_date: form.expiry_date,
        margin_held: Number(form.margin_held), commission_rate: Number(form.commission_rate) / 100,
        purpose: form.purpose || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Guarantee added"); setNewOpen(false); qc.invalidateQueries({ queryKey: ["bank_guarantees"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const recordEvent = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("record_bg_event", {
        p_guarantee_id: selectedId!, p_event_type: ev.event_type, p_event_date: ev.event_date,
        p_amount_delta: Number(ev.amount_delta || 0),
        p_new_expiry_date: ev.new_expiry_date || null, p_notes: ev.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event recorded"); setEvOpen(false);
      qc.invalidateQueries({ queryKey: ["bg_events", selectedId] });
      qc.invalidateQueries({ queryKey: ["bank_guarantees"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const expireSweep = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("expire_bank_guarantees");
      if (error) throw error;
      return data;
    },
    onSuccess: (n) => { toast.success(`${n} guarantees expired`); qc.invalidateQueries({ queryKey: ["bank_guarantees"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const totalActive = bgs.filter(b => b.status === "active").reduce((s, b) => s + Number(b.amount), 0);
  const expiringSoon = bgs.filter(b => b.status === "active" && differenceInDays(new Date(b.expiry_date), new Date()) <= 30);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Bank Guarantees & Letters of Credit</h1>
          <p className="text-muted-foreground">Track LGs, LCs, SBLCs and record amendments, calls, and releases</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => expireSweep.mutate()}>Run Expiry Sweep</Button>
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Guarantee</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Register Bank Guarantee / LC</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Reference Number</Label><Input value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} /></div>
                <div>
                  <Label>Type</Label>
                  <Select value={form.guarantee_type} onValueChange={v => setForm({ ...form, guarantee_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LG">Letter of Guarantee</SelectItem>
                      <SelectItem value="LC">Letter of Credit</SelectItem>
                      <SelectItem value="SBLC">Standby LC</SelectItem>
                      <SelectItem value="performance">Performance Bond</SelectItem>
                      <SelectItem value="bid_bond">Bid Bond</SelectItem>
                      <SelectItem value="advance_payment">Advance Payment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Issuing Bank</Label><Input value={form.issuing_bank} onChange={e => setForm({ ...form, issuing_bank: e.target.value })} /></div>
                <div><Label>Beneficiary</Label><Input value={form.beneficiary} onChange={e => setForm({ ...form, beneficiary: e.target.value })} /></div>
                <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                <div><Label>Currency</Label><Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} /></div>
                <div><Label>Issue Date</Label><DateInput  value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} /></div>
                <div><Label>Expiry Date</Label><DateInput  value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} /></div>
                <div><Label>Margin Held</Label><Input type="number" value={form.margin_held} onChange={e => setForm({ ...form, margin_held: e.target.value })} /></div>
                <div><Label>Commission Rate (%)</Label><Input type="number" step="0.01" value={form.commission_rate} onChange={e => setForm({ ...form, commission_rate: e.target.value })} /></div>
                <div className="col-span-2"><Label>Purpose</Label><Textarea value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} /></div>
              </div>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Register
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Active Guarantees</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{bgs.filter(b => b.status === "active").length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Outstanding</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totalActive)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Expiring ≤30 Days</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{expiringSoon.length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Guarantees</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loader2 className="animate-spin" /> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Ref #</TableHead><TableHead>Type</TableHead><TableHead>Bank</TableHead>
                <TableHead>Beneficiary</TableHead><TableHead>Amount</TableHead>
                <TableHead>Expiry</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {bgs.map(b => {
                  const days = differenceInDays(new Date(b.expiry_date), new Date());
                  return (
                    <TableRow key={b.id} className={selectedId === b.id ? "bg-muted" : "cursor-pointer"} onClick={() => setSelectedId(b.id)}>
                      <TableCell className="font-medium">{b.reference_number}</TableCell>
                      <TableCell>{b.guarantee_type}</TableCell>
                      <TableCell>{b.issuing_bank}</TableCell>
                      <TableCell>{b.beneficiary}</TableCell>
                      <TableCell>{fmt(b.amount)} {b.currency}</TableCell>
                      <TableCell className={b.status === "active" && days <= 30 ? "text-amber-600 font-medium" : ""}>
                        {format(new Date(b.expiry_date), "dd/MM/yyyy")}
                        {b.status === "active" && days <= 30 && ` (${days}d)`}
                      </TableCell>
                      <TableCell><Badge variant={b.status === "active" ? "default" : "secondary"}>{b.status}</Badge></TableCell>
                    </TableRow>
                  );
                })}
                {bgs.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No guarantees registered</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedId && (
        <Card>
          <CardHeader className="flex flex-row justify-between items-center">
            <CardTitle>Events</CardTitle>
            <Dialog open={evOpen} onOpenChange={setEvOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />Record Event</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Guarantee Event</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Event Type</Label>
                    <Select value={ev.event_type} onValueChange={v => setEv({ ...ev, event_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="amended">Amended (amount change)</SelectItem>
                        <SelectItem value="extended">Extended (new expiry)</SelectItem>
                        <SelectItem value="called">Called (encashed)</SelectItem>
                        <SelectItem value="released">Released</SelectItem>
                        <SelectItem value="commission_charged">Commission Charged</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Event Date</Label><DateInput  value={ev.event_date} onChange={e => setEv({ ...ev, event_date: e.target.value })} /></div>
                  {ev.event_type === "amended" && <div><Label>Amount Delta (±)</Label><Input type="number" value={ev.amount_delta} onChange={e => setEv({ ...ev, amount_delta: e.target.value })} /></div>}
                  {ev.event_type === "extended" && <div><Label>New Expiry Date</Label><DateInput  value={ev.new_expiry_date} onChange={e => setEv({ ...ev, new_expiry_date: e.target.value })} /></div>}
                  <div><Label>Notes</Label><Textarea value={ev.notes} onChange={e => setEv({ ...ev, notes: e.target.value })} /></div>
                </div>
                <Button onClick={() => recordEvent.mutate()} disabled={recordEvent.isPending}>
                  {recordEvent.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Record
                </Button>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Event</TableHead><TableHead>Amount Δ</TableHead>
                <TableHead>New Expiry</TableHead><TableHead>Notes</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {events.map(e => (
                  <TableRow key={e.id}>
                    <TableCell>{format(new Date(e.event_date), "dd/MM/yyyy")}</TableCell>
                    <TableCell><Badge variant="outline">{e.event_type}</Badge></TableCell>
                    <TableCell>{e.amount_delta ? fmt(e.amount_delta) : "—"}</TableCell>
                    <TableCell>{e.new_expiry_date ? format(new Date(e.new_expiry_date), "dd/MM/yyyy") : "—"}</TableCell>
                    <TableCell>{e.notes || "—"}</TableCell>
                  </TableRow>
                ))}
                {events.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No events recorded</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
