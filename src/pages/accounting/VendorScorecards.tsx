import { useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function VendorScorecardsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    vendor_id: "", period_start: "", period_end: "",
    quality_score: 0, delivery_score: 0, price_score: 0, compliance_score: 0, communication_score: 0, notes: "",
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["vendor_scorecards"],
    queryFn: async () => (await supabase.from("vendor_scorecards").select("*").order("period_end", { ascending: false }).limit(200)).data ?? [],
  });

  const create = async () => {
    if (!form.vendor_id || !form.period_start || !form.period_end) return toast.error("Vendor and period are required");
    const { data, error } = await supabase.from("vendor_scorecards").insert({
      ...form,
      quality_score: Number(form.quality_score),
      delivery_score: Number(form.delivery_score),
      price_score: Number(form.price_score),
      compliance_score: Number(form.compliance_score),
      communication_score: Number(form.communication_score),
    }).select("id").single();
    if (error) return toast.error(error.message);
    await supabase.rpc("compute_vendor_scorecard", { _id: data!.id });
    toast.success("Scorecard saved");
    qc.invalidateQueries({ queryKey: ["vendor_scorecards"] });
  };

  const gradeColor = (g: string) =>
    g === "A" ? "default" : g === "B" ? "secondary" : g === "F" ? "destructive" : "outline";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Vendor Scorecards</h1>
        <p className="text-muted-foreground">Rate vendors on 5 KPIs to derive an overall grade.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>New Scorecard</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Vendor ID</Label><Input value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })} /></div>
          <div><Label>Period Start</Label><DateInput  value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} /></div>
          <div><Label>Period End</Label><DateInput  value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} /></div>
          <div />
          {(["quality_score","delivery_score","price_score","compliance_score","communication_score"] as const).map(k => (
            <div key={k}>
              <Label>{k.replace("_score","").replace(/^./, c => c.toUpperCase())} (0-100)</Label>
              <Input type="number" min={0} max={100} value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />
            </div>
          ))}
          <div className="md:col-span-4"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="md:col-span-4"><Button onClick={create}>Save Scorecard</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Vendor</TableHead><TableHead>Quality</TableHead><TableHead>Delivery</TableHead><TableHead>Price</TableHead><TableHead>Compliance</TableHead><TableHead>Comm.</TableHead><TableHead>Total</TableHead><TableHead>Grade</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>{r.period_start} → {r.period_end}</TableCell>
                  <TableCell className="font-mono text-xs">{r.vendor_id?.slice(0, 8)}</TableCell>
                  <TableCell>{r.quality_score}</TableCell>
                  <TableCell>{r.delivery_score}</TableCell>
                  <TableCell>{r.price_score}</TableCell>
                  <TableCell>{r.compliance_score}</TableCell>
                  <TableCell>{r.communication_score}</TableCell>
                  <TableCell className="font-semibold">{r.total_score}</TableCell>
                  <TableCell><Badge variant={gradeColor(r.grade) as any}>{r.grade ?? "—"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
