import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import {
  Search, Plus, Download, Upload, FileBarChart2, Plane, Building2,
  DollarSign, Users, X, ChevronLeft, ChevronRight, Pencil, Trash2, Receipt, Eye,
  CheckCircle2, XCircle, Clock, MessageSquare, AlertCircle, CalendarDays, TableIcon, RefreshCw
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { resolveFlightMasterForWrite } from "@/lib/resolveFlightMasterForWrite";
import { syncFlightMasterFromReport } from "@/lib/syncFlightMasterFromReport";
import { expandFlightRef, normalizeFlightKey } from "@/lib/flightRefMatch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { generateAllCharges } from "@/data/airportChargesData";
import { useSupabaseTable } from "@/hooks/useSupabaseQuery";
import { useServiceReportsFS } from "@/data/serviceReports";
import { toast } from "@/hooks/use-toast";
import { Constants } from "@/integrations/supabase/types";
import TabbedReportForm from "@/components/serviceReport/TabbedReportForm";
import PipelineStepper, { derivePipelineStage, derivePipelineCompletedStages, resolvePipelineCreatedVia } from "@/components/serviceReport/PipelineStepper";
import { useChannel } from "@/contexts/ChannelContext";
import { useUserStation } from "@/contexts/UserStationContext";
import { SECURITY_CLEARANCE_TYPES } from "@/components/clearances/ClearanceTypes";
import { airlineBadgeStyle } from "@/lib/airlineColors";
import {
  ReportFormData, DelayEntry, emptyReport,
  CateringLineItem, HotacLineItem, FuelLineItem
} from "@/components/serviceReport/ReportFormTypes";




const handlingTypes = Constants.public.Enums.handling_type;
type HandlingType = typeof handlingTypes[number];

const statusColor: Record<string, string> = {
  "Turn Around": "bg-primary/10 text-primary",
  "Night Stop": "bg-info/10 text-info",
  "Transit": "bg-success/10 text-success",
  "Technical": "bg-warning/10 text-warning",
  "Ferry In": "bg-accent/10 text-accent",
  "Ferry Out": "bg-accent/10 text-accent",
  "VIP Hall": "bg-destructive/10 text-destructive",
  "Overflying": "bg-muted text-muted-foreground",
};

const stationOptions = [
  { name: "Cairo", vendor: "Cairo Airport Company" },
  { name: "Hurghada", vendor: "Egyptian Airports" },
  { name: "Sharm El Sheikh", vendor: "Egyptian Airports" },
  { name: "Luxor", vendor: "Egyptian Airports" },
  { name: "Aswan", vendor: "Egyptian Airports" },
];

const iataToStationName: Record<string, string> = {
  "CAI": "Cairo",
  "ALY": "Alexandria",
  "HBE": "Alexandria", // legacy code, kept for old records
  "HRG": "Hurghada",
  "SSH": "Sharm El Sheikh",
  "LXR": "Luxor",
  "ASW": "Aswan",
  "ATZ": "Asyut",
  "RMF": "Marsa Alam",
  "HMB": "Sohag",
};

const allCharges = generateAllCharges();

function isNightTime(timeStr: string, dateStr: string): boolean {
  if (!timeStr || !dateStr) return false;
  const [h] = timeStr.split(":").map(Number);
  if (isNaN(h)) return false;
  const month = new Date(dateStr).getMonth() + 1;
  return month >= 4 && month <= 10 ? (h >= 17 || h < 3) : (h >= 16 || h < 4);
}

function autoDayNight(td: string, arrivalDate: string): "D" | "N" {
  return (!td || !arrivalDate) ? "D" : isNightTime(td, arrivalDate) ? "N" : "D";
}

// Convert DB row to form data. Delays are pre-grouped by report_id so the list
// load stays O(reports + delays), not O(reports × delays).
function dbToForm(row: any, delaysByReport: Map<string, any[]>): ReportFormData {
  const rowDelays = row?.id ? (delaysByReport.get(row.id) || []) : [];
  return {
    id: row.id,
    flightScheduleId: row.flight_schedule_id || row.fs_id,
    operator: row.operator,
    handlingType: row.handling_type,
    skdType: row.fs_skd_type || row.skd_type || "",
    station: row.station,
    aircraftType: row.aircraft_type,
    registration: row.registration,
    flightNo: row.flight_no,
    mtow: row.mtow,
    route: row.route,
    arrivalDate: row.arrival_date || "",
    departureDate: row.departure_date || "",
    dayNight: row.day_night,
    sta: row.sta || "",
    std: row.std || "",
    td: row.td || "",
    co: row.co || "",
    ob: row.ob || "",
    to: row.to || "",
    ata: row.ata || "",
    atd: row.atd || "",
    groundTime: row.ground_time || "",
    delays: rowDelays
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(d => ({ code: d.code, timing: d.timing, explanation: d.explanation })),
    paxInAdultI: row.pax_in_adult_i,
    paxInInfI: row.pax_in_inf_i,
    paxInAdultD: row.pax_in_adult_d,
    paxInInfD: row.pax_in_inf_d,
    paxTransit: row.pax_transit,
    foreignPaxIn: row.foreign_pax_in || 0,
    foreignPaxOut: row.foreign_pax_out || 0,
    egyptianPaxIn: row.egyptian_pax_in || 0,
    egyptianPaxOut: row.egyptian_pax_out || 0,
    infantIn: row.infant_in || 0,
    infantOut: row.infant_out || 0,
    crewCount: row.crew_count || 0,
    totalDepartingPax: (row.foreign_pax_out || 0) + (row.infant_out || 0),
    totalForeignPaxOut: Math.max(0, (row.foreign_pax_out || 0) + (row.infant_out || 0) - (row.egyptian_pax_out || 0)),
    estimatedForeignBill: Number(row.estimated_foreign_bill || 0),
    estimatedLocalBill: Number(row.estimated_local_bill || 0),
    intDeparturePaxTax: +((((row.foreign_pax_out || 0) + (row.infant_out || 0)) * 25).toFixed(2)),
    developingSecSysCharge: +((((row.foreign_pax_out || 0) + (row.infant_out || 0)) * 2).toFixed(2)),
    sitaCute: +((((row.foreign_pax_out || 0) + (row.infant_out || 0)) * 1).toFixed(2)),
    stateResourceDevFee: +((((row.foreign_pax_out || 0) + (row.infant_out || 0)) * 100).toFixed(2)),
    policeServiceFee: +((((row.foreign_pax_out || 0) + (row.infant_out || 0)) * 15).toFixed(2)),
    fireCartQty: row.fire_cart_qty || 0,
    followMeQty: row.follow_me_qty || 0,
    jetwayQty: row.jetway_qty || 0,
    metFolderQty: row.met_folder_qty || 0,
    fileFltPlanQty: row.file_flt_plan_qty || 0,
    printOpsFltPlanQty: row.print_ops_flt_plan_qty || 0,
    confirmationNo: row.confirmation_no || "",
    flightStatus: row.flight_status || "Scheduled",
    projectTags: row.project_tags || "",
    checkInSystem: row.check_in_system || "",
    performedBy: row.performed_by || "Link Egypt",
    civilAviationFee: Number(row.civil_aviation_fee),
    handlingFee: Number(row.handling_fee),
    airportCharge: Number(row.airport_charge),
    totalCost: Number(row.total_cost),
    currency: row.currency,
    parkingDayHours: Number(row.parking_day_hours || 0),
    parkingNightHours: Number(row.parking_night_hours || 0),
    totalParkingHours: Number(row.total_parking_hours || 0),
    housingDays: Number(row.housing_days || 0),
    landingCharge: Number(row.landing_charge || 0),
    parkingCharge: Number(row.parking_charge || 0),
    housingCharge: Number(row.housing_charge || 0),
    fuelCharge: Number(row.fuel_charge || 0),
    cateringCharge: Number(row.catering_charge || 0),
    hotacCharge: Number(row.hotac_charge || 0),
    cateringItems: [],
    hotacItems: [],
    fuelItems: [],
    reviewStatus: row.review_status || "pending",
    reviewComment: row.review_comment || "",
    reviewedBy: row.reviewed_by || "",
    reviewedAt: row.reviewed_at || null,
    createdVia: row.created_via || row.createdVia || "",
  };
}

function formToDb(data: Partial<ReportFormData>) {
  // Phase 3B Step 2.2 — FS-mirror fields (flight_no, station, aircraft_type,
  // registration, route) are intentionally NOT sent. The resolver strips
  // them defensively; reads resolve via v_service_report_with_flight.
  return {
    operator: data.operator || "",
    handling_type: data.handlingType || "Turn Around",
    mtow: data.mtow || "",
    arrival_date: data.arrivalDate || null,
    departure_date: data.departureDate || null,
    day_night: autoDayNight(data.td || "", data.arrivalDate || ""),
    sta: data.sta || "",
    std: data.std || "",
    td: data.td || "",
    co: data.co || "",
    ob: data.ob || "",
    to: data.to || "",
    ata: data.ata || "",
    atd: data.atd || "",
    ground_time: data.groundTime || "",
    pax_in_adult_i: data.paxInAdultI || 0,
    pax_in_inf_i: data.paxInInfI || 0,
    pax_in_adult_d: data.paxInAdultD || 0,
    pax_in_inf_d: data.paxInInfD || 0,
    pax_transit: data.paxTransit || 0,
    foreign_pax_in: data.foreignPaxIn || 0,
    foreign_pax_out: data.foreignPaxOut || 0,
    egyptian_pax_in: data.egyptianPaxIn || 0,
    egyptian_pax_out: data.egyptianPaxOut || 0,
    infant_in: data.infantIn || 0,
    infant_out: data.infantOut || 0,
    crew_count: data.crewCount || 0,
    total_departing_pax: data.totalDepartingPax || 0,
    estimated_foreign_bill: data.estimatedForeignBill || 0,
    estimated_local_bill: data.estimatedLocalBill || 0,
    fire_cart_qty: data.fireCartQty || 0,
    follow_me_qty: data.followMeQty || 0,
    jetway_qty: data.jetwayQty || 0,
    met_folder_qty: data.metFolderQty || 0,
    file_flt_plan_qty: data.fileFltPlanQty || 0,
    print_ops_flt_plan_qty: data.printOpsFltPlanQty || 0,
    confirmation_no: data.confirmationNo || "",
    flight_status: data.flightStatus || "Scheduled",
    project_tags: data.projectTags || "",
    check_in_system: data.checkInSystem || "",
    performed_by: data.performedBy || "Link Egypt",
    civil_aviation_fee: data.civilAviationFee || 0,
    handling_fee: data.handlingFee || 0,
    airport_charge: data.airportCharge || 0,
    total_cost: data.totalCost || 0,
    currency: data.currency || "USD",
    parking_day_hours: data.parkingDayHours || 0,
    parking_night_hours: data.parkingNightHours || 0,
    total_parking_hours: data.totalParkingHours || 0,
    housing_days: data.housingDays || 0,
    landing_charge: data.landingCharge || 0,
    parking_charge: data.parkingCharge || 0,
    housing_charge: data.housingCharge || 0,
    fuel_charge: data.fuelCharge || 0,
    catering_charge: data.cateringCharge || 0,
    hotac_charge: data.hotacCharge || 0,
  };
}

// A merged row can be either a completed service report or a source schedule awaiting completion
interface MergedRow extends ReportFormData {
  isLinked: boolean;
  flightScheduleId?: string;
  sourceType?: "flight_schedules" | "clearances";
  clearanceStatus?: string;
  skdType?: string;
  serviceType?: string;
  purpose?: string;
  createdVia?: string;
}

interface ScheduleSourceRow {
  id: string;
  sourceType: "flight_schedules" | "clearances";
  flightNo: string;
  operator: string;
  aircraftType: string;
  mtow: string;
  registration: string;
  route: string;
  sta: string;
  std: string;
  station: string;
  arrivalDate: string;
  departureDate: string;
  clearanceStatus: string;
  skdType: string;
  serviceType: string;
  purpose: string;
  createdVia: string;
}

function resolveStationFromRoute(route: string, preferred?: string | null) {
  const parts = route.split("/").map(part => part.trim().toUpperCase()).filter(Boolean);
  // If the user's station appears anywhere in the route, use it (so flights that
  // touch the user's station are correctly attributed to that station).
  if (preferred) {
    const p = preferred.toUpperCase();
    if (parts.includes(p)) return p;
  }
  if (parts.length >= 3) return parts[1];
  if (parts.length >= 2) return parts[parts.length - 1];
  return parts[0] || "";
}

function flightTouchesStation(row: { route?: string | null; authority?: string | null }, station?: string | null) {
  const stationCode = (station || "").trim().toUpperCase();
  if (!stationCode) return true;
  const routeParts = (row.route || "").toUpperCase().split("/").map(part => part.trim()).filter(Boolean);
  return routeParts.includes(stationCode) || (row.authority || "").trim().toUpperCase() === stationCode;
}

function overlapsDateWindow(arrivalDate = "", departureDate = "", dateFrom = "", dateTo = "") {
  if (!dateFrom && !dateTo) return true;
  const dates = [arrivalDate, departureDate].filter(Boolean).sort();
  if (dates.length === 0) return false;
  const start = dates[0];
  const end = dates[dates.length - 1];
  if (dateFrom && end < dateFrom) return false;
  if (dateTo && start > dateTo) return false;
  return true;
}

function getScheduleFlightNo(row: { flight_no?: string | null; arrival_flight?: string | null; departure_flight?: string | null }) {
  return row.flight_no || row.arrival_flight || row.departure_flight || "";
}

// ─── Service Report Calendar View ───
const PIPELINE_STAGE_META: Record<string, { label: string; color: string; bg: string; text: string; border: string }> = {
  clearance:   { label: "Clearance",   color: "hsl(var(--info))",    bg: "bg-info/15",    text: "text-info",    border: "border-l-info" },
  station:     { label: "Station",     color: "hsl(var(--violet))",  bg: "bg-violet/15",  text: "text-violet",  border: "border-l-violet" },
  operations:  { label: "Operations",  color: "hsl(var(--warning))", bg: "bg-warning/15", text: "text-warning", border: "border-l-warning" },
  receivables: { label: "Receivables", color: "hsl(var(--success))", bg: "bg-success/15", text: "text-success", border: "border-l-success" },
};

function ServiceReportCalendarView({ reports, month, onMonthChange, onEdit, invoiceStatusByFlight, channel }: {
  reports: any[];
  month: Date;
  onMonthChange: (d: Date) => void;
  onEdit: (r: any) => void;
  invoiceStatusByFlight?: Map<string, "none" | "issued" | "paid">;
  channel?: string;
}) {
  const year = month.getFullYear();
  const mo = month.getMonth();
  const firstDay = new Date(year, mo, 1).getDay();
  const daysInMonth = new Date(year, mo + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");

  const enriched = useMemo(() => {
    return reports.map(r => {
      const invStatus = (invoiceStatusByFlight?.get(normalizeFlightKey(String(r.flightNo || ""))) || "none") as "none" | "issued" | "paid";
      const pipelineOpts = {
        isLinked: !!r.isLinked,
        reviewStatus: r.reviewStatus,
        clearanceStatus: r.clearanceStatus,
        dispatchStatus: r.isLinked ? "Completed" : "Pending",
        invoiceStatus: invStatus,
        createdVia: r.createdVia,
      };
      const stage = derivePipelineStage({ ...pipelineOpts, channel });
      const completed = derivePipelineCompletedStages(pipelineOpts);
      return { ...r, _stage: stage, _completed: completed, _invStatus: invStatus };
    });
  }, [reports, invoiceStatusByFlight, channel]);

  const filtered = useMemo(
    () => stageFilter === "all" ? enriched : enriched.filter(r => r._stage === stageFilter),
    [enriched, stageFilter]
  );

  const byDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    filtered.forEach(r => {
      const d = r.arrivalDate || r.departureDate || "";
      if (d) { if (!map[d]) map[d] = []; map[d].push(r); }
    });
    Object.values(map).forEach(list => list.sort((a, b) => (a.sta || a.std || "").localeCompare(b.sta || b.std || "")));
    return map;
  }, [filtered]);

  const monthStats = useMemo(() => {
    const inMonth = enriched.filter(r => {
      const d = r.arrivalDate || r.departureDate || "";
      return d.startsWith(`${year}-${String(mo+1).padStart(2,"0")}`);
    });
    const stages = { clearance: 0, station: 0, operations: 0, receivables: 0 } as Record<string, number>;
    inMonth.forEach(r => { stages[r._stage] = (stages[r._stage] || 0) + 1; });
    return { total: inMonth.length, linked: inMonth.filter(r => r.isLinked).length, pending: inMonth.filter(r => !r.isLinked).length, stages };
  }, [enriched, year, mo]);

  const prev = () => onMonthChange(new Date(year, mo - 1, 1));
  const next = () => onMonthChange(new Date(year, mo + 1, 1));
  const goToday = () => onMonthChange(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedReports = selectedDate ? (byDate[selectedDate] || []) : [];

  return (
    <div className="p-4 space-y-4">
      {/* Top toolbar: nav + KPIs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prev} className="p-1.5 rounded-md border hover:bg-muted transition-colors" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <h3 className="text-base font-bold text-foreground min-w-[140px] text-center">{monthLabel}</h3>
          <button onClick={next} className="p-1.5 rounded-md border hover:bg-muted transition-colors" aria-label="Next month"><ChevronRight size={16} /></button>
          <button onClick={goToday} className="ml-1 px-2.5 py-1 text-xs font-semibold rounded-md border hover:bg-muted transition-colors">Today</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</span>
            <span className="text-sm font-bold text-foreground">{monthStats.total}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success/10 border border-success/20">
            <CheckCircle2 size={12} className="text-success" />
            <span className="text-sm font-bold text-success">{monthStats.linked}</span>
            <span className="text-[10px] text-success/80">linked</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-warning/10 border border-warning/20">
            <Clock size={12} className="text-warning" />
            <span className="text-sm font-bold text-warning">{monthStats.pending}</span>
            <span className="text-[10px] text-warning/80">pending</span>
          </div>
        </div>
      </div>

      {/* Stage legend / filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setStageFilter("all")}
          className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${stageFilter === "all" ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-muted"}`}
        >
          All Stages
        </button>
        {(["clearance","station","operations","receivables"] as const).map(k => {
          const meta = PIPELINE_STAGE_META[k];
          const active = stageFilter === k;
          return (
            <button
              key={k}
              onClick={() => setStageFilter(active ? "all" : k)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors inline-flex items-center gap-1.5 ${active ? meta.bg + " " + meta.text : "bg-card hover:bg-muted text-foreground"}`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
              {meta.label}
              <span className="opacity-70">{monthStats.stages[k] || 0}</span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, idx) => (
          <div key={d} className={`bg-muted/60 text-center text-[11px] font-bold uppercase tracking-wide py-2 ${idx === 0 || idx === 6 ? "text-primary/70" : "text-muted-foreground"}`}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} className="bg-muted/20 min-h-[120px]" />;
          const dateStr = `${year}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const dayReports = byDate[dateStr] || [];
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate;
          const dow = (firstDay + day - 1) % 7;
          const isWeekend = dow === 0 || dow === 6;
          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              className={`text-left bg-card min-h-[120px] p-1.5 flex flex-col gap-1 transition-all hover:bg-muted/40
                ${isWeekend ? "bg-muted/10" : ""}
                ${isToday ? "ring-2 ring-primary ring-inset z-10" : ""}
                ${isSelected ? "ring-2 ring-foreground ring-inset z-10" : ""}
              `}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded
                  ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{day}</span>
                {dayReports.length > 0 && (
                  <span className="text-[10px] font-semibold text-muted-foreground bg-muted/70 px-1.5 rounded-full">{dayReports.length}</span>
                )}
              </div>
              <div className="space-y-1 flex-1">
                {dayReports.slice(0, 3).map((r: any, j: number) => {
                  const meta = PIPELINE_STAGE_META[r._stage] || PIPELINE_STAGE_META.clearance;
                  return (
                    <div
                      key={r.id || j}
                      onClick={(e) => { e.stopPropagation(); r.isLinked && onEdit(r); }}
                      className={`rounded-sm border-l-2 ${meta.border} ${meta.bg} px-1.5 py-1 hover:opacity-80 transition-opacity cursor-pointer`}
                      title={`${r.flightNo} · ${r.operator || ""} · ${meta.label}`}
                    >
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] font-bold text-foreground truncate">{r.flightNo}</span>
                        {!r.isLinked && <Clock size={9} className="text-muted-foreground shrink-0" />}
                      </div>
                      <div className="text-[9px] text-muted-foreground truncate">
                        {r.sta || r.std || ""} {r.operator ? "· " + r.operator.slice(0, 10) : ""}
                      </div>
                    </div>
                  );
                })}
                {dayReports.length > 3 && (
                  <div className="text-[10px] font-semibold text-primary text-center pt-0.5">+{dayReports.length - 3} more</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected-day details panel */}
      {selectedDate && (
        <div className="border rounded-lg bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
            <div className="flex items-center gap-2">
              <CalendarDays size={14} className="text-primary" />
              <span className="text-sm font-bold text-foreground">
                {new Date(selectedDate).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </span>
              <span className="text-xs text-muted-foreground">({selectedReports.length} flight{selectedReports.length === 1 ? "" : "s"})</span>
            </div>
            <button onClick={() => setSelectedDate(null)} className="p-1 rounded hover:bg-muted" aria-label="Close"><X size={14} /></button>
          </div>
          {selectedReports.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No flights on this date.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 p-3">
              {selectedReports.map((r: any) => {
                const meta = PIPELINE_STAGE_META[r._stage] || PIPELINE_STAGE_META.clearance;
                return (
                  <button
                    key={r.id}
                    onClick={() => r.isLinked && onEdit(r)}
                    className={`text-left bg-card border-l-4 ${meta.border} border-y border-r rounded-md p-2.5 hover:shadow-md hover:border-y-primary/40 hover:border-r-primary/40 transition-all`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-sm font-bold text-foreground">{r.flightNo}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.bg} ${meta.text}`}>{meta.label}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-1.5 truncate">{r.operator || "—"} · {r.station || r.route || ""}</div>
                    <div className="flex items-center gap-3 text-[11px] font-mono text-foreground mb-2">
                      {r.sta && <span>STA <span className="text-primary">{r.sta}</span></span>}
                      {r.std && <span>STD <span className="text-primary">{r.std}</span></span>}
                    </div>
                    <PipelineStepper currentStage={r._stage} completedStages={r._completed} compact />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function HandlingServiceReportContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const { activeChannel, isAdmin } = useChannel();
  const isReceivablesView = activeChannel === "receivables";
  const isOperationsView = activeChannel === "operations";
  const isStationView = activeChannel === "station";
  const canCreateNew = !isReceivablesView && !isOperationsView;

  const _initParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [search, setSearch] = useState(_initParams.get("search") || "");
  const [bulkApproving, setBulkApproving] = useState(false);
  const [handlingFilter, setHandlingFilter] = useState(_initParams.get("type") || "All Types");
  const [stationFilter, setStationFilter] = useState(_initParams.get("station") || "All Stations");
  const [reviewFilter, setReviewFilter] = useState("All Review");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [dateFrom, setDateFrom] = useState(_initParams.get("date_from") || "");
  const [dateTo, setDateTo] = useState(_initParams.get("date_to") || "");
  const [airlineFilter, setAirlineFilter] = useState(_initParams.get("airline") || "All Airlines");
  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");
  const [stationTab, setStationTab] = useState<"all" | "rejected">("all");
  const [operationsTab, setOperationsTab] = useState<"all" | "modified">("all");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  
  const [showAdd, setShowAdd] = useState(false);
  const [newReport, setNewReport] = useState<Partial<ReportFormData>>(emptyReport());
  const [editId, setEditId] = useState<string | null>(null);
  const [viewData, setViewData] = useState<Partial<ReportFormData> | null>(null);
  const [editData, setEditData] = useState<Partial<ReportFormData>>({});
  const [activeClearanceStatus, setActiveClearanceStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showUnbilled, setShowUnbilled] = useState(false);

  const { station: userStation, isStationScoped } = useUserStation();

  // Phase 3B Step 2.1 — Reads go through v_service_report_with_flight so
  // flight identity fields are FS-driven. Mutations still target service_reports.
  const { data: dbReports = [], isLoading: isLoadingReports } = useServiceReportsFS({
    scope: "active",
    station: isStationScoped ? userStation : null,
  });

  const reportIds = useMemo(
    () => (dbReports as any[]).map((r: any) => r.id).filter(Boolean),
    [dbReports]
  );

  // 180d active window — matches useServiceReportsFS scope so joins stay aligned.
  const activeCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 180);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data: dbDelays = [] } = useQuery({
    queryKey: ["service_report_delays", "by-report-ids", reportIds],
    queryFn: async () => {
      if (reportIds.length === 0) return [];
      const rows: any[] = [];
      const CHUNK = 100;
      for (let i = 0; i < reportIds.length; i += CHUNK) {
        const slice = reportIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("service_report_delays")
          .select("report_id,code,timing,explanation,sort_order")
          .in("report_id", slice);
        if (error) throw error;
        rows.push(...(data || []));
      }
      return rows;
    },
    enabled: reportIds.length > 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Receivables / pipeline: load invoices to detect billed & paid flights (matched by flight_ref ↔ flight_no)
  const { data: dbInvoices = [] } = useQuery({
    queryKey: ["invoices_for_receivables_panel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,invoice_no,flight_ref,operator,status")
        .neq("status", "Cancelled")
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Map flight_ref (uppercased) -> invoice progress so the pipeline can mark
  // Receivables as completed only when the invoice is fully Paid.
  const invoiceStatusByFlight = useMemo(() => {
    const m = new Map<string, "issued" | "paid">();
    for (const inv of (dbInvoices as any[])) {
      const raw = String(inv.flight_ref || "");
      if (!raw) continue;
      const status = String(inv.status || "").toLowerCase();
      const isPaid = status === "paid";
      for (const key of expandFlightRef(raw)) {
        const prev = m.get(key);
        if (isPaid) m.set(key, "paid");
        else if (!prev) m.set(key, "issued");
      }
    }
    return m;
  }, [dbInvoices]);

  const { data: dbFlights = [], isLoading: isLoadingFlights } = useQuery({
    queryKey: ["flight_schedules", "service-report-source", isStationScoped ? userStation : null, activeCutoff],
    queryFn: async () => {
      // Two indexed reads instead of `arrival_date OR departure_date`: normal
      // arrival rows plus departure-only rows where arrival_date is null.
      const cols = "id, flight_no, arrival_flight, departure_flight, aircraft_type, registration, route, sta, std, airline_id, handling_agent, arrival_date, departure_date, status, authority, skd_type, clearance_type, purpose, remarks, created_via";
      const makeBase = () => {
        let q = supabase.from("flight_schedules").select(cols);
        if (isStationScoped && userStation) q = (q as any).eq("authority", userStation);
        return q;
      };
      const [arrivalRows, departureRows] = await Promise.all([
        makeBase()
          .gte("arrival_date", activeCutoff)
          .order("arrival_date", { ascending: false, nullsFirst: false })
          .limit(2000),
        makeBase()
          .is("arrival_date", null)
          .gte("departure_date", activeCutoff)
          .order("departure_date", { ascending: false, nullsFirst: false })
          .limit(1000),
      ]);
      if (arrivalRows.error) throw arrivalRows.error;
      if (departureRows.error) throw departureRows.error;
      const byId = new Map<string, any>();
      [...(arrivalRows.data || []), ...(departureRows.data || [])].forEach((row: any) => byId.set(row.id, row));
      return Array.from(byId.values()).sort((a: any, b: any) => {
        const ad = a.arrival_date || a.departure_date || "";
        const bd = b.arrival_date || b.departure_date || "";
        if (ad !== bd) return bd.localeCompare(ad);
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Any flight_schedule that has a dispatch_assignment is a Security flight —
  // it must be excluded from the Handling tab regardless of purpose/remarks markers.
  const { data: securityFlightIds = new Set<string>() } = useQuery({
    queryKey: ["dispatch_assignments", "flight_schedule_ids", activeCutoff],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispatch_assignments")
        .select("flight_schedule_id")
        .not("flight_schedule_id", "is", null)
        .gte("flight_date", activeCutoff)
        .limit(5000);
      if (error) throw error;
      return new Set<string>((data as any[]).map(r => r.flight_schedule_id));
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });


  const { data: dbAirlines = [], isLoading: isLoadingAirlines } = useQuery({
    queryKey: ["airlines", "service-report-source"],
    queryFn: async () => {
      const { data, error } = await supabase.from("airlines").select("id, name, code");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: dbAircrafts = [] } = useQuery({
    queryKey: ["aircrafts", "service-report-source"],
    queryFn: async () => {
      const { data, error } = await supabase.from("aircrafts").select("registration, ac_type, type, mtow");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });


  // Do not block first paint on delay-code enrichment; rows render immediately
  // and the delay column fills when the small by-ID query returns.
  const isLoading = isLoadingReports || isLoadingFlights || isLoadingAirlines;

  const airlineById = useMemo(
    () => new Map(dbAirlines.map((airline: { id: string; name: string; code: string }) => [airline.id, airline])),
    [dbAirlines]
  );

  const aircraftByReg = useMemo(
    () => new Map((dbAircrafts as any[]).map(a => [String(a.registration || "").toUpperCase().trim(), a])),
    [dbAircrafts]
  );

  const delaysByReport = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const delay of dbDelays as any[]) {
      const reportId = delay.report_id;
      if (!reportId) continue;
      const bucket = map.get(reportId) || [];
      bucket.push(delay);
      map.set(reportId, bucket);
    }
    return map;
  }, [dbDelays]);

  const reports: ReportFormData[] = useMemo(
    () => dbReports.map(r => dbToForm(r, delaysByReport)),
    [dbReports, delaysByReport]
  );

  // Flight numbers belonging to Security (any flight_schedule with a dispatch_assignment).
  // Used to exclude standalone service_reports for those flights from the Handling tab.
  const securityFlightNos = useMemo(() => {
    const s = new Set<string>();
    (dbFlights as any[]).forEach((c: any) => {
      const isSec =
        securityFlightIds.has(c.id) ||
        SECURITY_CLEARANCE_TYPES.includes(c.clearance_type || "") ||
        c.purpose === "Security Service" ||
        ((c.remarks || "") as string).includes("Added from Security Service");
      if (!isSec) return;
      const fn = (getScheduleFlightNo(c) || "").trim().toLowerCase();
      if (fn) s.add(fn);
    });
    return s;
  }, [dbFlights, securityFlightIds]);

  const scheduleSources: ScheduleSourceRow[] = useMemo(() => {
    // Station-originated records (added from Station Dispatch / Service Report)
    // require Operations approval before they show up in All Reports. While
    // they are still Pending, only the Operations Pending-Approval tab sees them.
    const isStationOriginatedPending = (c: any) => {
      const remarks = (c.remarks || "") as string;
      const isStationOriginated =
        c.purpose === "Station Dispatch" ||
        c.purpose === "Security Service" ||
        remarks.includes("Added from Station Dispatch") ||
        remarks.includes("Added from Security Service") ||
        remarks.includes("Added from Service Report");
      return isStationOriginated && c.status !== "Approved";
    };

    // Exclude Security Service flights entirely from the Handling Service Report.
    // Security flights belong only to the Security tab and must NOT appear in Handling
    // (prevents double-billing and category overlap).
    const isSecurityFlight = (c: any) => {
      const remarks = (c.remarks || "") as string;
      if (c.purpose === "Security Service") return true;
      if (remarks.includes("Added from Security Service")) return true;
      // Flights with a dispatch_assignments row are Security flights
      if (securityFlightIds.has(c.id)) return true;
      // Classify by the clearance_type chosen at Clearance entry
      if (SECURITY_CLEARANCE_TYPES.includes(c.clearance_type || "")) return true;
      return false;
    };

    // Station portal: Handling tab must be empty — all station flights belong to Security.
    if (isStationScoped) return [];

    return (dbFlights as any[])
      .filter((c: any) => getScheduleFlightNo(c))
      .filter((c: any) => !isSecurityFlight(c))
      .filter((c: any) => !isStationOriginatedPending(c))
      .map((c: any) => {
        const airline = c.airline_id ? airlineById.get(c.airline_id) : undefined;
        const regKey = String(c.registration || "").toUpperCase().trim();
        const ac = regKey ? aircraftByReg.get(regKey) : undefined;
        return {
          id: c.id,
          sourceType: "flight_schedules" as const,
          flightNo: getScheduleFlightNo(c),
          operator: airline?.name || airline?.code || c.handling_agent || "",
          aircraftType: c.aircraft_type || ac?.ac_type || ac?.type || "",
          mtow: ac?.mtow ? String(ac.mtow) : "",
          registration: c.registration || "",
          route: c.route || "",
          sta: c.sta || "",
          std: c.std || "",
          station: resolveStationFromRoute(c.route || "", userStation) || c.authority || "CAI",
          arrivalDate: c.arrival_date || "",
          departureDate: c.departure_date || "",
          clearanceStatus: c.status || "Pending",
          skdType: c.skd_type || "",
          serviceType: c.clearance_type || "",
          purpose: c.purpose || "",
          createdVia: resolvePipelineCreatedVia(c) || "",
        };
      });
  }, [dbFlights, airlineById, aircraftByReg, userStation, isStationScoped, securityFlightIds]);

  const mergedRows: MergedRow[] = useMemo(() => {
    // Station portal: Handling tab must be empty — every flight at the station is Security.
    if (isStationScoped) return [];
    const reportsByFlight = new Map<string, ReportFormData[]>();
    reports.forEach(r => {
      const key = (r.flightNo || "").trim().toLowerCase();
      if (!reportsByFlight.has(key)) reportsByFlight.set(key, []);
      reportsByFlight.get(key)!.push(r);
    });

    const rows: MergedRow[] = [];
    const usedReportIds = new Set<string>();

    scheduleSources.forEach(source => {
      const key = (source.flightNo || "").trim().toLowerCase();
      const matchedReports = reportsByFlight.get(key) || [];

      if (matchedReports.length > 0) {
        matchedReports.forEach(r => {
          usedReportIds.add(r.id!);
          rows.push({
            ...r,
            isLinked: true,
            flightScheduleId: source.id,
            sourceType: source.sourceType,
            clearanceStatus: source.clearanceStatus,
            skdType: source.skdType,
            serviceType: source.serviceType,
            purpose: source.purpose,
            createdVia: source.createdVia,
          });
        });
        return;
      }

      rows.push({
        ...emptyReport() as ReportFormData,
        id: undefined,
        flightNo: source.flightNo,
        operator: source.operator,
        aircraftType: source.aircraftType,
        registration: source.registration,
        mtow: source.mtow,
        route: source.route,
        sta: source.sta,
        std: source.std,
        station: source.station || "Cairo",
        arrivalDate: source.arrivalDate,
        departureDate: source.departureDate,
        reviewStatus: "pending",
        reviewComment: "",
        reviewedBy: "",
        reviewedAt: null,
        delays: [],
        isLinked: false,
        flightScheduleId: source.id,
        sourceType: source.sourceType,
        clearanceStatus: source.clearanceStatus,
        skdType: source.skdType,
        serviceType: source.serviceType,
        purpose: source.purpose,
        createdVia: source.createdVia,
      });
    });

    reports.forEach(r => {
      if (usedReportIds.has(r.id!)) return;
      // Skip security-typed reports — they belong to the Security tab only
      const ht = (r.handlingType || "").toString().toLowerCase();
      if (ht.includes("security")) return;
      // Skip reports whose flight has a dispatch_assignment (Security flight)
      if (securityFlightNos.has((r.flightNo || "").trim().toLowerCase())) return;
      rows.push({ ...r, isLinked: true });
    });

    return rows;
  }, [reports, scheduleSources, isStationScoped, securityFlightNos]);

  // Save line items helper
  const saveLineItems = async (reportId: string, data: Partial<ReportFormData>) => {
    const cateringItems = data.cateringItems || [];
    const hotacItems = data.hotacItems || [];
    const fuelItems = data.fuelItems || [];

    // Delete existing line items
    await Promise.all([
      supabase.from("service_report_catering").delete().eq("report_id", reportId),
      supabase.from("service_report_hotac").delete().eq("report_id", reportId),
      supabase.from("service_report_fuel").delete().eq("report_id", reportId),
    ]);

    // Insert new line items
    if (cateringItems.length > 0) {
      const rows = cateringItems.map((item, i) => ({ report_id: reportId, catering_item: item.catering_item, supplier: item.supplier, quantity: item.quantity, price_per_unit: item.price_per_unit, total: item.total, sort_order: i }));
      await supabase.from("service_report_catering").insert(rows);
    }
    if (hotacItems.length > 0) {
      const rows = hotacItems.map((item, i) => ({ report_id: reportId, hotel_name: item.hotel_name, room_classification: item.room_classification, type_of_service: item.type_of_service, quantity: item.quantity, price_per_night: item.price_per_night, total: item.total, sort_order: i }));
      await supabase.from("service_report_hotac").insert(rows);
    }
    if (fuelItems.length > 0) {
      const rows = fuelItems.map((item, i) => ({ report_id: reportId, fuel_type: item.fuel_type, supplier: item.supplier, quantity: item.quantity, price_per_unit: item.price_per_unit, total: item.total, sort_order: i }));
      await supabase.from("service_report_fuel").insert(rows);
    }
  };

  // Save new report
  const addMutation = useMutation({
    mutationFn: async (data: Partial<ReportFormData>) => {
      const delays = data.delays || [];
      let dbData: any = formToDb(data);
      // Tag origin so the pipeline stepper can mark step 1 (Clearance) as
      // skipped and step 2 (Station) as completed for station-originated reports.
      if (isStationView && !dbData.created_via) dbData.created_via = "station";
      // Phase 3B Step 2.2 — strip FS-mirror keys; insert shim for NOT NULL flight_no
      dbData = await resolveFlightMasterForWrite(dbData, data.flightScheduleId, "service_reports", "insert");
      const { data: inserted, error } = await supabase.from("service_reports").insert(dbData as any).select().single();
      if (error) throw error;
      if (delays.length > 0) {
        const delayRows = delays.map((d, i) => ({
          report_id: inserted.id,
          code: d.code,
          timing: d.timing,
          explanation: d.explanation,
          sort_order: i,
        }));
        const { error: dErr } = await supabase.from("service_report_delays").insert(delayRows);
        if (dErr) throw dErr;
      }
      await saveLineItems(inserted.id, data);
      // Flight identity lives on flight_schedules (SSoT) and is read back through
      // the FS view — push the form's edits there so the records list matches
      // the report instead of showing the old master values.
      const masterSync = await syncFlightMasterFromReport(data.flightScheduleId, {
        flightNo: data.flightNo,
        registration: data.registration,
        route: data.route,
        aircraftType: data.aircraftType,
        station: isStationScoped && userStation ? userStation : data.station,
        arrivalDate: data.arrivalDate,
        departureDate: data.departureDate,
        sta: data.sta,
        std: data.std,
      });
      // Mark the underlying flight schedule as Approved once a service report exists
      if (data.flightScheduleId) {
        await supabase
          .from("flight_schedules")
          .update({ status: "Approved" } as any)
          .eq("id", data.flightScheduleId);
      }
      return { ...inserted, __masterSyncError: masterSync.error } as any;
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["service_reports"] }); queryClient.invalidateQueries({ queryKey: ["v_service_report_with_flight"] });
      queryClient.invalidateQueries({ queryKey: ["service_report_delays"] });
      queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
      queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"] });
      if (res?.__masterSyncError) {
        toast({ title: "Flight details not updated", description: res.__masterSyncError, variant: "destructive" });
      } else {
        toast({ title: "Saved", description: "Service report added." });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Update report
  const updateMutation = useMutation({
    mutationFn: async (data: Partial<ReportFormData> & { id: string }) => {
      const { id } = data;
      const delays = data.delays || [];
      let dbData: any = formToDb(data);
      // Phase 3B Step 2.2 — strip FS-mirror keys; UPDATE leaves existing values untouched
      dbData = await resolveFlightMasterForWrite(dbData, data.flightScheduleId, "service_reports", "update");
      // Station re-saving a rejected report → flip to "modified" so Operations can re-review
      if (isStationView && data.reviewStatus === "rejected") {
        dbData.review_status = "modified";
        dbData.reviewed_at = new Date().toISOString();
      }
      const { error } = await supabase.from("service_reports").update(dbData).eq("id", id);
      if (error) throw error;
      if (isOperationsView && data.flightScheduleId && typeof data.skdType === "string") {
        const { error: fsErr } = await supabase
          .from("flight_schedules")
          .update({ skd_type: data.skdType } as any)
          .eq("id", data.flightScheduleId);
        if (fsErr) throw fsErr;
      }
      await supabase.from("service_report_delays").delete().eq("report_id", id);
      if (delays.length > 0) {
        const delayRows = delays.map((d, i) => ({
          report_id: id,
          code: d.code,
          timing: d.timing,
          explanation: d.explanation,
          sort_order: i,
        }));
        const { error: dErr } = await supabase.from("service_report_delays").insert(delayRows);
        if (dErr) throw dErr;
      }
      await saveLineItems(id, data);
      // Push identity/date/time edits back to the flight schedule (SSoT) so
      // every portal's records list shows exactly what the report shows.
      const masterSync = await syncFlightMasterFromReport(data.flightScheduleId, {
        flightNo: data.flightNo,
        registration: data.registration,
        route: data.route,
        aircraftType: data.aircraftType,
        station: isStationScoped && userStation ? userStation : data.station,
        arrivalDate: data.arrivalDate,
        departureDate: data.departureDate,
        sta: data.sta,
        std: data.std,
      });
      return { __masterSyncError: masterSync.error } as any;
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["service_reports"] }); queryClient.invalidateQueries({ queryKey: ["v_service_report_with_flight"] });
      queryClient.invalidateQueries({ queryKey: ["service_report_delays"] });
      queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
      queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"] });
      if (res?.__masterSyncError) {
        toast({ title: "Flight details not updated", description: res.__masterSyncError, variant: "destructive" });
      } else {
        toast({ title: "Updated", description: "Service report updated." });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Delete report
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("service_report_delays").delete().eq("report_id", id);
      const { error } = await supabase.from("service_reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service_reports"] }); queryClient.invalidateQueries({ queryKey: ["v_service_report_with_flight"] });
      queryClient.invalidateQueries({ queryKey: ["service_report_delays"] });
      toast({ title: "Deleted", description: "Report removed." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Delete underlying flight schedule (admin only) — removes the unlinked flight row
  const deleteScheduleMutation = useMutation({
    mutationFn: async ({ id, sourceType }: { id: string; sourceType: "flight_schedules" | "clearances" }) => {
      const table = sourceType === "clearances" ? "flight_schedules" : "flight_schedules";
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
      toast({ title: "Deleted", description: "Flight removed." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Auto-fill from FlightSchedule query params + deep-link filters from Invoices validation panel
  const [reviewIdsFilter, setReviewIdsFilter] = useState<string[] | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const flightNo = params.get("flightNo");
    if (flightNo) {
      const scopedStation = isStationScoped && userStation ? (iataToStationName[userStation] || userStation) : null;
      setNewReport(prev => ({
        ...prev,
        flightNo: flightNo || "",
        operator: params.get("operator") || "",
        aircraftType: params.get("aircraftType") || "",
        route: params.get("route") || "",
        sta: params.get("sta") || "",
        std: params.get("std") || "",
        station: scopedStation || prev.station || emptyReport().station,
      }));
      setShowAdd(true);
    }
    const searchParam = params.get("search");
    if (searchParam) { setSearch(searchParam);  }
    const reviewIds = params.get("reviewIds");
    if (reviewIds) {
      const ids = reviewIds.split(",").map(s => s.trim()).filter(Boolean);
      setReviewIdsFilter(ids.length > 0 ? ids : null);
      
    } else {
      setReviewIdsFilter(null);
    }
  }, [location.search]);

  const { data: dbAirportsList = [] } = useQuery({
    queryKey: ["airports", "iata-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("airports").select("iata_code").eq("status", "Active");
      if (error) throw error;
      return data;
    },
  });
  const allStations = useMemo(() => {
    const set = new Set<string>();
    mergedRows.forEach(r => { if (r.station) set.add(r.station); });
    (dbAirportsList as any[]).forEach(a => { if (a.iata_code) set.add(a.iata_code); });
    return [...set].sort();
  }, [mergedRows, dbAirportsList]);
  const allHandlingTypes = useMemo(() => [...new Set(mergedRows.filter(r => r.handlingType).map(r => r.handlingType))], [mergedRows]);
  const allOperators = useMemo(() => [...new Set(["FlyPlus", ...mergedRows.filter(r => r.operator).map(r => r.operator)])].sort(), [mergedRows]);

  const rejectedCount = useMemo(
    () => mergedRows.filter(r => r.isLinked && r.reviewStatus === "rejected").length,
    [mergedRows]
  );

  const modifiedCount = useMemo(
    () => mergedRows.filter(r => r.isLinked && r.reviewStatus === "modified").length,
    [mergedRows]
  );

  const pendingApprovalCount = useMemo(
    () => mergedRows.filter(r => r.purpose === "Station Dispatch" && r.clearanceStatus === "Pending").length,
    [mergedRows]
  );

  const filtered = useMemo(() => {
    let r = mergedRows;
    if (isStationScoped && userStation) {
      const us = userStation.toUpperCase();
      r = r.filter(x => (x.station || "").toUpperCase() === us);
    }
    // Operations sub-tab: filter to Modified reports (when explicitly selected)
    if (isOperationsView && operationsTab === "modified") r = r.filter(x => x.isLinked && x.reviewStatus === "modified");
    if (reviewIdsFilter && reviewIdsFilter.length > 0) {
      const set = new Set(reviewIdsFilter);
      r = r.filter(x => set.has(x.id));
    }
    // Station view: when "Rejected" tab is active, only show rejected reports
    if (isStationView && stationTab === "rejected") r = r.filter(x => x.isLinked && x.reviewStatus === "rejected");
    if (statusFilter === "Completed") r = r.filter(x => x.isLinked);
    if (statusFilter === "Pending Completion") r = r.filter(x => !x.isLinked);
    if (handlingFilter !== "All Types") r = r.filter(x => x.handlingType === handlingFilter);
    if (stationFilter !== "All Stations") r = r.filter(x => x.station === stationFilter);
    if (reviewFilter !== "All Review") r = r.filter(x => {
      const rs = String(x.reviewStatus || "").toLowerCase();
      const f = reviewFilter.toLowerCase();
      if (f === "pending") return rs === "pending" || rs === "pending review";
      return rs === f;
    });
    if (airlineFilter !== "All Airlines") r = r.filter(x => x.operator === airlineFilter);
    if (dateFrom || dateTo) r = r.filter(x => overlapsDateWindow(x.arrivalDate, x.departureDate, dateFrom, dateTo));
    if (search) {
      const s = search.toLowerCase();
      r = r.filter(x =>
        x.operator.toLowerCase().includes(s) ||
        x.flightNo.toLowerCase().includes(s) ||
        x.route.toLowerCase().includes(s) ||
        (x.registration || "").toLowerCase().includes(s)
      );
    }
    // Sort by Arrival Date then by ATA (oldest first for station/operations/receivables; newest first elsewhere).
    // Using ATA as a stable tiebreaker prevents a just-edited row from jumping to the top after refetch.
    const ascending = true;
    return [...r].sort((a, b) => {
      const ad = a.arrivalDate || "";
      const bd = b.arrivalDate || "";
      if (ad !== bd) {
        if (!ad) return 1;
        if (!bd) return -1;
        return ascending ? ad.localeCompare(bd) : bd.localeCompare(ad);
      }
      const at = a.ata || a.sta || "";
      const bt = b.ata || b.sta || "";
      if (!at && !bt) return (a.flightNo || "").localeCompare(b.flightNo || "");
      if (!at) return 1;
      if (!bt) return -1;
      return at.localeCompare(bt);
    });
  }, [mergedRows, statusFilter, handlingFilter, stationFilter, reviewFilter, airlineFilter, dateFrom, dateTo, search, isOperationsView, isStationView, isReceivablesView, stationTab, operationsTab, isStationScoped, userStation, reviewIdsFilter]);

  const { pageRows: pageData, ...pag } = usePagination(filtered, { resetKey: [statusFilter, handlingFilter, stationFilter, reviewFilter, airlineFilter, dateFrom, dateTo, search] });



  // Receivables-only: every approved service report whose flight has not been billed yet
  const unbilledRows = useMemo(() => {
    const billedFlightRefs = new Set(
      (dbInvoices as any[])
        .map((inv: any) => String(inv.flight_ref || "").trim().toUpperCase())
        .filter(Boolean)
    );
    const rows = mergedRows
      .filter(r => r.isLinked && r.reviewStatus === "approved")
      .filter(r => !billedFlightRefs.has(String(r.flightNo || "").trim().toUpperCase()))
      .map(r => {
        const civil = Number(r.civilAviationFee) || 0;
        const handling = Number(r.handlingFee) || 0;
        const airport = Number(r.airportCharge) || 0;
        return {
          id: r.id,
          flightNo: r.flightNo,
          registration: r.registration,
          operator: r.operator,
          route: r.route,
          arrivalDate: r.arrivalDate,
          handlingType: r.handlingType,
          station: r.station,
          civil, handling, airport,
          total: civil + handling + airport,
        };
      })
      .sort((a, b) => (a.arrivalDate || "").localeCompare(b.arrivalDate || "") || (a.flightNo || "").localeCompare(b.flightNo || ""));
    const totals = rows.reduce(
      (acc, r) => { acc.civil += r.civil; acc.handling += r.handling; acc.airport += r.airport; acc.total += r.total; return acc; },
      { civil: 0, handling: 0, airport: 0, total: 0 }
    );
    const byOperator = new Map<string, { operator: string; count: number; total: number }>();
    for (const r of rows) {
      const key = r.operator || "—";
      const e = byOperator.get(key) || { operator: key, count: 0, total: 0 };
      e.count += 1; e.total += r.total;
      byOperator.set(key, e);
    }
    return { rows, totals, byOperator: Array.from(byOperator.values()).sort((a, b) => b.total - a.total) };
  }, [mergedRows, dbInvoices]);

  
  

  const totalFlights = filtered.length;
  const totalPax = filtered.reduce((s, r) => s + r.paxInAdultI + r.paxInInfI + r.paxInAdultD + r.paxInInfD, 0);
  const totalRevenue = filtered.reduce((s, r) => s + r.totalCost, 0);
  const totalHandlingFees = filtered.reduce((s, r) => s + r.handlingFee, 0);

  const saveNew = () => {
    if (!(newReport.operator || "").trim()) {
      toast({ title: "Airline is required", description: "Please select the Airline before saving.", variant: "destructive" });
      return;
    }
    if (!(newReport.skdType || "").trim()) {
      toast({ title: "Skd Type is required", description: "Please select the Skd Type before saving.", variant: "destructive" });
      return;
    }
    if (!newReport.flightNo) {
      toast({ title: "Flight No is required", description: "Please enter the Flight No before saving.", variant: "destructive" });
      return;
    }
    addMutation.mutate(newReport);
    setShowAdd(false);
    setNewReport(emptyReport());
  };

  const startEdit = (r: MergedRow | ReportFormData) => {
    if (isReceivablesView) {
      const merged = r as MergedRow;
      const completed = derivePipelineCompletedStages({
        isLinked: !!merged.isLinked,
        reviewStatus: merged.reviewStatus || "",
        clearanceStatus: merged.clearanceStatus,
        dispatchStatus: merged.isLinked ? "Completed" : "Pending",
        createdVia: resolvePipelineCreatedVia(merged),
      });
      // Receivables can edit once Station (task sheet saved) and Operations (review approved)
      // are complete. Clearance status is informational at billing stage.
      const allDone = completed.includes("station") && completed.includes("operations");
      if (!allDone) {
        toast({
          title: "Locked",
          description: "Station task sheet and Operations approval must be completed before editing in Receivables.",
          variant: "destructive",
        });
        return;
      }
    }
    setEditId(r.id!);
    setEditData({ ...r });
    setActiveClearanceStatus((r as MergedRow).clearanceStatus || "");
  };
  const saveEdit = () => {
    if (!editId) return;
    updateMutation.mutate({ ...editData, id: editId } as any);
    setEditId(null);
  };
  const deleteReport = (id: string) => deleteMutation.mutate(id);

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(r => ({
      "Operator": r.operator,
      "Type of Service": r.handlingType,
      "Station": r.station,
      "Aircraft Type": r.aircraftType,
      "Registration": r.registration,
      "Flight No.": r.flightNo,
      "MTOW": r.mtow,
      "ROUTE": r.route,
      "ARRIVAL Date": r.arrivalDate,
      "DEPARTURE Date": r.departureDate,
      "DAY/NIGHT": autoDayNight(r.td, r.arrivalDate),
      "STA": r.sta, "STD": r.std,
      "T/D": r.td, "C/O": r.co, "O/B": r.ob, "T/O": r.to,
      "GROUND TIME": r.groundTime,
      "DLY1 Code": r.delays?.[0]?.code || "", "DLY1 Timing": r.delays?.[0]?.timing || "",
      "DLY2 Code": r.delays?.[1]?.code || "", "DLY2 Timing": r.delays?.[1]?.timing || "",
      "DLY3 Code": r.delays?.[2]?.code || "", "DLY3 Timing": r.delays?.[2]?.timing || "",
      "DLY4 Code": r.delays?.[3]?.code || "", "DLY4 Timing": r.delays?.[3]?.timing || "",
      "PAX IN Adult /I": r.paxInAdultI, "PAX IN INF /I": r.paxInInfI,
      "PAX IN Adult /D": r.paxInAdultD, "PAX IN INF /D": r.paxInInfD,
      "PAX TRANSIT": r.paxTransit,
      "Project Tags": r.projectTags,
      "CHECK IN SYSTEM": r.checkInSystem,
      "PERFORMED BY": r.performedBy,
      "Civil Aviation Fee": r.civilAviationFee,
      "Handling Fee": r.handlingFee,
      "Airport Charge": r.airportCharge,
      "Total Cost": r.totalCost,
      "Currency": r.currency,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Service Report");
    XLSX.writeFile(wb, "Link_Service_Report_Export.xlsx");
  };

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws);
      for (const row of json) {
        const data: Partial<ReportFormData> = {
          operator: row["Operator"] || "",
          handlingType: row["Type of Service"] || "Turn Around",
          station: row["Station"] || "Cairo",
          aircraftType: row["Aircraft Type"] || "",
          registration: row["Registration"] || "",
          flightNo: row["Flight No."] || "",
          mtow: row["MTOW"] || "",
          route: row["ROUTE"] || "",
          arrivalDate: row["ARRIVAL Date"] || "",
          departureDate: row["DEPARTURE Date"] || "",
          sta: row["STA"] || "", std: row["STD"] || "",
          td: row["T/D"] || "", co: row["C/O"] || "",
          ob: row["O/B"] || "", to: row["T/O"] || "",
          groundTime: row["GROUND TIME"] || "",
          delays: [
            row["DLY1 Code"] ? { code: row["DLY1 Code"], timing: Number(row["DLY1 Timing"] || 0), explanation: "" } : null,
            row["DLY2 Code"] ? { code: row["DLY2 Code"], timing: Number(row["DLY2 Timing"] || 0), explanation: "" } : null,
            row["DLY3 Code"] ? { code: row["DLY3 Code"], timing: Number(row["DLY3 Timing"] || 0), explanation: "" } : null,
            row["DLY4 Code"] ? { code: row["DLY4 Code"], timing: Number(row["DLY4 Timing"] || 0), explanation: "" } : null,
          ].filter(Boolean) as DelayEntry[],
          paxInAdultI: Number(row["PAX IN Adult /I"] || 0),
          paxInInfI: Number(row["PAX IN INF /I"] || 0),
          paxInAdultD: Number(row["PAX IN Adult /D"] || 0),
          paxInInfD: Number(row["PAX IN INF /D"] || 0),
          paxTransit: Number(row["PAX TRANSIT"] || 0),
          projectTags: row["Project Tags"] || "",
          checkInSystem: row["CHECK IN SYSTEM"] || "",
          performedBy: row["PERFORMED BY"] || "Link Egypt",
          civilAviationFee: Number(row["Civil Aviation Fee"] || 0),
          handlingFee: Number(row["Handling Fee"] || 0),
          airportCharge: Number(row["Airport Charge"] || 0),
          totalCost: Number(row["Total Cost"] || 0),
          currency: row["Currency"] || "USD",
        };
        await addMutation.mutateAsync(data);
      }
      toast({ title: "Imported", description: `${json.length} records imported.` });
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  }, [addMutation]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <FileBarChart2 size={22} className="text-primary" /> Service Report
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Flight service reports linked to schedules, charges and the chart of services.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["service_reports"] }); queryClient.invalidateQueries({ queryKey: ["v_service_report_with_flight"] });
              queryClient.invalidateQueries({ queryKey: ["service_report_delays"] });
              queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
              queryClient.invalidateQueries({ queryKey: ["invoices_for_receivables_panel"] });
              toast({ title: "Refreshing", description: "Reloading service reports…" });
            }}
            className="toolbar-btn"
            title="Refresh"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          {canCreateNew && (
            <button onClick={() => {
              const scopedStation = isStationScoped && userStation ? (iataToStationName[userStation] || userStation) : null;
              setNewReport({ ...emptyReport(), station: scopedStation || emptyReport().station });
              setShowAdd(true);
            }} className="toolbar-btn-primary"><Plus size={14} /> New Service Report</button>
          )}
        </div>
      </div>

      {/* Station-only sub-tabs (All vs Rejected) */}
      {isStationView && (
        <div className="flex items-center gap-2 border-b">
          <button
            onClick={() => { setStationTab("all");  }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              stationTab === "all"
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            All Reports
          </button>
          <button
            onClick={() => { setStationTab("rejected");  }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              stationTab === "rejected"
                ? "text-destructive border-destructive"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            <AlertCircle size={14} />
            Rejected Service Reports
            {rejectedCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                {rejectedCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Operations sub-tabs (All vs Modified vs Clearance Flights) */}
      {isOperationsView && (
        <div className="flex items-center gap-2 border-b">
          <button
            onClick={() => { setOperationsTab("all");  }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              operationsTab === "all"
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            All Reports
          </button>
          <button
            onClick={() => { setOperationsTab("modified");  }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              operationsTab === "modified"
                ? "text-warning border-warning"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            <AlertCircle size={14} />
            Modified
            {modifiedCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-warning text-warning-foreground text-[10px] font-bold">
                {modifiedCount}
              </span>
            )}
          </button>
        </div>
      )}


      {/* Summary Stats */}
      <div className="stat-strip">
        <div className="stat-card">
          <div className="stat-card-icon bg-primary"><Plane size={20} /></div>
          <div><div className="text-xl md:text-2xl font-bold text-foreground">{totalFlights}</div><div className="text-xs text-muted-foreground">Total Flights</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-info"><Users size={20} /></div>
          <div><div className="text-xl md:text-2xl font-bold text-foreground">{totalPax.toLocaleString()}</div><div className="text-xs text-muted-foreground">Total Passengers</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-success"><DollarSign size={20} /></div>
          <div><div className="text-xl md:text-2xl font-bold text-foreground">${totalRevenue.toLocaleString()}</div><div className="text-xs text-muted-foreground">Total Revenue</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-warning"><Building2 size={20} /></div>
          <div><div className="text-xl md:text-2xl font-bold text-foreground">${totalHandlingFees.toLocaleString()}</div><div className="text-xs text-muted-foreground">Handling Fees</div></div>
        </div>
      </div>

      {/* Deep-link filter banner from Invoices validation panel */}
      {reviewIdsFilter && reviewIdsFilter.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          <div className="text-warning-foreground">
            <span className="font-semibold">Filtered to {reviewIdsFilter.length} report{reviewIdsFilter.length === 1 ? "" : "s"}</span>
            <span className="text-muted-foreground ml-2">flagged by Pre-Invoice Validation. Fix issues, then approve.</span>
          </div>
          <button
            className="text-xs font-semibold text-primary hover:underline"
            onClick={() => { setReviewIdsFilter(null); navigate("/service-report", { replace: true }); }}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="p-4 border-b flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-foreground mr-auto">Flight Service Records</h2>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text" placeholder="Search operator, flight, route…"
              value={search} onChange={e => { setSearch(e.target.value);  }}
              className="pl-8 pr-3 py-1.5 text-sm border rounded bg-card text-foreground placeholder:text-muted-foreground w-56 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <select value={airlineFilter} onChange={e => { setAirlineFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Airlines</option>
            {allOperators.map(o => <option key={o}>{o}</option>)}
          </select>
          <select value={handlingFilter} onChange={e => { setHandlingFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Types</option>
            {allHandlingTypes.map(h => <option key={h}>{h}</option>)}
          </select>
          <select value={stationFilter} onChange={e => { setStationFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Stations</option>
            {allStations.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={reviewFilter} onChange={e => { setReviewFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Review</option>
            <option value="pending">Pending</option>
            <option value="modified">Modified</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Status</option>
            <option>Completed</option>
            <option>Pending Completion</option>
          </select>
          <div className="flex items-center gap-1">
            <label className="text-xs text-muted-foreground">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground" />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-muted-foreground">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground" />
          </div>
          <div className="flex border rounded-lg overflow-hidden">
            <button onClick={() => setViewMode("table")} className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"}`}><TableIcon size={13} /> Table</button>
            <button onClick={() => setViewMode("calendar")} className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "calendar" ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"}`}><CalendarDays size={13} /> Calendar</button>
          </div>
          <button onClick={() => fileInputRef.current?.click()} className="toolbar-btn-success"><Upload size={14} /> Upload Excel</button>
          <button onClick={handleExport} className="toolbar-btn-outline"><Download size={14} /> Export</button>
          {isOperationsView && (
            <button
              disabled={bulkApproving}
              onClick={async () => {
                const targets = filtered.filter(r => r.isLinked && r.id && r.reviewStatus !== "approved");
                if (targets.length === 0) {
                  toast({ title: "Nothing to approve", description: "All shown reports are already approved.", variant: "destructive" });
                  return;
                }
                if (!confirm(`Approve ${targets.length} service report(s) shown on this view?`)) return;
                const ids = targets.map(r => r.id!) as string[];
                setBulkApproving(true);
                const CHUNK = 200;
                let approved = 0;
                let firstError: string | null = null;
                try {
                  const reviewedAt = new Date().toISOString();
                  for (let i = 0; i < ids.length; i += CHUNK) {
                    const slice = ids.slice(i, i + CHUNK);
                    const { error } = await supabase
                      .from("service_reports")
                      .update({ review_status: "approved", reviewed_by: "Operations (bulk)", reviewed_at: reviewedAt } as any)
                      .in("id", slice);
                    if (error) {
                      firstError = error.message;
                      break;
                    }
                    approved += slice.length;
                  }
                  // Sync linked flight_schedules to Completed
                  const fsIds = targets.map(r => r.flightScheduleId).filter(Boolean) as string[];
                  if (fsIds.length > 0) {
                    for (let i = 0; i < fsIds.length; i += CHUNK) {
                      await supabase.from("flight_schedules").update({ status: "Completed" } as any).in("id", fsIds.slice(i, i + CHUNK));
                    }
                  }
                } finally {
                  setBulkApproving(false);
                  queryClient.invalidateQueries({ queryKey: ["service_reports"] }); queryClient.invalidateQueries({ queryKey: ["v_service_report_with_flight"] });
                  queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
                }
                if (firstError) {
                  toast({ title: `Partial approval (${approved}/${ids.length})`, description: firstError, variant: "destructive" });
                } else {
                  toast({ title: "✅ Bulk Approved", description: `${approved} service report(s) approved and forwarded to Receivables.` });
                }
              }}
              className="toolbar-btn-primary disabled:opacity-60"
            >
              <CheckCircle2 size={14} /> {bulkApproving ? "Approving…" : `Approve All Shown (${filtered.filter(r => r.isLinked && r.reviewStatus !== "approved").length})`}
            </button>
          )}
          {isReceivablesView && (
            <button
              onClick={() => setShowUnbilled(true)}
              className="toolbar-btn-primary"
              title="Open all approved flights that have not been invoiced yet, with per-flight receivables"
            >
              <Receipt size={14} />
              Unbilled Flights ({unbilledRows.rows.length})
            </button>
          )}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
        </div>

        {viewMode === "calendar" ? (
          <ServiceReportCalendarView reports={filtered} month={calMonth} onMonthChange={setCalMonth} onEdit={startEdit} invoiceStatusByFlight={invoiceStatusByFlight} channel={activeChannel} />
        ) : (
        <>
          <div className="ops-scroll overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {["#", "OPERATOR", "FLIGHT", "REG", "TYPE", "SKD TYPE", "SERVICE TYPE", "STATION", "ROUTE", "ARR DATE", "A/C TYPE", "MTOW", "D/N", "PAX IN", "DLY", "TOTAL ($)", "PIPELINE", "ACTIONS"].map(h => (
                  <th key={h} className="data-table-header px-3 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={18} className="text-center py-16 text-muted-foreground">Loading…</td></tr>
              ) : pageData.length === 0 ? (
                <tr>
                  <td colSpan={18} className="text-center py-16">
                    <FileBarChart2 size={40} className="mx-auto text-muted-foreground/30 mb-3" />
                    <p className="font-semibold text-foreground">No Service Reports Found</p>
                    <p className="text-muted-foreground text-sm mt-1">Add a new report or upload an Excel file</p>
                  </td>
                </tr>
              ) : pageData.map((r, i) => (
                <tr key={r.id || `fs-${r.flightScheduleId}-${i}`} className={`data-table-row ${!r.isLinked ? "bg-muted/30" : ""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{pag.start + i + 1}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.operator ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap" style={airlineBadgeStyle(r.operator)}>{r.operator}</span> : "—"}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-foreground">{r.flightNo}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{r.registration || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.isLinked ? (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${statusColor[r.handlingType] || "bg-muted text-muted-foreground"}`}>
                        {r.handlingType}
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-foreground text-xs whitespace-nowrap">{r.skdType || "—"}</td>
                  <td className="px-3 py-2.5 text-foreground text-xs whitespace-nowrap">{r.serviceType || "—"}</td>
                  <td className="px-3 py-2.5 text-foreground">{r.station || "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{r.route || "—"}</td>
                  <td className="px-3 py-2.5 text-foreground whitespace-nowrap">{r.arrivalDate || "—"}</td>
                  <td className="px-3 py-2.5 text-foreground">{r.aircraftType || "—"}</td>
                  <td className="px-3 py-2.5 text-foreground">{r.mtow || "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    {r.isLinked ? (() => { const dn = autoDayNight(r.td, r.arrivalDate); return (
                      <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${dn === "N" ? "bg-info/15 text-info" : "bg-warning/15 text-warning"}`}>
                        {dn}
                      </span>
                    ); })() : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-foreground">{r.isLinked ? r.paxInAdultI + r.paxInInfI + r.paxInAdultD + r.paxInInfD : "—"}</td>
                  <td className="px-3 py-2.5 text-foreground">
                    {r.isLinked && r.delays && r.delays.length > 0 ? r.delays.map(d => d.code).join("/") : "—"}
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-success">{r.isLinked ? r.totalCost.toLocaleString() : "—"}</td>
                  <td className="px-3 py-2.5">
                    {(() => {
                      const invStatus = invoiceStatusByFlight.get(normalizeFlightKey(String(r.flightNo || ""))) || "none";
                      return (
                        <PipelineStepper
                          currentStage={derivePipelineStage({ isLinked: !!r.isLinked, reviewStatus: r.reviewStatus, clearanceStatus: r.clearanceStatus, dispatchStatus: r.isLinked ? "Completed" : "Pending", channel: activeChannel, invoiceStatus: invStatus, createdVia: resolvePipelineCreatedVia(r) })}
                          completedStages={derivePipelineCompletedStages({ isLinked: !!r.isLinked, reviewStatus: r.reviewStatus, clearanceStatus: r.clearanceStatus, dispatchStatus: r.isLinked ? "Completed" : "Pending", invoiceStatus: invStatus, createdVia: resolvePipelineCreatedVia(r) })}
                          compact
                        />
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1.5">
                      {isStationView && r.flightScheduleId && (
                        <button
                          onClick={async () => {
                            const comment = prompt(`Return flight ${r.flightNo} to Clearance — reason:`);
                            const reason = (comment || "").trim();
                            if (!reason) return;
                            const stamp = `[Station Return ${new Date().toISOString().slice(0,16).replace("T"," ")}] ${reason}`;
                            try {
                              const { data: updated, error } = await (supabase as any).rpc("return_flight_to_clearance", {
                                _id: r.flightScheduleId!,
                                _stamp: stamp,
                              });
                              if (error) throw error;
                              const patched = Array.isArray(updated) ? updated[0] : updated;
                              if (patched) {
                                queryClient.setQueriesData({ queryKey: ["flight_schedules"] }, (old: any) => {
                                  if (!Array.isArray(old)) return old;
                                  return old.map((f: any) => f?.id === r.flightScheduleId ? { ...f, ...patched } : f);
                                });
                              }
                              await Promise.all([
                                queryClient.invalidateQueries({ queryKey: ["flight_schedules"] }),
                                queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] }),
                              ]);
                              await queryClient.refetchQueries({ queryKey: ["flight_schedules"], type: "active" });
                              const persisted = ((patched as any)?.remarks || "").includes(stamp);
                              toast({
                                title: persisted ? "↩️ Returned to Clearance — reason saved" : "↩️ Returned to Clearance",
                                description: persisted
                                  ? `Saved to flight remarks: "${reason}"`
                                  : `Reason: "${reason}"`,
                              });
                            } catch (e: any) {
                              toast({ title: "Error", description: e.message, variant: "destructive" });
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
                          title="Return flight to Clearance with a comment"
                        >
                          <RefreshCw size={12} /> Return to Clearance
                        </button>
                      )}

                      {!r.isLinked ? (
                        <>
                          <button
                            onClick={() => {
                              const scopedStation = isStationScoped && userStation ? (iataToStationName[userStation] || userStation) : null;
                              setNewReport({
                                ...emptyReport(),
                                station: scopedStation || emptyReport().station,
                                flightScheduleId: r.flightScheduleId,
                                flightNo: r.flightNo,
                                operator: r.operator,
                                aircraftType: r.aircraftType,
                                registration: r.registration,
                                route: r.route,
                                sta: r.sta,
                                std: r.std,
                                arrivalDate: r.arrivalDate,
                                departureDate: r.departureDate,
                              });
                              setActiveClearanceStatus(r.clearanceStatus || "");
                              setShowAdd(true);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            title="Complete Service Report"
                          >
                            <Pencil size={12} /> Complete
                          </button>
                          {isAdmin && r.flightScheduleId && (
                            <button
                              onClick={() => {
                                if (confirm(`Delete flight ${r.flightNo} (${r.arrivalDate || "—"})? This removes the underlying schedule.`)) {
                                  deleteScheduleMutation.mutate({ id: r.flightScheduleId!, sourceType: r.sourceType || "flight_schedules" });
                                }
                              }}
                              className="text-destructive hover:text-destructive/80"
                              title="Delete Flight (Admin)"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          {(r.reviewStatus === "pending" || r.reviewStatus === "modified") && (
                            <>
                              <button onClick={async () => {
                                const reviewedAt = new Date().toISOString();
                                await supabase.from("service_reports").update({ review_status: "approved", reviewed_by: "Operations", reviewed_at: reviewedAt } as any).eq("id", r.id);
                                if (r.flightScheduleId) {
                                  await supabase.from("flight_schedules").update({ status: "Completed" } as any).eq("id", r.flightScheduleId);
                                  queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
                                }
                                // Update cache in place to preserve current row order (no refetch / no re-sort)
                                queryClient.setQueriesData({ queryKey: ["service_reports"] }, (old: any) => {
                                  if (!Array.isArray(old)) return old;
                                  return old.map((row: any) => row.id === r.id ? { ...row, review_status: "approved", reviewed_by: "Operations", reviewed_at: reviewedAt } : row);
                                });
                                toast({ title: "✅ Approved" });
                              }} className="text-success hover:text-success/80" title="Approve"><CheckCircle2 size={13} /></button>
                              <button onClick={async () => {
                                const comment = prompt("Rejection reason:");
                                if (comment === null) return;
                                const reviewedAt = new Date().toISOString();
                                await supabase.from("service_reports").update({ review_status: "rejected", review_comment: comment, reviewed_by: "Operations", reviewed_at: reviewedAt } as any).eq("id", r.id);
                                queryClient.setQueriesData({ queryKey: ["service_reports"] }, (old: any) => {
                                  if (!Array.isArray(old)) return old;
                                  return old.map((row: any) => row.id === r.id ? { ...row, review_status: "rejected", review_comment: comment, reviewed_by: "Operations", reviewed_at: reviewedAt } : row);
                                });
                                toast({ title: "❌ Rejected", description: comment });
                              }} className="text-destructive hover:text-destructive/80" title="Reject"><XCircle size={13} /></button>
                            </>
                          )}
                          {r.reviewStatus === "approved" && (
                            <button onClick={() => {
                              const params = new URLSearchParams({
                                operator: r.operator, flightRef: r.flightNo,
                                description: `${r.handlingType} – ${r.route}`,
                                civilAviation: String(r.civilAviationFee), handling: String(r.handlingFee),
                                airportCharges: String(r.airportCharge),
                              });
                              navigate(`/invoices?${params.toString()}`);
                            }} className="text-success hover:text-success/80" title="Generate Invoice"><Receipt size={13} /></button>
                          )}
                          <button onClick={() => { setViewData({ ...r } as any); setActiveClearanceStatus((r as MergedRow).clearanceStatus || ""); }} className="text-muted-foreground hover:text-foreground" title="View full record"><Eye size={13} /></button>
                          <button onClick={() => startEdit(r)} className="text-info hover:text-info/80"><Pencil size={13} /></button>
                          {isAdmin && (
                            <button
                              onClick={() => {
                                if (confirm("Delete this service report?")) deleteReport(r.id!);
                              }}
                              className="text-destructive hover:text-destructive/80"
                              title="Delete Report (Admin only)"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                          {isAdmin && r.flightScheduleId && (
                            <button
                              onClick={async () => {
                                if (!confirm(`Delete flight ${r.flightNo} (${r.arrivalDate || r.departureDate || "—"})? This removes the service report AND the underlying flight schedule.`)) return;
                                try {
                                  if (r.id) {
                                    await supabase.from("service_reports").delete().eq("id", r.id);
                                  }
                                  await supabase.from("flight_schedules").delete().eq("id", r.flightScheduleId!);
                                  queryClient.invalidateQueries({ queryKey: ["service_reports"] }); queryClient.invalidateQueries({ queryKey: ["v_service_report_with_flight"] });
                                  queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
                                  toast({ title: "Deleted", description: "Flight and report removed." });
                                } catch (e: any) {
                                  toast({ title: "Error", description: e.message, variant: "destructive" });
                                }
                              }}
                              className="text-destructive hover:text-destructive/80"
                              title="Delete Flight (Admin) — removes flight + report"
                            >
                              <X size={13} />
                            </button>
                          )}
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
        </>
      )}
      </div>

      {showAdd && (
        <TabbedReportForm
          title="New Service Report"
          data={newReport}
          onChange={setNewReport}
          onSave={saveNew}
          onCancel={() => setShowAdd(false)}
          clearanceStatus={activeClearanceStatus}
        />
      )}
      {editId && (
        <TabbedReportForm
          title={isOperationsView ? "Review Service Report" : "Edit Service Report"}
          data={editData}
          onChange={setEditData}
          onSave={saveEdit}
          onCancel={() => setEditId(null)}
          clearanceStatus={activeClearanceStatus}
          reviewMode={isOperationsView}
          onApprove={async (comment) => {
            const { error } = await supabase.from("service_reports").update({
              review_status: "approved",
              review_comment: comment || "",
              reviewed_by: "Operations",
              reviewed_at: new Date().toISOString(),
            } as any).eq("id", editId);
            if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
            queryClient.invalidateQueries({ queryKey: ["service_reports"] }); queryClient.invalidateQueries({ queryKey: ["v_service_report_with_flight"] });
            toast({ title: "✅ Report Approved", description: comment || "Moved to Receivables." });
            setEditId(null);
          }}
          onReject={async (comment) => {
            if (!comment.trim()) { toast({ title: "Comment required", description: "Add a reason before rejecting.", variant: "destructive" }); return; }
            const { error } = await supabase.from("service_reports").update({
              review_status: "rejected",
              review_comment: comment,
              reviewed_by: "Operations",
              reviewed_at: new Date().toISOString(),
            } as any).eq("id", editId);
            if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
            queryClient.invalidateQueries({ queryKey: ["service_reports"] }); queryClient.invalidateQueries({ queryKey: ["v_service_report_with_flight"] });
            toast({ title: "❌ Report Rejected", description: "Sent back to Station with comments." });
            setEditId(null);
          }}
        />
      )}
      {viewData && (
        <TabbedReportForm
          title="View Service Report"
          data={viewData}
          onChange={() => {}}
          onSave={() => {}}
          onCancel={() => setViewData(null)}
          clearanceStatus={activeClearanceStatus}
          viewOnly
        />
      )}
      {showUnbilled && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-auto" onClick={() => setShowUnbilled(false)}>
          <div className="bg-card rounded-lg shadow-2xl w-full max-w-6xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-primary" />
                <h2 className="text-base font-bold text-foreground">Unbilled Approved Flights — Per-Flight Receivables</h2>
              </div>
              <button onClick={() => setShowUnbilled(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="px-5 py-3 bg-primary/5 border-b flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span><span className="text-muted-foreground">Flights:</span> <span className="font-mono font-bold">{unbilledRows.rows.length}</span></span>
              <span><span className="text-muted-foreground">Operators:</span> <span className="font-mono font-bold">{unbilledRows.byOperator.length}</span></span>
              <span><span className="text-muted-foreground">Civil Aviation:</span> <span className="font-mono font-bold">${unbilledRows.totals.civil.toFixed(2)}</span></span>
              <span><span className="text-muted-foreground">Handling:</span> <span className="font-mono font-bold">${unbilledRows.totals.handling.toFixed(2)}</span></span>
              <span><span className="text-muted-foreground">Airport:</span> <span className="font-mono font-bold">${unbilledRows.totals.airport.toFixed(2)}</span></span>
              <span className="ms-auto"><span className="text-muted-foreground">Total Receivables:</span> <span className="font-mono font-bold text-success">${unbilledRows.totals.total.toFixed(2)}</span></span>
            </div>
            {unbilledRows.byOperator.length > 0 && (
              <div className="px-5 py-2 bg-muted/10 border-b">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Per-Operator Subtotal</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  {unbilledRows.byOperator.map(o => (
                    <span key={o.operator} className="inline-flex items-center gap-1">
                      <span className="font-semibold text-foreground">{o.operator}</span>
                      <span className="text-muted-foreground">({o.count})</span>
                      <span className="font-mono text-success">${o.total.toFixed(2)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="max-h-[55vh] overflow-auto">
              {unbilledRows.rows.length === 0 ? (
                <div className="px-5 py-12 text-center text-muted-foreground text-sm">
                  No unbilled approved flights — every approved service report already has a matching invoice.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-left text-muted-foreground uppercase">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Flight</th>
                      <th className="px-3 py-2">Reg.</th>
                      <th className="px-3 py-2">Operator</th>
                      <th className="px-3 py-2">Route</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Station</th>
                      <th className="px-3 py-2 text-right">Civil ($)</th>
                      <th className="px-3 py-2 text-right">Handling ($)</th>
                      <th className="px-3 py-2 text-right">Airport ($)</th>
                      <th className="px-3 py-2 text-right">Total ($)</th>
                      <th className="px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unbilledRows.rows.map((r, i) => (
                      <tr key={r.id || i} className="border-t hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 font-mono">{r.arrivalDate || "—"}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-foreground">{r.flightNo || "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.registration || "—"}</td>
                        <td className="px-3 py-2">{r.operator || "—"}</td>
                        <td className="px-3 py-2">{r.route || "—"}</td>
                        <td className="px-3 py-2">{r.handlingType || "—"}</td>
                        <td className="px-3 py-2">{r.station || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.civil.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.handling.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.airport.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-success">{r.total.toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => {
                              const params = new URLSearchParams({
                                operator: r.operator || "",
                                flightRef: r.flightNo || "",
                                description: `${r.handlingType || ""} – ${r.route || ""}`,
                                civilAviation: String(r.civil),
                                handling: String(r.handling),
                                airportCharges: String(r.airport),
                              });
                              navigate(`/invoices?${params.toString()}`);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] font-medium"
                          >
                            <Receipt size={11} /> Invoice
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/40 font-bold border-t-2">
                      <td colSpan={7} className="px-3 py-2 text-right uppercase text-xs">Grand Total</td>
                      <td className="px-3 py-2 text-right font-mono">{unbilledRows.totals.civil.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{unbilledRows.totals.handling.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{unbilledRows.totals.airport.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-success">{unbilledRows.totals.total.toFixed(2)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Wrapper with Security / Handling tabs ---
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Shield, Wrench } from "lucide-react";
import SecurityServiceReportsPage from "@/pages/SecurityServiceReports";

export default function ServiceReportPage() {
  const loc = useLocation();
  const initialTab = (() => {
    const p = new URLSearchParams(loc.search);
    if (p.get("tab") === "handling") return "handling";
    return "security";
  })();
  return (
    <div className="space-y-4">
      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="security" className="gap-1.5">
            <Shield size={14} /> Security
          </TabsTrigger>
          <TabsTrigger value="handling" className="gap-1.5">
            <Wrench size={14} /> Handling
          </TabsTrigger>
        </TabsList>
        <TabsContent value="security">
          <SecurityServiceReportsPage />
        </TabsContent>
        <TabsContent value="handling">
          <HandlingServiceReportContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}


