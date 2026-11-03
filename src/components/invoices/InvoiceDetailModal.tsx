import { useEffect, useState } from "react";
import { askEgpRate, egpTotal, fmtEgp, hasEgpTotal, isEthiopianOperator } from "@/lib/invoiceEgp";
import { X, FileText, DollarSign, Plane, Calendar, ShieldCheck, Printer, Clock, CheckCircle, AlertCircle, XCircle, BookOpen, CreditCard, History as HistoryIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateDMY } from "@/lib/utils";
import { parseSecurityDetail, resolveDetailOvertimeHours, SECURITY_INVOICE_COLUMNS, columnsForOperator, type SecurityDetailRow } from "@/lib/securityInvoiceDetail";

type NoHistoryRow = { id: string; old_invoice_no: string | null; new_invoice_no: string; changed_at: string };

export type InvoiceRow = {
  id: string; invoice_no: string; date: string; due_date: string;
  operator: string; airline_iata: string; flight_ref: string; description: string;
  civil_aviation: number; handling: number; airport_charges: number;
  catering: number; other: number; subtotal: number; vat: number; total: number;
  currency: string; status: string; notes: string;
  invoice_type: string; finalized_at: string | null; finalized_by: string | null;
  journal_entry_id: string | null; sent_at: string | null; sent_to: string | null;
  payment_date: string | null; payment_ref: string; billing_period: string;
  credit_note_ref: string; station: string;
};

const statusStyles: Record<string, { cls: string; icon: React.ReactNode }> = {
  Draft:     { cls: "bg-muted text-muted-foreground", icon: <Clock size={14} /> },
  Sent:      { cls: "bg-info/15 text-info", icon: <AlertCircle size={14} /> },
  Paid:      { cls: "bg-success/15 text-success", icon: <CheckCircle size={14} /> },
  Overdue:   { cls: "bg-destructive/15 text-destructive", icon: <XCircle size={14} /> },
  Cancelled: { cls: "bg-warning/15 text-warning", icon: <X size={14} /> },
};

interface Props {
  invoice: InvoiceRow;
  onClose: () => void;
  onEdit: (inv: InvoiceRow) => void;
  onFinalize: (inv: InvoiceRow) => void;
  onPrint: (inv: InvoiceRow) => void;
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className={`text-sm text-foreground font-medium ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}

export default function InvoiceDetailModal({ invoice: inv, onClose, onEdit, onFinalize, onPrint }: Props) {
  const st = statusStyles[inv.status] || statusStyles.Draft;
  const daysUntilDue = Math.ceil((new Date(inv.due_date).getTime() - Date.now()) / 86400000);
  const [issuedOn, setIssuedOn] = useState<string>(inv.date);
  const editIssuedOn = async () => {
    const cur = formatDateDMY(issuedOn);
    while (true) {
      const v = window.prompt("Issued On date (DD/MM/YYYY)", cur);
      if (v === null) return;
      const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const iso = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
      const d = iso ? new Date(iso + "T00:00:00Z") : null;
      if (!d || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) { window.alert("Please enter a valid date as DD/MM/YYYY."); continue; }
      const { error } = await supabase.from("invoices").update({ date: iso } as any).eq("id", inv.id);
      if (error) { window.alert(`Could not save the date: ${error.message}`); return; }
      (inv as any).date = iso;
      setIssuedOn(iso);
      return;
    }
  };
  const [fx, setFx] = useState<{ rate: number | null; base: string | null }>({ rate: (inv as any).exchange_rate ?? null, base: (inv as any).base_currency ?? null });

  // Previous invoice numbers, logged automatically whenever the number is edited.
  const [history, setHistory] = useState<NoHistoryRow[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await (supabase.from as any)("invoice_number_history")
        .select("id,old_invoice_no,new_invoice_no,changed_at")
        .eq("invoice_id", inv.id)
        .order("changed_at", { ascending: false })
        .limit(10);
      if (alive) setHistory((data ?? []) as NoHistoryRow[]);
    })();
    return () => { alive = false; };
  }, [inv.id, inv.invoice_no]);

  const fmt = (n: number) => `${inv.currency} ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  const fmtN = (n: number | undefined) => (n == null ? "" : (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // Parse the per-flight annex embedded in notes (same source as the print view).
  const { detail } = parseSecurityDetail(inv.notes);
  const isSecurity = (inv.invoice_no || "").toUpperCase().includes("-SEC")
    || detail.some(r => r.serviceType || r.aircraftType || r.skdType || r.staffCount != null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-xl border shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-card border-b px-4 md:px-6 py-3 md:py-4 flex items-center justify-between rounded-t-xl z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-foreground text-lg">{inv.invoice_no}</h2>
              <p className="text-xs text-muted-foreground">{inv.operator} · {inv.station}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${st.cls}`}>
              {st.icon} {inv.status}
            </span>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-full text-muted-foreground"><X size={18} /></button>
          </div>
        </div>

        <div className="p-4 md:p-6 space-y-5 md:space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-info/5 rounded-lg p-3 text-center">
              <Calendar size={16} className="mx-auto text-info mb-1" />
              <div className="text-xl font-bold text-foreground">{daysUntilDue > 0 ? daysUntilDue : 0}</div>
              <div className="text-[10px] text-muted-foreground uppercase font-semibold">{daysUntilDue < 0 ? "Days Overdue" : "Days Until Due"}</div>
            </div>
            <div className="bg-success/5 rounded-lg p-3 text-center">
              <ShieldCheck size={16} className="mx-auto text-success mb-1" />
              <div className={`text-xl font-bold ${inv.invoice_type === "Final" ? "text-success" : "text-warning"}`}>{inv.invoice_type || "Preliminary"}</div>
              <div className="text-[10px] text-muted-foreground uppercase font-semibold">Invoice Type</div>
            </div>
          </div>

          {/* Invoice Info */}
          <div className="bg-muted/30 rounded-lg p-4">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5"><Plane size={12} /> Flight & Billing</h3>
            <DetailRow label="Operator" value={inv.operator} />
            <DetailRow label="IATA Code" value={inv.airline_iata} mono />
            <DetailRow label="Total Flights" value={detail.length} mono />
            <DetailRow label="Station" value={inv.station} mono />
            <DetailRow label="Billing Period" value={inv.billing_period} />
            <DetailRow label="Description" value={inv.description} />
          </div>

          {/* Dates */}
          <div className="bg-muted/30 rounded-lg p-4">
            <h3 className="text-xs font-bold text-info uppercase tracking-wider mb-2 flex items-center gap-1.5"><Calendar size={12} /> Dates</h3>
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1"><DetailRow label="Issued On" value={formatDateDMY(issuedOn)} /></div>
              <button onClick={editIssuedOn} className="px-2 py-1 rounded-md border border-border text-xs font-semibold hover:bg-muted">Edit</button>
            </div>
            <DetailRow label="Due Date" value={formatDateDMY(inv.due_date)} />
            {inv.finalized_at && <DetailRow label="Finalized At" value={formatDateDMY(inv.finalized_at)} />}
            {inv.sent_at && <DetailRow label="Sent At" value={formatDateDMY(inv.sent_at)} />}
            {inv.payment_date && <DetailRow label="Payment Date" value={formatDateDMY(inv.payment_date)} />}
          </div>

          {isEthiopianOperator(inv.operator, inv.airline_iata) && (
            <div className="bg-muted/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5"><DollarSign size={12} /> Total in EGP</h3>
                <button
                  onClick={async () => {
                    const r = askEgpRate(fx.rate);
                    if (!r) return;
                    const date = new Date().toISOString().slice(0, 10);
                    const { error } = await supabase.from("invoices").update({ exchange_rate: r, exchange_rate_date: date, base_currency: "EGP", base_total: egpTotal(Number(inv.total) || 0, r) } as any).eq("id", inv.id);
                    if (error) { window.alert(`Could not save the rate: ${error.message}`); return; }
                    setFx({ rate: r, base: "EGP" });
                  }}
                  className="px-2 py-1 rounded-md border border-border text-xs font-semibold hover:bg-muted"
                >{fx.rate ? "Edit rate" : "Enter rate"}</button>
              </div>
              <DetailRow label={`Total (${inv.currency || "USD"})`} value={`${inv.currency || "USD"} ${(Number(inv.total) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} mono />
              <DetailRow label="Exchange Rate" value={hasEgpTotal({ exchange_rate: fx.rate, base_currency: fx.base }) ? `1 USD = ${Number(fx.rate).toFixed(2)} EGP` : "Not entered"} mono />
              <DetailRow label="Total in EGP" value={hasEgpTotal({ exchange_rate: fx.rate, base_currency: fx.base }) ? fmtEgp(egpTotal(inv.total, fx.rate!)) : "—"} mono />
            </div>
          )}

          {/* Invoice number history */}
          {history.length > 0 && (
            <div className="bg-muted/30 rounded-lg p-4">
              <h3 className="text-xs font-bold text-warning uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <HistoryIcon size={12} /> Invoice Number History
              </h3>
              <div className="space-y-1.5">
                {history.map(h => (
                  <div key={h.id} className="flex items-center justify-between text-xs gap-2">
                    <span className="font-mono text-muted-foreground line-through">{h.old_invoice_no || "—"}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-mono font-semibold text-foreground flex-1">{h.new_invoice_no}</span>
                    <span className="text-muted-foreground whitespace-nowrap">{formatDateDMY(h.changed_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Charges Breakdown — mirrors the printable Annex A per-flight detail */}
          <div className="bg-muted/30 rounded-lg p-4">
            <h3 className="text-xs font-bold text-success uppercase tracking-wider mb-3 flex items-center gap-1.5"><DollarSign size={12} /> Charges Breakdown</h3>

            {detail.length === 0 ? (
              <div className="text-xs text-muted-foreground py-3 text-center">
                No per-flight detail attached to this invoice.
              </div>
            ) : isSecurity ? (
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-muted/60">
                      {columnsForOperator(SECURITY_INVOICE_COLUMNS, isEthiopianOperator(inv.operator, inv.airline_iata)).map(h => (
                        <th key={h} className="border border-border px-1.5 py-1 text-center font-bold text-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...detail].sort((a, b) => {
                      const ka = (a.arrDate || a.depDate || a.date || "") + (a.flight || "");
                      const kb = (b.arrDate || b.depDate || b.date || "") + (b.flight || "");
                      return ka.localeCompare(kb);
                    }).map((r: SecurityDetailRow, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="border border-border px-1.5 py-1 text-center">{i + 1}</td>
                        <td className="border border-border px-1.5 py-1 text-center whitespace-nowrap">{r.arrDate ? formatDateDMY(r.arrDate) : (r.date ? formatDateDMY(r.date) : "—")}</td>
                        <td className="border border-border px-1.5 py-1 text-center whitespace-nowrap">{r.depDate ? formatDateDMY(r.depDate) : "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-center font-mono">{r.flight || "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-center font-mono">{r.reg || "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-center">{r.route || "—"}</td>
                        {!isEthiopianOperator(inv.operator, inv.airline_iata) && <td className="border border-border px-1.5 py-1 text-center">{r.serviceType || r.type || "—"}</td>}
                        <td className="border border-border px-1.5 py-1 text-center">{r.actualStart || "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-center">{r.actualEnd || "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-right font-mono">{r.durationHours != null ? Number(r.durationHours).toFixed(2) : "—"}</td>
                        {!isEthiopianOperator(inv.operator, inv.airline_iata) && <td className="border border-border px-1.5 py-1 text-right font-mono">{resolveDetailOvertimeHours(r).toFixed(2)}</td>}
                        <td className="border border-border px-1.5 py-1 text-right font-mono">{fmtN((r.handling || 0) + (r.other || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-muted/60">
                      {["S", "Date", "Flight", "Reg.", "Route", "Station", "Service", "Civil Aviation", "Handling", "Airport", "Other", "Total"].map(h => (
                        <th key={h} className="border border-border px-1.5 py-1 text-center font-bold text-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="border border-border px-1.5 py-1 text-center">{i + 1}</td>
                        <td className="border border-border px-1.5 py-1 text-center whitespace-nowrap">{r.date ? formatDateDMY(r.date) : "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-center font-mono">{r.flight || "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-center font-mono">{r.reg || "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-center">{r.route || "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-center">{r.station || "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-center">{r.type || r.serviceType || "—"}</td>
                        <td className="border border-border px-1.5 py-1 text-right font-mono">{fmtN(r.civil)}</td>
                        <td className="border border-border px-1.5 py-1 text-right font-mono">{fmtN(r.handling)}</td>
                        <td className="border border-border px-1.5 py-1 text-right font-mono">{fmtN(r.airport)}</td>
                        <td className="border border-border px-1.5 py-1 text-right font-mono">{fmtN(r.other)}</td>
                        <td className="border border-border px-1.5 py-1 text-right font-mono font-semibold">{fmtN(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Aggregated buckets stored on the invoice */}
            <div className="mt-4 pt-3 border-t border-border/60">
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Invoice Buckets</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {[
                  { l: "Civil Aviation Authority Fees", v: inv.civil_aviation },
                  { l: "Security Fee",                  v: inv.handling },
                  { l: "Airport Charges",               v: inv.airport_charges },
                  { l: "Catering",                      v: inv.catering },
                  { l: "Other Charges",                 v: inv.other },
                ].filter(x => x.v).map(x => (
                  <div key={x.l} className="flex justify-between items-center py-1.5 border-b border-border/30">
                    <span className="text-xs text-foreground">{x.l}</span>
                    <span className="text-xs font-mono font-semibold text-foreground">{fmt(x.v)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center pt-2 mt-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subtotal</span>
                <span className="text-sm font-mono font-semibold text-foreground">{fmt(inv.subtotal)}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-xs text-muted-foreground">VAT</span>
                <span className="text-xs font-mono text-foreground">{fmt(inv.vat)}</span>
              </div>
            </div>
          </div>

          {/* Payment Info */}
          {(inv.payment_ref || inv.credit_note_ref || inv.journal_entry_id) && (
            <div className="bg-muted/30 rounded-lg p-4">
              <h3 className="text-xs font-bold text-amber uppercase tracking-wider mb-2 flex items-center gap-1.5"><CreditCard size={12} /> Payment & Accounting</h3>
              {inv.payment_ref && <DetailRow label="Payment Reference" value={inv.payment_ref} mono />}
              {inv.credit_note_ref && <DetailRow label="Credit Note Ref" value={inv.credit_note_ref} mono />}
              {inv.finalized_by && <DetailRow label="Finalized By" value={inv.finalized_by} />}
              {inv.sent_to && <DetailRow label="Sent To" value={inv.sent_to} />}
              {inv.journal_entry_id && <DetailRow label="Journal Entry" value={<span className="flex items-center gap-1"><BookOpen size={12} className="text-success" /> Linked</span>} />}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-card border-t px-4 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-between rounded-b-xl">
          <button onClick={onClose} className="toolbar-btn-outline w-full sm:w-auto">Close</button>
          <div className="flex gap-2 flex-wrap">
            {inv.invoice_type !== "Final" && (
              <button onClick={() => { onClose(); onFinalize(inv); }} className="toolbar-btn-success flex items-center gap-1.5 flex-1 sm:flex-none justify-center"><ShieldCheck size={14} /> Finalize</button>
            )}
            <button onClick={() => { onClose(); onPrint(inv); }} className="toolbar-btn-outline flex items-center gap-1.5 flex-1 sm:flex-none justify-center"><Printer size={14} /> Print</button>
            <button onClick={() => { onClose(); onEdit(inv); }} className="toolbar-btn-primary flex items-center gap-1.5 flex-1 sm:flex-none justify-center"><FileText size={14} /> Edit</button>
          </div>
        </div>
      </div>
    </div>
  );
}
