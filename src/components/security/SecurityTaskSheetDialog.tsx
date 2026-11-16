import { useState, useEffect, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield, Printer, Download, Plane, Clock, Eye, Package, MessageSquare, UserCheck, AlertTriangle, FileText, DollarSign, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import PipelineStepper, { derivePipelineStage, derivePipelineCompletedStages } from "@/components/serviceReport/PipelineStepper";
import { SKD_TYPES, SECURITY_CLEARANCE_TYPES, getAllowedServiceTypesForSkd } from "@/components/clearances/ClearanceTypes";
import { Json } from "@/integrations/supabase/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useChannel } from "@/contexts/ChannelContext";
import { useUserStation } from "@/contexts/UserStationContext";
import { calculateSecurityCharges, groundTimeHours, type ChargeLine } from "@/lib/securityChargeCalculator";
import type { SecurityRateRow } from "@/components/contracts/ContractTypes";
import { formatDateDMY } from "@/lib/utils";
import { getMasterFields } from "@/lib/flightMaster";
import { startSaveTimer } from "@/lib/saveTiming";
import {
  subscribeWriteCycle,
  getLastWriteCycleResult,
  type WriteCycleResult,
} from "@/lib/phase3WriteCycleVerifier";
import linkAeroTaskLogo from "@/assets/link-aero-task-logo.png.asset.json";
import ethiopianAirlinesLogo from "@/assets/ethiopian-airlines-logo.jpeg.asset.json";
import AirFranceTaskSheet, { AirFranceHeader, isAirFranceAirline, emptyAirFranceData, buildAirFrancePrintHtml, type AirFranceData } from "@/components/security/AirFranceTaskSheet";

/** Auto-format & validate a 24-hour time input as HH:MM. Rejects invalid hours/minutes. */
function formatTimeInput(value: string, prevValue: string): string {
  // Strip non-digits/colon
  let v = value.replace(/[^0-9:]/g, "");
  // Allow user to clear
  if (v === "") return "";

  // Split on colon, but also handle plain digit input
  const hasColon = v.includes(":");
  let hh = "";
  let mm = "";
  if (hasColon) {
    const [h = "", m = ""] = v.split(":");
    hh = h.slice(0, 2);
    mm = m.slice(0, 2);
  } else {
    hh = v.slice(0, 2);
    mm = v.slice(2, 4);
  }

  // Reject hours > 23 as the user types: cap at 23
  if (hh.length === 1) {
    // Single digit hour — allow any 0-9, will validate after second digit
  } else if (hh.length === 2) {
    const hNum = parseInt(hh, 10);
    if (isNaN(hNum) || hNum > 23) {
      // Invalid hour — return previous value to block entry
      return prevValue;
    }
  }

  // Reject minutes > 59
  if (mm.length === 2) {
    const mNum = parseInt(mm, 10);
    if (isNaN(mNum) || mNum > 59) {
      return prevValue;
    }
  }

  // Auto-insert colon after 2 digits (only when typing forward, not deleting)
  let out = hh;
  if (mm.length > 0 || (hh.length === 2 && value.length > prevValue.length)) {
    out = hh + ":" + mm;
  }
  if (out.length > 5) out = out.slice(0, 5);
  return out;
}

/** Auto-format ATA/ATD fields as either HH:MM or HH:MM/HH:MM. */
function formatDualTimeInput(value: string, prevValue: string): string {
  const cleaned = value.replace(/[^0-9:/]/g, "");
  if (!cleaned) return "";

  const hasSlash = cleaned.includes("/");
  const [firstRaw = "", secondRaw = ""] = cleaned.split("/", 2);
  const first = formatTimeInput(firstRaw, prevValue.split("/")[0] || "");
  if (firstRaw && !first) return prevValue;
  if (!hasSlash) return first;

  const secondPrev = prevValue.split("/")[1] || "";
  const second = secondRaw ? formatTimeInput(secondRaw, secondPrev) : "";
  if (secondRaw && !second) return prevValue;
  return `${first}/` + second;
}

/** Convert ISO yyyy-mm-dd ⇄ DD/MM/YYYY for masked text date inputs. */
function isoToDmy(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function dmyToIso(dmy: string): string {
  if (!dmy) return "";
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}
/** Auto-format date input as DD/MM/YYYY with validation. */
function formatDateDmyInput(value: string, prevValue: string): string {
  let v = value.replace(/[^0-9/]/g, "");
  if (v === "") return "";
  const parts = v.split("/");
  let dd = parts[0]?.slice(0, 2) || "";
  let mm = parts[1]?.slice(0, 2) || "";
  let yyyy = parts[2]?.slice(0, 4) || "";

  // If no slashes, slice by position
  if (parts.length === 1 && v.length > 0) {
    dd = v.slice(0, 2);
    mm = v.slice(2, 4);
    yyyy = v.slice(4, 8);
  }

  if (dd.length === 2) {
    const d = parseInt(dd, 10);
    if (isNaN(d) || d < 1 || d > 31) return prevValue;
  }
  if (mm.length === 2) {
    const m = parseInt(mm, 10);
    if (isNaN(m) || m < 1 || m > 12) return prevValue;
  }
  if (yyyy.length === 4) {
    const y = parseInt(yyyy, 10);
    if (isNaN(y) || y < 1900 || y > 2100) return prevValue;
  }

  let out = dd;
  if (mm.length > 0 || (dd.length === 2 && value.length > prevValue.length)) out = dd + "/" + mm;
  if (yyyy.length > 0 || (mm.length === 2 && value.length > prevValue.length)) out = dd + "/" + mm + "/" + yyyy;
  if (out.length > 10) out = out.slice(0, 10);
  return out;
}

interface TaskSheetData extends AirFranceData {
  flight_type: string;
  delay: string;
  shift_start_date: string;
  shift_end_date: string;
  shift_start: string;
  shift_end: string;
  sta: string;
  std: string;
  ata: string;
  atd: string;
  registration: string;
  route: string;
  cargo_observer_1: string;
  cargo_observer_2: string;
  hold_baggage_observer_1: string;
  hold_baggage_observer_2: string;
  gate_door_observer_1: string;
  aircraft_door_observer_1: string;
  aircraft_door_observer_2: string;
  aircraft_ramp_observer_1: string;
  aircraft_ramp_observer_2: string;
  catering_accompanied: string;
  cargo_accompanied: string;
  baggage_accompanied: string;
  total_baggage_brs: string;
  total_baggage_accepted: string;
  missing_baggage_brs: string;
  baggage_loaded_h5: string;
  remarks: string;
  security_supervisor: string;
}

const emptyTaskSheet = (): TaskSheetData => ({
  ...emptyAirFranceData(),
  flight_type: "",
  delay: "",
  shift_start_date: "",
  shift_end_date: "",
  shift_start: "",
  shift_end: "",
  sta: "",
  std: "",
  ata: "",
  atd: "",
  registration: "",
  route: "",
  cargo_observer_1: "",
  cargo_observer_2: "",
  hold_baggage_observer_1: "",
  hold_baggage_observer_2: "",
  gate_door_observer_1: "",
  aircraft_door_observer_1: "",
  aircraft_door_observer_2: "",
  aircraft_ramp_observer_1: "",
  aircraft_ramp_observer_2: "",
  catering_accompanied: "",
  cargo_accompanied: "",
  baggage_accompanied: "",
  total_baggage_brs: "",
  total_baggage_accepted: "",
  missing_baggage_brs: "",
  baggage_loaded_h5: "",
  remarks: "",
  security_supervisor: "",
});

interface DispatchRow {
  id: string;
  station?: string | null;
  airline?: string | null;
  flight_no?: string | null;
  flight_date: string;
  service_type?: string | null;
  staff_names: string;
  staff_count: number;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string;
  actual_end: string;
  contract_duration_hours: number;
  actual_duration_hours: number;
  overtime_hours: number;
  overtime_rate: number;
  base_fee: number;
  service_rate: number;
  overtime_charge: number;
  total_charge: number;
  status: string;
  notes: string;
  review_status: string;
  task_sheet_data?: Json;
  [key: string]: any;
}

interface Props {
  row: DispatchRow | null;
  onClose: () => void;
  onSave: (row: DispatchRow, taskSheet: TaskSheetData, options?: { close?: boolean }) => void | Promise<void>;
  registration?: string;
  route?: string;
  sta?: string;
  std?: string;
  ata?: string;
  atd?: string;
  skdType?: string;
  serviceType?: string;
  arrivalDate?: string;
  departureDate?: string;
  isNew?: boolean;
  /** When true, the form is rendered strictly read-only and Save / Save & Close
   *  act as an "Approve" action by calling onPendingApprove. Used by the
   *  Operations Pending Approval tab's View button. */
  pendingApprovalMode?: boolean;
  onPendingApprove?: () => void | Promise<void>;
  onPendingReject?: (comment: string) => void | Promise<void>;
}

const FLIGHT_TYPES = SKD_TYPES;
const ETHIOPIAN_FLIGHT_TYPES = ["PAX", "Cargo", "UN"] as const;
const isEthiopianAirlineName = (value: unknown) => /ethiopian/i.test(String(value || ""));

const inputCls = "text-sm border border-border rounded-md px-2.5 py-2 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary placeholder:text-muted-foreground w-full transition-colors";
const ethInnerFieldCls = "m-1 w-[calc(100%-0.5rem)] rounded-sm border border-border bg-card px-2 py-1 text-foreground outline-none focus:ring-1 focus:ring-primary";
const readOnlyCls = "text-sm border border-border rounded-md px-2.5 py-2 bg-muted/50 text-foreground w-full cursor-default";
const sectionHeaderCls = "bg-primary/10 text-primary font-bold text-sm px-3 py-2 rounded-t border border-primary/20";

interface SectionProps {
  title: string;
  icon?: React.ReactNode;
  accent?: string;
  iconBg?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}

function Section({ title, icon, accent = "text-primary", iconBg = "bg-primary/10", children, right }: SectionProps) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b bg-muted/30">
        <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${accent}`}>
          {icon && <span className={`h-6 w-6 rounded-md ${iconBg} flex items-center justify-center`}>{icon}</span>}
          {title}
        </h3>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Chip({ icon, label, value, accent = "bg-white/15" }: { icon?: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${accent} backdrop-blur-sm`}>
      {icon && <span className="opacity-90">{icon}</span>}
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-wider opacity-75">{label}</span>
        <span className="text-xs font-semibold">{value || "—"}</span>
      </div>
    </div>
  );
}

export default function SecurityTaskSheetDialog({ row, onClose, onSave, registration, route, sta, std, ata, atd, skdType, serviceType, arrivalDate, departureDate, isNew, pendingApprovalMode, onPendingApprove, onPendingReject }: Props) {
  const { activeChannel } = useChannel();
  const queryClient = useQueryClient();
  const isOperationsView = activeChannel === "operations";
  const reviewMode = (isOperationsView && !isNew) || !!pendingApprovalMode;
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [dialogRefreshing, setDialogRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Local override: once the Receivables user clicks "Save Security Charges"
  // successfully, immediately mark pipeline step 4 (Receivables) complete —
  // without waiting for the invoice to be issued/paid.
  const [receivablesChargesSaved, setReceivablesChargesSaved] = useState(false);
  const savingRef = useRef(false);
  const [sheet, setSheet] = useState<TaskSheetData>(emptyTaskSheet());
  const [editableRow, setEditableRow] = useState<DispatchRow | null>(null);
  const [contractId, setContractId] = useState<string>("");
  const [extraManpower, setExtraManpower] = useState<number>(0);
  const [rampVehicleTrips, setRampVehicleTrips] = useState<number>(0);
  const [shortNotice, setShortNotice] = useState<boolean>(false);
  const [returnToRamp, setReturnToRamp] = useState<boolean>(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Phase 3 write-cycle verifier — subscribe so the footer badge updates as
  // soon as the post-save re-fetch completes. DEV/DIAGNOSTIC only.
  const [lastWriteCycle, setLastWriteCycle] = useState<WriteCycleResult | null>(
    () => getLastWriteCycleResult(),
  );
  useEffect(() => {
    const unsub = subscribeWriteCycle(setLastWriteCycle);
    return () => { unsub(); };
  }, []);

  const { data: airlines = [] } = useQuery({
    queryKey: ["airlines-for-task-sheet"],
    queryFn: async () => {
      const { data } = await supabase.from("airlines").select("id,name,iata_code,code").order("name");
      return data || [];
    },
  });

  const { station: userStation, isStationScoped } = useUserStation();

  const { data: airportsListRaw = [] } = useQuery({
    queryKey: ["airports-for-task-sheet"],
    queryFn: async () => {
      const { data } = await supabase.from("airports").select("id,name,iata_code,city").order("iata_code");
      return data || [];
    },
  });
  const airportsList = useMemo(
    () => (isStationScoped && userStation
      ? airportsListRaw.filter((a: any) => (a.iata_code || a.name) === userStation)
      : airportsListRaw),
    [airportsListRaw, isStationScoped, userStation]
  );

  // Fetch security contracts for the current airline
  const { data: securityContracts = [] } = useQuery({
    queryKey: ["security-contracts", editableRow?.airline],
    queryFn: async () => {
      const { data } = await supabase
        .from("contracts")
        .select("id, contract_no, airline, currency, service_category, status")
        .in("service_category", ["Security", "Both"])
        .eq("status", "Active");
      if (!editableRow?.airline) return data || [];
      return (data || []).filter((c: any) => c.airline?.toLowerCase() === editableRow.airline?.toLowerCase());
    },
    enabled: !!editableRow?.airline,
  });

  // Fetch rates for the chosen contract
  const { data: contractRates = [] } = useQuery({
    queryKey: ["contract-rates", contractId],
    queryFn: async () => {
      if (!contractId) return [];
      const { data } = await supabase
        .from("contract_service_rates")
        .select("*")
        .eq("contract_id", contractId)
        .order("sort_order", { ascending: true });
      return (data || []) as SecurityRateRow[];
    },
    enabled: !!contractId,
  });

  // Initialize the form ONCE per opened row. Keying on row?.id + isNew prevents
  // the effect from re-firing on parent re-renders (e.g. background react-query
  // refetches), which previously wiped the user's unsaved edits to fields like
  // Flight No, Registration and Route — forcing them to re-type and save 2-3 times.
  const initializedRowKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!row) {
      initializedRowKeyRef.current = null;
      return;
    }
    const key = `${row.id || "new"}::${isNew ? "new" : "edit"}`;
    const prev = initializedRowKeyRef.current;
    if (prev === key) return;
    // GUARD: When the user clicks "Save" (not Save & Close) on a brand-new
    // report, the parent rebinds the dialog to the freshly-inserted row and
    // flips isNew → false. That transitions the key from "new::new" to
    // "<uuid>::edit" for the SAME open dialog session. Re-initializing here
    // would wipe the user's in-progress edits (Flight No / Reg / Route /
    // Observers / Times / etc.) by overwriting them with the just-saved
    // snapshot that may not yet include every field the user is still typing.
    // Preserve current sheet/editableRow state — just record the new key so
    // we stop re-initializing on subsequent prop refetches.
    if (prev && prev.endsWith("::new") && key.endsWith("::edit")) {
      initializedRowKeyRef.current = key;
      // Adopt the persisted id on editableRow so subsequent saves UPDATE
      // (not INSERT) the same record.
      setEditableRow(curr => curr ? { ...curr, id: row.id } as DispatchRow : curr);
      return;
    }
    initializedRowKeyRef.current = key;

    // Default arrival/departure date from clearance (flight schedule) when missing
    // Only seed dates from parent props when creating a NEW row. For existing
    // (saved) rows, respect the persisted value verbatim — including empty —
    // so a deliberately-blank Departure Date does not silently re-appear on
    // edit. (Issue: user leaves Departure Date empty → save → reopen → field
    // showed parent's departureDate prop again.)
    const saved = row.task_sheet_data as Record<string, any> | null;
    const hasSavedArrivalDate = !!saved && Object.prototype.hasOwnProperty.call(saved, "arrival_date");
    const hasSavedDepartureDate = !!saved && Object.prototype.hasOwnProperty.call(saved, "departure_date");
    const linkedScheduleArrivalDate = (row as any).fs_arrival_date ?? arrivalDate ?? "";
    const linkedScheduleDepartureDate = (row as any).fs_departure_date ?? departureDate ?? "";
    let seededArrivalDate = hasSavedArrivalDate
      ? String(saved.arrival_date || "")
      : ((row as any).flight_schedule_id ? String(linkedScheduleArrivalDate || "") : (row.flight_date || (isNew ? (arrivalDate || "") : "")));
    let seededDepartureDate = hasSavedDepartureDate
      ? String(saved.departure_date || "")
      : ((row as any).flight_schedule_id ? String(linkedScheduleDepartureDate || "") : ((row as any).departure_date || (isNew ? (departureDate || "") : "")));
    // Ethiopian form: the DATE field is saved into DEP DATE (departure_date).
    // When the schedule carries no departure date, keep the DATE field showing
    // the arrival date instead of an empty box.
    if (isEthiopianAirlineName(row.airline) && !seededDepartureDate) seededDepartureDate = seededArrivalDate;
    // Air France: one date is entered — mirror it into the other date field
    // so the records show the same date in both ARR DATE and DEP DATE.
    if (/air\s*france/i.test(String(row.airline || ""))) {
      if (!seededDepartureDate) seededDepartureDate = seededArrivalDate;
      if (!seededArrivalDate) seededArrivalDate = seededDepartureDate;
    }
    setEditableRow({
      ...row,
      flight_date: seededArrivalDate,
      departure_date: seededDepartureDate,
    } as DispatchRow);
    setReviewComment(row.review_comment || "");
    setContractId((row as any).contract_id || "");
    setExtraManpower((row as any).extra_manpower_count || 0);
    setRampVehicleTrips((row as any).ramp_vehicle_trips || 0);
    setShortNotice((row as any).short_notice || false);
    setReturnToRamp((row as any).return_to_ramp_with_load || false);
    // SSoT Phase A: master flight fields always come from the joined
    // flight_schedules row when present. Props passed by the parent are
    // used as a second fallback, and task_sheet_data mirror values are
    // the last resort (legacy rows without flight_schedule_id).
    const master = getMasterFields(row, (row as any).flight_schedules);
    const m = {
      registration: master.registration ?? registration ?? "",
      route:        master.route        ?? route        ?? "",
      sta:          master.sta          ?? sta          ?? "",
      std:          master.std          ?? std          ?? "",
      // Prefer the freshly-passed skdType prop (sourced from flight_schedules
      // via flightDetailsById) over master.skd_type — the latter can pull the
      // stale snapshot on dispatch_assignments.skd_type when the row isn't
      // joined to a live flight_schedules payload. This ensures Clearance SKD
      // amendments (e.g. Military → Schedule) appear immediately.
      skd_type:     (skdType && String(skdType).trim()) || master.skd_type || "",
    };
    if (saved && typeof saved === "object") {
      const restored = { ...emptyTaskSheet(), ...saved } as TaskSheetData;
      // Clearance SKD amendments are authoritative everywhere, including this
      // read-only Operations Pending Approval view. Do not let old task-sheet
      // flight_type/skd_type values keep showing Military after Clearance moved
      // the flight back to Schedule.
      // Ethiopian uses PAX / Cargo / UN in flight_type, which is independent of
      // the schedule SKD type — keep the operator's saved selection.
      if (m.skd_type && !isEthiopianAirline) restored.flight_type = m.skd_type;
      // Master/clearance values always win for sta/std (they're owned upstream).
      if (m.sta) restored.sta = m.sta;
      if (m.std) restored.std = m.std;
      if (!restored.ata && ata) restored.ata = ata;
      if (!restored.atd && atd) restored.atd = atd;
      // Shift Start/End: when the saved task sheet lacks these fields (e.g.
      // legacy rows or rows created via the Station Dispatch form which only
      // writes the actual_start/actual_end columns), fall back to those
      // columns so the edit form mirrors what the table/record view shows.
      if (!restored.shift_start && (row as any).actual_start) restored.shift_start = (row as any).actual_start;
      if (!restored.shift_end && (row as any).actual_end) restored.shift_end = (row as any).actual_end;
      // Registration & route: master wins when present; otherwise keep edited value.
      if (m.registration) restored.registration = m.registration;
      if (m.route) restored.route = m.route;
      setSheet(restored);
    } else {
      setSheet({
        ...emptyTaskSheet(),
        flight_type: m.skd_type || "",
        sta: m.sta || "", std: m.std || "", ata: ata || "", atd: atd || "",
        registration: m.registration || "", route: m.route || "",
        shift_start: (row as any).actual_start || "",
        shift_end: (row as any).actual_end || "",
        remarks: row.notes || "",
      });
    }
  }, [row?.id, isNew, row, skdType, sta, std, ata, atd, registration, route, arrivalDate, departureDate]);

  // Auto-pick the first matching contract when only one exists
  useEffect(() => {
    if (!contractId && securityContracts.length === 1) setContractId(securityContracts[0].id);
  }, [securityContracts, contractId]);

  const currentRow = isNew ? editableRow : (editableRow || row);
  const currentAirlineName = String((currentRow as any)?.airline || (currentRow as any)?.airline_name || "").trim();
  const isEthiopianAirline = isEthiopianAirlineName(currentAirlineName);
  const isAirFrance = isAirFranceAirline(currentAirlineName);
  const singleActualTime = /air\s*cairo|nesma|fly\s*plus/i.test(String(currentAirlineName || ""));
  const actualLabel = singleActualTime ? "00:00" : "00:00/00:00";
  const fmtActual = (v: string, prev: string) => singleActualTime ? formatTimeInput(v, prev) : formatDualTimeInput(v, prev);
  const flightTypeOptions = isEthiopianAirline ? ETHIOPIAN_FLIGHT_TYPES : FLIGHT_TYPES;
  const flightTypeLabel = isEthiopianAirline ? "Flight Type" : "Skd Type";
  const displayedFlightType = isEthiopianAirline ? (sheet.flight_type || skdType || "—") : (skdType || sheet.flight_type || "—");
  // Ethiopian: one of PAX / Cargo / UN must be selected before saving.
  const ethiopianMissingFlightType = isEthiopianAirline && !ETHIOPIAN_FLIGHT_TYPES.includes(sheet.flight_type as any);
  const dialogAirlineTitle = isNew
    ? "New"
    : /airlines|fly\s*plus/i.test(currentAirlineName)
      ? currentAirlineName
      : `${currentAirlineName} Airlines`;
  const supervisorTitle = isEthiopianAirline
    ? "Ethiopian Airlines (Duty Manager)"
    : `${currentAirlineName.toUpperCase()} — Security Supervisor on Duty`;

  // Look up invoice status for this flight so the Receivables pipeline step
  // only marks complete when the invoice is fully Paid.
  const dialogFlightRef = String((currentRow as any)?.flight_no || "").trim().toUpperCase();
  const { data: dialogInvoiceRows = [] } = useQuery({
    queryKey: ["invoice_for_pipeline", dialogFlightRef],
    queryFn: async () => {
      if (!dialogFlightRef) return [];
      const { data, error } = await supabase
        .from("invoices")
        .select("status")
        .eq("flight_ref", dialogFlightRef)
        .neq("status", "Cancelled");
      if (error) throw error;
      return data || [];
    },
    enabled: !!dialogFlightRef && !isNew,
  });
  const dialogInvoiceStatus: "none" | "issued" | "paid" = useMemo(() => {
    const rows = (dialogInvoiceRows as any[]) || [];
    if (rows.length === 0) return "none";
    const anyPaid = rows.some((r) => String(r.status || "").toLowerCase() === "paid");
    return anyPaid ? "paid" : "issued";
  }, [dialogInvoiceRows]);

  const dialogChargesSaved = useMemo(() => {
    const amount = Number((currentRow as any)?.total_security_charges || 0);
    const hasLines = Array.isArray((currentRow as any)?.charges_breakdown)
      ? (currentRow as any).charges_breakdown.length > 0
      : !!(currentRow as any)?.charges_breakdown;
    const status = String((currentRow as any)?.review_status || "").trim().toLowerCase();
    const operationsComplete = status === "approved" || status === "ready for billing";
    return receivablesChargesSaved || (operationsComplete && (amount > 0 || hasLines));
  }, [currentRow, receivablesChargesSaved]);

  // Phase 6.5: source service type from FS clearance_type when available.
  // The legacy editableRow.service_type column is being dropped in Phase 7;
  // FS (flight_schedules.clearance_type, surfaced via flightMeta on linked
  // dispatches and v_dispatch_with_flight) is the single source of truth.
  const effectiveServiceType = useMemo(() => {
    const fsClearance =
      (currentRow as any)?.flightMeta?.clearance_type ??
      (currentRow as any)?.fs_clearance_type ??
      null;
    return (
      fsClearance ||
      editableRow?.service_type ||
      serviceType ||
      currentRow?.service_type ||
      ""
    );
  }, [currentRow, editableRow?.service_type, serviceType]);

  // Map service_type → flight_type used in contract rate rows.
  // Contract rates use SECURITY_FLIGHT_TYPES: Arrival Security,
  // Departure Security, Maintenance Security, Turnaround.
  const flightTypeForCharges = useMemo(() => {
    if (isEthiopianAirline) {
      const ft = String(sheet.flight_type || "").toUpperCase();
      if (ft === "CARGO") return "Cargo";
      if (ft === "UN") return "UN";
    }
    const st = effectiveServiceType.toLowerCase();
    if (st.includes("turnaround")) return "Turnaround";
    if (st.includes("maintenance")) return "Maintenance Security";
    if (st.includes("departure")) return "Departure Security";
    if (st.includes("arrival")) return "Arrival Security";
    return sheet.flight_type || "Turnaround";
  }, [effectiveServiceType, sheet.flight_type, isEthiopianAirline]);

  const isAdhocFlight = useMemo(() => {
    const s = (skdType || (currentRow as any)?.skd_type || sheet.flight_type || "").toString().trim().toUpperCase();
    return s === "ADHOC";
  }, [skdType, currentRow, sheet.flight_type]);

  // Restrict Service Type by current Skd Type (Maintenance / ADHOC).
  const effectiveSkd = (skdType || (currentRow as any)?.skd_type || sheet.flight_type || "").toString();
  const allowedServiceTypes = useMemo(
    () => getAllowedServiceTypesForSkd(effectiveSkd) ?? SECURITY_CLEARANCE_TYPES,
    [effectiveSkd],
  );

  // Auto-correct service_type when restriction changes (FS-sourced check).
  useEffect(() => {
    if (!editableRow) return;
    if (isAirFrance) {
      // Air France / Air France Cargo: always Turnaround Security, no choice.
      if (editableRow.service_type !== "Turnaround Security") updateRow("service_type", "Turnaround Security");
      return;
    }
    if (allowedServiceTypes.length > 0 && !allowedServiceTypes.includes(effectiveServiceType)) {
      updateRow("service_type", allowedServiceTypes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedServiceTypes.join("|"), isAirFrance, !!editableRow]);

  // Auto-set SKD (flight_type) to "Maintenance" when effective service type is
  // Maintenance Security. Sourced from FS clearance_type (Phase 6.5).
  useEffect(() => {
    if (!editableRow) return;
    if (isEthiopianAirline) return;
    if (effectiveServiceType === "Maintenance Security" && sheet.flight_type !== "Maintenance") {
      setSheet(prev => ({ ...prev, flight_type: "Maintenance" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveServiceType]);

  useEffect(() => {
    if (!editableRow || !isEthiopianAirline) return;
    // No default selection: only clear a value that is not an Ethiopian flight type.
    setSheet(prev => ETHIOPIAN_FLIGHT_TYPES.includes(prev.flight_type as any)
      ? prev
      : { ...prev, flight_type: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editableRow?.airline, isEthiopianAirline, row?.id]);

  const computedCharges = useMemo(() => {
    if (!contractRates.length || !currentRow) return null;
    const gtHours = groundTimeHours(sheet.shift_start || sheet.ata || sheet.sta, sheet.shift_end || sheet.atd || sheet.std);
    return calculateSecurityCharges({
      airport: currentRow.station || "CAI",
      flightType: flightTypeForCharges,
      groundTimeHours: gtHours,
      shortNotice, extraManpower, rampVehicleTrips,
      returnToRampWithLoadChange: returnToRamp,
      isAdhoc: isAdhocFlight,
      rates: contractRates,
    });
  }, [contractRates, currentRow, flightTypeForCharges, sheet.shift_start, sheet.shift_end, sheet.ata, sheet.atd, sheet.sta, sheet.std, shortNotice, extraManpower, rampVehicleTrips, returnToRamp, isAdhocFlight]);

  const isReceivablesView = activeChannel === "receivables";

  // Pipeline gate: receivables editing is only allowed when the Station task
  // sheet is saved and Operations has approved. Clearance status is treated
  // as informational at the billing stage (consistent with the page-level
  // gate in SecurityServiceReports.tsx).
  const dispatchStatus = (currentRow as any)?.status || "";
  const reviewStatus = String((currentRow as any)?.review_status || "").toLowerCase();
  const stationDone = dispatchStatus === "Completed";
  const operationsDone = reviewStatus === "approved" || reviewStatus.includes("billing");
  const receivablesUnlocked = stationDone && operationsDone;
  const receivablesLocked = isReceivablesView && !receivablesUnlocked;

  // Station lock: once Operations has approved (or advanced to billing) a
  // report, the Station can no longer edit it. The Station regains edit
  // access only when Operations rejects the report and sends it back
  // (review_status = "Rejected") so the station can amend and resubmit.
  const isStationViewForLock = !isOperationsView && !isReceivablesView;
  const stationLockedAfterApproval = isStationViewForLock && !isNew && operationsDone;

  if (!row || !editableRow || !currentRow) return null;

  const updateRow = (field: string, value: any) => {
    setEditableRow(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const update = (field: keyof TaskSheetData, value: string) => {
    setSheet(prev => ({ ...prev, [field]: value }));
  };

  const handleRefresh = async () => {
    const id = (currentRow as any)?.id;
    if (!id || isNew) return;
    setDialogRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("dispatch_assignments")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      if (data) {
        setEditableRow(data as DispatchRow);
        queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] });
        queryClient.invalidateQueries({ queryKey: ["invoices_for_security_pipeline"] });
        queryClient.invalidateQueries({ queryKey: ["invoice_for_pipeline", dialogFlightRef] });
        toast({ title: "Refreshed", description: "Pipeline and record data updated." });
      }
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e.message, variant: "destructive" });
    } finally {
      setDialogRefreshing(false);
    }
  };

  const handleSave = async (closeAfter: boolean = true) => {
    // Guard against double-clicks / re-entry while a save is in flight.
    if (savingRef.current) return;
    const timer = startSaveTimer(
      `SecurityTaskSheet${isReceivablesView ? ":ReceivablesCharges" : isNew ? ":New" : ":Edit"}`,
    );
    timer.markClick();
    // In receivables view the task sheet is read-only — only the Security
    // Charges panel is editable. Skip task-sheet field validation so the
    // billing user can save contract/charges updates without re-entering
    // station data.
    if (!isReceivablesView) {
      // Determine which time fields are relevant based on flight type.
      // Arrival-only flights don't need STD/ATD; Departure-only flights don't need STA/ATA.
      const ft = (flightTypeForCharges || "").toLowerCase();
      const isArrivalOnly = ft.includes("arrival") && !ft.includes("departure");
      const isDepartureOnly = ft.includes("departure") && !ft.includes("arrival");

      const required: { key: keyof TaskSheetData; label: string }[] = [];
      if (!isEthiopianAirline && !isAirFrance) {
        required.push(
          { key: "shift_start", label: "Start Shift Time" },
          { key: "shift_end", label: "End Shift Time" },
        );
      }
      if (!isDepartureOnly) {
        required.push({ key: "sta", label: "STA" }, { key: "ata", label: "ATA" });
      }
      if (!isArrivalOnly) {
        required.push({ key: "std", label: "STD" }, { key: "atd", label: "ATD" });
      }
      const missing = required.filter(f => !String(sheet[f.key] || "").trim()).map(f => f.label);
      if (isNew) {
        if (!String(editableRow.airline || "").trim()) missing.unshift("Airline");
        // Air France form has no Skd Type field — skip its required check.
        if (!isAirFrance && !String(sheet.flight_type || "").trim()) missing.push(flightTypeLabel);
      }
      // Ethiopian: PAX / Cargo / UN is mandatory on every save (new or existing).
      if (!isNew && isEthiopianAirline && ethiopianMissingFlightType) missing.push("Flight Type (PAX / Cargo / UN)");
      if (missing.length > 0) {
        toast({
          title: "Missing required fields",
          description: `Please fill: ${missing.join(", ")}`,
          variant: "destructive",
        });
        timer.finish("validation_error");
        return;
      }
    }
    // Keep dates exactly as entered by the user. Do NOT cross-copy between
    // arrival_date (flight_date) and departure_date based on service type —
    // empty fields must remain empty so re-opening the form preserves the
    // original input (e.g. Departure-only with only Departure Date filled
    // should not back-fill Arrival Date, and vice versa).
    const merged: any = isNew ? editableRow : { ...(row || {}), ...(editableRow || {}) };
    if (isEthiopianAirline) {
      // Ethiopian: one DATE is entered — store it as both ARR and DEP date,
      // and always use Turnaround Security so the type never flips.
      const oneDate = merged.departure_date || merged.flight_date || "";
      if (oneDate) { merged.flight_date = oneDate; merged.departure_date = oneDate; merged.arrival_date = oneDate; }
      merged.service_type = "Turnaround Security";
    }
    if (isAirFrance) {
      merged.service_type = "Turnaround Security";
      // Air France: the user only edits Departure Date on the form, so prefer
      // it over the seeded flight_date (which defaults to today for new rows).
      const oneDate = merged.departure_date || merged.arrival_date || merged.flight_date || "";
      if (oneDate) { merged.flight_date = oneDate; merged.arrival_date = oneDate; merged.departure_date = oneDate; }
    }
    const enrichedRow = {
      ...merged,
      contract_id: contractId || null,
      extra_manpower_count: extraManpower,
      ramp_vehicle_trips: rampVehicleTrips,
      short_notice: shortNotice,
      return_to_ramp_with_load: returnToRamp,
      charges_breakdown: computedCharges?.lines || [],
      total_security_charges: computedCharges?.total || 0,
      charges_currency: computedCharges?.currency || "USD",
      ...(isReceivablesView ? { review_status: "Ready for Billing" } : {}),
    } as any;
    savingRef.current = true;
    setSaving(true);
    timer.markRequestSent();
    try {
      await timer.timeDb("onSave (parent persist)", () =>
        Promise.resolve(onSave(enrichedRow, sheet, { close: closeAfter })),
      );
      // Receivables "Save Security Charges" → mark pipeline step 4 complete
      // immediately for this dialog session (invoice may still be unpaid).
      if (isReceivablesView) {
        setReceivablesChargesSaved(true);
        setEditableRow(prev => prev ? {
          ...prev,
          review_status: "Ready for Billing",
          charges_breakdown: computedCharges?.lines || [],
          total_security_charges: computedCharges?.total || 0,
          charges_currency: computedCharges?.currency || "USD",
        } as DispatchRow : prev);
      }
      timer.finish("success");
    } catch (e) {
      timer.finish("error", { message: (e as any)?.message });
      throw e;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const formatDate = (d: string) => formatDateDMY(d) || "";

  const handlePrint = async () => {
    const localBase = (currentRow || editableRow || row) as DispatchRow | null;
    if (!localBase) return;

    // ---- DEEP FIX ----
    // Always pull the freshest record from the database before rendering the
    // download. The dialog's `row` prop and `sheet` state can drift from the
    // DB (parent cache may be stale right after a save, sync triggers may
    // have updated linked rows). We fetch the dispatch_assignments row AND
    // the linked flight_schedule so the printout exactly matches stored data.
    let dbRow: any = localBase;
    let dbSheet: any = sheet;
    let dbFlight: any = null;
    try {
      if (localBase.id && localBase.id !== "new") {
        const { data: freshDispatch } = await supabase
          .from("dispatch_assignments")
          .select("*")
          .eq("id", localBase.id)
          .maybeSingle();
        if (freshDispatch) {
          dbRow = freshDispatch;
          if (freshDispatch.task_sheet_data && typeof freshDispatch.task_sheet_data === "object") {
            dbSheet = { ...emptyTaskSheet(), ...(freshDispatch.task_sheet_data as any) };
          }
          if (freshDispatch.flight_schedule_id) {
            const { data: freshFlight } = await supabase
              .from("flight_schedules")
              .select("*")
              .eq("id", freshDispatch.flight_schedule_id)
              .maybeSingle();
            if (freshFlight) dbFlight = freshFlight;
          }
        }
      }
    } catch (err) {
      // Fall back silently to local state if the fetch fails.
      console.warn("[print] fresh fetch failed, using local state", err);
    }

    const baseRow = dbRow as DispatchRow;
    const v = dbSheet || {};
    // ---- ACTUAL-DATA SOURCING ----
    // Only render values that are actually persisted in the database. The task
    // sheet (task_sheet_data) is the user's saved truth; linked flight_schedule
    // is the secondary system-of-record. Stale dialog props are NEVER used as
    // fallbacks — they can pre-fill blanks the user explicitly left empty.
    const pick = (...vals: Array<unknown>): string => {
      for (const val of vals) {
        if (val === null || val === undefined) continue;
        const s = String(val).trim();
        if (s) return s;
      }
      return "";
    };

    // Resolve airline name: prefer linked airlines table, then flight_schedule, then dispatch row.
    const matchedAirline = airlines.find((a: any) =>
      dbFlight?.airline_id && a.id === dbFlight.airline_id,
    );
    const airlineName = pick(matchedAirline?.name, baseRow.airline, dbFlight?.handling_agent) || "—";
    const printIsEthiopian = isEthiopianAirlineName(airlineName);
    const printIsAirFrance = isAirFranceAirline(airlineName);
    const airlineHeader = /airlines|fly\s*plus/i.test(airlineName) ? airlineName : `${airlineName} Airlines`;
    const printFlightTypeOptions = printIsEthiopian ? ETHIOPIAN_FLIGHT_TYPES : FLIGHT_TYPES;
    const flightNoVal = pick(v.flight_no, dbFlight?.flight_no, baseRow.flight_no) || "—";
    // Ethiopian: the DATE field is persisted in DEP DATE (departure_date) —
    // print it from there, falling back to the legacy arrival date for rows
    // saved before the change.
    const flightDate = printIsEthiopian
      ? formatDate(pick(v.departure_date, dbFlight?.departure_date, baseRow.flight_date, dbFlight?.arrival_date))
      : formatDate(pick(baseRow.flight_date, dbFlight?.arrival_date, dbFlight?.departure_date));
    const reg = pick(v.registration, dbFlight?.registration, (baseRow as any).registration);
    const rt = pick(v.route, dbFlight?.route, (baseRow as any).route);
    const staVal = pick(v.sta, dbFlight?.sta);
    const stdVal = pick(v.std, dbFlight?.std);
    // ATA/ATD: ONLY from saved task_sheet_data. If the operator did not enter
    // an actual time, the field MUST render blank — do not fabricate from
    // scheduled times, dispatch shift times, or dialog props.
    const ataVal = pick(v.ata);
    const atdVal = pick(v.atd);
    const svcType = pick(baseRow.service_type, dbFlight?.clearance_type) || "—";
    // SSoT: flight_schedules.skd_type is authoritative. Prefer it over the
    // frozen task_sheet_data snapshot so Clearance amendments (Military → Schedule)
    // propagate to the printable task sheet and the readonly view.
    const skdVal = printIsEthiopian
      ? (pick(v.flight_type, skdType, dbFlight?.skd_type, (baseRow as any).skd_type) || "—")
      : (pick(skdType, dbFlight?.skd_type, v.flight_type, (baseRow as any).skd_type) || "—");

    const ftChecks = printFlightTypeOptions.map(ft =>
      `<td class="ft-cell" style="border:2px solid #222;padding:7px 10px;">${ft === skdVal ? "☒" : "☐"} ${ft}</td>`
    ).join("");

    const flightTypeCells = printIsEthiopian
      ? ftChecks
      : `<td colspan="${printFlightTypeOptions.length}" class="value-cell" style="font-size:13px;font-weight:600;">${skdVal}</td>`;
    const shiftRowHtml = printIsEthiopian ? "" : `
  <tr>
    <td class="label" colspan="2">ARR/DEP SHIFT START</td>
    <td colspan="2" class="mono">${v.shift_start || ""}</td>
    <td class="label">ARR/DEP SHIFT END</td>
    <td colspan="5" class="mono">${v.shift_end || ""}</td>
  </tr>`;
    const baggageInfoHtml = printIsEthiopian ? `
<table style="margin-bottom:10px;">
  <tr><td colspan="2" class="section">Baggage Information:</td></tr>
  <tr><td class="label" style="width:260px;">Total Baggage on BRS:</td><td class="value-cell">${v.total_baggage_brs || ""}</td></tr>
  <tr><td class="label">Total Baggage Accepted:</td><td class="value-cell">${v.total_baggage_accepted || ""}</td></tr>
  <tr><td class="label">Missing Baggage on BRS:</td><td class="value-cell">${v.missing_baggage_brs || ""}</td></tr>
  <tr><td class="label">Bags loaded in H5:</td><td class="value-cell">${v.baggage_loaded_h5 || ""}</td></tr>
</table>` : "";
    const accompaniedHtml = printIsEthiopian ? `
<table style="margin-bottom:10px;">
  <tr><td colspan="2" class="section">CARGO AND BAGGAGE ACCOMPANIED BY:</td></tr>
  <tr><td class="label" style="width:110px;">Cargo</td><td class="value-cell">${v.cargo_accompanied || ""}</td></tr>
  <tr><td class="label">Baggage</td><td class="value-cell">${v.baggage_accompanied || ""}</td></tr>
</table>` : `
<table style="margin-bottom:10px;">
  <tr><td colspan="2" class="section">CARGO AND BAGGAGE & CATERING ACCOMPANIED BY:</td></tr>
  <tr><td class="label" style="width:110px;">Catering</td><td class="value-cell">${v.catering_accompanied || ""}</td></tr>
  <tr><td class="label">Cargo</td><td class="value-cell">${v.cargo_accompanied || ""}</td></tr>
  <tr><td class="label">Baggage</td><td class="value-cell">${v.baggage_accompanied || ""}</td></tr>
</table>`;
    const printSupervisorTitle = printIsEthiopian
      ? "ETHIOPIAN AIRLINES (DUTY MANAGER)"
      : `${String(airlineName).toUpperCase()} (SECURITY SUPERVISOR ON-DUTY)`;
    const printVersion = printIsEthiopian ? "V.05 22Jan2023" : /fly\s*plus/i.test(airlineName) ? "V.01 01Nov2026" : "V.03 22Jan2023";

    const obsSection = (title: string, rows: [string, string][]) => {
      const rowsHtml = rows.map(([label, val]) =>
        `<tr><td class="obs-label">${label}</td><td class="obs-val">${val || ""}</td></tr>`
      ).join("");
      return `<table style="width:100%;border-collapse:collapse;margin-bottom:0;">
        <tr><td colspan="2" class="obs-title">${title}</td></tr>
        ${rowsHtml}</table>`;
    };

    if (printIsAirFrance) {
      const styles = getComputedStyle(document.documentElement);
      const tokens = ["document-paper", "document-ink", "document-border", "document-heading", "document-briefing"]
        .map(key => `--${key}:${styles.getPropertyValue(`--${key}`)};`).join("");
      let html = buildAirFrancePrintHtml({ ...v, flight_no: flightNoVal, date: flightDate, registration: reg, route: rt, sta: staVal, std: stdVal, ata: ataVal, atd: atdVal }, tokens, window.location.origin);
      const printWindow = window.open("", "_blank");
      if (!printWindow) return;
      // Embed logos in the print document so new-window restrictions and
      // delayed asset requests cannot omit branding from the saved PDF.
      const imageSources = Array.from(new DOMParser().parseFromString(html, "text/html").images).map(img => img.src);
      await Promise.all(imageSources.map(async src => {
        try {
          const response = await fetch(src);
          if (!response.ok) return;
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          html = html.replace(src, dataUrl);
        } catch { /* Leave the hosted URL as the fallback. */ }
      }));
      printWindow.document.write(html);
      printWindow.document.close();
      await Promise.all(Array.from(printWindow.document.images).map(img => img.decode().catch(() => undefined)));
      await printWindow.document.fonts.ready;
      printWindow.print();
      printWindow.close();
      return;
    }

    if (printIsEthiopian) {
      const linkLogoUrl = linkAeroTaskLogo.url.startsWith("/") ? `${window.location.origin}${linkAeroTaskLogo.url}` : linkAeroTaskLogo.url;
      const ethiopianLogoUrl = ethiopianAirlinesLogo.url.startsWith("/") ? `${window.location.origin}${ethiopianAirlinesLogo.url}` : ethiopianAirlinesLogo.url;
      const ethObserver = (title: string, rows: [string, string][], showStaff = true) => `
<table class="blk">
  <colgroup><col style="width:3.5%"><col style="width:96.5%"></colgroup>
  <tr><th colspan="2" class="sec">${title}</th></tr>
  <tr><td colspan="2" class="staff">${showStaff ? "Staff Name" : "&nbsp;"}</td></tr>
  ${rows.map(([label, val]) => `<tr><td class="idx">${label}</td><td class="val">${val || ""}</td></tr>`).join("")}
</table>`;
      const box = (ft: string) => `<span class="box">${ft === skdVal ? "✓" : ""}</span>`;
      const ethHtml = `<!DOCTYPE html><html><head>
<title>ETH Security Task Sheet - ${flightNoVal}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  html, body { background:#fff; color:#000; font-family: Cambria, Georgia, 'Times New Roman', serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { width:210mm; height:296mm; margin:0 auto; padding:9mm 15mm 8mm 13mm; position:relative; overflow:hidden; }
  .logos { display:flex; align-items:flex-start; justify-content:space-between; height:28mm; }
  .link-logo { width:24mm; height:auto; margin-left:2mm; }
  .eth-logo { width:50mm; height:auto; margin-top:2mm; }
  .title { text-align:center; font-size:12pt; font-weight:700; margin:6mm 0 4mm; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  th, td { border:1px dotted #000; padding:0.6mm 1.2mm; font-size:10pt; line-height:1.15; vertical-align:middle; text-align:left; font-weight:700; }
  .blk { margin-bottom:3.2mm; }
  .main { margin-bottom:3.2mm; }
  .blue, .sec { background:#c6d9f1; }
  .center { text-align:center; }
  .sec { font-size:10.5pt; }
  .staff { text-align:center; height:5.5mm; }
  .idx { width:4mm; text-align:center; font-size:9pt; height:5.2mm; }
  .val { font-weight:600; }
  .h { height:5mm; }
  .box { display:inline-block; width:3mm; height:3mm; border:1px solid #000; margin-left:1px; vertical-align:-0.4mm; font-size:8pt; line-height:2.6mm; text-align:center; }
  .ft { white-space:nowrap; font-size:10pt; }
  .ft span.lbl { margin-right:5mm; }
  .important { font-size:8pt; font-weight:400; margin:-2.6mm 0 3mm; }
  .important b { color:#c00000; }
  .red { color:#c00000; border:0; padding:0.4mm 0; }
  .redrow td { border:0; }
  .bag { margin-bottom:3.2mm; border-left:1px dotted #000; border-right:1px dotted #000; border-bottom:1px dotted #000; }
  .bag th { border:1px dotted #000; }
  .bag .redv { border:0; font-weight:600; }
  .acc-title { font-size:9pt; }
  .orange { background:#e46c0a; color:#fff; font-size:11pt; padding:1mm 1.2mm; }
  .footer { position:absolute; left:23mm; right:23mm; bottom:9mm; display:flex; justify-content:space-between; font-family: Arial, sans-serif; font-size:8pt; font-weight:400; }
  @page { size:A4 portrait; margin:0; }
  @media print { .page { margin:0; } }
</style>
</head><body><div class="page">
  <div class="logos">
    <img class="link-logo" src="${linkLogoUrl}" alt="Link Aero" />
    <img class="eth-logo" src="${ethiopianLogoUrl}" alt="Ethiopian" />
  </div>
  <div class="title">ETHIOPIAN AIRLINES SECURITY TASK SHEET</div>
  <table class="main">
    <colgroup><col style="width:5%"><col style="width:18%"><col style="width:5%"><col style="width:24%"><col style="width:14%"><col style="width:34%"></colgroup>
    <tr class="blue"><td colspan="2">Flight Number</td><td colspan="2" class="center">DATE</td><td>Registration</td><td class="center">Route</td></tr>
    <tr class="h"><td colspan="2" class="center">${flightNoVal && flightNoVal !== "—" ? flightNoVal : "ET /"}</td><td colspan="2" class="center">${flightDate}</td><td class="center">${reg}</td><td class="center">${rt}</td></tr>
    <tr><td class="blue">STA</td><td>${staVal}</td><td class="blue">ATA</td><td class="center">${ataVal || "/"}</td><td class="blue">Flight Type</td><td class="ft">${printFlightTypeOptions.map(ft => `<span class="lbl">${ft.toUpperCase()}${box(ft)}</span>`).join("")}</td></tr>
    <tr><td class="blue">STD</td><td>${stdVal}</td><td class="blue">ATD</td><td class="center">${atdVal || "/"}</td><td class="blue">Delay</td><td>${v.delay || ""}</td></tr>
  </table>
  ${ethObserver("Cargo Observer", [["1", v.cargo_observer_1]])}
  ${ethObserver("Hold Baggage Observer", [["1", v.hold_baggage_observer_1], ["2", v.hold_baggage_observer_2]])}
  ${ethObserver("Aircraft Door Observer", [["1", v.aircraft_door_observer_1], ["2", v.aircraft_door_observer_2]], false)}
  <div class="important"><b>Important//</b>Arrive at gate 20 minutes prior to aircraft arrival.</div>
  ${ethObserver("Aircraft Ramp Observer", [["1", v.aircraft_ramp_observer_1], ["2", v.aircraft_ramp_observer_2]])}
  <table class="bag">
    <colgroup><col style="width:40%"><col style="width:60%"></colgroup>
    <tr><th colspan="2" class="sec">&nbsp;Baggage Information:</th></tr>
    <tr class="redrow"><td class="red">Total Baggage On &nbsp;BRS:</td><td class="redv">${v.total_baggage_brs || ""}</td></tr>
    <tr class="redrow"><td class="red">Total Baggage Accepted:</td><td class="redv">${v.total_baggage_accepted || ""}</td></tr>
    <tr class="redrow"><td class="red">Missing &nbsp;Baggage On BRS:</td><td class="redv">${v.missing_baggage_brs || ""}</td></tr>
    <tr class="redrow"><td class="red">BAGS LOADED IN H5</td><td class="redv">${v.baggage_loaded_h5 || ""}</td></tr>
  </table>
  <table class="blk">
    <colgroup><col style="width:17%"><col style="width:83%"></colgroup>
    <tr><th colspan="2" class="sec acc-title">CARGO AND BAGGAGE ACCOMPANIED BY:</th></tr>
    <tr><td colspan="2" class="staff">Staff Name</td></tr>
    <tr><td class="center h">Cargo</td><td class="val">${v.cargo_accompanied || ""}</td></tr>
    <tr><td class="center h">Baggage</td><td class="val">${v.baggage_accompanied || ""}</td></tr>
  </table>
  <table class="blk" style="margin-top:5mm;">
    <tr><th class="orange">Ethiopian Airlines&nbsp; (Duty Manager)</th></tr>
    <tr><td class="val h">${v.security_supervisor || ""}</td></tr>
  </table>
  <div class="footer"><span>ETH Security Task Sheet</span><span>V.05 22Jan2023</span></div>
</div></body></html>`;
      const printWindow = window.open("", "_blank");
      if (!printWindow) return;
      printWindow.document.write(ethHtml);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 400);
      return;
    }

    const html = `<!DOCTYPE html><html><head>
<title>${airlineName} Security Task Sheet - ${flightNoVal}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #000; padding: 30px 40px; }
  table { width:100%; border-collapse:collapse; }
  td, th { border:2px solid #222; padding:7px 10px; text-align:left; font-size:13px; }
  .title { text-align:center; font-size:18px; font-weight:900; text-transform:uppercase; letter-spacing:2px; margin-bottom:16px; padding:12px 0; border-bottom:3px solid #000; }
  .label { background:#e8e8e8; font-weight:bold; font-size:13px; }
  .section { background:#b8c8e0; font-weight:bold; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; }
  .obs-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:10px 0; }
  .footer { display:flex; justify-content:space-between; font-size:11px; color:#444; border-top:2px solid #666; padding-top:10px; margin-top:24px; font-weight:600; }
  .header-row th { background:#c0c8d8; font-weight:bold; font-size:13px; text-transform:uppercase; letter-spacing:0.3px; }
  .value-cell { font-size:14px; font-weight:600; min-height:28px; }
  .mono { font-family: 'Courier New', Courier, monospace; font-weight:700; font-size:14px; letter-spacing:1px; }
  .ft-cell { text-align:center; font-size:13px; font-weight:600; }
  .obs-title { border:2px solid #222; padding:6px 10px; font-weight:bold; background:#b8c8e0; font-size:13px; text-transform:uppercase; }
  .obs-label { border:2px solid #222; padding:6px 10px; width:35px; text-align:center; font-weight:bold; background:#e8e8e8; font-size:14px; }
  .obs-val { border:2px solid #222; padding:6px 10px; font-size:14px; font-weight:500; min-height:28px; }
  .remark-cell { min-height:60px; padding:10px; font-size:14px; line-height:1.5; }
  @media print {
    body { padding:15px 25px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { margin:12mm; }
  }
</style>
</head><body>

<div class="title">${airlineHeader} Security Task Sheet</div>

<table style="margin-bottom:10px;">
  <tr class="header-row">
    <th>Flight Number</th>
    <th>Date</th>
    <th>Registration</th>
    <th>Route</th>
  </tr>
  <tr>
    <td class="value-cell" style="font-weight:800;font-size:15px;">${flightNoVal}</td>
    <td class="value-cell">${flightDate}</td>
    <td class="value-cell mono">${reg}</td>
    <td class="value-cell">${rt}</td>
  </tr>
</table>

<table style="margin-bottom:10px;">
  <tr>
    <td class="label" style="width:55px;">STA</td>
    <td class="mono" style="width:75px;">${staVal}</td>
    <td class="label" style="width:55px;">ATA</td>
    <td class="mono" style="width:75px;">${ataVal}</td>
     <td class="label" style="width:85px;">Flight Type</td>
     ${flightTypeCells}
  </tr>
  <tr>
    <td class="label">STD</td>
    <td class="mono">${stdVal}</td>
    <td class="label">ATD</td>
    <td class="mono">${atdVal}</td>
    <td class="label">Service Type</td>
    <td colspan="${printFlightTypeOptions.length}" class="value-cell" style="font-size:13px;font-weight:600;">${svcType}</td>
  </tr>
  <tr>
    <td class="label" colspan="2"></td>
    <td colspan="2"></td>
    <td class="label">Delay</td>
    <td colspan="${printFlightTypeOptions.length}" class="value-cell">${v.delay || ""}</td>
  </tr>
  ${shiftRowHtml}
</table>

<div class="obs-grid">
  ${obsSection("Cargo Observer", [["1", v.cargo_observer_1], ["2", v.cargo_observer_2]])}
  ${obsSection("Hold Baggage Observer", [["1", v.hold_baggage_observer_1], ["2", v.hold_baggage_observer_2]])}
  ${obsSection("Gate Door Observer", [["1", v.gate_door_observer_1]])}
  ${obsSection("Aircraft Door Observer", [["1", v.aircraft_door_observer_1], ["2", v.aircraft_door_observer_2]])}
  ${obsSection("Aircraft Ramp Observer", [["1", v.aircraft_ramp_observer_1]])}
</div>

${baggageInfoHtml}
${accompaniedHtml}

<table style="margin-bottom:10px;">
  <tr><td class="section">REMARKS</td></tr>
  <tr><td class="remark-cell">${v.remarks || ""}</td></tr>
</table>

<table style="margin-bottom:10px;">
  <tr><td class="section">${printSupervisorTitle}</td></tr>
  <tr><td class="value-cell" style="padding:10px;">${v.security_supervisor || ""}</td></tr>
</table>

<div class="footer">
  <span>${airlineName} Security Task Sheet</span>
  <span>${printVersion}</span>
</div>

</body></html>`;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 400);
  };

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[96vw] xl:max-w-7xl max-h-[92vh] overflow-y-auto p-0 gap-0 [&>button.absolute]:hidden">
        {/* Gradient hero header */}
        <div className="relative bg-gradient-to-r from-primary via-primary to-primary/80 text-primary-foreground px-6 py-5 overflow-hidden">
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, white 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
          <div className="relative flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                  <Shield size={20} />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold uppercase tracking-wide leading-tight">
                    {dialogAirlineTitle} Security Task Sheet
                  </DialogTitle>
                  <p className="text-[11px] uppercase tracking-widest opacity-80 mt-0.5">
                    {isNew ? "Create new report" : "Edit report"} • {currentRow.station || "—"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip icon={<Plane size={13} />} label="Flight" value={currentRow.flight_no || "—"} />
                <Chip icon={<Clock size={13} />} label="Date" value={formatDate(currentRow.flight_date)} />
                <Chip label="Reg" value={sheet.registration || registration || "—"} />
                <Chip label="Service" value={editableRow.service_type || serviceType || currentRow.service_type || "—"} />
              </div>
            </div>
          </div>
        </div>

        {/* Pipeline stepper - hidden in print/download */}
        <div className="px-6 py-3 border-b bg-muted/20 flex items-center justify-center print:hidden no-print">
          <div className="flex items-center gap-3">
            <PipelineStepper
              currentStage={derivePipelineStage({
                isLinked: !isNew,
                reviewStatus: (currentRow as any)?.review_status || "pending",
                dispatchStatus: (currentRow as any)?.status || "Pending",
                clearanceStatus: (currentRow as any)?.clearance_status,
                channel: activeChannel,
                formView: true,
                invoiceStatus: dialogInvoiceStatus,
                chargesSaved: dialogChargesSaved,
              })}
              completedStages={derivePipelineCompletedStages({
                isLinked: !isNew,
                reviewStatus: (currentRow as any)?.review_status || "pending",
                dispatchStatus: (currentRow as any)?.status || "Pending",
                clearanceStatus: (currentRow as any)?.clearance_status,
                invoiceStatus: dialogInvoiceStatus,
                chargesSaved: dialogChargesSaved,
              })}
              invoiceStatus={dialogInvoiceStatus}
            />
            {!isNew && (
              <button
                onClick={handleRefresh}
                disabled={dialogRefreshing}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                title="Refresh pipeline"
              >
                <RefreshCw size={12} className={dialogRefreshing ? "animate-spin" : ""} /> Refresh
              </button>
            )}
          </div>
        </div>

        {reviewMode && (
          <div className="px-6 py-2.5 border-b bg-warning/10 border-warning/30 flex items-center gap-2 text-warning-foreground text-xs">
            <Eye size={14} className="text-warning" />
            <span className="font-semibold uppercase tracking-wider text-warning">Review Mode</span>
            <span className="text-muted-foreground">— Form is read-only. Approve or reject the report below.</span>
          </div>
        )}

        {/* Rejection reason banner — shown to station when Operations rejected the report */}
        {!isNew && String((currentRow as any)?.review_status || "").toLowerCase() === "rejected" && (
          <div className="px-6 py-3 border-b bg-destructive/10 border-destructive/30 no-print">
            <div className="flex items-start gap-2.5">
              <XCircle size={18} className="text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold uppercase tracking-wider text-destructive">Report Rejected by Operations</span>
                  {(currentRow as any)?.reviewed_by && (
                    <span className="text-[11px] text-muted-foreground">
                      by <span className="font-semibold text-foreground">{(currentRow as any).reviewed_by}</span>
                      {(currentRow as any)?.reviewed_at && ` • ${new Date((currentRow as any).reviewed_at).toLocaleString()}`}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-sm text-foreground">
                  <span className="font-semibold text-destructive">Reason: </span>
                  {(currentRow as any)?.review_comment?.trim()
                    ? (currentRow as any).review_comment
                    : <span className="italic text-muted-foreground">No reason was provided.</span>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">Please review the comments above, correct the report, and re-submit for review.</p>
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-4 space-y-4 bg-muted/10" ref={printRef}>
        {isReceivablesView && (
          <div className="rounded-lg border border-info/40 bg-info/10 px-3 py-2.5 text-xs text-foreground flex items-start gap-2 no-print">
            <Eye size={14} className="text-info mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold uppercase tracking-wider text-info">Receivables view</span>
              {" "}— The task sheet below is read-only. Only the <span className="font-semibold">Security Charges</span> section can be edited to compute and finalize the billable amount for this flight.
            </span>
          </div>
        )}
        {stationLockedAfterApproval && (
          <div className="rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-xs text-foreground flex items-start gap-2 no-print mb-3">
            <Eye size={14} className="text-success mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold uppercase tracking-wider text-success">Approved by Operations</span>
              {" "}— This report has been approved and is locked for editing at the Station. If changes are needed, ask Operations to reject the report so it returns here for amendment.
            </span>
          </div>
        )}
        <fieldset disabled={reviewMode || isReceivablesView || stationLockedAfterApproval} className="contents">
          {isAirFrance ? (
            <>
              <AirFranceHeader />
              <Section title="Assignment" icon={<Plane size={14} />}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div><label htmlFor="af-airline" className="mb-1 block text-xs font-bold">Airline</label><select id="af-airline" className={inputCls} value={editableRow.airline || ""} disabled={!isNew} onChange={e => updateRow("airline", e.target.value)}>{airlines.map((a: any) => <option key={a.id} value={a.name}>{a.name}</option>)}</select></div>
                  <div><label htmlFor="af-station" className="mb-1 block text-xs font-bold">Station</label><select id="af-station" className={inputCls} value={(isStationScoped && userStation) ? userStation : (editableRow.station || "")} disabled={!isNew || isStationScoped} onChange={e => updateRow("station", e.target.value)}>{airportsList.map((a: any) => <option key={a.id} value={a.iata_code || a.name}>{a.iata_code || a.name}</option>)}</select></div>
                  <div><label htmlFor="af-service-type" className="mb-1 block text-xs font-bold">Service Type</label><input id="af-service-type" className={`${inputCls} bg-muted`} value="Turnaround Security" readOnly /></div>
                </div>
              </Section>
              <AirFranceTaskSheet sheet={sheet as TaskSheetData & Record<string, string>} flight={editableRow} update={update} updateFlight={updateRow} dateDisplay={isoToDmy}
                dateInput={(value, previous) => { const formatted = formatDateDmyInput(value, isoToDmy(previous)); return dmyToIso(formatted) || formatted; }}
                timeInput={formatTimeInput} dualTimeInput={formatDualTimeInput} />
            </>
          ) : isEthiopianAirline ? (
            <div className="mx-4 mb-4 rounded-lg border bg-background p-4 shadow-sm md:mx-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <img src={linkAeroTaskLogo.url} alt="Link Aero" className="h-20 w-auto object-contain" />
                <img src={ethiopianAirlinesLogo.url} alt="Ethiopian Airlines" className="h-16 w-auto object-contain" />
              </div>
              <h3 className="mb-4 text-center text-lg font-black uppercase text-foreground">Ethiopian Airlines Security Task Sheet</h3>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] border-collapse text-sm">
                  <tbody className="[&_td]:border [&_td]:border-border [&_td]:p-0 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-black [&_th]:text-foreground">
                    <tr>
                      <th colSpan={2}>Flight Number</th>
                      <th colSpan={2}>DATE</th>
                      <th>Registration</th>
                      <th colSpan={3}>Route</th>
                    </tr>
                    <tr>
                      <td colSpan={2}><input className={`${ethInnerFieldCls} font-bold uppercase`} value={editableRow.flight_no || ""} onChange={e => updateRow("flight_no", e.target.value.toUpperCase())} /></td>
                      <td colSpan={2}><input className={`${ethInnerFieldCls} font-mono`} value={isoToDmy(editableRow.departure_date || "")} onChange={e => { const formatted = formatDateDmyInput(e.target.value, isoToDmy(editableRow.departure_date || "")); const iso = dmyToIso(formatted); updateRow("departure_date", iso || formatted); }} maxLength={10} /></td>
                      <td><input className={`${ethInnerFieldCls} font-mono uppercase`} value={sheet.registration} onChange={e => update("registration", e.target.value.toUpperCase())} /></td>
                      <td colSpan={3}><input className={`${ethInnerFieldCls} uppercase`} value={sheet.route} onChange={e => update("route", e.target.value.toUpperCase())} /></td>
                    </tr>
                    <tr>
                      <th className="w-16">STA</th>
                      <td><input className={`${ethInnerFieldCls} font-mono font-bold`} value={sheet.sta} onChange={e => update("sta", formatTimeInput(e.target.value, sheet.sta))} maxLength={5} /></td>
                      <th className="w-16">ATA</th>
                      <td><input className={`${ethInnerFieldCls} font-mono`} value={sheet.ata} onChange={e => update("ata", formatDualTimeInput(e.target.value, sheet.ata))} maxLength={11} /></td>
                      <th>Flight Type{ethiopianMissingFlightType && <span className="block text-[10px] font-bold text-destructive">Select one to enable Save</span>}</th>
                      {flightTypeOptions.map(ft => (
                        <td key={ft} className="px-2 py-1.5 font-black text-foreground">
                          <label className="flex items-center justify-center gap-2">
                            <span>{ft}</span>
                            <input type="checkbox" checked={sheet.flight_type === ft} onChange={() => update("flight_type", ft)} className="h-4 w-4" />
                          </label>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>STD</th>
                      <td><input className={`${ethInnerFieldCls} font-mono font-bold`} value={sheet.std} onChange={e => update("std", formatTimeInput(e.target.value, sheet.std))} maxLength={5} /></td>
                      <th>ATD</th>
                      <td><input className={`${ethInnerFieldCls} font-mono`} value={sheet.atd} onChange={e => update("atd", formatDualTimeInput(e.target.value, sheet.atd))} maxLength={11} /></td>
                      <th>Delay</th>
                      <td colSpan={3}><input className={ethInnerFieldCls} value={sheet.delay} onChange={e => update("delay", e.target.value)} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-3 space-y-3">
                <div className="border border-border">
                  <div className="bg-muted px-2 py-1.5 text-base font-black text-foreground">Cargo Observer</div>
                  <div className="border-t border-border px-2 py-1.5 text-center font-black text-foreground">Staff Name</div>
                  <div className="grid grid-cols-[42px_1fr] border-t border-border"><div className="border-r border-border px-3 py-1.5 font-bold">1</div><input className={ethInnerFieldCls} value={sheet.cargo_observer_1} onChange={e => update("cargo_observer_1", e.target.value)} /></div>
                </div>

                <div className="border border-border">
                  <div className="bg-muted px-2 py-1.5 text-base font-black text-foreground">Hold Baggage Observer</div>
                  <div className="border-t border-border px-2 py-1.5 text-center font-black text-foreground">Staff Name</div>
                  <div className="grid grid-cols-[42px_1fr] border-t border-border"><div className="border-r border-border px-3 py-1.5 font-bold">1</div><input className={ethInnerFieldCls} value={sheet.hold_baggage_observer_1} onChange={e => update("hold_baggage_observer_1", e.target.value)} /></div>
                  <div className="grid grid-cols-[42px_1fr] border-t border-border"><div className="border-r border-border px-3 py-1.5 font-bold">2</div><input className={ethInnerFieldCls} value={sheet.hold_baggage_observer_2} onChange={e => update("hold_baggage_observer_2", e.target.value)} /></div>
                </div>

                <div className="border border-border">
                  <div className="bg-muted px-2 py-1.5 text-base font-black text-foreground">Aircraft Door Observer</div>
                  <div className="grid grid-cols-[42px_1fr] border-t border-border"><div className="border-r border-border px-3 py-1.5 font-bold">1</div><input className={ethInnerFieldCls} value={sheet.aircraft_door_observer_1} onChange={e => update("aircraft_door_observer_1", e.target.value)} /></div>
                  <div className="grid grid-cols-[42px_1fr] border-t border-border"><div className="border-r border-border px-3 py-1.5 font-bold">2</div><input className={ethInnerFieldCls} value={sheet.aircraft_door_observer_2} onChange={e => update("aircraft_door_observer_2", e.target.value)} /></div>
                </div>

                <div className="text-sm text-foreground"><span className="font-black text-destructive">Important//</span>Arrive at gate 20 minutes prior to aircraft arrival.</div>

                <div className="border border-border">
                  <div className="bg-muted px-2 py-1.5 text-base font-black text-foreground">Aircraft Ramp Observer</div>
                  <div className="border-t border-border px-2 py-1.5 text-center font-black text-foreground">Staff Name</div>
                  <div className="grid grid-cols-[42px_1fr] border-t border-border"><div className="border-r border-border px-3 py-1.5 font-bold">1</div><input className={ethInnerFieldCls} value={sheet.aircraft_ramp_observer_1} onChange={e => update("aircraft_ramp_observer_1", e.target.value)} /></div>
                  <div className="grid grid-cols-[42px_1fr] border-t border-border"><div className="border-r border-border px-3 py-1.5 font-bold">2</div><input className={ethInnerFieldCls} value={sheet.aircraft_ramp_observer_2} onChange={e => update("aircraft_ramp_observer_2", e.target.value)} /></div>
                </div>

                <div className="border border-border">
                  <div className="bg-muted px-2 py-1.5 text-base font-black text-foreground">Baggage Information:</div>
                  <div className="grid grid-cols-[260px_1fr] border-t border-border"><label className="px-2 py-1.5 font-black text-destructive">Total Baggage On BRS:</label><input className={ethInnerFieldCls} value={sheet.total_baggage_brs} onChange={e => update("total_baggage_brs", e.target.value)} /></div>
                  <div className="grid grid-cols-[260px_1fr] border-t border-border"><label className="px-2 py-1.5 font-black text-destructive">Total Baggage Accepted:</label><input className={ethInnerFieldCls} value={sheet.total_baggage_accepted} onChange={e => update("total_baggage_accepted", e.target.value)} /></div>
                  <div className="grid grid-cols-[260px_1fr] border-t border-border"><label className="px-2 py-1.5 font-black text-destructive">Missing Baggage On BRS:</label><input className={ethInnerFieldCls} value={sheet.missing_baggage_brs} onChange={e => update("missing_baggage_brs", e.target.value)} /></div>
                  <div className="grid grid-cols-[260px_1fr] border-t border-border"><label className="px-2 py-1.5 font-black text-destructive">BAGS LOADED IN H5</label><input className={ethInnerFieldCls} value={sheet.baggage_loaded_h5} onChange={e => update("baggage_loaded_h5", e.target.value)} /></div>
                </div>

                <div className="border border-border">
                  <div className="bg-muted px-2 py-1.5 text-base font-black uppercase text-foreground">Cargo and Baggage Accompanied By:</div>
                  <div className="border-t border-border px-2 py-1.5 text-center font-black text-foreground">Staff Name</div>
                  <div className="grid grid-cols-[220px_1fr] border-t border-border"><label className="px-2 py-1.5 text-center font-black text-foreground">Cargo</label><input className={ethInnerFieldCls} value={sheet.cargo_accompanied} onChange={e => update("cargo_accompanied", e.target.value)} /></div>
                  <div className="grid grid-cols-[220px_1fr] border-t border-border"><label className="px-2 py-1.5 text-center font-black text-foreground">Baggage</label><input className={ethInnerFieldCls} value={sheet.baggage_accompanied} onChange={e => update("baggage_accompanied", e.target.value)} /></div>
                </div>

                <div className="border border-border">
                  <div className="bg-warning px-2 py-2 text-lg font-black text-warning-foreground">Ethiopian Airlines (Duty Manager)</div>
                  <input className={`${ethInnerFieldCls} py-2`} value={sheet.security_supervisor} onChange={e => update("security_supervisor", e.target.value)} />
                </div>
              </div>

              <div className="mt-8 flex justify-between px-8 text-sm text-muted-foreground">
                <span>ETH Security Task Sheet</span>
                <span>V.05 22Jan2023</span>
              </div>
            </div>
          ) : (
          <>
          {/* Assignment — Airline & Station (editable for new) + Skd Type */}
          <Section title="Assignment" icon={<Plane size={14} />} accent="text-primary" iconBg="bg-primary/10">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {isNew ? (
                <>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Airline <span className="text-destructive">*</span></label>
                    <select className={inputCls} value={editableRow.airline} onChange={e => updateRow("airline", e.target.value)}>
                      <option value="">Select Airline</option>
                      {airlines.map((a: any) => (
                        <option key={a.id} value={a.name}>{a.name} ({a.iata_code || a.code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Station</label>
                    <select className={inputCls} value={(isStationScoped && userStation) ? userStation : editableRow.station} disabled={isStationScoped} onChange={e => updateRow("station", e.target.value)}>
                      <option value="">Select Station</option>
                      {airportsList.map((a: any) => (
                        <option key={a.id} value={a.iata_code || a.name}>
                          {a.iata_code ? `${a.iata_code} — ${a.name}` : a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Service Type</label>
                    <select className={inputCls} value={editableRow.service_type} onChange={e => updateRow("service_type", e.target.value)}>
                      {SECURITY_CLEARANCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Airline</label>
                    <input className={readOnlyCls} value={editableRow.airline || "—"} readOnly disabled />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Station</label>
                    <input className={readOnlyCls} value={editableRow.station || "—"} readOnly disabled />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Service Type</label>
                    <select
                      className={inputCls}
                      value={editableRow.service_type || serviceType || ""}
                      onChange={e => updateRow("service_type", e.target.value)}
                    >
                      <option value="">Select…</option>
                      {SECURITY_CLEARANCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">{flightTypeLabel} {isNew && <span className="text-destructive">*</span>}</label>
                {isNew || isEthiopianAirline ? (
                  <select className={inputCls} value={sheet.flight_type} onChange={e => update("flight_type", e.target.value)}>
                    <option value="">Select...</option>
                    {flightTypeOptions.map(ft => <option key={ft} value={ft}>{ft}</option>)}
                  </select>
                ) : (
                  <input className={readOnlyCls} value={displayedFlightType} readOnly disabled />
                )}
              </div>
            </div>
          </Section>

          {/* Flight Info */}
          <Section title="Flight Information" icon={<Plane size={14} />} accent="text-primary" iconBg="bg-primary/10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Flight No</label>
                <input
                  className={inputCls + " uppercase font-bold"}
                  value={editableRow.flight_no || ""}
                  onChange={e => updateRow("flight_no", e.target.value.toUpperCase())}
                  placeholder="Flight No"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Arrival Date</label>
                <input
                  className={inputCls + " font-mono"}
                  value={isoToDmy(editableRow.flight_date || "")}
                  onChange={e => {
                    const formatted = formatDateDmyInput(e.target.value, isoToDmy(editableRow.flight_date || ""));
                    const iso = dmyToIso(formatted);
                    // Store ISO when valid, else keep raw text by using flight_date for ISO and ignoring partial
                    updateRow("flight_date", iso || formatted);
                  }}
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Departure Date</label>
                <input
                  className={inputCls + " font-mono"}
                  value={isoToDmy(editableRow.departure_date || "")}
                  onChange={e => {
                    const formatted = formatDateDmyInput(e.target.value, isoToDmy(editableRow.departure_date || ""));
                    const iso = dmyToIso(formatted);
                    updateRow("departure_date", iso || formatted);
                  }}
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Registration</label>
                <input className={inputCls + " font-mono uppercase"} value={sheet.registration} onChange={e => update("registration", e.target.value.toUpperCase())} placeholder="Registration" />
              </div>
              <div className="col-span-2 md:col-span-4">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Route</label>
                <input className={inputCls + " uppercase"} value={sheet.route} onChange={e => update("route", e.target.value.toUpperCase())} placeholder="CAI-JFK-CAI" />
              </div>
            </div>
          </Section>

          {/* Timings */}
          <Section title="Timings & Schedule" icon={<Clock size={14} />} accent="text-info" iconBg="bg-info/10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">STA</label>
                <input className={inputCls + " font-mono"} value={sheet.sta} onChange={e => update("sta", formatTimeInput(e.target.value, sheet.sta))} placeholder="HH:MM" maxLength={5} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">ATA {actualLabel}</label>
                <input className={inputCls + " font-mono"} value={sheet.ata} onChange={e => update("ata", fmtActual(e.target.value, sheet.ata))} maxLength={singleActualTime ? 5 : 11} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">STD</label>
                <input className={inputCls + " font-mono"} value={sheet.std} onChange={e => update("std", formatTimeInput(e.target.value, sheet.std))} placeholder="HH:MM" maxLength={5} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">ATD {actualLabel}</label>
                <input className={inputCls + " font-mono"} value={sheet.atd} onChange={e => update("atd", fmtActual(e.target.value, sheet.atd))} maxLength={singleActualTime ? 5 : 11} />
              </div>
              <div className="col-span-2 md:col-span-4">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Delay</label>
                <input className={inputCls} value={sheet.delay} onChange={e => update("delay", e.target.value)} placeholder="Delay info" />
              </div>
            </div>
            {!isEthiopianAirline && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Start Shift Date</label>
                <input
                  className={inputCls + " font-mono"}
                  value={isoToDmy(sheet.shift_start_date)}
                  onChange={e => {
                    const formatted = formatDateDmyInput(e.target.value, isoToDmy(sheet.shift_start_date));
                    const iso = dmyToIso(formatted);
                    update("shift_start_date", iso || formatted);
                  }}
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Start Shift Time</label>
                <input className={inputCls + " font-mono"} value={sheet.shift_start} onChange={e => update("shift_start", formatTimeInput(e.target.value, sheet.shift_start))} placeholder="HH:MM" maxLength={5} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">End Shift Date</label>
                <input
                  className={inputCls + " font-mono"}
                  value={isoToDmy(sheet.shift_end_date)}
                  onChange={e => {
                    const formatted = formatDateDmyInput(e.target.value, isoToDmy(sheet.shift_end_date));
                    const iso = dmyToIso(formatted);
                    update("shift_end_date", iso || formatted);
                  }}
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">End Shift Time</label>
                <input className={inputCls + " font-mono"} value={sheet.shift_end} onChange={e => update("shift_end", formatTimeInput(e.target.value, sheet.shift_end))} placeholder="HH:MM" maxLength={5} />
              </div>
            </div>}
          </Section>

          {/* Observers */}
          <Section title="Security Observers" icon={<Eye size={14} />} accent="text-success" iconBg="bg-success/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ObserverSection
                title="Cargo Observer"
                fields={[
                  { label: "1", value: sheet.cargo_observer_1, onChange: v => update("cargo_observer_1", v) },
                  { label: "2", value: sheet.cargo_observer_2, onChange: v => update("cargo_observer_2", v) },
                ]}
              />
              <ObserverSection
                title="Hold Baggage Observer"
                fields={[
                  { label: "1", value: sheet.hold_baggage_observer_1, onChange: v => update("hold_baggage_observer_1", v) },
                  { label: "2", value: sheet.hold_baggage_observer_2, onChange: v => update("hold_baggage_observer_2", v) },
                ]}
              />
              <ObserverSection
                title="Gate Door Observer"
                fields={[
                  { label: "1", value: sheet.gate_door_observer_1, onChange: v => update("gate_door_observer_1", v) },
                ]}
              />
              <ObserverSection
                title="Aircraft Door Observer"
                fields={[
                  { label: "1", value: sheet.aircraft_door_observer_1, onChange: v => update("aircraft_door_observer_1", v) },
                  { label: "2", value: sheet.aircraft_door_observer_2, onChange: v => update("aircraft_door_observer_2", v) },
                ]}
              />
              <ObserverSection
                title="Aircraft Ramp Observer"
                fields={[
                  { label: "1", value: sheet.aircraft_ramp_observer_1, onChange: v => update("aircraft_ramp_observer_1", v) },
                ]}
              />
            </div>
          </Section>

          {isEthiopianAirline && (
            <Section title="Baggage Information" icon={<Package size={14} />} accent="text-info" iconBg="bg-info/10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Total Baggage on BRS</label>
                  <input className={inputCls} value={sheet.total_baggage_brs} onChange={e => update("total_baggage_brs", e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Total Baggage Accepted</label>
                  <input className={inputCls} value={sheet.total_baggage_accepted} onChange={e => update("total_baggage_accepted", e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Missing Baggage on BRS</label>
                  <input className={inputCls} value={sheet.missing_baggage_brs} onChange={e => update("missing_baggage_brs", e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Bags loaded in H5</label>
                  <input className={inputCls} value={sheet.baggage_loaded_h5} onChange={e => update("baggage_loaded_h5", e.target.value)} />
                </div>
              </div>
            </Section>
          )}

          {/* Accompanied By */}
          <Section title={isEthiopianAirline ? "Cargo Baggage Accompanied By" : "Cargo, Baggage & Catering Accompanied By"} icon={<Package size={14} />} accent="text-accent-foreground" iconBg="bg-accent">
            <div className={`grid grid-cols-1 ${isEthiopianAirline ? "md:grid-cols-2" : "md:grid-cols-3"} gap-3`}>
              {!isEthiopianAirline && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Catering</label>
                  <input className={inputCls} value={sheet.catering_accompanied} onChange={e => update("catering_accompanied", e.target.value)} placeholder="Name" />
                </div>
              )}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Cargo</label>
                <input className={inputCls} value={sheet.cargo_accompanied} onChange={e => update("cargo_accompanied", e.target.value)} placeholder="Name or NIL" />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Baggage</label>
                <input className={inputCls} value={sheet.baggage_accompanied} onChange={e => update("baggage_accompanied", e.target.value)} placeholder="Name" />
              </div>
            </div>
          </Section>

          {/* Remarks */}
          <Section title="Remarks" icon={<MessageSquare size={14} />} accent="text-warning" iconBg="bg-warning/10">
            <textarea
              className={inputCls + " min-h-[80px]"}
              value={sheet.remarks}
              onChange={e => update("remarks", e.target.value)}
              placeholder="Enter any remarks, incidents, or notes…"
            />
          </Section>

          {/* Security Supervisor */}
          <Section title={supervisorTitle} icon={<UserCheck size={14} />} accent="text-primary" iconBg="bg-primary/10">
            <input
              className={inputCls}
              value={sheet.security_supervisor}
              onChange={e => update("security_supervisor", e.target.value)}
              placeholder="Supervisor name"
            />
          </Section>
          </>
          )}

          </fieldset>

          {/* RECEIVABLES-ONLY: Security Charges Panel — stays editable even when the rest of the form is locked */}
          {isReceivablesView && (
            <Section title="Security Charges (Receivables)" icon={<DollarSign size={14} />} accent="text-success" iconBg="bg-success/10">
              {receivablesLocked && (
                <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-warning-foreground flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Receivables editing is locked. The Station task sheet must be saved and the report approved by Operations before charges can be edited here.
                  </span>
                </div>
              )}
              {/* Contract picker + operational flags */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Linked Security Contract</label>
                  <select disabled={receivablesLocked} className={`${inputCls} ${receivablesLocked ? "opacity-60 cursor-not-allowed bg-muted/40" : ""}`} value={contractId} onChange={e => setContractId(e.target.value)}>
                    <option value="">— Select security contract —</option>
                    {securityContracts.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.contract_no} ({c.currency})</option>
                    ))}
                  </select>
                  {securityContracts.length === 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                      <AlertTriangle size={11} /> No active security contract found for {currentRow.airline}.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Extra Manpower</label>
                    <input type="number" min={0} disabled={receivablesLocked} className={`${inputCls} ${receivablesLocked ? "opacity-60 cursor-not-allowed bg-muted/40" : ""}`} value={extraManpower} onChange={e => setExtraManpower(+e.target.value || 0)} />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Ramp Vehicle Trips</label>
                    <input type="number" min={0} disabled={receivablesLocked} className={`${inputCls} ${receivablesLocked ? "opacity-60 cursor-not-allowed bg-muted/40" : ""}`} value={rampVehicleTrips} onChange={e => setRampVehicleTrips(+e.target.value || 0)} />
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 mb-4 text-sm">
                <label className={`flex items-center gap-2 ${receivablesLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                  <input type="checkbox" disabled={receivablesLocked} checked={shortNotice} onChange={e => setShortNotice(e.target.checked)} className="rounded border-border" />
                  <span className="text-foreground">Short Notice ADHOC (&lt; 6h)</span>
                </label>
                <label className={`flex items-center gap-2 ${receivablesLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                  <input type="checkbox" disabled={receivablesLocked} checked={returnToRamp} onChange={e => setReturnToRamp(e.target.checked)} className="rounded border-border" />
                  <span className="text-foreground">Return to Ramp w/ Load Change (50%)</span>
                </label>
              </div>

              {/* Charges breakdown */}
              {computedCharges && computedCharges.lines.length > 0 ? (
                <div className="rounded-lg border bg-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-muted-foreground text-xs uppercase tracking-wider">
                        <th className="text-left px-3 py-2 font-semibold">Charge</th>
                        <th className="text-right px-3 py-2 font-semibold">Qty</th>
                        <th className="text-left px-3 py-2 font-semibold">Unit</th>
                        <th className="text-right px-3 py-2 font-semibold">Rate</th>
                        <th className="text-right px-3 py-2 font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {computedCharges.lines.map((l: ChargeLine, i: number) => {
                        const isMissing = !!l.missingDetail;
                        return (
                          <tr key={i} className={`border-t ${isMissing ? "bg-destructive/5" : ""}`}>
                            <td className="px-3 py-2 text-foreground">
                              <span
                                className={isMissing ? "text-destructive font-semibold" : ""}
                                title={isMissing ? l.missingDetail!.location : undefined}
                              >
                                {l.label}
                              </span>
                              {isMissing && (
                                <div className="mt-1 text-[11px] text-destructive/90 bg-destructive/10 border border-destructive/20 rounded px-2 py-1">
                                  <div className="font-semibold">Missing contract field:</div>
                                  <div className="font-mono">{l.missingDetail!.location}</div>
                                  <div className="opacity-80 mt-0.5">
                                    Open the contract and add a rate row for airport <span className="font-mono font-semibold">{l.missingDetail!.airport}</span> with flight type <span className="font-mono font-semibold">{l.missingDetail!.flightType}</span>.
                                  </div>
                                </div>
                              )}
                              {!isMissing && l.notes && <div className="text-[11px] text-muted-foreground">{l.notes}</div>}
                            </td>
                            <td className="px-3 py-2 text-right text-foreground">{l.qty}</td>
                            <td className="px-3 py-2 text-foreground">{l.unit}</td>
                            <td className="px-3 py-2 text-right font-mono text-foreground">{computedCharges.currency} {l.rate.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">{computedCharges.currency} {l.amount.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-success/10 border-t-2 border-success/30">
                      <tr>
                        <td colSpan={4} className="px-3 py-2.5 text-right font-bold uppercase text-xs tracking-wider text-success">Total Security Charges</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-success">
                          {computedCharges.currency} {computedCharges.total.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                  {!contractId
                    ? "Select a security contract to compute charges."
                    : "No charges computed yet — verify shift times, flight type, and rates."}
                </div>
              )}
            </Section>
          )}

          {/* Footer matching the PDF */}
          <div className="flex justify-between items-center text-[11px] text-muted-foreground pt-3 border-t">
            <span className="flex items-center gap-1.5"><Shield size={12} /> {currentRow.airline} Security Task Sheet</span>
            <span className="font-mono">{isAirFrance ? "V.06 07Aug2024" : isEthiopianAirline ? "V.05 22Jan2023" : /fly\s*plus/i.test(String(currentAirlineName || "")) ? "V.01 01Nov2026" : "V.03 22Jan2023"}</span>
          </div>
        </div>

        {/* Sticky action bar */}
        <div className="sticky bottom-0 flex justify-between items-center gap-2 px-6 py-3 border-t bg-card/95 backdrop-blur-sm">
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer size={14} className="mr-1" /> Print
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Download size={14} className="mr-1" /> Download PDF
            </Button>
          </div>
          {pendingApprovalMode ? (
            <div className="flex flex-1 items-center gap-2 justify-end min-w-0">
              <input
                type="text"
                value={reviewComment}
                onChange={e => setReviewComment(e.target.value)}
                placeholder="Rejection comment (required for rejection)"
                className="flex-1 min-w-0 text-sm border rounded px-2.5 h-9 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button variant="outline" size="sm" onClick={onClose} disabled={reviewSubmitting} className="shrink-0">Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={reviewSubmitting}
                className="shrink-0 whitespace-nowrap"
                onClick={async () => {
                  if (!onPendingReject) { onClose(); return; }
                  if (!reviewComment.trim()) {
                    toast({ title: "Comment required", description: "Please add a reason before rejecting.", variant: "destructive" });
                    return;
                  }
                  setReviewSubmitting(true);
                  try {
                    await Promise.resolve(onPendingReject(reviewComment));
                  } finally {
                    setReviewSubmitting(false);
                  }
                  onClose();
                }}
              >
                <XCircle size={14} className="mr-1" /> Reject & Return to Station
              </Button>
              <Button
                size="sm"
                disabled={reviewSubmitting}
                className="bg-success hover:bg-success/90 text-success-foreground shrink-0"
                onClick={async () => {
                  if (!onPendingApprove) { onClose(); return; }
                  setReviewSubmitting(true);
                  try {
                    await Promise.resolve(onPendingApprove());
                  } finally {
                    setReviewSubmitting(false);
                  }
                  onClose();
                }}
              >
                <CheckCircle2 size={14} className="mr-1" /> Approve & Close
              </Button>
            </div>
          ) : reviewMode ? (
            <div className="flex flex-1 items-center gap-2 justify-end min-w-0">
              <input
                type="text"
                value={reviewComment}
                onChange={e => setReviewComment(e.target.value)}
                placeholder="Review comment (required for rejection)"
                className="flex-1 min-w-0 text-sm border rounded px-2.5 h-9 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button variant="outline" size="sm" onClick={onClose} className="shrink-0">Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={reviewSubmitting}
                className="shrink-0 whitespace-nowrap"
                onClick={async () => {
                  if (!reviewComment.trim()) {
                    toast({ title: "Comment required", description: "Please add a reason before rejecting.", variant: "destructive" });
                    return;
                  }
                  setReviewSubmitting(true);
                  const { error } = await supabase.from("dispatch_assignments").update({
                    review_status: "Rejected",
                    review_comment: reviewComment,
                    reviewed_by: "Operations",
                    reviewed_at: new Date().toISOString(),
                  } as any).eq("id", currentRow.id);
                  setReviewSubmitting(false);
                  if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
                  queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] });
                  toast({ title: "❌ Rejected", description: "Sent back to Station with comments." });
                  onClose();
                }}
              >
                <XCircle size={14} className="mr-1" /> Reject & Return to Station
              </Button>
              <Button
                size="sm"
                disabled={reviewSubmitting}
                className="bg-success hover:bg-success/90 text-success-foreground shrink-0"
                onClick={() => {
                  setReviewSubmitting(true);
                  const reviewedAt = new Date().toISOString();
                  const patchApprovedRow = (old: any) => {
                    if (!Array.isArray(old)) return old;
                    return old.map((r: any) => r?.id === currentRow.id ? {
                      ...r,
                      status: "Completed",
                      review_status: "Approved",
                      review_comment: reviewComment || "",
                      reviewed_by: "Operations",
                      reviewed_at: reviewedAt,
                      fs_status: "Completed",
                    } : r);
                  };
                  setEditableRow(prev => prev ? {
                    ...prev,
                    status: "Completed",
                    review_status: "Approved",
                    review_comment: reviewComment || "",
                    reviewed_by: "Operations",
                    reviewed_at: reviewedAt,
                  } : prev);
                  queryClient.setQueriesData({ queryKey: ["dispatch_assignments"] }, patchApprovedRow);
                  queryClient.setQueriesData({ queryKey: ["v_dispatch_with_flight"] }, patchApprovedRow);
                  if ((currentRow as any).flight_schedule_id) {
                    queryClient.setQueriesData({ queryKey: ["flight_schedules"] }, (old: any) => {
                      if (!Array.isArray(old)) return old;
                      return old.map((f: any) => f?.id === (currentRow as any).flight_schedule_id ? { ...f, status: "Completed" } : f);
                    });
                  }
                  onClose();
                  void (async () => {
                    try {
                      const { error } = await (supabase as any).rpc("approve_security_service_report", {
                        _dispatch_id: currentRow.id,
                        _flight_schedule_id: (currentRow as any).flight_schedule_id || null,
                        _review_comment: reviewComment || "",
                        _reviewed_by: "Operations",
                      });
                      if (error) throw error;
                      queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"], refetchType: "none" as any });
                      queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"], refetchType: "none" as any });
                      queryClient.invalidateQueries({ queryKey: ["flight_schedules"], refetchType: "none" as any });
                      toast({ title: "✅ Approved", description: "Report approved." });
                    } catch (e: any) {
                      toast({ title: "Error", description: e?.message || "Approval failed", variant: "destructive" });
                      queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"] });
                      queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] });
                      queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
                    }
                  })();
                }}
              >
                <CheckCircle2 size={14} className="mr-1" /> Approve
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              {!isReceivablesView && (
                <p className="text-[11px] text-muted-foreground text-right">
                  <strong>Save</strong> writes all fields and keeps the dialog open.{" "}
                  <strong>Save &amp; Close</strong> writes all fields and exits. Both persist the
                  complete task sheet — your entries are not lost between clicks.
                </p>
              )}
              <div className="flex items-center gap-2">
                {lastWriteCycle && (
                  <div
                    className={`text-[11px] px-2 py-1 rounded border font-medium ${
                      lastWriteCycle.status === "PASS"
                        ? "bg-success/10 text-success border-success/30"
                        : lastWriteCycle.status === "FAIL"
                        ? "bg-destructive/10 text-destructive border-destructive/30"
                        : "bg-muted text-muted-foreground border-border"
                    }`}
                    title={`fs=${lastWriteCycle.flight_schedule_id ?? "n/a"} • ${new Date(lastWriteCycle.at).toLocaleTimeString()}`}
                  >
                    Last Save Verified: {lastWriteCycle.status} · Source: flight_schedules
                  </div>
                )}
                <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                {!isReceivablesView && !isNew && (currentRow as any).flight_schedule_id && (
                  <Button
                    variant="outline"
                    disabled={saving}
                    className="border-warning/40 text-warning hover:bg-warning/10"
                    title="Close this report and send the flight back to Clearance with a reason."
                    onClick={async () => {
                      const fsid = (currentRow as any).flight_schedule_id as string;
                      const comment = window.prompt(`Return flight ${currentRow.flight_no || ""} to Clearance — reason:`);
                      const reason = (comment || "").trim();
                      if (!reason) return;
                      const stamp = `[Station Return ${new Date().toISOString().slice(0, 16).replace("T", " ")}] ${reason}`;
                      try {
                        // Atomic on the server: appends to remarks and flips status
                        // in a single statement so concurrent edits cannot drop the
                        // reason. Returns the freshly-updated row.
                        const { data: updated, error } = await (supabase as any).rpc("return_flight_to_clearance", {
                          _id: fsid,
                          _stamp: stamp,
                        });
                        if (error) throw error;
                        const patched = Array.isArray(updated) ? updated[0] : updated;
                        // Optimistically patch every flight_schedules-backed query so
                        // the banner renders immediately, even before refetch lands.
                        if (patched) {
                          queryClient.setQueriesData({ queryKey: ["flight_schedules"] }, (old: any) => {
                            if (!Array.isArray(old)) return old;
                            return old.map((f: any) => f?.id === fsid ? { ...f, ...patched } : f);
                          });
                        }
                        // Force a refetch of the active flight/dispatch queries so
                        // the banner is guaranteed to re-render from authoritative
                        // server data — does not rely on a query-key change.
                        await Promise.all([
                          queryClient.invalidateQueries({ queryKey: ["flight_schedules"] }),
                          queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] }),
                          queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"] }),
                        ]);
                        await Promise.all([
                          queryClient.refetchQueries({ queryKey: ["flight_schedules"], type: "active" }),
                          queryClient.refetchQueries({ queryKey: ["dispatch_assignments"], type: "active" }),
                        ]);
                        // Confirmation toast echoes the exact reason that was
                        // persisted to flight_schedules.remarks so the user can
                        // verify what was saved without reopening the row.
                        const persistedRemarks = (patched as any)?.remarks || "";
                        const persisted = persistedRemarks.includes(stamp);
                        toast({
                          title: persisted ? "↩️ Returned to Clearance — reason saved" : "↩️ Returned to Clearance",
                          description: persisted
                            ? `Saved to flight remarks: "${reason}"`
                            : `Reason: "${reason}"`,
                        });
                        onClose();
                      } catch (e: any) {
                        toast({ title: "Error", description: e.message, variant: "destructive" });
                      }
                    }}
                  >
                    <RefreshCw size={14} className="mr-1" /> Close & Return to Clearance
                  </Button>
                )}
                {!isReceivablesView && !stationLockedAfterApproval && (
                  <Button
                    variant="secondary"
                    onClick={() => handleSave(false)}
                    disabled={saving || ethiopianMissingFlightType}
                    className="shadow-sm"
                    title="Persists all entered fields to the database and keeps the dialog open so you can continue editing."
                  >
                    {saving ? <>Saving…</> : <><Shield size={14} className="mr-1" /> Save</>}
                  </Button>
                )}
                {!stationLockedAfterApproval && (
                  <Button
                    onClick={() => handleSave(true)}
                    disabled={saving || (isReceivablesView && receivablesLocked) || (!isReceivablesView && ethiopianMissingFlightType)}
                    className="shadow-sm"
                    title="Persists all entered fields and closes the dialog."
                  >
                    {saving ? (
                      <>Saving…</>
                    ) : isReceivablesView ? (
                      <><DollarSign size={14} className="mr-1" /> Save Security Charges</>
                    ) : (
                      <><Shield size={14} className="mr-1" /> Save & Close</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ObserverSection({ title, fields }: { title: string; fields: { label: string; value: string; onChange: (v: string) => void }[] }) {
  const inputCls = "text-sm border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary placeholder:text-muted-foreground w-full transition-colors";
  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <div className="bg-success/10 text-success font-semibold text-xs uppercase tracking-wider px-3 py-2 border-b border-success/20 flex items-center gap-1.5">
        <Eye size={12} /> {title}
      </div>
      <div className="p-2 space-y-1.5">
        {fields.map(f => (
          <div key={f.label} className="flex items-center gap-2">
            <span className="h-7 w-7 rounded-md bg-muted text-foreground text-xs font-bold flex items-center justify-center shrink-0">{f.label}</span>
            <input className={inputCls} value={f.value} onChange={e => f.onChange(e.target.value)} placeholder="Name or NIL" />
          </div>
        ))}
      </div>
    </div>
  );
}
