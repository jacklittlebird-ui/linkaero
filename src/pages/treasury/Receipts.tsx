import TreasuryTablePage, { StatusBadge } from "@/components/treasury/TreasuryTablePage";
import { supabase } from "@/integrations/supabase/client";

const CURRENCIES = ["USD","EUR","EGP","SAR","AED","GBP"].map(c => ({ value: c, label: c }));
const METHODS = ["Bank Transfer","Cheque","Cash","Credit Card","Online"].map(m => ({ value: m, label: m }));
const STATUS = [{value:"Posted",label:"Posted"},{value:"Draft",label:"Draft"},{value:"Void",label:"Void"}];

const loadOpenInvoices = async () => {
  const { data } = await supabase
    .from("invoices")
    .select("id,invoice_no,operator,total,currency,status")
    .neq("status", "Paid")
    .neq("status", "Cancelled")
    .order("date", { ascending: false })
    .limit(500);
  return (data || []).map((i: any) => ({
    value: i.id,
    label: `${i.invoice_no} • ${i.operator} • ${i.currency} ${Number(i.total || 0).toLocaleString()}`,
  }));
};

export default function ReceiptsPage() {
  return <TreasuryTablePage
    title="Receipts"
    description="Customer collections & receipts. Receipt numbers are assigned automatically per type (e.g. CSH-0001-2026). Posting a receipt against an invoice automatically marks it Paid."
    table="receipts"
    orderBy="receipt_date"
    searchKeys={["receipt_no","customer_name","reference"]}
    fields={[
      { key: "receipt_date", label: "Date", type: "date" },
      { key: "customer_name", label: "Customer / Payer", type: "text", required: true },
      { key: "invoice_id", label: "Applied to Invoice", type: "select", loadOptions: loadOpenInvoices, allowEmpty: true, span: 2 },
      { key: "amount", label: "Amount", type: "number", default: 0 },
      { key: "currency", label: "Currency", type: "select", options: CURRENCIES, default: "USD" },
      { key: "exchange_rate", label: "FX Rate → Base", type: "number", default: 1 },
      { key: "base_currency", label: "Base Currency", type: "select", options: CURRENCIES, default: "USD" },
      { key: "method", label: "Method", type: "select", options: METHODS, default: "Bank Transfer" },
      { key: "reference", label: "Reference", type: "text" },
      { key: "status", label: "Status", type: "select", options: STATUS, default: "Posted" },
      { key: "notes", label: "Notes", type: "textarea", span: 2 },
    ]}
    columns={[
      { key: "receipt_no", label: "No." },
      { key: "receipt_date", label: "Date" },
      { key: "customer_name", label: "Customer" },
      { key: "method", label: "Method" },
      { key: "amount", label: "Amount", render: (r) => `${r.currency || ""} ${Number(r.amount || 0).toLocaleString()}` },
      { key: "base_amount", label: "Base", render: (r) => r.base_amount ? `${r.base_currency || ""} ${Number(r.base_amount).toLocaleString()}` : "—" },
      { key: "reference", label: "Reference" },
      { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
    ]}
  />;
}
