import { useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";

type Schedule = {
  id: string;
  schedule_type: "deferred_revenue" | "prepaid_expense";
  reference_no: string | null;
  description: string;
  total_amount: number;
  currency: string;
  start_date: string;
  end_date: string;
  status: string;
};

type Entry = {
  id: string;
  schedule_id: string;
  period_date: string;
  amount: number;
  status: string;
  posted_at: string | null;
};

export default function AmortizationSchedulesPage() {
  const qc = useQueryClient();
  const [type, setType] = useState<"deferred_revenue" | "prepaid_expense">("deferred_revenue");
  const [form, setForm] = useState({
    description: "",
    reference_no: "",
    total_amount: "",
    currency: "EGP",
    start_date: "",
    end_date: "",
  });
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const { data: schedules = [] } = useQuery({
    queryKey: ["amortization_schedules", type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("amortization_schedules")
        .select("*")
        .eq("schedule_type", type)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Schedule[];
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["amortization_entries", detailFor],
    enabled: !!detailFor,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("amortization_entries")
        .select("*")
        .eq("schedule_id", detailFor!)
        .order("period_date");
      if (error) throw error;
      return data as Entry[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const total = parseFloat(form.total_amount);
      if (!form.description || !form.start_date || !form.end_date || !total) {
        throw new Error("Fill all required fields");
      }
      const { error } = await supabase.from("amortization_schedules").insert({
        schedule_type: type,
        description: form.description,
        reference_no: form.reference_no || null,
        total_amount: total,
        currency: form.currency,
        start_date: form.start_date,
        end_date: form.end_date,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedule created");
      setForm({ description: "", reference_no: "", total_amount: "", currency: "EGP", start_date: "", end_date: "" });
      qc.invalidateQueries({ queryKey: ["amortization_schedules"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const generate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("generate_amortization_entries", { _schedule_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entries generated");
      qc.invalidateQueries({ queryKey: ["amortization_schedules"] });
      qc.invalidateQueries({ queryKey: ["amortization_entries"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const post = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("post_amortization_entry", { _entry_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entry posted");
      qc.invalidateQueries({ queryKey: ["amortization_entries"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Deferred Revenue & Prepaid Expense</h1>
        <p className="text-muted-foreground">Amortize balances across future periods using straight-line recognition.</p>
      </div>

      <Tabs value={type} onValueChange={(v) => setType(v as any)}>
        <TabsList>
          <TabsTrigger value="deferred_revenue">Deferred Revenue</TabsTrigger>
          <TabsTrigger value="prepaid_expense">Prepaid Expense</TabsTrigger>
        </TabsList>

        <TabsContent value={type} className="space-y-6">
          <Card>
            <CardHeader><CardTitle>New schedule</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <Label>Reference #</Label>
                <Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
              </div>
              <div>
                <Label>Total amount</Label>
                <Input type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EGP">EGP</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Start</Label>
                  <DateInput  value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div>
                  <Label>End</Label>
                  <DateInput  value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
              </div>
              <div className="md:col-span-3">
                <Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Schedules</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.description}</TableCell>
                      <TableCell>{s.reference_no || "—"}</TableCell>
                      <TableCell>{s.total_amount.toLocaleString()} {s.currency}</TableCell>
                      <TableCell className="text-xs">
                        {format(new Date(s.start_date), "dd/MM/yyyy")} → {format(new Date(s.end_date), "dd/MM/yyyy")}
                      </TableCell>
                      <TableCell><Badge>{s.status}</Badge></TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => generate.mutate(s.id)}>Generate</Button>
                        <Dialog open={detailFor === s.id} onOpenChange={(o) => setDetailFor(o ? s.id : null)}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">View</Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl">
                            <DialogHeader><DialogTitle>{s.description}</DialogTitle></DialogHeader>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Period</TableHead>
                                  <TableHead>Amount</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {entries.map((e) => (
                                  <TableRow key={e.id}>
                                    <TableCell>{format(new Date(e.period_date), "MMM yyyy")}</TableCell>
                                    <TableCell>{e.amount.toLocaleString()} {s.currency}</TableCell>
                                    <TableCell><Badge variant={e.status === "posted" ? "default" : "secondary"}>{e.status}</Badge></TableCell>
                                    <TableCell className="text-right">
                                      {e.status !== "posted" && (
                                        <Button size="sm" onClick={() => post.mutate(e.id)}>Post</Button>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                  {schedules.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No schedules.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
