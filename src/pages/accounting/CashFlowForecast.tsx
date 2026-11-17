// Phase 3v: 13-Week Rolling Cash Flow Forecast
import { DateInput } from "@/components/ui/date-input";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Calculator, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { formatDateDMY } from "@/lib/utils";

export default function CashFlowForecast() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    forecast_no: `CFF-${new Date().toISOString().slice(0, 10)}`,
    as_of_date: new Date().toISOString().slice(0, 10),
    horizon_weeks: 13,
    base_currency: "EGP",
    opening_cash: 0,
  });

  const listQ = useQuery({
    queryKey: ["cash-flow-forecasts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cash_flow_forecasts" as any).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const linesQ = useQuery({
    queryKey: ["cash-flow-forecast-lines", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase.from("cash_flow_forecast_lines" as any).select("*").eq("forecast_id", selected).order("week_no");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("cash_flow_forecasts").insert(form);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Forecast created"); setOpen(false); qc.invalidateQueries({ queryKey: ["cash-flow-forecasts"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const genMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).rpc("generate_cash_flow_forecast", { p_forecast_id: id });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { toast.success(`Generated ${n} weeks`); qc.invalidateQueries({ queryKey: ["cash-flow-forecast-lines"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><TrendingUp className="h-6 w-6" />13-Week Rolling Cash Flow Forecast</h1>
          <p className="text-sm text-muted-foreground">Projected inflows from AR and outflows to AP over the next weeks</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New Forecast</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Forecast</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Forecast No.</Label><Input value={form.forecast_no} onChange={(e) => setForm({ ...form, forecast_no: e.target.value })} /></div>
              <div><Label>As of Date</Label><DateInput  value={form.as_of_date} onChange={(e) => setForm({ ...form, as_of_date: e.target.value })} /></div>
              <div><Label>Horizon (weeks)</Label><Input type="number" value={form.horizon_weeks} onChange={(e) => setForm({ ...form, horizon_weeks: Number(e.target.value) })} /></div>
              <div><Label>Base Currency</Label><Input value={form.base_currency} onChange={(e) => setForm({ ...form, base_currency: e.target.value })} /></div>
              <div><Label>Opening Cash</Label><Input type="number" value={form.opening_cash} onChange={(e) => setForm({ ...form, opening_cash: Number(e.target.value) })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>Forecasts</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>No.</TableHead><TableHead>As Of</TableHead><TableHead>Weeks</TableHead>
              <TableHead>Currency</TableHead><TableHead className="text-right">Opening Cash</TableHead>
              <TableHead>Status</TableHead><TableHead>Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(listQ.data ?? []).map((f: any) => (
                <TableRow key={f.id} className={selected === f.id ? "bg-muted/50" : ""}>
                  <TableCell className="font-medium">{f.forecast_no}</TableCell>
                  <TableCell>{formatDateDMY(f.as_of_date)}</TableCell>
                  <TableCell>{f.horizon_weeks}</TableCell>
                  <TableCell>{f.base_currency}</TableCell>
                  <TableCell className="text-right">{fmt(f.opening_cash)}</TableCell>
                  <TableCell><Badge>{f.status}</Badge></TableCell>
                  <TableCell className="space-x-1">
                    <Button size="sm" variant="outline" onClick={() => genMut.mutate(f.id)}><Calculator className="h-3 w-3 mr-1" />Generate</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(f.id)}>View</Button>
                  </TableCell>
                </TableRow>
              ))}
              {listQ.data?.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No forecasts yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader><CardTitle>Weekly Projection</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Wk</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead>
                <TableHead className="text-right text-green-600">AR Inflow</TableHead>
                <TableHead className="text-right text-red-600">AP Outflow</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Closing Balance</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(linesQ.data ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.week_no}</TableCell>
                    <TableCell>{formatDateDMY(r.week_start)}</TableCell>
                    <TableCell>{formatDateDMY(r.week_end)}</TableCell>
                    <TableCell className="text-right text-green-600">{fmt(r.ar_inflow)}</TableCell>
                    <TableCell className="text-right text-red-600">{fmt(r.ap_outflow)}</TableCell>
                    <TableCell className={`text-right font-medium ${Number(r.net_movement) < 0 ? "text-red-600" : "text-green-600"}`}>{fmt(r.net_movement)}</TableCell>
                    <TableCell className={`text-right font-semibold ${Number(r.closing_balance) < 0 ? "text-red-600" : ""}`}>{fmt(r.closing_balance)}</TableCell>
                  </TableRow>
                ))}
                {linesQ.data?.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No lines — click Generate</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
