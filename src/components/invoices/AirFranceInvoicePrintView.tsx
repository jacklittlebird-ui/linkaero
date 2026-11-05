import { useState } from "react";
import { X, Printer, Download } from "lucide-react";
import linkAeroLogo from "@/assets/linkaero-logo.png";
import ighcLogo from "@/assets/ighc-logo.jpg";
import { formatDateDMY } from "@/lib/utils";
import { parseSecurityDetail, type SecurityDetailRow } from "@/lib/securityInvoiceDetail";
import type { SecurityPrintInvoice } from "./SecurityInvoicePrintView";

/** Cargo flights = rows whose airline is Air France Cargo. */
export const isAfCargoRow = (r: SecurityDetailRow) => /cargo/i.test(r.airline || "");

export const splitAirFranceRows = (rows: SecurityDetailRow[]) => {
  const sort = (a: SecurityDetailRow, b: SecurityDetailRow) =>
    ((a.arrDate || a.date || "") + (a.flight || "")).localeCompare((b.arrDate || b.date || "") + (b.flight || ""));
  const pax = rows.filter(r => !isAfCargoRow(r)).sort(sort);
  const cargo = rows.filter(isAfCargoRow).sort(sort);
  const sum = (l: SecurityDetailRow[]) => l.reduce((s, r) => s + (Number(r.total) || 0), 0);
  return { pax, cargo, paxTotal: sum(pax), cargoTotal: sum(cargo) };
};

const BILL_TO = [
  "Air France",
  "Attn: Joint Station Manager/ Accounts Payable",
  "Cairo International Airport (CAI)",
  "Cairo, Egypt",
];

const money = (n: number, c: string) => `${c} ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props { invoice: SecurityPrintInvoice; onClose: () => void; }

export default function AirFranceInvoicePrintView({ invoice, onClose }: Props) {
  const { detail } = parseSecurityDetail(invoice.notes);
  const { pax, cargo, paxTotal, cargoTotal } = splitAirFranceRows(detail);
  const ccy = invoice.currency || "USD";
  const grand = detail.length ? paxTotal + cargoTotal : invoice.total;
  const [busy, setBusy] = useState(false);

  const sections = [
    { title: "Passenger Security - CAI", rows: pax, total: paxTotal },
    { title: "Freighter Rotation / Security - CAI", rows: cargo, total: cargoTotal },
  ];

  const downloadPdf = async () => {
    setBusy(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const L = 14;
      try {
        const blob = await (await fetch(linkAeroLogo)).blob();
        const url: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });
        const p = pdf.getImageProperties(url);
        pdf.addImage(url, "PNG", L, 10, 45, (p.height / p.width) * 45);
      } catch { /* optional */ }
      pdf.setFontSize(18); pdf.text("INVOICE", 196, 20, { align: "right" });
      pdf.setFontSize(9);
      pdf.text(`Invoice #: ${invoice.invoiceNo}`, 196, 28, { align: "right" });
      pdf.text(`Issued On: ${formatDateDMY(invoice.date)}`, 196, 33, { align: "right" });
      if (invoice.billingPeriod) pdf.text(`Period: ${invoice.billingPeriod}`, 196, 38, { align: "right" });
      pdf.text("Tax ID: 215-137-108", 196, 43, { align: "right" });
      pdf.setFont("helvetica", "bold"); pdf.text("Bill To:", L, 50);
      pdf.setFont("helvetica", "normal");
      BILL_TO.forEach((l, i) => pdf.text(l, L, 56 + i * 5));
      autoTable(pdf, {
        startY: 80,
        head: [["Details", "Amount"]],
        body: [
          ["Passenger Security - CAI", money(paxTotal, ccy)],
          ["Cargo Security", money(cargoTotal, ccy)],
          [{ content: "Total Invoice Amount", styles: { fontStyle: "bold" } }, { content: money(grand, ccy), styles: { fontStyle: "bold" } }],
        ],
        styles: { fontSize: 10 }, headStyles: { fillColor: [30, 64, 175] }, columnStyles: { 1: { halign: "right" } },
      });
      for (const s of sections) {
        pdf.addPage();
        pdf.setFontSize(14); pdf.setFont("helvetica", "bold");
        pdf.text(s.title, 105, 18, { align: "center" });
        pdf.setFontSize(10); pdf.setFont("helvetica", "normal");
        pdf.text("Air France", 105, 24, { align: "center" });
        autoTable(pdf, {
          startY: 30,
          head: [["#", "DATE", "FLIGHT No.", "REG", "AMOUNT"]],
          body: s.rows.map((r, i) => [i + 1, formatDateDMY(r.arrDate || r.date || ""), r.flight || "", r.reg || "", money(Number(r.total) || 0, ccy)]),
          foot: [["", "", "", "Total", money(s.total, ccy)]],
          styles: { fontSize: 9 }, headStyles: { fillColor: [30, 64, 175] }, footStyles: { fillColor: [230, 230, 230], textColor: 20 },
          columnStyles: { 4: { halign: "right" } },
        });
      }
      pdf.save(`${invoice.invoiceNo || "invoice"}.pdf`);
    } finally { setBusy(false); }
  };

  const th = "border border-gray-800 px-2 py-1 text-center font-bold";
  const td = "border border-gray-800 px-2 py-1 text-center";

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-auto py-6 print:static print:bg-white print:p-0">
      <div className="bg-white w-[210mm] shadow-xl print:shadow-none">
        <div className="no-print flex items-center justify-end gap-2 p-3 border-b">
          <button onClick={downloadPdf} disabled={busy} className="toolbar-btn-primary inline-flex items-center gap-1.5"><Download size={14} /> {busy ? "Generating…" : "Download PDF"}</button>
          <button onClick={() => window.print()} className="toolbar-btn-primary inline-flex items-center gap-1.5"><Printer size={14} /> Print / Save PDF</button>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full text-gray-500"><X size={18} /></button>
        </div>
        <style>{`@media print { @page { size: A4 portrait; margin: 10mm; } .no-print { display:none !important; } .af-page { break-after: page; } .af-page:last-child { break-after: auto; } }`}</style>
        <div className="p-8 text-gray-900" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
          {/* Page 1 */}
          <div className="af-page border-2 border-gray-800 p-6 mb-8">
            <div className="flex justify-between mb-6">
              <img src={linkAeroLogo} alt="Link Aero" className="h-24 w-auto object-contain" />
              <div className="text-right text-sm">
                <img src={ighcLogo} alt="IGHC" className="h-14 w-auto ml-auto mb-2" />
                <h1 className="text-3xl font-bold">INVOICE</h1>
                <div>Tax ID : 215-137-108</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6 mb-6">
              <fieldset className="border border-gray-500 px-4 pb-3 pt-1">
                <legend className="px-2 text-sm font-semibold">Bill To:</legend>
                {BILL_TO.map((l, i) => <p key={i} className={i === 0 ? "font-semibold" : "text-sm"}>{l}</p>)}
              </fieldset>
              <div className="text-sm flex flex-col justify-end gap-1">
                <div><span className="inline-block w-28 font-medium">INVOICE #</span>: {invoice.invoiceNo}</div>
                <div><span className="inline-block w-28 font-medium">Issued On</span>: {formatDateDMY(invoice.date)}</div>
                {invoice.billingPeriod && <div><span className="inline-block w-28 font-medium">Period</span>: {invoice.billingPeriod}</div>}
              </div>
            </div>
            <table className="w-full text-sm border border-gray-700 border-collapse">
              <thead><tr><th className={th}>Details</th><th className={`${th} w-44`}>Amount</th></tr></thead>
              <tbody>
                <tr><td className="border border-gray-700 px-3 py-2">Passenger Security - CAI</td><td className="border border-gray-700 px-3 py-2 text-right">{money(paxTotal, ccy)}</td></tr>
                <tr><td className="border border-gray-700 px-3 py-2">Cargo Security</td><td className="border border-gray-700 px-3 py-2 text-right">{money(cargoTotal, ccy)}</td></tr>
                <tr><td className="border border-gray-700 px-3 py-2 font-bold">Total Invoice Amount</td><td className="border border-gray-700 px-3 py-2 text-right font-bold">{money(grand, ccy)}</td></tr>
              </tbody>
            </table>
            <div className="mt-8 pt-4 border-t border-gray-400 text-center text-[11px] text-gray-700">
              P.O.BOX 203,-ZAMALEK, CAIRO, EGYPT · TEL: +202-27351555 · Email: acc.receivables@linkagency.com · www.linkagency.com
            </div>
          </div>
          {/* Pages 2 & 3 */}
          {sections.map(s => (
            <div key={s.title} className="af-page border-2 border-gray-800 p-6 mb-8">
              <div className="flex justify-between mb-4 pb-3 border-b border-gray-400">
                <img src={linkAeroLogo} alt="Link Aero" className="h-14 w-auto object-contain" />
                <img src={ighcLogo} alt="IGHC" className="h-10 w-auto object-contain" />
              </div>
              <h2 className="text-xl font-bold text-center mb-1">{s.title}</h2>
              <p className="text-center font-semibold mb-4">Air France</p>
              <table className="w-full text-xs border border-gray-800 border-collapse">
                <thead><tr className="bg-gray-100">{["#", "DATE", "FLIGHT No.", "REG", "AMOUNT"].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {s.rows.length === 0 && <tr><td colSpan={5} className={td}>No flights</td></tr>}
                  {s.rows.map((r, i) => (
                    <tr key={i}>
                      <td className={td}>{i + 1}</td>
                      <td className={td}>{formatDateDMY(r.arrDate || r.date || "")}</td>
                      <td className={td}>{r.flight || "—"}</td>
                      <td className={td}>{r.reg || "—"}</td>
                      <td className={`${td} text-right`}>{money(Number(r.total) || 0, ccy)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold"><td colSpan={4} className={`${td} text-right`}>Total</td><td className={`${td} text-right`}>{money(s.total, ccy)}</td></tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
