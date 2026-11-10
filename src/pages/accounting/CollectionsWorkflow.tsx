// AR/AP Aging with Collections Workflow (Phase 2i)
// -------------------------------------------------------------
// - Aging buckets (Current / 1-30 / 31-60 / 61-90 / 90+) for AR & AP
// - Sync from open invoices / vendor_invoices into collection_cases
// - Dunning stages, promise-to-pay tracking, activity log
// - Email-ready collection letter templates (mailto)
// - Excel export
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, RefreshCw, Mail, Plus, AlertTriangle, DollarSign, Users, Clock } from "lucide-react";
import { format } from "date-fns";
import { exportToExcel } from "@/lib/exportExcel";
import { toast } from "sonner";

const BUCKET_LABELS: Record<string, string> = {
  current: "Current",
  "1_30": "1-30 days",
  "31_60": "31-60 days",
  "61_90": "61-90 days",
  over_90: "90+ days",
};

const STAGE_LABELS: Record<string, string> = {
  none: "None",
  reminder_1: "1st Reminder",
  reminder_2: "2nd Reminder",
  final_notice: "Final Notice",
  legal: "Legal",
  written_off: "Written Off",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  promised: "Promised",
  partial: "Partial",
  resolved: "Resolved",
  escalated: "Escalated",
  written_off: "Written Off",
};

const stageColor: Record<string, string> = {
  none: "secondary",
  reminder_1: "outline",
  reminder_2: "default",
  final_notice: "destructive",
  legal: "destructive",
  written_off: "secondary",
};

const money = (n: number, c = "EGP") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: c || "EGP" }).format(n || 0);

type Case = any;

export default function CollectionsWorkflowPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("ar");
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityDraft, setActivityDraft] = useState({
    activity_type: "call",
    contact_person: "",
    outcome: "",
    notes: "",
    next_action_date: "",
  });

  const casesQ = useQuery({
    queryKey: ["collection_cases"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collection_cases")
        .select("*")
        .order("days_overdue", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const activitiesQ = useQuery({
    queryKey: ["collection_activities", selectedCase?.id],
    enabled: !!selectedCase?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collection_activities")
        .select("*")
        .eq("case_id", selectedCase.id)
        .order("performed_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const refreshAging = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("refresh_collection_cases_aging");
      if (error) throw error;
      return data;
    },
    onSuccess: (n) => {
      toast.success(`Recomputed aging on ${n ?? 0} cases`);
      qc.invalidateQueries({ queryKey: ["collection_cases"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncFromInvoices = useMutation({
    mutationFn: async () => {
      // Pull open AR invoices past/near due
      const { data: invs, error: e1 } = await supabase
        .from("invoices")
        .select("id, invoice_no, operator, total, currency, due_date, status")
        .in("status", ["sent", "overdue", "partial"] as any)
        .not("due_date", "is", null);
      if (e1) throw e1;

      const { data: vinvs, error: e2 } = await supabase
        .from("vendor_invoices")
        .select("id, invoice_no, vendor_name, total, currency, due_date, status")
        .in("status", ["approved", "posted", "overdue", "partial"])
        .not("due_date", "is", null);
      if (e2) throw e2;

      const { data: existing } = await supabase
        .from("collection_cases")
        .select("invoice_id, vendor_invoice_id");
      const arSet = new Set((existing || []).map((r: any) => r.invoice_id).filter(Boolean));
      const apSet = new Set((existing || []).map((r: any) => r.vendor_invoice_id).filter(Boolean));

      const today = new Date();
      const rows: any[] = [];
      for (const i of invs || []) {
        if (arSet.has(i.id)) continue;
        const days = Math.max(0, Math.floor((today.getTime() - new Date(i.due_date).getTime()) / 86400000));
        rows.push({
          invoice_id: i.id,
          case_type: "AR",
          counterparty_name: i.operator || "Unknown",
          amount_outstanding: i.total || 0,
          currency: i.currency || "EGP",
          due_date: i.due_date,
          days_overdue: days,
          aging_bucket: days <= 0 ? "current" : days <= 30 ? "1_30" : days <= 60 ? "31_60" : days <= 90 ? "61_90" : "over_90",
          notes: `Auto-created from invoice ${i.invoice_no}`,
        });
      }
      for (const v of vinvs || []) {
        if (apSet.has(v.id)) continue;
        const days = Math.max(0, Math.floor((today.getTime() - new Date(v.due_date).getTime()) / 86400000));
        rows.push({
          vendor_invoice_id: v.id,
          case_type: "AP",
          counterparty_name: v.vendor_name || "Unknown",
          amount_outstanding: v.total || 0,
          currency: v.currency || "EGP",
          due_date: v.due_date,
          days_overdue: days,
          aging_bucket: days <= 0 ? "current" : days <= 30 ? "1_30" : days <= 60 ? "31_60" : days <= 90 ? "61_90" : "over_90",
          notes: `Auto-created from vendor invoice ${v.invoice_no}`,
        });
      }
      if (!rows.length) return { inserted: 0 };
      const { error: e3 } = await supabase.from("collection_cases").insert(rows);
      if (e3) throw e3;
      return { inserted: rows.length };
    },
    onSuccess: (r) => {
      toast.success(`Synced ${r.inserted} new case(s)`);
      qc.invalidateQueries({ queryKey: ["collection_cases"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateCase = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const { error } = await supabase.from("collection_cases").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Case updated");
      qc.invalidateQueries({ queryKey: ["collection_cases"] });
      if (selectedCase?.id) {
        supabase.from("collection_cases").select("*").eq("id", selectedCase.id).maybeSingle().then(({ data }) => {
          if (data) setSelectedCase(data);
        });
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addActivity = useMutation({
    mutationFn: async () => {
      if (!selectedCase) return;
      const { error } = await supabase.from("collection_activities").insert({
        case_id: selectedCase.id,
        ...activityDraft,
        next_action_date: activityDraft.next_action_date || null,
      });
      if (error) throw error;
      // Also update last_contact_date + next_action_date on case
      await supabase.from("collection_cases").update({
        last_contact_date: new Date().toISOString().slice(0, 10),
        next_action_date: activityDraft.next_action_date || null,
      }).eq("id", selectedCase.id);
    },
    onSuccess: () => {
      toast.success("Activity logged");
      setActivityOpen(false);
      setActivityDraft({ activity_type: "call", contact_person: "", outcome: "", notes: "", next_action_date: "" });
      qc.invalidateQueries({ queryKey: ["collection_activities", selectedCase?.id] });
      qc.invalidateQueries({ queryKey: ["collection_cases"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cases = casesQ.data || [];
  const ar = cases.filter((c: any) => c.case_type === "AR");
  const ap = cases.filter((c: any) => c.case_type === "AP");

  const bucketize = (list: any[]) => {
    const b: Record<string, number> = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
    for (const c of list) b[c.aging_bucket] = (b[c.aging_bucket] || 0) + Number(c.amount_outstanding || 0);
    return b;
  };
  const arBuckets = useMemo(() => bucketize(ar), [ar]);
  const apBuckets = useMemo(() => bucketize(ap), [ap]);

  const totalOverdueAR = ar.filter((c: any) => c.days_overdue > 0).reduce((s: number, c: any) => s + Number(c.amount_outstanding || 0), 0);
  const totalOverdueAP = ap.filter((c: any) => c.days_overdue > 0).reduce((s: number, c: any) => s + Number(c.amount_outstanding || 0), 0);
  const openCount = cases.filter((c: any) => !["resolved", "written_off"].includes(c.status)).length;
  const promiseCount = cases.filter((c: any) => c.status === "promised").length;

  const exportRows = (list: any[]) =>
    exportToExcel(
      list.map((c: any) => ({
        Type: c.case_type,
        Counterparty: c.counterparty_name,
        Amount: c.amount_outstanding,
        Currency: c.currency,
        DueDate: c.due_date,
        DaysOverdue: c.days_overdue,
        Bucket: BUCKET_LABELS[c.aging_bucket],
        Stage: STAGE_LABELS[c.dunning_stage],
        Status: STATUS_LABELS[c.status],
        Promise: c.promise_to_pay_date || "",
        LastContact: c.last_contact_date || "",
        NextAction: c.next_action_date || "",
      })),
      "Collections",
      `collections_${Date.now()}.xlsx`
    );

  const buildLetter = (c: any) => {
    const subj = `Outstanding Payment Reminder – Invoice ${c.notes?.match(/[A-Z0-9-]+$/)?.[0] || ""} (${c.days_overdue} days overdue)`;
    const body = `Dear ${c.counterparty_name},\n\nOur records show an outstanding balance of ${money(c.amount_outstanding, c.currency)} due on ${c.due_date}, currently ${c.days_overdue} days overdue.\n\nWe kindly request settlement at your earliest convenience. Please share the remittance advice once payment is issued.\n\nRegards,\nLink Aviation Services – Finance`;
    window.open(`mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`);
  };

  const renderList = (list: any[]) => (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Counterparty</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Days</TableHead>
            <TableHead>Bucket</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No cases</TableCell></TableRow>
          )}
          {list.map((c: any) => (
            <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelectedCase(c)}>
              <TableCell className="font-medium">{c.counterparty_name}</TableCell>
              <TableCell className="text-right">{money(c.amount_outstanding, c.currency)}</TableCell>
              <TableCell>{c.due_date ? format(new Date(c.due_date), "dd/MM/yyyy") : "—"}</TableCell>
              <TableCell>{c.days_overdue}</TableCell>
              <TableCell><Badge variant="outline">{BUCKET_LABELS[c.aging_bucket]}</Badge></TableCell>
              <TableCell><Badge variant={stageColor[c.dunning_stage] as any}>{STAGE_LABELS[c.dunning_stage]}</Badge></TableCell>
              <TableCell><Badge variant={c.status === "resolved" ? "secondary" : "default"}>{STATUS_LABELS[c.status]}</Badge></TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); buildLetter(c); }}>
                  <Mail className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  const renderBuckets = (b: Record<string, number>, title: string) => (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-5 gap-2">
        {Object.entries(BUCKET_LABELS).map(([k, label]) => (
          <div key={k} className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold">{money(b[k] || 0)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">AR/AP Aging & Collections</h1>
          <p className="text-sm text-muted-foreground">Aging buckets, dunning stages, promise-to-pay tracking, and email-ready letters.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => syncFromInvoices.mutate()} disabled={syncFromInvoices.isPending}>
            <Plus className="h-4 w-4 mr-1" /> Sync from Invoices
          </Button>
          <Button variant="outline" onClick={() => refreshAging.mutate()} disabled={refreshAging.isPending}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh Aging
          </Button>
          <Button variant="outline" onClick={() => exportRows(cases)}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4 flex items-center gap-3"><DollarSign className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Overdue AR</div><div className="text-lg font-semibold">{money(totalOverdueAR)}</div></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><AlertTriangle className="h-5 w-5 text-destructive" /><div><div className="text-xs text-muted-foreground">Overdue AP</div><div className="text-lg font-semibold">{money(totalOverdueAP)}</div></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><Users className="h-5 w-5" /><div><div className="text-xs text-muted-foreground">Open Cases</div><div className="text-lg font-semibold">{openCount}</div></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><Clock className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Promise-to-Pay</div><div className="text-lg font-semibold">{promiseCount}</div></div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {renderBuckets(arBuckets, "AR Aging")}
        {renderBuckets(apBuckets, "AP Aging")}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="ar">AR Cases ({ar.length})</TabsTrigger>
          <TabsTrigger value="ap">AP Cases ({ap.length})</TabsTrigger>
          <TabsTrigger value="promised">Promise-to-Pay ({promiseCount})</TabsTrigger>
        </TabsList>
        <TabsContent value="ar">{renderList(ar)}</TabsContent>
        <TabsContent value="ap">{renderList(ap)}</TabsContent>
        <TabsContent value="promised">{renderList(cases.filter((c: any) => c.status === "promised"))}</TabsContent>
      </Tabs>

      {/* Case detail dialog */}
      <Dialog open={!!selectedCase} onOpenChange={(o) => !o && setSelectedCase(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedCase?.case_type} · {selectedCase?.counterparty_name}
            </DialogTitle>
          </DialogHeader>
          {selectedCase && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-muted-foreground">Outstanding</div><div className="font-semibold">{money(selectedCase.amount_outstanding, selectedCase.currency)}</div></div>
                <div><div className="text-muted-foreground">Due Date</div><div>{selectedCase.due_date}</div></div>
                <div><div className="text-muted-foreground">Days Overdue</div><div>{selectedCase.days_overdue}</div></div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Dunning Stage</Label>
                  <Select
                    value={selectedCase.dunning_stage}
                    onValueChange={(v) => updateCase.mutate({ id: selectedCase.id, patch: { dunning_stage: v } })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STAGE_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select
                    value={selectedCase.status}
                    onValueChange={(v) => updateCase.mutate({ id: selectedCase.id, patch: { status: v } })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Promise-to-Pay Date</Label>
                  <Input
                    type="date"
                    defaultValue={selectedCase.promise_to_pay_date || ""}
                    onBlur={(e) => updateCase.mutate({ id: selectedCase.id, patch: { promise_to_pay_date: e.target.value || null, status: e.target.value ? "promised" : selectedCase.status } })}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">Activity Log</div>
                  <Button size="sm" onClick={() => setActivityOpen(true)}><Plus className="h-4 w-4 mr-1" /> Log Activity</Button>
                </div>
                <div className="rounded-md border max-h-64 overflow-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>Contact</TableHead><TableHead>Outcome</TableHead><TableHead>Notes</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(activitiesQ.data || []).length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No activity yet</TableCell></TableRow>
                      )}
                      {(activitiesQ.data || []).map((a: any) => (
                        <TableRow key={a.id}>
                          <TableCell className="whitespace-nowrap">{format(new Date(a.performed_at), "dd/MM/yy HH:mm")}</TableCell>
                          <TableCell><Badge variant="outline">{a.activity_type}</Badge></TableCell>
                          <TableCell>{a.contact_person}</TableCell>
                          <TableCell>{a.outcome}</TableCell>
                          <TableCell className="text-xs">{a.notes}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => selectedCase && buildLetter(selectedCase)}>
              <Mail className="h-4 w-4 mr-1" /> Draft Letter
            </Button>
            <Button onClick={() => setSelectedCase(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add activity dialog */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Activity</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={activityDraft.activity_type} onValueChange={(v) => setActivityDraft(s => ({ ...s, activity_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["call", "email", "letter", "sms", "meeting", "note", "payment_received", "promise", "escalation"].map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contact Person</Label>
              <Input value={activityDraft.contact_person} onChange={(e) => setActivityDraft(s => ({ ...s, contact_person: e.target.value }))} />
            </div>
            <div>
              <Label>Outcome</Label>
              <Input value={activityDraft.outcome} onChange={(e) => setActivityDraft(s => ({ ...s, outcome: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={activityDraft.notes} onChange={(e) => setActivityDraft(s => ({ ...s, notes: e.target.value }))} />
            </div>
            <div>
              <Label>Next Action Date</Label>
              <Input type="date" value={activityDraft.next_action_date} onChange={(e) => setActivityDraft(s => ({ ...s, next_action_date: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivityOpen(false)}>Cancel</Button>
            <Button onClick={() => addActivity.mutate()} disabled={addActivity.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
