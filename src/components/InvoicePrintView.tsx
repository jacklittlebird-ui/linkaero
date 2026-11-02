import { egpTotal, fmtEgp, hasEgpTotal } from "@/lib/invoiceEgp";
import { X, Download, AlertTriangle } from "lucide-react";

export interface PrintableInvoice {
  invoiceNo: string;
  date: string;
  dueDate: string;
  operator: string;
  airlineIATA: string;
  flightRef: string;
  description: string;
  civilAviation: number;
  handling: number;
  airportCharges: number;
  catering: number;
  other: number;
  subtotal: number;
  vat: number;
  total: number;
  currency: string;
  status: string;
  notes: string;
  exchange_rate?: number | null;
  base_currency?: string | null;
}

interface InvoicePrintViewProps {
  invoice: PrintableInvoice;
  onClose: () => void;
}

type DetailRow = {
  date?: string; flight?: string; route?: string; reg?: string; station?: string;
  type?: string; civil?: number; handling?: number; airport?: number; other?: number; total?: number;
};

type ParseStatus = "ok" | "missing" | "malformed" | "empty";

/**
 * Robust parser for the __DETAIL__:[...] payload embedded in invoice notes.
 * Returns:
 *   - detail: parsed/sanitized rows (always an array)
 *   - cleanNotes: notes with the marker payload stripped
 *   - status: 'ok' | 'missing' (no marker) | 'malformed' (parse failed) | 'empty' (marker present but 0 rows)
 *   - parseError: human-readable reason when status !== 'ok'
 */
function parseDetail(notes: string | null | undefined): {
  detail: DetailRow[];
  cleanNotes: string;
  status: ParseStatus;
  parseError?: string;
} {
  const raw = (notes ?? "").toString();
  if (!raw.trim()) return { detail: [], cleanNotes: "", status: "missing" };

  const markerIdx = raw.indexOf("__DETAIL__:");
  if (markerIdx === -1) return { detail: [], cleanNotes: raw.trim(), status: "missing" };

  const startBracket = raw.indexOf("[", markerIdx);
  if (startBracket === -1) {
    return {
      detail: [],
      cleanNotes: raw.replace(/__DETAIL__:.*$/s, "").trim(),
      status: "malformed",
      parseError: "Detail marker present but no JSON array found.",
    };
  }

  let depth = 0;
  let endBracket = -1;
  let inString = false;
  let escape = false;
  for (let i = startBracket; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) { endBracket = i; break; }
    }
  }

  if (endBracket === -1) {
    return {
      detail: [],
      cleanNotes: raw.slice(0, markerIdx).trim(),
      status: "malformed",
      parseError: "Detail JSON array is unterminated.",
    };
  }

  const jsonStr = raw.slice(startBracket, endBracket + 1);
  const cleanNotes = (raw.slice(0, markerIdx) + raw.slice(endBracket + 1)).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      return { detail: [], cleanNotes, status: "malformed", parseError: "Detail payload is not a JSON array." };
    }
    const detail: DetailRow[] = parsed
      .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
      .map((r: any) => ({
        date: r.date ? String(r.date) : "",
        flight: r.flight ? String(r.flight) : "",
        reg: r.reg ? String(r.reg) : "",
        route: r.route ? String(r.route) : "",
        station: r.station ? String(r.station) : "",
        type: r.type ? String(r.type) : "",
        civil: Number(r.civil) || 0,
        handling: Number(r.handling) || 0,
        airport: Number(r.airport) || 0,
        other: Number(r.other) || 0,
        total: Number(r.total) || 0,
      }));
    if (detail.length === 0) {
      return { detail, cleanNotes, status: "empty", parseError: "Detail array is empty." };
    }
    return { detail, cleanNotes, status: "ok" };
  } catch (e: any) {
    return { detail: [], cleanNotes, status: "malformed", parseError: `Invalid JSON: ${e?.message || "parse error"}` };
  }
}

const ROWS_PER_PAGE = 22; // keeps each annex page within standard A4 print height

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadAnnexCsv(invoiceNo: string, detail: DetailRow[]) {
  const headers = ["Date", "Flight", "Reg", "Route", "Station", "Service", "Civil Aviation", "Handling", "Airport", "Other", "Total"];
  const lines = [headers.join(",")];
  detail.forEach(d => {
    lines.push([
      d.date, d.flight, d.reg, d.route, d.station, d.type,
      (d.civil || 0).toFixed(2),
      (d.handling || 0).toFixed(2),
      (d.airport || 0).toFixed(2),
      (d.other || 0).toFixed(2),
      (d.total || 0).toFixed(2),
    ].map(csvEscape).join(","));
  });
  // Grand totals row
  const sum = (k: keyof DetailRow) => detail.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  lines.push(["", "", "", "", "", "TOTAL",
    sum("civil").toFixed(2), sum("handling").toFixed(2),
    sum("airport").toFixed(2), sum("other").toFixed(2), sum("total").toFixed(2),
  ].map(csvEscape).join(","));

  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Annex-A-${invoiceNo || "invoice"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}



export default function InvoicePrintView({ invoice, onClose }: InvoicePrintViewProps) {
  const handlePrint = () => window.print();
  const { detail, cleanNotes, status: detailStatus, parseError } = parseDetail(invoice.notes || "");
  const isMonthlyConsolidated =
    /__DETAIL__:|annex a/i.test(invoice.notes || "") || invoice.flightRef?.toLowerCase().includes("flights");
  const showAnnex = detail.length > 0 || isMonthlyConsolidated;

  // Recompute annex totals to verify against invoice totals
  const annexTotals = detail.reduce(
    (s, d) => ({
      civil: s.civil + (d.civil || 0),
      handling: s.handling + (d.handling || 0),
      airport: s.airport + (d.airport || 0),
      other: s.other + (d.other || 0),
      total: s.total + (d.total || 0),
    }),
    { civil: 0, handling: 0, airport: 0, other: 0, total: 0 }
  );
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const TOL = 0.01;
  const totalsMismatch = detail.length > 0 && (
    Math.abs(round2(annexTotals.civil) - round2(invoice.civilAviation || 0)) > TOL ||
    Math.abs(round2(annexTotals.handling) - round2(invoice.handling || 0)) > TOL ||
    Math.abs(round2(annexTotals.airport) - round2(invoice.airportCharges || 0)) > TOL ||
    Math.abs(round2(annexTotals.other) - round2(invoice.other || 0)) > TOL
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[95vh] overflow-y-auto m-4 print:m-0 print:shadow-none print:rounded-none print:max-h-none print:overflow-visible">
        {/* No-print toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b print:hidden">
          <span className="text-sm font-semibold text-gray-600">Invoice Preview</span>
          <div className="flex gap-2">
            {detail.length > 0 && (
              <button
                onClick={() => downloadAnnexCsv(invoice.invoiceNo, detail)}
                className="toolbar-btn-outline"
                title="Export the per-flight Annex A as a CSV file"
              >
                <Download size={14} /> Export Annex A CSV
              </button>
            )}
            <button onClick={handlePrint} className="toolbar-btn-primary">🖨 Print / Save PDF</button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full text-gray-500"><X size={18} /></button>
          </div>
        </div>

        {/* Totals mismatch warning (no-print) */}
        {totalsMismatch && (
          <div className="mx-6 mt-3 p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-xs flex gap-2 print:hidden">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold mb-1">Annex totals don't match invoice totals</div>
              <table className="text-[11px] mt-1">
                <thead>
                  <tr className="text-amber-700">
                    <th className="text-left pr-3">Category</th>
                    <th className="text-right pr-3">Invoice</th>
                    <th className="text-right pr-3">Annex Sum</th>
                    <th className="text-right">Δ</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {([
                    ["Civil Aviation", invoice.civilAviation || 0, annexTotals.civil],
                    ["Handling", invoice.handling || 0, annexTotals.handling],
                    ["Airport", invoice.airportCharges || 0, annexTotals.airport],
                    ["Other", invoice.other || 0, annexTotals.other],
                  ] as const).map(([label, inv, sum]) => {
                    const diff = round2(sum - inv);
                    return (
                      <tr key={label} className={Math.abs(diff) > TOL ? "text-amber-900" : "text-amber-600"}>
                        <td className="pr-3 font-sans">{label}</td>
                        <td className="text-right pr-3">{inv.toFixed(2)}</td>
                        <td className="text-right pr-3">{sum.toFixed(2)}</td>
                        <td className="text-right">{diff > 0 ? "+" : ""}{diff.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Printable content */}
        <div className="p-8 text-gray-900" id="invoice-print-area">
          {/* Header */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">✈ Link Aero</h1>
              <p className="text-sm text-gray-500 mt-1">Ground Handling & Aviation Services</p>
              <p className="text-xs text-gray-400 mt-0.5">Cairo, Egypt</p>
            </div>
            <div className="text-right">
              <h2 className="text-xl font-bold text-gray-800">INVOICE</h2>
              <p className="text-sm font-mono font-semibold mt-1">{invoice.invoiceNo}</p>
              <p className="text-xs text-gray-500 mt-1">Date: {invoice.date}</p>
              <p className="text-xs text-gray-500">Due: {invoice.dueDate}</p>
            </div>
          </div>

          {/* Bill To */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Bill To</p>
            <p className="font-semibold text-lg">{invoice.operator}</p>
            <p className="text-sm text-gray-600">IATA: {invoice.airlineIATA} · Total Flights: {detail.length}</p>
            {invoice.description && <p className="text-sm text-gray-500 mt-1">{invoice.description}</p>}
          </div>

          {/* Line Items */}
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-2 text-xs font-bold text-gray-500 uppercase">Item</th>
                <th className="text-right py-2 text-xs font-bold text-gray-500 uppercase">Amount ({invoice.currency})</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Civil Aviation Authority Fees", amount: invoice.civilAviation },
                { label: "Security Fee", amount: invoice.handling },
                { label: "Airport Charges", amount: invoice.airportCharges },
                { label: "Catering", amount: invoice.catering },
                { label: "Other Charges", amount: invoice.other },
              ].filter(item => item.amount > 0).map((item, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-2.5">{item.label}</td>
                  <td className="py-2.5 text-right font-mono">{item.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end mb-8">
            <div className="w-64">
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-mono">{invoice.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-gray-500">VAT</span>
                <span className="font-mono">{invoice.vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2.5 text-lg font-bold border-t-2 border-gray-900 mt-1">
                <span>Total</span>
                <span>{invoice.currency} {invoice.total.toFixed(2)}</span>
              </div>
              {hasEgpTotal(invoice) && (
                <div className="flex justify-between py-1.5 text-sm font-bold">
                  <span>Total in EGP <span className="font-normal text-gray-500">(1 USD = {Number(invoice.exchange_rate).toFixed(2)} EGP)</span></span>
                  <span className="font-mono">{fmtEgp(egpTotal(invoice.total, Number(invoice.exchange_rate)))}</span>
                </div>
              )}
            </div>
          </div>

          {/* Status */}
          <div className="mb-8 text-center">
            <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider ${
              invoice.status === "Paid" ? "bg-green-100 text-green-700" :
              invoice.status === "Overdue" ? "bg-red-100 text-red-700" :
              invoice.status === "Sent" ? "bg-blue-100 text-blue-700" :
              "bg-gray-100 text-gray-600"
            }`}>
              {invoice.status}
            </span>
          </div>

          {/* Notes */}
          {cleanNotes && (
            <div className="mb-8 p-3 bg-gray-50 rounded text-sm text-gray-600">
              <span className="font-semibold">Notes:</span> {cleanNotes}
            </div>
          )}

          {/* Per-Flight Detail Annex — paginated for print */}
          {showAnnex && detail.length === 0 && (
            <div className="mt-10 pt-6 border-t-2 border-gray-300 break-before-page print:break-before-page">
              <h3 className="text-lg font-bold text-gray-800 mb-2">Annex A — Per-Flight Service Detail</h3>
              <div className="p-6 rounded border border-dashed border-gray-300 bg-gray-50 text-center">
                <p className="text-sm font-semibold text-gray-700">No per-flight detail available</p>
                <p className="text-xs text-gray-500 mt-1">
                  {detailStatus === "missing" && "This invoice was not generated from per-flight service reports."}
                  {detailStatus === "malformed" && `The attached detail could not be read${parseError ? `: ${parseError}` : "."}`}
                  {detailStatus === "empty" && "Detail payload is present but contains no flight rows."}
                </p>
              </div>
            </div>
          )}
          {detail.length > 0 && (() => {
            const grandTotals = detail.reduce(
              (s, d) => ({
                civil: s.civil + (d.civil || 0),
                handling: s.handling + (d.handling || 0),
                airport: s.airport + (d.airport || 0),
                other: s.other + (d.other || 0),
                total: s.total + (d.total || 0),
              }),
              { civil: 0, handling: 0, airport: 0, other: 0, total: 0 }
            );
            const pages: DetailRow[][] = [];
            for (let i = 0; i < detail.length; i += ROWS_PER_PAGE) {
              pages.push(detail.slice(i, i + ROWS_PER_PAGE));
            }
            const totalPages = pages.length;

            const byStation: Record<string, { flights: number; total: number }> = {};
            detail.forEach(d => {
              const k = d.station || "—";
              if (!byStation[k]) byStation[k] = { flights: 0, total: 0 };
              byStation[k].flights++;
              byStation[k].total += d.total || 0;
            });
            const stationRows = Object.entries(byStation);

            return (
              <>
                {pages.map((pageRows, pageIdx) => {
                  const isLast = pageIdx === totalPages - 1;
                  const pageRunning = pageRows.reduce(
                    (s, d) => ({
                      civil: s.civil + (d.civil || 0),
                      handling: s.handling + (d.handling || 0),
                      airport: s.airport + (d.airport || 0),
                      other: s.other + (d.other || 0),
                      total: s.total + (d.total || 0),
                    }),
                    { civil: 0, handling: 0, airport: 0, other: 0, total: 0 }
                  );
                  return (
                    <div
                      key={pageIdx}
                      className="mt-10 pt-6 border-t-2 border-gray-300 break-before-page print:break-before-page"
                    >
                      <div className="flex items-end justify-between mb-1">
                        <h3 className="text-lg font-bold text-gray-800">
                          Annex A — Per-Flight Service Detail
                        </h3>
                        <span className="text-xs text-gray-500 font-mono">
                          Page {pageIdx + 1} of {totalPages}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-4">
                        Invoice {invoice.invoiceNo} · {invoice.operator} · {detail.length} flight{detail.length === 1 ? "" : "s"} total
                      </p>
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b-2 border-gray-300 bg-gray-50">
                            {["Date","Flight","Reg","Route","Station","Service","Civil Av.","Handling","Airport","Other","Total"].map(h => (
                              <th key={h} className="px-2 py-1.5 text-left font-bold text-gray-600 uppercase whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((d, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="px-2 py-1.5 whitespace-nowrap">{d.date || "—"}</td>
                              <td className="px-2 py-1.5 font-mono whitespace-nowrap">{d.flight || "—"}</td>
                              <td className="px-2 py-1.5 font-mono whitespace-nowrap">{d.reg || "—"}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{d.route || "—"}</td>
                              <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{d.station || "—"}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{d.type || "—"}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{(d.civil || 0).toFixed(2)}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{(d.handling || 0).toFixed(2)}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{(d.airport || 0).toFixed(2)}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{(d.other || 0).toFixed(2)}</td>
                              <td className="px-2 py-1.5 text-right font-mono font-bold">{(d.total || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-gray-400 bg-gray-50/60 italic">
                            <td colSpan={6} className="px-2 py-1.5 text-right text-gray-600">Page Subtotal</td>
                            <td className="px-2 py-1.5 text-right font-mono">{pageRunning.civil.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{pageRunning.handling.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{pageRunning.airport.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{pageRunning.other.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{pageRunning.total.toFixed(2)}</td>
                          </tr>
                          {isLast && (
                            <tr className="border-t-2 border-gray-700 bg-gray-50 font-bold">
                              <td colSpan={6} className="px-2 py-2 text-right">Annex Grand Total</td>
                              <td className="px-2 py-2 text-right font-mono">{grandTotals.civil.toFixed(2)}</td>
                              <td className="px-2 py-2 text-right font-mono">{grandTotals.handling.toFixed(2)}</td>
                              <td className="px-2 py-2 text-right font-mono">{grandTotals.airport.toFixed(2)}</td>
                              <td className="px-2 py-2 text-right font-mono">{grandTotals.other.toFixed(2)}</td>
                              <td className="px-2 py-2 text-right font-mono">{grandTotals.total.toFixed(2)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>

                      {/* Subtotals by Station — only on the last annex page */}
                      {isLast && stationRows.length > 1 && (
                        <div className="mt-6">
                          <h4 className="text-sm font-bold text-gray-800 mb-2">Subtotals by Station</h4>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b-2 border-gray-300 bg-gray-50">
                                <th className="px-2 py-1.5 text-left font-bold text-gray-600 uppercase">Station</th>
                                <th className="px-2 py-1.5 text-right font-bold text-gray-600 uppercase">Flights</th>
                                <th className="px-2 py-1.5 text-right font-bold text-gray-600 uppercase">Total ({invoice.currency})</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stationRows.map(([st, v]) => (
                                <tr key={st} className="border-b border-gray-100">
                                  <td className="px-2 py-1.5 font-semibold">{st}</td>
                                  <td className="px-2 py-1.5 text-right font-mono">{v.flights}</td>
                                  <td className="px-2 py-1.5 text-right font-mono">{v.total.toFixed(2)}</td>
                                </tr>
                              ))}
                              <tr className="border-t-2 border-gray-700 bg-gray-50 font-bold">
                                <td className="px-2 py-1.5">Total</td>
                                <td className="px-2 py-1.5 text-right font-mono">{detail.length}</td>
                                <td className="px-2 py-1.5 text-right font-mono">{grandTotals.total.toFixed(2)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}


          {/* Signature */}
          <div className="grid grid-cols-2 gap-12 mt-12 pt-4">
            <div>
              <div className="border-b border-gray-300 mb-2 h-12"></div>
              <p className="text-xs text-gray-500">Authorized Signature (Link Aero)</p>
            </div>
            <div>
              <div className="border-b border-gray-300 mb-2 h-12"></div>
              <p className="text-xs text-gray-500">Client Signature / Stamp</p>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-4 border-t border-gray-200 text-center text-xs text-gray-400">
            <p>Link Aero · Aviation Ground Handling Services · Cairo, Egypt</p>
            <p className="mt-0.5">Thank you for your business</p>
          </div>
        </div>
      </div>
    </div>
  );
}
