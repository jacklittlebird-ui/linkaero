# Ethiopian invoice: EGP currency label + editable "Issued On"

## 1. Currency shows EGP
- In the Security invoice print view and its PDF, the "Currency:" line in the header shows **EGP** when the invoice is an Ethiopian Airlines invoice with an exchange rate entered.
- Line amounts and the USD total stay as they are; the "Total in EGP" line under the total stays.
- Other airlines keep showing their own currency (USD).

## 2. Edit "Issued On" date
- In the invoice details window, add an **Edit** button beside the Issued On date.
- It opens a date box (DD/MM/YYYY, label above), Save / Cancel.
- Saving updates the invoice date; the print view and PDF then show the new Issued On date.
- Available for all invoices (not only Ethiopian) to users who can already edit invoices.

## Technical details
- `SecurityInvoicePrintView.tsx`: lines ~158 and ~274 (PDF) and the on-screen header use `hasEgpTotal(invoice) ? "EGP" : invoice.currency`.
- `InvoiceDetailModal.tsx`: inline date edit updating `invoices.date`, then refresh local state and the list query.
- No database change.
