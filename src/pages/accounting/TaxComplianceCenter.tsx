// Phase 2l: Tax Compliance Center
// -------------------------------------------------------------
// - Track VAT / WHT / Corporate / Payroll filings with due dates
// - Filing calendar with recurring reminders
// - Overdue alerts and status KPIs
// - e-Invoicing submission status per filing
// - Excel export
import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Download, Plus, AlertTriangle, CalendarClock, FileCheck2, Receipt, Landmark } from "lucide-react";
import { format, differenceInCalendarDays, addMonths, addQuarters, addYears } from "date-fns";
import { exportToExcel } from "@/lib/exportExcel";
import { toast } from "sonner";

const TAX_TYPES = ["VAT", "WHT", "Corporate", "Payroll", "Other"] as const;
const STATUSES = ["draft", "filed", "paid", "overdue", "cancelled"] as const;
const EINV_STATUSES = ["n/a", "pending", "submitted", "accepted", "rejected"] as const;

const statusColor: Record<string, string> = {
  draft: "secondary",
  filed: "default",
  paid: "default",
  overdue: "destructive",
  cancelled: "outline",
};

const einvColor: Record<string, string> = {
  "n/a": "secondary",
  pending: "outline",
  submitted: "default",
  accepted: "default",
  rejected: "destructive",
};

type Filing = {
  id: string;
  company_id: string | null;
  tax_type: string;
  period_from: string;
  period_to: string;
  due_date: string;
  filing_date: string | null;
  reference_no: string | null;
  taxable_base: number;
  tax_amount: number;
  paid_amount: number;
  currency: string | null;
  status: string;
  e_invoice_status: string;
  notes: string | null;
};

type CalendarEvent = {
  id: string;
  company_id: string | null;
  tax_type: string;
  title: string;
  event_date: string;
  recurrence: string;
  reminder_days: number;
  notes: string | null;
};

export default function TaxComplianceCenter() {
  const qc = useQueryClient();
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [filingOpen, setFilingOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id,name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: filings = [], isLoading } = useQuery({
    queryKey: ["tax_filings", companyFilter],
    queryFn: async () => {
      let q = supabase.from("tax_filings").select("*").order("due_date", { ascending: false });
      if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Filing[];
    },
  });

  const { data: events = [] } = useQuery({
    queryKey: ["tax_calendar_events", companyFilter],
    queryFn: async () => {
      let q = supabase.from("tax_calendar_events").select("*").order("event_date");
      if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CalendarEvent[];
    },
  });

  const kpis = useMemo(() => {
    const today = new Date();
    let due = 0, overdue = 0, filed = 0, paid = 0, taxDue = 0, taxPaid = 0;
    filings.forEach(f => {
      const isPaid = f.status === "paid";
      const isFiled = f.status === "filed";
      const isOverdue = f.status === "overdue" || (f.status !== "paid" && f.status !== "cancelled" && new Date(f.due_date) < today);
      if (isPaid) paid++;
      if (isFiled) filed++;
      if (isOverdue) overdue++;
      if (!isPaid && f.status !== "cancelled") {
        due++;
        taxDue += Number(f.tax_amount || 0) - Number(f.paid_amount || 0);
      }
      taxPaid += Number(f.paid_amount || 0);
    });
    return { due, overdue, filed, paid, taxDue, taxPaid };
  }, [filings]);

  const upcoming = useMemo(() => {
    const today = new Date();
    return [...filings]
      .filter(f => f.status !== "paid" && f.status !== "cancelled")
      .map(f => ({ ...f, days: differenceInCalendarDays(new Date(f.due_date), today) }))
      .sort((a, b) => a.days - b.days)
      .slice(0, 20);
  }, [filings]);

  const upsertFiling = useMutation({
    mutationFn: async (payload: Partial<Filing> & { id?: string }) => {
      if (payload.id) {
        const { error } = await supabase.from("tax_filings").update(payload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tax_filings").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_filings"] });
      setFilingOpen(false);
      toast.success("Filing saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save filing"),
  });

  const upsertEvent = useMutation({
    mutationFn: async (payload: Partial<CalendarEvent>) => {
      const { error } = await supabase.from("tax_calendar_events").insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_calendar_events"] });
      setEventOpen(false);
      toast.success("Calendar event added");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to add event"),
  });

  const markPaid = useMutation({
    mutationFn: async (f: Filing) => {
      const { error } = await supabase
        .from("tax_filings")
        .update({ status: "paid", paid_amount: f.tax_amount, filing_date: f.filing_date ?? new Date().toISOString().slice(0, 10) })
        .eq("id", f.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_filings"] });
      toast.success("Filing marked as paid");
    },
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  const nextOccurrence = (ev: CalendarEvent, from: Date) => {
    const base = new Date(ev.event_date);
    if (ev.recurrence === "once" || base > from) return base;
    let next = base;
    while (next < from) {
      if (ev.recurrence === "monthly") next = addMonths(next, 1);
      else if (ev.recurrence === "quarterly") next = addQuarters(next, 1);
      else if (ev.recurrence === "yearly") next = addYears(next, 1);
      else break;
    }
    return next;
  };

  const calendarView = useMemo(() => {
    const today = new Date();
    return events
      .map(ev => {
        const next = nextOccurrence(ev, today);
        return { ...ev, next, days: differenceInCalendarDays(next, today) };
      })
      .filter(ev => ev.days <= 120)
      .sort((a, b) => a.days - b.days);
  }, [events]);

  const handleExport = () => {
    exportToExcel(
      filings.map(f => ({
        "Tax Type": f.tax_type,
        Company: companies.find((c: any) => c.id === f.company_id)?.name ?? "-",
        "Period From": f.period_from,
        "Period To": f.period_to,
        "Due Date": f.due_date,
        "Filing Date": f.filing_date ?? "-",
        Reference: f.reference_no ?? "-",
        "Taxable Base": f.taxable_base,
        "Tax Amount": f.tax_amount,
        "Paid": f.paid_amount,
        Currency: f.currency ?? "EGP",
        Status: f.status,
        "e-Invoice": f.e_invoice_status,
      })),
      "Filings",
      `tax-filings-${format(new Date(), "yyyy-MM-dd")}`
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Landmark className="h-6 w-6" /> Tax Compliance Center
          </h1>
          <p className="text-sm text-muted-foreground">
            VAT, WHT, Corporate Tax filings, calendar reminders, and e-invoicing status.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Company" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-2" />Export</Button>
          <Dialog open={filingOpen} onOpenChange={setFilingOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />New Filing</Button>
            </DialogTrigger>
            <FilingDialog
              companies={companies}
              onSave={(p) => upsertFiling.mutate(p)}
              saving={upsertFiling.isPending}
            />
          </Dialog>
          <Dialog open={eventOpen} onOpenChange={setEventOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary"><CalendarClock className="h-4 w-4 mr-2" />Add Reminder</Button>
            </DialogTrigger>
            <EventDialog
              companies={companies}
              onSave={(p) => upsertEvent.mutate(p)}
              saving={upsertEvent.isPending}
            />
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Open Filings" value={kpis.due} icon={<Receipt className="h-4 w-4" />} />
        <Kpi label="Overdue" value={kpis.overdue} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
        <Kpi label="Filed" value={kpis.filed} icon={<FileCheck2 className="h-4 w-4" />} />
        <Kpi label="Paid" value={kpis.paid} tone="success" icon={<FileCheck2 className="h-4 w-4" />} />
        <Kpi label="Tax Due" value={kpis.taxDue.toLocaleString(undefined, { maximumFractionDigits: 2 })} tone="danger" />
        <Kpi label="Tax Paid (YTD)" value={kpis.taxPaid.toLocaleString(undefined, { maximumFractionDigits: 2 })} tone="success" />
      </div>

      <Tabs defaultValue="filings">
        <TabsList>
          <TabsTrigger value="filings">Filings</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming Due</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="filings">
          <Card>
            <CardHeader><CardTitle>All Filings</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>e-Invoice</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : filings.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">No filings yet. Click <b>New Filing</b> to get started.</TableCell></TableRow>
                  ) : filings.map(f => (
                    <TableRow key={f.id}>
                      <TableCell><Badge variant="outline">{f.tax_type}</Badge></TableCell>
                      <TableCell>{companies.find((c: any) => c.id === f.company_id)?.name ?? "-"}</TableCell>
                      <TableCell className="text-xs">{format(new Date(f.period_from), "dd/MM/yy")} – {format(new Date(f.period_to), "dd/MM/yy")}</TableCell>
                      <TableCell>{format(new Date(f.due_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell className="text-xs">{f.reference_no ?? "-"}</TableCell>
                      <TableCell className="text-right">{Number(f.tax_amount).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{Number(f.paid_amount).toLocaleString()}</TableCell>
                      <TableCell><Badge variant={statusColor[f.status] as any}>{f.status}</Badge></TableCell>
                      <TableCell><Badge variant={einvColor[f.e_invoice_status] as any}>{f.e_invoice_status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {f.status !== "paid" && f.status !== "cancelled" && (
                          <Button size="sm" variant="outline" onClick={() => markPaid.mutate(f)}>Mark Paid</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upcoming">
          <Card>
            <CardHeader><CardTitle>Upcoming Due (open filings)</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcoming.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Nothing due.</TableCell></TableRow>
                  ) : upcoming.map(f => (
                    <TableRow key={f.id}>
                      <TableCell><Badge variant="outline">{f.tax_type}</Badge></TableCell>
                      <TableCell>{companies.find((c: any) => c.id === f.company_id)?.name ?? "-"}</TableCell>
                      <TableCell>{format(new Date(f.due_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>
                        <Badge variant={f.days < 0 ? "destructive" : f.days <= 7 ? "default" : "secondary"}>
                          {f.days < 0 ? `${Math.abs(f.days)}d overdue` : `${f.days}d`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{Number(f.tax_amount).toLocaleString()}</TableCell>
                      <TableCell><Badge variant={statusColor[f.status] as any}>{f.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <Card>
            <CardHeader><CardTitle>Recurring Calendar (next 120 days)</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Next Occurrence</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Recurrence</TableHead>
                    <TableHead>Reminder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calendarView.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No reminders scheduled.</TableCell></TableRow>
                  ) : calendarView.map(ev => (
                    <TableRow key={ev.id}>
                      <TableCell>{ev.title}</TableCell>
                      <TableCell><Badge variant="outline">{ev.tax_type}</Badge></TableCell>
                      <TableCell>{companies.find((c: any) => c.id === ev.company_id)?.name ?? "-"}</TableCell>
                      <TableCell>{format(ev.next, "dd/MM/yyyy")}</TableCell>
                      <TableCell>
                        <Badge variant={ev.days <= ev.reminder_days ? "default" : "secondary"}>
                          {ev.days}d
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize">{ev.recurrence}</TableCell>
                      <TableCell>{ev.reminder_days}d before</TableCell>
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

function Kpi({ label, value, tone, icon }: { label: string; value: any; tone?: "danger" | "success"; icon?: React.ReactNode }) {
  const color = tone === "danger" ? "text-destructive" : tone === "success" ? "text-emerald-600" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
        <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function FilingDialog({ companies, onSave, saving }: { companies: any[]; onSave: (p: any) => void; saving: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<any>({
    tax_type: "VAT",
    company_id: null,
    period_from: today,
    period_to: today,
    due_date: today,
    reference_no: "",
    taxable_base: 0,
    tax_amount: 0,
    paid_amount: 0,
    currency: "EGP",
    status: "draft",
    e_invoice_status: "n/a",
    notes: "",
  });
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>New Tax Filing</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Tax Type</Label>
          <Select value={form.tax_type} onValueChange={(v) => setForm({ ...form, tax_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TAX_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Company</Label>
          <Select value={form.company_id ?? "none"} onValueChange={(v) => setForm({ ...form, company_id: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Period From</Label><DateInput  value={form.period_from} onChange={(e) => setForm({ ...form, period_from: e.target.value })} /></div>
        <div><Label>Period To</Label><DateInput  value={form.period_to} onChange={(e) => setForm({ ...form, period_to: e.target.value })} /></div>
        <div><Label>Due Date</Label><DateInput  value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
        <div><Label>Reference No</Label><Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
        <div><Label>Taxable Base</Label><Input type="number" step="0.01" value={form.taxable_base} onChange={(e) => setForm({ ...form, taxable_base: Number(e.target.value) })} /></div>
        <div><Label>Tax Amount</Label><Input type="number" step="0.01" value={form.tax_amount} onChange={(e) => setForm({ ...form, tax_amount: Number(e.target.value) })} /></div>
        <div><Label>Currency</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>e-Invoice Status</Label>
          <Select value={form.e_invoice_status} onValueChange={(v) => setForm({ ...form, e_invoice_status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{EINV_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </div>
      <DialogFooter>
        <Button disabled={saving} onClick={() => onSave(form)}>{saving ? "Saving…" : "Save Filing"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EventDialog({ companies, onSave, saving }: { companies: any[]; onSave: (p: any) => void; saving: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<any>({
    tax_type: "VAT",
    title: "Monthly VAT Filing",
    company_id: null,
    event_date: today,
    recurrence: "monthly",
    reminder_days: 7,
    notes: "",
  });
  return (
    <DialogContent className="max-w-xl">
      <DialogHeader><DialogTitle>Add Calendar Reminder</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div>
          <Label>Tax Type</Label>
          <Select value={form.tax_type} onValueChange={(v) => setForm({ ...form, tax_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TAX_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Company</Label>
          <Select value={form.company_id ?? "none"} onValueChange={(v) => setForm({ ...form, company_id: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Event Date</Label><DateInput  value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></div>
        <div>
          <Label>Recurrence</Label>
          <Select value={form.recurrence} onValueChange={(v) => setForm({ ...form, recurrence: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="once">Once</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Reminder (days before)</Label><Input type="number" value={form.reminder_days} onChange={(e) => setForm({ ...form, reminder_days: Number(e.target.value) })} /></div>
        <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </div>
      <DialogFooter>
        <Button disabled={saving} onClick={() => onSave(form)}>{saving ? "Saving…" : "Save Reminder"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
