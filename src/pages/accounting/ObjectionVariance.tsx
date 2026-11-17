// Objection Letters & Invoice Variance Reports (Phase 1y)
// -------------------------------------------------------------
// Two tabs:
//   1. Variance Reports — auto/manual invoice-vs-contract variance snapshots
//      with severity (minor/major/critical) and resolution notes.
//   2. Objection Letters — supplier dispute letters tied to a variance,
//      lifecycle: Sent → Under Negotiation → Resolved / Escalated / Frozen.
//      Freezing payment blocks disbursement until resolved.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { FileWarning, Plus, Download, ShieldAlert, Snowflake, CheckCircle2, ArrowUpCircle } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format } from "date-fns";

const OBJECTION_STATUSES = ["sent", "under_negotiation", "resolved", "escalated", "frozen"] as const;
type ObjStatus = typeof OBJECTION_STATUSES[number];
const OBJ_LABEL: Record<ObjStatus, string> = {
  sent: "Sent",
  under_negotiation: "Under Negotiation",
  resolved: "Resolved",
  escalated: "Escalated",
  frozen: "Frozen",
};
const OBJ_VARIANT: Record<ObjStatus, "default" | "secondary" | "destructive" | "outline"> = {
  sent: "secondary",
  under_negotiation: "outline",
  resolved: "default",
  escalated: "destructive",
  frozen: "destructive",
};

const SEVERITIES = ["minor", "major", "critical"] as const;
type Severity = typeof SEVERITIES[number];
const SEV_VARIANT: Record<Severity, "default" | "secondary" | "destructive" | "outline"> = {
  minor: "outline",
  major: "secondary",
  critical: "destructive",
};

const CURRENCIES = ["EGP", "USD", "EUR", "GBP", "AED", "SAR"];

export default function ObjectionVariance() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"variance" | "letters">("variance");

  // -------- Queries --------
  const variancesQ = useQuery({
    queryKey: ["invoice_variance_reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_variance_reports")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const lettersQ = useQuery({
    queryKey: ["objection_letters"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("objection_letters")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const suppliersQ = useQuery({
    queryKey: ["service_providers_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_providers")
        .select("id,name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const supplierName = (id?: string | null) =>
    suppliersQ.data?.find((s: any) => s.id === id)?.name ?? "—";

  // -------- Mutations: Variance --------
  const createVariance = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from("invoice_variance_reports").insert({
        ...payload,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice_variance_reports"] });
      toast.success("Variance report created");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resolveVariance = useMutation({
    mutationFn: async ({ id, resolution }: { id: string; resolution: string }) => {
      const { error } = await supabase
        .from("invoice_variance_reports")
        .update({ resolution })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice_variance_reports"] });
      toast.success("Resolution saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // -------- Mutations: Letters --------
  const createLetter = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from("objection_letters").insert({
        ...payload,
        opened_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objection_letters"] });
      toast.success("Objection letter created");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setLetterStatus = useMutation({
    mutationFn: async ({ id, status, extras }: { id: string; status: ObjStatus; extras?: any }) => {
      const patch: any = { status, ...(extras ?? {}) };
      if (status === "resolved") {
        patch.closed_at = new Date().toISOString();
        patch.closed_by = user?.id ?? null;
        patch.payment_frozen = false;
      }
      if (status === "frozen") patch.payment_frozen = true;
      const { error } = await supabase.from("objection_letters").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objection_letters"] });
      toast.success("Letter updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // -------- KPIs --------
  const kpis = useMemo(() => {
    const v = variancesQ.data ?? [];
    const l = lettersQ.data ?? [];
    return {
      totalVariances: v.length,
      criticalVariances: v.filter((x: any) => x.severity === "critical").length,
      openLetters: l.filter((x: any) => !["resolved"].includes(x.status)).length,
      frozenPayments: l.filter((x: any) => x.payment_frozen).length,
      disputedAmount: l
        .filter((x: any) => x.status !== "resolved")
        .reduce((s: number, x: any) => s + Number(x.difference ?? 0), 0),
    };
  }, [variancesQ.data, lettersQ.data]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileWarning className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Objection Letters & Variance</h1>
            <p className="text-sm text-muted-foreground">
              Invoice-vs-contract variance snapshots and supplier dispute workflow.
            </p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Variance Reports" value={kpis.totalVariances} />
        <KpiCard label="Critical Variances" value={kpis.criticalVariances} tone="destructive" />
        <KpiCard label="Open Letters" value={kpis.openLetters} />
        <KpiCard label="Frozen Payments" value={kpis.frozenPayments} tone="destructive" />
        <KpiCard
          label="Disputed Amount"
          value={kpis.disputedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="variance">Variance Reports</TabsTrigger>
          <TabsTrigger value="letters">Objection Letters</TabsTrigger>
        </TabsList>

        {/* -------- Variance Reports Tab -------- */}
        <TabsContent value="variance" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Invoice Variance Reports</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    exportToExcel(
                      (variancesQ.data ?? []).map((v: any) => ({
                        Supplier: supplierName(v.supplier_id),
                        Severity: v.severity,
                        Amount: v.variance_amount,
                        "Variance %": v.variance_pct,
                        Resolution: v.resolution ?? "",
                        Created: format(new Date(v.created_at), "dd/MM/yyyy"),
                      })),
                      "Variances", "invoice_variance_reports.xlsx"
                    )
                  }
                >
                  <Download className="h-4 w-4 mr-1" /> Export
                </Button>
                <NewVarianceDialog
                  suppliers={suppliersQ.data ?? []}
                  onSubmit={(p) => createVariance.mutate(p)}
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead>Resolution</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(variancesQ.data ?? []).map((v: any) => (
                    <TableRow key={v.id}>
                      <TableCell>{supplierName(v.supplier_id)}</TableCell>
                      <TableCell>
                        <Badge variant={SEV_VARIANT[v.severity as Severity] ?? "outline"}>
                          {v.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(v.variance_amount ?? 0).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-right">{Number(v.variance_pct ?? 0).toFixed(2)}</TableCell>
                      <TableCell className="max-w-xs truncate">{v.resolution ?? "—"}</TableCell>
                      <TableCell>{format(new Date(v.created_at), "dd/MM/yyyy")}</TableCell>
                      <TableCell className="text-right">
                        <ResolveDialog
                          initial={v.resolution ?? ""}
                          onSave={(resolution) => resolveVariance.mutate({ id: v.id, resolution })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {(variancesQ.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No variance reports yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------- Objection Letters Tab -------- */}
        <TabsContent value="letters" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Objection Letters</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    exportToExcel(
                      (lettersQ.data ?? []).map((l: any) => ({
                        "Letter #": l.letter_no,
                        Supplier: supplierName(l.supplier_id),
                        Service: l.disputed_service,
                        Flight: l.flight_ref ?? "",
                        Contracted: l.contracted_price,
                        Invoiced: l.invoiced_price,
                        Difference: l.difference,
                        Currency: l.currency,
                        Status: OBJ_LABEL[l.status as ObjStatus] ?? l.status,
                        Frozen: l.payment_frozen ? "Yes" : "No",
                      })),
                      "Letters", "objection_letters.xlsx"
                    )
                  }
                >
                  <Download className="h-4 w-4 mr-1" /> Export
                </Button>
                <NewLetterDialog
                  suppliers={suppliersQ.data ?? []}
                  variances={variancesQ.data ?? []}
                  onSubmit={(p) => createLetter.mutate(p)}
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Letter #</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Disputed Service</TableHead>
                    <TableHead className="text-right">Contracted</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                    <TableHead className="text-right">Diff.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(lettersQ.data ?? []).map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.letter_no}</TableCell>
                      <TableCell>{supplierName(l.supplier_id)}</TableCell>
                      <TableCell className="max-w-xs truncate">{l.disputed_service}</TableCell>
                      <TableCell className="text-right">
                        {Number(l.contracted_price).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(l.invoiced_price).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(l.difference ?? 0).toLocaleString()} {l.currency}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant={OBJ_VARIANT[l.status as ObjStatus] ?? "outline"}>
                            {OBJ_LABEL[l.status as ObjStatus] ?? l.status}
                          </Badge>
                          {l.payment_frozen && (
                            <Snowflake className="h-3.5 w-3.5 text-destructive" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {l.status !== "resolved" && (
                          <>
                            {l.status === "sent" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setLetterStatus.mutate({ id: l.id, status: "under_negotiation" })
                                }
                              >
                                Negotiate
                              </Button>
                            )}
                            {!l.payment_frozen && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setLetterStatus.mutate({ id: l.id, status: "frozen" })}
                              >
                                <Snowflake className="h-3.5 w-3.5 mr-1" /> Freeze
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setLetterStatus.mutate({ id: l.id, status: "escalated" })
                              }
                            >
                              <ArrowUpCircle className="h-3.5 w-3.5 mr-1" /> Escalate
                            </Button>
                            <ResolveLetterDialog
                              onSave={(settled_amount, notes) =>
                                setLetterStatus.mutate({
                                  id: l.id,
                                  status: "resolved",
                                  extras: { settled_amount, notes },
                                })
                              }
                            />
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(lettersQ.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No objection letters yet.
                      </TableCell>
                    </TableRow>
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

// -------- Small components --------
function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "destructive";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`text-xl font-semibold mt-1 ${
            tone === "destructive" ? "text-destructive" : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function NewVarianceDialog({
  suppliers,
  onSubmit,
}: {
  suppliers: any[];
  onSubmit: (p: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    supplier_id: "",
    variance_amount: "",
    variance_pct: "",
    severity: "minor" as Severity,
    resolution: "",
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Variance
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Variance Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Supplier</Label>
            <Select
              value={form.supplier_id}
              onValueChange={(v) => setForm({ ...form, supplier_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Variance Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={form.variance_amount}
                onChange={(e) => setForm({ ...form, variance_amount: e.target.value })}
              />
            </div>
            <div>
              <Label>Variance %</Label>
              <Input
                type="number"
                step="0.01"
                value={form.variance_pct}
                onChange={(e) => setForm({ ...form, variance_pct: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Severity</Label>
            <Select
              value={form.severity}
              onValueChange={(v) => setForm({ ...form, severity: v as Severity })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Resolution (optional)</Label>
            <Textarea
              value={form.resolution}
              onChange={(e) => setForm({ ...form, resolution: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSubmit({
                supplier_id: form.supplier_id || null,
                variance_amount: Number(form.variance_amount || 0),
                variance_pct: Number(form.variance_pct || 0),
                severity: form.severity,
                resolution: form.resolution || null,
              });
              setOpen(false);
              setForm({
                supplier_id: "",
                variance_amount: "",
                variance_pct: "",
                severity: "minor",
                resolution: "",
              });
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewLetterDialog({
  suppliers,
  variances,
  onSubmit,
}: {
  suppliers: any[];
  variances: any[];
  onSubmit: (p: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    letter_no: "",
    supplier_id: "",
    variance_report_id: "",
    flight_ref: "",
    flight_date: "",
    disputed_service: "",
    contracted_price: "",
    invoiced_price: "",
    currency: "EGP",
    notes: "",
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Letter
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Objection Letter</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Letter #</Label>
            <Input
              value={form.letter_no}
              onChange={(e) => setForm({ ...form, letter_no: e.target.value })}
              placeholder="OBJ-2026-001"
            />
          </div>
          <div>
            <Label>Supplier</Label>
            <Select
              value={form.supplier_id}
              onValueChange={(v) => setForm({ ...form, supplier_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Linked Variance Report (optional)</Label>
            <Select
              value={form.variance_report_id}
              onValueChange={(v) => setForm({ ...form, variance_report_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select variance" />
              </SelectTrigger>
              <SelectContent>
                {variances.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.severity} · {Number(v.variance_amount).toLocaleString()} ·{" "}
                    {format(new Date(v.created_at), "dd/MM/yyyy")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Flight Ref</Label>
            <Input
              value={form.flight_ref}
              onChange={(e) => setForm({ ...form, flight_ref: e.target.value })}
            />
          </div>
          <div>
            <Label>Flight Date</Label>
            <DateInput
              
              value={form.flight_date}
              onChange={(e) => setForm({ ...form, flight_date: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label>Disputed Service</Label>
            <Input
              value={form.disputed_service}
              onChange={(e) => setForm({ ...form, disputed_service: e.target.value })}
            />
          </div>
          <div>
            <Label>Contracted Price</Label>
            <Input
              type="number"
              step="0.01"
              value={form.contracted_price}
              onChange={(e) => setForm({ ...form, contracted_price: e.target.value })}
            />
          </div>
          <div>
            <Label>Invoiced Price</Label>
            <Input
              type="number"
              step="0.01"
              value={form.invoiced_price}
              onChange={(e) => setForm({ ...form, invoiced_price: e.target.value })}
            />
          </div>
          <div>
            <Label>Currency</Label>
            <Select
              value={form.currency}
              onValueChange={(v) => setForm({ ...form, currency: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!form.letter_no || !form.disputed_service}
            onClick={() => {
              onSubmit({
                letter_no: form.letter_no,
                supplier_id: form.supplier_id || null,
                variance_report_id: form.variance_report_id || null,
                flight_ref: form.flight_ref || null,
                flight_date: form.flight_date || null,
                disputed_service: form.disputed_service,
                contracted_price: Number(form.contracted_price || 0),
                invoiced_price: Number(form.invoiced_price || 0),
                currency: form.currency,
                notes: form.notes || null,
                status: "sent",
              });
              setOpen(false);
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResolveDialog({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (r: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(initial);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Resolve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolution Notes</DialogTitle>
        </DialogHeader>
        <Textarea value={val} onChange={(e) => setVal(e.target.value)} rows={5} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(val);
              setOpen(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResolveLetterDialog({
  onSave,
}: {
  onSave: (settled: number, notes: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Resolve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve Objection</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Settled Amount</Label>
            <Input
              type="number"
              step="0.01"
              value={settled}
              onChange={(e) => setSettled(e.target.value)}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(Number(settled || 0), notes);
              setOpen(false);
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
