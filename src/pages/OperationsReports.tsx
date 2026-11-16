import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServiceReportsFS } from "@/data/serviceReports";
import { useDispatchBoardFS } from "@/data/dispatch";
import { Shield, Plane, FileBarChart2, Download, ExternalLink, Loader2, Inbox, Printer, FileSpreadsheet, FileText } from "lucide-react";
import { getTypeBadgeClass } from "@/lib/typeColors";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { toast } from "@/hooks/use-toast";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, Legend,
} from "recharts";

type StatRow = { key: string; count: number; extra?: Record<string, number | string> };
type FilterField = "type" | "station" | "airline" | null;

// Color-blind safe palette (Okabe–Ito + Paul Tol extensions).
// Works on both light & dark themes (mid-luminance, high saturation).
const CHART_COLORS = [
  "#0072B2", // blue
  "#E69F00", // orange
  "#009E73", // bluish green
  "#CC79A7", // reddish purple
  "#56B4E9", // sky blue
  "#D55E00", // vermillion
  "#F0E442", // yellow
  "#332288", // indigo
  "#117733", // dark green
  "#AA4499", // magenta
  "#44AA99", // teal
  "#882255", // wine
];
const ACTIVE_COLOR = "#111827"; // near-black ring for selected bar (visible on both themes)

// Stable per-key color so the same item gets the same color across charts/PDF/Excel.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
function colorForKey(key: string): string {
  return CHART_COLORS[hashStr(key) % CHART_COLORS.length];
}
// Convert "#RRGGBB" → "FFRRGGBB" for xlsx fill color (ARGB).
function hexToArgb(hex: string): string {
  return "FF" + hex.replace("#", "").toUpperCase();
}
// Convert "#RRGGBB" → [r,g,b] for jsPDF.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function groupBy<T>(rows: T[], pick: (r: T) => string): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  rows.forEach(r => {
    const k = (pick(r) || "Unspecified").trim() || "Unspecified";
    (m[k] ||= []).push(r);
  });
  return m;
}

function uniqSorted(rows: any[], pick: (r: any) => string): string[] {
  const s = new Set<string>();
  rows.forEach(r => { const v = (pick(r) || "").trim(); if (v) s.add(v); });
  return Array.from(s).sort();
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function StatsTable({
  title, rows, valueCols, onDrill, onExport, onExportChart, onChartClick, activeKey,
}: {
  title: string;
  rows: StatRow[];
  valueCols: { key: string; label: string; format?: (v: any) => string }[];
  onDrill?: (key: string) => void;
  onExport?: () => void;
  onExportChart?: () => void;
  onChartClick?: (key: string) => void;
  activeKey?: string | null;
}) {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const { pageRows, ...pag } = usePagination(sorted, { resetKey: [sorted.length] });
  const total = sorted.reduce((s, r) => s + r.count, 0);
  const chartData = sorted.slice(0, 12).map(r => ({ name: r.key, count: r.count }));

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground mr-2">Total: <b className="text-foreground">{total}</b></span>
          {onExportChart && (
            <Button variant="outline" size="sm" onClick={onExportChart} className="h-7 gap-1" title="Export chart data (top 12)">
              <Download size={13} /> Chart
            </Button>
          )}
          {onExport && (
            <Button variant="outline" size="sm" onClick={onExport} className="h-7 gap-1" title="Export full table data">
              <Download size={13} /> CSV
            </Button>
          )}
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="py-10 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Inbox size={28} className="opacity-50" />
          <p className="text-sm">No data matches the current filters</p>
          <p className="text-xs">Try widening your date range or clearing filters above.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="w-full h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                  cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                />
                <Bar
                  dataKey="count"
                  radius={[4, 4, 0, 0]}
                  cursor={onChartClick ? "pointer" : undefined}
                  onClick={(d: any) => onChartClick?.(d.name)}
                >
                  {chartData.map((d) => {
                    const base = colorForKey(d.name);
                    const isActive = activeKey === d.name;
                    return (
                      <Cell
                        key={d.name}
                        fill={base}
                        fillOpacity={!activeKey || isActive ? 1 : 0.45}
                        stroke={isActive ? ACTIVE_COLOR : "transparent"}
                        strokeWidth={isActive ? 2 : 0}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Legend — consistent color mapping with PDF/Excel */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
            {chartData.map(d => {
              const isActive = activeKey === d.name;
              return (
                <span
                  key={d.name}
                  className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded ${isActive ? "ring-1 ring-foreground/60 bg-muted/40" : ""}`}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm border border-border/50"
                    style={{ background: colorForKey(d.name) }}
                  />
                  <span className="text-foreground/80">{d.name}</span>
                </span>
              );
            })}
            {activeKey && (
              <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-muted-foreground">
                <span className="inline-block w-2.5 h-2.5 rounded-sm border-2" style={{ borderColor: ACTIVE_COLOR }} />
                Selected
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium border-r border-border/40">Item</th>
                  <th className="text-right px-3 py-2 font-medium border-r border-border/40">Count</th>
                  <th className="text-right px-3 py-2 font-medium border-r border-border/40">Share</th>
                  {valueCols.map((c, idx) => (
                    <th key={c.key} className={`text-right px-3 py-2 font-medium ${idx < valueCols.length - 1 || onDrill ? "border-r border-border/40" : ""}`}>{c.label}</th>
                  ))}
                  {onDrill && <th className="px-3 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(r => (
                  <tr
                    key={r.key}
                    className={`border-t border-border hover:bg-muted/30 ${activeKey === r.key ? "bg-accent/10" : ""}`}
                  >
                    <td className="px-3 py-2 border-r border-border/40">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm border border-border/50 shrink-0"
                          style={{ background: colorForKey(r.key) }}
                          aria-hidden
                        />
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getTypeBadgeClass(r.key)}`}>
                          {r.key}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-foreground border-r border-border/40">{r.count}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground border-r border-border/40">
                      {total ? `${((r.count / total) * 100).toFixed(1)}%` : "—"}
                    </td>
                    {valueCols.map((c, idx) => (
                      <td key={c.key} className={`px-3 py-2 text-right text-foreground ${idx < valueCols.length - 1 || onDrill ? "border-r border-border/40" : ""}`}>
                        {c.format ? c.format(r.extra?.[c.key]) : (r.extra?.[c.key] ?? "—")}
                      </td>
                    ))}
                    {onDrill && (
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => onDrill(r.key)}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          title="View underlying rows"
                        >
                          View <ExternalLink size={11} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} />
          </div>
      )}
    </Card>
  );
}

export default function OperationsReportsPage() {
  const navigate = useNavigate();
  const { data: serviceReports = [], isLoading: loadingHandling } = useServiceReportsFS({ scope: "history" });
  const { data: dispatches = [], isLoading: loadingSecurity } = useDispatchBoardFS({ scope: "history" });
  const isLoading = loadingHandling || loadingSecurity;

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [stationFilter, setStationFilter] = useState<string>("all");
  const [airlineFilter, setAirlineFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const typeOptions = useMemo(() => {
    const a = uniqSorted(serviceReports, (r: any) => r.handling_type);
    const b = uniqSorted(dispatches, (r: any) => r.clearance_type || r.service_type);
    return Array.from(new Set([...a, ...b])).sort();
  }, [serviceReports, dispatches]);
  const stationOptions = useMemo(() => {
    const a = uniqSorted(serviceReports, (r: any) => r.station);
    const b = uniqSorted(dispatches, (r: any) => r.station);
    return Array.from(new Set([...a, ...b])).sort();
  }, [serviceReports, dispatches]);
  const airlineOptions = useMemo(() => {
    const a = uniqSorted(serviceReports, (r: any) => r.operator);
    const b = uniqSorted(dispatches, (r: any) => r.airline);
    return Array.from(new Set(["FlyPlus", ...a, ...b])).sort();
  }, [serviceReports, dispatches]);

  const inDateRange = (d: string | null | undefined) => {
    if (!dateFrom && !dateTo) return true;
    const v = (d || "").slice(0, 10);
    if (dateFrom && v < dateFrom) return false;
    if (dateTo && v > dateTo) return false;
    return true;
  };

  const filteredHandling = useMemo(() => serviceReports.filter((r: any) => {
    if (typeFilter !== "all" && r.handling_type !== typeFilter) return false;
    if (stationFilter !== "all" && r.station !== stationFilter) return false;
    if (airlineFilter !== "all" && r.operator !== airlineFilter) return false;
    if (!inDateRange(r.arrival_date || r.departure_date)) return false;
    return true;
  }), [serviceReports, typeFilter, stationFilter, airlineFilter, dateFrom, dateTo]);

  const filteredSecurity = useMemo(() => dispatches.filter((r: any) => {
    const t = r.clearance_type || r.service_type;
    if (typeFilter !== "all" && t !== typeFilter) return false;
    if (stationFilter !== "all" && r.station !== stationFilter) return false;
    if (airlineFilter !== "all" && r.airline !== airlineFilter) return false;
    if (!inDateRange(r.flight_date)) return false;
    return true;
  }), [dispatches, typeFilter, stationFilter, airlineFilter, dateFrom, dateTo]);

  // Handling stats
  const handlingByType = useMemo<StatRow[]>(() => Object.entries(groupBy(filteredHandling, (r: any) => r.handling_type)).map(([key, rows]) => {
    const pax = rows.reduce((s, r: any) =>
      s + Number(r.pax_in_adult_i || 0) + Number(r.pax_in_adult_d || 0) +
      Number(r.pax_in_inf_i || 0) + Number(r.pax_in_inf_d || 0) +
      Number(r.pax_transit || 0), 0);
    return { key, count: rows.length, extra: { pax } };
  }), [filteredHandling]);

  const handlingByStation = useMemo<StatRow[]>(() =>
    Object.entries(groupBy(filteredHandling, (r: any) => r.station)).map(([key, rows]) => ({ key, count: rows.length })),
  [filteredHandling]);

  const handlingByDayNight = useMemo<StatRow[]>(() =>
    Object.entries(groupBy(filteredHandling, (r: any) => r.day_night === "N" ? "Night" : "Day")).map(([key, rows]) => ({ key, count: rows.length })),
  [filteredHandling]);

  const handlingByAirline = useMemo<StatRow[]>(() =>
    Object.entries(groupBy(filteredHandling, (r: any) => r.operator)).map(([key, rows]) => ({ key, count: rows.length })),
  [filteredHandling]);

  // Security stats
  const secByType = useMemo<StatRow[]>(() =>
    Object.entries(groupBy(filteredSecurity, (r: any) => r.clearance_type || r.service_type)).map(([key, rows]) => ({
      key, count: rows.length,
      extra: { completed: rows.filter((r: any) => (r.status || "").toLowerCase() === "completed").length },
    })),
  [filteredSecurity]);
  const secByStatus = useMemo<StatRow[]>(() =>
    Object.entries(groupBy(filteredSecurity, (r: any) => r.status || "Pending")).map(([key, rows]) => ({ key, count: rows.length })),
  [filteredSecurity]);
  const secByStation = useMemo<StatRow[]>(() =>
    Object.entries(groupBy(filteredSecurity, (r: any) => r.station)).map(([key, rows]) => ({ key, count: rows.length })),
  [filteredSecurity]);
  const secByAirline = useMemo<StatRow[]>(() =>
    Object.entries(groupBy(filteredSecurity, (r: any) => r.airline)).map(([key, rows]) => ({ key, count: rows.length })),
  [filteredSecurity]);

  const fmtNum = (v: any) => v ? Number(v).toLocaleString() : "—";

  // Drill-down: forwards currently active filters + the clicked dimension
  const drill = (tab: "security" | "handling", field: FilterField, value: string) => {
    const params = new URLSearchParams({ tab });
    const eff = { type: typeFilter, station: stationFilter, airline: airlineFilter };
    if (field === "type") eff.type = value;
    if (field === "station") eff.station = value;
    if (field === "airline") eff.airline = value;
    if (eff.type !== "all") params.set("type", eff.type);
    if (eff.station !== "all") params.set("station", eff.station);
    if (eff.airline !== "all") params.set("airline", eff.airline);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    // Search fallback so list pages without an explicit airline filter
    // (e.g. Security) still narrow to the clicked dimension.
    if (field === "airline") params.set("search", value);
    navigate(`/service-report?${params.toString()}`);
  };

  // Chart click toggles the corresponding global filter
  const onChartClick = (field: "type" | "station" | "airline", key: string) => {
    if (field === "type") setTypeFilter(t => (t === key ? "all" : key));
    if (field === "station") setStationFilter(t => (t === key ? "all" : key));
    if (field === "airline") setAirlineFilter(t => (t === key ? "all" : key));
  };

  const exportCSV = (
    name: string,
    rows: StatRow[],
    extraCols: { key: string; label: string }[] = [],
    chartOnly = false,
  ) => {
    const headers = ["Item", "Count", "Share %", ...extraCols.map(c => c.label)];
    const sorted = [...rows].sort((a, b) => b.count - a.count);
  const { pageRows, ...pag } = usePagination(sorted, { resetKey: [sorted.length] });
    const slice = chartOnly ? sorted.slice(0, 12) : sorted;
    const total = sorted.reduce((s, r) => s + r.count, 0);
    const body = slice.map(r => [
      r.key, r.count,
      total ? ((r.count / total) * 100).toFixed(1) : "0",
      ...extraCols.map(c => r.extra?.[c.key] ?? ""),
    ]);
    downloadCSV(`${name}${chartOnly ? "_chart" : ""}.csv`, headers, body);
  };

  const activeFilters =
    (typeFilter !== "all" ? 1 : 0) + (stationFilter !== "all" ? 1 : 0) +
    (airlineFilter !== "all" ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

  const filterSummary = () => {
    const parts: string[] = [];
    if (typeFilter !== "all") parts.push(`Type: ${typeFilter}`);
    if (stationFilter !== "all") parts.push(`Station: ${stationFilter}`);
    if (airlineFilter !== "all") parts.push(`Airline: ${airlineFilter}`);
    if (dateFrom) parts.push(`From: ${dateFrom}`);
    if (dateTo) parts.push(`To: ${dateTo}`);
    return parts.length ? parts.join("  •  ") : "All data (no filters applied)";
  };

  const buildSheet = (rows: StatRow[], extraCols: { key: string; label: string }[] = []) => {
    const sorted = [...rows].sort((a, b) => b.count - a.count);
  const { pageRows, ...pag } = usePagination(sorted, { resetKey: [sorted.length] });
    const total = sorted.reduce((s, r) => s + r.count, 0);
    const aoa: any[][] = [
      ["Color", "Item", "Count", "Share %", ...extraCols.map(c => c.label)],
      ...sorted.map(r => [
        "",                       // color swatch cell (filled via cell style below)
        r.key,
        r.count,
        total ? Number(((r.count / total) * 100).toFixed(1)) : 0,
        ...extraCols.map(c => r.extra?.[c.key] ?? ""),
      ]),
      ["", "Total", total, total ? 100 : 0, ...extraCols.map(() => "")],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const headers = aoa[0] as string[];
    // Auto-size columns based on max content width
    ws["!cols"] = headers.map((_, i) => {
      if (i === 0) return { wch: 6 }; // color swatch column
      const max = Math.max(...aoa.map(row => String(row[i] ?? "").length), 8);
      return { wch: Math.min(max + 2, 40) };
    });
    // Freeze header row + autofilter on full header range
    ws["!views"] = [{ state: "frozen", ySplit: 1 }] as any;
    (ws as any)["!freeze"] = { xSplit: 0, ySplit: 1 };
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: headers.length - 1, r: 0 } }) };
    // Bold header row
    headers.forEach((_, i) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: i });
      if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: "FFE5E7EB" } } };
    });
    // Color-swatch fill per row (matches in-app legend / charts)
    sorted.forEach((r, idx) => {
      const addr = XLSX.utils.encode_cell({ r: idx + 1, c: 0 });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      ws[addr].s = { fill: { patternType: "solid", fgColor: { rgb: hexToArgb(colorForKey(r.key)) } } };
    });
    return ws;
  };

  const buildDetailSheet = (rows: any[], columns: { key: string; label: string; fmt?: (v: any) => any }[]) => {
    const header = columns.map(c => c.label);
    const aoa: any[][] = [
      header,
      ...rows.map(r => columns.map(c => (c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? "")))),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = columns.map((_, i) => {
      const max = Math.max(...aoa.map(row => String(row[i] ?? "").length), 8);
      return { wch: Math.min(max + 2, 40) };
    });
    ws["!views"] = [{ state: "frozen", ySplit: 1 }] as any;
    (ws as any)["!freeze"] = { xSplit: 0, ySplit: 1 };
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: columns.length - 1, r: 0 } }) };
    return ws;
  };

  const securityDetailCols = [
    { key: "flight_date", label: "Date" },
    { key: "station", label: "Station" },
    { key: "airline", label: "Airline" },
    { key: "flight_number", label: "Flight" },
    { key: "registration", label: "REG" },
    { key: "aircraft_type", label: "A/C Type" },
    { key: "clearance_type", label: "Clearance Type" },
    { key: "service_type", label: "Service Type" },
    { key: "status", label: "Status" },
    { key: "staff_count", label: "Staff" },
    { key: "duration_hours", label: "Duration (h)" },
  ];
  const handlingDetailCols = [
    { key: "arrival_date", label: "Arrival" },
    { key: "departure_date", label: "Departure" },
    { key: "station", label: "Station" },
    { key: "operator", label: "Operator" },
    { key: "flight_number_in", label: "Flight In" },
    { key: "flight_number_out", label: "Flight Out" },
    { key: "registration", label: "REG" },
    { key: "aircraft_type", label: "A/C Type" },
    { key: "handling_type", label: "Handling Type" },
    { key: "day_night", label: "Day/Night" },
    { key: "mtow", label: "MTOW" },
  ];

  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  // Filename helpers — always reflect the selected date range; fall back to
  // an explicit "all_dates" label (plus today) when no range is set so files
  // are unique and self-describing.
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const fileStamp = () => {
    if (dateFrom && dateTo) return `${dateFrom}_to_${dateTo}`;
    if (dateFrom)           return `from_${dateFrom}`;
    if (dateTo)             return `until_${dateTo}`;
    return `all_dates_${todayIso()}`;
  };
  const buildFileName = (ext: string) => `operations_report_${fileStamp()}.${ext}`;

  const exportExcel = async () => {
    if (exportingExcel) return;
    setExportingExcel(true);
    setExcelError(null);
    try {
      await new Promise(r => setTimeout(r, 30));
      const wb = XLSX.utils.book_new();

      const metaWs = XLSX.utils.aoa_to_sheet([
        ["Operations Report"],
        ["Generated", new Date().toLocaleString()],
        [],
        ["Filters"],
        ["Type", typeFilter === "all" ? "All" : typeFilter],
        ["Station", stationFilter === "all" ? "All" : stationFilter],
        ["Airline", airlineFilter === "all" ? "All" : airlineFilter],
        ["From", dateFrom || "—"],
        ["To", dateTo || "—"],
        [],
        ["Totals"],
        ["Security records", filteredSecurity.length],
        ["Handling records", filteredHandling.length],
      ]);
      metaWs["!cols"] = [{ wch: 24 }, { wch: 32 }];
      XLSX.utils.book_append_sheet(wb, metaWs, "Summary");

      XLSX.utils.book_append_sheet(wb, buildSheet(secByType, [{ key: "completed", label: "Completed" }]), "Sec - By Type");
      XLSX.utils.book_append_sheet(wb, buildSheet(secByAirline), "Sec - By Airline");
      XLSX.utils.book_append_sheet(wb, buildSheet(secByStation), "Sec - By Station");
      XLSX.utils.book_append_sheet(wb, buildSheet(secByStatus), "Sec - By Status");
      XLSX.utils.book_append_sheet(wb, buildDetailSheet(filteredSecurity, securityDetailCols), "Sec - Detail");

      XLSX.utils.book_append_sheet(wb, buildSheet(handlingByType, [{ key: "pax", label: "PAX" }]), "Hdl - By Type");
      XLSX.utils.book_append_sheet(wb, buildSheet(handlingByAirline), "Hdl - By Airline");
      XLSX.utils.book_append_sheet(wb, buildSheet(handlingByStation), "Hdl - By Station");
      XLSX.utils.book_append_sheet(wb, buildSheet(handlingByDayNight), "Hdl - Day vs Night");
      XLSX.utils.book_append_sheet(wb, buildDetailSheet(filteredHandling, handlingDetailCols), "Hdl - Detail");

      XLSX.writeFile(wb, buildFileName("xlsx"));
      toast({ title: "Excel export ready", description: "Your report has been downloaded." });
    } catch (err: any) {
      const msg = err?.message || "Unable to generate the workbook.";
      setExcelError(msg);
      toast({ title: "Excel export failed", description: msg, variant: "destructive" });
    } finally {
      setExportingExcel(false);
    }
  };

  const exportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    setPdfError(null);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      doc.setFontSize(16);
      doc.text("Operations Report", 40, 40);
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 58);
      doc.text(`Filters: ${filterSummary()}`, 40, 72);
      doc.text(`Security records: ${filteredSecurity.length}    Handling records: ${filteredHandling.length}`, 40, 86);
      doc.setTextColor(0);

      let cursorY = 100;

      const addBreakdown = (title: string, rows: StatRow[], extraCols: { key: string; label: string }[] = []) => {
        const sorted = [...rows].sort((a, b) => b.count - a.count);
  const { pageRows, ...pag } = usePagination(sorted, { resetKey: [sorted.length] });
        const total = sorted.reduce((s, r) => s + r.count, 0);
        const head = [["", "Item", "Count", "Share %", ...extraCols.map(c => c.label)]];
        const body = sorted.map(r => [
          "", // color swatch column (filled by didParseCell)
          r.key,
          r.count,
          total ? `${((r.count / total) * 100).toFixed(1)}%` : "—",
          ...extraCols.map(c => r.extra?.[c.key] ?? "—"),
        ]);
        if (body.length === 0) body.push(["", "No data", "", "", ...extraCols.map(() => "")]);
        autoTable(doc, {
          head, body,
          startY: cursorY,
          margin: { left: 40, right: 40, top: 50, bottom: 36 },
          styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak", valign: "middle" },
          headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [245, 247, 250] },
          columnStyles: { 0: { cellWidth: 14, minCellHeight: 12 } },
          showHead: "everyPage",
          rowPageBreak: "avoid",
          // Color the swatch cell per row using the shared colorForKey palette
          didParseCell: (data: any) => {
            if (data.section === "body" && data.column.index === 0) {
              const row = sorted[data.row.index];
              if (row) {
                data.cell.styles.fillColor = hexToRgb(colorForKey(row.key));
                data.cell.text = [""];
              }
            }
          },
          didDrawPage: () => {
            doc.setFontSize(10);
            doc.setTextColor(80);
            doc.text(title, 40, 30);
            doc.setTextColor(0);
            const page = (doc as any).internal.getCurrentPageInfo().pageNumber;
            const pageCount = (doc as any).internal.getNumberOfPages();
            doc.setFontSize(8);
            doc.setTextColor(120);
            doc.text(`Page ${page} of ${pageCount}`, pageW - 90, pageH - 20);
            doc.text("Operations Report — Link Aero", 40, pageH - 20);
            doc.setTextColor(0);
          },
        });
        cursorY = (doc as any).lastAutoTable.finalY + 24;
        if (cursorY > pageH - 100) {
          doc.addPage();
          cursorY = 60;
        }
      };

      const section = (label: string) => {
        if (cursorY > pageH - 120) { doc.addPage(); cursorY = 60; }
        doc.setFontSize(13);
        doc.setTextColor(30, 64, 175);
        doc.text(label, 40, cursorY);
        doc.setTextColor(0);
        cursorY += 14;
      };

      section("Security");
      addBreakdown("Security — By Service Type", secByType, [{ key: "completed", label: "Completed" }]);
      addBreakdown("Security — By Airline", secByAirline);
      addBreakdown("Security — By Station", secByStation);
      addBreakdown("Security — By Status", secByStatus);

      doc.addPage();
      cursorY = 60;
      section("Handling");
      addBreakdown("Handling — By Handling Type", handlingByType, [{ key: "pax", label: "PAX" }]);
      addBreakdown("Handling — By Airline", handlingByAirline);
      addBreakdown("Handling — By Station", handlingByStation);
      addBreakdown("Handling — Day vs Night", handlingByDayNight);

      doc.save(buildFileName("pdf"));
      toast({ title: "PDF export ready", description: "Your report has been downloaded." });
    } catch (err: any) {
      const msg = err?.message || "Unable to generate the PDF.";
      setPdfError(msg);
      toast({ title: "PDF export failed", description: msg, variant: "destructive" });
    } finally {
      setExportingPdf(false);
    }
  };

  const handlePrint = async () => {
    if (printing) return;
    setPrinting(true);
    setPrintError(null);
    try {
      await new Promise(r => setTimeout(r, 50));
      window.print();
    } catch (err: any) {
      setPrintError(err?.message || "Unable to open the print dialog.");
    } finally {
      setTimeout(() => setPrinting(false), 500);
    }
  };


  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground">
        <Loader2 className="animate-spin" size={32} />
        <p className="text-sm">Loading Operations Reports…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" id="ops-report-print-root">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 14mm; }
          body * { visibility: hidden !important; }
          #ops-report-print-root, #ops-report-print-root * { visibility: visible !important; }
          #ops-report-print-root { position: absolute; inset: 0; padding: 0; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          [role="tablist"] { display: none !important; }
          [role="tabpanel"] { display: block !important; margin-top: 12px; page-break-before: auto; }
          .recharts-responsive-container { page-break-inside: avoid; }
          .card, [class*="rounded-lg"][class*="border"] { box-shadow: none !important; break-inside: avoid; }
          table { font-size: 11px; border-collapse: collapse; width: 100%; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          tr, td, th { page-break-inside: avoid !important; break-inside: avoid !important; }
          th, td { border-right: 1px solid #d1d5db !important; }
          th:last-child, td:last-child { border-right: none !important; }
          h1 { font-size: 18px; }
          h3 { font-size: 13px; page-break-after: avoid; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <FileBarChart2 className="text-primary" size={22} />
          <div>
            <h1 className="text-xl font-bold text-foreground">Operations Reports</h1>
            <p className="text-sm text-muted-foreground">Statistics for Security and Handling activity, broken down by item.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 no-print">
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={printing} className="gap-1.5">
            {printing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            {printing ? "Preparing…" : "Print"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={exportingPdf} className="gap-1.5">
            {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            {exportingPdf ? "Generating…" : "Export PDF"}
          </Button>
          <Button variant="default" size="sm" onClick={exportExcel} disabled={exportingExcel} className="gap-1.5">
            {exportingExcel ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            {exportingExcel ? "Generating…" : "Export Excel"}
          </Button>
        </div>
      </div>

      {(excelError || pdfError || printError) && (
        <div className="no-print space-y-2">
          {printError && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span><b>Print failed:</b> {printError}</span>
              <Button size="sm" variant="outline" className="h-7" onClick={handlePrint} disabled={printing}>Retry</Button>
            </div>
          )}
          {pdfError && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span><b>PDF export failed:</b> {pdfError}</span>
              <Button size="sm" variant="outline" className="h-7" onClick={exportPdf} disabled={exportingPdf}>Retry</Button>
            </div>
          )}
          {excelError && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span><b>Excel export failed:</b> {excelError}</span>
              <Button size="sm" variant="outline" className="h-7" onClick={exportExcel} disabled={exportingExcel}>Retry</Button>
            </div>
          )}
        </div>
      )}

      <div className="print-only mb-3 text-xs text-muted-foreground border-b border-border pb-2">
        <div><b>Generated:</b> {new Date().toLocaleString()}</div>
        <div><b>Filters:</b> {filterSummary()}</div>
        <div><b>Security records:</b> {filteredSecurity.length} &nbsp; <b>Handling records:</b> {filteredHandling.length}</div>
      </div>


      <Card className="p-3 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {typeOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs font-medium text-muted-foreground">Station</label>
            <Select value={stationFilter} onValueChange={setStationFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stations</SelectItem>
                {stationOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">Airline</label>
            <Select value={airlineFilter} onValueChange={setAirlineFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Airlines</SelectItem>
                {airlineOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[150px]" />
          </div>
          {activeFilters > 0 && (
            <Button
              variant="ghost" size="sm" className="h-9"
              onClick={() => {
                setTypeFilter("all"); setStationFilter("all"); setAirlineFilter("all");
                setDateFrom(""); setDateTo("");
              }}
            >
              Clear ({activeFilters})
            </Button>
          )}
        </div>
      </Card>

      <Tabs defaultValue="security" className="w-full">
        <TabsList>
          <TabsTrigger value="security" className="gap-1.5"><Shield size={14} /> Security</TabsTrigger>
          <TabsTrigger value="handling" className="gap-1.5"><Plane size={14} /> Handling</TabsTrigger>
        </TabsList>

        <TabsContent value="security" className="space-y-4 mt-4">
          <StatsTable
            title="Security — By Service Type"
            rows={secByType}
            valueCols={[{ key: "completed", label: "Completed", format: fmtNum }]}
            activeKey={typeFilter !== "all" ? typeFilter : null}
            onChartClick={(k) => onChartClick("type", k)}
            onDrill={(k) => drill("security", "type", k)}
            onExport={() => exportCSV("security_by_type", secByType, [{ key: "completed", label: "Completed" }])}
            onExportChart={() => exportCSV("security_by_type", secByType, [{ key: "completed", label: "Completed" }], true)}
          />
          <StatsTable
            title="Security — By Airline"
            rows={secByAirline}
            valueCols={[]}
            activeKey={airlineFilter !== "all" ? airlineFilter : null}
            onChartClick={(k) => onChartClick("airline", k)}
            onDrill={(k) => drill("security", "airline", k)}
            onExport={() => exportCSV("security_by_airline", secByAirline)}
            onExportChart={() => exportCSV("security_by_airline", secByAirline, [], true)}
          />
          <div className="grid md:grid-cols-2 gap-4">
            <StatsTable
              title="Security — By Status"
              rows={secByStatus}
              valueCols={[]}
              onExport={() => exportCSV("security_by_status", secByStatus)}
              onExportChart={() => exportCSV("security_by_status", secByStatus, [], true)}
            />
            <StatsTable
              title="Security — By Station"
              rows={secByStation}
              valueCols={[]}
              activeKey={stationFilter !== "all" ? stationFilter : null}
              onChartClick={(k) => onChartClick("station", k)}
              onDrill={(k) => drill("security", "station", k)}
              onExport={() => exportCSV("security_by_station", secByStation)}
              onExportChart={() => exportCSV("security_by_station", secByStation, [], true)}
            />
          </div>
        </TabsContent>

        <TabsContent value="handling" className="space-y-4 mt-4">
          <StatsTable
            title="Handling — By Handling Type"
            rows={handlingByType}
            valueCols={[{ key: "pax", label: "PAX", format: fmtNum }]}
            activeKey={typeFilter !== "all" ? typeFilter : null}
            onChartClick={(k) => onChartClick("type", k)}
            onDrill={(k) => drill("handling", "type", k)}
            onExport={() => exportCSV("handling_by_type", handlingByType, [{ key: "pax", label: "PAX" }])}
            onExportChart={() => exportCSV("handling_by_type", handlingByType, [{ key: "pax", label: "PAX" }], true)}
          />
          <StatsTable
            title="Handling — By Airline"
            rows={handlingByAirline}
            valueCols={[]}
            activeKey={airlineFilter !== "all" ? airlineFilter : null}
            onChartClick={(k) => onChartClick("airline", k)}
            onDrill={(k) => drill("handling", "airline", k)}
            onExport={() => exportCSV("handling_by_airline", handlingByAirline)}
            onExportChart={() => exportCSV("handling_by_airline", handlingByAirline, [], true)}
          />
          <div className="grid md:grid-cols-2 gap-4">
            <StatsTable
              title="Handling — By Station"
              rows={handlingByStation}
              valueCols={[]}
              activeKey={stationFilter !== "all" ? stationFilter : null}
              onChartClick={(k) => onChartClick("station", k)}
              onDrill={(k) => drill("handling", "station", k)}
              onExport={() => exportCSV("handling_by_station", handlingByStation)}
              onExportChart={() => exportCSV("handling_by_station", handlingByStation, [], true)}
            />
            <StatsTable
              title="Handling — Day vs Night"
              rows={handlingByDayNight}
              valueCols={[]}
              onExport={() => exportCSV("handling_day_night", handlingByDayNight)}
              onExportChart={() => exportCSV("handling_day_night", handlingByDayNight, [], true)}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
