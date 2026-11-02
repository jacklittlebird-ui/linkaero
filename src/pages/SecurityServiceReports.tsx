import React, { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import {
  Search, Plus, Download, Shield, Plane, Building2, Clock, Users,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Pencil, CheckCircle2, XCircle, AlertTriangle,
  FileBarChart2, DollarSign, MessageSquare, ExternalLink, CalendarDays, X, RefreshCw,
  Eye, Trash2
} from "lucide-react";

import { resolveSecurityRowDisplay } from "@/lib/securityRowDisplay";
import { getTypeBadgeClass } from "@/lib/typeColors";
import { useNavigate, useLocation } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { resolveFlightMasterForWrite } from "@/lib/resolveFlightMasterForWrite";
import { expandFlightRef, normalizeFlightKey } from "@/lib/flightRefMatch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useChannel } from "@/contexts/ChannelContext";
import { useUserStation } from "@/contexts/UserStationContext";
import PipelineStepper, { derivePipelineStage, derivePipelineCompletedStages, resolvePipelineCreatedVia } from "@/components/serviceReport/PipelineStepper";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SECURITY_CLEARANCE_TYPES } from "@/components/clearances/ClearanceTypes";
const SecurityTaskSheetDialog = lazy(() => import("@/components/security/SecurityTaskSheetDialog"));
import AllClearanceFlightsPage from "@/pages/AllClearanceFlights";
import { calculateSecurityCharges } from "@/lib/securityChargeCalculator";
import { computeLiveSecurityCharge } from "@/lib/securityRowCharges";

import { dedupeDispatchRows, resolveBillingDate, shiftDateStr } from "@/lib/securityDispatchRows";
import { snapshotBeforeSave, verifyAfterSave } from "@/lib/phase3WriteCycleVerifier";
import { resolveDownloadFields } from "@/lib/securityDownloadFields";
import { parseDeletionRequests } from "@/lib/statusRouting";
import { airlineBadgeStyle } from "@/lib/airlineColors";




const WORKFLOW_STATUSES = ["Pending", "In Progress", "Completed"] as const;

const SECURITY_FLIGHT_LIST_COLUMNS = [
  "id",
  "flight_no",
  "arrival_flight",
  "departure_flight",
  "registration",
  "route",
  "aircraft_type",
  "sta",
  "std",
  "skd_type",
  "clearance_type",
  "arrival_date",
  "departure_date",
  "authority",
  "status",
  "remarks",
  "created_via",
  "created_at",
  "updated_at",
  "handling_agent",
  "airline_id",
  "airlines:airline_id(name,iata_code)",
].join(",");

const DISPATCH_LIST_COLUMNS = [
  "id",
  "flight_schedule_id",
  "contract_id",
  "station",
  "airline",
  "flight_no",
  "flight_date",
  "service_type",
  "staff_names",
  "staff_count",
  "scheduled_start",
  "scheduled_end",
  "actual_start",
  "actual_end",
  "contract_duration_hours",
  "actual_duration_hours",
  "overtime_hours",
  "overtime_rate",
  "base_fee",
  "service_rate",
  "overtime_charge",
  "total_charge",
  "status",
  "notes",
  "dispatched_by",
  "created_at",
  "updated_at",
  "review_status",
  "review_comment",
  "reviewed_by",
  "reviewed_at",
  "irregularity_id",
  "task_sheet_data",
  "charges_breakdown",
  "total_security_charges",
  "short_notice",
  "extra_manpower_count",
  "ramp_vehicle_trips",
  "return_to_ramp_with_load",
  "charges_currency",
  "created_via",
  "charges_saved_at",
  "invoiced_at",
  "fs_id",
  "fs_flight_no",
  "fs_registration",
  "fs_aircraft_type",
  "fs_route",
  "fs_sta",
  "fs_std",
  "fs_skd_type",
  "fs_clearance_type",
  "fs_arrival_date",
  "fs_departure_date",
  "fs_authority",
  "fs_status",
].join(",");

const DISPATCH_TABLE_LIST_COLUMNS = [
  "id",
  "flight_schedule_id",
  "contract_id",
  "flight_date",
  "staff_names",
  "staff_count",
  "scheduled_start",
  "scheduled_end",
  "actual_start",
  "actual_end",
  "contract_duration_hours",
  "actual_duration_hours",
  "overtime_hours",
  "overtime_rate",
  "base_fee",
  "service_rate",
  "overtime_charge",
  "total_charge",
  "status",
  "notes",
  "dispatched_by",
  "created_at",
  "updated_at",
  "review_status",
  "review_comment",
  "reviewed_by",
  "reviewed_at",
  "irregularity_id",
  "task_sheet_data",
  "charges_breakdown",
  "total_security_charges",
  "short_notice",
  "extra_manpower_count",
  "ramp_vehicle_trips",
  "return_to_ramp_with_load",
  "charges_currency",
  "created_via",
  "charges_saved_at",
  "invoiced_at",
].join(",");

const SECURITY_RATE_LIST_COLUMNS = [
  "id",
  "contract_id",
  "airport",
  "flight_type",
  "rate",
  "included_hours",
  "overtime_rate",
  "currency",
  "unit",
  "notes",
  "sort_order",
].join(",");

const reviewStatusConfig: Record<string, { icon: React.ReactNode; cls: string }> = {
  "Draft": { icon: <Pencil size={11} />, cls: "bg-muted text-muted-foreground" },
  "Pending Review": { icon: <Clock size={11} />, cls: "bg-warning/15 text-warning" },
  "Modified": { icon: <ExternalLink size={11} />, cls: "bg-info/15 text-info" },
  "Approved": { icon: <CheckCircle2 size={11} />, cls: "bg-success/15 text-success" },
  "Ready for Billing": { icon: <DollarSign size={11} />, cls: "bg-primary/15 text-primary" },
  "Rejected": { icon: <XCircle size={11} />, cls: "bg-destructive/15 text-destructive" },
};

const dispatchStatusConfig: Record<string, string> = {
  "Pending": "bg-muted text-muted-foreground",
  "In Progress": "bg-info/15 text-info",
  "Completed": "bg-success/15 text-success",
};

const isOperationsApprovedReview = (status?: string | null) => {
  const value = String(status || "").trim().toLowerCase();
  return value === "approved" || value === "ready for billing";
};

const getWorkflowDispatchStatus = (row: { status?: string | null; review_status?: string | null }) =>
  isOperationsApprovedReview(row.review_status) ? "Completed" : (row.status || "Pending");

export const RECEIVABLES_REVIEWER = "Receivables";
const isReceivablesReviewer = (value: unknown) =>
  /receiv|acc\s*rec|accrec/i.test(String(value || ""));

const isEthiopianAirline = (value: unknown) => /ethiopian/i.test(String(value || ""));
const getSecurityFlightType = (
  airline: unknown,
  taskSheet: Record<string, any> | null | undefined,
  fallback: unknown,
) => {
  const savedFlightType = String(taskSheet?.flight_type || "").trim();
  const fallbackValue = String(fallback || "").trim();
  return isEthiopianAirline(airline)
    ? (savedFlightType || fallbackValue)
    : (fallbackValue || savedFlightType);
};


const hasSavedSecurityCharges = (row: { review_status?: string | null; reviewed_by?: string | null; charges_saved_at?: string | null; invoiced_at?: string | null; total_security_charges?: number | null; charges_breakdown?: unknown }) => {
  // Step 4 (Receivables) only completes when Receivables explicitly saves the
  // security charges. "Ready for Billing" alone is NOT enough — Operations can
  // also set that status (e.g. approving a Modified report), which must keep
  // step 4 open until Accounts Receivable actually reviews the charges.
  // Strict rule: step 4 completes ONLY when the Receivables portal reviewed
  // and marked the record (reviewed_by = Receivables + charges saved / Ready
  // for Billing). Invoices or timestamps alone never complete it.
  if (!isReceivablesReviewer(row.reviewed_by)) return false;
  if ((row as any).charges_saved_at) return true;
  const value = String(row.review_status || "").trim().toLowerCase();
  return value === "ready for billing";
};


interface DispatchRow {
  id: string;
  flight_schedule_id: string | null;
  contract_id: string | null;
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
  dispatched_by: string;
  review_status: string;
  review_comment: string;
  reviewed_by: string;
  reviewed_at: string | null;
  charges_saved_at?: string | null;
  invoiced_at?: string | null;
  irregularity_id: string | null;
  created_at: string;
  updated_at: string;
  task_sheet_data?: any;
  flightMeta?: any;
}

function timeDiffMinutes(start: string, end: string): number {
  if (!start || !end) return 0;
  const [h1, m1] = start.split(":").map(Number);
  const [h2, m2] = end.split(":").map(Number);
  if ([h1, m1, h2, m2].some(isNaN)) return 0;
  let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function minutesToHMM(mins: number): number {
  if (!mins || mins < 0) return 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return Math.round((h + m / 100) * 100) / 100;
}

function timeDiffHours(start: string, end: string): number {
  return minutesToHMM(timeDiffMinutes(start, end));
}

function normalizeSecurityDates(row: Record<string, any>, taskSheet: Record<string, any>) {
  const arrivalDate = String(row.flight_date || "").trim();
  const departureDate = String(row.departure_date || "").trim();
  return {
    // `dispatch_assignments.flight_date` is only the list/filter date. It must
    // never be used to back-fill Arrival Date when the user cleared it.
    flightDate: arrivalDate || departureDate || new Date().toISOString().slice(0, 10),
    arrivalDate,
    departureDate,
  };
}

export default function SecurityServiceReportsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [reviewIdsFilter, setReviewIdsFilter] = useState<string[] | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const reviewIds = params.get("reviewIds");
    if (reviewIds) {
      const ids = reviewIds.split(",").map(s => s.trim()).filter(Boolean);
      setReviewIdsFilter(ids.length > 0 ? ids : null);
    } else {
      setReviewIdsFilter(null);
    }
  }, [location.search]);
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { activeChannel, isAdmin } = useChannel();
  const { station: userStation, isStationScoped } = useUserStation();
  const isReceivablesView = activeChannel === "receivables";
  const isOperationsView = activeChannel === "operations" || activeChannel === "admin";
  const isStationView = activeChannel === "station";
  const canCreateNew = !isReceivablesView && !isOperationsView;
  const [stationTab, setStationTab] = useState<"all" | "rejected">("all");
  const [opsTab, setOpsTab] = useState<"all" | "modified" | "clearance-flights" | "pending-approval">("all");

  // Once Operations completes step 3 (review approved), the Station may no
  // longer amend the report — only an administrator can.
  const isOpsLocked = (r: { review_status?: string | null }) =>
    !isAdmin && isStationView && isOperationsApprovedReview(r.review_status);

  const tryOpenEdit = (r: DispatchRow) => {
    if (isOpsLocked(r)) {
      toast({
        title: "Locked",
        description: "Operations approved this report (step 3). Only an administrator can amend it.",
        variant: "destructive",
      });
      return;
    }
    if (isReceivablesView) {

      const workflowStatus = getWorkflowDispatchStatus(r);
      const completed = derivePipelineCompletedStages({
        isLinked: workflowStatus === "Completed",
        reviewStatus: r.review_status,
        clearanceStatus: r.flight_schedule_id ? flightStatusById.get(r.flight_schedule_id) : undefined,
        dispatchStatus: workflowStatus,
        createdVia: resolvePipelineCreatedVia(r, r.flight_schedule_id ? flightCreatedViaById.get(r.flight_schedule_id) : undefined),
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
    const fd = r.flight_schedule_id ? flightDetailsById.get(r.flight_schedule_id) : undefined;
    const display = resolveSecurityRowDisplay(r as any, fd, (r as any).flightMeta);
    setEditRow({ ...r, flight_no: display.flightNo || r.flight_no });
  };

  const _initParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [search, setSearch] = useState(_initParams.get("search") || "");
  const [stationFilter, setStationFilter] = useState(_initParams.get("station") || "All Stations");
  const [airlineFilter, setAirlineFilter] = useState(_initParams.get("airline") || "All Airlines");
  const [statusFilter, setStatusFilter] = useState("All");
  const [stepFilter, setStepFilter] = useState("All Steps");
  const [serviceFilter, setServiceFilter] = useState(_initParams.get("type") || "All Types");
  const [dateFrom, setDateFrom] = useState(_initParams.get("date_from") || "");
  const [dateTo, setDateTo] = useState(_initParams.get("date_to") || "");

  // Perf: when the user hasn't picked a date window, cap server-side reads
  // to the last 180 days so opening this page doesn't pull full history.
  // The client-side row filters (line 859+) still honor the explicit
  // dateFrom/dateTo values the user typed.
  const effectiveDateFrom = useMemo(() => {
    if (dateFrom) return dateFrom;
    const d = new Date();
    d.setDate(d.getDate() - 180);
    return d.toISOString().slice(0, 10);
  }, [dateFrom]);
  
  const [recordsView, setRecordsView] = useState<"table" | "calendar">("table");
  const [expandedDeleteIds, setExpandedDeleteIds] = useState<Set<string>>(new Set());

  const [editRow, setEditRow] = useState<DispatchRow | null>(null);
  const [isNewReport, setIsNewReport] = useState(false);
  const [pendingApprovalFlightId, setPendingApprovalFlightId] = useState<string | null>(null);
  const [reviewRow, setReviewRow] = useState<DispatchRow | null>(null);
  const [reviewComment, setReviewComment] = useState("");

  /* Pending Approval tab filters */
  const [pendingSearch, setPendingSearch] = useState("");
  const [pendingStationFilter, setPendingStationFilter] = useState("All Stations");
  const [pendingAirlineFilter, setPendingAirlineFilter] = useState("All Airlines");
  const [pendingTypeFilter, setPendingTypeFilter] = useState("All Types");
  const [pendingStatusFilter, setPendingStatusFilter] = useState("All Statuses");
  const [pendingDateFrom, setPendingDateFrom] = useState("");
  const [pendingDateTo, setPendingDateTo] = useState("");

  const syncApprovedStatusCache = useCallback((opts: { dispatchId?: string | null; flightId?: string | null; reviewStatus?: string; reviewedBy?: string; reviewedAt?: string }) => {
    const { dispatchId, flightId, reviewStatus = "Approved", reviewedBy, reviewedAt } = opts;
    const patchDispatchRows = (old: any) => {
      if (!Array.isArray(old)) return old;
      return old.map((row: any) => {
        const match = (dispatchId && row?.id === dispatchId) || (flightId && row?.flight_schedule_id === flightId);
        return match
          ? { ...row, status: "Completed", review_status: reviewStatus, reviewed_by: reviewedBy ?? row.reviewed_by, reviewed_at: reviewedAt ?? row.reviewed_at, fs_status: "Completed" }
          : row;
      });
    };
    queryClient.setQueriesData({ queryKey: ["dispatch_assignments"] }, patchDispatchRows);
    queryClient.setQueriesData({ queryKey: ["v_dispatch_with_flight"] }, patchDispatchRows);
    if (flightId) {
      queryClient.setQueriesData({ queryKey: ["flight_schedules"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((flight: any) => flight?.id === flightId ? { ...flight, status: "Completed" } : flight);
      });
      queryClient.setQueriesData({ queryKey: ["flight_schedules", "ops-rejected-reports"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((flight: any) => flight?.id !== flightId);
      });
    }
  }, [queryClient]);
  

  // Phase 3B Step 1: dispatch_assignments no longer holds mirror columns
  // (station/airline/flight_no/service_type). Read through the FS-driven
  // view so display fields resolve from flight_schedules + airlines.
  const { data: dispatches = [], isLoading } = useQuery({
    queryKey: ["v_dispatch_with_flight", "service-reports-v2", session?.user?.id, isStationScoped ? userStation : null, effectiveDateFrom, dateTo || null],
    queryFn: async () => {
      const all: any[] = [];
      const PAGE_SIZE = 1000;
      for (let from = 0; ; from += PAGE_SIZE) {
        let q: any = (supabase as any)
          .from("v_dispatch_with_flight")
          .select(DISPATCH_LIST_COLUMNS)
          .order("flight_date", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (isStationScoped && userStation) q = q.eq("station", userStation);
        // Buffer the server window by 2 days: `flight_date` can lag the
        // authoritative flight_schedules date, so boundary rows must still be
        // fetched and then filtered by resolveBillingDate() below.
        q = q.gte("flight_date", shiftDateStr(effectiveDateFrom, -2));
        if (dateTo) q = q.lte("flight_date", shiftDateStr(dateTo, 2));
        const { data, error } = await q;
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return all as DispatchRow[];
    },
    enabled: !!session,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });


  const irregularityIds = useMemo(
    () => Array.from(new Set((dispatches as any[]).map((d: any) => d.irregularity_id).filter(Boolean))),
    [dispatches]
  );

  // Fetch only irregularities linked to visible dispatch rows; the old query
  // scanned the whole irregularity table on every open just to draw one icon.
  const { data: irregularities = [] } = useQuery({
    queryKey: ["irregularity_reports", "for-service-reports", irregularityIds],
    queryFn: async () => {
      if (irregularityIds.length === 0) return [];
      const { data, error } = await supabase
        .from("irregularity_reports")
        .select("id, report_id, flight_no, station, severity, status")
        .in("id", irregularityIds);
      if (error) throw error;
      return data;
    },
    enabled: !!session && irregularityIds.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Pipeline: load invoices to mark Receivables step complete only when paid.
  const { data: dbInvoicesForPipeline = [] } = useQuery({
    queryKey: ["invoices_for_security_pipeline", effectiveDateFrom, dateTo || null],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("flight_ref,status")
        .neq("status", "Cancelled")
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!session,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const invoiceStatusByFlight = useMemo(() => {
    const m = new Map<string, "issued" | "paid">();
    for (const inv of (dbInvoicesForPipeline as any[])) {
      const raw = String(inv.flight_ref || "");
      if (!raw) continue;
      const isPaid = String(inv.status || "").toLowerCase() === "paid";
      for (const key of expandFlightRef(raw)) {
        if (isPaid) m.set(key, "paid");
        else if (!m.get(key)) m.set(key, "issued");
      }
    }
    return m;
  }, [dbInvoicesForPipeline]);

  // Fetch flight schedules with security clearance types.
  // For station-scoped users and Operations view, ALL flights are treated as
  // security (Handling tab is empty for stations and ops needs visibility into
  // every station's flights), so skip the clearance_type filter.
  const includeAllFlights = (isStationScoped && !!userStation) || isOperationsView;
  const [securityLoadedRows, setSecurityLoadedRows] = useState(0);
  const pendingEffectiveDateFrom = useMemo(() => pendingDateFrom || effectiveDateFrom, [pendingDateFrom, effectiveDateFrom]);
  const { data: securityFlights = [], isFetching: securityFlightsFetching } = useQuery({
    queryKey: ["flight_schedules", "security-types", isStationScoped ? userStation : null, isOperationsView, effectiveDateFrom, dateTo || null],
    queryFn: async () => {
      setSecurityLoadedRows(0);
      // Shared filter layer → identical totals to the Clearance Security tab.
      const { fetchSecurityFlights } = await import("@/lib/securityFlightsQuery");
      return await fetchSecurityFlights(supabase as any, {
        station: isStationScoped && userStation ? userStation : null,
        includeAllForStation: includeAllFlights,
        includeRejected: true,
        dateFrom: effectiveDateFrom,
        dateTo: dateTo || null,
        select: SECURITY_FLIGHT_LIST_COLUMNS,
        onPage: ({ loaded }) => setSecurityLoadedRows(loaded),
      });
    },
    enabled: !!session && isStationScoped,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });


  // Operations "Rejected by Operations" tab: every flight whose security task
  // sheet Operations sent back to the Station (dispatch review_status =
  // 'Rejected'). As soon as the Station edits/resubmits the report the
  // review_status flips back to 'Pending Review', so the row leaves this tab.
  const { data: pendingApprovalFlights = [] } = useQuery({
    queryKey: ["flight_schedules", "ops-rejected-reports", isStationScoped ? userStation : null, pendingEffectiveDateFrom, pendingDateTo || dateTo || null],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      // 1) All rejected dispatches (latest per flight).
      const byFs = new Map<string, any>();
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("dispatch_assignments")
          .select(DISPATCH_TABLE_LIST_COLUMNS)
          .eq("review_status", "Rejected")
          .order("updated_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        (data || []).forEach((d: any) => {
          if (!d.flight_schedule_id) return;
          const prev = byFs.get(d.flight_schedule_id);
          if (!prev || new Date(d.updated_at || d.created_at || 0) > new Date(prev.updated_at || prev.created_at || 0)) {
            byFs.set(d.flight_schedule_id, d);
          }
        });
        if (!data || data.length < PAGE_SIZE) break;
      }
      const ids = Array.from(byFs.keys());
      if (ids.length === 0) return [] as any[];

      // 2) Their flight rows (batched IN() to stay under the URL length limit).
      const flightsById = new Map<string, any>();
      const CHUNK = 100;
      for (let i = 0; i < ids.length; i += CHUNK) {
        let q: any = supabase
          .from("flight_schedules")
          .select(SECURITY_FLIGHT_LIST_COLUMNS)
          .in("id", ids.slice(i, i + CHUNK));
        if (isStationScoped && userStation) q = q.eq("authority", userStation);
        const { data, error } = await q;
        if (error) throw error;
        (data || []).forEach((f: any) => flightsById.set(f.id, f));
      }

      const dateOf = (f: any) => f.arrival_date || f.departure_date || "";
      const dateTop = pendingDateTo || dateTo;
      const flights = Array.from(flightsById.values())
        .filter((f: any) => {
          const d = dateOf(f);
          if (!d) return true;
          if (pendingEffectiveDateFrom && d < pendingEffectiveDateFrom) return false;
          if (dateTop && d > dateTop) return false;
          return true;
        })
        .sort((a: any, b: any) => {
          const ad = dateOf(a), bd = dateOf(b);
          if (ad !== bd) return ad.localeCompare(bd);
          return String(a.id || "").localeCompare(String(b.id || ""));
        });

      return flights.map((f: any) => ({ ...f, dispatch: byFs.get(f.id) || null })) as any[];
    },

    enabled: !!session && isOperationsView && opsTab === "pending-approval",
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const approvePendingFlight = (flightId: string) => {
    const reviewer = session?.user?.email || "Operations";
    const reviewedAt = new Date().toISOString();
    const pendingFlight = (pendingApprovalFlights as any[]).find((f: any) => f?.id === flightId);
    const cachedDispatch =
      pendingFlight?.dispatch || (dispatches as any[]).find((d: any) => d?.flight_schedule_id === flightId);
    const dispatchId = cachedDispatch?.id || null;

    // Optimistic UI first: close the dialog / remove the row immediately. The
    // backend approval is one RPC and runs in the background, so large list
    // refetches never block the click.
    queryClient.setQueriesData({ queryKey: ["flight_schedules", "ops-rejected-reports"] }, (old: any) => {
      if (!Array.isArray(old)) return old;
      return old.filter((f: any) => f?.id !== flightId);
    });
    syncApprovedStatusCache({ dispatchId, flightId, reviewedBy: reviewer, reviewedAt });

    void (async () => {
      try {
        const { data, error } = await (supabase as any).rpc("approve_security_service_report", {
          _dispatch_id: dispatchId,
          _flight_schedule_id: flightId,
          _review_comment: "",
          _reviewed_by: reviewer,
        });
        if (error) throw error;
        const approvedDispatch = data?.dispatch;
        const approvedFlight = data?.flight;
        if (approvedDispatch?.id) {
          syncApprovedStatusCache({
            dispatchId: approvedDispatch.id,
            flightId: approvedDispatch.flight_schedule_id || flightId,
            reviewedBy: approvedDispatch.reviewed_by || reviewer,
            reviewedAt: approvedDispatch.reviewed_at || reviewedAt,
          });
        }
        if (approvedFlight?.id) {
          queryClient.setQueriesData({ queryKey: ["flight_schedules"] }, (old: any) => {
            if (!Array.isArray(old)) return old;
            return old.map((f: any) => f?.id === approvedFlight.id ? { ...f, ...approvedFlight } : f);
          });
        }
        toast({ title: "Approved", description: "Flight approved by Operations." });
        queryClient.invalidateQueries({ queryKey: ["flight_schedules"], refetchType: "none" as any });
        queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"], refetchType: "none" as any });
        queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"], refetchType: "none" as any });
      } catch (e: any) {
        toast({ title: "Error", description: e?.message || "Approval failed", variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: ["flight_schedules", "ops-rejected-reports"] });
      }
    })();
  };

  const rejectPendingFlight = async (flightId: string, reason?: string) => {
    // Operations rejection should only surface in the Station "Rejected Service Reports" tab.
    // We intentionally do NOT flip flight_schedules.status to "Rejected" — that would also
    // make it appear in the Clearance "Rejected" tab, which we don't want here.
    let trimmed = reason;
    if (trimmed === undefined) {
      const promptResult = window.prompt("Rejection reason (shown to Station on the Rejected Service Reports tab):", "");
      if (promptResult === null) return; // user cancelled
      trimmed = promptResult.trim();
    }
    const { error } = await supabase
      .from("dispatch_assignments")
      .update({
        review_status: "Rejected",
        review_comment: trimmed,
        reviewed_by: session?.user?.email || "Operations",
        reviewed_at: new Date().toISOString(),
      } as any)
      .eq("flight_schedule_id", flightId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
    queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] });
    toast({ title: "Rejected", description: "Sent back to Station — visible in Rejected Service Reports." });
  };


  const openEditPending = (f: any) => {
    setPendingApprovalFlightId(f.id);
    // Use the enriched latest dispatch from the Pending Approval query first.
    // The general dispatches cache can be stale or date-windowed differently,
    // which made the View form miss task-sheet amendments that the table had.
    const existing = f.dispatch || (dispatches as any[]).find(
      (d: any) => d.flight_schedule_id === f.id
    );
    if (existing) {
      setIsNewReport(false);
      // Phase 7: dispatch_assignments no longer stores mirror columns.
      // Hydrate display-only fields from the FS row so the dialog shows
      // airline / station / flight_no / service_type / registration / route.
      const airlineName = f.airlines?.name || f.handling_agent || "";
      setEditRow({
        ...(existing as DispatchRow),
        airline: (existing as any).airline || airlineName,
        station: (existing as any).station || f.authority || "",
        flight_no: (existing as any).flight_no || f.flight_no || "",
        service_type: (existing as any).service_type || f.clearance_type || "",
        registration: (existing as any).registration || f.registration || "",
        route: (existing as any).route || f.route || "",
        aircraft_type: (existing as any).aircraft_type || f.aircraft_type || "",
        sta: (existing as any).sta || f.sta || "",
        std: (existing as any).std || f.std || "",
        skd_type: (existing as any).skd_type || f.skd_type || "",
        flightMeta: f,
      } as DispatchRow);
      return;
    }
    // Otherwise create a blank Task Sheet pre-populated from the pending flight
    const airlineName = f.airlines?.name || f.handling_agent || "";
    const flightDate =
      f.arrival_date || f.departure_date || f.flight_date || new Date().toISOString().slice(0, 10);
    const blankRow: DispatchRow = {
      id: "new",
      flight_schedule_id: f.id,
      contract_id: null,
      station: f.authority || f.station || "",
      airline: airlineName,
      flight_no: f.flight_no || "",
      flight_date: flightDate,
      service_type: f.clearance_type || "Arrival Security",
      staff_names: "",
      staff_count: 0,
      scheduled_start: f.sta || f.std || "",
      scheduled_end: f.std || f.sta || "",
      actual_start: "",
      actual_end: "",
      contract_duration_hours: 0,
      actual_duration_hours: 0,
      overtime_hours: 0,
      overtime_rate: 0,
      base_fee: 0,
      service_rate: 0,
      overtime_charge: 0,
      total_charge: 0,
      status: "Pending",
      notes: f.remarks || "",
      dispatched_by: session?.user?.email || "",
      review_status: "Draft",
      review_comment: "",
      reviewed_by: "",
      reviewed_at: null,
      irregularity_id: null,
      created_at: "",
      updated_at: "",
      flightMeta: f,
    };
    setIsNewReport(true);
    setEditRow(blankRow);
  };


  // Fetch ALL security contract rates (used for receivables on-the-fly amount computation)
  const { data: allRates = [] } = useQuery({
    queryKey: ["contract_service_rates", "security-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_service_rates")
        .select(SECURITY_RATE_LIST_COLUMNS);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!session && isReceivablesView,
    staleTime: 5 * 60_000,
    gcTime: 20 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Active security contracts — used to auto-resolve the contract for a
  // dispatch row when it wasn't explicitly linked at creation (so the AMOUNT
  // column matches what the Edit dialog computes, which auto-picks the sole
  // active Security contract for the airline).
  const { data: securityContractsAll = [] } = useQuery({
    queryKey: ["security-contracts-all-for-charges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("id, airline, service_category, status")
        .in("service_category", ["Security", "Both"])
        .eq("status", "Active");
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!session && isReceivablesView,
    staleTime: 5 * 60_000,
    gcTime: 20 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // airline (lowercased) → contract_id, only when the airline has exactly ONE
  // active security contract. Mirrors the auto-pick behaviour in
  // SecurityTaskSheetDialog.tsx.
  const airlineToContractId = useMemo(() => {
    const first = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const c of securityContractsAll as any[]) {
      const k = String(c.airline || "").toLowerCase().trim();
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!first.has(k)) first.set(k, c.id);
    }
    const out = new Map<string, string>();
    for (const [k, id] of first) if (counts.get(k) === 1) out.set(k, id);
    return out;
  }, [securityContractsAll]);

  const ratesByContractId = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const rate of allRates as any[]) {
      const contractId = String(rate.contract_id || "");
      if (!contractId) continue;
      const bucket = map.get(contractId) || [];
      bucket.push(rate);
      map.set(contractId, bucket);
    }
    return map;
  }, [allRates]);


  // Update mutation for editing service report details
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<DispatchRow> & { id: string }) => {
      const { id, ...rest } = updates;
      const { error } = await supabase
        .from("dispatch_assignments")
        .update(rest as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] });
      queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"] });
      toast({ title: "Updated", description: "Service report updated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Create mutation for new service reports
  const createMutation = useMutation({
    mutationFn: async (data: Partial<DispatchRow>) => {
      const { id, created_at, updated_at, ...rest } = data as any;
      // Phase 3B.0.6: dispatch INSERT goes through resolver in
      // "dispatch_assignments" mode, which STRIPS legacy mirror keys
      // (flight_no, station, airline, service_type, aircraft_type) from the
      // payload. Display values are derived from v_dispatch_with_flight.
      const hardened = await resolveFlightMasterForWrite(
        rest,
        rest?.flight_schedule_id,
        "dispatch_assignments",
      );
      const { error } = await supabase.from("dispatch_assignments").insert(hardened);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] });
      toast({ title: "Created", description: "New security service report created." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openNewForm = () => {
    const blankRow: DispatchRow = {
      id: "new",
      flight_schedule_id: null,
      contract_id: null,
      station: userStation || "CAI",
      airline: "",
      flight_no: "",
      flight_date: new Date().toISOString().slice(0, 10),
      service_type: "Arrival Security",
      staff_names: "",
      staff_count: 0,
      scheduled_start: "",
      scheduled_end: "",
      actual_start: "",
      actual_end: "",
      contract_duration_hours: 0,
      actual_duration_hours: 0,
      overtime_hours: 0,
      overtime_rate: 0,
      base_fee: 0,
      service_rate: 0,
      overtime_charge: 0,
      total_charge: 0,
      status: "Pending",
      notes: "",
      dispatched_by: session?.user?.email || "",
      review_status: "Draft",
      review_comment: "",
      reviewed_by: "",
      reviewed_at: null,
      irregularity_id: null,
      created_at: "",
      updated_at: "",
    };
    setIsNewReport(true);
    setEditRow(blankRow);
  };


  const flightStatusById = useMemo(() => {
    const map = new Map<string, string>();
    (dispatches as any[]).forEach((d: any) => {
      const id = d.flight_schedule_id || d.fs_id;
      if (id) map.set(id, d.fs_status || "Pending");
    });
    securityFlights.forEach((f: any) => map.set(f.id, f.status || "Pending"));
    return map;
  }, [dispatches, securityFlights]);

  const flightCreatedViaById = useMemo(() => {
    const map = new Map<string, string>();
    (dispatches as any[]).forEach((d: any) => {
      const id = d.flight_schedule_id || d.fs_id;
      if (id) map.set(id, resolvePipelineCreatedVia(d, d.created_via) || "");
    });
    [...securityFlights, ...pendingApprovalFlights].forEach((f: any) => map.set(f.id, resolvePipelineCreatedVia(f) || ""));
    return map;
  }, [dispatches, securityFlights, pendingApprovalFlights]);

  // Build lookup for flight schedule details (flight no, registration, route, sta, std, dates, aircraft type)
  const flightDetailsById = useMemo(() => {
    const map = new Map<string, { flight_no: string; registration: string; route: string; sta: string; std: string; ata: string; atd: string; skd_type: string; clearance_type: string; arrival_date: string; departure_date: string; aircraft_type: string }>();
    const addFlight = (f: any) => map.set(f.id, {
      flight_no: f.flight_no || "",
      registration: f.registration || "",
      route: f.route || "",
      sta: f.sta || "",
      std: f.std || "",
      ata: "",
      atd: "",
      skd_type: f.skd_type || "",
      clearance_type: f.clearance_type || "",
      arrival_date: f.arrival_date || "",
      departure_date: f.departure_date || "",
      aircraft_type: f.aircraft_type || "",
    });
    (dispatches as any[]).forEach((d: any) => {
      const id = d.flight_schedule_id || d.fs_id;
      if (!id) return;
      map.set(id, {
        flight_no: d.fs_flight_no || d.flight_no || "",
        registration: d.fs_registration || "",
        route: d.fs_route || "",
        sta: d.fs_sta || "",
        std: d.fs_std || "",
        ata: "",
        atd: "",
        skd_type: d.fs_skd_type || "",
        clearance_type: d.fs_clearance_type || d.service_type || "",
        arrival_date: d.fs_arrival_date || d.flight_date || "",
        departure_date: d.fs_departure_date || "",
        aircraft_type: d.fs_aircraft_type || "",
      });
    });
    securityFlights.forEach(addFlight);
    pendingApprovalFlights.forEach(addFlight);
    return map;
  }, [dispatches, securityFlights, pendingApprovalFlights]);

  // Filters
  const { data: dbAirports = [] } = useQuery({
    queryKey: ["airports", "iata-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("airports").select("iata_code").eq("status", "Active");
      if (error) throw error;
      return data;
    },
  });
  const allStations = useMemo(() => {
    const set = new Set<string>();
    dispatches.forEach(d => { if (d.station) set.add(d.station); });
    (dbAirports as any[]).forEach(a => { if (a.iata_code) set.add(a.iata_code); });
    return [...set].sort();
  }, [dispatches, dbAirports]);
  const allServiceTypes = useMemo(() => [...new Set(dispatches.map(d => d.service_type))].sort(), [dispatches]);
  const allAirlines = useMemo(() => {
    const set = new Set<string>();
    dispatches.forEach(r => { if (r.airline) set.add(r.airline); });
    securityFlights.forEach((f: any) => {
      const name = f.airlines?.name || f.handling_agent;
      if (name) set.add(name);
    });
    pendingApprovalFlights.forEach((f: any) => {
      const name = f.airlines?.name || f.handling_agent;
      if (name) set.add(name);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [dispatches, securityFlights, pendingApprovalFlights]);

  // Security tab shows ONLY flights with dispatch_assignments.
  // Clearance-only security flights (no dispatch yet) are NOT shown here.
  // Also deduplicate: when multiple dispatch_assignments exist for the same
  // flight_schedule_id, keep the most-recently-updated one.
  type MergedSecurityRow = DispatchRow & { isPending?: boolean; flightMeta?: any };

  const mergedRows: MergedSecurityRow[] = useMemo(() => {
    const flightById = new Map<string, any>();
    (securityFlights as any[]).forEach(f => flightById.set(f.id, f));
    // Attach flightMeta (with remarks) to dispatched rows too so the
    // deletion/return-to-clearance reason panel can read flight_schedules.remarks.
    const deduped = dedupeDispatchRows(dispatches).map(r => ({
      ...r,
      flightMeta: r.flight_schedule_id ? flightById.get(r.flight_schedule_id) : undefined,
    })) as MergedSecurityRow[];
    // For station-scoped users AND Operations view, also surface flights that
    // don't yet have a dispatch_assignment as Pending security rows so ops can
    // see every station's flights (ASW, RMF, HBE, etc.).
    const shouldSurfacePending = isStationScoped && !!userStation;
    if (!shouldSurfacePending) return deduped;
    const dispatchedFlightIds = new Set(
      deduped.map(r => r.flight_schedule_id).filter(Boolean) as string[]
    );
    const pendingFromFlights: MergedSecurityRow[] = (securityFlights as any[])
      .filter(f => !dispatchedFlightIds.has(f.id))
      .map(f => {
        const airline = (f as any).airlines;
        // Prefer the merged flight_no (e.g. "SM 2917/2982" for turnarounds) over
        // arrival_flight/departure_flight which only carry one leg.
        const flightNo = f.flight_no || f.arrival_flight || f.departure_flight || "";
        return {
          id: `pending-${f.id}`,
          flight_schedule_id: f.id,
          contract_id: null,
          station: f.authority || userStation || "CAI",
          airline: airline?.name || airline?.iata_code || "",
          flight_no: flightNo,
          flight_date: f.arrival_date || f.departure_date || "",
          service_type: f.clearance_type || "Security",
          staff_names: "",
          staff_count: 0,
          scheduled_start: f.sta || "",
          scheduled_end: f.std || "",
          actual_start: "",
          actual_end: "",
          contract_duration_hours: 0,
          actual_duration_hours: 0,
          overtime_hours: 0,
          overtime_rate: 0,
          base_fee: 0,
          service_rate: 0,
          overtime_charge: 0,
          total_charge: 0,
          status: "Pending",
          notes: "",
          dispatched_by: "",
          review_status: "Draft",
          review_comment: "",
          reviewed_by: "",
          reviewed_at: null,
          irregularity_id: null,
          created_at: f.created_at || "",
          updated_at: f.updated_at || "",
          created_via: resolvePipelineCreatedVia(f),
          isPending: true,
          flightMeta: f,
        } as MergedSecurityRow;
      });
    return [...deduped, ...pendingFromFlights];
  }, [dispatches, securityFlights, isStationScoped, userStation, isOperationsView]);

  const filtered = useMemo(() => {
    let rows: MergedSecurityRow[] = mergedRows;
    // Operations sub-tab: filter to Modified reports (when explicitly selected)
    if (isOperationsView && opsTab === "modified") {
      rows = rows.filter(r => !r.isPending && r.review_status === "Modified");
    }
    // Station "Rejected" tab
    if (isStationView && stationTab === "rejected") rows = rows.filter(r => r.review_status === "Rejected");
    if (reviewIdsFilter && reviewIdsFilter.length > 0) {
      const set = new Set(reviewIdsFilter);
      rows = rows.filter(r => set.has(r.id));
    }
    if (stationFilter !== "All Stations") rows = rows.filter(r => r.station === stationFilter);
    if (airlineFilter !== "All Airlines") rows = rows.filter(r => r.airline === airlineFilter);
    if (statusFilter !== "All") rows = rows.filter(r => getWorkflowDispatchStatus(r) === statusFilter);
    if (serviceFilter !== "All Types") rows = rows.filter(r => r.service_type === serviceFilter);
    if (stepFilter !== "All Steps") {
      const [mode, stage] = stepFilter.split(":") as ["at" | "done", any];
      rows = rows.filter(r => {
        const workflowStatus = getWorkflowDispatchStatus(r);
        const invStatus = (invoiceStatusByFlight.get(normalizeFlightKey(String(r.flight_no || ""))) || "none") as "none" | "issued" | "paid";
        const opts = {
          isLinked: workflowStatus === "Completed",
          reviewStatus: r.review_status,
          clearanceStatus: r.flight_schedule_id ? flightStatusById.get(r.flight_schedule_id) : undefined,
          dispatchStatus: workflowStatus,
          invoiceStatus: invStatus,
          chargesSaved: hasSavedSecurityCharges(r as any),
          createdVia: resolvePipelineCreatedVia(r, (r as any).flightMeta, r.flight_schedule_id ? flightCreatedViaById.get(r.flight_schedule_id) : undefined),
        };
        return mode === "done"
          ? derivePipelineCompletedStages(opts).includes(stage)
          : derivePipelineStage({ ...opts, channel: activeChannel }) === stage;
      });
    }
    // Period filtering uses the FS-authoritative date so this list and the
    // generated invoice always agree on which month a flight belongs to.
    if (dateFrom) rows = rows.filter(r => resolveBillingDate(r as any) >= dateFrom);
    if (dateTo) rows = rows.filter(r => resolveBillingDate(r as any) <= dateTo);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r => {
        const reg = r.flight_schedule_id ? (flightDetailsById.get(r.flight_schedule_id)?.registration || "") : "";
        return (
          (r.airline || "").toLowerCase().includes(s) ||
          (r.flight_no || "").toLowerCase().includes(s) ||
          (r.staff_names || "").toLowerCase().includes(s) ||
          (r.station || "").toLowerCase().includes(s) ||
          reg.toLowerCase().includes(s)
        );
      });
    }
    // Sort by the same display date shown in the table, falling back to the
    // departure date when the flight has no arrival date so departure-only
    // Security rows are ordered by their actual service date.
    const ascending = true;
    return [...rows].sort((a, b) => {
      const aMeta = (a as any).flightMeta;
      const bMeta = (b as any).flightMeta;
      const aFd = a.flight_schedule_id ? flightDetailsById.get(a.flight_schedule_id) : undefined;
      const bFd = b.flight_schedule_id ? flightDetailsById.get(b.flight_schedule_id) : undefined;
      const aDisplay = resolveSecurityRowDisplay(a as any, aFd, aMeta);
      const bDisplay = resolveSecurityRowDisplay(b as any, bFd, bMeta);
      const ad = aDisplay.arrivalDate || aDisplay.departureDate || "";
      const bd = bDisplay.arrivalDate || bDisplay.departureDate || "";
      if (ad !== bd) {
        if (!ad) return 1;
        if (!bd) return -1;
        return ascending ? ad.localeCompare(bd) : bd.localeCompare(ad);
      }
      const at = aDisplay.sta || aDisplay.std || "";
      const bt = bDisplay.sta || bDisplay.std || "";
      if (at !== bt) {
        if (!at) return 1;
        if (!bt) return -1;
        return at.localeCompare(bt);
      }
      return (a.flight_no || "").localeCompare(b.flight_no || "") || (a.id || "").localeCompare(b.id || "");
    });
  }, [mergedRows, stationFilter, airlineFilter, statusFilter, stepFilter, serviceFilter, dateFrom, dateTo, search, isOperationsView, isStationView, isReceivablesView, stationTab, opsTab, flightDetailsById, reviewIdsFilter, invoiceStatusByFlight, flightStatusById, flightCreatedViaById, activeChannel]);

  
  

  // KPIs (computed from the merged/filtered list)
  const totalReports = filtered.length;
  const completedReports = filtered.filter(r => getWorkflowDispatchStatus(r) === "Completed").length;
  const approvedReports = filtered.filter(r => r.review_status === "Approved" || r.review_status === "Ready for Billing").length;
  const totalOvertimeHrs = filtered.reduce((s, r) => s + (r.overtime_hours || 0), 0);
  const totalStaffDeployed = filtered.reduce((s, r) => s + (r.staff_count || 0), 0);
  const pendingReview = filtered.filter(r => r.review_status === "Pending Review").length;
  const readyForBilling = filtered.filter(r => r.review_status === "Ready for Billing").length;

  // Pending Approval tab: filtered list + stats
  const filteredPendingFlights = useMemo(() => {
    let rows = [...pendingApprovalFlights];
    if (pendingStationFilter !== "All Stations") rows = rows.filter((f: any) => f.authority === pendingStationFilter);
    if (pendingAirlineFilter !== "All Airlines") rows = rows.filter((f: any) => (f.airlines?.name || f.handling_agent || "") === pendingAirlineFilter);
    if (pendingTypeFilter !== "All Types") rows = rows.filter((f: any) => f.clearance_type === pendingTypeFilter);
    if (pendingStatusFilter !== "All Statuses") rows = rows.filter((f: any) => f.status === pendingStatusFilter);
    if (pendingDateFrom) rows = rows.filter((f: any) => (f.arrival_date || f.departure_date || f.flight_date || "") >= pendingDateFrom);
    if (pendingDateTo) rows = rows.filter((f: any) => (f.arrival_date || f.departure_date || f.flight_date || "") <= pendingDateTo);
    if (pendingSearch) {
      const s = pendingSearch.toLowerCase();
      rows = rows.filter((f: any) =>
        (f.flight_no || "").toLowerCase().includes(s) ||
        (f.airlines?.name || f.handling_agent || "").toLowerCase().includes(s) ||
        (f.registration || "").toLowerCase().includes(s) ||
        (f.route || "").toLowerCase().includes(s) ||
        (f.authority || "").toLowerCase().includes(s)
      );
    }
    // Order by arrival date (falling back to departure date when the flight
    // has no arrival), then by STA (falling back to STD) — matches the main
    // Operations list ordering for a consistent pending-approval view.
    rows.sort((a: any, b: any) => {
      const ad = a.arrival_date || a.departure_date || "";
      const bd = b.arrival_date || b.departure_date || "";
      if (ad !== bd) {
        if (!ad) return 1;
        if (!bd) return -1;
        return ad.localeCompare(bd);
      }
      const at = a.sta || a.std || "";
      const bt = b.sta || b.std || "";
      if (at !== bt) {
        if (!at) return 1;
        if (!bt) return -1;
        return at.localeCompare(bt);
      }
      return (a.id || "").localeCompare(b.id || "");
    });
    return rows;
  }, [pendingApprovalFlights, pendingStationFilter, pendingAirlineFilter, pendingTypeFilter, pendingStatusFilter, pendingDateFrom, pendingDateTo, pendingSearch]);

  const { pageRows: pagePending, ...pagPending } = usePagination(filteredPendingFlights, { resetKey: [pendingSearch, pendingStationFilter, pendingAirlineFilter, pendingTypeFilter, pendingStatusFilter, pendingDateFrom, pendingDateTo] });
  const { pageRows: pageData, ...pagMain } = usePagination(filtered, { resetKey: [filtered.length, airlineFilter, stationFilter, serviceFilter, statusFilter, stepFilter, dateFrom, dateTo, search] });



  const todayStr = new Date().toISOString().slice(0, 10);
  const pendingTotal = filteredPendingFlights.length;
  const pendingToday = filteredPendingFlights.filter((f: any) => (f.arrival_date || f.departure_date || f.flight_date || "") === todayStr).length;
  const pendingStationsCount = new Set(filteredPendingFlights.map((f: any) => f.authority).filter(Boolean)).size;
  const pendingAirlinesCount = new Set(filteredPendingFlights.map((f: any) => f.airlines?.name || f.handling_agent).filter(Boolean)).size;

  const linkedIrregularities = useMemo(() => {
    const map = new Map<string, typeof irregularities[0]>();
    irregularities.forEach(ir => map.set(ir.id, ir));
    return map;
  }, [irregularities]);

  // Map dispatch service_type → contract flight_type
  const mapServiceTypeToFlightType = (st: string): string => {
    const s = (st || "").toLowerCase();
    if (s.includes("turnaround")) return "Turnaround";
    if (s.includes("maintenance")) return "Maintenance Security";
    if (s.includes("departure")) return "Departure Security";
    if (s.includes("arrival")) return "Arrival Security";
    return st || "Turnaround";
  };

  // Compute live amount/currency for a row from the linked contract's rates.
  // Used in the receivables view to always show an up-to-date charge even
  // when the saved record hasn't been recomputed since the contract changed.
  const computeRowCharges = useCallback((r: DispatchRow) => {
    // Delegates to the shared resolver in @/lib/securityRowCharges so the
    // Invoices billing previews compute the exact same amount.
    const fd = r.flight_schedule_id ? flightDetailsById.get(r.flight_schedule_id) : undefined;
    const meta = (r as any).flightMeta;
    const skd = (fd?.skd_type || meta?.skd_type || "") as string;
    const res = computeLiveSecurityCharge(r as any, {
      ratesByContractId,
      airlineToContractId,
      skdType: skd,
    });
    return { amount: res.amount, currency: res.currency, lines: res.lines };
  }, [ratesByContractId, airlineToContractId, flightDetailsById]);


  // Total Charges KPI must match what the AMOUNT column shows per row:
  // prefer live-computed charges, fall back to persisted total_security_charges,
  // then legacy total_charge. Pending rows (no dispatch yet) contribute 0.
  const totalRevenue = filtered.reduce((s, r) => {
    if ((r as any).isPending) return s;
    const live = computeRowCharges(r).amount || 0;
    const saved = Number((r as any).total_security_charges || 0);
    const legacy = Number(r.total_charge || 0);
    return s + (live > 0 ? live : saved > 0 ? saved : legacy);
  }, 0);


  const saveEdit = () => {};

  const [bulkSaving, setBulkSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Local override: dispatch IDs that were just saved via "Save All Security Charges".
  // Used to mark Receivables (step 4) of the pipeline complete immediately for
  // those rows — without waiting for an invoice to be paid.
  const [chargesSavedIds, setChargesSavedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Receivables bulk action: compute & persist Security Charges for ALL eligible
  // rows (Station + Operations done) in one click — instead of opening Edit
  // dialog per flight to press "Save Security Charges".
  const saveAllSecurityCharges = async () => {
    // Source from the full merged list constrained ONLY by the selected
    // date-from / date-to period (and station scope when applicable), so the
    // bulk action targets every flight in the chosen period — not just what
    // the current tab / status / service filters happen to show.
    let scope: MergedSecurityRow[] = mergedRows;
    if (dateFrom) scope = scope.filter(r => resolveBillingDate(r as any) >= dateFrom);
    if (dateTo) scope = scope.filter(r => resolveBillingDate(r as any) <= dateTo);
    let eligible = scope.filter(r => {
      if ((r as any).isPending) return false;
      const reviewDone = (r.review_status || "").toLowerCase() === "approved" || (r.review_status || "").toLowerCase().includes("billing");
      return getWorkflowDispatchStatus(r) === "Completed" && reviewDone && r.contract_id;
    });
    // If the user has selected specific rows, restrict the action to those.
    if (selectedIds.size > 0) {
      eligible = eligible.filter(r => selectedIds.has(r.id));
    }
    if (eligible.length === 0) {
      toast({
        title: "No eligible flights",
        description: selectedIds.size > 0
          ? "None of the selected flights are eligible. Only completed & operations-approved flights with a linked contract can be auto-billed."
          : "Only completed & operations-approved flights with a linked contract can be auto-billed.",
        variant: "destructive",
      });
      return;
    }
    setBulkSaving(true);
    let ok = 0, skipped = 0, failed = 0;
    const savedIds: string[] = [];
    for (const r of eligible) {
      const c = computeRowCharges(r);
      if (!c.amount) { skipped++; continue; }
      const { data, error } = await supabase.from("dispatch_assignments").update({
        charges_breakdown: c.lines,
        total_security_charges: c.amount,
        charges_currency: c.currency,
        review_status: "Ready for Billing",
        reviewed_by: RECEIVABLES_REVIEWER,
        reviewed_at: new Date().toISOString(),
        // Durable Receivables marker — step 4 stays complete after sign-out/in.
        charges_saved_at: new Date().toISOString(),
      } as any).eq("id", r.id).select("id");
      if (error || !data || data.length === 0) failed++;
      else { ok++; savedIds.push(r.id); }
    }
    setBulkSaving(false);
    // Mark these rows as receivables-complete locally so the pipeline shows
    // step 4 done immediately (without waiting for the invoice to be paid).
    if (savedIds.length) {
      setChargesSavedIds(prev => {
        const next = new Set(prev);
        savedIds.forEach(id => next.add(id));
        return next;
      });
    }
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] });
    toast({
      title: failed ? "Completed with errors" : "✅ All charges saved",
      description: `${ok} saved, ${skipped} skipped (no rate), ${failed} failed. Marked Ready for Billing — pipeline step 4 complete.`,
      variant: failed ? "destructive" : undefined,
    });
  };


  const saveTaskSheet = async (row: DispatchRow, taskSheet: any, options?: { close?: boolean }) => {
    const closeAfter = options?.close !== false;
    // Synthetic pending rows (id "pending-<fs-uuid>") are not real dispatch_assignments
    // yet — treat them as new completions so we INSERT instead of UPDATE by a bogus uuid.
    const isSyntheticPending =
      typeof row.id === "string" && row.id.startsWith("pending-");
    if (isSyntheticPending) {
      row = { ...row, id: "new" } as DispatchRow;
      if (!isNewReport) setIsNewReport(true);
    }
    // Station-scoped users: the station on the report is ALWAYS the user's
    // own station, regardless of what the flight route says. This ensures the
    // saved row shows under this station in the station filter.
    if (isStationScoped && userStation) {
      row = { ...row, station: userStation } as DispatchRow;
    }
    // Use a local flag so the branch logic below works on the first call even
    // before the setIsNewReport above flushes to state.
    const effectiveIsNew = isNewReport || isSyntheticPending;
    const shiftStart = taskSheet.shift_start || row.actual_start || "";
    const shiftEnd = taskSheet.shift_end || row.actual_end || "";
    const actualMins = timeDiffMinutes(shiftStart, shiftEnd);
    const duration = minutesToHMM(actualMins);
    const contractMins = Math.round((row.contract_duration_hours || 0) * 60);
    const overtimeMins = Math.max(0, actualMins - contractMins);
    // Any fractional hour of OT is rounded UP to a full hour for billing.
    const billedOtHours = Math.ceil(overtimeMins / 60);
    const overtimeHours = billedOtHours; // displayed as whole hours
    const overtimeCharge = billedOtHours * (row.overtime_rate || 0) * (row.staff_count || 1);
    const totalCharge = (row.base_fee || 0) + (row.service_rate || 0) + overtimeCharge;

    // Detect "completing a clearance flight" case: new dispatch but row already
    // has a flight_schedule_id (came from a pending clearance row).
    const isCompletingClearanceFlight = effectiveIsNew && !!(row as any).flight_schedule_id;
    // If station is editing a previously-rejected report, mark as "Modified" (goes back to ops).
    const isResubmittingRejected = !effectiveIsNew && row.review_status === "Rejected";

    // Detect "service type changed" on an existing linked record. When the
    // station changes the Service Type (clearance_type) for an existing
    // record, the flight needs to go back to Clearance for re-approval.
    const linkedFsId = (row as any).flight_schedule_id;
    const originalClearanceType = linkedFsId
      ? flightDetailsById.get(linkedFsId)?.clearance_type
      : undefined;
    const serviceTypeChanged =
      !effectiveIsNew &&
      !!linkedFsId &&
      !!originalClearanceType &&
      (row.service_type || "").trim().toLowerCase() !==
        (originalClearanceType || "").trim().toLowerCase();
    const normalizedDates = normalizeSecurityDates(row as any, taskSheet || {});

    // ── Phase 3 write-cycle verifier (DEV/DIAGNOSTIC) ──────────────────────
    // Snapshot the authoritative flight_schedules row BEFORE the save so we
    // can deterministically prove persistence + cross-portal consistency
    // after the write returns. Never throws into the save flow.
    const __wcv_fsId = (row as any).flight_schedule_id || null;
    const __wcv_dispatchId = !effectiveIsNew ? (row.id as string) : null;
    const __wcv_snapshot = await snapshotBeforeSave(__wcv_fsId, __wcv_dispatchId).catch(
      () => ({ flight_schedule_id: __wcv_fsId, dispatch_id: __wcv_dispatchId, beforeFs: null }),
    );
    const __wcv_expected = {
      route: taskSheet.route,
      registration: taskSheet.registration,
      aircraft_type: taskSheet.aircraft_type,
      sta: taskSheet.sta,
      std: taskSheet.std,
      arrival_date: normalizedDates.arrivalDate || undefined,
      departure_date: normalizedDates.departureDate || undefined,
      skd_type: isEthiopianAirline(row.airline) ? (flightDetailsById.get(linkedFsId)?.skd_type || undefined) : taskSheet.flight_type,
      clearance_type: row.service_type,
      flight_no: row.flight_no,
    } as const;

    const taskSheetForSave = {
      ...(taskSheet || {}),
      arrival_date: normalizedDates.arrivalDate,
      departure_date: normalizedDates.departureDate,
    };

    const payload: Record<string, any> = {
      task_sheet_data: taskSheetForSave,
      notes: taskSheet.remarks || row.notes,
      actual_start: shiftStart,
      actual_end: shiftEnd,
      actual_duration_hours: duration,
      overtime_hours: overtimeHours,
      overtime_charge: Math.round(overtimeCharge * 100) / 100,
      total_charge: Math.round(totalCharge * 100) / 100,
      // Brand-new reports (no clearance link yet) stay "Pending" until clearance
      // approves the linked flight schedule. Completing a clearance flight or
      // editing an existing report → mark "Completed" so step 2 (Station) is done.
      // EXCEPTION: if Service Type changed, send the dispatch back to "Pending"
      // so the pipeline reverts to step 1 (Clearance) for re-approval.
      // Saving the task sheet always marks Station (step 2) as complete.
      // EXCEPTION: if Service Type changed on an existing linked clearance flight,
      // send the dispatch back to "Pending" so the pipeline reverts to step 1.
      status: serviceTypeChanged ? "Pending" : "Completed",
      station: row.station,
      airline: row.airline,
      flight_no: row.flight_no,
      flight_date: normalizedDates.flightDate,
      service_type: row.service_type,
      staff_names: row.staff_names,
      staff_count: row.staff_count,
      scheduled_start: taskSheet.sta || row.scheduled_start,
      scheduled_end: taskSheet.std || row.scheduled_end,
      dispatched_by: row.dispatched_by,
      // Security contract linkage + auto-calculated charges (from dialog)
      contract_id: (row as any).contract_id || null,
      extra_manpower_count: (row as any).extra_manpower_count ?? 0,
      ramp_vehicle_trips: (row as any).ramp_vehicle_trips ?? 0,
      short_notice: (row as any).short_notice ?? false,
      return_to_ramp_with_load: (row as any).return_to_ramp_with_load ?? false,
      charges_breakdown: (row as any).charges_breakdown ?? [],
      total_security_charges: (row as any).total_security_charges ?? 0,
      charges_currency: (row as any).charges_currency || "USD",
      // New reports start in Draft; completing a clearance flight goes straight to Pending Review.
      // Resubmitting a rejected report → "Modified" so it appears under Operations → Modified tab.
      // Service Type change → "Draft" (returns to clearance, removes from ops queue).
      // New reports go straight to Pending Review (Operations queue) — step 2 (Station) done.
      // Resubmitting a rejected report → "Modified" so it appears under Operations → Modified tab.
      // Service Type change → "Draft" (returns to clearance, removes from ops queue).
      ...(effectiveIsNew
        ? { review_status: "Pending Review" }
        : isResubmittingRejected
          ? { review_status: "Modified" }
          : serviceTypeChanged
            ? { review_status: "Draft", reviewed_at: null, reviewed_by: "", review_comment: "" }
            : // Plain edit of an existing record: if it was still Draft (auto-created
              // by clearance approval and never submitted), promote it to "Pending Review"
              // so step 2 (Station) is marked complete in the pipeline.
              (row.review_status === "Draft" || !row.review_status)
                ? { review_status: "Pending Review" }
                : {}),
      ...(isReceivablesView
        ? {
            review_status: "Ready for Billing",
            reviewed_by: RECEIVABLES_REVIEWER,
            reviewed_at: new Date().toISOString(),
            charges_saved_at: new Date().toISOString(),
          }
        : {}),
    };

    let insertedDispatch: any = null;
    try {
      if (isCompletingClearanceFlight) {
        // Reuse the existing clearance flight schedule — just create the dispatch
        // record linked to it. Step 2 (Station) is now complete.
        // Phase 6.5: strip legacy mirror keys (flight_no/station/airline/service_type/aircraft_type)
        // before INSERT — display values resolve via v_dispatch_with_flight at read time.
        const dispatchInsertRaw = { ...payload, flight_schedule_id: (row as any).flight_schedule_id };
        const dispatchInsert = await resolveFlightMasterForWrite(
          dispatchInsertRaw,
          (row as any).flight_schedule_id,
          "dispatch_assignments",
          "insert",
        );
        const { data: insRow1, error: dispatchErr } = await supabase
          .from("dispatch_assignments")
          .insert(dispatchInsert as any)
          .select("*")
          .single();
        if (dispatchErr) throw dispatchErr;
        insertedDispatch = insRow1;
        // Sync ALL task-sheet fields back to the linked flight_schedule so the
        // station's edits to Registration / Route / Aircraft Type / STA / STD /
        // SKD type / Service Type are reflected everywhere (list views read REG
        // from flight_schedules when a dispatch is linked).
        const fsSync: Record<string, any> = {
          arrival_date: normalizedDates.arrivalDate || null,
          departure_date: normalizedDates.departureDate || null,
          status: "Approved",
        };
        if (taskSheet.registration !== undefined) fsSync.registration = taskSheet.registration || "";
        if (taskSheet.route !== undefined) fsSync.route = taskSheet.route || "";
        if (taskSheet.aircraft_type !== undefined) fsSync.aircraft_type = taskSheet.aircraft_type || "";
        if (taskSheet.sta !== undefined) fsSync.sta = taskSheet.sta || "";
        if (taskSheet.std !== undefined) fsSync.std = taskSheet.std || "";
        if (!isEthiopianAirline(row.airline) && taskSheet.flight_type) fsSync.skd_type = taskSheet.flight_type;
        if (row.service_type) fsSync.clearance_type = row.service_type;
        // Station-scoped users: force authority to the user's station so the
        // flight appears under that station in every portal's station filter.
        if (isStationScoped && userStation) fsSync.authority = userStation;
        const { error: fsSyncErr } = await supabase
          .from("flight_schedules")
          .update(fsSync as any)
          .eq("id", (row as any).flight_schedule_id);
        if (fsSyncErr && fsSyncErr.code !== "23505") throw fsSyncErr;
        toast({ title: "Task Sheet Saved", description: "Step 2 (Station) complete — sent for Operations review." });
      } else if (effectiveIsNew) {
        // Create the dispatch + clearance flight_schedule together, then link them.
        // 1. Look up airline_id by name
        const { data: airlineData } = await supabase
          .from("airlines")
          .select("id")
          .eq("name", row.airline)
          .maybeSingle();

        // 2. Create flight_schedule for Operations approval (Pending)
        const clearancePayload: Record<string, any> = {
          flight_no: row.flight_no,
          aircraft_type: taskSheet.aircraft_type || "",
          registration: taskSheet.registration || "",
          route: taskSheet.route || "",
          sta: taskSheet.sta || "",
          std: taskSheet.std || "",
          skd_type: isEthiopianAirline(row.airline) ? "" : (taskSheet.flight_type || ""),
          clearance_type: row.service_type || "Arrival Security",
          status: "Approved" as const,
          // Station-scoped users: always stamp the flight with their own station,
          // never the form fallback — prevents flights created under the wrong station.
          authority: (isStationScoped && userStation) ? userStation : (row.station || "CAI"),
          handling_agent: "",
          arrival_date: normalizedDates.arrivalDate || null,
          departure_date: normalizedDates.departureDate || null,
          remarks: "Added from Security Service – pending Operations approval",
          notes: "",
          purpose: "Security Service",
          created_via: "station",
        };
        if (airlineData?.id) clearancePayload.airline_id = airlineData.id;

        const { data: createdFlight, error: flightErr } = await supabase
          .from("flight_schedules")
          .insert(clearancePayload as any)
          .select("id")
          .single();
        if (flightErr) throw flightErr;

        // 3. Insert dispatch with link to the flight_schedule
        // Phase 6.5: strip legacy mirror keys before INSERT.
        const dispatchInsertRaw = { ...payload, flight_schedule_id: createdFlight?.id || null, created_via: "station" };
        const dispatchInsert = await resolveFlightMasterForWrite(
          dispatchInsertRaw,
          createdFlight?.id || null,
          "dispatch_assignments",
          "insert",
        );
        const { data: insRow2, error: dispatchErr } = await supabase
          .from("dispatch_assignments")
          .insert(dispatchInsert as any)
          .select("*")
          .single();
        if (dispatchErr) throw dispatchErr;
        insertedDispatch = insRow2;

        toast({ title: "Submitted for Operations", description: "Report sent to Operations for approval." });
      } else {
        // Editing an existing dispatch. Always sync changed fields back to the
        // linked flight_schedule. If the Service Type changed, reset the schedule
        // to Pending so the flight returns to Operations → Pending Approval.
        // 1. Update the dispatch
        // Phase 6.5: strip legacy mirror keys before UPDATE.
        const dispatchUpdate = await resolveFlightMasterForWrite(
          payload,
          linkedFsId,
          "dispatch_assignments",
          "update",
        );
        const { error: dispatchErr } = await supabase
          .from("dispatch_assignments")
          .update(dispatchUpdate as any)
          .eq("id", row.id);
        if (dispatchErr) throw dispatchErr;

        // 2. Sync changes back to the linked flight_schedule (if any)
        if (linkedFsId) {
          const fsUpdate: Record<string, any> = {
            flight_no: row.flight_no,
            clearance_type: row.service_type,
            registration: taskSheet.registration || "",
            route: taskSheet.route || "",
            aircraft_type: taskSheet.aircraft_type || "",
            sta: taskSheet.sta || "",
            std: taskSheet.std || "",
            skd_type: isEthiopianAirline(row.airline) ? (flightDetailsById.get(linkedFsId)?.skd_type || "") : (taskSheet.flight_type || ""),
            arrival_date: normalizedDates.arrivalDate || null,
            departure_date: normalizedDates.departureDate || null,
          };
          // Service Type change → revert clearance to Pending (re-approval needed)
          if (serviceTypeChanged) {
            fsUpdate.status = "Pending";
            fsUpdate.remarks = "Service Type changed by Station — Operations re-approval required";
          }
          const { error: fsErr } = await supabase
            .from("flight_schedules")
            .update(fsUpdate as any)
            .eq("id", linkedFsId);
          if (fsErr?.code === "23505") {
            // Route/date/service changes can collide with the no-duplicate-flight
            // rule. Still persist the non-unique task-sheet fields so REG edits
            // are never lost or hidden behind the old linked schedule value.
            const { error: fallbackFsErr } = await supabase
              .from("flight_schedules")
              .update({
                registration: taskSheet.registration || "",
                aircraft_type: taskSheet.aircraft_type || "",
                sta: taskSheet.sta || "",
                std: taskSheet.std || "",
                ...(isEthiopianAirline(row.airline) ? {} : { skd_type: taskSheet.flight_type || "" }),
              } as any)
              .eq("id", linkedFsId);
            if (fallbackFsErr) throw fallbackFsErr;
          } else if (fsErr) throw fsErr;

          // ── Persistence guard ───────────────────────────────────────────
          // flight_schedules is the single source of truth for STA/STD/REG/
          // route/dates, and every record list reads it. If the update above
          // silently affected no rows (row-level protection, locked flight,
          // permission scope), the task sheet would keep the new value while
          // the record shows the old one. Verify and tell the user instead of
          // losing the edit quietly.
          const { data: fsAfter } = await supabase
            .from("flight_schedules")
            .select("sta,std,registration,route,arrival_date,departure_date")
            .eq("id", linkedFsId)
            .maybeSingle();
          if (fsAfter) {
            const same = (a: any, b: any) =>
              String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();
            const drifted: string[] = [];
            if (!same(fsAfter.sta, fsUpdate.sta)) drifted.push("STA");
            if (!same(fsAfter.std, fsUpdate.std)) drifted.push("STD");
            if (!same(fsAfter.registration, fsUpdate.registration)) drifted.push("Registration");
            if (!same(fsAfter.route, fsUpdate.route)) drifted.push("Route");
            if (!same(fsAfter.arrival_date, fsUpdate.arrival_date)) drifted.push("Arrival Date");
            if (!same(fsAfter.departure_date, fsUpdate.departure_date)) drifted.push("Departure Date");
            if (drifted.length) {
              toast({
                variant: "destructive",
                title: "Flight details not saved",
                description: `${drifted.join(", ")} could not be changed on this flight (it may be approved or already invoiced). The record still shows the previous value.`,
              });
            }
          }
        }

        if (serviceTypeChanged) {
          toast({
            title: "Returned to Operations",
            description: "Service Type changed — flight sent back to Operations → Pending Approval.",
          });
        } else {
          toast({ title: "Task Sheet Updated", description: "Changes saved and synced to Operations." });
        }
      }

      // Patch local caches and mark them stale without forcing a heavy refetch
      // before close. Awaiting invalidations here was blocking save/approve on
      // the full Operations data set.
      const savedDispatch = insertedDispatch || { ...row, ...payload, id: row.id, flight_schedule_id: linkedFsId };
      const patchSavedDispatch = (old: any) => {
        if (!Array.isArray(old) || !savedDispatch?.id) return old;
        const exists = old.some((item: any) => item?.id === savedDispatch.id);
        const next = old.map((item: any) => item?.id === savedDispatch.id ? { ...item, ...savedDispatch } : item);
        return exists ? next : [savedDispatch, ...next];
      };
      queryClient.setQueriesData({ queryKey: ["dispatch_assignments"] }, patchSavedDispatch);
      queryClient.setQueriesData({ queryKey: ["v_dispatch_with_flight"] }, patchSavedDispatch);
      queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"], refetchType: "none" as any });
      queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"], refetchType: "none" as any });
      queryClient.invalidateQueries({ queryKey: ["flight_schedules"], refetchType: "none" as any });
      if (isReceivablesView && !effectiveIsNew) {
        setChargesSavedIds(prev => {
          const next = new Set(prev);
          next.add(row.id);
          return next;
        });
      }

      // Phase 3 write-cycle verifier — runs after caches invalidate so the
      // re-fetch hits the database, not a stale cache. Result is logged and
      // pushed to the verifier store; the dialog reads it for the badge.
      const __wcv_fsIdAfter =
        (insertedDispatch as any)?.flight_schedule_id || __wcv_snapshot.flight_schedule_id;
      const __wcv_dispatchIdAfter =
        (insertedDispatch as any)?.id || __wcv_snapshot.dispatch_id;
      if (__wcv_fsIdAfter) {
        verifyAfterSave({
          snapshot: {
            flight_schedule_id: __wcv_fsIdAfter,
            dispatch_id: __wcv_dispatchIdAfter,
            beforeFs: __wcv_snapshot.beforeFs,
          },
          expected: __wcv_expected,
          airline_id: null,
        }).catch((err) => console.warn("[WRITE_CYCLE_VALIDATION] verifier error:", err));
      }
      if (closeAfter) {
        setEditRow(null);
        setIsNewReport(false);
      } else if (effectiveIsNew && insertedDispatch) {
        // Rebind dialog to the newly-inserted record so the next "Save" updates it.
        setEditRow(insertedDispatch as any);
        setIsNewReport(false);
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      // Keep the dialog open with the user's edits intact so they can retry.
      throw e;
    }
  };

  // Submit for review
  const submitForReview = (row: DispatchRow) => {
    updateMutation.mutate({ id: row.id, review_status: "Pending Review" });
  };

  // Review actions
  const handleReviewAction = async (action: "Approved" | "Rejected") => {
    if (!reviewRow) return;
    // Approving a "Modified" report (resubmitted after rejection) goes straight to Ready for Billing.
    const finalStatus =
      action === "Approved" && reviewRow.review_status === "Modified" ? "Ready for Billing" : action;
    const reviewer = session?.user?.email || "Reviewer";
    const reviewedAt = new Date().toISOString();
    const targetRow = reviewRow;
    const targetFlightId = reviewRow.flight_schedule_id;

    // Close the dialog + patch the cache immediately so the UI feels instant.
    // All DB writes and refetches happen in the background — the previous
    // implementation awaited three sequential UPDATEs plus three heavy
    // refetches, which took ~20s on large datasets.
    if (action === "Approved") {
      syncApprovedStatusCache({
        dispatchId: targetRow.id,
        flightId: targetFlightId,
        reviewStatus: finalStatus,
        reviewedBy: reviewer,
        reviewedAt,
      });
    }
    setReviewRow(null);
    setReviewComment("");

    // Fire-and-forget: approval uses one atomic backend action. Refetches are
    // invalidated in the background without forcing the heavy lists to reload.
    (async () => {
      try {
        if (action === "Approved") {
          const { error } = await (supabase as any).rpc("approve_security_service_report", {
            _dispatch_id: targetRow.id,
            _flight_schedule_id: targetFlightId || null,
            _review_comment: reviewComment,
            _reviewed_by: reviewer,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("dispatch_assignments")
            .update({
              review_status: finalStatus,
              review_comment: reviewComment,
              reviewed_by: reviewer,
              reviewed_at: reviewedAt,
            } as any)
            .eq("id", targetRow.id);
          if (error) throw error;
        }

        toast({
          title: action === "Approved" ? "Approved" : "Rejected",
          description: "Review saved.",
        });

        // Background invalidation — no forced refetch on the heavy lists.
        queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"], refetchType: "none" as any });
        queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"], refetchType: "none" as any });
        if (action === "Approved") {
          queryClient.invalidateQueries({ queryKey: ["flight_schedules"], refetchType: "none" as any });
        } else {
          // Newly rejected report must surface in Operations › Rejected Reports.
          queryClient.invalidateQueries({ queryKey: ["flight_schedules", "ops-rejected-reports"] });
        }

      } catch (e: any) {
        toast({ title: "Error", description: e?.message || "Save failed", variant: "destructive" });
      }
    })();
  };

  const markReadyForBilling = (row: DispatchRow) => {
    updateMutation.mutate({ id: row.id, review_status: "Ready for Billing" });
  };

  // Export — fetches the latest dispatch_assignments + flight_schedules
  // directly from the DB so the exported rows always match what is currently
  // stored. The React Query cache has a 30s staleTime AND the merged
  // `filtered` rows are derived from a snapshot that may pre-date a recent
  // save, so we re-read both tables before serializing.
  // ATA/ATD and every other field are sourced strictly from saved DB data;
  // dialog props / local UI state are never used as fallbacks.
  const handleExport = async () => {
    // Refresh React Query first so anything still bound to the cache (table,
    // KPIs) updates as well.
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["dispatch_assignments"] }),
        queryClient.refetchQueries({ queryKey: ["flight_schedules"] }),
      ]);
    } catch (err) {
      console.warn("[export] refetch failed, falling back to direct fetch", err);
    }

    // Pull authoritative DB rows for the IDs currently in scope.
    const realIds = filtered.filter(r => !r.isPending && r.id && !r.id.startsWith("pending-")).map(r => r.id);
    const flightIds = Array.from(new Set(filtered.map(r => r.flight_schedule_id).filter(Boolean) as string[]));

    let freshDispatch: any[] = [];
    let freshFlights: any[] = [];
    try {
      const [d, f] = await Promise.all([
        realIds.length
          ? supabase.from("dispatch_assignments").select("*").in("id", realIds).then(r => r.data || [])
          : Promise.resolve([] as any[]),
        flightIds.length
          ? supabase.from("flight_schedules").select("*").in("id", flightIds).then(r => r.data || [])
          : Promise.resolve([] as any[]),
      ]);
      freshDispatch = d;
      freshFlights = f;
    } catch (err) {
      console.warn("[export] direct DB fetch failed, using cached rows", err);
    }
    const dispatchById = new Map(freshDispatch.map((r: any) => [r.id, r]));
    const flightById = new Map(freshFlights.map((r: any) => [r.id, r]));

    // Column order mirrors the on-screen record table exactly (STATION →
    // PIPELINE), then appends the detailed task-sheet fields. Every displayed
    // value (duration, OT, AMOUNT) is derived with the SAME helpers the table
    // uses, so the exported file can never drift from the screen.
    const rows = filtered.map((r) => {
      const dbRow: any = dispatchById.get(r.id) || r;
      const dbFlight: any = (r.flight_schedule_id && flightById.get(r.flight_schedule_id)) || (r as any).flightMeta || null;
      const f = resolveDownloadFields(dbRow, dbFlight);
      const fd = r.flight_schedule_id ? flightDetailsById.get(r.flight_schedule_id) : undefined;
      const disp = resolveSecurityRowDisplay(dbRow as any, fd, (r as any).flightMeta);
      const workflowStatus = getWorkflowDispatchStatus(r);

      const actualStart = dbRow.actual_start, actualEnd = dbRow.actual_end;
      const durationH = actualStart && actualEnd
        ? timeDiffHours(actualStart, actualEnd)
        : (Number(dbRow.actual_duration_hours) || 0);
      const baselineMins = Math.round(((dbRow.contract_duration_hours && dbRow.contract_duration_hours > 0) ? dbRow.contract_duration_hours : 3) * 60);
      const otH = actualStart && actualEnd
        ? Math.ceil(Math.max(0, timeDiffMinutes(actualStart, actualEnd) - baselineMins) / 60)
        : (Number(dbRow.overtime_hours) || 0);

      const live = computeRowCharges({ ...(dbRow as any), flightMeta: (r as any).flightMeta, flight_schedule_id: r.flight_schedule_id } as any);
      const savedAmt = Number(dbRow.total_security_charges || dbRow.total_charge || 0);
      const amount = live.amount > 0 ? live.amount : savedAmt;
      const currency = live.currency || dbRow.charges_currency || "USD";

      const chargesSaved = chargesSavedIds.has(r.id) || hasSavedSecurityCharges(dbRow as any);
      const invStatus = (invoiceStatusByFlight.get(normalizeFlightKey(String(disp.flightNo || dbRow.flight_no || ""))) || "none") as "none" | "issued" | "paid";
      const completed = derivePipelineCompletedStages({
        isLinked: workflowStatus === "Completed",
        reviewStatus: dbRow.review_status,
        clearanceStatus: r.flight_schedule_id ? flightStatusById.get(r.flight_schedule_id) : undefined,
        dispatchStatus: workflowStatus,
        invoiceStatus: invStatus,
        chargesSaved,
        createdVia: resolvePipelineCreatedVia(r, (r as any).flightMeta, r.flight_schedule_id ? flightCreatedViaById.get(r.flight_schedule_id) : undefined),
      });

      return {
        "STATION": f.station,
        "AIRLINE": f.airline,
        "FLIGHT": disp.flightNo || "",
        "REG": disp.registration || "",
        "TYPE": dbRow.service_type || f.serviceType,
        "FLIGHT TYPE": getSecurityFlightType(disp.airline || f.airline, dbRow.task_sheet_data, disp.skdType),
        "ARR DATE": disp.arrivalDate || "",
        "STA": disp.sta || "",
        "DEP DATE": disp.departureDate || "",
        "STD": disp.std || "",
        "ROUTE": disp.route || "",
        "A/C TYPE": disp.aircraftType || "",
        "ACTUAL TIME": actualStart && actualEnd ? `${actualStart}–${actualEnd}` : "",
        "DURATION (h)": durationH || "",
        "OT (h)": otH || "",
        "CURRENCY": amount > 0 ? currency : "",
        "AMOUNT": amount > 0 ? Number(amount.toFixed(2)) : "",
        "STATUS": workflowStatus,
        "PIPELINE": `${completed.length}/4`,
        // ── Task-sheet detail ──────────────────────────────────────────────
        "ATA": f.ata, // strict: blank when not saved
        "ATD": f.atd, // strict: blank when not saved
        "Staff Count": f.staffCount,
        "Staff Names": f.staffNames,
        "Scheduled Start": f.scheduledStart,
        "Scheduled End": f.scheduledEnd,
        "Contract Duration (h)": f.contractDurationHours,
        "Base Fee": f.baseFee,
        "Service Rate": f.serviceRate,
        "Overtime Charge": f.overtimeCharge,
        "Review Status": f.reviewStatus,
        "Remarks": f.remarks,
        "Total Baggage on BRS": dbRow.task_sheet_data?.total_baggage_brs || "",
        "Total Baggage Accepted": dbRow.task_sheet_data?.total_baggage_accepted || "",
        "Missing Baggage on BRS": dbRow.task_sheet_data?.missing_baggage_brs || "",
        "No. of Baggage loaded in H5": dbRow.task_sheet_data?.baggage_loaded_h5 || "",
        "Cargo Accompanied By": dbRow.task_sheet_data?.cargo_accompanied || "",
        "Baggage Accompanied By": dbRow.task_sheet_data?.baggage_accompanied || "",
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0] || {}).map((k) => ({
      wch: Math.min(28, Math.max(10, k.length + 2, ...rows.slice(0, 200).map((row: any) => String(row[k] ?? "").length + 2))),
    }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    if (!(ws as any)["!autofilter"] && rows.length) {
      (ws as any)["!autofilter"] = { ref: ws["!ref"] as string };
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Security Service Reports");
    XLSX.writeFile(wb, `Security_Service_Reports_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const inputCls = "text-sm border rounded px-2.5 py-2 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground w-full";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield size={22} className="text-primary" /> Security Service Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Security service documentation across stations and operations.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {securityFlightsFetching && (
            <Badge variant="outline" className="gap-1 animate-pulse">
              Fetching more… {securityLoadedRows.toLocaleString()} loaded
            </Badge>
          )}
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] });
              queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
              queryClient.invalidateQueries({ queryKey: ["security_irregularities"] });
              queryClient.invalidateQueries({ queryKey: ["invoices_for_security_pipeline"] });
              toast({ title: "Refreshing", description: "Reloading security service reports and pipeline…" });
            }}
            className="toolbar-btn"
            title="Refresh"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          {canCreateNew && (
            <button onClick={openNewForm} className="toolbar-btn-primary"><Plus size={14} /> New Service Report</button>
          )}
        </div>
      </div>


      {reviewIdsFilter && reviewIdsFilter.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          <div>
            <span className="font-semibold text-warning-foreground">Filtered to {reviewIdsFilter.length} security assignment{reviewIdsFilter.length === 1 ? "" : "s"}</span>
            <span className="text-muted-foreground ml-2">flagged by Pre-Invoice Validation. Fix issues, then approve.</span>
          </div>
          <button
            className="text-xs font-semibold text-primary hover:underline"
            onClick={() => { setReviewIdsFilter(null); navigate("/service-report?tab=security", { replace: true }); }}
          >
            Clear filter
          </button>
        </div>
      )}

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
            <AlertTriangle size={14} />
            Rejected Service Reports
            {dispatches.filter(d => d.review_status === "Rejected").length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                {dispatches.filter(d => d.review_status === "Rejected").length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Operations-only sub-tabs (All vs Modified) */}
      {isOperationsView && (
        <div className="flex items-center gap-2 border-b">
          <button
            onClick={() => { setOpsTab("all");  }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              opsTab === "all"
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            All Reports
          </button>
          <button
            onClick={() => { setOpsTab("modified");  }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              opsTab === "modified"
                ? "text-info border-info"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            <ExternalLink size={14} />
            Modified
            {dispatches.filter(d => d.review_status === "Modified").length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-info text-info-foreground text-[10px] font-bold">
                {dispatches.filter(d => d.review_status === "Modified").length}
              </span>
            )}
          </button>
          <button
            onClick={() => { setOpsTab("clearance-flights");  }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              opsTab === "clearance-flights"
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            <Plane size={14} />
            All Clearance Flights
          </button>
          <button
            onClick={() => { setOpsTab("pending-approval");  }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              opsTab === "pending-approval"
                ? "text-destructive border-destructive"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            <Clock size={14} />
            Rejected Reports
            {pendingApprovalFlights.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                {pendingApprovalFlights.length}
              </span>
            )}
          </button>
        </div>
      )}

      {isOperationsView && opsTab === "clearance-flights" ? (
        <AllClearanceFlightsPage securityOnly />
      ) : isOperationsView && opsTab === "pending-approval" ? (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="stat-card">
              <div className="stat-card-icon bg-destructive"><Clock size={20} /></div>
              <div><div className="text-xl font-bold text-foreground">{pendingTotal}</div><div className="text-xs text-muted-foreground">Rejected Total</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon bg-warning"><CalendarDays size={20} /></div>
              <div><div className="text-xl font-bold text-foreground">{pendingToday}</div><div className="text-xs text-muted-foreground">Today</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon bg-info"><Building2 size={20} /></div>
              <div><div className="text-xl font-bold text-foreground">{pendingStationsCount}</div><div className="text-xs text-muted-foreground">Stations</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon bg-primary"><Plane size={20} /></div>
              <div><div className="text-xl font-bold text-foreground">{pendingAirlinesCount}</div><div className="text-xs text-muted-foreground">Airlines</div></div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-card rounded-lg border overflow-hidden">
            <div className="p-4 border-b flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mr-auto">
                <Clock size={14} className="text-destructive" />
                Pending Operations Approval
                <span className="text-xs font-normal text-muted-foreground">
                  — {pendingTotal} flight{pendingTotal === 1 ? "" : "s"} rejected by Operations
                </span>
              </h3>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text" placeholder="Search flight, airline, reg…"
                  value={pendingSearch} onChange={e => setPendingSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm border rounded bg-card text-foreground placeholder:text-muted-foreground w-56 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <select value={pendingStationFilter} onChange={e => setPendingStationFilter(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
                <option>All Stations</option>
                {allStations.map(s => <option key={s}>{s}</option>)}
              </select>
              <select value={pendingAirlineFilter} onChange={e => setPendingAirlineFilter(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
                <option>All Airlines</option>
                {allAirlines.map(a => <option key={a}>{a}</option>)}
              </select>
              <select value={pendingTypeFilter} onChange={e => setPendingTypeFilter(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
                <option>All Types</option>
                {[...new Set(pendingApprovalFlights.map((f: any) => f.clearance_type).filter(Boolean))].sort().map((t: string) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={pendingStatusFilter} onChange={e => setPendingStatusFilter(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
                <option>All Statuses</option>
                {[...new Set(pendingApprovalFlights.map((f: any) => f.status).filter(Boolean))].sort().map((s: string) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" value={pendingDateFrom} onChange={e => setPendingDateFrom(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground" title="From" />
              <input type="date" value={pendingDateTo} onChange={e => setPendingDateTo(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground" title="To" />
              {(pendingSearch || pendingStationFilter !== "All Stations" || pendingAirlineFilter !== "All Airlines" || pendingTypeFilter !== "All Types" || pendingStatusFilter !== "All Statuses" || pendingDateFrom || pendingDateTo) && (
                <button
                  onClick={() => { setPendingSearch(""); setPendingStationFilter("All Stations"); setPendingAirlineFilter("All Airlines"); setPendingTypeFilter("All Types"); setPendingStatusFilter("All Statuses"); setPendingDateFrom(""); setPendingDateTo(""); }}
                  className="toolbar-btn-outline text-xs"
                >
                  <X size={12} /> Clear
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30">
                    {["#", "STATION", "AIRLINE", "FLIGHT", "REG", "A/C", "FLIGHT TYPE", "SERVICE TYPE", "ARR DATE", "STA", "STD", "ATA", "ATD", "ROUTE", "SHIFT", "STAFF", "OBSERVERS", "REMARKS", "PIPELINE", "ACTIONS"].map(h => (
                      <th key={h} className="data-table-header px-3 py-3 text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagePending.length === 0 ? (
                    <tr>
                      <td colSpan={20} className="text-center py-16">
                        <Clock size={36} className="mx-auto text-muted-foreground/30 mb-2" />
                        <p className="font-semibold text-foreground">No rejected reports</p>
                        <p className="text-muted-foreground text-sm mt-1">Reports you reject are listed here until the Station amends and resubmits them.</p>
                      </td>
                    </tr>
                  ) : pagePending.map((f: any, i: number) => {
                    const d = resolveSecurityRowDisplay(f.dispatch, f as any, null);
                    const ts = (f.dispatch?.task_sheet_data || {}) as Record<string, any>;
                    const observers = [
                      ts.cargo_observer_1, ts.cargo_observer_2,
                      ts.hold_baggage_observer_1, ts.hold_baggage_observer_2,
                      ts.gate_door_observer_1, ts.gate_door_observer_2,
                      ts.aircraft_door_observer_1, ts.aircraft_door_observer_2,
                      ts.aircraft_ramp_observer_1, ts.aircraft_ramp_observer_2,
                    ].filter(Boolean).join(", ");
                    const shift = [d.scheduledStart, d.scheduledEnd].filter(Boolean).join("–");
                    const remarks = d.remarks || f.remarks || "";
                    return (
                    <tr key={f.id} className="data-table-row">
                      <td className="px-3 py-2.5 text-muted-foreground text-xs">{pagPending.start + i + 1}</td>
                      <td className="px-3 py-2.5 font-semibold text-foreground">{d.station || f.authority || "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap" style={airlineBadgeStyle(d.airline || f.airlines?.name || f.handling_agent)}>{d.airline || f.airlines?.name || f.handling_agent || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-foreground">{d.flightNo || f.flight_no || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{d.registration || f.registration || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{d.aircraftType || f.aircraft_type || "—"}</td>
                      <td className="px-3 py-2.5 text-foreground text-xs">{getSecurityFlightType(d.airline || f.airlines?.name || f.handling_agent, ts, d.skdType || f.skd_type) || "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getTypeBadgeClass(f.clearance_type)}`}>{d.serviceType || f.clearance_type || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 text-foreground text-xs whitespace-nowrap">{d.arrivalDate || f.arrival_date || f.departure_date || f.flight_date || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{d.sta || f.sta || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{d.std || f.std || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{d.ata || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{d.atd || "—"}</td>
                      <td className="px-3 py-2.5 text-foreground text-xs">{d.route || f.route || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{shift || "—"}</td>
                      <td className="px-3 py-2.5 text-foreground text-xs max-w-[180px] truncate" title={d.staffNames}>
                        {d.staffCount ? `${d.staffCount} • ` : ""}{d.staffNames || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-[200px] truncate" title={observers}>{observers || "—"}</td>
                      <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-[240px] truncate" title={remarks}>{remarks || "—"}</td>
                      <td className="px-3 py-2.5">
                        <PipelineStepper
                          currentStage="operations"
                          completedStages={["station"]}
                          compact
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => openEditPending(f)}
                            className="px-2 py-1 text-xs font-semibold rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors inline-flex items-center gap-1"
                          >
                            <Eye size={11} /> View
                          </button>
                          <button
                            onClick={() => approvePendingFlight(f.id)}
                            className="px-2 py-1 text-xs font-semibold rounded bg-success/15 text-success hover:bg-success/25 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => rejectPendingFlight(f.id)}
                            className="px-2 py-1 text-xs font-semibold rounded bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination {...pagPending} />
          </div>
        </div>
      ) : (
      <>
      {/* KPI Cards */}
      <div className={`grid grid-cols-2 ${isReceivablesView ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-4`}>
        <div className="stat-card">
          <div className="stat-card-icon bg-primary"><FileBarChart2 size={20} /></div>
          <div><div className="text-xl font-bold text-foreground">{totalReports}</div><div className="text-xs text-muted-foreground">Total Reports</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-success"><CheckCircle2 size={20} /></div>
          <div><div className="text-xl font-bold text-foreground">{approvedReports}</div><div className="text-xs text-muted-foreground">Approved</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-warning"><Clock size={20} /></div>
          <div><div className="text-xl font-bold text-foreground">{pendingReview}</div><div className="text-xs text-muted-foreground">Pending</div></div>
        </div>
        {isReceivablesView && (
          <div className="stat-card">
            <div className="stat-card-icon bg-info"><DollarSign size={20} /></div>
            <div><div className="text-xl font-bold text-foreground">${totalRevenue.toLocaleString()}</div><div className="text-xs text-muted-foreground">Total Charges</div></div>
          </div>
        )}
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-3 flex items-center gap-3">
          <Users size={16} className="text-muted-foreground" />
          <div><div className="text-sm font-bold text-foreground">{totalStaffDeployed}</div><div className="text-xs text-muted-foreground">Staff Deployed</div></div>
        </div>
        <div className="bg-card border rounded-lg p-3 flex items-center gap-3">
          <Clock size={16} className="text-muted-foreground" />
          <div><div className="text-sm font-bold text-foreground">{totalOvertimeHrs.toFixed(1)}h</div><div className="text-xs text-muted-foreground">Total Overtime</div></div>
        </div>
        <div className="bg-card border rounded-lg p-3 flex items-center gap-3">
          <Plane size={16} className="text-muted-foreground" />
          <div><div className="text-sm font-bold text-foreground">{completedReports}</div><div className="text-xs text-muted-foreground">Completed</div></div>
        </div>
        <div className="bg-card border rounded-lg p-3 flex items-center gap-3">
          <DollarSign size={16} className="text-muted-foreground" />
          <div><div className="text-sm font-bold text-foreground">{readyForBilling}</div><div className="text-xs text-muted-foreground">Ready for Billing</div></div>
        </div>
      </div>

      {/* Service Reports list (clearance flights merged in) */}
      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="p-4 border-b flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mr-auto">
            <FileBarChart2 size={16} className="text-primary" /> Service Reports
            <span className="text-xs font-normal text-muted-foreground">({filtered.length})</span>
          </h2>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text" placeholder="Search airline, flight, staff…"
              value={search} onChange={e => { setSearch(e.target.value);  }}
              className="pl-8 pr-3 py-1.5 text-sm border rounded bg-card text-foreground placeholder:text-muted-foreground w-56 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <select value={stationFilter} onChange={e => { setStationFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Stations</option>
            {allStations.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={airlineFilter} onChange={e => { setAirlineFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Airlines</option>
            {allAirlines.map(a => <option key={a}>{a}</option>)}
          </select>
          <select value={serviceFilter} onChange={e => { setServiceFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All Types</option>
            {allServiceTypes.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground">
            <option>All</option>
            {WORKFLOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={stepFilter}
            onChange={e => setStepFilter(e.target.value)}
            title="Filter by pipeline step"
            className="text-sm border rounded px-2 py-1.5 bg-card text-foreground"
          >
            <option value="All Steps">All Steps</option>
            <optgroup label="Currently at step">
              <option value="at:clearance">At Step 1 — Clearance</option>
              <option value="at:station">At Step 2 — Security Service</option>
              <option value="at:operations">At Step 3 — Operations</option>
              <option value="at:receivables">At Step 4 — Receivables</option>
            </optgroup>
            <optgroup label="Step completed">
              <option value="done:clearance">Step 1 completed</option>
              <option value="done:station">Step 2 completed</option>
              <option value="done:operations">Step 3 completed</option>
              <option value="done:receivables">Step 4 completed</option>
            </optgroup>
          </select>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground" title="From" />
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value);  }} className="text-sm border rounded px-2 py-1.5 bg-card text-foreground" title="To" />
          {isReceivablesView && (
            <button
              onClick={saveAllSecurityCharges}
              disabled={bulkSaving}
              className="toolbar-btn-primary"
              title={selectedIds.size > 0
                ? `Compute & save Security Charges for the ${selectedIds.size} selected flight(s), then mark Receivables (step 4) complete`
                : `Compute & save Security Charges for every eligible flight in the selected date range${dateFrom || dateTo ? ` (${dateFrom || "…"} → ${dateTo || "…"})` : ""}, then mark Receivables (step 4) complete`}
            >
              <DollarSign size={14} />
              {bulkSaving
                ? "Saving…"
                : selectedIds.size > 0
                  ? `Save Security Charges (${selectedIds.size} selected)`
                  : "Save All Security Charges"}
            </button>
          )}
          <div className="inline-flex rounded border overflow-hidden">
            <button
              onClick={() => setRecordsView("table")}
              className={`px-2.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1 ${recordsView === "table" ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"}`}
              title="Table view"
            >
              <FileBarChart2 size={12} /> Table
            </button>
            <button
              onClick={() => setRecordsView("calendar")}
              className={`px-2.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1 border-l ${recordsView === "calendar" ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"}`}
              title="Calendar view"
            >
              <CalendarDays size={12} /> Calendar
            </button>
          </div>
          <button onClick={handleExport} className="toolbar-btn-outline"><Download size={14} /> Export</button>
        </div>

        {recordsView === "calendar" ? (
          <div className="p-4 space-y-4">
            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <CalendarDays size={40} className="mx-auto text-muted-foreground/30 mb-3" />
                <p className="font-semibold text-foreground">No records to display</p>
              </div>
            ) : (() => {
              const groups = new Map<string, typeof filtered>();
              for (const r of filtered) {
                const fd = r.flight_schedule_id ? flightDetailsById.get(r.flight_schedule_id) : undefined;
                const d = resolveSecurityRowDisplay(r as any, fd, (r as any).flightMeta);
                const key = d.arrivalDate || d.departureDate || r.flight_date || "Unscheduled";
                if (!groups.has(key)) groups.set(key, [] as any);
                (groups.get(key) as any).push(r);
              }
              const sortedKeys = [...groups.keys()].sort((a, b) => {
                if (a === "Unscheduled") return 1;
                if (b === "Unscheduled") return -1;
                return a.localeCompare(b);
              });
              return sortedKeys.map(dateKey => {
                const items = groups.get(dateKey)!;
                const sorted = [...items].sort((a, b) => {
                  const ad = resolveSecurityRowDisplay(a as any, a.flight_schedule_id ? flightDetailsById.get(a.flight_schedule_id) : undefined, (a as any).flightMeta);
                  const bd = resolveSecurityRowDisplay(b as any, b.flight_schedule_id ? flightDetailsById.get(b.flight_schedule_id) : undefined, (b as any).flightMeta);
                  // Sort by STA; fall back to STD when a flight has no STA (departure-only).
                  const aKey = ad.sta || ad.std || "";
                  const bKey = bd.sta || bd.std || "";
                  if (!aKey && bKey) return 1;
                  if (aKey && !bKey) return -1;
                  return aKey.localeCompare(bKey);
                });
                return (
                  <div key={dateKey} className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/40 px-3 py-2 flex items-center gap-2 border-b">
                      <CalendarDays size={14} className="text-primary" />
                      <span className="text-sm font-semibold text-foreground">{dateKey}</span>
                      <span className="text-xs text-muted-foreground">({sorted.length} flight{sorted.length === 1 ? "" : "s"})</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 p-2">
                      {sorted.map(r => {
                        const fd = r.flight_schedule_id ? flightDetailsById.get(r.flight_schedule_id) : undefined;
                        const d = resolveSecurityRowDisplay(r as any, fd, (r as any).flightMeta);
                        const workflowStatus = getWorkflowDispatchStatus(r);
                        const sc = dispatchStatusConfig[workflowStatus] || dispatchStatusConfig["Pending"];
                        return (
                          <button
                            key={r.id}
                            onClick={() => {
                              if ((r as any).isPending) {
                                setIsNewReport(true);
                                setEditRow({ ...r, id: "new" } as DispatchRow);
                              } else {
                                setEditRow(r);
                              }
                            }}
                            className="text-left bg-card border rounded p-2.5 hover:border-primary hover:shadow-sm transition-all"
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-mono text-xs font-bold text-foreground">{d.flightNo || r.flight_no || "—"}</span>
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${sc}`}>{workflowStatus}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mb-1">{r.airline || "—"} · {r.station}</div>
                            <div className="flex items-center gap-3 text-[11px] font-mono text-foreground">
                              <span>STA <span className="text-primary">{d.sta || "—"}</span></span>
                              <span>STD <span className="text-primary">{d.std || "—"}</span></span>
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-1 truncate">{d.route || "—"}</div>
                            {(() => {
                              const chargesPersisted = hasSavedSecurityCharges(r as any);
                              const baseInvStatus = invoiceStatusByFlight.get(normalizeFlightKey(String(d.flightNo || r.flight_no || ""))) || "none";
                              const invStatus: "none" | "issued" | "paid" =
                                baseInvStatus === "paid" ? "paid" : baseInvStatus;
                              const pipelineOpts = {
                                isLinked: workflowStatus === "Completed",
                                reviewStatus: r.review_status,
                                clearanceStatus: r.flight_schedule_id ? flightStatusById.get(r.flight_schedule_id) : undefined,
                                dispatchStatus: workflowStatus,
                                invoiceStatus: invStatus,
                                chargesSaved: chargesSavedIds.has(r.id) || chargesPersisted,
                                createdVia: resolvePipelineCreatedVia(r, (r as any).flightMeta, r.flight_schedule_id ? flightCreatedViaById.get(r.flight_schedule_id) : undefined),
                              };
                              return (
                                <div className="mt-2 pt-2 border-t flex justify-center">
                                  <PipelineStepper
                                    currentStage={derivePipelineStage({ ...pipelineOpts, channel: activeChannel })}
                                    completedStages={derivePipelineCompletedStages(pipelineOpts)}
                                    compact
                                  />
                                </div>
                              );
                            })()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        ) : (
        <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {isReceivablesView && (
                      <th className="data-table-header px-2 py-3 w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all on page"
                          checked={pageData.length > 0 && pageData.every(r => selectedIds.has(r.id))}
                          onChange={(e) => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) pageData.forEach(r => next.add(r.id));
                              else pageData.forEach(r => next.delete(r.id));
                              return next;
                            });
                          }}
                        />
                      </th>
                    )}
                     {["#", "STATION", "AIRLINE", "FLIGHT", "REG", "TYPE", "FLIGHT TYPE", "ARR DATE", "STA", "DEP DATE", "STD", "ROUTE", "A/C TYPE", "ACTUAL TIME", "DURATION", "OT (h)", ...(isReceivablesView ? ["AMOUNT"] : []), "STATUS", "PIPELINE", "ACTIONS"].map(h => (
                      <th key={h} className="data-table-header px-3 py-3 text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={isReceivablesView ? 21 : 19} className="text-center py-16 text-muted-foreground">Loading…</td></tr>
                  ) : pageData.length === 0 ? (
                     <tr>
                      <td colSpan={isReceivablesView ? 21 : 19} className="text-center py-16">
                        <Shield size={40} className="mx-auto text-muted-foreground/30 mb-3" />
                        <p className="font-semibold text-foreground">No Security Service Reports</p>
                        <p className="text-muted-foreground text-sm mt-1">Security service reports will appear here once created</p>
                      </td>
                    </tr>
                  ) : pageData.map((r, i) => {
                    const workflowStatus = getWorkflowDispatchStatus(r);
                    const sc = dispatchStatusConfig[workflowStatus] || dispatchStatusConfig["Pending"];
                    const hasIrregularity = r.irregularity_id && linkedIrregularities.has(r.irregularity_id);
                    const isPending = (r as any).isPending === true;
                    const fd = r.flight_schedule_id ? flightDetailsById.get(r.flight_schedule_id) : undefined;
                    const meta = (r as any).flightMeta;
                    const d = resolveSecurityRowDisplay(r as any, fd, meta);
                    const { flightNo, registration: reg, route, aircraftType: acType, skdType, arrivalDate: arrDate, departureDate: depDate, sta, std } = d;
                    const opsDeleteEntries = parseDeletionRequests(meta?.remarks);
                    const opsDeleteRow = (() => {
                      if (opsDeleteEntries.length === 0) return null;
                      const latest = opsDeleteEntries[opsDeleteEntries.length - 1];
                      const latestLabel = latest.kind === "ops_delete"
                        ? "Operations Delete Request:"
                        : "Station Return to Clearance:";

                      const isExpanded = expandedDeleteIds.has(r.id);
                      const reasonNode = latest.reason
                        ? <span className="text-foreground">{latest.reason}</span>
                        : <span className="italic text-muted-foreground">Reason not provided</span>;
                      return (
                        <tr
                          className="bg-warning/5 border-l-2 border-l-warning"
                          data-testid={`ops-delete-row-${r.flight_schedule_id || r.id}`}
                          data-flight-id={r.flight_schedule_id || r.id}
                        >
                          <td colSpan={isReceivablesView ? 18 : 16} className="px-4 py-2">
                            <div className="flex items-start gap-2 text-xs">
                              <Trash2 size={14} className="text-warning shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => setExpandedDeleteIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                                    return next;
                                  })}
                                  className="inline-flex items-center gap-1 text-left hover:underline"
                                  aria-expanded={isExpanded}
                                  aria-controls={`ops-delete-panel-${r.id}`}
                                  title={isExpanded ? "Hide full reason and notes" : "Show full reason and notes"}
                                >
                                  {isExpanded ? <ChevronUp size={12} className="text-warning" /> : <ChevronDown size={12} className="text-warning" />}
                                  <span className="font-bold uppercase tracking-wider text-warning">{latestLabel}</span>
                                </button>{" "}
                                {reasonNode}
                                {latest.header && <span className="ml-2 text-muted-foreground">— {latest.header}</span>}
                                {isExpanded && (
                                  <div
                                    id={`ops-delete-panel-${r.id}`}
                                    className="mt-2 rounded border border-warning/30 bg-background p-3 space-y-2"
                                  >
                                    <div>
                                      <div className="font-semibold text-warning mb-1">All deletion / clearance requests</div>
                                      <ul className="space-y-1">
                                        {opsDeleteEntries.map((e, i) => (
                                          <li key={i} className="flex gap-2">
                                            <span className="text-muted-foreground shrink-0">{e.header || "—"}</span>
                                            <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-warning/80">
                                              {e.kind === "ops_delete" ? "Ops delete" : "Station return"}
                                            </span>
                                            <span className="flex-1">
                                              {e.reason || <span className="italic text-muted-foreground">Reason not provided</span>}
                                            </span>
                                          </li>
                                        ))}

                                      </ul>
                                    </div>
                                    {meta?.remarks && (
                                      <div>
                                        <div className="font-semibold text-warning mb-1">Full notes</div>
                                        <pre className="whitespace-pre-wrap break-words text-foreground font-sans">{meta.remarks}</pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              {/* Delete action intentionally lives only in the Clearance portal. */}

                            </div>
                          </td>
                        </tr>
                      );
                    })();
                    return (
                      <React.Fragment key={r.id}>
                      {opsDeleteRow}
                      <tr
                        data-testid={`flight-row-${r.flight_schedule_id || r.id}`}
                        data-flight-id={r.flight_schedule_id || r.id}
                        className={`data-table-row ${isPending ? "bg-muted/30" : ""} ${r.review_status === "Rejected" ? "border-l-2 border-l-destructive" : ""} ${opsDeleteRow ? "border-l-2 border-l-warning" : ""}`}
                      >


                        {isReceivablesView && (
                          <td className="px-2 py-2.5">
                            <input
                              type="checkbox"
                              aria-label={`Select ${flightNo || r.flight_no}`}
                              checked={selectedIds.has(r.id)}
                              onChange={() => toggleSelect(r.id)}
                              disabled={isPending}
                            />
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-muted-foreground text-xs">{pagMain.start + i + 1}</td>
                        <td className="px-3 py-2.5 font-semibold text-foreground">{r.station}</td>
                        <td className="px-3 py-2.5">
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap" style={airlineBadgeStyle(r.airline)}>{r.airline || "—"}</span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-foreground">
                          <div className="flex flex-col gap-0.5">
                            <span>{flightNo || "—"}</span>
                            {(() => {
                              const latestReturn = [...opsDeleteEntries].reverse().find(e => e.kind === "station_return");
                              if (!latestReturn) return null;
                              const reason = latestReturn.reason || "Reason not provided";
                              const preview = reason.length > 40 ? `${reason.slice(0, 40)}…` : reason;
                              return (
                                <span
                                  className="inline-flex items-center gap-1 self-start px-1.5 py-0.5 rounded text-[10px] font-semibold bg-warning/10 text-warning border border-warning/30 max-w-[220px] truncate"
                                  title={`Returned to Clearance: ${reason}`}
                                >
                                  <RefreshCw size={10} className="shrink-0" />
                                  <span className="truncate">↩ {preview}</span>
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{reg || "—"}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getTypeBadgeClass(r.service_type)}`}>{r.service_type}</span>
                            {r.flight_schedule_id && !isPending && (
                              <Badge variant="secondary" className="gap-1 text-[10px] py-0 px-1.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" title="This flight is billed as Security — excluded from the Handling tab">
                                <Shield className="h-2.5 w-2.5" /> Security
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-foreground text-xs">
                          {getSecurityFlightType(r.airline, r.task_sheet_data, skdType) || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-foreground text-xs whitespace-nowrap">{arrDate || "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{sta || "—"}</td>
                        <td className="px-3 py-2.5 text-foreground text-xs whitespace-nowrap">{depDate || "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{std || "—"}</td>
                        <td className="px-3 py-2.5 text-foreground text-xs">{route || "—"}</td>
                        <td className="px-3 py-2.5 text-foreground text-xs">{acType || "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                          {r.actual_start && r.actual_end ? `${r.actual_start}–${r.actual_end}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-foreground">{r.actual_start && r.actual_end ? `${timeDiffHours(r.actual_start, r.actual_end)}h` : (r.actual_duration_hours ? `${r.actual_duration_hours}h` : "—")}</td>
                        <td className="px-3 py-2.5">
                          {(() => {
                            // Any fractional OT hour is rounded UP to a full hour.
                            const baselineMins = Math.round(((r.contract_duration_hours && r.contract_duration_hours > 0) ? r.contract_duration_hours : 3) * 60);
                            const overtimeDisplay = r.actual_start && r.actual_end
                              ? Math.ceil(Math.max(0, timeDiffMinutes(r.actual_start, r.actual_end) - baselineMins) / 60)
                              : (r.overtime_hours || 0);
                            return overtimeDisplay > 0 ? <span className="text-warning font-semibold">{overtimeDisplay}h</span> : "—";
                          })()}
                        </td>
                        {isReceivablesView && (() => {
                          const live = computeRowCharges(r);
                          const saved = (r as any).total_security_charges || r.total_charge || 0;
                          const amount = live.amount > 0 ? live.amount : saved;
                          const currency = live.currency || (r as any).charges_currency || "USD";
                          return (
                            <td className="px-3 py-2.5 font-semibold text-foreground whitespace-nowrap">
                              {amount > 0 ? `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : <span className="text-muted-foreground font-normal">—</span>}
                            </td>
                          );
                        })()}
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${sc}`}>{workflowStatus}</span>
                          {hasIrregularity && (
                            <span title="Has irregularity"><AlertTriangle size={12} className="inline ml-1 text-destructive" /></span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {(() => {
                            // Receivables (step 4) is marked complete as soon as
                            // Security Charges have been saved & the report is
                            // Ready for Billing — even before the invoice is paid.
                            const chargesPersisted = hasSavedSecurityCharges(r as any);
                            const baseInvStatus = invoiceStatusByFlight.get(normalizeFlightKey(String(flightNo || r.flight_no || ""))) || "none";
                            const invStatus: "none" | "issued" | "paid" =
                              baseInvStatus === "paid" ? "paid" : baseInvStatus;
                            const chargesSaved = chargesSavedIds.has(r.id) || chargesPersisted;
                            return (
                              <PipelineStepper
                                currentStage={derivePipelineStage({
                                  isLinked: workflowStatus === "Completed",
                                  reviewStatus: r.review_status,
                                  clearanceStatus: r.flight_schedule_id ? flightStatusById.get(r.flight_schedule_id) : undefined,
                                  dispatchStatus: workflowStatus,
                                  channel: activeChannel,
                                  invoiceStatus: invStatus,
                                  chargesSaved,
                                  createdVia: resolvePipelineCreatedVia(r, (r as any).flightMeta, r.flight_schedule_id ? flightCreatedViaById.get(r.flight_schedule_id) : undefined),
                                })}
                                completedStages={derivePipelineCompletedStages({
                                  isLinked: workflowStatus === "Completed",
                                  reviewStatus: r.review_status,
                                  clearanceStatus: r.flight_schedule_id ? flightStatusById.get(r.flight_schedule_id) : undefined,
                                  dispatchStatus: workflowStatus,
                                  invoiceStatus: invStatus,
                                  chargesSaved,
                                  createdVia: resolvePipelineCreatedVia(r, (r as any).flightMeta, r.flight_schedule_id ? flightCreatedViaById.get(r.flight_schedule_id) : undefined),
                                })}
                                compact
                              />
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            {isPending ? (
                              <>
                                {canCreateNew && (
                                  <button
                                    onClick={() => { setIsNewReport(true); setEditRow({ ...r, id: "new" } as DispatchRow); }}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                    title="Complete Service Report"
                                  >
                                    <Pencil size={12} /> Complete
                                  </button>
                                )}
                                {isOperationsView && r.flight_schedule_id && (
                                  <button
                                    onClick={async () => {
                                      const comment = prompt(`Send DELETION request to the Clearance portal for flight ${r.flight_no || ""} — reason:`);
                                      if (!comment || !comment.trim()) return;
                                      const stamp = `[OPS DELETE REQUEST ${new Date().toISOString().slice(0,16).replace("T"," ")}] ${comment.trim()}`;
                                      try {
                                        const { data: cur } = await supabase.from("flight_schedules").select("remarks").eq("id", r.flight_schedule_id!).maybeSingle();
                                        const existing = (cur as any)?.remarks || "";
                                        const newRemarks = existing ? `${existing}\n${stamp}` : stamp;
                                        const { error } = await supabase.from("flight_schedules").update({ remarks: newRemarks, status: "Rejected" } as any).eq("id", r.flight_schedule_id!);
                                        if (error) throw error;
                                        queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
                                        toast({ title: "🗑️ Deletion request sent to Clearance", description: `Flight ${r.flight_no || ""} now appears in the Clearance portal › Rejected tab with your reason.` });
                                      } catch (e: any) {
                                        toast({ title: "Error", description: e.message, variant: "destructive" });
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
                                    title="Notify the Clearance portal to delete this flight (appears in Clearance › Rejected with your reason)"
                                  >
                                    <Trash2 size={12} /> Request Deletion (Clearance)
                                  </button>
                                )}
                              </>

                            ) : (
                              <>
                                <button
                                  onClick={() => tryOpenEdit(r)}
                                  disabled={isOpsLocked(r)}
                                  className="p-1 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={isOpsLocked(r) ? "Approved by Operations (step 3) — admin only" : "Edit Report"}
                                >
                                  <Pencil size={14} className="text-muted-foreground" />
                                </button>
                                {r.review_status === "Draft" && r.status === "Completed" && (
                                  <button onClick={() => submitForReview(r)} className="p-1 rounded hover:bg-muted" title="Submit for Review">
                                    <ExternalLink size={14} className="text-primary" />
                                  </button>
                                )}
                                {!isStationView && (r.review_status === "Pending Review" || r.review_status === "Modified") && (
                                  <button onClick={() => { setReviewRow(r); setReviewComment(r.review_comment); }} className="p-1 rounded hover:bg-muted" title={r.review_status === "Modified" ? "Review Modified Report" : "Review"}>
                                    <MessageSquare size={14} className={r.review_status === "Modified" ? "text-info" : "text-warning"} />
                                  </button>
                                )}
                              </>
                            )}
                            {isStationView && !isOpsLocked(r) && (

                              <button
                                onClick={async () => {
                                  const comment = prompt(`Return flight ${r.flight_no} to Clearance — reason:`);
                                  const reason = (comment || "").trim();
                                  if (!reason) return;
                                  const stamp = `[Station Return ${new Date().toISOString().slice(0,16).replace("T"," ")}] ${reason}`;
                                  try {
                                    // Resolve flight_schedule_id: prefer the direct link, otherwise look up
                                    // by flight_no + flight_date (some Security-Service-created dispatches
                                    // are not linked to a flight_schedules row).
                                    let fsId = r.flight_schedule_id as string | null | undefined;
                                    if (!fsId && r.flight_no) {
                                      const normalizeReg = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^SU/, "");
                                      const normalizeRoute = (v: string) => v.toUpperCase().replace(/[-\s]+/g, "/").replace(/\/+/g, "/");
                                      const flightKeys = new Set(expandFlightRef(r.flight_no));
                                      const rowDate = arrDate || depDate || r.flight_date || "";
                                      let q = supabase
                                        .from("flight_schedules")
                                        .select("id, flight_no, registration, route, arrival_date, departure_date, sta, std, clearance_type")
                                        .eq("authority", r.station)
                                        .eq("clearance_type", r.service_type)
                                        .limit(25);
                                      if (rowDate) q = q.or(`arrival_date.eq.${rowDate},departure_date.eq.${rowDate}`);
                                      const { data: matches } = await q;
                                      const rowReg = normalizeReg(reg || "");
                                      const rowRoute = normalizeRoute(route || "");
                                      const ranked = ((matches || []) as any[])
                                        .map(f => {
                                          const candidateKeys = new Set(expandFlightRef(f.flight_no || ""));
                                          const flightMatch = [...flightKeys].some(k => candidateKeys.has(k));
                                          const regMatch = rowReg && normalizeReg(f.registration || "") === rowReg;
                                          const routeMatch = rowRoute && normalizeRoute(f.route || "") === rowRoute;
                                          const timeMatch = (sta && f.sta === sta) || (std && f.std === std);
                                          return { f, score: (flightMatch ? 4 : 0) + (regMatch ? 3 : 0) + (routeMatch ? 2 : 0) + (timeMatch ? 1 : 0) };
                                        })
                                        .sort((a, b) => b.score - a.score);
                                      fsId = ranked[0]?.score >= 5 ? ranked[0].f.id : null;
                                    }
                                    if (!fsId) {
                                      toast({ title: "Cannot return", description: "No linked flight schedule was found for this report. Ask Clearance to create one first.", variant: "destructive" });
                                      return;
                                    }
                                    // Atomic server-side append + status flip so the
                                    // banner always has a fresh row to read from.
                                    const { data: updated, error } = await (supabase as any).rpc("return_flight_to_clearance", {
                                      _id: fsId,
                                      _stamp: stamp,
                                    });
                                    if (error) throw error;
                                    const patched = Array.isArray(updated) ? updated[0] : updated;
                                    // Optimistically patch every flight_schedules-backed cache so
                                    // the "Station Return to Clearance" banner renders on the row
                                    // immediately, before the refetch lands.
                                    if (patched) {
                                      queryClient.setQueriesData({ queryKey: ["flight_schedules"] }, (old: any) => {
                                        if (!Array.isArray(old)) return old;
                                        return old.map((f: any) => f?.id === fsId ? { ...f, ...patched } : f);
                                      });
                                    }
                                    await Promise.all([
                                      queryClient.invalidateQueries({ queryKey: ["flight_schedules"] }),
                                      queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] }),
                                      queryClient.invalidateQueries({ queryKey: ["v_dispatch_with_flight"] }),
                                    ]);
                                    await Promise.all([
                                      queryClient.refetchQueries({ queryKey: ["flight_schedules"], type: "active" }),
                                      queryClient.refetchQueries({ queryKey: ["dispatch_assignments"], type: "active" }),
                                      queryClient.refetchQueries({ queryKey: ["v_dispatch_with_flight"], type: "active" }),
                                    ]);
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
                            {isAdmin && r.flight_schedule_id && (
                              <button
                                onClick={async () => {
                                  if (!confirm(`Delete flight ${r.flight_no}? This removes the security report AND the underlying flight schedule.`)) return;
                                  try {
                                    if (r.id && !isPending) await supabase.from("dispatch_assignments").delete().eq("id", r.id);
                                    await supabase.from("flight_schedules").delete().eq("id", r.flight_schedule_id!);
                                    queryClient.invalidateQueries({ queryKey: ["dispatch_assignments"] });
                                    queryClient.invalidateQueries({ queryKey: ["flight_schedules"] });
                                    toast({ title: "Deleted", description: "Flight and security report removed." });
                                  } catch (e: any) {
                                    toast({ title: "Error", description: e.message, variant: "destructive" });
                                  }
                                }}
                                className="p-1 rounded hover:bg-destructive/10"
                                title="Delete Flight (Admin) — removes flight + report"
                              >
                                <X size={14} className="text-destructive" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isStationView && r.review_status === "Rejected" && (
                        <tr className="bg-destructive/5 border-l-2 border-l-destructive">
                          <td colSpan={isReceivablesView ? 18 : 16} className="px-4 py-2">
                            <div className="flex items-start gap-2 text-xs">
                              <XCircle size={14} className="text-destructive shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <span className="font-bold uppercase tracking-wider text-destructive">Rejection Reason: </span>
                                <span className="text-foreground">
                                  {r.review_comment?.trim() ? r.review_comment : <span className="italic text-muted-foreground">No reason provided</span>}
                                </span>
                                {r.reviewed_by && (
                                  <span className="ml-2 text-muted-foreground">
                                    — by <span className="font-semibold text-foreground">{r.reviewed_by}</span>
                                    {(r as any).reviewed_at && ` • ${new Date((r as any).reviewed_at).toLocaleString()}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            <TablePagination {...pagMain} />
            </div>

          </>
        )}
      </div>

      {/* Review Dialog */}
      <Dialog open={!!reviewRow} onOpenChange={(open) => !open && setReviewRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare size={18} /> Review Service Report
            </DialogTitle>
          </DialogHeader>
          {reviewRow && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                <div><span className="text-muted-foreground">Flight:</span> <span className="font-semibold">{reviewRow.flight_no}</span></div>
                <div><span className="text-muted-foreground">Airline:</span> {reviewRow.airline}</div>
                <div><span className="text-muted-foreground">Station:</span> {reviewRow.station}</div>
                <div><span className="text-muted-foreground">Date:</span> {reviewRow.flight_date}</div>
                <div><span className="text-muted-foreground">Staff:</span> {reviewRow.staff_count} ({reviewRow.staff_names || "—"})</div>
                <div><span className="text-muted-foreground">Actual Time:</span> {reviewRow.actual_start} – {reviewRow.actual_end}</div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Review Comment</label>
                <textarea
                  className="w-full mt-1 text-sm border rounded px-3 py-2 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none min-h-[60px]"
                  placeholder="Add review comment…"
                  value={reviewComment}
                  onChange={e => setReviewComment(e.target.value)}
                />
              </div>
              {reviewRow.reviewed_by && (
                <div className="text-xs text-muted-foreground">
                  Last reviewed by <span className="font-semibold">{reviewRow.reviewed_by}</span>
                  {reviewRow.reviewed_at && ` on ${reviewRow.reviewed_at.slice(0, 10)}`}
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="destructive" size="sm" onClick={() => handleReviewAction("Rejected")}>
                  <XCircle size={14} className="mr-1" /> Reject
                </Button>
                <Button size="sm" onClick={() => handleReviewAction("Approved")} className="bg-success hover:bg-success/90 text-success-foreground">
                  <CheckCircle2 size={14} className="mr-1" />
                  {reviewRow.review_status === "Modified" ? "Approve & Mark Ready for Billing" : "Approve"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      </>
      )}

      {/* Security Task Sheet Dialog — lazy + only mounted when opened to avoid blocking initial render */}
      {editRow && (
        <Suspense fallback={null}>
          <SecurityTaskSheetDialog
            row={editRow}
            onClose={() => { setEditRow(null); setIsNewReport(false); setPendingApprovalFlightId(null); }}
            onSave={saveTaskSheet}
            isNew={isNewReport}
            pendingApprovalMode={!!pendingApprovalFlightId}
            onPendingApprove={pendingApprovalFlightId ? () => approvePendingFlight(pendingApprovalFlightId) : undefined}
            onPendingReject={pendingApprovalFlightId ? (comment: string) => rejectPendingFlight(pendingApprovalFlightId, comment) : undefined}
            registration={editRow?.flight_schedule_id ? flightDetailsById.get(editRow.flight_schedule_id)?.registration : undefined}
            route={editRow?.flight_schedule_id ? flightDetailsById.get(editRow.flight_schedule_id)?.route : undefined}
            sta={editRow?.flight_schedule_id ? flightDetailsById.get(editRow.flight_schedule_id)?.sta : undefined}
            std={editRow?.flight_schedule_id ? flightDetailsById.get(editRow.flight_schedule_id)?.std : undefined}
            skdType={editRow?.flight_schedule_id ? flightDetailsById.get(editRow.flight_schedule_id)?.skd_type : undefined}
            serviceType={editRow?.flight_schedule_id ? flightDetailsById.get(editRow.flight_schedule_id)?.clearance_type : undefined}
            arrivalDate={editRow?.flight_schedule_id ? flightDetailsById.get(editRow.flight_schedule_id)?.arrival_date : undefined}
            departureDate={editRow?.flight_schedule_id ? flightDetailsById.get(editRow.flight_schedule_id)?.departure_date : undefined}
          />
        </Suspense>
      )}

    </div>

  );
}
