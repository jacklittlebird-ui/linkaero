# Remove Service Type, SKD and OT (h) from Ethiopian Airlines invoices

## What changes
For Ethiopian Airlines invoices only, the per-flight table will no longer show the **Service Type**, **SKD** and **OT (h)** columns in:
- the invoice details window,
- the print view,
- the downloaded PDF (and the Excel export of the same table).

Other airlines keep all columns. Amounts and totals (USD and EGP) are unchanged.

## Technical details
- `src/lib/securityInvoiceDetail.ts`: add `ETHIOPIAN_HIDDEN_COLUMNS = ["Service Type","SKD","OT (h)"]` and a helper `columnsForOperator(cols, operator)` that filters them out when `isEthiopianOperator` (from `invoiceEgp.ts`) is true.
- `SecurityInvoicePrintView.tsx`: apply the helper at the three places columns are chosen (on-screen table ~543, jsPDF ~196, Excel ~291); cell rendering already maps by column name, so values drop with their headers.
- `InvoiceDetailModal.tsx`: apply the helper to `SECURITY_INVOICE_COLUMNS` and skip the matching cells.
- Add a small test: Ethiopian column list excludes the three columns; Air Cairo keeps them.
