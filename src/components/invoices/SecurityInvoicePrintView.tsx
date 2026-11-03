import { useEffect, useMemo, useRef, useState } from "react";
import { egpTotal, fmtEgp, hasEgpTotal, isEthiopianOperator } from "@/lib/invoiceEgp";
import { columnsForOperator } from "@/lib/securityInvoiceDetail";
import { X, Printer, Download, FileText, Sheet } from "lucide-react";
import linkAeroLogo from "@/assets/linkaero-logo.png";
import ighcLogo from "@/assets/ighc-logo.jpg";
import { formatDateDMY } from "@/lib/utils";
import {
  parseSecurityDetail,
  resolveDetailOvertimeHours,
  SECURITY_ANNEX_COLUMNS,
  EXTRA_ANNEX_COLUMNS,
  type SecurityDetailRow,
} from "@/lib/securityInvoiceDetail";

export interface SecurityPrintInvoice {
  invoiceNo: string;
  date: string;
  dueDate: string;
  operator: string;
  airlineIATA: string;
  flightRef: string;
  description: string;
  station: string;
  billingPeriod: string;
  handling: number;
  other: number;
  subtotal: number;
  vat: number;
  total: number;
  currency: string;
  status: string;
  notes: string;
}

type DetailRow = SecurityDetailRow;
const parseDetail = parseSecurityDetail;

const fmtMoney = (n: number, ccy: string) =>
  `${ccy} ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  invoice: SecurityPrintInvoice;
  onClose: () => void;
}

// A4 portrait in mm
const A4_W_MM = 210;
const A4_H_MM = 297;
// 1mm ≈ 3.7795px @ 96dpi
const MM_TO_PX = 3.7795275591;

export default function SecurityInvoicePrintView({ invoice, onClose }: Props) {
  const { detail } = parseDetail(invoice.notes);
  const [margin, setMargin] = useState<number>(8); // mm
  const [pageCount, setPageCount] = useState<number>(2);
  const [isDownloading, setIsDownloading] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);

  // Group detail by station
  const byStation = new Map<string, { security: number; extra: number; rows: DetailRow[] }>();
  if (detail.length > 0) {
    for (const r of detail) {
      const key = (r.station || "—").toUpperCase();
      const g = byStation.get(key) || { security: 0, extra: 0, rows: [] };
      g.security += Number(r.handling) || 0;
      g.extra += Number(r.other) || 0;
      g.rows.push(r);
      byStation.set(key, g);
    }
  } else {
    const key = (invoice.station || "—").toUpperCase();
    byStation.set(key, { security: invoice.handling || 0, extra: invoice.other || 0, rows: [] });
  }

  const stations = Array.from(byStation.entries()).sort(([a], [b]) => a.localeCompare(b));
  const fromDate = detail.length ? detail.map(d => d.date || "").filter(Boolean).sort()[0] : "";
  const toDate = detail.length ? detail.map(d => d.date || "").filter(Boolean).sort().slice(-1)[0] : "";
  const periodFrom = fromDate ? formatDateDMY(fromDate) : "";
  const periodTo = toDate ? formatDateDMY(toDate) : "";

  // Available height per page (A4 portrait minus top+bottom margin).
  const availableDetailsHeightPx = useMemo(() => (A4_H_MM - margin * 2) * MM_TO_PX, [margin]);

  // Rows that comfortably fit on one A4 portrait annex page (header + table + totals).
  const ROWS_PER_PAGE = 32;

  const [annexScales, setAnnexScales] = useState<Record<string, number>>({});
  useEffect(() => {
    const measure = () => {
      const blocks = detailsRef.current?.querySelectorAll<HTMLElement>(".annex-block") ?? [];
      const next: Record<string, number> = {};
      blocks.forEach((el) => {
        el.style.transform = "none";
        const id = el.dataset.annexId || "";
        const naturalH = el.scrollHeight;
        next[id] = naturalH > availableDetailsHeightPx
          ? Math.max(0.6, availableDetailsHeightPx / naturalH)
          : 1;
      });
      setAnnexScales(next);
      const coverH = coverRef.current?.scrollHeight || 0;
      const coverPages = Math.max(1, Math.ceil(coverH / availableDetailsHeightPx));
      setPageCount(coverPages + blocks.length);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (detailsRef.current) ro.observe(detailsRef.current);
    if (coverRef.current) ro.observe(coverRef.current);
    return () => ro.disconnect();
  }, [availableDetailsHeightPx, detail.length, stations.length]);


  const handlePrint = () => window.print();

  // Vector PDF (text + tables) instead of html2canvas images: a few hundred KB
  // and a second or two, versus 200+ full-page bitmaps.
  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const left = margin + 6;
      const right = A4_W_MM - margin - 6;

      // ---- Cover page ----
      // Logo replaces the company/title text block.
      try {
        const res = await fetch(linkAeroLogo);
        const blob = await res.blob();
        const dataUrl: string = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        const props = pdf.getImageProperties(dataUrl);
        const logoW = 45;
        const logoH = (props.height / props.width) * logoW;
        pdf.addImage(dataUrl, "PNG", left, 10, logoW, logoH);
      } catch {
        /* logo optional */
      }

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      const meta: [string, string][] = [
        ["Invoice #", invoice.invoiceNo || "—"],
        ["Issued On", invoice.date ? formatDateDMY(invoice.date) : "—"],
        ["Tax ID", "215-137-108"],
        ["Reg. No", "19511 Kasr El Nile"],
        ["Bill To", invoice.operator || "Air Cairo"],
        ["Period", invoice.billingPeriod || `${periodFrom} – ${periodTo}`],
        ["Currency", invoice.currency || "USD"],
      ];
      meta.forEach(([k, v], i) => {
        pdf.text(`${k}:`, left, 38 + i * 6);
        pdf.text(String(v), left + 28, 38 + i * 6);
      });


      const coverBody: (string | number)[][] = [];
      for (const [st, g] of stations) {
        if (g.security > 0) coverBody.push([st, `${st}-Ramp Security Service`, fmtMoney(g.security, invoice.currency)]);
        if (g.extra > 0) coverBody.push([st, `${st}-Ramp Extra Service`, fmtMoney(g.extra, invoice.currency)]);
      }
      coverBody.push(["", "VAT (Zero%)", fmtMoney(invoice.vat || 0, invoice.currency)]);
      coverBody.push(["", "Total", fmtMoney(invoice.total || 0, invoice.currency)]);
      if (hasEgpTotal(invoice as any)) {
        const rate = Number((invoice as any).exchange_rate);
        coverBody.push(["", `Total in EGP (Rate: 1 USD = ${rate.toFixed(2)} EGP)`, fmtEgp(egpTotal(invoice.total || 0, rate))]);
      }
      autoTable(pdf, {
        startY: 86,
        head: [["Station", "Details", "Amount"]],
        body: coverBody,
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [30, 64, 175], textColor: 255 },
        columnStyles: { 2: { halign: "right" } },
        margin: { left, right: A4_W_MM - right },
      });

      // ---- Annex pages (auto-paginated by autoTable) ----
      const addAnnex = (
        st: string,
        title: string,
        rows: DetailRow[],
        amountKey: "handling" | "other",
        total: number,
      ) => {
        if (!rows.length) return;
        const showSkd = amountKey === "handling";
        const hideEt = isEthiopianOperator(invoice.operator, (invoice as any).airline_iata);
        const cols: readonly string[] = columnsForOperator(showSkd ? SECURITY_ANNEX_COLUMNS : EXTRA_ANNEX_COLUMNS, hideEt);
        const sorted = [...rows].sort((a, b) => {
          const ka = (a.arrDate || a.depDate || a.date || "") + (a.flight || "");
          const kb = (b.arrDate || b.depDate || b.date || "") + (b.flight || "");
          return ka.localeCompare(kb);
        });
        const body = sorted.map((r, i) => {
          const row: (string | number)[] = [
            i + 1,
            r.arrDate ? formatDateDMY(r.arrDate) : (r.date ? formatDateDMY(r.date) : "—"),
            r.depDate ? formatDateDMY(r.depDate) : (r.date ? formatDateDMY(r.date) : "—"),
            r.flight || "—",
            r.reg || "—",
            r.route || "—",
          ];
          if (!hideEt) row.push(r.serviceType || r.type || "—");
          if (showSkd && !hideEt) row.push(r.skdType || "—");
          if (!hideEt) row.push(resolveDetailOvertimeHours(r).toFixed(2));
          row.push((Number(r[amountKey]) || 0).toFixed(2));
          return row;
        });
        const lastIdx = cols.length - 1;
        pdf.addPage("a4", "portrait");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.text(`${title.toUpperCase()} — ${invoice.operator || ""}`, left, 14);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.text(`Station: ${st}    From: ${periodFrom || "—"}    To: ${periodTo || "—"}`, left, 20);
        autoTable(pdf, {
          startY: 24,
          head: [[...cols]],
          body,
          foot: [[...new Array(lastIdx - 1).fill(""), "Grand total", (total || 0).toFixed(2)]],
          styles: { fontSize: 7, cellPadding: 1.4, overflow: "linebreak" },
          headStyles: { fillColor: [30, 64, 175], textColor: 255, fontSize: 7 },
          footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles: { 0: { halign: "center", cellWidth: 10 }, [lastIdx]: { halign: "right" }, [lastIdx - 1]: { halign: "right" } },
          margin: { left, right: A4_W_MM - right, top: 14, bottom: 12 },
        });
      };

      for (const [st, g] of stations) {
        addAnnex(st, "Security Service", g.rows.filter(r => (r.handling || 0) > 0), "handling", g.security);
        addAnnex(st, "Extra Service", g.rows.filter(r => (r.other || 0) > 0), "other", g.extra);
      }

      // Page numbers
      const total = pdf.getNumberOfPages();
      pdf.setFontSize(7);
      for (let p = 1; p <= total; p++) {
        pdf.setPage(p);
        pdf.text(`Page ${p} of ${total}`, right, A4_H_MM - 6, { align: "right" });
      }

      pdf.save(`${invoice.invoiceNo || "security-invoice"}.pdf`);
    } finally {
      setIsDownloading(false);
    }
  };


  // Excel export mirroring the printed layout: a cover sheet plus one sheet
  // per station annex, using the exact same columns/values as the PDF.
  const handleExportExcel = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    const cover: (string | number)[][] = [
      ["LINK AVIATION SERVICES — SECURITY INVOICE"],
      [],
      ["Invoice #", invoice.invoiceNo],
      ["Issued On", formatDateDMY(invoice.date)],
      ["Bill To", invoice.operator],
      ["Period", invoice.billingPeriod || `${periodFrom} – ${periodTo}`],
      ["Currency", invoice.currency],
      [],
      ["Station", "Details", "Amount"],
    ];
    for (const [st, g] of stations) {
      if (g.security > 0) cover.push([st, `${st}-Ramp Security Service`, Number(g.security.toFixed(2))]);
      if (g.extra > 0) cover.push([st, `${st}-Ramp Extra Service`, Number(g.extra.toFixed(2))]);
    }
    cover.push([]);
    cover.push(["", "VAT (Zero%)", Number((invoice.vat || 0).toFixed(2))]);
    cover.push(["", "Total", Number((invoice.total || 0).toFixed(2))]);
    const wsCover = XLSX.utils.aoa_to_sheet(cover);
    wsCover["!cols"] = [{ wch: 12 }, { wch: 44 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsCover, "Invoice");

    const usedNames = new Set<string>();
    const addAnnexSheet = (st: string, title: string, rows: DetailRow[], amountKey: "handling" | "other", total: number) => {
      if (!rows.length) return;
      const showSkd = amountKey === "handling";
      const hideEt = isEthiopianOperator(invoice.operator, (invoice as any).airline_iata);
        const cols: readonly string[] = columnsForOperator(showSkd ? SECURITY_ANNEX_COLUMNS : EXTRA_ANNEX_COLUMNS, hideEt);
      const sorted = [...rows].sort((a, b) => {
        const ka = (a.arrDate || a.depDate || a.date || "") + (a.flight || "");
        const kb = (b.arrDate || b.depDate || b.date || "") + (b.flight || "");
        return ka.localeCompare(kb);
      });
      const aoa: (string | number)[][] = [
        [`${title.toUpperCase()} — ${invoice.operator}`],
        [`Station: ${st}`, `From: ${periodFrom || "—"}`, `To: ${periodTo || "—"}`],
        [],
        [...cols],
      ];
      sorted.forEach((r, i) => {
        const row: (string | number)[] = [
          i + 1,
          r.arrDate ? formatDateDMY(r.arrDate) : (r.date ? formatDateDMY(r.date) : ""),
          r.depDate ? formatDateDMY(r.depDate) : (r.date ? formatDateDMY(r.date) : ""),
          r.flight || "",
          r.reg || "",
          r.route || "",
        ];
        if (!hideEt) row.push(r.serviceType || r.type || "");
        if (showSkd && !hideEt) row.push(r.skdType || "");
        if (!hideEt) row.push(Number(resolveDetailOvertimeHours(r).toFixed(2)));
        row.push(Number((Number(r[amountKey]) || 0).toFixed(2)));
        aoa.push(row);
      });
      const pad = new Array(cols.length - 2).fill("");
      aoa.push([]);
      aoa.push([...pad, "Grand total", Number((total || 0).toFixed(2))]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = cols.map((c) =>
        c === "Service Type" ? { wch: 26 }
          : c === "Route" ? { wch: 14 }
          : c === "Amount" ? { wch: 14 }
          : c === "S" ? { wch: 5 }
          : { wch: 12 },
      );
      let name = `${st} ${showSkd ? "Security" : "Extra"}`.slice(0, 28);
      let n = 2;
      while (usedNames.has(name)) name = `${name.slice(0, 26)} ${n++}`;
      usedNames.add(name);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    for (const [st, g] of stations) {
      addAnnexSheet(st, "Security Service", g.rows.filter(r => (r.handling || 0) > 0), "handling", g.security);
      addAnnexSheet(st, "Extra Service", g.rows.filter(r => (r.other || 0) > 0), "other", g.extra);
    }

    XLSX.writeFile(wb, `${invoice.invoiceNo || "security-invoice"}.xlsx`);
  };



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-y-auto m-4 print:m-0 print:shadow-none print:rounded-none print:max-h-none print:overflow-visible">
        {/* Toolbar — no print */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b print:hidden">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold text-gray-700">Security Invoice Preview</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
              <FileText size={12} /> {pageCount} page{pageCount === 1 ? "" : "s"} · A4 Portrait
            </span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              Margin (mm)
              <input
                type="number"
                min={3}
                max={25}
                step={1}
                value={margin}
                onChange={(e) => setMargin(Math.max(3, Math.min(25, Number(e.target.value) || 8)))}
                className="w-16 px-2 py-1 border border-gray-300 rounded text-xs"
              />
            </label>
            <button
              onClick={handleExportExcel}
              className="toolbar-btn-primary inline-flex items-center gap-1.5"
            >
              <Sheet size={14} /> Export Excel
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="toolbar-btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Download size={14} /> {isDownloading ? "Generating…" : "Download PDF"}
            </button>
            <button onClick={handlePrint} className="toolbar-btn-primary inline-flex items-center gap-1.5">
              <Printer size={14} /> Print / Save PDF
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full text-gray-500"><X size={18} /></button>
          </div>
        </div>

        {/* Print styles — configurable margin, forced portrait, 2-page layout */}
        <style>{`
          @media print {
            @page { size: A4 portrait; margin: ${margin}mm; }
            html, body { width: ${A4_W_MM - margin * 2}mm; }
            .no-print { display: none !important; }
            #invoice-cover-page {
              page-break-after: always !important;
              break-after: page !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            #invoice-details-page {
              page-break-before: always !important;
              break-before: page !important;
            }
            #invoice-details-page .annex-block {
              page-break-before: always !important;
              break-before: page !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              margin-top: 0 !important;
              transform-origin: top left;
            }
            ${Object.entries(annexScales).map(([id, s]) => `
              #invoice-details-page .annex-block[data-annex-id="${id}"] {
                transform: scale(${s});
                width: ${100 / s}%;
              }
            `).join("\n")}
            #invoice-details-page table { font-size: 9px !important; }
            #invoice-details-page .annex-block .border-2 { padding: 12px !important; }
            #invoice-print-area { padding: 0 !important; }
          }
        `}</style>

        {/* Printable A4 sheet */}
        <div className="p-10 text-gray-900 font-serif" id="invoice-print-area" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
          {/* COVER PAGE */}
          <div id="invoice-cover-page" ref={coverRef}>
            <div className="border-2 border-gray-800 p-6">
              <div className="flex items-start justify-between mb-6">
                <div className="border border-gray-400 p-2 inline-block">
                  <img src={linkAeroLogo} alt="Link Aero" className="h-24 w-auto object-contain" />
                </div>
                <div className="text-right">
                  <img src={ighcLogo} alt="IGHC" className="h-14 w-auto object-contain ml-auto mb-2" />
                  <h1 className="text-3xl font-bold tracking-wide text-gray-900">INVOICE</h1>
                  <div className="text-sm mt-2 leading-relaxed">
                    <div><span className="inline-block w-20 text-left">Tax ID</span> : 215-137-108</div>
                    <div><span className="inline-block w-20 text-left">Reg., No.,</span> : 19511 - Kasr El Nile</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-6">
                <fieldset className="border border-gray-500 px-4 pb-3 pt-1 rounded-sm">
                  <legend className="px-2 text-sm font-semibold">Bill To:</legend>
                  <p className="text-base font-semibold mt-1">{invoice.operator}</p>
                  {invoice.description && <p className="text-xs text-gray-600 leading-snug whitespace-pre-line">{invoice.description}</p>}
                </fieldset>
                <div className="text-sm flex flex-col justify-end gap-1 pl-4">
                  <div className="flex"><span className="w-28 font-medium">INVOICE #</span>: <span className="ml-2 font-semibold">{invoice.invoiceNo}</span></div>
                  <div className="flex"><span className="w-28 font-medium">Issued On</span>: <span className="ml-2">{formatDateDMY(invoice.date)}</span></div>
                  {invoice.billingPeriod && (
                    <div className="flex"><span className="w-28 font-medium">Period</span>: <span className="ml-2">{invoice.billingPeriod}</span></div>
                  )}
                </div>
              </div>

              <table className="w-full text-sm border border-gray-700 border-collapse">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th colSpan={2} className="border-r border-gray-700 py-2 font-bold text-center">Details</th>
                    <th className="py-2 font-bold text-center w-40">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {stations.flatMap(([st, g], idx) => {
                    const rows = [];
                    if (g.security > 0) {
                      rows.push(
                        <tr key={`${st}-sec`} className="border-b border-gray-300">
                          <td className="px-3 py-1.5 w-32 text-xs">{idx === 0 && periodFrom ? periodFrom : ""}</td>
                          <td className="px-3 py-1.5 border-r border-gray-300">{st}-Ramp Security Service</td>
                          <td className="px-3 py-1.5 text-right">{fmtMoney(g.security, invoice.currency)}</td>
                        </tr>
                      );
                    }
                    if (g.extra > 0) {
                      rows.push(
                        <tr key={`${st}-ext`} className="border-b border-gray-300">
                          <td className="px-3 py-1.5 text-xs">{idx === 0 && periodTo ? periodTo : ""}</td>
                          <td className="px-3 py-1.5 border-r border-gray-300">{st}-Ramp Extra Service</td>
                          <td className="px-3 py-1.5 text-right">{fmtMoney(g.extra, invoice.currency)}</td>
                        </tr>
                      );
                    }
                    return rows;
                  })}
                  <tr className="border-t border-gray-700">
                    <td colSpan={2} className="px-3 py-2 font-bold border-r border-gray-700">
                      All services rendered on ramp outside the customs area
                    </td>
                    <td className="px-3 py-2 text-right text-sm">VAT-Zero%&nbsp;&nbsp;{(invoice.vat || 0).toFixed(2)}</td>
                  </tr>
                  <tr className="border-t border-gray-700">
                    <td colSpan={2} className="px-3 py-2 border-r border-gray-700"></td>
                    <td className="px-3 py-2 text-right font-bold text-base">
                      Total&nbsp;&nbsp;{fmtMoney(invoice.total, invoice.currency)}
                    </td>
                  </tr>
                  {hasEgpTotal(invoice as any) && (
                    <tr className="border-t border-gray-700">
                      <td colSpan={2} className="px-3 py-2 border-r border-gray-700 text-xs">
                        Rate: 1 USD = {Number((invoice as any).exchange_rate).toFixed(2)} EGP
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-base">
                        Total in EGP&nbsp;&nbsp;{fmtEgp(egpTotal(invoice.total, (invoice as any).exchange_rate))}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="mt-8 pt-4 border-t border-gray-400 text-center text-[11px] text-gray-700">
                P.O.BOX 203,-ZAMALEK, CAIRO, EGYPT&nbsp;&nbsp;
                <strong>TEL</strong>: +202-27351555&nbsp;&nbsp;
                <strong>FAX</strong>: +202-27359309&nbsp;&nbsp;
                <strong>Email</strong>: acc.receivables@linkagency.com&nbsp;&nbsp;
                <strong>Website</strong>: www.linkagency.com
              </div>
            </div>
          </div>

          {/* DETAILS PAGE */}
          <div
            id="invoice-details-page"
            ref={detailsRef}
            className="break-before-page print:break-before-page mt-10 print:mt-0"
          >
            {stations.map(([st, g]) => {
              const secRows = g.rows.filter(r => (r.handling || 0) > 0);
              const extRows = g.rows.filter(r => (r.other || 0) > 0);

              const renderAnnex = (
                title: string,
                rows: DetailRow[],
                amountKey: "handling" | "other",
                total: number,
                key: string,
              ) => {
                const showSkd = amountKey === "handling";
                const hideEt = isEthiopianOperator(invoice.operator, (invoice as any).airline_iata);
        const columns: readonly string[] = columnsForOperator(showSkd ? SECURITY_ANNEX_COLUMNS : EXTRA_ANNEX_COLUMNS, hideEt);
                const sorted = [...rows].sort((a, b) => {
                  const ka = (a.arrDate || a.depDate || a.date || "") + (a.flight || "");
                  const kb = (b.arrDate || b.depDate || b.date || "") + (b.flight || "");
                  return ka.localeCompare(kb);
                });
                const chunks: DetailRow[][] = [];
                for (let i = 0; i < sorted.length; i += ROWS_PER_PAGE) {
                  chunks.push(sorted.slice(i, i + ROWS_PER_PAGE));
                }
                if (chunks.length === 0) chunks.push([]);

                return chunks.map((chunk, pageIdx) => {
                  const isLast = pageIdx === chunks.length - 1;
                  const offset = pageIdx * ROWS_PER_PAGE;
                  return (
                    <div key={`${key}-p${pageIdx}`} data-annex-id={`${key}-p${pageIdx}`} className="annex-block mt-10 print:mt-0">
                      <div className="border-2 border-gray-800 p-6">
                        <div className="flex items-start justify-between mb-4 pb-3 border-b border-gray-400">
                          <div className="border border-gray-400 p-1.5">
                            <img src={linkAeroLogo} alt="Link Aero" className="h-16 w-auto object-contain" />
                          </div>
                          <div className="text-right">
                            <img src={ighcLogo} alt="IGHC" className="h-10 w-auto object-contain ml-auto mb-1" />
                            <p className="text-xs text-gray-600">Tax ID : 215-137-108</p>
                          </div>
                        </div>

                        <div className="text-center mb-4">
                          <h2 className="text-xl font-bold tracking-wide uppercase">{title}</h2>
                          <p className="text-base font-semibold mt-1">{invoice.operator}</p>
                          {chunks.length > 1 && (
                            <p className="text-xs text-gray-600 mt-1">Page {pageIdx + 1} of {chunks.length}</p>
                          )}
                        </div>

                        <div className="grid grid-cols-3 text-sm mb-4 border border-gray-500 rounded-sm overflow-hidden">
                          <div className="px-3 py-1.5 border-r border-gray-500">
                            <span className="font-semibold">Station :</span> {st}
                          </div>
                          <div className="px-3 py-1.5 border-r border-gray-500">
                            <span className="font-semibold">From :</span> {periodFrom || "—"}
                          </div>
                          <div className="px-3 py-1.5">
                            <span className="font-semibold">To :</span> {periodTo || "—"}
                          </div>
                        </div>

                        <table className="w-full text-[10px] border border-gray-800 border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              {columns.map(h => (
                                <th key={h} className="border border-gray-800 px-1.5 py-1 text-center font-bold">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {chunk.map((r, i) => (
                              <tr key={i}>
                                <td className="border border-gray-800 px-1.5 py-1 text-center">{offset + i + 1}</td>
                                <td className="border border-gray-800 px-1.5 py-1 text-center whitespace-nowrap">{r.arrDate ? formatDateDMY(r.arrDate) : (r.date ? formatDateDMY(r.date) : "—")}</td>
                                <td className="border border-gray-800 px-1.5 py-1 text-center whitespace-nowrap">{r.depDate ? formatDateDMY(r.depDate) : (r.date ? formatDateDMY(r.date) : "—")}</td>
                                <td className="border border-gray-800 px-1.5 py-1 text-center">{r.flight || "—"}</td>
                                <td className="border border-gray-800 px-1.5 py-1 text-center">{r.reg || "—"}</td>
                                <td className="border border-gray-800 px-1.5 py-1 text-center">{r.route || "—"}</td>
                                {!hideEt && <td className="border border-gray-800 px-1.5 py-1 text-left">{r.serviceType || r.type || "—"}</td>}
                                {showSkd && !hideEt && (
                                  <td className="border border-gray-800 px-1.5 py-1 text-center">{r.skdType || "—"}</td>
                                )}
                                {!hideEt && <td className="border border-gray-800 px-1.5 py-1 text-center">{resolveDetailOvertimeHours(r).toFixed(2)}</td>}
                                <td className="border border-gray-800 px-1.5 py-1 text-right whitespace-nowrap">{fmtMoney(Number(r[amountKey]) || 0, invoice.currency)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            {isLast ? (
                              <>
                                <tr>
                                  <td colSpan={columns.length - 1} className="border border-gray-800 px-1.5 py-1 text-right font-semibold">Total</td>
                                  <td className="border border-gray-800 px-1.5 py-1 text-right">{fmtMoney(total, invoice.currency)}</td>
                                </tr>
                                <tr>
                                  <td colSpan={columns.length - 1} className="border border-gray-800 px-1.5 py-1 text-right">Admin</td>
                                  <td className="border border-gray-800 px-1.5 py-1 text-right">{fmtMoney(0, invoice.currency)}</td>
                                </tr>
                                <tr className="font-bold">
                                  <td colSpan={columns.length - 1} className="border border-gray-800 px-1.5 py-1.5 text-right">Grand total</td>
                                  <td className="border border-gray-800 px-1.5 py-1.5 text-right">{fmtMoney(total, invoice.currency)}</td>
                                </tr>
                              </>
                            ) : (
                              <tr>
                                <td colSpan={columns.length - 1} className="border border-gray-800 px-1.5 py-1 text-right font-semibold">Subtotal (carried forward)</td>
                                <td className="border border-gray-800 px-1.5 py-1 text-right">
                                  {fmtMoney(
                                    sorted.slice(0, offset + chunk.length).reduce((s, r) => s + (Number(r[amountKey]) || 0), 0),
                                    invoice.currency,
                                  )}
                                </td>
                              </tr>
                            )}
                          </tfoot>
                        </table>

                        <div className="mt-6 pt-3 border-t border-gray-400 text-center text-[10px] text-gray-700">
                          P.O.BOX 203,-ZAMALEK, CAIRO, EGYPT&nbsp;&nbsp;
                          <strong>TEL</strong>: +202-27351555&nbsp;&nbsp;
                          <strong>Email</strong>: acc.receivables@linkagency.com&nbsp;&nbsp;
                          <strong>Website</strong>: www.linkagency.com
                        </div>
                      </div>
                    </div>
                  );
                });
              };

              return (
                <div key={`annex-${st}`}>
                  {secRows.length > 0 && renderAnnex("Security Service", secRows, "handling", g.security, `${st}-sec`)}
                  {extRows.length > 0 && renderAnnex("Extra Service", extRows, "other", g.extra, `${st}-ext`)}
                </div>
              );
            })}

          </div>
        </div>
      </div>
    </div>
  );
}
