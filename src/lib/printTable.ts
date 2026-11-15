import linkAeroLogo from "@/assets/linkaero-logo.png";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Opens an Arabic (RTL) printable report; the browser print dialog also saves it as PDF. */
export function printRtlReport(opts: { title: string; subtitle?: string; summary?: [string, string][]; head: string[]; body: (string | number)[][]; footer?: (string | number)[] }) {
  const w = window.open("", "_blank", "width=1000,height=900");
  if (!w) return;
  const summary = (opts.summary ?? []).map(([k, v]) => `<div class="s"><div>${esc(k)}</div><b>${esc(v)}</b></div>`).join("");
  w.document.write(`<html dir="rtl"><head><title>${esc(opts.title)}</title><style>
    body{font-family:Arial,Tahoma,sans-serif;padding:24px;color:#1f2937}
    .head{display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #1e3a5f;padding-bottom:10px;margin-bottom:14px}
    .head img{height:56px} h1{margin:0;font-size:18px;color:#1e3a5f}
    .sum{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.s{flex:1;border:1px solid #cbd5e1;border-radius:6px;padding:8px;text-align:center;font-size:12px}
    table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #e5e7eb;padding:6px;text-align:right}
    th{background:#1e3a5f;color:#fff}tfoot td{font-weight:bold;background:#f1f5f9}
    @media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="head"><div><h1>${esc(opts.title)}</h1><div>${esc(opts.subtitle ?? "")}</div></div><img src="${window.location.origin}${linkAeroLogo}" /></div>
  <div class="sum">${summary}</div>
  <table><thead><tr>${opts.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${opts.body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
  ${opts.footer ? `<tfoot><tr>${opts.footer.map((c) => `<td>${esc(c)}</td>`).join("")}</tr></tfoot>` : ""}</table>
  <script>const i=document.querySelector('img');const p=()=>setTimeout(()=>window.print(),200);i&&!i.complete?i.onload=i.onerror=p:p();</script>
  </body></html>`);
  w.document.close();
}
