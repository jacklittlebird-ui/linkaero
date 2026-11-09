import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Pencil, Trash2, BookOpen, Check, X, Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { AdvancedFilters } from "@/components/filters/AdvancedFilters";
import { logAudit } from "@/lib/auditLogger";
import { exportToExcel } from "@/lib/exportExcel";
import { exportToPdf } from "@/lib/exportPdf";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { SmartDropdown, type SmartOption } from "@/components/ui/smart-dropdown";
import { startSaveTimer, type SaveTimer } from "@/lib/saveTiming";

type JournalEntry = { id: string; entry_no: string; entry_date: string; description: string; reference: string; reference_type: string; status: string; total_debit: number; total_credit: number; created_by: string; };
type JournalLine = {
  id?: string; entry_id?: string; account_id: string;
  debit: number; credit: number; description: string; sort_order?: number;
  company_id?: string | null; station_id?: string | null; service_type?: string | null;
  airline_id?: string | null; supplier_id?: string | null; flight_schedule_id?: string | null;
  transaction_currency?: string | null; transaction_amount?: number | null;
  exchange_rate?: number | null; base_amount?: number | null;
};
type AccountRow = { id: string; code: string; name: string; account_type: string; is_group: boolean; };

const SERVICE_TYPES = ["Ground Handling", "Catering", "Hotels", "Fuel", "Transportation", "Hospitality", "Documentation"];
const EGYPT_COMPANY_NAMES = ["Link Egypt", "لينك مصر"];

const STATUS_COLORS: Record<string, string> = { Draft: "bg-yellow-100 text-yellow-800", Posted: "bg-green-100 text-green-800", Void: "bg-red-100 text-red-800" };

export default function JournalEntriesPage() {
  const queryClient = useQueryClient();
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["journal_entries"],
    queryFn: async () => { const { data, error } = await supabase.from("journal_entries" as any).select("*").order("entry_date", { ascending: false }); if (error) throw error; return (data || []) as unknown as JournalEntry[]; },
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["chart_of_accounts", "all"],
    queryFn: async () => {
      // Paginate: PostgREST caps rows at 1000 per request; COA has >1000 leaves.
      const PAGE = 1000;
      let from = 0;
      let all: any[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("chart_of_accounts" as any)
          .select("id,code,name,account_type,is_group")
          .order("code")
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data || []) as any[];
        all = all.concat(rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return all as unknown as AccountRow[];
    },
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-mini"],
    queryFn: async () => { const { data } = await supabase.from("companies" as any).select("id,code,name,name_ar,base_currency,status").eq("status", "Active").order("code"); return (data || []) as any[]; },
  });
  const { data: stations = [] } = useQuery({
    queryKey: ["finance-stations-mini"],
    queryFn: async () => { const { data } = await supabase.from("finance_stations" as any).select("id,name,code,company_id").order("code"); return (data || []) as any[]; },
  });
  const { data: airlinesRef = [] } = useQuery({
    queryKey: ["airlines-mini"],
    queryFn: async () => { const { data } = await supabase.from("airlines" as any).select("id,name,iata_code").order("name"); return (data || []) as any[]; },
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["service-providers-mini"],
    queryFn: async () => { const { data } = await supabase.from("service_providers" as any).select("id,name").order("name"); return (data || []) as any[]; },
  });
  const { data: flightsRef = [] } = useQuery({
    queryKey: ["flights-mini-je"],
    queryFn: async () => {
      const { data } = await supabase
        .from("flight_schedules" as any)
        .select("id,flight_no,departure_date,arrival_date,authority,airline_id,route")
        .order("departure_date", { ascending: false })
        .limit(2000);
      return (data || []) as any[];
    },
  });

  const leafAccounts = accounts.filter(a => !a.is_group);
  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]));

  const companyOptions: SmartOption[] = companies.map((c: any) => ({ value: c.id, label: c.name_ar ? `${c.code} — ${c.name} / ${c.name_ar}` : `${c.code} — ${c.name}`, sub: c.base_currency }));
  const stationOptions: SmartOption[] = stations.map((s: any) => ({ value: s.id, label: `${s.code || ""} — ${s.name}`.replace(/^ — /, ""), sub: s.code }));
  const airlineOptions: SmartOption[] = airlinesRef.map((a: any) => ({ value: a.id, label: a.name, sub: a.iata_code }));
  const supplierOptions: SmartOption[] = suppliers.map((s: any) => ({ value: s.id, label: s.name }));
  const airlineNameById: Record<string, string> = Object.fromEntries(airlinesRef.map((a: any) => [a.id, a.name]));
  const stationCodeById: Record<string, string> = Object.fromEntries(stations.map((s: any) => [s.id, (s.code || "").toUpperCase()]));
  const buildFlightOptions = (stationId?: string | null): SmartOption[] => {
    const code = stationId ? stationCodeById[stationId] : "";
    const list = code
      ? flightsRef.filter((f: any) => String(f.authority || "").toUpperCase() === code)
      : flightsRef;
    return list.map((f: any) => ({
      value: f.id,
      label: `${f.flight_no || "—"} · ${f.departure_date || f.arrival_date || ""}${f.route ? " · " + f.route : ""}`,
      sub: airlineNameById[f.airline_id] || "",
    }));
  };
  const serviceTypeOptions: SmartOption[] = SERVICE_TYPES.map(s => ({ value: s, label: s }));
  const CURRENCIES = ["EGP", "USD", "EUR", "AED", "MAD", "JOD", "SAR", "GBP"];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [refTypeFilter, setRefTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [createdByFilter, setCreatedByFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<JournalEntry | null>(null);
  const [lines, setLines] = useState<Partial<JournalLine>[]>([{ account_id: "", debit: 0, credit: 0, description: "" }]);
  const [form, setForm] = useState({ entry_no: "", entry_date: new Date().toISOString().slice(0, 10), description: "", reference: "", reference_type: "", status: "Draft", created_by: "" });
  const saveTimerRef = useState<{ current: SaveTimer | null }>(() => ({ current: null }))[0];

  // Load lines for edit
  const loadLines = async (entryId: string) => {
    const { data } = await supabase.from("journal_entry_lines" as any).select("*").eq("entry_id", entryId).order("sort_order");
    setLines((data as unknown as JournalLine[])?.length ? (data as unknown as JournalLine[]) : [{ account_id: "", debit: 0, credit: 0, description: "" }]);
  };

  const refTypes = [...new Set(entries.map(e => e.reference_type).filter(Boolean))].sort();
  const creators = [...new Set(entries.map(e => e.created_by).filter(Boolean))].sort();

  const filtered = entries.filter(e => {
    const ms = e.entry_no.toLowerCase().includes(search.toLowerCase()) || e.description.toLowerCase().includes(search.toLowerCase()) || (e.reference || "").toLowerCase().includes(search.toLowerCase());
    const mst = statusFilter === "all" || e.status === statusFilter;
    const mrt = refTypeFilter === "all" || e.reference_type === refTypeFilter;
    const mcb = createdByFilter === "all" || e.created_by === createdByFilter;
    const mdf = !dateFrom || (e.entry_date || "") >= dateFrom;
    const mdt = !dateTo || (e.entry_date || "") <= dateTo;
    const minA = minAmount ? parseFloat(minAmount) : null;
    const mma = minA === null || (e.total_debit || 0) >= minA;
    return ms && mst && mrt && mcb && mdf && mdt && mma;
  });
  const pag = usePagination(filtered, { resetKey: `${search}|${statusFilter}|${refTypeFilter}|${createdByFilter}|${dateFrom}|${dateTo}|${minAmount}` });

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const missingFlightLink = lines.some(l => {
    if (!l.account_id) return false;
    const acc = accountMap[l.account_id];
    return acc && String(acc.code || "").startsWith("8") && !l.flight_schedule_id;
  });

  const addLine = () => setLines([...lines, { account_id: "", debit: 0, credit: 0, description: "" }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, value: any) => {
    const newLines = [...lines];
    (newLines[i] as any)[field] = value;
    setLines(newLines);
  };

  const openAdd = () => {
    setEditEntry(null);
    const nextNo = `JE-${String(entries.length + 1).padStart(4, "0")}`;
    setForm({ entry_no: nextNo, entry_date: new Date().toISOString().slice(0, 10), description: "", reference: "", reference_type: "", status: "Draft", created_by: "" });
    setLines([{ account_id: "", debit: 0, credit: 0, description: "" }]);
    setDialogOpen(true);
  };

  const openEdit = async (e: JournalEntry) => {
    setEditEntry(e);
    setForm({ entry_no: e.entry_no, entry_date: e.entry_date, description: e.description, reference: e.reference, reference_type: e.reference_type, status: e.status, created_by: e.created_by });
    await loadLines(e.id);
    setDialogOpen(true);
  };

  const buildLinePayload = (l: Partial<JournalLine>, i: number, entryId: string) => ({
    entry_id: entryId,
    account_id: l.account_id,
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    description: l.description || "",
    sort_order: i,
    company_id: l.company_id || null,
    station_id: l.station_id || null,
    service_type: l.service_type || null,
    airline_id: l.airline_id || null,
    supplier_id: l.supplier_id || null,
    flight_schedule_id: l.flight_schedule_id || null,
    transaction_currency: l.transaction_currency || null,
    transaction_amount: l.transaction_amount ?? null,
    exchange_rate: l.exchange_rate ?? null,
    base_amount: l.base_amount ?? null,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const timer = saveTimerRef.current ?? startSaveTimer("JournalEntry");
      saveTimerRef.current = timer;
      if (!form.entry_no || !isBalanced) throw new Error("Entry must be balanced");
      const validLines = lines.filter(l => l.account_id && ((Number(l.debit) || 0) + (Number(l.credit) || 0) > 0));
      if (validLines.length < 2) throw new Error("At least 2 lines required");

      // Account-8 rule: any account whose code starts with 8 must be linked to a flight
      for (const l of validLines) {
        const acc = accountMap[l.account_id!];
        if (acc && String(acc.code || "").startsWith("8")) {
          if (!l.flight_schedule_id) {
            throw new Error(`Account ${acc.code} (${acc.name}) requires a Flight Link (account-8 rule).`);
          }
        }
      }

      timer.markRequestSent();

      if (editEntry) {
        await timer.timeDb("update journal_entries", () =>
          supabase.from("journal_entries" as any).update({ ...form, total_debit: totalDebit, total_credit: totalCredit } as any).eq("id", editEntry.id),
        );
        await timer.timeDb("delete old lines", () =>
          supabase.from("journal_entry_lines" as any).delete().eq("entry_id", editEntry.id),
        );
        await timer.timeDb("insert lines", () =>
          supabase.from("journal_entry_lines" as any).insert(validLines.map((l, i) => buildLinePayload(l, i, editEntry.id)) as any),
        );
        logAudit({ action: "update", entity_type: "journal_entry", entity_id: editEntry.id, details: { entry_no: form.entry_no, total_debit: totalDebit, total_credit: totalCredit, status: form.status } });
      } else {
        const entryId = await timer.timeDb("insert journal_entry", async () => {
          const { data: entry, error } = await supabase.from("journal_entries" as any).insert({ ...form, total_debit: totalDebit, total_credit: totalCredit } as any).select().single();
          if (error) throw error;
          return (entry as any).id as string;
        });
        await timer.timeDb("insert lines", () =>
          supabase.from("journal_entry_lines" as any).insert(validLines.map((l, i) => buildLinePayload(l, i, entryId)) as any),
        );
        logAudit({ action: "create", entity_type: "journal_entry", entity_id: entryId, details: { entry_no: form.entry_no, total_debit: totalDebit, total_credit: totalCredit, status: form.status } });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      toast({ title: "Saved", description: "Journal entry saved." });
      setDialogOpen(false);
      saveTimerRef.current?.finish("success");
      saveTimerRef.current = null;
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      saveTimerRef.current?.finish("error", { message: e?.message });
      saveTimerRef.current = null;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const ent = entries.find(e => e.id === id);
      await supabase.from("journal_entries" as any).delete().eq("id", id);
      logAudit({ action: "delete", entity_type: "journal_entry", entity_id: id, details: { entry_no: ent?.entry_no } });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["journal_entries"] }); toast({ title: "Deleted" }); },
  });

  const handleExportExcel = () => {
    exportToExcel(filtered.map(e => ({
      "Entry No": e.entry_no, "Date": e.entry_date, "Description": e.description,
      "Reference": e.reference, "Debit": e.total_debit, "Credit": e.total_credit, "Status": e.status,
    })), "Journal Entries", `journal_entries_${new Date().toISOString().slice(0,10)}.xlsx`);
    logAudit({ action: "export", entity_type: "journal_entries", details: { format: "xlsx", count: filtered.length } });
  };

  const handleExportPdf = () => {
    exportToPdf({
      title: "Journal Entries",
      subtitle: `${filtered.length} entries`,
      head: [["Entry No", "Date", "Description", "Reference", "Debit", "Credit", "Status"]],
      body: filtered.map(e => [e.entry_no, e.entry_date, e.description, e.reference || "—", (e.total_debit ?? 0).toLocaleString(), (e.total_credit ?? 0).toLocaleString(), e.status]),
      fileName: `journal_entries_${new Date().toISOString().slice(0,10)}.pdf`,
      orientation: "landscape",
    });
    logAudit({ action: "export", entity_type: "journal_entries", details: { format: "pdf", count: filtered.length } });
  };


  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Journal Entries</h1>
          <p className="text-muted-foreground text-sm">القيود اليومية · {entries.length} entries</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportExcel}><Download size={14} className="mr-1" /> Excel</Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf}><Download size={14} className="mr-1" /> PDF</Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button onClick={openAdd}><Plus size={16} className="mr-1" /> New Entry</Button></DialogTrigger>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0 bg-slate-50">
            <DialogHeader className="sr-only"><DialogTitle>{editEntry ? "Edit Journal Entry" : "New Journal Entry"}</DialogTitle></DialogHeader>

            {/* Window card */}
            <div className="mx-6 my-6 rounded-lg overflow-hidden border border-slate-200 bg-white shadow-sm">

              {/* Title bar */}
              <div className="flex items-center justify-between bg-[#1e3a5f] text-white px-4 py-2">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                </div>
                <div className="text-sm font-semibold flex items-center gap-3">
                  <span>إدخال قيد محاسبي</span>
                  <span className="opacity-60">—</span>
                  <span className="opacity-90">{editEntry ? "Edit Journal Entry" : "New Journal Entry"}</span>
                </div>
              </div>

              <div className="p-5 space-y-5" dir="rtl">
                {/* Header row: Company / Station / Date */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-slate-600 mb-1 block">الشركة</label>
                    <SmartDropdown options={companyOptions} value={(lines[0]?.company_id) || ""} onChange={v => setLines(ls => ls.map(l => ({ ...l, company_id: v, station_id: null })))} placeholder="اختر الشركة" />
                  </div>
                  <div className={!stations.some((s: any) => s.company_id === lines[0]?.company_id) ? "pointer-events-none opacity-50" : ""}>
                    <label className="text-xs text-slate-600 mb-1 block">المحطة</label>
                    <SmartDropdown options={stationOptions.filter(o => stations.find((s: any) => s.id === o.value)?.company_id === lines[0]?.company_id)} value={(lines[0]?.station_id) || ""} onChange={v => setLines(ls => ls.map(l => ({ ...l, station_id: v })))} placeholder="اختر المحطة" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 mb-1 block">التاريخ</label>
                    <Input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} className="bg-slate-50" />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs text-slate-600 mb-1 block">البيان</label>
                  <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="وصف القيد" />
                </div>

                {/* Lines */}
                <div className="space-y-4">
                  {lines.map((line, i) => {
                    const acc = line.account_id ? accountMap[line.account_id] : null;
                    const isAccount8 = !!acc && String(acc.code || "").startsWith("8");
                    return (
                      <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
                        {/* Row 1: Account + Service Type */}
                        <div className="grid grid-cols-12 gap-3 items-end">
                          <div className="col-span-8">
                            <label className="text-xs text-slate-600 mb-1 block">البند / الحساب — رقم أو اسم</label>
                            <div className={isAccount8 ? "ring-2 ring-amber-300 rounded-md" : ""}>
                              <SmartDropdown
                                options={leafAccounts.map(a => ({ value: a.id, label: `${a.code} — ${a.name}`, sub: a.account_type }))}
                                value={line.account_id || ""}
                                onChange={v => updateLine(i, "account_id", v)}
                                placeholder="ابحث بالرقم أو الاسم"
                              />
                            </div>
                          </div>
                          <div className="col-span-4">
                            <label className="text-xs text-slate-600 mb-1 block">نوع الخدمة</label>
                            <SmartDropdown options={serviceTypeOptions} value={line.service_type || ""} onChange={v => updateLine(i, "service_type", v)} placeholder="اختر الخدمة" />
                          </div>
                        </div>

                        {/* Row 2: Airline / Currency / Debit / Credit */}
                        <div className="grid grid-cols-12 gap-3 items-end">
                          <div className="col-span-3">
                            <label className="text-xs text-slate-600 mb-1 block">شركة الطيران</label>
                            <SmartDropdown options={airlineOptions} value={line.airline_id || ""} onChange={v => updateLine(i, "airline_id", v)} placeholder="اختر الشركة" />
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs text-slate-600 mb-1 block">العملة</label>
                            <Select value={line.transaction_currency || "EGP"} onValueChange={v => updateLine(i, "transaction_currency", v)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-3">
                            <label className="text-xs text-slate-600 mb-1 block">مدين</label>
                            <Input type="number" className="text-right" value={line.debit || ""} onChange={e => updateLine(i, "debit", e.target.value)} placeholder="0.00" />
                          </div>
                          <div className="col-span-3">
                            <label className="text-xs text-slate-600 mb-1 block">دائن</label>
                            <Input type="number" className="text-right" value={line.credit || ""} onChange={e => updateLine(i, "credit", e.target.value)} placeholder="0.00" />
                          </div>
                          <div className="col-span-1 flex justify-end">
                            {lines.length > 1 && (
                              <Button size="icon" variant="ghost" className="text-red-500" onClick={() => removeLine(i)}><X size={16} /></Button>
                            )}
                          </div>
                        </div>



                        {/* Account-8 rule: auto-open flight-data panel binding flight + airline + 4 cost centres */}
                        {isAccount8 && (() => {
                          const headerStationId = (lines[0]?.station_id as string) || null;
                          const stationCode = headerStationId ? stationCodeById[headerStationId] : "";
                          const flightOpts = buildFlightOptions(headerStationId);
                          return (
                          <div className={`rounded-md border p-3 ${!line.flight_schedule_id ? "bg-red-50 border-red-300" : "bg-amber-50 border-amber-200"}`}>
                            <div className={`text-xs font-semibold mb-2 flex items-center gap-2 ${!line.flight_schedule_id ? "text-red-700" : "text-amber-800"}`}>
                              ⚡ حساب يبدأ بـ 8 — يجب ربط القيد ببيانات الرحلة ومراكز التكلفة الأربعة
                            </div>
                            {!headerStationId && (
                              <div className="text-[11px] text-red-700 mb-2">اختر المحطة أولاً في رأس القيد لعرض رحلات تلك المحطة.</div>
                            )}
                            <div className="grid grid-cols-12 gap-2">
                              <div className="col-span-6">
                                <label className="text-[11px] text-slate-600 mb-1 block">
                                  رقم الرحلة {stationCode && <span className="text-slate-500">— محطة {stationCode} ({flightOpts.length})</span>}
                                </label>
                                <SmartDropdown
                                  options={flightOpts}
                                  value={line.flight_schedule_id || ""}
                                  onChange={v => {
                                    updateLine(i, "flight_schedule_id", v);
                                    const f = flightsRef.find((x: any) => x.id === v);
                                    if (f?.airline_id) updateLine(i, "airline_id", f.airline_id);
                                  }}
                                  placeholder={headerStationId ? "ابحث برقم الرحلة / التاريخ" : "اختر المحطة أولاً"}
                                />
                              </div>
                              <div className="col-span-6">
                                <label className="text-[11px] text-slate-600 mb-1 block">المورد</label>
                                <SmartDropdown options={supplierOptions} value={line.supplier_id || ""} onChange={v => updateLine(i, "supplier_id", v)} placeholder="اختر المورد (اختياري)" />
                              </div>
                              <div className="col-span-12 text-[11px] text-slate-600 mt-1">
                                مراكز التكلفة: <b>الشركة</b> · <b>المحطة</b> · <b>نوع الخدمة</b> · <b>شركة الطيران</b> — تُعبّأ من الحقول أعلاه.
                              </div>
                            </div>
                          </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2">
                  <Button variant="outline" size="sm" onClick={addLine}>+ سطر جديد</Button>
                  <div className="flex items-center gap-4">
                    <div className="text-xs font-mono">
                      مدين: <b>{totalDebit.toLocaleString()}</b> · دائن: <b>{totalCredit.toLocaleString()}</b>{" "}
                      {isBalanced ? <span className="text-green-600">✓ متوازن</span> : <span className="text-red-600">فرق: {Math.abs(totalDebit - totalCredit).toLocaleString()}</span>}
                    </div>
                    <Button className="bg-[#1e3a5f] hover:bg-[#264a76]" onClick={() => {
                      const t = startSaveTimer(editEntry ? "JournalEntry:Update" : "JournalEntry:Create");
                      t.markClick();
                      saveTimerRef.current = t;
                      setForm(f => ({ ...f, status: "Posted" }));
                      saveMutation.mutate();
                    }} disabled={!isBalanced || missingFlightLink || saveMutation.isPending}>
                      {saveMutation.isPending ? "جاري الحفظ…" : "حفظ وترحيل"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Important rule banner */}
            <div className="mx-6 mb-6 rounded-md bg-amber-50 border border-amber-300 px-4 py-2 flex items-center gap-2" dir="rtl">
              <span className="text-amber-600 text-lg">⚡</span>
              <div className="text-xs text-amber-900">
                <b>قاعدة مهمة:</b> أي حساب يبدأ بـ <b>8</b> (تكاليف أو إيرادات) ← يفتح النظام تلقائياً نموذج بيانات الرحلة لربط التكلفة برقم الرحلة وشركة الطيران وكل مراكز التكلفة الأربعة.
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <AdvancedFilters
        searchKey="search"
        searchPlaceholder="Search entry no, description, reference…"
        fields={[
          { key: "search", kind: "text", label: "Search" },
          { key: "status", kind: "select", label: "Status", options: [{ value: "Draft", label: "Draft" }, { value: "Posted", label: "Posted" }, { value: "Void", label: "Void" }] },
          { key: "ref_type", kind: "select", label: "Reference Type", options: refTypes.map(t => ({ value: t, label: t })) },
          { key: "created_by", kind: "select", label: "Created By", options: creators.map(c => ({ value: c, label: c })) },
          { key: "date_from", kind: "date", label: "Date From" },
          { key: "date_to", kind: "date", label: "Date To" },
          { key: "min_amount", kind: "number", label: "Min Total" },
        ]}
        values={{ search, status: statusFilter, ref_type: refTypeFilter, created_by: createdByFilter, date_from: dateFrom, date_to: dateTo, min_amount: minAmount }}
        onChange={(v) => {
          setSearch(v.search ?? ""); setStatusFilter(v.status ?? "all"); setRefTypeFilter(v.ref_type ?? "all");
          setCreatedByFilter(v.created_by ?? "all"); setDateFrom(v.date_from ?? ""); setDateTo(v.date_to ?? ""); setMinAmount(v.min_amount ?? "");
        }}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entry No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.pageRows.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium font-mono"><BookOpen size={14} className="inline mr-1.5 text-muted-foreground" />{e.entry_no}</TableCell>
                  <TableCell>{e.entry_date}</TableCell>
                  <TableCell className="max-w-xs truncate">{e.description}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.reference || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{(e.total_debit ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{(e.total_credit ?? 0).toLocaleString()}</TableCell>
                  <TableCell><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[e.status] || ""}`}>{e.status}</span></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(e)}><Pencil size={14} /></Button>
                      {e.status === "Draft" && <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(e.id)}><Trash2 size={14} /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No journal entries</TableCell></TableRow>}
            </TableBody>
          </Table>
          <TablePagination {...pag} />
        </CardContent>
      </Card>
    </div>
  );
}
