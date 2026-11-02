# Ethiopian Airlines invoices with an EGP total

## What you'll see
1. When you create a Security invoice for Ethiopian Airlines, a box pops up asking for the **exchange rate** (EGP for 1 USD). You can't create the invoice until you enter a rate above 0.
2. The invoice keeps its contract amounts in USD. Directly under **Total** there is a second line: **Total in EGP**, plus the rate used (for example "Rate: 1 USD = 48.50 EGP").
3. The EGP total shows in all three places: the invoice details window, the on-screen print view, and the downloaded PDF.
4. Other airlines don't change, and you won't be asked for a rate for them.

## Technical details
- Invoices already have `exchange_rate`, `exchange_rate_date`, `base_currency` and `transaction_currency` columns. No database change is needed.
- `src/pages/Invoices.tsx`: in the Security invoice generation flow, detect Ethiopian (same match as elsewhere: name ILIKE 'Ethiopian%' or code 'ET'), open a rate dialog (labelled number field, no placeholder), save `exchange_rate`, `exchange_rate_date` = today, `base_currency` = 'EGP'.
- `SecurityInvoicePrintView.tsx` (cover table, on-screen total, jsPDF cover) and `InvoiceDetailModal.tsx`: if `exchange_rate > 0` and `base_currency = 'EGP'`, add a "Total in EGP" row showing total × rate, formatted to 2 decimals.
- Add a test: the EGP total equals the USD total × rate (for example 136.50 × 48.50 = 6,620.25).

## Question
Should the EGP total show on **existing** Ethiopian invoices? They have no rate saved, so they would need an "Edit rate" action. This plan adds that action in the invoice details window.
