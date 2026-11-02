# Ethiopian Airlines invoices: EGP total in print, PDF and saved record

## What you will get
- After you enter the exchange rate, the **Total in EGP** (with "1 USD = X EGP") appears under the USD total in:
  - the printed invoice (both the Security print view and the general invoice print view),
  - the downloaded PDF (cover page summary and the last page totals).
- The EGP total is **saved on the invoice itself**, so it is stored permanently and shows in the invoices list and details.
- If you later change the rate ("Edit rate"), the saved EGP total is recalculated and saved too.
- Existing Ethiopian invoice **232-2026** (USD 4,608 at 56.11) gets its EGP total saved: EGP 258,554.88.

## Current state (checked)
- The rate is saved, but the invoice's stored EGP total field is empty for 232-2026.
- The Security print view already shows the EGP line; the general invoice print view does not.

## Technical details
- `src/pages/Invoices.tsx` (both Security creation paths ~856, ~1236): also set `base_total = egpTotal(total, rate)`; same in the edit-rate action in `InvoiceDetailModal.tsx`; recalc whenever total changes on regenerate.
- `src/components/InvoicePrintView.tsx`: add EGP total row under Total using `hasEgpTotal`/`egpTotal`/`fmtEgp`.
- `SecurityInvoicePrintView.tsx` PDF: add the EGP row to the final totals block too (cover already has it); prefer stored `base_total`, fall back to computed.
- Invoices list: show the EGP amount under the USD total for EGP invoices.
- One-off data update: `base_total = round(total*exchange_rate,2)` where `base_currency='EGP'` and `exchange_rate>0`.
- Extend `src/lib/invoiceEgp.test.ts`: 4608 × 56.11 = 258,554.88.
