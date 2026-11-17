// Phase 3u: Lease Accounting (IFRS 16 / ASC 842)
import { DateInput } from "@/components/ui/date-input";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Calculator, CheckCircle2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { formatDateDMY } from "@/lib/utils";

export default function LeaseAccounting() {
  const qc = useQueryClient();
  const [selectedLeaseId, setSelectedLeaseId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    lease_no: "",
    lessor_name: "",
    asset_description: "",
    classification: "operating",
    start_date: "",
    end_date: "",
    term_months: 36,
    payment_amount: 0,
    payment_frequency: "monthly",
    discount_rate_pct: 5,
    currency: "EGP",
  });

  const leasesQ = useQuery({
    queryKey: ["leases"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leases" as any).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const scheduleQ = useQuery({
    queryKey: ["lease-schedule", selectedLeaseId],
    enabled: !!selectedLeaseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lease_payment_schedule" as any)
        .select("*")
        .eq("lease_id", selectedLeaseId)
        .order("period_no", { ascending: true });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).from("leases").insert(form).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      toast.success("Lease created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["leases"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const generateMut = useMutation({
    mutationFn: async (leaseId: string) => {
      const { data, error } = await (supabase as any).rpc("generate_lease_schedule", { p_lease_id: leaseId });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast.success(`Generated ${n} period(s)`);
      qc.invalidateQueries({ queryKey: ["leases"] });
      qc.invalidateQueries({ queryKey: ["lease-schedule"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const postMut = useMutation({
    mutationFn: async (scheduleId: string) => {
      const { error } = await (supabase as any).rpc("post_lease_period", { p_schedule_id: scheduleId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Period posted");
      qc.invalidateQueries({ queryKey: ["lease-schedule"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="h-6 w-6" /> Lease Accounting (IFRS 16 / ASC 842)
          </h1>
          <p className="text-sm text-muted-foreground">Right-of-Use assets, lease liabilities, and amortization schedules</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />New Lease</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Create Lease</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Lease No.</Label><Input value={form.lease_no} onChange={(e) => setForm({ ...form, lease_no: e.target.value })} /></div>
              <div><Label>Lessor</Label><Input value={form.lessor_name} onChange={(e) => setForm({ ...form, lessor_name: e.target.value })} /></div>
              <div className="col-span-2"><Label>Asset Description</Label><Input value={form.asset_description} onChange={(e) => setForm({ ...form, asset_description: e.target.value })} /></div>
              <div>
                <Label>Classification</Label>
                <Select value={form.classification} onValueChange={(v) => setForm({ ...form, classification: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operating">Operating</SelectItem>
                    <SelectItem value="finance">Finance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment Frequency</Label>
                <Select value={form.payment_frequency} onValueChange={(v) => setForm({ ...form, payment_frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annually">Annually</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Start Date</Label><DateInput  value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
              <div><Label>End Date</Label><DateInput  value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
              <div><Label>Term (months)</Label><Input type="number" value={form.term_months} onChange={(e) => setForm({ ...form, term_months: Number(e.target.value) })} /></div>
              <div><Label>Payment Amount</Label><Input type="number" value={form.payment_amount} onChange={(e) => setForm({ ...form, payment_amount: Number(e.target.value) })} /></div>
              <div><Label>Discount Rate %</Label><Input type="number" step="0.01" value={form.discount_rate_pct} onChange={(e) => setForm({ ...form, discount_rate_pct: Number(e.target.value) })} /></div>
              <div><Label>Currency</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>Lease Register</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lease No.</TableHead>
                <TableHead>Lessor / Asset</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Term</TableHead>
                <TableHead className="text-right">Payment</TableHead>
                <TableHead className="text-right">ROU Asset</TableHead>
                <TableHead className="text-right">Liability</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(leasesQ.data ?? []).map((l: any) => (
                <TableRow key={l.id} className={selectedLeaseId === l.id ? "bg-muted/50" : ""}>
                  <TableCell className="font-medium">{l.lease_no}</TableCell>
                  <TableCell>
                    <div className="font-medium">{l.lessor_name}</div>
                    <div className="text-xs text-muted-foreground">{l.asset_description}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{l.classification}</Badge></TableCell>
                  <TableCell>{l.term_months}m</TableCell>
                  <TableCell className="text-right">{fmt(l.payment_amount)} {l.currency}</TableCell>
                  <TableCell className="text-right">{fmt(l.rou_asset_value)}</TableCell>
                  <TableCell className="text-right">{fmt(l.initial_liability)}</TableCell>
                  <TableCell><Badge>{l.status}</Badge></TableCell>
                  <TableCell className="space-x-1">
                    <Button size="sm" variant="outline" onClick={() => generateMut.mutate(l.id)}>
                      <Calculator className="h-3 w-3 mr-1" />Generate
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedLeaseId(l.id)}>View</Button>
                  </TableCell>
                </TableRow>
              ))}
              {leasesQ.data?.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No leases yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedLeaseId && (
        <Card>
          <CardHeader><CardTitle>Amortization Schedule</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Opening Liab.</TableHead>
                  <TableHead className="text-right">Payment</TableHead>
                  <TableHead className="text-right">Interest</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">Closing Liab.</TableHead>
                  <TableHead className="text-right">ROU Dep.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(scheduleQ.data ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.period_no}</TableCell>
                    <TableCell>{formatDateDMY(r.period_date)}</TableCell>
                    <TableCell className="text-right">{fmt(r.opening_liability)}</TableCell>
                    <TableCell className="text-right">{fmt(r.payment_amount)}</TableCell>
                    <TableCell className="text-right">{fmt(r.interest_expense)}</TableCell>
                    <TableCell className="text-right">{fmt(r.principal)}</TableCell>
                    <TableCell className="text-right">{fmt(r.closing_liability)}</TableCell>
                    <TableCell className="text-right">{fmt(r.rou_depreciation)}</TableCell>
                    <TableCell>{r.posted ? <Badge><CheckCircle2 className="h-3 w-3 mr-1" />Posted</Badge> : <Badge variant="outline">Open</Badge>}</TableCell>
                    <TableCell>
                      {!r.posted && (
                        <Button size="sm" variant="outline" onClick={() => postMut.mutate(r.id)}>Post</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {scheduleQ.data?.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">No schedule yet — click Generate</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
