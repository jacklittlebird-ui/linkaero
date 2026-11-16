import { useState, useMemo, useCallback, useRef } from "react";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useNavigate } from "react-router-dom";
import {
  Search, Plus, Trash2, Upload, Download, PlaneTakeoff, Clock,
  Pencil, X, Database, ChevronLeft, ChevronRight, CheckCircle, XCircle,
  AlertCircle, Calendar, Link2, FileBarChart2, Eye
} from "lucide-react";
import { useSupabaseTable } from "@/hooks/useSupabaseQuery";
import {
  useFlightList,
  useCanViewFlightHistory,
  usePrefetchFlight,
  useEnsureFlight,
} from "@/data/flights";

import { DataScopeToggle } from "@/components/DataScopeToggle";
import * as XLSX from "xlsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import ScheduleUploadDialog from "@/components/clearances/ScheduleUploadDialog";
import { MaskedTimeInput } from "@/components/ui/masked-time-input";



type FlightRow = {
  id: string; flight_no: string; airline: string; origin: string; destination: string;
  departure: string; arrival: string; aircraft: string; days: string;
  status: string; terminal: string;
  season: string; flight_type: string; effective_from: string | null;
  effective_to: string | null; frequency: string; codeshare: string; handling_agent: string;
  registration: string;
};

const FLIGHT_TYPES = ["Ambulance", "Cargo", "Charter", "Ferry", "Passenger", "Technical", "VIP"] as const;
const SEASONS = ["S", "W"] as const;
const FREQUENCIES = ["Ad-Hoc", "Bi-Weekly", "Daily", "Seasonal", "Weekly"] as const;
const STATUSES = ["Cancelled", "Completed", "Delayed", "Scheduled"] as const;

const statusBadge = (s: string) => {
  if (s === "Scheduled") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-info/15 text-info"><Clock size={12} />{s}</span>;
  if (s === "Completed") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success"><CheckCircle size={12} />{s}</span>;
  if (s === "Delayed") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning/15 text-warning"><AlertCircle size={12} />{s}</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/15 text-destructive"><XCircle size={12} />{s}</span>;
};

const flightTypeBadge = (t: string) => {
  const cls = t === "Passenger" ? "bg-primary/10 text-primary"
    : t === "Cargo" ? "bg-warning/10 text-warning"
    : t === "Charter" ? "bg-success/10 text-success"
    : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{t}</span>;
};

const inputCls = "text-sm border rounded px-2 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground w-full";
const selectCls = "text-sm border rounded px-2 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full";

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>{children}</div>;
}

const emptyFlight = (): Partial<FlightRow> => ({
  flight_no: "", airline: "", origin: "", destination: "", departure: "", arrival: "",
  aircraft: "", days: "", status: "Scheduled", terminal: "",
  season: "S", flight_type: "Passenger", effective_from: null, effective_to: null,
  frequency: "Weekly", codeshare: "", handling_agent: "",
});

function FlightForm({ data, onChange, onSave, onCancel, title, isSaving }: {
  data: Partial<FlightRow>; onChange: (d: Partial<FlightRow>) => void;
  onSave: () => void; onCancel: () => void; title: string; isSaving?: boolean;
}) {
  const set = (key: string, val: any) => onChange({ ...data, [key]: val });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
      <div className="bg-card rounded-xl border shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
          <h2 className="font-bold text-foreground text-lg flex items-center gap-2"><PlaneTakeoff size={18} className="text-primary" />{title}</h2>
          <button onClick={onCancel} className="p-1.5 hover:bg-muted rounded-full text-muted-foreground"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Flight Identity</h3>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Flight No."><input className={inputCls} value={data.flight_no || ""} onChange={e => set("flight_no", e.target.value)} placeholder="SM 401" /></FormField>
              <FormField label="Airline"><input className={inputCls} value={data.airline || ""} onChange={e => set("airline", e.target.value)} placeholder="Air Cairo" /></FormField>
              <FormField label="Flight Type">
                <select className={selectCls} value={data.flight_type || "Passenger"} onChange={e => set("flight_type", e.target.value)}>
                  {FLIGHT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField label="Codeshare"><input className={inputCls} value={data.codeshare || ""} onChange={e => set("codeshare", e.target.value)} placeholder="MS 5401" /></FormField>
              <FormField label="Handling Agent"><input className={inputCls} value={data.handling_agent || ""} onChange={e => set("handling_agent", e.target.value)} placeholder="Link Egypt" /></FormField>
              <FormField label="Aircraft"><input className={inputCls} value={data.aircraft || ""} onChange={e => set("aircraft", e.target.value)} placeholder="A320" /></FormField>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Route & Schedule (SSIM)</h3>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Origin"><input className={inputCls} value={data.origin || ""} onChange={e => set("origin", e.target.value)} placeholder="CAI" maxLength={3} /></FormField>
              <FormField label="Destination"><input className={inputCls} value={data.destination || ""} onChange={e => set("destination", e.target.value)} placeholder="AMS" maxLength={3} /></FormField>
              <FormField label="Terminal"><input className={inputCls} value={data.terminal || ""} onChange={e => set("terminal", e.target.value)} placeholder="T2" /></FormField>
              <FormField label="Departure (LT)"><MaskedTimeInput className={inputCls} value={data.departure || ""} onChange={v => set("departure", v)} /></FormField>
              <FormField label="Arrival (LT)"><MaskedTimeInput className={inputCls} value={data.arrival || ""} onChange={v => set("arrival", v)} /></FormField>
              <FormField label="Days of Week"><input className={inputCls} value={data.days || ""} onChange={e => set("days", e.target.value)} placeholder="1.3.5.7" /></FormField>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Validity & Frequency</h3>
            <div className="grid grid-cols-4 gap-4">
              <FormField label="Season">
                <select className={selectCls} value={data.season || "S"} onChange={e => set("season", e.target.value)}>
                  {SEASONS.map(s => <option key={s} value={s}>{s === "S" ? "Summer (S)" : "Winter (W)"}</option>)}
                </select>
              </FormField>
              <FormField label="Frequency">
                <select className={selectCls} value={data.frequency || "Weekly"} onChange={e => set("frequency", e.target.value)}>
                  {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
                </select>
              </FormField>
              <FormField label="Effective From"><input type="date" className={inputCls} value={data.effective_from || ""} onChange={e => set("effective_from", e.target.value || null)} /></FormField>
              <FormField label="Effective To"><input type="date" className={inputCls} value={data.effective_to || ""} onChange={e => set("effective_to", e.target.value || null)} /></FormField>
            </div>
          </div>
          <FormField label="Status">
            <select className={selectCls} value={data.status || "Scheduled"} onChange={e => set("status", e.target.value)}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </FormField>
        </div>
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex gap-3 justify-end rounded-b-xl">
          <button onClick={onCancel} className="toolbar-btn-outline">Cancel</button>
          <button onClick={onSave} disabled={isSaving} className="toolbar-btn-primary">{isSaving ? "Saving…" : "Save Flight"}</button>
        </div>
      </div>
    </div>
  );
}

export default function FlightSchedulePage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<"active" | "history">("active");
  const canViewHistory = useCanViewFlightHistory();
  // Domain hook — Flights domain via the policy engine. Mutations still come
  // from the underlying useSupabaseTable until the domain layer wraps them.
  // List view uses the narrow projection (15 cols instead of 37). Detail/edit
  // pulls the full row via useEnsureFlight() on click — hover prefetches it.
  const { data, isLoading } = useFlightList<FlightRow>({ scope });
  const prefetchFlight = usePrefetchFlight();
  const ensureFlight = useEnsureFlight();
  const { add, update, remove, bulkInsert, isAdding, isUpdating } =
    useSupabaseTable<FlightRow>("flight_schedules", { stationFilter: true });

  const [search, setSearch] = useState("");
  const [airlineFilter, setAirlineFilter] = useState("All Airlines");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [typeFilter, setTypeFilter] = useState("All Types");
  
  
  const [showAdd, setShowAdd] = useState(false);
  const [newRow, setNewRow] = useState<Partial<FlightRow>>(emptyFlight());
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<FlightRow>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const airlines = useMemo(() => [...new Set(["FlyPlus", ...data.map(d => d.airline)])].filter(Boolean).sort(), [data]);
  const flightTypes = useMemo(() => [...new Set(data.map(d => d.flight_type).filter(Boolean))], [data]);

  const filtered = useMemo(() => {
    let result = data;
    if (airlineFilter !== "All Airlines") result = result.filter(r => r.airline === airlineFilter);
    if (statusFilter !== "All Status") result = result.filter(r => r.status === statusFilter);
    if (typeFilter !== "All Types") result = result.filter(r => r.flight_type === typeFilter);
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(r => r.flight_no.toLowerCase().includes(s) || r.airline.toLowerCase().includes(s) || r.origin.toLowerCase().includes(s) || r.destination.toLowerCase().includes(s) || (r.codeshare || "").toLowerCase().includes(s) || (r.registration || "").toLowerCase().includes(s));
    }
    return result;
  }, [data, airlineFilter, statusFilter, typeFilter, search]);

  const { pageRows: pageData, ...pag } = usePagination(filtered, { resetKey: [search, airlineFilter, statusFilter, typeFilter] });



  
  
  const scheduledCount = data.filter(d => d.status === "Scheduled").length;
  const delayedCount = data.filter(d => d.status === "Delayed").length;
  const paxFlights = data.filter(d => d.flight_type === "Passenger").length;

  const saveNew = async () => {
    if (!newRow.flight_no || !newRow.airline) return;
    await add(newRow as any);
    setShowAdd(false); setNewRow(emptyFlight());
  };
  // The list query ships a narrow projection. Before opening the edit modal
  // we ensure the FULL row is in cache (instant if it was prefetched on hover,
  // otherwise a single .eq("id", ...) round-trip).
  const startEdit = async (row: FlightRow) => {
    setEditId(row.id);
    setEditData({ ...row }); // optimistic — render what we already have
    try {
      const full = await ensureFlight(row.id);
      if (full) setEditData({ ...(full as any) });
    } catch { /* leave optimistic data in place */ }
  };

  const saveEdit = async () => {
    if (!editId) return;
    const { id, ...rest } = editData;
    await update({ id: editId, ...rest } as any);
    setEditId(null);
  };
  const confirmDelete = async () => { if (deleteId) { await remove(deleteId); setDeleteId(null); } };

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
      const json = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
      const rows = json.map((row: any) => ({
        flight_no: row["Flight No"] || "", airline: row["Airline"] || "",
        origin: row["Origin"] || "", destination: row["Destination"] || "",
        departure: row["Departure"] || "", arrival: row["Arrival"] || "",
        aircraft: row["Aircraft"] || "", days: row["Days"] || "",
        status: row["Status"] || "Scheduled", terminal: row["Terminal"] || "",
        season: row["Season"] || "S", flight_type: row["Type"] || "Passenger",
        frequency: row["Frequency"] || "Weekly", codeshare: row["Codeshare"] || "",
        handling_agent: row["Handling Agent"] || "",
      }));
      await bulkInsert(rows); 
    };
    reader.readAsBinaryString(file); e.target.value = "";
  }, [bulkInsert]);

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(r => ({
      "Flight No": r.flight_no, Airline: r.airline, Type: r.flight_type, Season: r.season,
      Origin: r.origin, Destination: r.destination, Departure: r.departure, Arrival: r.arrival,
      Aircraft: r.aircraft, Days: r.days, Terminal: r.terminal, Frequency: r.frequency,
      Codeshare: r.codeshare, "Handling Agent": r.handling_agent, Status: r.status,
      "Effective From": r.effective_from || "", "Effective To": r.effective_to || "",
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Flight Schedule"); XLSX.writeFile(wb, "flight_schedule.xlsx");
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><PlaneTakeoff size={22} className="text-primary" /> Flight Schedule</h1>
        <button onClick={() => navigate("/services")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-semibold text-primary border-primary/40 hover:bg-primary/10 transition-colors">
          <Link2 size={14} /> Chart of Services Cost
        </button>
      </div>
      <p className="text-muted-foreground text-sm mt-1 mb-6">IATA SSIM-compliant flight schedule management</p>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="stat-card"><div className="stat-card-icon bg-primary"><PlaneTakeoff size={20} /></div><div><div className="text-xl md:text-2xl font-bold text-foreground">{data.length}</div><div className="text-xs text-muted-foreground">Total Flights</div></div></div>
        <div className="stat-card"><div className="stat-card-icon bg-info"><Calendar size={20} /></div><div><div className="text-xl md:text-2xl font-bold text-foreground">{scheduledCount}</div><div className="text-xs text-muted-foreground">Scheduled</div></div></div>
        <div className="stat-card"><div className="stat-card-icon bg-warning"><AlertCircle size={20} /></div><div><div className="text-xl md:text-2xl font-bold text-foreground">{delayedCount}</div><div className="text-xs text-muted-foreground">Delayed</div></div></div>
        <div className="stat-card"><div className="stat-card-icon bg-success"><CheckCircle size={20} /></div><div><div className="text-xl md:text-2xl font-bold text-foreground">{airlines.length}</div><div className="text-xs text-muted-foreground">Airlines</div></div></div>
        <div className="stat-card"><div className="stat-card-icon bg-muted"><Clock size={20} /></div><div><div className="text-xl md:text-2xl font-bold text-foreground">{paxFlights}</div><div className="text-xs text-muted-foreground">Passenger Flights</div></div></div>
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="p-4 border-b flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-foreground mr-auto">Schedule Records</h2>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="text" placeholder="Search flights…" value={search} onChange={e => { setSearch(e.target.value);  }}
              className="pl-8 pr-3 py-1.5 text-sm border rounded bg-card text-foreground placeholder:text-muted-foreground w-52 focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <select value={airlineFilter} onChange={e => { setAirlineFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Airlines</option>{airlines.map(a => <option key={a}>{a}</option>)}
          </select>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Status</option>{STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          {flightTypes.length > 1 && (
            <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
              <option value="All Types">All Types</option>{flightTypes.map(t => <option key={t}>{t}</option>)}
            </select>
          )}
          {canViewHistory && (
            <DataScopeToggle mode={scope} onChange={setScope} activeLabel="Last 180d" historyLabel="All History" />
          )}
          <button onClick={() => { setNewRow(emptyFlight()); setShowAdd(true); }} className="toolbar-btn-primary"><Plus size={14} /> Add Flight</button>
          <button onClick={() => fileInputRef.current?.click()} className="toolbar-btn-success"><Upload size={14} /> Upload</button>
          <button onClick={() => setUploadOpen(true)} className="toolbar-btn-outline"><Upload size={14} /> Import Schedule</button>
          <button onClick={handleExport} className="toolbar-btn-outline"><Download size={14} /> Export</button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>{["#","FLIGHT NO","TYPE","AIRLINE","ROUTE","DEP","ARR","AIRCRAFT","DAYS","TERMINAL","FREQ","STATUS","ACTIONS"].map(col => (
              <th key={col} className="data-table-header px-3 py-3 text-left whitespace-nowrap">{col}</th>
            ))}</tr></thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr><td colSpan={13} className="text-center py-16">
                  <Database size={40} className="mx-auto text-muted-foreground/40 mb-3" />
                  <p className="font-semibold text-foreground">No Flights Found</p>
                </td></tr>
              ) : pageData.map((row, i) => (
                <tr
                  key={row.id}
                  className="data-table-row"
                  onMouseEnter={() => prefetchFlight(row.id)}
                  onFocus={() => prefetchFlight(row.id)}
                >

                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{pag.start + i + 1}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-mono font-semibold text-foreground">{row.flight_no}</div>
                    {row.codeshare && <div className="text-xs text-muted-foreground">CS: {row.codeshare}</div>}
                  </td>
                  <td className="px-3 py-2.5">{flightTypeBadge(row.flight_type)}</td>
                  <td className="px-3 py-2.5 text-foreground">{row.airline}</td>
                  <td className="px-3 py-2.5 font-mono text-foreground">{row.origin} → {row.destination}</td>
                  <td className="px-3 py-2.5 text-foreground">{row.departure}</td>
                  <td className="px-3 py-2.5 text-foreground">{row.arrival}</td>
                  <td className="px-3 py-2.5 text-foreground text-xs">{row.aircraft}</td>
                  <td className="px-3 py-2.5 text-foreground text-xs">{row.days}</td>
                  <td className="px-3 py-2.5 text-foreground text-xs">{row.terminal}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{row.frequency}</td>
                  <td className="px-3 py-2.5">{statusBadge(row.status)}</td>
                  <td className="px-3 py-2.5 flex gap-1.5">
                    <button onClick={() => startEdit(row)} className="text-info hover:text-info/80" title="Edit"><Pencil size={13} /></button>
                    <button onClick={() => setDeleteId(row.id)} className="text-destructive hover:text-destructive/80" title="Delete"><Trash2 size={13} /></button>
                    <button
                      title="Create Service Report"
                      onClick={() => {
                        const params = new URLSearchParams({
                          flightNo: row.flight_no, operator: row.airline,
                          aircraftType: row.aircraft, route: `${row.origin}/${row.destination}`,
                          sta: row.departure, std: row.arrival,
                        });
                        navigate(`/service-report?${params.toString()}`);
                      }}
                      className="text-success hover:text-success/80"
                    >
                      <FileBarChart2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <TablePagination {...pag} />
      </div>

      {showAdd && <FlightForm title="New Flight" data={newRow} onChange={setNewRow} onSave={saveNew} onCancel={() => setShowAdd(false)} isSaving={isAdding} />}
      {editId && <FlightForm title="Edit Flight" data={editData} onChange={setEditData} onSave={saveEdit} onCancel={() => setEditId(null)} isSaving={isUpdating} />}

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Flight</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this flight? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ScheduleUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}
