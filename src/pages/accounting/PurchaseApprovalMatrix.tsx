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

export default function PurchaseApprovalMatrixPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("matrix");
  const [row, setRow] = useState({ category: "", min_amount: 0, max_amount: "", currency: "EGP", approver_user_id: "", approver_role: "", level: 1 });
  const [deleg, setDeleg] = useState({ from_user_id: "", to_user_id: "", start_date: "", end_date: "", reason: "" });
  const [resolve, setResolve] = useState({ amount: 0, currency: "EGP", category: "" });
  const [resolved, setResolved] = useState<any[]>([]);

  const { data: matrix = [] } = useQuery({
    queryKey: ["purchase_approval_matrix"],
    queryFn: async () => (await supabase.from("purchase_approval_matrix").select("*").order("level")).data ?? [],
  });
  const { data: dels = [] } = useQuery({
    queryKey: ["authority_delegations"],
    queryFn: async () => (await supabase.from("authority_delegations").select("*").order("start_date", { ascending: false })).data ?? [],
  });

  const addMatrix = async () => {
    const { error } = await supabase.from("purchase_approval_matrix").insert({
      category: row.category || null,
      min_amount: Number(row.min_amount),
      max_amount: row.max_amount ? Number(row.max_amount) : null,
      currency: row.currency,
      approver_user_id: row.approver_user_id || null,
      approver_role: row.approver_role || null,
      level: Number(row.level),
    });
    if (error) return toast.error(error.message);
    toast.success("Matrix row added");
    qc.invalidateQueries({ queryKey: ["purchase_approval_matrix"] });
  };

  const addDeleg = async () => {
    if (!deleg.from_user_id || !deleg.to_user_id || !deleg.start_date || !deleg.end_date) return toast.error("All fields required");
    const { error } = await supabase.from("authority_delegations").insert(deleg);
    if (error) return toast.error(error.message);
    toast.success("Delegation added");
    qc.invalidateQueries({ queryKey: ["authority_delegations"] });
  };

  const runResolve = async () => {
    const { data, error } = await supabase.rpc("resolve_purchase_approver", {
      _amount: Number(resolve.amount),
      _currency: resolve.currency,
      _category: resolve.category || null,
    });
    if (error) return toast.error(error.message);
    setResolved((data as any) ?? []);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Purchase Approval Matrix</h1>
        <p className="text-muted-foreground">Authority thresholds and delegation-aware approver resolution.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="delegations">Delegations</TabsTrigger>
          <TabsTrigger value="resolve">Resolve Approver</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Add Threshold</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div><Label>Category</Label><Input value={row.category} onChange={(e) => setRow({ ...row, category: e.target.value })} /></div>
              <div><Label>Min Amount</Label><Input type="number" value={row.min_amount} onChange={(e) => setRow({ ...row, min_amount: Number(e.target.value) })} /></div>
              <div><Label>Max Amount</Label><Input type="number" value={row.max_amount} onChange={(e) => setRow({ ...row, max_amount: e.target.value })} /></div>
              <div><Label>Currency</Label><Input value={row.currency} onChange={(e) => setRow({ ...row, currency: e.target.value })} /></div>
              <div><Label>Approver User ID</Label><Input value={row.approver_user_id} onChange={(e) => setRow({ ...row, approver_user_id: e.target.value })} /></div>
              <div><Label>Approver Role</Label><Input value={row.approver_role} onChange={(e) => setRow({ ...row, approver_role: e.target.value })} /></div>
              <div><Label>Level</Label><Input type="number" value={row.level} onChange={(e) => setRow({ ...row, level: Number(e.target.value) })} /></div>
              <div className="flex items-end"><Button onClick={addMatrix}>Add</Button></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Approval Matrix</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Level</TableHead><TableHead>Category</TableHead><TableHead>Range</TableHead><TableHead>Currency</TableHead><TableHead>Approver</TableHead><TableHead>Role</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
                <TableBody>
                  {matrix.map((m: any) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.level}</TableCell>
                      <TableCell>{m.category ?? "—"}</TableCell>
                      <TableCell>{m.min_amount} — {m.max_amount ?? "∞"}</TableCell>
                      <TableCell>{m.currency}</TableCell>
                      <TableCell className="font-mono text-xs">{m.approver_user_id?.slice(0, 8) ?? "—"}</TableCell>
                      <TableCell>{m.approver_role ?? "—"}</TableCell>
                      <TableCell><Badge variant={m.active ? "default" : "secondary"}>{m.active ? "Active" : "Off"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="delegations" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Add Delegation</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div><Label>From User ID</Label><Input value={deleg.from_user_id} onChange={(e) => setDeleg({ ...deleg, from_user_id: e.target.value })} /></div>
              <div><Label>To User ID</Label><Input value={deleg.to_user_id} onChange={(e) => setDeleg({ ...deleg, to_user_id: e.target.value })} /></div>
              <div><Label>Start Date</Label><DateInput  value={deleg.start_date} onChange={(e) => setDeleg({ ...deleg, start_date: e.target.value })} /></div>
              <div><Label>End Date</Label><DateInput  value={deleg.end_date} onChange={(e) => setDeleg({ ...deleg, end_date: e.target.value })} /></div>
              <div><Label>Reason</Label><Input value={deleg.reason} onChange={(e) => setDeleg({ ...deleg, reason: e.target.value })} /></div>
              <div className="md:col-span-5"><Button onClick={addDeleg}>Add Delegation</Button></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Delegations</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Period</TableHead><TableHead>Reason</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
                <TableBody>
                  {dels.map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">{d.from_user_id?.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-xs">{d.to_user_id?.slice(0, 8)}</TableCell>
                      <TableCell>{d.start_date} → {d.end_date}</TableCell>
                      <TableCell>{d.reason ?? "—"}</TableCell>
                      <TableCell><Badge variant={d.active ? "default" : "secondary"}>{d.active ? "Active" : "Off"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resolve">
          <Card>
            <CardHeader><CardTitle>Resolve Approver</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div><Label>Amount</Label><Input type="number" value={resolve.amount} onChange={(e) => setResolve({ ...resolve, amount: Number(e.target.value) })} /></div>
              <div><Label>Currency</Label><Input value={resolve.currency} onChange={(e) => setResolve({ ...resolve, currency: e.target.value })} /></div>
              <div><Label>Category</Label><Input value={resolve.category} onChange={(e) => setResolve({ ...resolve, category: e.target.value })} /></div>
              <div className="flex items-end"><Button onClick={runResolve}>Resolve</Button></div>

              <div className="md:col-span-4">
                <Table>
                  <TableHeader><TableRow><TableHead>Level</TableHead><TableHead>Approver (effective)</TableHead><TableHead>Role</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {resolved.map((r: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>{r.level}</TableCell>
                        <TableCell className="font-mono text-xs">{r.approver_user_id ?? "—"}</TableCell>
                        <TableCell>{r.approver_role ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
