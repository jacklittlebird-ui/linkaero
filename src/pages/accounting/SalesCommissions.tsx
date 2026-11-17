import { useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function SalesCommissionsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("plans");

  const [plan, setPlan] = useState({ name: "", basis: "invoice", rate_percent: 0, salesperson_id: "", currency: "EGP" });
  const [payout, setPayout] = useState({ salesperson_id: "", period_start: "", period_end: "", currency: "EGP" });

  const { data: plans = [] } = useQuery({
    queryKey: ["commission_plans"],
    queryFn: async () => (await supabase.from("commission_plans").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: accruals = [] } = useQuery({
    queryKey: ["commission_accruals"],
    queryFn: async () => (await supabase.from("commission_accruals").select("*").order("accrual_date", { ascending: false }).limit(200)).data ?? [],
  });
  const { data: payouts = [] } = useQuery({
    queryKey: ["commission_payouts"],
    queryFn: async () => (await supabase.from("commission_payouts").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const createPlan = async () => {
    if (!plan.name || !plan.rate_percent) return toast.error("Name and rate are required");
    const { error } = await supabase.from("commission_plans").insert({
      name: plan.name,
      basis: plan.basis,
      rate_percent: Number(plan.rate_percent),
      salesperson_id: plan.salesperson_id || null,
      currency: plan.currency,
    });
    if (error) return toast.error(error.message);
    toast.success("Plan created");
    setPlan({ name: "", basis: "invoice", rate_percent: 0, salesperson_id: "", currency: "EGP" });
    qc.invalidateQueries({ queryKey: ["commission_plans"] });
  };

  const togglePlan = async (id: string, active: boolean) => {
    await supabase.from("commission_plans").update({ active: !active }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["commission_plans"] });
  };

  const createPayout = async () => {
    if (!payout.salesperson_id || !payout.period_start || !payout.period_end) return toast.error("All fields required");
    const { error } = await supabase.rpc("create_commission_payout", {
      _salesperson_id: payout.salesperson_id,
      _period_start: payout.period_start,
      _period_end: payout.period_end,
      _currency: payout.currency,
    });
    if (error) return toast.error(error.message);
    toast.success("Payout created");
    qc.invalidateQueries({ queryKey: ["commission_payouts"] });
    qc.invalidateQueries({ queryKey: ["commission_accruals"] });
  };

  const markPaid = async (id: string) => {
    const { error } = await supabase.rpc("mark_commission_payout_paid", { _payout_id: id });
    if (error) return toast.error(error.message);
    toast.success("Payout marked paid");
    qc.invalidateQueries({ queryKey: ["commission_payouts"] });
    qc.invalidateQueries({ queryKey: ["commission_accruals"] });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Sales Commissions</h1>
        <p className="text-muted-foreground">Track commission plans, accruals, and salesperson payouts.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="accruals">Accruals</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>New Commission Plan</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div><Label>Name</Label><Input value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} /></div>
              <div><Label>Basis</Label>
                <select className="w-full h-10 border rounded-md px-2 bg-background" value={plan.basis} onChange={(e) => setPlan({ ...plan, basis: e.target.value })}>
                  <option value="invoice">Invoice</option>
                  <option value="payment">Payment</option>
                </select>
              </div>
              <div><Label>Rate (%)</Label><Input type="number" step="0.001" value={plan.rate_percent} onChange={(e) => setPlan({ ...plan, rate_percent: Number(e.target.value) })} /></div>
              <div><Label>Salesperson ID (optional)</Label><Input value={plan.salesperson_id} onChange={(e) => setPlan({ ...plan, salesperson_id: e.target.value })} /></div>
              <div><Label>Currency</Label><Input value={plan.currency} onChange={(e) => setPlan({ ...plan, currency: e.target.value })} /></div>
              <div className="md:col-span-5"><Button onClick={createPlan}>Create Plan</Button></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Plans</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Basis</TableHead><TableHead>Rate</TableHead><TableHead>Currency</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {plans.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.basis}</TableCell>
                      <TableCell>{p.rate_percent}%</TableCell>
                      <TableCell>{p.currency}</TableCell>
                      <TableCell><Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Active" : "Inactive"}</Badge></TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={() => togglePlan(p.id, p.active)}>{p.active ? "Deactivate" : "Activate"}</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accruals">
          <Card>
            <CardHeader><CardTitle>Commission Accruals</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Salesperson</TableHead><TableHead>Basis</TableHead><TableHead>Rate</TableHead><TableHead>Commission</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {accruals.map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.accrual_date}</TableCell>
                      <TableCell className="font-mono text-xs">{a.salesperson_id?.slice(0, 8)}</TableCell>
                      <TableCell>{a.basis_amount} {a.currency}</TableCell>
                      <TableCell>{a.rate_percent}%</TableCell>
                      <TableCell>{a.commission_amount} {a.currency}</TableCell>
                      <TableCell><Badge>{a.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payouts" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Create Payout</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div><Label>Salesperson ID</Label><Input value={payout.salesperson_id} onChange={(e) => setPayout({ ...payout, salesperson_id: e.target.value })} /></div>
              <div><Label>Period Start</Label><DateInput  value={payout.period_start} onChange={(e) => setPayout({ ...payout, period_start: e.target.value })} /></div>
              <div><Label>Period End</Label><DateInput  value={payout.period_end} onChange={(e) => setPayout({ ...payout, period_end: e.target.value })} /></div>
              <div><Label>Currency</Label><Input value={payout.currency} onChange={(e) => setPayout({ ...payout, currency: e.target.value })} /></div>
              <div className="flex items-end"><Button onClick={createPayout}>Create Payout</Button></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Payouts</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Salesperson</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Paid Date</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {payouts.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.period_start} → {p.period_end}</TableCell>
                      <TableCell className="font-mono text-xs">{p.salesperson_id?.slice(0, 8)}</TableCell>
                      <TableCell>{p.total_amount} {p.currency}</TableCell>
                      <TableCell><Badge>{p.status}</Badge></TableCell>
                      <TableCell>{p.paid_date ?? "—"}</TableCell>
                      <TableCell>{p.status !== "paid" && <Button size="sm" onClick={() => markPaid(p.id)}>Mark Paid</Button>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
