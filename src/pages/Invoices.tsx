import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { askEgpRate, isEthiopianOperator } from "@/lib/invoiceEgp";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import {
  Search, Plus, Download, Upload, FileText, DollarSign,
  Pencil, Trash2, X, ChevronLeft, ChevronRight, CheckCircle,
  Clock, XCircle, AlertCircle, Printer, ShieldCheck, Eye,
  TrendingUp, Filter, Calendar, BarChart3, Zap, RefreshCw, Hash
} from "lucide-react";
import { formatDateDMY } from "@/lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { useSupabaseTable } from "@/hooks/useSupabaseQuery";
import { useAirportsRef, useContractServiceRatesRef } from "@/data/referenceData";
import { useInvoices } from "@/data/finance";
import { useFlightHistory } from "@/data/flights";
import { useDispatchBoardFS } from "@/data/dispatch";
import { useServiceReportsForInvoicing } from "@/data/serviceReports";
import {
  useInvoiceMonthlyOperators,
  useRefreshInvoiceMonthlySummary,
} from "@/data/invoiceSummary";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useChannel } from "@/contexts/ChannelContext";
import InvoicePrintView from "@/components/InvoicePrintView";
import SecurityInvoicePrintView from "@/components/invoices/SecurityInvoicePrintView";
import InvoiceDetailModal from "@/components/invoices/InvoiceDetailModal";
import { logAudit } from "@/lib/auditLogger";
import { parseSecurityDetail, serializeSecurityDetail, backfillSecurityDetail, resolveDetailOvertimeHours, type SecurityDetailRow } from "@/lib/securityInvoiceDetail";
import { calculateSecurityCharges } from "@/lib/securityChargeCalculator";
import { buildAirlineContractMap, buildRatesByContract, resolveEffectiveSecurityCharge } from "@/lib/securityRowCharges";
import { dedupeDispatchRows, resolveBillingDate } from "@/lib/securityDispatchRows";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type InvoiceStatus = "Draft" | "Sent" | "Paid" | "Overdue" | "Cancelled";
type InvoiceCurrency = "USD" | "EUR" | "EGP";
type InvoiceType = "Preliminary" | "Final";

type InvoiceRow = {
  id: string; invoice_no: string; date: string; due_date: string;
  operator: string; airline_iata: string; flight_ref: string; description: string;
  civil_aviation: number; handling: number; airport_charges: number;
  catering: number; other: number; subtotal: number; vat: number; total: number;
  currency: InvoiceCurrency; status: InvoiceStatus; notes: string;
  invoice_type: InvoiceType; finalized_at: string | null; finalized_by: string | null;
  journal_entry_id: string | null; sent_at: string | null; sent_to: string | null;
  payment_date: string | null; payment_ref: string; billing_period: string;
  credit_note_ref: string; station: string;
};

const statusConfig: Record<InvoiceStatus, { icon: React.ReactNode; cls: string }> = {
  Draft:     { icon: <Clock size={11} />,       cls: "bg-muted text-muted-foreground" },
  Sent:      { icon: <AlertCircle size={11} />, cls: "bg-info/15 text-info" },
  Paid:      { icon: <CheckCircle size={11} />, cls: "bg-success/15 text-success" },
  Overdue:   { icon: <XCircle size={11} />,     cls: "bg-destructive/15 text-destructive" },
  Cancelled: { icon: <X size={11} />,           cls: "bg-warning/15 text-warning" },
};

const StatusBadge = ({ s }: { s: InvoiceStatus }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${statusConfig[s]?.cls || ""}`}>
    {statusConfig[s]?.icon}{s}
  </span>
);

const inputCls = "text-sm border rounded px-2 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground w-full";
const selectCls = "text-sm border rounded px-2 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full";

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>{children}</div>;
}

const emptyInvoice = (): Partial<InvoiceRow> => ({
  invoice_no: `LNK-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
  date: new Date().toISOString().slice(0, 10),
  due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  operator: "", airline_iata: "", flight_ref: "", description: "",
  civil_aviation: 0, handling: 0, airport_charges: 0, catering: 0, other: 0,
  subtotal: 0, vat: 0, total: 0, currency: "USD" as InvoiceCurrency, status: "Draft" as InvoiceStatus, notes: "",
  invoice_type: "Preliminary" as InvoiceType,
  payment_date: null, payment_ref: "", billing_period: "", credit_note_ref: "", station: "CAI",
});

function InvoiceForm({ data, onChange, onSave, onCancel, title }: { data: Partial<InvoiceRow>; onChange: (d: Partial<InvoiceRow>) => void; onSave: () => void; onCancel: () => void; title: string; }) {
  const set = (key: string, val: any) => {
    const updated = { ...data, [key]: val };
    const sub = (Number(updated.civil_aviation) || 0) + (Number(updated.handling) || 0) + (Number(updated.airport_charges) || 0) + (Number(updated.catering) || 0) + (Number(updated.other) || 0);
    const total = sub + (Number(updated.vat) || 0);
    onChange({ ...updated, subtotal: sub, total });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
      <div className="bg-card rounded-xl border shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
          <h2 className="font-bold text-foreground text-lg flex items-center gap-2"><FileText size={18} className="text-primary" />{title}</h2>
          <button onClick={onCancel} className="p-1.5 hover:bg-muted rounded-full text-muted-foreground"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-5">
          <div><h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-3">Invoice Details</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <FormField label="Invoice No."><input className={inputCls} value={data.invoice_no || ""} onChange={e => set("invoice_no", e.target.value)} /></FormField>
              <FormField label="Date"><input type="date" className={inputCls} value={data.date || ""} onChange={e => set("date", e.target.value)} /></FormField>
              <FormField label="Due Date"><input type="date" className={inputCls} value={data.due_date || ""} onChange={e => set("due_date", e.target.value)} /></FormField>
              <FormField label="Operator"><input className={inputCls} value={data.operator || ""} onChange={e => set("operator", e.target.value)} placeholder="Air Cairo" /></FormField>
              <FormField label="IATA Code"><input className={inputCls} value={data.airline_iata || ""} onChange={e => set("airline_iata", e.target.value)} /></FormField>
              <FormField label="Flight Ref."><input className={inputCls} value={data.flight_ref || ""} onChange={e => set("flight_ref", e.target.value)} /></FormField>
              <div className="col-span-2 md:col-span-3"><FormField label="Description"><input className={inputCls} value={data.description || ""} onChange={e => set("description", e.target.value)} /></FormField></div>
            </div>
          </div>
          <div><h3 className="text-xs font-bold text-info uppercase tracking-wider mb-3">Charges</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <FormField label="Civil Aviation ($)"><input type="number" className={inputCls} value={data.civil_aviation || 0} onChange={e => set("civil_aviation", +e.target.value)} /></FormField>
              <FormField label="Handling ($)"><input type="number" className={inputCls} value={data.handling || 0} onChange={e => set("handling", +e.target.value)} /></FormField>
              <FormField label="Airport Charges ($)"><input type="number" className={inputCls} value={data.airport_charges || 0} onChange={e => set("airport_charges", +e.target.value)} /></FormField>
              <FormField label="Catering ($)"><input type="number" className={inputCls} value={data.catering || 0} onChange={e => set("catering", +e.target.value)} /></FormField>
              <FormField label="Other ($)"><input type="number" className={inputCls} value={data.other || 0} onChange={e => set("other", +e.target.value)} /></FormField>
              <FormField label="VAT ($)"><input type="number" className={inputCls} value={data.vat || 0} onChange={e => set("vat", +e.target.value)} /></FormField>
            </div>
          </div>
          <div className="bg-muted rounded-lg p-4 grid grid-cols-3 gap-4">
            <div className="text-center"><div className="text-xs text-muted-foreground uppercase font-semibold">Subtotal</div><div className="text-lg font-bold text-foreground">${(data.subtotal || 0).toFixed(2)}</div></div>
            <div className="text-center"><div className="text-xs text-muted-foreground uppercase font-semibold">VAT</div><div className="text-lg font-bold text-foreground">${(data.vat || 0).toFixed(2)}</div></div>
            <div className="text-center border-l"><div className="text-xs text-primary uppercase font-bold">Total</div><div className="text-2xl font-bold text-primary">${(data.total || 0).toFixed(2)}</div></div>
          </div>
          <div><h3 className="text-xs font-bold text-success uppercase tracking-wider mb-3">Payment & Billing</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <FormField label="Status"><select className={selectCls} value={data.status || "Draft"} onChange={e => set("status", e.target.value)}>{(["Draft","Sent","Paid","Overdue","Cancelled"] as InvoiceStatus[]).map(s => <option key={s}>{s}</option>)}</select></FormField>
              <FormField label="Currency"><select className={selectCls} value={data.currency || "USD"} onChange={e => set("currency", e.target.value)}>{(["USD","EUR","EGP"] as InvoiceCurrency[]).map(c => <option key={c}>{c}</option>)}</select></FormField>
              <FormField label="Invoice Type"><select className={selectCls} value={data.invoice_type || "Preliminary"} onChange={e => set("invoice_type", e.target.value)}>{(["Preliminary","Final"] as InvoiceType[]).map(t => <option key={t}>{t}</option>)}</select></FormField>
              <FormField label="Station"><input className={inputCls} value={data.station || "CAI"} onChange={e => set("station", e.target.value)} placeholder="CAI" /></FormField>
              <FormField label="Billing Period"><input className={inputCls} value={data.billing_period || ""} onChange={e => set("billing_period", e.target.value)} placeholder="Jan 2026" /></FormField>
              <FormField label="Credit Note Ref."><input className={inputCls} value={data.credit_note_ref || ""} onChange={e => set("credit_note_ref", e.target.value)} placeholder="CN-2026-001" /></FormField>
              <FormField label="Payment Date"><input type="date" className={inputCls} value={data.payment_date || ""} onChange={e => set("payment_date", e.target.value || null)} /></FormField>
              <FormField label="Payment Reference"><input className={inputCls} value={data.payment_ref || ""} onChange={e => set("payment_ref", e.target.value)} placeholder="Wire TXN #" /></FormField>
            </div>
          </div>
          <div>
            <FormField label="Notes"><textarea className={inputCls + " resize-none"} rows={2} value={data.notes || ""} onChange={e => set("notes", e.target.value)} /></FormField>
          </div>
        </div>
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex gap-3 justify-end rounded-b-xl">
          <button onClick={onCancel} className="toolbar-btn-outline">Cancel</button>
          <button onClick={onSave} className="toolbar-btn-primary">Save Invoice</button>
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 15;

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { activeChannel } = useChannel();
  const readOnly = activeChannel === "payables";
  const { data: invoicesRaw, isLoading, add, update, remove, bulkInsert } = useInvoices<InvoiceRow>();
  const invoices = Array.isArray(invoicesRaw) ? invoicesRaw : [];
  const { data: dispatchesRaw } = useDispatchBoardFS({ scope: "history" });
  // A flight can accumulate more than one dispatch row (re-created task sheets,
  // re-assignments). Billing must count ONE billable dispatch per flight using
  // the exact same winner as the Service Report list, or monthly station totals
  // drift (e.g. RMF/SSH June 2026). Latest saved row wins.
  const dispatches = useMemo(() => {
    const rows = Array.isArray(dispatchesRaw) ? dispatchesRaw : [];
    return dedupeDispatchRows(rows);
  }, [dispatchesRaw]);

  const { data: contracts } = useSupabaseTable<any>("contracts");
  const { data: flightSchedules } = useFlightHistory();
  const { data: contractRates } = useContractServiceRatesRef();
  const { data: airports } = useAirportsRef();

  // Map: first flight_no in flight_ref -> registration
  const regByFlightNo = useMemo(() => {
    const m: Record<string, string> = {};
    (flightSchedules || []).forEach((f: any) => {
      const k = (f.flight_no || "").trim().toUpperCase();
      if (k && f.registration && !m[k]) m[k] = f.registration;
    });
    return m;
  }, [flightSchedules]);
  const getInvoiceReg = useCallback((inv: InvoiceRow) => {
    if (!inv.flight_ref) return "";
    const first = inv.flight_ref.split(",")[0].trim().toUpperCase();
    return regByFlightNo[first] || "";
  }, [regByFlightNo]);

  // Lookup flight_schedules by id and by (flight_no + date) so we can
  // enrich dispatch rows (which don't carry registration / route columns).
  const fsById = useMemo(() => {
    const m: Record<string, any> = {};
    (flightSchedules || []).forEach((f: any) => { if (f.id) m[f.id] = f; });
    return m;
  }, [flightSchedules]);
  const fsByFlightDate = useMemo(() => {
    const m: Record<string, any> = {};
    (flightSchedules || []).forEach((f: any) => {
      const no = (f.flight_no || "").trim().toUpperCase();
      if (!no) return;
      // flight_schedules has NO `flight_date` column — the operational date is
      // arrival_date (falling back to departure_date). Keying on the missing
      // column silently produced an all-empty map, which dropped SKD type and
      // therefore the ADHOC surcharge from generated invoices.
      for (const dt of [f.arrival_date, f.departure_date]) {
        const d = (dt || "").toString().slice(0, 10);
        if (!d) continue;
        const k = `${no}__${d}`;
        if (!m[k]) m[k] = f;
      }
    });
    return m;
  }, [flightSchedules]);
  const lookupFlightInfo = useCallback((d: any): { reg: string; route: string; aircraftType: string; skdType: string; arrDate: string; depDate: string } => {
    const fromId = d?.flight_schedule_id ? fsById[d.flight_schedule_id] : null;
    const key = `${(d?.flight_no || "").trim().toUpperCase()}__${(d?.flight_date || "").toString().slice(0, 10)}`;
    const fromKey = fsByFlightDate[key];
    const f = fromId || fromKey;
    // AUTHORITATIVE: `v_dispatch_with_flight` already joins the flight schedule
    // (fs_* columns). These win over any client-side lookup, which can miss rows
    // when the flight list is scoped/windowed differently — that mismatch is what
    // made billing totals drift from the Service Report list.
    const pickField = (viewVal: any, joinVal: any) => {
      const v = (viewVal ?? "").toString().trim();
      return v || (joinVal ?? "").toString().trim();
    };
    return {
      reg: pickField(d?.fs_registration, f?.registration),
      route: pickField(d?.fs_route, f?.route),
      aircraftType: pickField(d?.fs_aircraft_type, f?.aircraft_type),
      skdType: pickField(d?.fs_skd_type, f?.skd_type),
      arrDate: resolveBillingDate(d) || pickField(d?.fs_arrival_date, f?.arrival_date),
      depDate: pickField(d?.fs_departure_date, f?.departure_date),
    };
  }, [fsById, fsByFlightDate]);


  // Build a descriptive service-type label including overtime information.
  const buildServiceTypeLabel = (d: any): string => {
    const parts: string[] = [];
    const base = (d?.service_type || "").toString().trim();
    if (base) parts.push(base);
    const ot = Number(d?.overtime_hours) || 0;
    const otCharge = Number(d?.overtime_charge) || 0;
    if (ot > 0 || otCharge > 0) {
      parts.push(ot > 0 ? `Overtime ${ot}h` : "Overtime");
    }
    if (d?.short_notice) parts.push("Short-notice");
    if (d?.return_to_ramp_with_load) parts.push("Return-to-ramp");
    if (Number(d?.extra_manpower_count) > 0) parts.push(`+${d.extra_manpower_count} Manpower`);
    if (Number(d?.ramp_vehicle_trips) > 0) parts.push(`${d.ramp_vehicle_trips} Ramp trip(s)`);
    return parts.join(" • ");
  };
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryTab, setCategoryTab] = useState<"handling" | "security">("security");
  const [typeFilter, setTypeFilter] = useState("All");
  const [currencyFilter, setCurrencyFilter] = useState("All");
  const [operatorFilter, setOperatorFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [minTotal, setMinTotal] = useState("");
  const [maxTotal, setMaxTotal] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newInvoice, setNewInvoice] = useState<Partial<InvoiceRow>>(emptyInvoice());
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<InvoiceRow>>({});
  const [printInvoice, setPrintInvoice] = useState<any>(null);
  const [detailInvoice, setDetailInvoice] = useState<InvoiceRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showBillingPreview, setShowBillingPreview] = useState(false);
  const [billingMonth, setBillingMonth] = useState(new Date().toISOString().slice(0, 7));
  const [billingStation, setBillingStation] = useState("All");
  const [showMonthlyAirline, setShowMonthlyAirline] = useState(false);
  const [monthlyAirlineMonth, setMonthlyAirlineMonth] = useState(new Date().toISOString().slice(0, 7));
  const [monthlyAirlineOperator, setMonthlyAirlineOperator] = useState("Air Cairo");
  const [manualInvoiceNo, setManualInvoiceNo] = useState("");
  const [monthlyTab, setMonthlyTab] = useState<"security" | "handling">("security");
  const [showSecurityAnnexPreview, setShowSecurityAnnexPreview] = useState(false);
  const [securityAnnexDateFrom, setSecurityAnnexDateFrom] = useState("");
  const [securityAnnexDateTo, setSecurityAnnexDateTo] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Batch 3: narrow invoice-purpose projection (~17 cols vs full 82-col view).
  const { data: serviceReportsRaw } = useServiceReportsForInvoicing({ scope: "history" });
  const serviceReports = Array.isArray(serviceReportsRaw) ? serviceReportsRaw : [];

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const operator = params.get("operator");
    if (operator) {
      const prefilled: Partial<InvoiceRow> = {
        ...emptyInvoice(), operator,
        airline_iata: params.get("airlineIATA") || "",
        flight_ref: params.get("flightRef") || "",
        description: params.get("description") || "",
        civil_aviation: Number(params.get("civilAviation") || 0),
        handling: Number(params.get("handling") || 0),
        airport_charges: Number(params.get("airportCharges") || 0),
      };
      const sub = (prefilled.civil_aviation || 0) + (prefilled.handling || 0) + (prefilled.airport_charges || 0);
      prefilled.subtotal = sub; prefilled.total = sub;
      setNewInvoice(prefilled); setShowAdd(true);
    }
  }, [location.search]);

  const operators = useMemo(() => [...new Set(invoices.map(i => i.operator).filter(Boolean))].sort(), [invoices]);

  const filtered = useMemo(() => {
    let r = invoices;
    // Category split — Security invoices are tagged via invoice_no suffix "-SEC" or description/notes containing "Security"
    const isSecurity = (i: any) => {
      const no = (i.invoice_no || "").toUpperCase();
      const d = `${i.description || ""} ${i.notes || ""}`.toLowerCase();
      return no.includes("-SEC") || d.includes("security");
    };
    if (categoryTab === "handling") r = r.filter(i => !isSecurity(i));
    else if (categoryTab === "security") r = r.filter(i => isSecurity(i));
    if (statusFilter !== "All") r = r.filter(i => i.status === statusFilter);
    if (typeFilter !== "All") r = r.filter(i => (i.invoice_type || "Preliminary") === typeFilter);
    if (currencyFilter !== "All") r = r.filter(i => i.currency === currencyFilter);
    if (operatorFilter !== "All") r = r.filter(i => i.operator === operatorFilter);
    if (dateFrom) r = r.filter(i => i.date >= dateFrom);
    if (dateTo) r = r.filter(i => i.date <= dateTo);
    if (dueFrom) r = r.filter(i => (i.due_date || "") >= dueFrom);
    if (dueTo) r = r.filter(i => (i.due_date || "") <= dueTo);
    const minT = minTotal ? parseFloat(minTotal) : null;
    const maxT = maxTotal ? parseFloat(maxTotal) : null;
    if (minT !== null) r = r.filter(i => (i.total || 0) >= minT);
    if (maxT !== null) r = r.filter(i => (i.total || 0) <= maxT);
    if (search) { const s = search.toLowerCase(); r = r.filter(i => i.invoice_no.toLowerCase().includes(s) || i.operator.toLowerCase().includes(s) || i.flight_ref?.toLowerCase().includes(s) || (i.notes || "").toLowerCase().includes(s) || getInvoiceReg(i).toLowerCase().includes(s)); }
    return r;
  }, [invoices, statusFilter, typeFilter, currencyFilter, operatorFilter, dateFrom, dateTo, dueFrom, dueTo, minTotal, maxTotal, search, categoryTab]);

  const { pageRows: pageData, ...pag } = usePagination(filtered, { resetKey: [search, statusFilter, categoryTab, typeFilter, currencyFilter, operatorFilter, dateFrom, dateTo, dueFrom, dueTo, minTotal, maxTotal] });

  // KPI calculations
  const totalRevenue = invoices.reduce((s, i) => s + i.total, 0);
  const totalPaid = invoices.filter(i => i.status === "Paid").reduce((s, i) => s + i.total, 0);
  const totalPending = invoices.filter(i => i.status === "Sent" || i.status === "Draft").reduce((s, i) => s + i.total, 0);
  const totalOverdue = invoices.filter(i => i.status === "Overdue").reduce((s, i) => s + i.total, 0);
  const finalizedCount = invoices.filter(i => i.invoice_type === "Final").length;
  const collectionRate = totalRevenue > 0 ? Math.round((totalPaid / totalRevenue) * 100) : 0;

  const activeFilterCount = [statusFilter !== "All", typeFilter !== "All", currencyFilter !== "All", operatorFilter !== "All", !!dateFrom, !!dateTo, !!dueFrom, !!dueTo, !!minTotal, !!maxTotal].filter(Boolean).length;

  const saveNew = async () => {
    if (!newInvoice.operator) return;
    await add(newInvoice as any);
    setShowAdd(false); setNewInvoice(emptyInvoice());
  };
  const startEdit = (inv: InvoiceRow) => { setEditId(inv.id); setEditData({ ...inv }); };
  const editInvoiceNo = async (inv: InvoiceRow) => {
    const next = window.prompt("Invoice No.", inv.invoice_no || "");
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === inv.invoice_no) return;
    await update({ id: inv.id, invoice_no: trimmed } as any);
    setDetailInvoice(prev => (prev && prev.id === inv.id ? { ...prev, invoice_no: trimmed } : prev));
    setPrintInvoice(prev => (prev && (prev as any).id === inv.id ? { ...(prev as any), invoiceNo: trimmed } : prev));
    toast({ title: "Invoice number updated", description: trimmed });
  };

  const saveEdit = async () => {
    if (!editId) return;
    const { id, ...rest } = editData;
    await update({ id: editId, ...rest } as any);
    setEditId(null);
  };

  const handleFinalize = async (inv: InvoiceRow) => {
    if (!confirm(`Finalize invoice ${inv.invoice_no}? This will create a journal entry.`)) return;
    try {
      const { data, error } = await supabase.functions.invoke("finalize-invoice", {
        body: { invoice_id: inv.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      logAudit({ action: "approve", entity_type: "invoice", entity_id: inv.id, details: { invoice_no: inv.invoice_no, total: inv.total, currency: inv.currency, journal_entry_no: (data as any)?.entry_no } });
      toast({ title: "✅ Invoice Finalized", description: `Journal entry ${(data as any)?.entry_no} created and posted.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const auditedRemove = async (id: string) => {
    const inv = invoices?.find((i: InvoiceRow) => i.id === id);
    await remove(id);
    logAudit({
      action: "delete",
      entity_type: "invoice",
      entity_id: id,
      details: {
        invoice_no: inv?.invoice_no,
        operator: inv?.operator,
        total: inv?.total,
        currency: inv?.currency,
        status: inv?.status,
        deleted_at: new Date().toISOString(),
      },
    });
  };

  const requestDeleteSingle = (id: string) => {
    const inv = invoices?.find((i: InvoiceRow) => i.id === id);
    setDeleteTarget({ ids: [id], label: inv?.invoice_no || id });
  };

  const requestDeleteBulk = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const nos = ids
      .map((id) => invoices?.find((i: InvoiceRow) => i.id === id)?.invoice_no)
      .filter(Boolean) as string[];
    const label = nos.length <= 5 ? nos.join(", ") : `${nos.slice(0, 5).join(", ")} +${nos.length - 5} more`;
    setDeleteTarget({ ids, label });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      for (const id of deleteTarget.ids) {
        await auditedRemove(id);
      }
      if (deleteTarget.ids.length > 1) setSelectedIds(new Set());
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Bulk actions
  const handleBulkDelete = () => requestDeleteBulk();

  const handleBulkStatusChange = async (newStatus: InvoiceStatus) => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await supabase.from("invoices").update({ status: newStatus } as any).eq("id", id);
      logAudit({ action: "update", entity_type: "invoice", entity_id: id, details: { status: newStatus } });
    }
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    setSelectedIds(new Set());
    toast({ title: "Updated", description: `${selectedIds.size} invoice(s) marked as ${newStatus}` });
  };


  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };
  const toggleAll = () => {
    if (selectedIds.size === pageData.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(pageData.map(i => i.id)));
  };

  const handleExport = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Invoices summary (all record fields)
    const summaryRows = filtered.map(i => {
      const { detail } = parseSecurityDetail(i.notes);
      const totalFlights = detail.length;
      const sum = (k: keyof SecurityDetailRow) =>
        detail.reduce((s, r) => s + (Number(r[k] as any) || 0), 0);
      // Match the record view: security invoices show Security Fee =
      // sum(handling + other) across detail rows; other buckets fall back to
      // detail sums when the aggregated invoice field is 0.
      const detHandling = detail.reduce((s, r) => s + (Number(r.handling) || 0) + (Number(r.other) || 0), 0);
      const detTotal = detail.reduce((s, r) => s + (Number(r.total) || 0), 0);
      const secFee = Number(i.handling) || detHandling;
      const civil = Number(i.civil_aviation) || sum("civil");
      const airport = Number(i.airport_charges) || sum("airport");
      const other = Number(i.other) || 0;
      const vat = Number(i.vat) || 0;
      const subtotal = Number(i.subtotal) || (secFee + civil + airport + other);
      const total = Number(i.total) || (subtotal + vat) || detTotal;
      return {
        "Invoice No": i.invoice_no,
        Date: i.date,
        "Due Date": i.due_date,
        Operator: i.operator,
        IATA: i.airline_iata,
        Station: i.station,
        "Billing Period": i.billing_period,
        Type: i.invoice_type,
        Status: i.status,
        Currency: i.currency,
        Description: i.description,
        "Total Flights": totalFlights,
        "Security Fee": secFee,
        "Civil Aviation": civil,
        "Airport Charges": airport,
        Catering: Number(i.catering) || 0,
        Other: other,
        VAT: vat,
        Subtotal: subtotal,
        Total: total,
        "Duration (h)": sum("durationHours"),
        "Overtime (h)": detail.reduce((a, r) => a + resolveDetailOvertimeHours(r), 0),
        Notes: parseSecurityDetail(i.notes).cleanNotes,
      };
    });
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    wsSummary["!cols"] = [
      { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 8 },
      { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 9 },
      { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 40 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Invoices");

    // Sheet 2: Charges breakdown (per-flight detail, mirrors record preview)
    const detailRows: any[] = [];
    filtered.forEach(i => {
      const { detail } = parseSecurityDetail(i.notes);
      detail.forEach((r, idx) => {
        detailRows.push({
          "Invoice No": i.invoice_no,
          Operator: i.operator,
          IATA: i.airline_iata,
          Station: i.station,
          Currency: i.currency,
          "#": idx + 1,
          "Arr Date": r.arrDate || r.date || "",
          "Dep Date": r.depDate || "",
          Flight: r.flight || "",
          Reg: r.reg || "",
          Route: r.route || "",
          "Service Type": r.serviceType || r.type || "",
          SKD: r.skdType || "",
          Start: r.actualStart || "",
          End: r.actualEnd || "",
          "Duration (h)": Number(r.durationHours) || 0,
          "OT (h)": resolveDetailOvertimeHours(r),
          Staff: Number(r.staffCount) || 0,
          Amount: Number(r.total) || 0,
        });
      });
    });
    if (detailRows.length) {
      const wsDetail = XLSX.utils.json_to_sheet(detailRows);
      wsDetail["!cols"] = [
        { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 9 },
        { wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
        { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 8 },
        { wch: 12 }, { wch: 8 }, { wch: 7 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, wsDetail, "Charges Breakdown");
    }

    XLSX.writeFile(wb, "Link_Invoices_Export.xlsx");
  };

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
      const json = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
      const rows = json.map((row: any) => ({
        invoice_no: row["Invoice No"] || "", date: row["Date"] || "", due_date: row["Due Date"] || "",
        operator: row["Operator"] || "", airline_iata: row["IATA"] || "", flight_ref: row["Flight Ref"] || "",
        description: row["Description"] || "", civil_aviation: Number(row["Civil Aviation"] || 0),
        handling: Number(row["Handling"] || 0), airport_charges: Number(row["Airport Charges"] || 0),
        catering: Number(row["Catering"] || 0), other: Number(row["Other"] || 0), vat: Number(row["VAT"] || 0),
        currency: row["Currency"] || "USD", status: row["Status"] || "Draft", notes: row["Notes"] || "",
      }));
      await bulkInsert(rows); 
    };
    reader.readAsBinaryString(file); e.target.value = "";
  }, [bulkInsert]);

  const toPrintFormat = (inv: InvoiceRow) => ({
    id: inv.id, invoiceNo: inv.invoice_no, date: inv.date, dueDate: inv.due_date,
    operator: inv.operator, airlineIATA: inv.airline_iata, flightRef: inv.flight_ref,
    description: inv.description, civilAviation: inv.civil_aviation, handling: inv.handling,
    airportCharges: inv.airport_charges, catering: inv.catering, other: inv.other,
    subtotal: inv.subtotal, vat: inv.vat, total: inv.total, currency: inv.currency,
    status: inv.status, notes: inv.notes,
    station: inv.station, billingPeriod: inv.billing_period,
    _isSecurity: ((inv.invoice_no || "").toUpperCase().includes("-SEC")) ||
      `${inv.description || ""} ${inv.notes || ""}`.toLowerCase().includes("security"),
  });

  // Regenerate security invoice Annex A detail by backfilling missing
  // service-report fields from the latest dispatch + flight-schedule data.
  const regenerateSecurityDetail = useCallback(async (inv: InvoiceRow) => {
    const { detail, cleanNotes } = parseSecurityDetail(inv.notes);
    if (detail.length === 0) {
      toast({ title: "Nothing to regenerate", description: "This invoice has no per-flight detail to backfill.", variant: "destructive" });
      return;
    }
    const { rows, filledCount } = backfillSecurityDetail(detail, {
      dispatches: dispatches || [],
      flightSchedules: flightSchedules || [],
    });
    if (filledCount === 0) {
      toast({ title: "Already up to date", description: "No additional fields could be backfilled from source records." });
      return;
    }
    const newNotes = serializeSecurityDetail(cleanNotes, rows);
    await update({ id: inv.id, notes: newNotes } as any);
    logAudit({ action: "regenerate", entity_type: "invoice", entity_id: inv.id, details: { filledCount, rows: rows.length } });
    toast({ title: "✅ Invoice regenerated", description: `Backfilled ${filledCount} field(s) across ${rows.length} flight row(s).` });
  }, [dispatches, flightSchedules, update]);

  const clearFilters = () => { setStatusFilter("All"); setTypeFilter("All"); setCurrencyFilter("All"); setOperatorFilter("All"); setDateFrom(""); setDateTo(""); setDueFrom(""); setDueTo(""); setMinTotal(""); setMaxTotal(""); };

  // Shared charge maps — identical precedence to the Service Report page so
  // station/monthly totals can never drift between the two screens.
  const securityRatesByContract = useMemo(
    () => buildRatesByContract((contractRates || []) as any[]),
    [contractRates],
  );
  const securityAirlineToContract = useMemo(
    () => buildAirlineContractMap(
      ((contracts || []) as any[]).filter((c: any) =>
        ["Security", "Both"].includes(String(c?.service_category || "")) &&
        String(c?.status || "") === "Active"
      ),
    ),
    [contracts],
  );

  /** Effective billable amount for a dispatch row (live > stored > legacy). */
  const effectiveDispatchCharge = useCallback((d: any) => {
    const fi = lookupFlightInfo(d);
    return resolveEffectiveSecurityCharge(d, {
      ratesByContractId: securityRatesByContract,
      airlineToContractId: securityAirlineToContract,
      skdType: fi.skdType,
    });
  }, [securityRatesByContract, securityAirlineToContract, lookupFlightInfo]);

  // Billing month is based on the authoritative flight schedule date first.
  // Dispatch `flight_date` can be stale after station/route/date amendments, so
  // using it first can hide an incomplete flight from Generate Monthly Billing.
  const resolveDispatchBillingDate = useCallback((d: any) => {
    const fi = lookupFlightInfo(d);
    // Shared resolver (task-sheet ARR DATE first) so the invoice period always
    // matches the ARR DATE the Service Report list shows and filters on.
    return (
      resolveBillingDate(d) ||
      (fi.arrDate || fi.depDate || "").toString().slice(0, 10)
    );
  }, [lookupFlightInfo]);


  const getDispatchIncompleteReasons = useCallback((d: any): string[] => {
    const reasons: string[] = [];
    const workflowStatus = String(d?.status || "Pending").trim();
    const reviewStatus = String(d?.review_status || "Draft").trim();
    if (workflowStatus.toLowerCase() !== "completed") reasons.push(`Status: ${workflowStatus}`);
    if (reviewStatus.toLowerCase() !== "ready for billing") reasons.push(`Review: ${reviewStatus}`);
    if (!resolveDispatchBillingDate(d)) reasons.push("Missing billing date");
    return reasons;
  }, [resolveDispatchBillingDate]);

  const isDispatchBillingComplete = useCallback((d: any) => {
    return getDispatchIncompleteReasons(d).length === 0;
  }, [getDispatchIncompleteReasons]);



  // Billing preview: group completed dispatches by airline+station for the month
  const _rollupReport = (r: any) => {
    const civil = Number(r.civil_aviation_fee) || 0;
    const handling = Number(r.handling_fee) || 0;
    const airport =
      (Number(r.airport_charge) || 0) +
      (Number(r.landing_charge) || 0) +
      (Number(r.parking_charge) || 0) +
      (Number(r.housing_charge) || 0);
    const other =
      (Number(r.fuel_charge) || 0) +
      (Number(r.catering_charge) || 0) +
      (Number(r.hotac_charge) || 0);
    const lineTotal = Number(r.total_cost) || (civil + handling + airport + other);
    return { civil, handling, airport, other, total: lineTotal };
  };

  const billingPreviewData = useMemo(() => {
    type Group = { airline: string; station: string; flights: number; baseFees: number; serviceCharges: number; overtime: number; total: number; items: any[]; sources: { dispatches: number; reports: number } };
    const grouped: Record<string, Group> = {};

    // Scope source by active category tab — Security uses dispatches, Handling uses service reports
    const includeSecurity = categoryTab !== "handling";
    const includeHandling = categoryTab !== "security";

    // 1) Dispatch assignments (security side)
    const completedDispatches = includeSecurity ? dispatches.filter((d: any) => {
      const dt = resolveDispatchBillingDate(d);
      const matchMonth = dt.startsWith(billingMonth);
      const matchStation = billingStation === "All" || d.station === billingStation;
      return isDispatchBillingComplete(d) && matchMonth && matchStation;
    }) : [];

    completedDispatches.forEach((d: any) => {
      const key = `${d.airline}__${d.station}`;
      if (!grouped[key]) grouped[key] = { airline: d.airline, station: d.station, flights: 0, baseFees: 0, serviceCharges: 0, overtime: 0, total: 0, items: [], sources: { dispatches: 0, reports: 0 } };
      // Same resolver as the Service Report AMOUNT column — live contract math
      // first, stored values only as a fallback.
      const eff = effectiveDispatchCharge(d);
      grouped[key].flights++;
      grouped[key].sources.dispatches++;
      grouped[key].baseFees += eff.base;
      grouped[key].serviceCharges += eff.base;
      grouped[key].overtime += eff.overtime;
      grouped[key].total += eff.amount;
      grouped[key].items.push({ ...d, _source: "dispatch", _effBase: eff.base, _effOvertime: eff.overtime, _effTotal: eff.amount });
    });


    // 2) Service Reports (handling side) — approved & in selected month/station
    const matchedReports = includeHandling ? serviceReports.filter((r: any) => {
      const dt = (r.arrival_date || r.flight_date || "").toString();
      const matchMonth = dt.startsWith(billingMonth);
      const matchStation = billingStation === "All" || r.station === billingStation;
      const status = (r.review_status || "").toString().toLowerCase();
      const isApproved = status === "approved" || status.includes("billing");
      const ht = (r.handling_type || "").toString().toLowerCase();
      const isSecurityReport = ht.includes("security");
      return isApproved && matchMonth && matchStation && !isSecurityReport;
    }) : [];
    matchedReports.forEach((r: any) => {
      const airline = r.operator || r.airline || "Unknown";
      const station = r.station || "—";
      const key = `${airline}__${station}`;
      if (!grouped[key]) grouped[key] = { airline, station, flights: 0, baseFees: 0, serviceCharges: 0, overtime: 0, total: 0, items: [], sources: { dispatches: 0, reports: 0 } };
      const m = _rollupReport(r);
      grouped[key].flights++;
      grouped[key].sources.reports++;
      grouped[key].baseFees += m.civil;
      grouped[key].serviceCharges += m.handling + m.airport;
      grouped[key].overtime += m.other;
      grouped[key].total += m.total;
      grouped[key].items.push({ ...r, _source: "report" });
    });

    return Object.values(grouped);
  }, [dispatches, serviceReports, billingMonth, billingStation, categoryTab, effectiveDispatchCharge, lookupFlightInfo, resolveDispatchBillingDate, isDispatchBillingComplete]);

  // Guard: only allow "Generate from Dispatches" when every dispatch in the selected
  // month/station is marked Completed. Pending/in-progress dispatches block generation.
  const dispatchGenerationGuard = useMemo(() => {
    const scoped = (dispatches || []).filter((d: any) => {
      const dt = resolveDispatchBillingDate(d);
      const matchMonth = dt.startsWith(billingMonth);
      const matchStation = billingStation === "All" || d.station === billingStation;
      return matchMonth && matchStation;
    });
    const incomplete = scoped.filter((d: any) => !isDispatchBillingComplete(d));
    const incompleteRows = incomplete
      .map((d: any) => ({
        id: d.id,
        date: resolveDispatchBillingDate(d) || "—",
        station: d.station || "—",
        airline: d.airline || "—",
        flight: d.flight_no || "—",
        reasons: getDispatchIncompleteReasons(d),
      }))
      .sort((a: any, b: any) => {
        const byDate = String(a.date || "").localeCompare(String(b.date || ""));
        if (byDate !== 0) return byDate;
        return String(a.flight || "").localeCompare(String(b.flight || ""));
      });
    return {
      total: scoped.length,
      incompleteCount: incomplete.length,
      incompleteRows,
      allComplete: scoped.length > 0 && incomplete.length === 0,
      hasAny: scoped.length > 0,
    };
  }, [dispatches, billingMonth, billingStation, resolveDispatchBillingDate, isDispatchBillingComplete, getDispatchIncompleteReasons]);


  const generateInvoiceFromBilling = async (group: typeof billingPreviewData[0]) => {
    let civil = 0, handling = 0, airport = 0, other = 0;
    const detailRows: any[] = [];
    group.items.forEach((it: any) => {
      if (it._source === "report") {
        const m = _rollupReport(it);
        civil += m.civil; handling += m.handling; airport += m.airport; other += m.other;
        detailRows.push({
          date: it.arrival_date || "", flight: it.flight_no || "", reg: it.registration || "",
          route: it.route || "", station: it.station || group.station, type: it.handling_type || "",
          category: "Handling", civil: m.civil, handling: m.handling, airport: m.airport, other: m.other, total: m.total,
        });
      } else {
        // Use the same effective amounts the preview grouped on.
        const eff = it._effTotal !== undefined ? { base: it._effBase || 0, overtime: it._effOvertime || 0, amount: it._effTotal || 0 } : effectiveDispatchCharge(it);
        const base = eff.base;
        const ot = eff.overtime;
        handling += base; other += ot;

        const fi = lookupFlightInfo(it);
        detailRows.push({
          date: fi.arrDate || fi.depDate || it.flight_date || "", flight: it.flight_no || "",
          arrDate: fi.arrDate || it.flight_date || "",
          depDate: fi.depDate || it.flight_date || "",
          reg: it.registration || fi.reg || "",
          route: it.route || fi.route || "",
          station: it.station || group.station,
          type: buildServiceTypeLabel(it),
          serviceType: it.service_type || "",
          aircraftType: fi.aircraftType || "",
          skdType: fi.skdType || "",
          actualStart: it.actual_start || "",
          actualEnd: it.actual_end || "",
          durationHours: Number(it.actual_duration_hours) || 0,
          overtimeHours: Number(it.overtime_hours) || 0,
          contractHours: Number(it.contract_duration_hours) || 0,
          staffCount: Number(it.staff_count) || 0,
          category: "Security", civil: 0, handling: base, airport: 0, other: ot, total: base + ot,
        });
      }
    });
    const subtotal = civil + handling + airport + other;
    const isSecurityGroup = categoryTab === "security" || (group.sources.dispatches > 0 && group.sources.reports === 0);
    const suffix = isSecurityGroup ? "-SEC" : "";
    const headerNote = `${isSecurityGroup ? "Security " : ""}Auto-generated from ${group.sources.dispatches} dispatch + ${group.sources.reports} service-report record(s)`;
    const inv: Partial<InvoiceRow> = {
      invoice_no: `LNK-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}${suffix}`,
      date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      operator: group.airline,
      station: group.station,
      billing_period: billingMonth,
      civil_aviation: civil,
      handling,
      airport_charges: airport,
      catering: 0,
      other,
      subtotal, vat: 0, total: subtotal,
      currency: "USD" as InvoiceCurrency, status: "Draft" as InvoiceStatus,
      invoice_type: "Preliminary" as InvoiceType,
      description: `${isSecurityGroup ? "Security" : "Handling"} — ${group.flights} flights — ${group.station} — ${billingMonth}`,
      flight_ref: `${group.flights} flights`,
      notes: `${headerNote}\n__DETAIL__:${JSON.stringify(detailRows)}`,
    };
    if (isSecurityGroup && isEthiopianOperator(group.airline)) {
      const rate = askEgpRate();
      if (!rate) { toast({ title: "Invoice not created", description: "An exchange rate is required for Ethiopian Airlines." }); return; }
      Object.assign(inv, { exchange_rate: rate, exchange_rate_date: new Date().toISOString().slice(0, 10), base_currency: "EGP" });
    }
    await add(inv as any);
    toast({ title: "✅ Invoice Created", description: `Draft invoice for ${group.airline} at ${group.station}` });
  };

  // ===== Monthly Airline Invoice (1 invoice per airline per month, source = Service Reports) =====
  // Field rollup mapping (Service Report -> Invoice category):
  //   civil_aviation  <- civil_aviation_fee
  //   handling        <- handling_fee
  //   airport_charges <- airport_charge + landing_charge + parking_charge + housing_charge
  //   other           <- fuel_charge + catering_charge + hotac_charge
  const rollupReport = (r: any) => {
    const civil = Number(r.civil_aviation_fee) || 0;
    const handling = Number(r.handling_fee) || 0;
    const airport =
      (Number(r.airport_charge) || 0) +
      (Number(r.landing_charge) || 0) +
      (Number(r.parking_charge) || 0) +
      (Number(r.housing_charge) || 0);
    const other =
      (Number(r.fuel_charge) || 0) +
      (Number(r.catering_charge) || 0) +
      (Number(r.hotac_charge) || 0);
    const lineTotal = Number(r.total_cost) || (civil + handling + airport + other);
    return { civil, handling, airport, other, total: lineTotal };
  };

  // Monthly totals are computed from the same filtered report rows rendered in
  // the preview so counts and charges can never diverge.
  const refreshInvoiceSummary = useRefreshInvoiceMonthlySummary();


  const monthlyAirlinePreview = useMemo(() => {
    const reports = (serviceReports || []).filter((r: any) => {
      const rs = (r.review_status || "").toLowerCase().trim();
      const ht = (r.handling_type || "").toString().toLowerCase();
      return (rs === "approved" || rs === "ready for billing") &&
        !ht.includes("security") &&
        r.operator?.toLowerCase().trim() === monthlyAirlineOperator.toLowerCase().trim() &&
        (r.arrival_date || "").startsWith(monthlyAirlineMonth);
    });

    // Totals MUST be derived from the exact same rows shown in the record list,
    // otherwise the flight count, the charge columns and the grand total drift
    // apart (the MV is refreshed on demand and can be stale / differently scoped).
    let civil = 0, handling = 0, airport = 0, other = 0, total = 0;
    const byKey: Record<string, { station: string; type: string; flights: number; total: number }> = {};
    for (const r of reports) {
      const m = rollupReport(r);
      civil += m.civil; handling += m.handling; airport += m.airport; other += m.other; total += m.total;
      const station = r.station || "—";
      const type = r.handling_type || "—";
      const key = `${station}__${type}`;
      if (!byKey[key]) byKey[key] = { station, type, flights: 0, total: 0 };
      byKey[key].flights++;
      byKey[key].total += m.total;
    }
    const totals = { civil, handling, airport, other, total };
    const breakdown = Object.values(byKey);
    return { reports, totals, breakdown };
  }, [serviceReports, monthlyAirlineOperator, monthlyAirlineMonth]);


  // Operator dropdown: MV-distinct operators (precomputed) + dispatch airlines.
  // Plain Set union — not aggregation.
  const { data: mvOperators = [] } = useInvoiceMonthlyOperators();
  const allOperators = useMemo(() => {
    const set = new Set<string>(mvOperators);
    for (const d of dispatches || []) {
      if (d?.airline) set.add(d.airline);
    }
    return [...set].sort();
  }, [mvOperators, dispatches]);


  // Validation: flag service reports with missing fields or unusual values
  // BEFORE generating the monthly invoice. Helps users catch data issues early.
  type ReportIssue = {
    id: string; flight: string; date: string; station: string;
    severity: "error" | "warning";
    issues: string[];
  };
  const monthlyValidation = useMemo(() => {
    const issues: ReportIssue[] = [];
    const reports = monthlyAirlinePreview.reports;
    if (reports.length === 0) return { issues, errorCount: 0, warningCount: 0, cleanCount: 0 };

    // Compute median total for outlier detection (simple, no deps)
    const totals = reports.map((r: any) => rollupReport(r).total).filter(t => t > 0).sort((a, b) => a - b);
    const median = totals.length ? totals[Math.floor(totals.length / 2)] : 0;
    const outlierHigh = median * 5;
    const outlierLow = median > 0 ? median / 10 : 0;

    reports.forEach((r: any) => {
      const m = rollupReport(r);
      const rowIssues: string[] = [];
      let severity: "error" | "warning" = "warning";

      // Required fields
      if (!r.flight_no?.trim()) { rowIssues.push("Missing flight number"); severity = "error"; }
      if (!r.station?.trim()) { rowIssues.push("Missing station"); severity = "error"; }
      if (!r.arrival_date) { rowIssues.push("Missing arrival date"); severity = "error"; }
      if (!r.registration?.trim()) { rowIssues.push("Missing aircraft registration"); }
      if (!r.handling_type?.trim()) { rowIssues.push("Missing service type"); }
      if (!r.route?.trim()) { rowIssues.push("Missing route"); }

      // Numeric sanity
      if (m.total <= 0) { rowIssues.push("Total cost is zero"); severity = "error"; }
      if (m.civil < 0 || m.handling < 0 || m.airport < 0 || m.other < 0) {
        rowIssues.push("Negative charge amount"); severity = "error";
      }

      // Total mismatch with sum-of-parts (flag if reported total differs from rolled-up parts)
      const partsSum = m.civil + m.handling + m.airport + m.other;
      const reported = Number(r.total_cost) || 0;
      if (reported > 0 && partsSum > 0 && Math.abs(reported - partsSum) > 0.5) {
        rowIssues.push(`Total ${reported.toFixed(2)} ≠ sum of parts ${partsSum.toFixed(2)}`);
      }

      // Outliers vs median
      if (median > 0 && m.total > outlierHigh) {
        rowIssues.push(`Unusually high total (${m.total.toFixed(0)} vs median ${median.toFixed(0)})`);
      }
      if (median > 0 && m.total > 0 && m.total < outlierLow) {
        rowIssues.push(`Unusually low total (${m.total.toFixed(0)} vs median ${median.toFixed(0)})`);
      }

      if (rowIssues.length > 0) {
        issues.push({
          id: r.id,
          flight: r.flight_no || "—",
          date: r.arrival_date || "—",
          station: r.station || "—",
          severity,
          issues: rowIssues,
        });
      }
    });

    const errorCount = issues.filter(i => i.severity === "error").length;
    const warningCount = issues.filter(i => i.severity === "warning").length;
    return { issues, errorCount, warningCount, cleanCount: reports.length - issues.length };
  }, [monthlyAirlinePreview]);

  // ============================================================
  // SECURITY: monthly airline invoice (sourced from dispatch_assignments)
  // ============================================================
  // (charge maps + effectiveDispatchCharge are defined above, near the billing preview)



  const monthlySecurityPreview = useMemo(() => {
    const baseRows = (dispatches || []).filter((d: any) => {
      return isDispatchBillingComplete(d) &&
        d.airline?.toLowerCase().trim() === monthlyAirlineOperator.toLowerCase().trim() &&
        resolveDispatchBillingDate(d).startsWith(monthlyAirlineMonth);
    });
    // Enrich each row with effective charges (live-computed wins over stored).
    const rows = baseRows.map((d: any) => {
      const eff = effectiveDispatchCharge(d);
      return { ...d, _effBase: eff.base, _effOvertime: eff.overtime, _effTotal: eff.amount };
    });
    const totals = rows.reduce(
      (acc: any, d: any) => { acc.base += d._effBase; acc.overtime += d._effOvertime; acc.total += d._effTotal; return acc; },
      { base: 0, overtime: 0, total: 0 }
    );
    const byStationType: Record<string, { station: string; type: string; flights: number; total: number }> = {};
    rows.forEach((d: any) => {
      const key = `${d.station}__${d.service_type}`;
      if (!byStationType[key]) byStationType[key] = { station: d.station, type: d.service_type, flights: 0, total: 0 };
      byStationType[key].flights++;
      byStationType[key].total += d._effTotal;
    });
    return { rows, totals, breakdown: Object.values(byStationType) };
  }, [dispatches, monthlyAirlineOperator, monthlyAirlineMonth, effectiveDispatchCharge, resolveDispatchBillingDate, isDispatchBillingComplete]);


  type SecIssue = { id: string; flight: string; date: string; station: string; severity: "error" | "warning"; issues: string[] };
  const monthlySecurityValidation = useMemo(() => {
    const issues: SecIssue[] = [];
    const rows = monthlySecurityPreview.rows;
    if (rows.length === 0) return { issues, errorCount: 0, warningCount: 0, cleanCount: 0 };
    const totals = rows.map((d: any) => d._effTotal || 0).filter((t: number) => t > 0).sort((a: number, b: number) => a - b);
    const median = totals.length ? totals[Math.floor(totals.length / 2)] : 0;
    const outlierHigh = median * 5;
    const outlierLow = median > 0 ? median / 10 : 0;
    rows.forEach((d: any) => {
      const rowIssues: string[] = [];
      let severity: "error" | "warning" = "warning";
      if (!d.flight_no?.trim()) { rowIssues.push("Missing flight number"); severity = "error"; }
      if (!d.station?.trim()) { rowIssues.push("Missing station"); severity = "error"; }
      const billingDate = resolveDispatchBillingDate(d);
      if (!billingDate) { rowIssues.push("Missing flight date"); severity = "error"; }
      if (!d.service_type?.trim()) { rowIssues.push("Missing service type"); }
      const total = Number(d._effTotal) || 0;
      const effBase = Number(d._effBase) || 0;
      const effOt = Number(d._effOvertime) || 0;
      if (total <= 0) {
        if (!d.contract_id) rowIssues.push("No contract linked — cannot price");
        else rowIssues.push("Total charge is zero (no matching contract rate)");
        severity = "error";
      }
      if (effBase < 0 || effOt < 0) {
        rowIssues.push("Negative charge amount"); severity = "error";
      }
      const partsSum = effBase + effOt;
      if (total > 0 && partsSum > 0 && Math.abs(total - partsSum) > 0.5) {
        rowIssues.push(`Total ${total.toFixed(2)} ≠ base+overtime ${partsSum.toFixed(2)}`);
      }
      if (median > 0 && total > outlierHigh) rowIssues.push(`Unusually high total (${total.toFixed(0)} vs median ${median.toFixed(0)})`);
      if (median > 0 && total > 0 && total < outlierLow) rowIssues.push(`Unusually low total (${total.toFixed(0)} vs median ${median.toFixed(0)})`);
      if (rowIssues.length > 0) {
        issues.push({ id: d.id, flight: d.flight_no || "—", date: billingDate || "—", station: d.station || "—", severity, issues: rowIssues });
      }
    });
    const errorCount = issues.filter(i => i.severity === "error").length;
    const warningCount = issues.filter(i => i.severity === "warning").length;
    return { issues, errorCount, warningCount, cleanCount: rows.length - issues.length };
  }, [monthlySecurityPreview, resolveDispatchBillingDate]);

  // Annex A export-mirror: identical shape to detailRows used in generateMonthlySecurityInvoice
  const securityAnnexExport = useMemo(() => {
    const rows = monthlySecurityPreview.rows.map((d: any) => ({
      date: d.flight_date || "",
      flight: d.flight_no || "",
      station: d.station || "",
      type: d.service_type || "",
      base: Number(d._effBase) || 0,            // → "Handling" column in printed Annex A
      overtime: Number(d._effOvertime) || 0,    // → "Other" column in printed Annex A
      total: Number(d._effTotal) || 0,
    }));
    // Stable ordering (matches print/CSV): date asc, then flight no
    rows.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.flight || "").localeCompare(b.flight || ""));
    const totals = rows.reduce(
      (acc, r) => { acc.base += r.base; acc.overtime += r.overtime; acc.total += r.total; return acc; },
      { base: 0, overtime: 0, total: 0 }
    );
    // Distinct counts for summary line (flights, stations, dates)
    const stations = new Set(rows.map(r => (r.station || "").trim()).filter(Boolean));
    const flights = new Set(rows.map(r => (r.flight || "").trim()).filter(Boolean));
    const dates = new Set(rows.map(r => (r.date || "").trim()).filter(Boolean));
    const counts = {
      rows: rows.length,
      flights: flights.size,
      stations: stations.size,
      dates: dates.size,
    };
    // Cross-check vs preview totals (the values that will be written to the invoice header)
    const headerTotals = monthlySecurityPreview.totals;
    const totalsMismatch =
      Math.abs(totals.base - headerTotals.base) > 0.5 ||
      Math.abs(totals.overtime - headerTotals.overtime) > 0.5 ||
      Math.abs(totals.total - headerTotals.total) > 0.5;
    // Count-integrity: rows missing identifying fields will collapse in distinct sets,
    // creating a divergence between exported row count and what the printed Annex A summarises.
    const sourceRowCount = monthlySecurityPreview.rows.length;
    const missingStation = rows.filter(r => !(r.station || "").trim()).length;
    const missingFlight = rows.filter(r => !(r.flight || "").trim()).length;
    const missingDate = rows.filter(r => !(r.date || "").trim()).length;
    const rowCountMismatch = rows.length !== sourceRowCount;
    const countMismatch = rowCountMismatch || missingStation > 0 || missingFlight > 0 || missingDate > 0;
    const mismatch = totalsMismatch || countMismatch;
    return {
      rows, totals, counts, mismatch,
      totalsMismatch, countMismatch,
      integrity: { sourceRowCount, missingStation, missingFlight, missingDate, rowCountMismatch },
    };
  }, [monthlySecurityPreview]);

  // Preview-only filtered view (date range + per-station breakdown). Does NOT affect what gets exported.
  const securityAnnexFiltered = useMemo(() => {
    const from = securityAnnexDateFrom;
    const to = securityAnnexDateTo;
    const inRange = (d: string) => {
      if (!d) return !from && !to;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };
    const rows = securityAnnexExport.rows.filter(r => inRange(r.date));
    const totals = rows.reduce(
      (acc, r) => { acc.base += r.base; acc.overtime += r.overtime; acc.total += r.total; return acc; },
      { base: 0, overtime: 0, total: 0 }
    );
    const stations = new Set(rows.map(r => (r.station || "").trim()).filter(Boolean));
    const dates = new Set(rows.map(r => (r.date || "").trim()).filter(Boolean));
    const stationMap = new Map<string, { station: string; rows: number; base: number; overtime: number; total: number }>();
    for (const r of rows) {
      const key = (r.station || "—").trim() || "—";
      const existing = stationMap.get(key) || { station: key, rows: 0, base: 0, overtime: 0, total: 0 };
      existing.rows += 1;
      existing.base += r.base;
      existing.overtime += r.overtime;
      existing.total += r.total;
      stationMap.set(key, existing);
    }
    const stationBreakdown = Array.from(stationMap.values())
      .map(s => ({ station: s.station, rows: s.rows, flights: s.rows, base: s.base, overtime: s.overtime, total: s.total }))
      .sort((a, b) => b.total - a.total);
    const isFiltered = !!(from || to);
    return {
      rows, totals, stationBreakdown, isFiltered,
      counts: { rows: rows.length, flights: rows.length, stations: stations.size, dates: dates.size },
      hiddenCount: securityAnnexExport.rows.length - rows.length,
    };
  }, [securityAnnexExport, securityAnnexDateFrom, securityAnnexDateTo]);

  const generateMonthlySecurityInvoice = async () => {
    const { rows, totals } = monthlySecurityPreview;
    if (rows.length === 0) {
      toast({ title: "No data", description: "No approved security assignments for that airline & month.", variant: "destructive" });
      return;
    }
    if (monthlySecurityValidation.errorCount > 0) {
      toast({ title: `Cannot generate — ${monthlySecurityValidation.errorCount} assignment(s) have errors`, description: "Fix highlighted rows first.", variant: "destructive" });
      return;
    }
    if (monthlySecurityValidation.warningCount > 0) {
      const ok = window.confirm(`${monthlySecurityValidation.warningCount} security assignment(s) have validation warnings.\n\nGenerate the invoice anyway?`);
      if (!ok) return;
    }
    const baseNo = `LNK-${monthlyAirlineMonth.replace("-", "")}-${monthlyAirlineOperator.replace(/\s+/g, "").slice(0, 4).toUpperCase()}-SEC`;
    // Detect duplicates by airline + period + Security category — NOT by invoice number,
    // because manually numbered invoices (e.g. "201-2026") don't carry the -SEC suffix.
    const existingSec = (invoices || []).filter((inv: any) =>
      inv.operator?.toLowerCase().trim() === monthlyAirlineOperator.toLowerCase().trim() &&
      inv.billing_period === monthlyAirlineMonth && inv.station === "ALL" &&
      ((inv.invoice_no || "").includes("-SEC") || /security/i.test(inv.description || ""))
    );

    const duplicate = existingSec.find((inv: any) => (inv.status || "").toLowerCase() !== "cancelled");
    if (duplicate) {
      const ok = window.confirm(`A monthly Security invoice already exists for ${monthlyAirlineOperator} — ${monthlyAirlineMonth} (${duplicate.invoice_no}, ${duplicate.status}).\n\nCreate another anyway?`);
      if (!ok) { toast({ title: "Duplicate skipped", description: `Existing invoice ${duplicate.invoice_no} kept.` }); return; }
    }
    const invoiceNo = manualInvoiceNo.trim() || (existingSec.length > 0 ? `${baseNo}-R${existingSec.length + 1}` : baseNo);
    const detailRows = rows.map((d: any) => {
      const fi = lookupFlightInfo(d);
      return {
        date: d.flight_date || "", flight: d.flight_no || "",
        arrDate: fi.arrDate || d.flight_date || "",
        depDate: fi.depDate || d.flight_date || "",
        reg: d.registration || fi.reg || "",
        route: d.route || fi.route || "",
        station: d.station || "",
        type: buildServiceTypeLabel(d),
        serviceType: d.service_type || "",
        aircraftType: fi.aircraftType || "",
        skdType: fi.skdType || "",
        actualStart: d.actual_start || "",
        actualEnd: d.actual_end || "",
        durationHours: Number(d.actual_duration_hours) || 0,
        overtimeHours: Number(d.overtime_hours) || 0,
        contractHours: Number(d.contract_duration_hours) || 0,
        staffCount: Number(d.staff_count) || 0,
        civil: 0,
        handling: Number(d._effBase) || 0,           // base fee → handling column in Annex A
        airport: 0,
        other: Number(d._effOvertime) || 0,          // overtime → other column in Annex A
        total: Number(d._effTotal) || 0,
      };
    });
    const headerNote = `Monthly Security invoice for ${monthlyAirlineOperator} — ${monthlyAirlineMonth}. ${rows.length} approved security assignments across ${new Set(rows.map((d: any) => d.station)).size} station(s). See Annex A for per-flight detail.`;
    const subtotal = totals.total;
    const inv: Partial<InvoiceRow> = {
      invoice_no: invoiceNo,
      date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      operator: monthlyAirlineOperator, station: "ALL", billing_period: monthlyAirlineMonth,
      civil_aviation: 0, handling: totals.base, airport_charges: 0, catering: 0, other: totals.overtime, vat: 0,
      subtotal, total: subtotal,
      currency: "USD" as InvoiceCurrency, status: "Draft" as InvoiceStatus, invoice_type: "Preliminary" as InvoiceType,
      description: `${monthlyAirlineOperator} — ${monthlyAirlineMonth} Security (all stations consolidated)`,
      flight_ref: `${rows.length} security flights`,
      notes: `${headerNote}\n__DETAIL__:${JSON.stringify(detailRows)}`,
    };
    if (isEthiopianOperator(monthlyAirlineOperator)) {
      const rate = askEgpRate();
      if (!rate) { toast({ title: "Invoice not created", description: "An exchange rate is required for Ethiopian Airlines." }); return; }
      Object.assign(inv, { exchange_rate: rate, exchange_rate_date: new Date().toISOString().slice(0, 10), base_currency: "EGP" });
    }
    await add(inv as any);
    setShowMonthlyAirline(false);
    toast({ title: "✅ Monthly Security Invoice Created", description: `${monthlyAirlineOperator} — ${monthlyAirlineMonth} (${rows.length} security assignments).` });
  };



  // Combined: ONE invoice per airline per month containing BOTH Handling (service reports) AND Security (dispatch assignments)
  const generateCombinedMonthlyInvoice = async () => {
    const { reports, totals: hT } = monthlyAirlinePreview;
    const { rows: secRows, totals: sT } = monthlySecurityPreview;
    if (reports.length === 0 && secRows.length === 0) {
      toast({ title: "No data", description: "No approved Handling reports or Security assignments for that airline & month.", variant: "destructive" });
      return;
    }
    if (monthlyValidation.errorCount > 0 || monthlySecurityValidation.errorCount > 0) {
      toast({ title: `Cannot generate — ${monthlyValidation.errorCount + monthlySecurityValidation.errorCount} record(s) have errors`, description: "Fix highlighted rows in both tabs first.", variant: "destructive" });
      return;
    }
    const totalWarnings = monthlyValidation.warningCount + monthlySecurityValidation.warningCount;
    if (totalWarnings > 0) {
      const ok = window.confirm(`${totalWarnings} record(s) have validation warnings.\n\nGenerate the combined invoice anyway?`);
      if (!ok) return;
    }

    const baseNo = `LNK-${monthlyAirlineMonth.replace("-", "")}-${monthlyAirlineOperator.replace(/\s+/g, "").slice(0, 4).toUpperCase()}`;
    const existingCount = (invoices || []).filter((inv: any) =>
      inv.operator?.toLowerCase().trim() === monthlyAirlineOperator.toLowerCase().trim() &&
      inv.billing_period === monthlyAirlineMonth && inv.station === "ALL" &&
      (inv.status || "").toLowerCase() !== "cancelled"
    ).length;
    if (existingCount > 0) {
      const ok = window.confirm(`A monthly invoice already exists for ${monthlyAirlineOperator} — ${monthlyAirlineMonth}.\n\nCreate another anyway?`);
      if (!ok) return;
    }
    const invoiceNo = manualInvoiceNo.trim() || (existingCount > 0 ? `${baseNo}-R${existingCount + 1}` : baseNo);

    const handlingRows = reports.map((r: any) => {
      const m = rollupReport(r);
      return { date: r.arrival_date || "", flight: r.flight_no || "", reg: r.registration || "", route: r.route || "", station: r.station || "", type: r.handling_type || "", category: "Handling", civil: m.civil, handling: m.handling, airport: m.airport, other: m.other, total: m.total };
    });
    const securityRows = secRows.map((d: any) => {
      const fi = lookupFlightInfo(d);
      return {
        date: d.flight_date || "", flight: d.flight_no || "",
        reg: d.registration || fi.reg || "",
        route: d.route || fi.route || "",
        station: d.station || "",
        type: buildServiceTypeLabel(d),
        category: "Security",
        civil: 0, handling: Number(d._effBase) || 0, airport: 0, other: Number(d._effOvertime) || 0, total: Number(d._effTotal) || 0,
      };
    });
    const detailRows = [...handlingRows, ...securityRows];

    const civil_aviation = hT.civil;
    const handling = hT.handling + sT.base;        // merge handling base + security base
    const airport_charges = hT.airport;
    const other = hT.other + sT.overtime;          // merge other + security overtime
    const subtotal = civil_aviation + handling + airport_charges + other;

    const stations = new Set([...reports.map((r: any) => r.station), ...secRows.map((d: any) => d.station)].filter(Boolean));
    const headerNote = `Combined monthly invoice for ${monthlyAirlineOperator} — ${monthlyAirlineMonth}. ${reports.length} Handling report(s) + ${secRows.length} Security assignment(s) across ${stations.size} station(s). See Annex A for per-flight detail.`;

    const inv: Partial<InvoiceRow> = {
      invoice_no: invoiceNo,
      date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      operator: monthlyAirlineOperator, station: "ALL", billing_period: monthlyAirlineMonth,
      civil_aviation, handling, airport_charges, catering: 0, other, vat: 0,
      subtotal, total: subtotal,
      currency: "USD" as InvoiceCurrency, status: "Draft" as InvoiceStatus, invoice_type: "Preliminary" as InvoiceType,
      description: `${monthlyAirlineOperator} — ${monthlyAirlineMonth} (Handling + Security combined)`,
      flight_ref: `${reports.length + secRows.length} flights (H:${reports.length} / S:${secRows.length})`,
      notes: `${headerNote}\n__DETAIL__:${JSON.stringify(detailRows)}`,
    };
    await add(inv as any);
    setShowMonthlyAirline(false);
    toast({ title: "✅ Combined Monthly Invoice Created", description: `${monthlyAirlineOperator} — ${monthlyAirlineMonth} (${reports.length} handling + ${secRows.length} security).` });
  };

  const generateMonthlyAirlineInvoice = async () => {
    const { reports, totals } = monthlyAirlinePreview;
    if (reports.length === 0) {
      toast({ title: "No data", description: "No approved service reports for that airline & month.", variant: "destructive" });
      return;
    }

    // Validation guard: block on errors, prompt on warnings
    if (monthlyValidation.errorCount > 0) {
      toast({
        title: `Cannot generate — ${monthlyValidation.errorCount} report(s) have errors`,
        description: "Fix the highlighted reports in the validation panel before generating the invoice.",
        variant: "destructive",
      });
      return;
    }
    if (monthlyValidation.warningCount > 0) {
      const ok = window.confirm(
        `${monthlyValidation.warningCount} service report(s) have validation warnings (e.g., missing fields, unusual values).\n\nGenerate the invoice anyway?`
      );
      if (!ok) return;
    }

    // Duplicate guard: refuse if a non-cancelled monthly invoice already exists for this operator+month
    const duplicate = (invoices || []).find((inv: any) =>
      inv.operator?.toLowerCase().trim() === monthlyAirlineOperator.toLowerCase().trim() &&
      inv.billing_period === monthlyAirlineMonth &&
      inv.station === "ALL" &&
      (inv.status || "").toLowerCase() !== "cancelled"
    );
    if (duplicate) {
      const ok = window.confirm(
        `A monthly invoice already exists for ${monthlyAirlineOperator} — ${monthlyAirlineMonth} (${duplicate.invoice_no}, status: ${duplicate.status}).\n\nCreating another draft will result in duplicate billing. Continue anyway?`
      );
      if (!ok) {
        toast({ title: "Duplicate skipped", description: `Existing invoice ${duplicate.invoice_no} kept.` });
        return;
      }
    }

    const detailRows = reports.map((r: any) => {
      const m = rollupReport(r);
      return {
        date: r.arrival_date || "",
        flight: r.flight_no || "",
        reg: r.registration || "",
        route: r.route || "",
        station: r.station || "",
        type: r.handling_type || "",
        civil: m.civil,
        handling: m.handling,
        airport: m.airport,
        other: m.other,
        total: m.total,
      };
    });
    const headerNote = `Monthly consolidated invoice for ${monthlyAirlineOperator} — ${monthlyAirlineMonth}. ${reports.length} approved service reports across ${new Set(reports.map((r: any) => r.station)).size} station(s). See Annex A for per-flight detail.`;
    // Suffix invoice_no when re-creating after a confirmed duplicate
    const baseNo = `LNK-${monthlyAirlineMonth.replace("-", "")}-${monthlyAirlineOperator.replace(/\s+/g, "").slice(0, 4).toUpperCase()}`;
    const existingCount = (invoices || []).filter((inv: any) =>
      inv.operator?.toLowerCase().trim() === monthlyAirlineOperator.toLowerCase().trim() &&
      inv.billing_period === monthlyAirlineMonth && inv.station === "ALL"
    ).length;
    const invoiceNo = manualInvoiceNo.trim() || (existingCount > 0 ? `${baseNo}-R${existingCount + 1}` : baseNo);

    const subtotal = totals.civil + totals.handling + totals.airport + totals.other;
    const inv: Partial<InvoiceRow> = {
      invoice_no: invoiceNo,
      date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      operator: monthlyAirlineOperator,
      station: "ALL",
      billing_period: monthlyAirlineMonth,
      civil_aviation: totals.civil,
      handling: totals.handling,
      airport_charges: totals.airport,
      catering: 0, other: totals.other, vat: 0,
      subtotal,
      total: subtotal,
      currency: "USD" as InvoiceCurrency,
      status: "Draft" as InvoiceStatus,
      invoice_type: "Preliminary" as InvoiceType,
      description: `${monthlyAirlineOperator} — ${monthlyAirlineMonth} (all stations consolidated)`,
      flight_ref: `${reports.length} flights`,
      notes: `${headerNote}\n__DETAIL__:${JSON.stringify(detailRows)}`,
    };
    await add(inv as any);
    setShowMonthlyAirline(false);
    toast({ title: "✅ Monthly Invoice Created", description: `${monthlyAirlineOperator} — ${monthlyAirlineMonth} (${reports.length} flights, all stations).` });
  };


  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><FileText size={22} className="text-primary" /> Invoices {readOnly && <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Read-only</span>}</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">{readOnly ? "Receivables view — read-only access for Payables" : "IATA SIS-compliant airline invoicing"}</p>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowBillingPreview(true)}
              title="Generate invoices from completed dispatches for the selected period"
              className="toolbar-btn-outline"
            ><Zap size={14} /> Generate from Service Reports</button>
            <button onClick={() => setShowMonthlyAirline(true)} className="toolbar-btn-outline"><Calendar size={14} /> Monthly Airline Invoice</button>
            <button onClick={() => { setNewInvoice(emptyInvoice()); setShowAdd(true); }} className="toolbar-btn-primary"><Plus size={14} /> New Invoice</button>
          </div>
        )}
      </div>

      {/* Enhanced KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="stat-card flex-col items-start gap-2">
          <div className="stat-card-icon bg-primary"><FileText size={18} /></div>
          <div>
            <div className="text-2xl font-bold text-foreground">{invoices.length}</div>
            <div className="text-xs font-semibold text-foreground">Total Invoices</div>
            <div className="text-[10px] text-muted-foreground">{finalizedCount} finalized</div>
          </div>
        </div>
        <div className="stat-card flex-col items-start gap-2">
          <div className="stat-card-icon bg-accent"><TrendingUp size={18} /></div>
          <div>
            <div className="text-2xl font-bold text-foreground">${totalRevenue.toLocaleString()}</div>
            <div className="text-xs font-semibold text-foreground">Total Revenue</div>
            <div className="text-[10px] text-muted-foreground">All invoices</div>
          </div>
        </div>
        <div className="stat-card flex-col items-start gap-2">
          <div className="stat-card-icon bg-success"><CheckCircle size={18} /></div>
          <div>
            <div className="text-2xl font-bold text-foreground">${totalPaid.toLocaleString()}</div>
            <div className="text-xs font-semibold text-foreground">Collected</div>
            <div className="text-[10px] text-muted-foreground">{invoices.filter(i => i.status === "Paid").length} paid</div>
          </div>
        </div>
        <div className="stat-card flex-col items-start gap-2">
          <div className="stat-card-icon bg-info"><Clock size={18} /></div>
          <div>
            <div className="text-2xl font-bold text-foreground">${totalPending.toLocaleString()}</div>
            <div className="text-xs font-semibold text-foreground">Pending</div>
            <div className="text-[10px] text-muted-foreground">Draft + Sent</div>
          </div>
        </div>
        <div className="stat-card flex-col items-start gap-2">
          <div className="stat-card-icon bg-destructive"><AlertCircle size={18} /></div>
          <div>
            <div className="text-2xl font-bold text-foreground">${totalOverdue.toLocaleString()}</div>
            <div className="text-xs font-semibold text-foreground">Overdue</div>
            <div className="text-[10px] text-muted-foreground">{invoices.filter(i => i.status === "Overdue").length} invoices</div>
          </div>
        </div>
        <div className="stat-card flex-col items-start gap-2">
          <div className="stat-card-icon bg-emerald"><BarChart3 size={18} /></div>
          <div>
            <div className="text-2xl font-bold text-foreground">{collectionRate}%</div>
            <div className="text-xs font-semibold text-foreground">Collection Rate</div>
            <div className="text-[10px] text-muted-foreground">Paid / Total</div>
          </div>
        </div>
      </div>

      {/* Invoice Table */}
      <div className="bg-card rounded-lg border overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b space-y-3">
          {/* Category tabs — Handling vs Security (system-wide split) */}
          <div className="flex border-b -mx-4 px-4">
            {([
              { k: "security", label: "Security" },
              { k: "handling", label: "Handling" },
            ] as const).map(t => (
              <button
                key={t.k}
                type="button"
                onClick={() => { setCategoryTab(t.k);  }}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                  categoryTab === t.k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-foreground mr-auto">Invoice Records</h2>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="text" placeholder="Search invoices…" value={search} onChange={e => { setSearch(e.target.value);  }}
                className="pl-8 pr-3 py-1.5 text-sm border rounded bg-card text-foreground placeholder:text-muted-foreground w-56 focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <button onClick={() => setShowFilters(!showFilters)} className={`toolbar-btn-outline relative ${showFilters ? "ring-1 ring-primary" : ""}`}>
              <Filter size={14} /> Filters
              {activeFilterCount > 0 && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">{activeFilterCount}</span>}
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="toolbar-btn-success"><Upload size={14} /> Upload</button>
            <button onClick={handleExport} className="toolbar-btn-outline"><Download size={14} /> Export</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
          </div>

          {/* Expandable Filters */}
          {showFilters && (
            <div className="flex flex-wrap items-end gap-3 pt-2 border-t">
              <FormField label="Status">
                <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground w-32">
                  <option>All</option>{(["Draft","Sent","Paid","Overdue","Cancelled"] as InvoiceStatus[]).map(s => <option key={s}>{s}</option>)}
                </select>
              </FormField>
              <FormField label="Type">
                <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground w-32">
                  <option>All</option><option>Preliminary</option><option>Final</option>
                </select>
              </FormField>
              <FormField label="Currency">
                <select value={currencyFilter} onChange={e => { setCurrencyFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground w-28">
                  <option>All</option><option>USD</option><option>EUR</option><option>EGP</option>
                </select>
              </FormField>
              <FormField label="From Date">
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground" />
              </FormField>
              <FormField label="Operator">
                <select value={operatorFilter} onChange={e => { setOperatorFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground w-44">
                  <option>All</option>{operators.map(o => <option key={o}>{o}</option>)}
                </select>
              </FormField>
              <FormField label="Due From">
                <input type="date" value={dueFrom} onChange={e => { setDueFrom(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground" />
              </FormField>
              <FormField label="Due To">
                <input type="date" value={dueTo} onChange={e => { setDueTo(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground" />
              </FormField>
              <FormField label="Min Total">
                <input type="number" value={minTotal} onChange={e => { setMinTotal(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground w-28" />
              </FormField>
              <FormField label="Max Total">
                <input type="number" value={maxTotal} onChange={e => { setMaxTotal(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground w-28" />
              </FormField>
              {activeFilterCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-destructive hover:underline pb-1.5">Clear all</button>
              )}
            </div>
          )}

          {/* Bulk Actions Bar */}
          {!readOnly && selectedIds.size > 0 && (
            <div className="flex items-center gap-3 pt-2 border-t">
              <span className="text-sm font-semibold text-foreground">{selectedIds.size} selected</span>
              <button onClick={() => handleBulkStatusChange("Paid")} className="text-xs px-2.5 py-1 rounded bg-success/15 text-success font-semibold hover:bg-success/25">Mark Paid</button>
              <button onClick={() => handleBulkStatusChange("Sent")} className="text-xs px-2.5 py-1 rounded bg-info/15 text-info font-semibold hover:bg-info/25">Mark Sent</button>
              <button onClick={handleBulkDelete} className="text-xs px-2.5 py-1 rounded bg-destructive/15 text-destructive font-semibold hover:bg-destructive/25">Delete</button>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:underline ml-auto">Deselect all</button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="data-table-header px-3 py-3 w-8">
                <input type="checkbox" checked={pageData.length > 0 && selectedIds.size === pageData.length} onChange={toggleAll} className="rounded border-border" />
              </th>
              {(categoryTab === "security"
                ? ["#","INVOICE NO","DATE","DUE","OPERATOR","TYPE","SUBTOTAL","VAT","TOTAL","CURRENCY","STATUS","ACTIONS"]
                : ["#","INVOICE NO","DATE","DUE","OPERATOR","FLIGHT REF","REG","TYPE","SUBTOTAL","VAT","TOTAL","CURRENCY","STATUS","ACTIONS"]
              ).map(h => (
                <th key={h} className="data-table-header px-3 py-3 text-left whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr><td colSpan={15} className="text-center py-16">
                  <FileText size={40} className="mx-auto text-muted-foreground/30 mb-3" />
                  <p className="font-semibold text-foreground">No Invoices Found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {activeFilterCount > 0 ? "Try adjusting your filters" : "Create your first invoice to get started"}
                  </p>
                </td></tr>
              ) : pageData.map((inv, i) => (
                <tr key={inv.id} className={`data-table-row cursor-pointer ${selectedIds.has(inv.id) ? "bg-primary/5" : ""}`} onClick={() => setDetailInvoice(inv)}>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleSelect(inv.id)} className="rounded border-border" />
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{pag.start + i + 1}</td>
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold text-foreground">{inv.invoice_no}</td>
                  <td className="px-3 py-2.5 text-foreground whitespace-nowrap">{formatDateDMY(inv.date)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{formatDateDMY(inv.due_date)}</td>
                  <td className="px-3 py-2.5 font-semibold text-foreground">{inv.operator}</td>
                  {categoryTab !== "security" && (
                    <>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{inv.flight_ref}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{getInvoiceReg(inv) || "—"}</td>
                    </>
                  )}
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${inv.invoice_type === "Final" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                      {inv.invoice_type || "Preliminary"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-foreground">${(inv.subtotal || 0).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">${(inv.vat || 0).toLocaleString()}</td>
                  <td className="px-3 py-2.5 font-bold text-success">${(inv.total || 0).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{inv.currency}</td>
                  <td className="px-3 py-2.5"><StatusBadge s={inv.status} /></td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1.5">
                      <button onClick={() => setDetailInvoice(inv)} className="text-primary hover:text-primary/80" title="View Details"><Eye size={13} /></button>
                      {!readOnly && inv.invoice_type !== "Final" && (
                        <button onClick={() => handleFinalize(inv)} className="text-success hover:text-success/80" title="Finalize"><ShieldCheck size={13} /></button>
                      )}
                      <button onClick={() => setPrintInvoice(toPrintFormat(inv))} className="text-muted-foreground hover:text-foreground" title="Print"><Printer size={13} /></button>
                      {!readOnly && toPrintFormat(inv)._isSecurity && (
                        <button onClick={() => regenerateSecurityDetail(inv)} className="text-warning hover:text-warning/80" title="Regenerate Annex A from source records"><RefreshCw size={13} /></button>
                      )}
                      {!readOnly && (
                        <>
                          <button onClick={() => editInvoiceNo(inv)} className="text-primary hover:text-primary/80" title="Edit invoice number"><Hash size={13} /></button>
                          <button onClick={() => startEdit(inv)} className="text-info hover:text-info/80" title="Edit"><Pencil size={13} /></button>

                          <button onClick={() => requestDeleteSingle(inv.id)} className="text-destructive hover:text-destructive/80" title="Delete"><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

<TablePagination {...pag} />
      </div>

      {/* Generate Monthly Billing Modal */}
      {showBillingPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
          <div className="bg-card rounded-xl border shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto m-4">
            <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
              <h2 className="font-bold text-foreground text-lg flex items-center gap-2">
                <Zap size={18} className="text-primary" /> Generate Monthly Billing
              </h2>
              <button onClick={() => setShowBillingPreview(false)} className="p-1.5 hover:bg-muted rounded-full text-muted-foreground"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Billing Month</label>
                  <input type="month" value={billingMonth} onChange={e => setBillingMonth(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground w-full" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Station</label>
                  <input type="text" value={billingStation} onChange={e => setBillingStation(e.target.value)} placeholder="All or station code" className="text-sm border rounded px-2 py-1.5 bg-card text-foreground w-full" />
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Showing completed dispatches <span className="font-semibold">and approved Service Reports</span> grouped by airline &amp; station for <span className="font-semibold text-foreground">{billingMonth}</span>
              </p>


              {dispatchGenerationGuard.hasAny && !dispatchGenerationGuard.allComplete && (
                <div className="bg-warning/10 border border-warning/40 text-warning-foreground rounded-lg p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <Zap size={16} className="text-warning shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-warning">Service reports not fully completed</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {dispatchGenerationGuard.incompleteCount} of {dispatchGenerationGuard.total} dispatch(es) for {billingMonth}{billingStation !== "All" ? ` · ${billingStation}` : ""} are not ready for billing. Invoice generation is disabled until all flights are complete.
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 max-h-48 overflow-auto rounded-md border bg-card/60">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60 sticky top-0">
                        <tr>
                          {["Date", "Station", "Airline", "Flight", "Reason"].map((h) => (
                            <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dispatchGenerationGuard.incompleteRows.slice(0, 50).map((row: any) => (
                          <tr key={row.id} className="border-t">
                            <td className="px-2 py-1.5 whitespace-nowrap">{row.date}</td>
                            <td className="px-2 py-1.5 font-semibold">{row.station}</td>
                            <td className="px-2 py-1.5">{row.airline}</td>
                            <td className="px-2 py-1.5 font-mono">{row.flight}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">{row.reasons.join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {dispatchGenerationGuard.incompleteRows.length > 50 && (
                    <div className="text-[11px] text-muted-foreground mt-2">
                      Showing first 50 incomplete dispatches. Narrow the station/month filter to inspect more.
                    </div>
                  )}
                </div>
              )}

              {billingPreviewData.length === 0 ? (
                <div className="bg-muted/50 rounded-lg p-8 text-center text-muted-foreground">
                  <FileText size={32} className="mx-auto mb-2 opacity-40" />
                  <p className="font-semibold">No billable flights found</p>
                  <p className="text-xs mt-1">Approve Service Reports or complete dispatch assignments to generate invoices</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {billingPreviewData.map((g, i) => (
                    <div key={i} className="bg-muted/30 border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="font-semibold text-foreground">{g.airline}</div>
                          <div className="text-xs text-muted-foreground">{g.station} — {g.flights} flights · {g.sources.reports} report{g.sources.reports === 1 ? "" : "s"} + {g.sources.dispatches} dispatch{g.sources.dispatches === 1 ? "" : "es"}</div>
                        </div>
                        <button
                          onClick={() => generateInvoiceFromBilling(g)}
                          disabled={!dispatchGenerationGuard.allComplete}
                          title={!dispatchGenerationGuard.allComplete ? "All dispatches must be marked Completed first" : "Create draft invoice"}
                          className="toolbar-btn-primary text-xs py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Plus size={12} /> Create Draft Invoice
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-3 text-sm">
                        <div><span className="text-xs text-muted-foreground block">Base Fees</span><span className="font-semibold">${g.baseFees.toLocaleString()}</span></div>
                        <div><span className="text-xs text-muted-foreground block">Service Charges</span><span className="font-semibold">${g.serviceCharges.toLocaleString()}</span></div>
                        <div><span className="text-xs text-muted-foreground block">Overtime</span><span className="font-semibold text-warning">${g.overtime.toLocaleString()}</span></div>
                        <div><span className="text-xs text-muted-foreground block">Total</span><span className="font-bold text-success">${g.total.toLocaleString()}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Monthly Airline Invoice Modal */}
      {showMonthlyAirline && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
          <div className="bg-card rounded-xl border shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-y-auto m-4">
            <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
              <h2 className="font-bold text-foreground text-lg flex items-center gap-2">
                <Calendar size={18} className="text-primary" /> Monthly Airline Invoice
              </h2>
              <button onClick={() => setShowMonthlyAirline(false)} className="p-1.5 hover:bg-muted rounded-full text-muted-foreground"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                Creates <span className="font-semibold text-foreground">one consolidated invoice per airline per month</span>. Choose the service category below — Handling pulls from approved Service Reports, Security pulls from approved Security Service assignments. Per-flight detail is attached as Annex A in the printed invoice.
              </p>

              {/* Service category tabs — Handling vs Security (project rule: always split) */}
              <div className="flex border-b">
                <button
                  type="button"
                  onClick={() => setMonthlyTab("security")}
                  className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                    monthlyTab === "security" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Security <span className="ml-1.5 text-xs font-mono opacity-70">({monthlySecurityPreview.rows.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMonthlyTab("handling")}
                  className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                    monthlyTab === "handling" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Handling <span className="ml-1.5 text-xs font-mono opacity-70">({monthlyAirlinePreview.reports.length})</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Airline</label>
                  <select className={selectCls} value={monthlyAirlineOperator} onChange={e => setMonthlyAirlineOperator(e.target.value)}>
                    <option value="Air Cairo">Air Cairo</option>
                    {allOperators.filter(o => o !== "Air Cairo").map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Billing Month</label>
                  <input type="month" className={inputCls} value={monthlyAirlineMonth} onChange={e => setMonthlyAirlineMonth(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Invoice No. (manual — leave blank to auto-generate)</label>
                  <input type="text" className={inputCls} value={manualInvoiceNo} onChange={e => setManualInvoiceNo(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => refreshInvoiceSummary()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Recompute precomputed monthly totals"
                >
                  <RefreshCw size={12} /> Refresh totals
                </button>
              </div>

              {monthlyTab === "handling" && (
              monthlyAirlinePreview.reports.length === 0 ? (
                <div className="bg-muted/50 rounded-lg p-8 text-center text-muted-foreground">
                  <FileText size={32} className="mx-auto mb-2 opacity-40" />
                  <p className="font-semibold">No approved service reports</p>
                  <p className="text-xs mt-1">Approve service reports for {monthlyAirlineOperator} in {monthlyAirlineMonth} first.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-muted/30 border rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Flights</div>
                      <div className="text-xl font-bold text-foreground">{monthlyAirlinePreview.reports.length}</div>
                    </div>
                    <div className="bg-muted/30 border rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Civil Aviation</div>
                      <div className="text-xl font-bold text-foreground">${monthlyAirlinePreview.totals.civil.toFixed(0)}</div>
                    </div>
                    <div className="bg-muted/30 border rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Handling</div>
                      <div className="text-xl font-bold text-foreground">${monthlyAirlinePreview.totals.handling.toFixed(0)}</div>
                    </div>
                    <div className="bg-muted/30 border rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Airport</div>
                      <div className="text-xl font-bold text-foreground">${monthlyAirlinePreview.totals.airport.toFixed(0)}</div>
                    </div>
                  </div>

                  {/* Validation panel — flag missing/unusual data before generating */}
                  <div className={`border rounded-lg overflow-hidden ${
                    monthlyValidation.errorCount > 0 ? "border-destructive/50" :
                    monthlyValidation.warningCount > 0 ? "border-warning/50" :
                    "border-success/40"
                  }`}>
                    <div className={`px-3 py-2 text-xs font-bold uppercase flex items-center justify-between ${
                      monthlyValidation.errorCount > 0 ? "bg-destructive/10 text-destructive" :
                      monthlyValidation.warningCount > 0 ? "bg-warning/10 text-warning" :
                      "bg-success/10 text-success"
                    }`}>
                      <span className="flex items-center gap-2">
                        <AlertCircle size={14} /> Pre-Invoice Validation
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono normal-case">
                          {monthlyValidation.cleanCount} clean · {monthlyValidation.warningCount} warning{monthlyValidation.warningCount === 1 ? "" : "s"} · {monthlyValidation.errorCount} error{monthlyValidation.errorCount === 1 ? "" : "s"}
                        </span>
                        {monthlyValidation.issues.length > 0 && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-current px-2 py-0.5 text-[11px] font-bold uppercase normal-case hover:bg-current hover:text-background transition-colors"
                            title="Open Service Reports filtered to the flagged rows"
                            onClick={() => {
                              const ids = monthlyValidation.issues.map(i => i.id).join(",");
                              navigate(`/service-report?reviewIds=${encodeURIComponent(ids)}`);
                            }}
                          >
                            Fix these reports →
                          </button>
                        )}
                      </div>
                    </div>
                    {monthlyValidation.issues.length === 0 ? (
                      <div className="p-3 text-sm text-success flex items-center gap-2">
                        <CheckCircle size={14} /> All {monthlyAirlinePreview.reports.length} reports passed validation.
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/30 sticky top-0">
                            <tr className="text-left text-muted-foreground uppercase">
                              <th className="px-3 py-1.5">Severity</th>
                              <th className="px-3 py-1.5">Date</th>
                              <th className="px-3 py-1.5">Flight</th>
                              <th className="px-3 py-1.5">Station</th>
                              <th className="px-3 py-1.5">Issues</th>
                              <th className="px-3 py-1.5 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthlyValidation.issues.map((iss) => (
                              <tr key={iss.id} className={`border-t ${iss.severity === "error" ? "bg-destructive/5" : "bg-warning/5"}`}>
                                <td className="px-3 py-1.5">
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    iss.severity === "error" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"
                                  }`}>
                                    {iss.severity}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5 font-mono">{iss.date}</td>
                                <td className="px-3 py-1.5 font-mono font-semibold">{iss.flight}</td>
                                <td className="px-3 py-1.5">{iss.station}</td>
                                <td className="px-3 py-1.5 text-foreground">{iss.issues.join("; ")}</td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                  <button
                                    type="button"
                                    className="text-primary hover:underline font-semibold"
                                    title="Open this Service Report to fix"
                                    onClick={() => navigate(`/service-report?reviewIds=${encodeURIComponent(iss.id)}`)}
                                  >
                                    Fix →
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>


                  <div className="border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted/40 text-xs font-bold uppercase text-muted-foreground">Per-Station × Service Type Breakdown</div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/20 text-xs uppercase text-muted-foreground">
                          <th className="text-left px-3 py-2">Station</th>
                          <th className="text-left px-3 py-2">Service Type</th>
                          <th className="text-right px-3 py-2">Flights</th>
                          <th className="text-right px-3 py-2">Total ($)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyAirlinePreview.breakdown.map((b, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-3 py-2 font-semibold text-foreground">{b.station || "—"}</td>
                            <td className="px-3 py-2 text-foreground">{b.type || "—"}</td>
                            <td className="px-3 py-2 text-right font-mono text-foreground">{b.flights}</td>
                            <td className="px-3 py-2 text-right font-mono text-foreground">{b.total.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 font-bold">
                          <td colSpan={2} className="px-3 py-2 text-right">Grand Total</td>
                          <td className="px-3 py-2 text-right font-mono">{monthlyAirlinePreview.reports.length}</td>
                          <td className="px-3 py-2 text-right font-mono text-success">${monthlyAirlinePreview.totals.total.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button onClick={generateMonthlyAirlineInvoice} className="toolbar-btn-primary">
                      <Plus size={14} /> Create Handling Invoice
                    </button>
                  </div>
                </>
              ))}


              {monthlyTab === "security" && (
                monthlySecurityPreview.rows.length === 0 ? (
                  <div className="bg-muted/50 rounded-lg p-8 text-center text-muted-foreground">
                    <FileText size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="font-semibold">No approved security assignments</p>
                    <p className="text-xs mt-1">Approve Security Service assignments for {monthlyAirlineOperator} in {monthlyAirlineMonth} first.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-muted/30 border rounded-lg p-3">
                        <div className="text-xs text-muted-foreground">Assignments</div>
                        <div className="text-xl font-bold text-foreground">{monthlySecurityPreview.rows.length}</div>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3">
                        <div className="text-xs text-muted-foreground">Base Fees</div>
                        <div className="text-xl font-bold text-foreground">${monthlySecurityPreview.totals.base.toFixed(0)}</div>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3">
                        <div className="text-xs text-muted-foreground">Overtime</div>
                        <div className="text-xl font-bold text-foreground">${monthlySecurityPreview.totals.overtime.toFixed(0)}</div>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3">
                        <div className="text-xs text-muted-foreground">Total</div>
                        <div className="text-xl font-bold text-success">${monthlySecurityPreview.totals.total.toFixed(0)}</div>
                      </div>
                    </div>

                    {/* Security validation panel */}
                    <div className={`border rounded-lg overflow-hidden ${
                      monthlySecurityValidation.errorCount > 0 ? "border-destructive/50" :
                      monthlySecurityValidation.warningCount > 0 ? "border-warning/50" :
                      "border-success/40"
                    }`}>
                      <div className={`px-3 py-2 text-xs font-bold uppercase flex items-center justify-between ${
                        monthlySecurityValidation.errorCount > 0 ? "bg-destructive/10 text-destructive" :
                        monthlySecurityValidation.warningCount > 0 ? "bg-warning/10 text-warning" :
                        "bg-success/10 text-success"
                      }`}>
                        <span className="flex items-center gap-2">
                          <AlertCircle size={14} /> Pre-Invoice Validation (Security)
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono normal-case">
                            {monthlySecurityValidation.cleanCount} clean · {monthlySecurityValidation.warningCount} warning{monthlySecurityValidation.warningCount === 1 ? "" : "s"} · {monthlySecurityValidation.errorCount} error{monthlySecurityValidation.errorCount === 1 ? "" : "s"}
                          </span>
                          {monthlySecurityValidation.issues.length > 0 && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-current px-2 py-0.5 text-[11px] font-bold uppercase normal-case hover:bg-current hover:text-background transition-colors"
                              title="Open Security Service Reports filtered to the flagged rows"
                              onClick={() => {
                                const ids = monthlySecurityValidation.issues.map(i => i.id).join(",");
                                navigate(`/service-report?tab=security&reviewIds=${encodeURIComponent(ids)}`);
                              }}
                            >
                              Fix these reports →
                            </button>
                          )}
                        </div>
                      </div>
                      {monthlySecurityValidation.issues.length === 0 ? (
                        <div className="p-3 text-sm text-success flex items-center gap-2">
                          <CheckCircle size={14} /> All {monthlySecurityPreview.rows.length} security assignments passed validation.
                        </div>
                      ) : (
                        <div className="max-h-48 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/30 sticky top-0">
                              <tr className="text-left text-muted-foreground uppercase">
                                <th className="px-3 py-1.5">Severity</th>
                                <th className="px-3 py-1.5">Date</th>
                                <th className="px-3 py-1.5">Flight</th>
                                <th className="px-3 py-1.5">Station</th>
                                <th className="px-3 py-1.5">Issues</th>
                                <th className="px-3 py-1.5 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {monthlySecurityValidation.issues.map((iss) => (
                                <tr key={iss.id} className={`border-t ${iss.severity === "error" ? "bg-destructive/5" : "bg-warning/5"}`}>
                                  <td className="px-3 py-1.5">
                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                      iss.severity === "error" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"
                                    }`}>{iss.severity}</span>
                                  </td>
                                  <td className="px-3 py-1.5 font-mono">{iss.date}</td>
                                  <td className="px-3 py-1.5 font-mono font-semibold">{iss.flight}</td>
                                  <td className="px-3 py-1.5">{iss.station}</td>
                                  <td className="px-3 py-1.5 text-foreground">{iss.issues.join("; ")}</td>
                                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                    <button
                                      type="button"
                                      className="text-primary hover:underline font-semibold"
                                      title="Open this Security assignment to fix"
                                      onClick={() => navigate(`/service-report?tab=security&reviewIds=${encodeURIComponent(iss.id)}`)}
                                    >
                                      Fix →
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-muted/40 text-xs font-bold uppercase text-muted-foreground">Per-Station × Service Type Breakdown</div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/20 text-xs uppercase text-muted-foreground">
                            <th className="text-left px-3 py-2">Station</th>
                            <th className="text-left px-3 py-2">Service Type</th>
                            <th className="text-right px-3 py-2">Assignments</th>
                            <th className="text-right px-3 py-2">Total ($)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlySecurityPreview.breakdown.map((b, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="px-3 py-2 font-semibold text-foreground">{b.station || "—"}</td>
                              <td className="px-3 py-2 text-foreground">{b.type || "—"}</td>
                              <td className="px-3 py-2 text-right font-mono text-foreground">{b.flights}</td>
                              <td className="px-3 py-2 text-right font-mono text-foreground">{b.total.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/30 font-bold">
                            <td colSpan={2} className="px-3 py-2 text-right">Grand Total</td>
                            <td className="px-3 py-2 text-right font-mono">{monthlySecurityPreview.rows.length}</td>
                            <td className="px-3 py-2 text-right font-mono text-success">${monthlySecurityPreview.totals.total.toFixed(2)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Annex A — Per-flight detail preview (mirrors PDF/print export) */}
                    <div className="border rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowSecurityAnnexPreview(v => !v)}
                        className="w-full px-3 py-2 bg-muted/40 text-xs font-bold uppercase text-muted-foreground flex items-center justify-between hover:bg-muted/60 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <Eye size={14} /> Annex A — Per-Flight Detail Preview
                          <span className="font-mono normal-case text-[11px] text-foreground">
                            ({securityAnnexExport.rows.length} row{securityAnnexExport.rows.length === 1 ? "" : "s"})
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          {securityAnnexExport.mismatch && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning/15 text-warning text-[10px]">
                              <AlertCircle size={10} /> Totals mismatch
                            </span>
                          )}
                          <span className="text-foreground">{showSecurityAnnexPreview ? "Hide ▲" : "Show ▼"}</span>
                        </span>
                      </button>
                      {showSecurityAnnexPreview && (
                        <div className="border-t">
                          {/* Date-range quick filter (preview-only — does NOT change export) */}
                          <div className="px-3 py-2 bg-muted/5 border-b flex flex-wrap items-end gap-3 text-[11px]">
                            <div className="flex flex-col gap-1">
                              <label className="text-muted-foreground uppercase tracking-wide">Date From</label>
                              <input
                                type="date"
                                value={securityAnnexDateFrom}
                                onChange={(e) => setSecurityAnnexDateFrom(e.target.value)}
                                className="h-7 px-2 rounded border border-border bg-background text-foreground font-mono text-[11px]"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-muted-foreground uppercase tracking-wide">Date To</label>
                              <input
                                type="date"
                                value={securityAnnexDateTo}
                                onChange={(e) => setSecurityAnnexDateTo(e.target.value)}
                                className="h-7 px-2 rounded border border-border bg-background text-foreground font-mono text-[11px]"
                              />
                            </div>
                            {securityAnnexFiltered.isFiltered && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => { setSecurityAnnexDateFrom(""); setSecurityAnnexDateTo(""); }}
                                  className="h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                >
                                  Clear filter
                                </button>
                                <span className="ms-auto inline-flex items-center gap-1 px-2 py-0.5 rounded bg-warning/15 text-warning">
                                  <AlertCircle size={11} />
                                  Preview filtered — {securityAnnexFiltered.hiddenCount} row(s) hidden. Export will include ALL {securityAnnexExport.rows.length} rows.
                                </span>
                              </>
                            )}
                          </div>
                          <div className={`px-3 py-2 border-b flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] ${securityAnnexExport.countMismatch ? "bg-warning/10 border-warning/40" : "bg-primary/5 border-primary/20"}`}>
                            <span className="font-semibold text-foreground uppercase tracking-wide">
                              {securityAnnexFiltered.isFiltered ? "Filtered Summary:" : "Export Summary:"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="text-muted-foreground">Rows:</span>
                              <span className={`font-mono font-bold ${securityAnnexExport.integrity.rowCountMismatch ? "text-destructive" : "text-foreground"}`}>{securityAnnexFiltered.counts.rows}</span>
                              {securityAnnexFiltered.isFiltered && (
                                <span className="text-muted-foreground">/ {securityAnnexExport.counts.rows}</span>
                              )}
                              {securityAnnexExport.integrity.rowCountMismatch && (
                                <span className="text-destructive">(source {securityAnnexExport.integrity.sourceRowCount})</span>
                              )}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="text-muted-foreground">Flights:</span>
                              <span className={`font-mono font-bold ${securityAnnexExport.integrity.missingFlight > 0 ? "text-warning" : "text-foreground"}`}>{securityAnnexFiltered.counts.flights}</span>
                              {securityAnnexExport.integrity.missingFlight > 0 && (
                                <span className="text-warning">({securityAnnexExport.integrity.missingFlight} missing)</span>
                              )}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="text-muted-foreground">Stations:</span>
                              <span className={`font-mono font-bold ${securityAnnexExport.integrity.missingStation > 0 ? "text-warning" : "text-foreground"}`}>{securityAnnexFiltered.counts.stations}</span>
                              {securityAnnexExport.integrity.missingStation > 0 && (
                                <span className="text-warning">({securityAnnexExport.integrity.missingStation} missing)</span>
                              )}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="text-muted-foreground">Distinct Dates:</span>
                              <span className={`font-mono font-bold ${securityAnnexExport.integrity.missingDate > 0 ? "text-warning" : "text-foreground"}`}>{securityAnnexFiltered.counts.dates}</span>
                              {securityAnnexExport.integrity.missingDate > 0 && (
                                <span className="text-warning">({securityAnnexExport.integrity.missingDate} missing)</span>
                              )}
                            </span>
                            <span className="inline-flex items-center gap-1 ms-auto">
                              <span className="text-muted-foreground">{securityAnnexFiltered.isFiltered ? "Filtered Total:" : "Grand Total:"}</span>
                              <span className="font-mono font-bold text-success">${securityAnnexFiltered.totals.total.toFixed(2)}</span>
                            </span>
                          </div>
                          {/* Per-station breakdown */}
                          {securityAnnexFiltered.stationBreakdown.length > 0 && (
                            <div className="px-3 py-2 bg-muted/5 border-b">
                              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                                Station Breakdown {securityAnnexFiltered.isFiltered ? "(filtered)" : ""}
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="text-left text-muted-foreground">
                                      <th className="px-2 py-1 font-medium">Station</th>
                                      <th className="px-2 py-1 font-medium text-right">Rows</th>
                                      <th className="px-2 py-1 font-medium text-right">Flights</th>
                                      <th className="px-2 py-1 font-medium text-right">Base ($)</th>
                                      <th className="px-2 py-1 font-medium text-right">OT ($)</th>
                                      <th className="px-2 py-1 font-medium text-right">Total ($)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {securityAnnexFiltered.stationBreakdown.map((s) => (
                                      <tr key={s.station} className="border-t border-border/50">
                                        <td className="px-2 py-1 font-semibold text-foreground">{s.station}</td>
                                        <td className="px-2 py-1 text-right font-mono">{s.rows}</td>
                                        <td className="px-2 py-1 text-right font-mono">{s.flights}</td>
                                        <td className="px-2 py-1 text-right font-mono">{s.base.toFixed(2)}</td>
                                        <td className="px-2 py-1 text-right font-mono">{s.overtime.toFixed(2)}</td>
                                        <td className="px-2 py-1 text-right font-mono font-bold text-success">{s.total.toFixed(2)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                          <div className="px-3 py-2 bg-muted/10 text-[11px] text-muted-foreground italic">
                            This is exactly what will be exported to the printed invoice's Annex A page (and CSV). Rows are sorted by date then flight number. Date-range filter affects this preview only — the exported file always contains all rows.
                          </div>
                          <div className="max-h-72 overflow-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/30 sticky top-0">
                                <tr className="text-left text-muted-foreground uppercase">
                                  <th className="px-3 py-1.5">#</th>
                                  <th className="px-3 py-1.5">Date</th>
                                  <th className="px-3 py-1.5">Flight</th>
                                  <th className="px-3 py-1.5">Station</th>
                                  <th className="px-3 py-1.5">Service Type</th>
                                  <th className="px-3 py-1.5 text-right">Base ($)</th>
                                  <th className="px-3 py-1.5 text-right">Overtime ($)</th>
                                  <th className="px-3 py-1.5 text-right">Total ($)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {securityAnnexFiltered.rows.map((r, i) => (
                                  <tr key={i} className="border-t">
                                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{i + 1}</td>
                                    <td className="px-3 py-1.5 font-mono">{formatDateDMY(r.date)}</td>
                                    <td className="px-3 py-1.5 font-mono font-semibold text-foreground">{r.flight || "—"}</td>
                                    <td className="px-3 py-1.5">{r.station || "—"}</td>
                                    <td className="px-3 py-1.5">{r.type || "—"}</td>
                                    <td className="px-3 py-1.5 text-right font-mono">{r.base.toFixed(2)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono">{r.overtime.toFixed(2)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono font-semibold text-foreground">{r.total.toFixed(2)}</td>
                                  </tr>
                                ))}
                                {securityAnnexFiltered.rows.length === 0 && (
                                  <tr><td colSpan={8} className="px-3 py-4 text-center text-muted-foreground italic">No rows match the selected date range.</td></tr>
                                )}
                              </tbody>
                              <tfoot>
                                <tr className="bg-muted/40 font-bold border-t-2">
                                  <td colSpan={5} className="px-3 py-2 text-right uppercase text-xs">
                                    {securityAnnexFiltered.isFiltered ? "Filtered Subtotal" : "Annex A Grand Total"}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono">{securityAnnexFiltered.totals.base.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right font-mono">{securityAnnexFiltered.totals.overtime.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right font-mono text-success">{securityAnnexFiltered.totals.total.toFixed(2)}</td>
                                </tr>
                                {securityAnnexFiltered.isFiltered && (
                                  <tr className="bg-muted/20 text-muted-foreground border-t">
                                    <td colSpan={5} className="px-3 py-1.5 text-right uppercase text-[10px]">Annex A Grand Total (export)</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-[11px]">{securityAnnexExport.totals.base.toFixed(2)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-[11px]">{securityAnnexExport.totals.overtime.toFixed(2)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-success">{securityAnnexExport.totals.total.toFixed(2)}</td>
                                  </tr>
                                )}
                              </tfoot>
                            </table>
                          </div>
                          {securityAnnexExport.mismatch && (
                            <div className="px-3 py-2 bg-warning/10 border-t border-warning/30 text-xs text-warning flex items-start gap-2">
                              <AlertCircle size={14} className="mt-0.5 shrink-0" />
                              <div className="space-y-1">
                                {securityAnnexExport.totalsMismatch && (
                                  <div>
                                    <div className="font-bold">Totals mismatch detected</div>
                                    <div className="font-mono text-[11px] mt-0.5">
                                      Annex rows: base {securityAnnexExport.totals.base.toFixed(2)} · overtime {securityAnnexExport.totals.overtime.toFixed(2)} · total {securityAnnexExport.totals.total.toFixed(2)}
                                      <br />
                                      Invoice header: base {monthlySecurityPreview.totals.base.toFixed(2)} · overtime {monthlySecurityPreview.totals.overtime.toFixed(2)} · total {monthlySecurityPreview.totals.total.toFixed(2)}
                                    </div>
                                  </div>
                                )}
                                {securityAnnexExport.countMismatch && (
                                  <div>
                                    <div className="font-bold">Count integrity warning — preview may not match exported PDF/CSV</div>
                                    <ul className="font-mono text-[11px] mt-0.5 list-disc ms-4 space-y-0.5">
                                      {securityAnnexExport.integrity.rowCountMismatch && (
                                        <li className="text-destructive">Row count diverges: preview {securityAnnexExport.counts.rows} vs source {securityAnnexExport.integrity.sourceRowCount}.</li>
                                      )}
                                      {securityAnnexExport.integrity.missingFlight > 0 && (
                                        <li>{securityAnnexExport.integrity.missingFlight} row(s) missing flight number — distinct-flight count understated.</li>
                                      )}
                                      {securityAnnexExport.integrity.missingStation > 0 && (
                                        <li>{securityAnnexExport.integrity.missingStation} row(s) missing station — Annex A station summary will diverge.</li>
                                      )}
                                      {securityAnnexExport.integrity.missingDate > 0 && (
                                        <li>{securityAnnexExport.integrity.missingDate} row(s) missing flight date — distinct-date count understated; sort order unstable.</li>
                                      )}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end pt-2">
                      <button onClick={generateMonthlySecurityInvoice} className="toolbar-btn-primary">
                        <Plus size={14} /> Create Security Invoice
                      </button>
                    </div>
                  </>
                )
              )}
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !isDeleting) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget && deleteTarget.ids.length > 1
                ? `Delete ${deleteTarget.ids.length} invoices?`
                : "Delete invoice?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-semibold text-foreground">
                {deleteTarget?.label}
              </span>
              . This action cannot be undone, and a record of the deletion will be written to the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detailInvoice && (
        <InvoiceDetailModal
          invoice={detailInvoice as any}
          onClose={() => setDetailInvoice(null)}
          onEdit={(inv) => { setDetailInvoice(null); startEdit(inv as any); }}
          onFinalize={(inv) => { setDetailInvoice(null); handleFinalize(inv as any); }}
          onPrint={(inv) => { setDetailInvoice(null); setPrintInvoice(toPrintFormat(inv as any)); }}
        />
      )}

      {printInvoice && (
        printInvoice._isSecurity ? (
          <SecurityInvoicePrintView invoice={printInvoice} onClose={() => setPrintInvoice(null)} />
        ) : (
          <InvoicePrintView invoice={printInvoice} onClose={() => setPrintInvoice(null)} />
        )
      )}
    </div>
  );
}
