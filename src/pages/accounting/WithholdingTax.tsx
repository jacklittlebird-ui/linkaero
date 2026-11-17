// Tax Withholding Management (Phase 1u)
// -------------------------------------------------------------
// Two tabs:
//   1. Rules        — configure WHT rules (name, code, rate %, category, min amount).
//   2. Certificates — issue & track WHT certificates for vendor payments/invoices;
//                     auto-computes wht_amount and net_amount from rule rate.

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
import { Switch } from "@/components/ui/switch";
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
import { Download, FileText, Plus, Receipt } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format } from "date-fns";

const APPLIES_TO = [
  { value: "vendor_payment", label: "Vendor Payment" },
  { value: "vendor_invoice", label: "Vendor Invoice" },
  { value: "service_fee", label: "Service Fee" },
];

const CATEGORIES = [
  "Services",
  "Professional Fees",
  "Rent",
  "Contracting",
  "Commissions",
  "Other",
];

interface Company { id: string; code: string; name: string; }

interface Rule {
  id: string;
  name: string;
  code: string;
  rate: number;
  applies_to: string;
  service_category: string | null;
  min_amount: number | null;
  company_id: string | null;
  active: boolean;
  notes: string | null;
}

interface Certificate {
  id: string;
  certificate_no: string;
  vendor_name: string;
  vendor_tax_id: string | null;
  wht_rule_id: string | null;
  issue_date: string;
  gross_amount: number;
  wht_rate: number;
  wht_amount: number;
  net_amount: number;
  currency: string;
  status: string;
  notes: string | null;
  wht_rules?: { name: string; code: string } | null;
}

export default function WithholdingTax() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [tab, setTab] = useState<"rules" | "certs">("rules");

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["wht", "companies"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, code, name").order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: rules = [], isLoading: rulesLoading } = useQuery<Rule[]>({
    queryKey: ["wht", "rules"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wht_rules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Rule[];
    },
  });

  const { data: certs = [], isLoading: certsLoading } = useQuery<Certificate[]>({
    queryKey: ["wht", "certificates"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wht_certificates")
        .select("*, wht_rules(name, code)")
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Certificate[];
    },
  });

  // --- Rules dialog ---
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    name: "", code: "", rate: "5", applies_to: "vendor_payment",
    service_category: "Services", min_amount: "0", company_id: "", active: true, notes: "",
  });

  const createRule = useMutation({
    mutationFn: async () => {
      const payload = {
        name: ruleForm.name.trim(),
        code: ruleForm.code.trim(),
        rate: Number(ruleForm.rate) || 0,
        applies_to: ruleForm.applies_to,
        service_category: ruleForm.service_category || null,
        min_amount: Number(ruleForm.min_amount) || 0,
        company_id: ruleForm.company_id || null,
        active: ruleForm.active,
        notes: ruleForm.notes || null,
      };
      if (!payload.name || !payload.code) throw new Error("Name and code are required");
      const { error } = await supabase.from("wht_rules").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("WHT rule created");
      qc.invalidateQueries({ queryKey: ["wht", "rules"] });
      setRuleOpen(false);
      setRuleForm({
        name: "", code: "", rate: "5", applies_to: "vendor_payment",
        service_category: "Services", min_amount: "0", company_id: "", active: true, notes: "",
      });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create rule"),
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("wht_rules").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wht", "rules"] }),
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  // --- Certificate dialog ---
  const [certOpen, setCertOpen] = useState(false);
  const [certForm, setCertForm] = useState({
    certificate_no: "", vendor_name: "", vendor_tax_id: "",
    wht_rule_id: "", issue_date: format(new Date(), "yyyy-MM-dd"),
    gross_amount: "0", currency: "EGP", company_id: "", notes: "",
  });

  const selectedRule = useMemo(
    () => rules.find((r) => r.id === certForm.wht_rule_id) ?? null,
    [rules, certForm.wht_rule_id],
  );
  const computedWht = useMemo(() => {
    const gross = Number(certForm.gross_amount) || 0;
    const rate = selectedRule?.rate ?? 0;
    return { rate, wht: +(gross * rate / 100).toFixed(2), net: +(gross - gross * rate / 100).toFixed(2) };
  }, [certForm.gross_amount, selectedRule]);

  const createCert = useMutation({
    mutationFn: async () => {
      if (!certForm.certificate_no.trim()) throw new Error("Certificate number is required");
      if (!certForm.vendor_name.trim()) throw new Error("Vendor name is required");
      if (!certForm.wht_rule_id) throw new Error("Select a WHT rule");
      const payload = {
        certificate_no: certForm.certificate_no.trim(),
        vendor_name: certForm.vendor_name.trim(),
        vendor_tax_id: certForm.vendor_tax_id || null,
        wht_rule_id: certForm.wht_rule_id,
        issue_date: certForm.issue_date,
        gross_amount: Number(certForm.gross_amount) || 0,
        wht_rate: computedWht.rate,
        wht_amount: computedWht.wht,
        net_amount: computedWht.net,
        currency: certForm.currency,
        company_id: certForm.company_id || null,
        notes: certForm.notes || null,
        status: "Issued",
        created_by: session?.user?.id ?? null,
      };
      const { error } = await supabase.from("wht_certificates").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Certificate issued");
      qc.invalidateQueries({ queryKey: ["wht", "certificates"] });
      setCertOpen(false);
      setCertForm({
        certificate_no: "", vendor_name: "", vendor_tax_id: "",
        wht_rule_id: "", issue_date: format(new Date(), "yyyy-MM-dd"),
        gross_amount: "0", currency: "EGP", company_id: "", notes: "",
      });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to issue certificate"),
  });

  const kpis = useMemo(() => {
    const total = certs.reduce((s, c) => s + Number(c.wht_amount || 0), 0);
    const ytd = certs
      .filter((c) => new Date(c.issue_date).getFullYear() === new Date().getFullYear())
      .reduce((s, c) => s + Number(c.wht_amount || 0), 0);
    return { count: certs.length, total, ytd, rules: rules.filter((r) => r.active).length };
  }, [certs, rules]);

  const exportCerts = () => {
    exportToExcel(
      certs.map((c) => ({
        Certificate: c.certificate_no,
        Vendor: c.vendor_name,
        TaxID: c.vendor_tax_id ?? "",
        Rule: c.wht_rules?.name ?? "",
        Date: c.issue_date,
        Gross: c.gross_amount,
        Rate: c.wht_rate,
        WHT: c.wht_amount,
        Net: c.net_amount,
        Currency: c.currency,
        Status: c.status,
      })),
      "WHT Certificates",
      "wht_certificates",
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Receipt className="h-6 w-6" /> Tax Withholding
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage WHT rules and issue withholding certificates for vendors.
          </p>
        </div>
        <Button variant="outline" onClick={exportCerts} disabled={!certs.length}>
          <Download className="h-4 w-4 mr-2" /> Export Certificates
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Active Rules</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.rules}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Certificates</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.count}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total WHT</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.total.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">WHT YTD</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.ytd.toLocaleString()}</div></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="certs">Certificates</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" /> New Rule</Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>New WHT Rule</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Name</Label><Input value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} /></div>
                  <div><Label>Code</Label><Input value={ruleForm.code} onChange={(e) => setRuleForm({ ...ruleForm, code: e.target.value })} /></div>
                  <div><Label>Rate (%)</Label><Input type="number" step="0.001" value={ruleForm.rate} onChange={(e) => setRuleForm({ ...ruleForm, rate: e.target.value })} /></div>
                  <div><Label>Applies To</Label>
                    <Select value={ruleForm.applies_to} onValueChange={(v) => setRuleForm({ ...ruleForm, applies_to: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{APPLIES_TO.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Category</Label>
                    <Select value={ruleForm.service_category} onValueChange={(v) => setRuleForm({ ...ruleForm, service_category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Min Amount</Label><Input type="number" value={ruleForm.min_amount} onChange={(e) => setRuleForm({ ...ruleForm, min_amount: e.target.value })} /></div>
                  <div className="col-span-2"><Label>Company (optional)</Label>
                    <Select value={ruleForm.company_id || "all"} onValueChange={(v) => setRuleForm({ ...ruleForm, company_id: v === "all" ? "" : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All companies</SelectItem>
                        {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2"><Label>Notes</Label><Textarea value={ruleForm.notes} onChange={(e) => setRuleForm({ ...ruleForm, notes: e.target.value })} /></div>
                  <div className="col-span-2 flex items-center gap-2"><Switch checked={ruleForm.active} onCheckedChange={(v) => setRuleForm({ ...ruleForm, active: v })} /><Label>Active</Label></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRuleOpen(false)}>Cancel</Button>
                  <Button onClick={() => createRule.mutate()} disabled={createRule.isPending}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Applies To</TableHead>
                    <TableHead>Category</TableHead><TableHead className="text-right">Rate %</TableHead>
                    <TableHead className="text-right">Min</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rulesLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                  ) : rules.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No rules yet</TableCell></TableRow>
                  ) : rules.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{APPLIES_TO.find((a) => a.value === r.applies_to)?.label ?? r.applies_to}</TableCell>
                      <TableCell>{r.service_category ?? "—"}</TableCell>
                      <TableCell className="text-right">{Number(r.rate).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{Number(r.min_amount ?? 0).toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch checked={r.active} onCheckedChange={(v) => toggleRule.mutate({ id: r.id, active: v })} />
                          <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certs" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={certOpen} onOpenChange={setCertOpen}>
              <DialogTrigger asChild>
                <Button disabled={!rules.filter(r => r.active).length}><Plus className="h-4 w-4 mr-2" /> Issue Certificate</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Issue WHT Certificate</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Certificate No.</Label><Input value={certForm.certificate_no} onChange={(e) => setCertForm({ ...certForm, certificate_no: e.target.value })} /></div>
                  <div><Label>Issue Date</Label><DateInput  value={certForm.issue_date} onChange={(e) => setCertForm({ ...certForm, issue_date: e.target.value })} /></div>
                  <div><Label>Vendor Name</Label><Input value={certForm.vendor_name} onChange={(e) => setCertForm({ ...certForm, vendor_name: e.target.value })} /></div>
                  <div><Label>Vendor Tax ID</Label><Input value={certForm.vendor_tax_id} onChange={(e) => setCertForm({ ...certForm, vendor_tax_id: e.target.value })} /></div>
                  <div className="col-span-2"><Label>WHT Rule</Label>
                    <Select value={certForm.wht_rule_id} onValueChange={(v) => setCertForm({ ...certForm, wht_rule_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select rule" /></SelectTrigger>
                      <SelectContent>
                        {rules.filter(r => r.active).map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.code} — {r.name} ({r.rate}%)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Gross Amount</Label><Input type="number" step="0.01" value={certForm.gross_amount} onChange={(e) => setCertForm({ ...certForm, gross_amount: e.target.value })} /></div>
                  <div><Label>Currency</Label>
                    <Select value={certForm.currency} onValueChange={(v) => setCertForm({ ...certForm, currency: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{["EGP", "USD", "EUR", "GBP", "AED", "SAR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Company (optional)</Label>
                    <Select value={certForm.company_id || "none"} onValueChange={(v) => setCertForm({ ...certForm, company_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 grid grid-cols-3 gap-3 p-3 rounded-md bg-muted/40 text-sm">
                    <div><div className="text-muted-foreground">Rate</div><div className="font-semibold">{computedWht.rate}%</div></div>
                    <div><div className="text-muted-foreground">WHT Amount</div><div className="font-semibold">{computedWht.wht.toLocaleString()}</div></div>
                    <div><div className="text-muted-foreground">Net Payable</div><div className="font-semibold">{computedWht.net.toLocaleString()}</div></div>
                  </div>
                  <div className="col-span-2"><Label>Notes</Label><Textarea value={certForm.notes} onChange={(e) => setCertForm({ ...certForm, notes: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCertOpen(false)}>Cancel</Button>
                  <Button onClick={() => createCert.mutate()} disabled={createCert.isPending}>Issue</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Certificate</TableHead><TableHead>Vendor</TableHead>
                    <TableHead>Rule</TableHead><TableHead>Date</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">WHT</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certsLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                  ) : certs.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6"><FileText className="h-6 w-6 mx-auto mb-2 opacity-50" />No certificates issued yet</TableCell></TableRow>
                  ) : certs.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono">{c.certificate_no}</TableCell>
                      <TableCell>{c.vendor_name}{c.vendor_tax_id ? <span className="text-xs text-muted-foreground block">{c.vendor_tax_id}</span> : null}</TableCell>
                      <TableCell>{c.wht_rules?.name ?? "—"}</TableCell>
                      <TableCell>{format(new Date(c.issue_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell className="text-right">{Number(c.gross_amount).toLocaleString()} {c.currency}</TableCell>
                      <TableCell className="text-right">{Number(c.wht_rate).toFixed(2)}%</TableCell>
                      <TableCell className="text-right font-semibold">{Number(c.wht_amount).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{Number(c.net_amount).toLocaleString()}</TableCell>
                      <TableCell><Badge>{c.status}</Badge></TableCell>
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
