// Phase 1o — Fixed Assets & Depreciation
// Asset register + monthly straight-line depreciation posting to journal_entries.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Download, Boxes, Calculator, TrendingDown } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

interface FixedAsset {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string | null;
  company_id: string | null;
  station_id: string | null;
  cost_center: string | null;
  purchase_date: string;
  in_service_date: string | null;
  purchase_cost: number;
  salvage_value: number;
  useful_life_months: number;
  depreciation_method: string;
  accumulated_depreciation: number;
  status: string;
  disposal_date: string | null;
  disposal_amount: number | null;
  currency: string;
  asset_account_code: string | null;
  depreciation_account_code: string | null;
  accumulated_depr_account_code: string | null;
  notes: string | null;
}

interface Company { id: string; name: string; }
interface Station { id: string; name: string; }

const CATEGORIES = ["Buildings", "Vehicles", "IT Equipment", "Office Equipment", "Ground Support Equipment", "Furniture", "Other"];

const empty: Partial<FixedAsset> = {
  asset_code: "",
  asset_name: "",
  category: "Other",
  purchase_date: new Date().toISOString().slice(0, 10),
  purchase_cost: 0,
  salvage_value: 0,
  useful_life_months: 60,
  depreciation_method: "straight_line",
  accumulated_depreciation: 0,
  status: "Active",
  currency: "USD",
  asset_account_code: "1500",
  depreciation_account_code: "5500",
  accumulated_depr_account_code: "1590",
};

export default function FixedAssetsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<FixedAsset> | null>(null);
  const [runYear, setRunYear] = useState(new Date().getFullYear());
  const [runMonth, setRunMonth] = useState(new Date().getMonth() + 1);

  const { data: assets = [] } = useQuery({
    queryKey: ["fixed_assets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fixed_assets" as any).select("*").order("asset_code");
      if (error) throw error;
      return (data ?? []) as unknown as FixedAsset[];
    },
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-list"],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("id,name").order("name");
      return (data ?? []) as Company[];
    },
  });

  const { data: stations = [] } = useQuery({
    queryKey: ["finance-stations-list"],
    queryFn: async () => {
      const { data } = await supabase.from("finance_stations").select("id,name").order("name");
      return (data ?? []) as Station[];
    },
  });

  const { data: depreciations = [] } = useQuery({
    queryKey: ["depreciation_entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depreciation_entries" as any)
        .select("*")
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async (row: Partial<FixedAsset>) => {
      if (!row.asset_code || !row.asset_name) throw new Error("Code and name are required");
      const payload: any = { ...row };
      if (row.id) {
        const { error } = await supabase.from("fixed_assets" as any).update(payload).eq("id", row.id);
        if (error) throw error;
      } else {
        delete payload.id;
        const { error } = await supabase.from("fixed_assets" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      toast({ title: "Saved" });
      setDialogOpen(false);
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fixed_assets" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      toast({ title: "Deleted" });
    },
  });

  const monthlyDepreciation = (a: FixedAsset) => {
    const base = Math.max(0, (a.purchase_cost || 0) - (a.salvage_value || 0));
    return a.useful_life_months > 0 ? base / a.useful_life_months : 0;
  };

  const remainingLife = (a: FixedAsset) => {
    const monthly = monthlyDepreciation(a);
    if (monthly <= 0) return 0;
    const remainingBook = Math.max(0, (a.purchase_cost || 0) - (a.salvage_value || 0) - (a.accumulated_depreciation || 0));
    return Math.ceil(remainingBook / monthly);
  };

  const netBookValue = (a: FixedAsset) => (a.purchase_cost || 0) - (a.accumulated_depreciation || 0);

  const postDepreciationMut = useMutation({
    mutationFn: async () => {
      const active = assets.filter((a) => a.status === "Active");
      const runDate = `${runYear}-${String(runMonth).padStart(2, "0")}-01`;

      // Preload chart of accounts to resolve code → id
      const { data: coa } = await supabase.from("chart_of_accounts").select("id,code");
      const codeToId = new Map<string, string>();
      (coa ?? []).forEach((c: any) => codeToId.set(c.code, c.id));

      let posted = 0;
      for (const a of active) {
        const monthly = monthlyDepreciation(a);
        if (monthly <= 0) continue;
        const remaining = Math.max(0, (a.purchase_cost || 0) - (a.salvage_value || 0) - (a.accumulated_depreciation || 0));
        if (remaining <= 0) continue;
        const amount = Math.min(monthly, remaining);

        const { data: existing } = await supabase
          .from("depreciation_entries" as any)
          .select("id")
          .eq("asset_id", a.id)
          .eq("period_year", runYear)
          .eq("period_month", runMonth)
          .maybeSingle();
        if (existing) continue;

        const deprCode = a.depreciation_account_code || "5500";
        const accumCode = a.accumulated_depr_account_code || "1590";
        const deprId = codeToId.get(deprCode);
        const accumId = codeToId.get(accumCode);
        if (!deprId || !accumId) {
          throw new Error(`Chart of Accounts missing code(s): ${!deprId ? deprCode : ""} ${!accumId ? accumCode : ""}`);
        }

        const entryNo = `DEP-${runYear}${String(runMonth).padStart(2, "0")}-${a.asset_code}`;
        const { data: je, error: jeErr } = await supabase
          .from("journal_entries" as any)
          .insert({
            entry_no: entryNo,
            entry_date: runDate,
            description: `Depreciation ${a.asset_name} (${runYear}-${String(runMonth).padStart(2, "0")})`,
            reference: a.asset_code,
            reference_type: "Depreciation",
            status: "Posted",
            total_debit: amount,
            total_credit: amount,
          })
          .select("id")
          .single();
        if (jeErr) throw jeErr;
        const entryId = (je as any).id as string;

        const { error: linesErr } = await supabase.from("journal_entry_lines" as any).insert([
          {
            entry_id: entryId,
            account_id: deprId,
            debit: amount,
            credit: 0,
            description: `Depreciation - ${a.asset_name}`,
            sort_order: 0,
          },
          {
            entry_id: entryId,
            account_id: accumId,
            debit: 0,
            credit: amount,
            description: `Accumulated depreciation - ${a.asset_name}`,
            sort_order: 1,
          },
        ]);
        if (linesErr) throw linesErr;

        await supabase.from("depreciation_entries" as any).insert({
          asset_id: a.id,
          period_year: runYear,
          period_month: runMonth,
          depreciation_amount: amount,
          journal_entry_id: entryId,
        });

        await supabase
          .from("fixed_assets" as any)
          .update({ accumulated_depreciation: (a.accumulated_depreciation || 0) + amount })
          .eq("id", a.id);

        posted += 1;
      }
      return posted;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      qc.invalidateQueries({ queryKey: ["depreciation_entries"] });
      toast({ title: `Posted depreciation for ${n} asset${n === 1 ? "" : "s"}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const disposeMut = useMutation({
    mutationFn: async ({ id, amount, date }: { id: string; amount: number; date: string }) => {
      const { error } = await supabase
        .from("fixed_assets" as any)
        .update({ status: "Disposed", disposal_amount: amount, disposal_date: date })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      toast({ title: "Asset disposed" });
    },
  });

  const kpis = useMemo(() => {
    const totalCost = assets.reduce((s, a) => s + (a.purchase_cost || 0), 0);
    const totalDepr = assets.reduce((s, a) => s + (a.accumulated_depreciation || 0), 0);
    const nbv = totalCost - totalDepr;
    const active = assets.filter((a) => a.status === "Active").length;
    return { totalCost, totalDepr, nbv, active };
  }, [assets]);

  const openNew = () => {
    setEditing({ ...empty });
    setDialogOpen(true);
  };
  const openEdit = (a: FixedAsset) => {
    setEditing({ ...a });
    setDialogOpen(true);
  };

  const exportRegister = () => {
    exportToExcel(
      assets.map((a) => ({
        Code: a.asset_code,
        Name: a.asset_name,
        Category: a.category,
        "Purchase Date": a.purchase_date,
        Cost: a.purchase_cost,
        Salvage: a.salvage_value,
        "Life (mo)": a.useful_life_months,
        "Monthly Depr": monthlyDepreciation(a).toFixed(2),
        "Accum Depr": a.accumulated_depreciation,
        NBV: netBookValue(a).toFixed(2),
        "Remaining Life (mo)": remainingLife(a),
        Currency: a.currency,
        Status: a.status,
      })),
      "Fixed Assets",
      `fixed-assets-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6" /> Fixed Assets & Depreciation
          </h1>
          <p className="text-sm text-muted-foreground">Asset register, monthly depreciation posting, and disposal.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportRegister}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> New Asset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Active Assets</div><div className="text-2xl font-bold">{kpis.active}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Total Cost</div><div className="text-2xl font-bold">{kpis.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Accum. Depreciation</div><div className="text-2xl font-bold text-red-600">{kpis.totalDepr.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Net Book Value</div><div className="text-2xl font-bold text-green-600">{kpis.nbv.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="depreciation">Depreciation Run</TabsTrigger>
          <TabsTrigger value="history">Posted History</TabsTrigger>
        </TabsList>

        <TabsContent value="register">
          <Card>
            <CardContent className="pt-4">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Monthly</TableHead>
                      <TableHead className="text-right">Accum.</TableHead>
                      <TableHead className="text-right">NBV</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">{a.asset_code}</TableCell>
                        <TableCell>{a.asset_name}</TableCell>
                        <TableCell>{a.category}</TableCell>
                        <TableCell className="text-right">{a.purchase_cost.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{monthlyDepreciation(a).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-red-600">{a.accumulated_depreciation.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-semibold">{netBookValue(a).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right">{remainingLife(a)} mo</TableCell>
                        <TableCell>
                          <Badge variant={a.status === "Active" ? "default" : "secondary"}>{a.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(a)}><Pencil className="h-4 w-4" /></Button>
                          {a.status === "Active" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const amt = Number(prompt("Disposal amount:", String(netBookValue(a).toFixed(2))));
                                if (!isFinite(amt)) return;
                                disposeMut.mutate({ id: a.id, amount: amt, date: new Date().toISOString().slice(0, 10) });
                              }}
                            >
                              Dispose
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete asset?")) deleteMut.mutate(a.id); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {assets.length === 0 && (
                      <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">No assets yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="depreciation">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" /> Monthly Depreciation Run</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-xs text-muted-foreground">Year</label>
                  <Input type="number" value={runYear} onChange={(e) => setRunYear(Number(e.target.value))} className="w-28" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Month</label>
                  <Select value={String(runMonth)} onValueChange={(v) => setRunMonth(Number(v))}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{new Date(2000, i, 1).toLocaleString("en", { month: "long" })}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => postDepreciationMut.mutate()} disabled={postDepreciationMut.isPending}>
                  <TrendingDown className="h-4 w-4 mr-1" /> Post Depreciation
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Straight-line depreciation is posted per active asset for the selected period. Already-posted periods are skipped.
                Debits {`{Depreciation Expense}`} and credits {`{Accumulated Depreciation}`} via a Posted journal entry.
              </p>

              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Monthly</TableHead>
                      <TableHead className="text-right">Remaining Life</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.filter((a) => a.status === "Active").map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">{a.asset_code}</TableCell>
                        <TableCell>{a.asset_name}</TableCell>
                        <TableCell className="text-right">{monthlyDepreciation(a).toFixed(2)}</TableCell>
                        <TableCell className="text-right">{remainingLife(a)} mo</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Posted At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {depreciations.map((d: any) => {
                    const a = assets.find((x) => x.id === d.asset_id);
                    return (
                      <TableRow key={d.id}>
                        <TableCell>{d.period_year}-{String(d.period_month).padStart(2, "0")}</TableCell>
                        <TableCell>{a?.asset_code} {a?.asset_name}</TableCell>
                        <TableCell className="text-right">{Number(d.depreciation_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(d.posted_at).toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })}
                  {depreciations.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No depreciation posted yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Asset" : "New Asset"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs">Asset Code *</label>
                <Input value={editing.asset_code ?? ""} onChange={(e) => setEditing({ ...editing, asset_code: e.target.value })} />
              </div>
              <div>
                <label className="text-xs">Asset Name *</label>
                <Input value={editing.asset_name ?? ""} onChange={(e) => setEditing({ ...editing, asset_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs">Category</label>
                <Select value={editing.category ?? "Other"} onValueChange={(v) => setEditing({ ...editing, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs">Currency</label>
                <Input value={editing.currency ?? "USD"} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} />
              </div>
              <div>
                <label className="text-xs">Company</label>
                <Select value={editing.company_id ?? "none"} onValueChange={(v) => setEditing({ ...editing, company_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs">Station</label>
                <Select value={editing.station_id ?? "none"} onValueChange={(v) => setEditing({ ...editing, station_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {stations.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs">Purchase Date *</label>
                <DateInput  value={editing.purchase_date ?? ""} onChange={(e) => setEditing({ ...editing, purchase_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs">In-Service Date</label>
                <DateInput  value={editing.in_service_date ?? ""} onChange={(e) => setEditing({ ...editing, in_service_date: e.target.value || null })} />
              </div>
              <div>
                <label className="text-xs">Purchase Cost *</label>
                <Input type="number" step="0.01" value={editing.purchase_cost ?? 0} onChange={(e) => setEditing({ ...editing, purchase_cost: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs">Salvage Value</label>
                <Input type="number" step="0.01" value={editing.salvage_value ?? 0} onChange={(e) => setEditing({ ...editing, salvage_value: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs">Useful Life (months) *</label>
                <Input type="number" value={editing.useful_life_months ?? 60} onChange={(e) => setEditing({ ...editing, useful_life_months: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs">Accumulated Depreciation (opening)</label>
                <Input type="number" step="0.01" value={editing.accumulated_depreciation ?? 0} onChange={(e) => setEditing({ ...editing, accumulated_depreciation: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs">Asset Account</label>
                <Input value={editing.asset_account_code ?? ""} onChange={(e) => setEditing({ ...editing, asset_account_code: e.target.value })} />
              </div>
              <div>
                <label className="text-xs">Depreciation Expense Account</label>
                <Input value={editing.depreciation_account_code ?? ""} onChange={(e) => setEditing({ ...editing, depreciation_account_code: e.target.value })} />
              </div>
              <div>
                <label className="text-xs">Accumulated Depr. Account</label>
                <Input value={editing.accumulated_depr_account_code ?? ""} onChange={(e) => setEditing({ ...editing, accumulated_depr_account_code: e.target.value })} />
              </div>
              <div>
                <label className="text-xs">Cost Center</label>
                <Input value={editing.cost_center ?? ""} onChange={(e) => setEditing({ ...editing, cost_center: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs">Notes</label>
                <Textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => editing && saveMut.mutate(editing)} disabled={saveMut.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
