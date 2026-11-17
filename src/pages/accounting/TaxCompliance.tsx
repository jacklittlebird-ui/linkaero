import { useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download, Send, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));

// ---------------- ETA E-Invoicing ----------------
function EtaTab() {
  const qc = useQueryClient();
  const [env, setEnv] = useState<"preprod" | "prod">("preprod");

  const { data: pending } = useQuery({
    queryKey: ["eta-eligible"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_no, date, airline_iata, operator, currency, total, status")
        .in("status", ["Sent", "Paid", "Overdue"])
        .order("date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: submissions } = useQuery({
    queryKey: ["eta-submissions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eta_submissions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const submittedIds = new Set((submissions ?? []).map((s: any) => s.invoice_id));

  const submitMutation = useMutation({
    mutationFn: async (invoice: any) => {
      const payload = {
        documentType: "I",
        documentTypeVersion: "1.0",
        issuer: { name: "Link Aero", type: "B" },
        receiver: { name: invoice.operator ?? invoice.airline_iata },
        totalAmount: Number(invoice.total),
        totalDiscountAmount: 0,
        currency: invoice.currency,
      };
      const { data, error } = await supabase
        .from("eta_submissions")
        .insert({
          invoice_id: invoice.id,
          status: "submitted",
          submitted_at: new Date().toISOString(),
          document_type: "invoice",
          payload,
          environment: env,
          submitted_by: (await supabase.auth.getUser()).data.user?.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Submission recorded (sandbox)");
      qc.invalidateQueries({ queryKey: ["eta-submissions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const markAccepted = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase
        .from("eta_submissions")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          long_id: row.long_id || `ETA-${Date.now()}`,
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked accepted");
      qc.invalidateQueries({ queryKey: ["eta-submissions"] });
    },
  });

  const markRejected = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase
        .from("eta_submissions")
        .update({
          status: "rejected",
          rejected_at: new Date().toISOString(),
          error_message: "Rejected by ETA",
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked rejected");
      qc.invalidateQueries({ queryKey: ["eta-submissions"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label>Environment</Label>
        <Select value={env} onValueChange={(v: any) => setEnv(v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="preprod">Preprod (Sandbox)</SelectItem>
            <SelectItem value="prod">Production</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">
          Live ETA integration requires production credentials. Sandbox mode records submissions locally.
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Eligible Invoices</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Invoice No</TableHead><TableHead>Date</TableHead>
              <TableHead>Customer</TableHead><TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(pending ?? []).map((inv: any) => {
                const done = submittedIds.has(inv.id);
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.invoice_no}</TableCell>
                    <TableCell>{inv.date}</TableCell>
                    <TableCell>{inv.operator ?? inv.airline_iata}</TableCell>
                    <TableCell className="text-right">{inv.currency} {fmt(inv.total)}</TableCell>
                    <TableCell><Badge variant="outline">{inv.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => submitMutation.mutate(inv)} disabled={done}>
                        <Send className="h-3 w-3 mr-1" />{done ? "Submitted" : "Submit to ETA"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Submission Log</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Submitted</TableHead><TableHead>Invoice</TableHead>
              <TableHead>Env</TableHead><TableHead>Status</TableHead>
              <TableHead>Long ID / Error</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(submissions ?? []).map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell>{s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "-"}</TableCell>
                  <TableCell className="text-xs">{s.invoice_id?.slice(0, 8)}…</TableCell>
                  <TableCell><Badge variant="outline">{s.environment}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={s.status === "accepted" ? "default" : s.status === "rejected" ? "destructive" : "secondary"}>
                      {s.status === "accepted" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {s.status === "rejected" && <XCircle className="h-3 w-3 mr-1" />}
                      {s.status === "submitted" && <Clock className="h-3 w-3 mr-1" />}
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{s.long_id || s.error_message || "-"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    {s.status === "submitted" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => markAccepted.mutate(s)}>Accept</Button>
                        <Button size="sm" variant="outline" onClick={() => markRejected.mutate(s)}>Reject</Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- VAT Returns ----------------
function VatTab() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: computed, refetch, isFetching } = useQuery({
    queryKey: ["vat-compute", year, month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("compute_vat_return", { _year: year, _month: month });
      if (error) throw error;
      return (data ?? [])[0] as any;
    },
  });

  const { data: filings } = useQuery({
    queryKey: ["vat-returns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vat_returns").select("*")
        .order("period_year", { ascending: false }).order("period_month", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!computed) throw new Error("Compute first");
      const { error } = await supabase.from("vat_returns").upsert({
        period_year: year, period_month: month,
        output_vat: computed.output_vat, input_vat: computed.input_vat,
        net_vat: computed.net_vat, total_sales: computed.total_sales,
        total_purchases: computed.total_purchases,
        status: "draft",
      }, { onConflict: "period_year,period_month,company_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("VAT return saved");
      qc.invalidateQueries({ queryKey: ["vat-returns"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const fileMutation = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.from("vat_returns").update({
        status: "filed", filed_at: new Date().toISOString(),
        reference_no: row.reference_no || `VAT-${row.period_year}-${row.period_month}`,
      }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as filed");
      qc.invalidateQueries({ queryKey: ["vat-returns"] });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Compute VAT Return</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div><Label>Year</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" /></div>
            <div>
              <Label>Month</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />Compute
            </Button>
            <Button variant="default" onClick={() => saveMutation.mutate()} disabled={!computed}>
              Save Draft
            </Button>
          </div>

          {computed && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Kpi label="Total Sales" value={computed.total_sales} />
              <Kpi label="Total Purchases" value={computed.total_purchases} />
              <Kpi label="Output VAT" value={computed.output_vat} tone="green" />
              <Kpi label="Input VAT" value={computed.input_vat} tone="red" />
              <Kpi label="Net VAT Payable" value={computed.net_vat} tone={Number(computed.net_vat) >= 0 ? "primary" : "green"} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Filed / Saved Returns</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Period</TableHead><TableHead className="text-right">Output</TableHead>
              <TableHead className="text-right">Input</TableHead><TableHead className="text-right">Net</TableHead>
              <TableHead>Status</TableHead><TableHead>Reference</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(filings ?? []).map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.period_year}-{String(f.period_month).padStart(2, "0")}</TableCell>
                  <TableCell className="text-right">{fmt(f.output_vat)}</TableCell>
                  <TableCell className="text-right">{fmt(f.input_vat)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(f.net_vat)}</TableCell>
                  <TableCell><Badge variant={f.status === "filed" ? "default" : "secondary"}>{f.status}</Badge></TableCell>
                  <TableCell className="text-xs">{f.reference_no || "-"}</TableCell>
                  <TableCell className="text-right">
                    {f.status !== "filed" && (
                      <Button size="sm" variant="outline" onClick={() => fileMutation.mutate(f)}>Mark Filed</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- WHT Reporting ----------------
function WhtTab() {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["wht-summary", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wht_summary", { _from: from, _to: to });
      if (error) throw error;
      return data ?? [];
    },
  });

  const total = useMemo(() => (data ?? []).reduce((s: number, r: any) => s + Number(r.wht_amount), 0), [data]);
  const totalGross = useMemo(() => (data ?? []).reduce((s: number, r: any) => s + Number(r.gross_amount), 0), [data]);

  const exportCsv = () => {
    const headers = ["Vendor", "Certificates", "Gross", "WHT", "Currency"];
    const csv = [headers.join(","), ...(data ?? []).map((r: any) =>
      [r.vendor_name, r.certificate_count, r.gross_amount, r.wht_amount, r.currency].join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `wht-${from}-to-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Withholding Tax Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 mb-4">
            <div><Label>From</Label><DateInput  value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
            <div><Label>To</Label><DateInput  value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
            <Button onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />Refresh
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={!data?.length}>
              <Download className="h-4 w-4 mr-2" />Export
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Kpi label="Vendors" value={data?.length ?? 0} raw />
            <Kpi label="Total Gross" value={totalGross} />
            <Kpi label="Total WHT" value={total} tone="red" />
          </div>

          <Table>
            <TableHeader><TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Certificates</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">WHT</TableHead>
              <TableHead>Currency</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(data ?? []).map((r: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.vendor_name || "—"}</TableCell>
                  <TableCell className="text-right">{r.certificate_count}</TableCell>
                  <TableCell className="text-right">{fmt(r.gross_amount)}</TableCell>
                  <TableCell className="text-right text-red-600">{fmt(r.wht_amount)}</TableCell>
                  <TableCell>{r.currency}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone, raw }: { label: string; value: number; tone?: "green" | "red" | "primary"; raw?: boolean }) {
  const cls =
    tone === "green" ? "text-green-600" : tone === "red" ? "text-red-600" : tone === "primary" ? "text-primary" : "";
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${cls}`}>{raw ? value : fmt(value)}</div>
    </div>
  );
}

export default function TaxCompliance() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tax Compliance & E-Invoicing</h1>
        <p className="text-muted-foreground text-sm">
          Egyptian Tax Authority (ETA) e-invoice submission, VAT return preparation, and withholding-tax reporting.
        </p>
      </div>

      <Tabs defaultValue="eta">
        <TabsList>
          <TabsTrigger value="eta">ETA E-Invoicing</TabsTrigger>
          <TabsTrigger value="vat">VAT Returns</TabsTrigger>
          <TabsTrigger value="wht">WHT Reporting</TabsTrigger>
        </TabsList>
        <TabsContent value="eta" className="mt-4"><EtaTab /></TabsContent>
        <TabsContent value="vat" className="mt-4"><VatTab /></TabsContent>
        <TabsContent value="wht" className="mt-4"><WhtTab /></TabsContent>
      </Tabs>
    </div>
  );
}
