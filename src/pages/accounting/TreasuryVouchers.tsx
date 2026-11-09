// Treasury Vouchers — aligned with "Treasury Spec AR v4"
// -------------------------------------------------------------
// Two umbrellas:
//   • Receipt voucher (one type)
//   • Payment vouchers (4 independent subtypes):
//       general | pending_custody | advance | cost
//
// Rules enforced here and in the database triggers:
//   • Custody vouchers create NO journal entry while outstanding — the
//     accounting entry is only created at settlement (settle_pending_custody).
//   • "Company custody" vs "Current-account custody" is a classification /
//     reporting split only — identical accounting treatment.
//   • Advance vouchers require finance-manager e-approval before printing
//     or posting, and carry a repayment plan (full or 2/3/4/6 months).
//   • Cost vouchers require the 4 cost centres and trigger the "account 8"
//     rule (flight link mandatory).
//   • Balance: opening + receipts − payments = cash balance
//              − outstanding custody − outstanding advances = final available.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Receipt, ArrowDownCircle, ArrowUpCircle, Clock, Plus, Download,
  CheckCircle2, Send, Ban, FileCheck2, Printer, Wallet, HandCoins, RefreshCw,
} from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format } from "date-fns";

type VoucherType = "receipt" | "payment" | "pending";
type PaymentSubtype = "general" | "pending_custody" | "advance" | "cost";
type VoucherStatus =
  | "draft" | "pending_approval" | "approved" | "posted" | "settled" | "void";
type TabKey = "receipt" | "general" | "pending_custody" | "advance" | "cost" | "balances" | "fx";

const STATUS_VARIANT: Record<VoucherStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  pending_approval: "secondary",
  approved: "default",
  posted: "default",
  settled: "default",
  void: "destructive",
};

const STATUS_LABEL: Record<VoucherStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  posted: "Posted",
  settled: "Settled",
  void: "Void",
};

const SUBTYPE_LABEL: Record<PaymentSubtype, string> = {
  general: "General Payment",
  pending_custody: "Pending Custody",
  advance: "Advance",
  cost: "Cost Voucher",
};

const SUBTYPE_LABEL_AR: Record<PaymentSubtype, string> = {
  general: "إيصال صرف عام",
  pending_custody: "إيصال صرف معلق",
  advance: "إيصال صرف سلف",
  cost: "إيصال صرف تكلفة",
};


// Spec §2.1 — supported treasury currencies (EGP is the base/reporting currency)
const CURRENCIES = ["EGP", "USD", "EUR", "GBP", "CHF", "MAD", "JOD", "AED", "SAR"] as const;
const PARTY_TYPES = ["Customer", "Supplier", "Employee", "Other"] as const;
const REPAYMENT_PLANS: { value: string; label: string }[] = [
  { value: "full", label: "Full deduction at month end" },
  { value: "2", label: "2 monthly instalments" },
  { value: "3", label: "3 monthly instalments" },
  { value: "4", label: "4 monthly instalments" },
  { value: "6", label: "6 monthly instalments" },
];

interface Voucher {
  id: string;
  voucher_no: string;
  voucher_type: VoucherType;
  payment_subtype: PaymentSubtype | null;
  pending_kind: "company" | "current" | null;
  expense_item: string | null;
  voucher_date: string;
  status: VoucherStatus;
  description: string;
  reference: string | null;
  currency: string;
  amount: number;
  exchange_rate: number;
  base_amount: number;
  base_currency: string | null;
  party_type: string | null;
  party_name: string | null;
  bank_account_id: string | null;
  cash_account_id: string | null;
  company_id: string | null;
  station_id: string | null;
  airline_id: string | null;
  supplier_id: string | null;
  service_type: string | null;
  flight_schedule_id: string | null;
  account_id: string | null;
  settled_amount: number | null;
  returned_amount: number;
  recovered_amount: number;
  repayment_plan: string | null;
  finance_approved_by: string | null;
  print_unlocked: boolean;
  notes: string | null;
  posted_at: string | null;
  settled_at: string | null;
  requires_approval: boolean;
  created_at: string;
}

interface Named { id: string; name: string; }
interface AccountRow { id: string; account_name: string; currency: string; }
interface GlAccount { id: string; code: string; name: string; name_ar: string | null; }

const emptyForm = (subtype: PaymentSubtype | null) => ({
  voucher_no: "",
  payment_subtype: subtype,
  voucher_date: format(new Date(), "yyyy-MM-dd"),
  description: "",
  reference: "",
  expense_item: "",
  currency: "EGP",
  amount: 0,
  exchange_rate: 0,
  party_type: "",
  party_name: "",
  pending_kind: "company",
  repayment_plan: "full",
  bank_account_id: "",
  cash_account_id: "",
  company_id: "",
  station_id: "",
  airline_id: "",
  supplier_id: "",
  service_type: "",
  account_id: "",
  flight_schedule_id: "",
  notes: "",
});

const num = (n: unknown) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Searchable chart-of-accounts picker (search by code or by Arabic/English name).
function AccountPicker({
  accounts, value, onChange, side,
}: {
  accounts: GlAccount[];
  value: string;
  onChange: (id: string) => void;
  side: "debit" | "credit";
}) {
  const [q, setQ] = useState("");
  const selected = accounts.find((a) => a.id === value);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? accounts.filter(
          (a) =>
            a.code.toLowerCase().includes(term) ||
            (a.name ?? "").toLowerCase().includes(term) ||
            (a.name_ar ?? "").toLowerCase().includes(term),
        )
      : accounts;
    return list.slice(0, 200);
  }, [accounts, q]);

  return (
    <div className="col-span-2">
      <Label>
        {side === "debit"
          ? "Debit account — البند المدين (الخزينة دائنة)"
          : "Credit account — البند الدائن (الخزينة مدينة)"}
      </Label>
      <Input
        className="mb-2"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search account by code or name"
      />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select account from the chart of accounts" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {selected && !results.some((a) => a.id === selected.id) && (
            <SelectItem value={selected.id}>
              {selected.code} — {selected.name_ar || selected.name}
            </SelectItem>
          )}
          {results.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.code} — {a.name_ar || a.name}
            </SelectItem>
          ))}
          {results.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matching account</div>
          )}
        </SelectContent>
      </Select>
      <p className="mt-1 text-xs text-muted-foreground">
        {side === "debit"
          ? "Payment voucher: treasury is credited, the selected account is debited."
          : "Receipt voucher: treasury is debited, the selected account is credited."}
      </p>
    </div>
  );
}

export default function TreasuryVouchersPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("receipt");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm(null));
  const [statusFilter, setStatusFilter] = useState<"all" | VoucherStatus>("all");
  const [revalDate, setRevalDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [settleTarget, setSettleTarget] = useState<Voucher | null>(null);
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settleNotes, setSettleNotes] = useState("");
  const [recoverTarget, setRecoverTarget] = useState<Voucher | null>(null);
  const [recoverAmount, setRecoverAmount] = useState<number>(0);

  const { data: vouchers = [] } = useQuery({
    queryKey: ["treasury_vouchers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treasury_vouchers")
        .select("*, je:journal_entries!treasury_vouchers_journal_entry_id_fkey(entry_no)")
        .order("voucher_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Voucher[];
    },
  });

  const { data: balances = [] } = useQuery({
    queryKey: ["v_treasury_balances"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("v_treasury_balances").select("*");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Spec §2.4 — daily FX revaluation log (each row is backed by a real GL journal entry)
  const { data: fxLog = [] } = useQuery({
    queryKey: ["treasury_fx_daily_log"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("treasury_fx_daily_log")
        .select("*")
        .order("reval_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const revalMutation = useMutation({
    mutationFn: async (revalDate: string) => {
      const { data, error } = await (supabase.rpc as any)("run_treasury_daily_revaluation", { p_date: revalDate });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as { rows_logged: number; total_difference: number } | null;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["treasury_fx_daily_log"] });
      qc.invalidateQueries({ queryKey: ["v_treasury_balances"] });
      if (!res || !res.rows_logged) toast.info("No FX differences to record for this date");
      else toast.success(`${res.rows_logged} FX difference row(s) posted to the general ledger`);
    },
    onError: (e: any) => toast.error(e.message || "Revaluation failed"),
  });



  const { data: companies = [] } = useQuery({
    queryKey: ["companies_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as Named[];
    },
  });

  const { data: stations = [] } = useQuery({
    queryKey: ["finance_stations_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_stations").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as Named[];
    },
  });

  const { data: airlines = [] } = useQuery({
    queryKey: ["airlines_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("airlines").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as Named[];
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["service_providers_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_providers").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as Named[];
    },
  });

  const { data: glAccounts = [] } = useQuery({
    queryKey: ["coa_min_treasury"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id,code,name,name_ar")
        .eq("is_group", false)
        .order("code")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as GlAccount[];
    },
  });

  const { data: banks = [] } = useQuery({
    queryKey: ["bank_accounts_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_accounts").select("id,account_name,currency").order("account_name");
      if (error) throw error;
      return (data ?? []) as AccountRow[];
    },
  });

  const { data: cash = [] } = useQuery({
    queryKey: ["cash_accounts_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_accounts").select("id,account_name,currency").order("account_name");
      if (error) throw error;
      return (data ?? []) as AccountRow[];
    },
  });

  const matchesTab = (v: Voucher, tab: TabKey) =>
    tab === "receipt" ? v.voucher_type === "receipt" : v.payment_subtype === tab;

  const filtered = useMemo(
    () => vouchers.filter((v) => matchesTab(v, activeTab) && (statusFilter === "all" || v.status === statusFilter)),
    [vouchers, activeTab, statusFilter],
  );

  const kpis = useMemo(() => {
    const list = vouchers.filter((v) => matchesTab(v, activeTab));
    const amount = list
      .filter((v) => ["approved", "posted", "settled"].includes(v.status))
      .reduce((s, v) => s + Number(v.base_amount || 0), 0);
    const outstandingCustody = vouchers
      .filter((v) => v.payment_subtype === "pending_custody" && !["settled", "void"].includes(v.status))
      .reduce((s, v) => s + Number(v.base_amount || 0), 0);
    const outstandingAdvances = vouchers
      .filter((v) => v.payment_subtype === "advance" && v.status !== "void")
      .reduce((s, v) => s + Math.max(Number(v.amount || 0) - Number(v.recovered_amount || 0), 0) * Number(v.exchange_rate || 1), 0);
    return {
      total: list.length,
      amount,
      pending: list.filter((v) => ["draft", "pending_approval"].includes(v.status)).length,
      outstandingCustody,
      outstandingAdvances,
    };
  }, [vouchers, activeTab]);

  const create = useMutation({
    mutationFn: async () => {
      if (!form.voucher_no.trim()) throw new Error("Voucher number is required");
      if (!form.amount || form.amount <= 0) throw new Error("Amount must be greater than zero");
      if (!form.account_id)
        throw new Error(
          form.payment_subtype === null
            ? "Select the credit account from the chart of accounts"
            : "Select the debit account from the chart of accounts",
        );

      const isReceipt = form.payment_subtype === null;
      const payload: Record<string, unknown> = {
        voucher_no: form.voucher_no.trim(),
        voucher_type: isReceipt ? "receipt" : form.payment_subtype === "pending_custody" ? "pending" : "payment",
        payment_subtype: form.payment_subtype,
        pending_kind: form.payment_subtype === "pending_custody" ? form.pending_kind : null,
        repayment_plan: form.payment_subtype === "advance" ? form.repayment_plan : null,
        expense_item: form.expense_item || null,
        voucher_date: form.voucher_date,
        description: form.description || "",
        reference: form.reference || null,
        currency: form.currency,
        amount: Number(form.amount),
        // 0 lets the DB trigger resolve the CBE rate of the voucher date
        exchange_rate: Number(form.exchange_rate) || 0,
        base_amount: 0,
        party_type: form.party_type || null,
        party_name: form.party_name || null,
        bank_account_id: form.bank_account_id || null,
        cash_account_id: form.cash_account_id || null,
        company_id: form.company_id || null,
        station_id: form.station_id || null,
        airline_id: form.airline_id || null,
        supplier_id: form.supplier_id || null,
        service_type: form.service_type || null,
        account_id: form.account_id || null,
        flight_schedule_id: form.flight_schedule_id || null,
        notes: form.notes || null,
        status: "draft",
        created_by: user?.id ?? null,
      };
      const { error } = await (supabase.from as any)("treasury_vouchers").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treasury_vouchers"] });
      qc.invalidateQueries({ queryKey: ["v_treasury_balances"] });
      setDialogOpen(false);
      toast.success("Voucher created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transition = useMutation({
    mutationFn: async ({ id, to }: { id: string; to: VoucherStatus }) => {
      const patch: Record<string, unknown> = { status: to };
      if (to === "posted") { patch.posted_at = new Date().toISOString(); patch.posted_by = user?.id ?? null; }
      const { error } = await (supabase.from as any)("treasury_vouchers").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["treasury_vouchers"] });
      qc.invalidateQueries({ queryKey: ["v_treasury_balances"] });
      toast.success(`Voucher ${STATUS_LABEL[v.to].toLowerCase()}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveAdvance = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("approve_treasury_advance", { _voucher_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treasury_vouchers"] });
      toast.success("Advance approved by finance — printing unlocked");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const settle = useMutation({
    mutationFn: async () => {
      if (!settleTarget) return;
      const { error } = await (supabase.rpc as any)("settle_pending_custody", {
        _voucher_id: settleTarget.id,
        _actual_amount: Number(settleAmount),
        _notes: settleNotes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treasury_vouchers"] });
      qc.invalidateQueries({ queryKey: ["v_treasury_balances"] });
      setSettleTarget(null);
      setSettleNotes("");
      toast.success("Custody settled — difference returned to the treasury");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recover = useMutation({
    mutationFn: async () => {
      if (!recoverTarget) return;
      const { error } = await (supabase.rpc as any)("record_advance_recovery", {
        _voucher_id: recoverTarget.id,
        _amount: Number(recoverAmount),
        _notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treasury_vouchers"] });
      qc.invalidateQueries({ queryKey: ["v_treasury_balances"] });
      setRecoverTarget(null);
      toast.success("Advance instalment recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nextActions = (v: Voucher): { label: string; to: VoucherStatus; icon: React.ReactNode }[] => {
    switch (v.status) {
      case "draft":
        return [
          { label: "Submit", to: "pending_approval", icon: <Send className="h-3 w-3" /> },
          { label: "Void", to: "void", icon: <Ban className="h-3 w-3" /> },
        ];
      case "pending_approval":
        return v.payment_subtype === "advance"
          ? [{ label: "Void", to: "void", icon: <Ban className="h-3 w-3" /> }]
          : [
              { label: "Approve", to: "approved", icon: <CheckCircle2 className="h-3 w-3" /> },
              { label: "Void", to: "void", icon: <Ban className="h-3 w-3" /> },
            ];
      case "approved":
        // custody vouchers are never posted — they are settled instead
        return v.payment_subtype === "pending_custody"
          ? []
          : [{ label: "Post", to: "posted", icon: <FileCheck2 className="h-3 w-3" /> }];
      default:
        return [];
    }
  };

  const printVoucher = (v: Voucher) => {
    if (!v.print_unlocked) {
      toast.error("Printing is locked until the finance manager approves this advance");
      return;
    }
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const kind = v.voucher_type === "receipt" ? "Receipt Voucher / سند قبض"
      : `${SUBTYPE_LABEL[(v.payment_subtype ?? "general") as PaymentSubtype]} / سند صرف`;
    w.document.write(`
      <html dir="ltr"><head><title>${v.voucher_no}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;padding:32px;color:#111}
        h1{font-size:20px;margin:0 0 4px} .sub{color:#555;margin-bottom:20px}
        table{width:100%;border-collapse:collapse;margin-bottom:24px}
        td,th{border:1px solid #bbb;padding:8px;font-size:13px;text-align:left}
        th{background:#f3f4f6;width:34%}
        .sign{display:flex;gap:16px;margin-top:48px}
        .box{flex:1;border-top:1px solid #333;padding-top:8px;text-align:center;font-size:12px}
      </style></head><body>
      <h1>Link Aviation Services</h1>
      <div class="sub">${kind} — ${v.voucher_no}</div>
      <table>
        <tr><th>Journal No / رقم القيد</th><td>${(v as any).je?.entry_no ?? "—"}</td></tr>
        <tr><th>Date / التاريخ</th><td>${format(new Date(v.voucher_date), "dd/MM/yyyy")}</td></tr>
        <tr><th>Party / الطرف</th><td>${v.party_name ?? "—"}</td></tr>
        <tr><th>Amount / المبلغ</th><td>${num(v.amount)} ${v.currency}</td></tr>
        <tr><th>Rate / سعر التحويل</th><td>${v.exchange_rate}</td></tr>
        <tr><th>EGP equivalent / المقابل بالجنيه</th><td>${num(v.base_amount)} EGP</td></tr>
        <tr><th>Description / البيان</th><td>${v.description ?? ""}</td></tr>
        <tr><th>Status / الحالة</th><td>${STATUS_LABEL[v.status]}</td></tr>
      </table>
      <div class="sign">
        <div class="box">Treasurer<br/>أمين الخزينة</div>
        <div class="box">Recipient<br/>المستلم</div>
        <div class="box">Reviewer<br/>المراجع</div>
        <div class="box">Approving Authority<br/>السلطة المعتمدة</div>
      </div>
      <script>window.onload=()=>window.print()</script>
      </body></html>`);
    w.document.close();
  };

  const openCreate = (tab: TabKey) => {
    const subtype: PaymentSubtype | null =
      tab === "receipt" || tab === "balances" || tab === "fx" ? null : (tab as PaymentSubtype);
    setActiveTab(tab === "balances" || tab === "fx" ? "receipt" : tab);
    setForm(emptyForm(subtype));
    setDialogOpen(true);
  };


  const exportRows = () => {
    exportToExcel(
      filtered.map((v) => ({
        "Voucher No": v.voucher_no,
        "Type": v.voucher_type === "receipt" ? "Receipt" : SUBTYPE_LABEL[(v.payment_subtype ?? "general") as PaymentSubtype],
        "Custody Kind": v.pending_kind === "company" ? "Company" : v.pending_kind === "current" ? "Current Account" : "",
        "Date": format(new Date(v.voucher_date), "dd/MM/yyyy"),
        "Status": STATUS_LABEL[v.status],
        "Party": v.party_name || "",
        "Reference": v.reference || "",
        "Currency": v.currency,
        "Amount": Number(v.amount),
        "Rate": Number(v.exchange_rate),
        "EGP Equivalent": Number(v.base_amount),
        "Settled Amount": v.settled_amount ?? "",
        "Returned": Number(v.returned_amount || 0),
        "Recovered": Number(v.recovered_amount || 0),
        "Repayment Plan": v.repayment_plan || "",
        "Description": v.description,
      })),
      `Vouchers-${activeTab}`,
      `treasury-vouchers-${activeTab}-${format(new Date(), "yyyyMMdd")}.xlsx`,
    );
  };

  const isCustody = form.payment_subtype === "pending_custody";
  const isAdvance = form.payment_subtype === "advance";
  const isCost = form.payment_subtype === "cost";
  const isGeneral = form.payment_subtype === "general";

  const TAB_META: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "receipt", label: "Receipts", icon: <ArrowDownCircle className="h-4 w-4" /> },
    { key: "general", label: "General Payments", icon: <ArrowUpCircle className="h-4 w-4" /> },
    { key: "pending_custody", label: "Pending Custody", icon: <Clock className="h-4 w-4" /> },
    { key: "advance", label: "Advances", icon: <HandCoins className="h-4 w-4" /> },
    { key: "cost", label: "Cost Vouchers", icon: <FileCheck2 className="h-4 w-4" /> },
    { key: "balances", label: "Balances", icon: <Wallet className="h-4 w-4" /> },
    { key: "fx", label: "FX Revaluation", icon: <RefreshCw className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Receipt className="h-6 w-6" /> Treasury Vouchers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Receipt voucher and the four payment voucher types — general, pending custody, advance and cost.
          </p>
        </div>
        {activeTab !== "balances" && activeTab !== "fx" && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={exportRows}>
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
            <Button variant="secondary" onClick={() => openCreate("receipt")}>
              <ArrowDownCircle className="h-4 w-4 mr-2" /> New Receipt / سند قبض
            </Button>
            {(["general", "cost", "pending_custody", "advance"] as PaymentSubtype[]).map((s) => (
              <Button key={s} onClick={() => openCreate(s)}>
                <Plus className="h-4 w-4 mr-2" /> {SUBTYPE_LABEL[s]} / {SUBTYPE_LABEL_AR[s]}
              </Button>
            ))}
          </div>
        )}

      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Vouchers in tab</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.total}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Approved+ (EGP)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{num(kpis.amount)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Pending action</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.pending}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Outstanding custody (EGP)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{num(kpis.outstandingCustody)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Outstanding advances (EGP)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-rose-600">{num(kpis.outstandingAdvances)}</div></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList className="flex-wrap h-auto">
            {TAB_META.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-2">{t.icon} {t.label}</TabsTrigger>
            ))}
          </TabsList>
          {activeTab !== "balances" && activeTab !== "fx" && (
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {(Object.keys(STATUS_LABEL) as VoucherStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {TAB_META.filter((t) => t.key !== "balances").map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <Card>
              <CardContent className="pt-6 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Voucher No</TableHead>
                      <TableHead>Journal No / رقم القيد</TableHead>
                      <TableHead>Date</TableHead>
                      {t.key === "pending_custody" && <TableHead>Custody Kind</TableHead>}
                      <TableHead>Party</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">EGP Equivalent</TableHead>
                      {t.key === "advance" && <TableHead className="text-right">Remaining</TableHead>}
                      {t.key === "pending_custody" && <TableHead className="text-right">Settled / Returned</TableHead>}
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                          No vouchers yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="font-medium">{v.voucher_no}</TableCell>
                          <TableCell className="font-mono text-xs">{(v as any).je?.entry_no ?? "—"}</TableCell>
                          <TableCell>{format(new Date(v.voucher_date), "dd/MM/yyyy")}</TableCell>
                          {t.key === "pending_custody" && (
                            <TableCell>
                              <Badge variant="outline">
                                {v.pending_kind === "current" ? "Current Account" : "Company"}
                              </Badge>
                            </TableCell>
                          )}
                          <TableCell>{v.party_name || "—"}</TableCell>
                          <TableCell className="max-w-xs truncate" title={v.description}>{v.description}</TableCell>
                          <TableCell className="text-right">{num(v.amount)}</TableCell>
                          <TableCell>{v.currency}</TableCell>
                          <TableCell className="text-right">{num(v.base_amount)}</TableCell>
                          {t.key === "advance" && (
                            <TableCell className="text-right">
                              {num(Math.max(Number(v.amount) - Number(v.recovered_amount || 0), 0))}
                            </TableCell>
                          )}
                          {t.key === "pending_custody" && (
                            <TableCell className="text-right">
                              {v.settled_amount != null ? `${num(v.settled_amount)} / ${num(v.returned_amount)}` : "—"}
                            </TableCell>
                          )}
                          <TableCell><Badge variant={STATUS_VARIANT[v.status]}>{STATUS_LABEL[v.status]}</Badge></TableCell>
                          <TableCell className="text-right space-x-1 whitespace-nowrap">
                            {v.payment_subtype === "advance" && !v.finance_approved_by && v.status !== "void" && (
                              <Button size="sm" variant="default"
                                onClick={() => approveAdvance.mutate(v.id)} disabled={approveAdvance.isPending}>
                                <CheckCircle2 className="h-3 w-3" /><span className="ml-1">Finance Approve</span>
                              </Button>
                            )}
                            {v.payment_subtype === "pending_custody" && v.status !== "settled" && v.status !== "void" && (
                              <Button size="sm" variant="secondary"
                                onClick={() => { setSettleTarget(v); setSettleAmount(Number(v.amount)); }}>
                                <CheckCircle2 className="h-3 w-3" /><span className="ml-1">Settle</span>
                              </Button>
                            )}
                            {v.payment_subtype === "advance" && v.status !== "void" &&
                              Number(v.recovered_amount || 0) < Number(v.amount) && (
                              <Button size="sm" variant="secondary"
                                onClick={() => { setRecoverTarget(v); setRecoverAmount(0); }}>
                                <HandCoins className="h-3 w-3" /><span className="ml-1">Recover</span>
                              </Button>
                            )}
                            {nextActions(v).map((a) => (
                              <Button key={a.to} size="sm"
                                variant={a.to === "void" ? "destructive" : "outline"}
                                onClick={() => transition.mutate({ id: v.id, to: a.to })}
                                disabled={transition.isPending}>
                                {a.icon}<span className="ml-1">{a.label}</span>
                              </Button>
                            ))}
                            <Button size="sm" variant="ghost" onClick={() => printVoucher(v)}
                              title={v.print_unlocked ? "Print voucher" : "Locked until finance approval"}>
                              <Printer className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        <TabsContent value="balances" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Treasury balances per currency — original currency and EGP equivalent
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Receipts − Payments = Cash balance · less outstanding custody · less outstanding advances = Final available cash
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Receipts</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead className="text-right">Cash Balance</TableHead>
                    <TableHead className="text-right">Outstanding Custody</TableHead>
                    <TableHead className="text-right">Outstanding Advances</TableHead>
                    <TableHead className="text-right">Final Available</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Final Available (EGP)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No balances yet.
                    </TableCell></TableRow>
                  ) : balances.map((b, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{b.currency}</TableCell>
                      <TableCell className="text-right">{num(b.receipts)}</TableCell>
                      <TableCell className="text-right">{num(b.payments)}</TableCell>
                      <TableCell className="text-right font-semibold">{num(b.cash_balance)}</TableCell>
                      <TableCell className="text-right text-amber-600">{num(b.custody_outstanding)}</TableCell>
                      <TableCell className="text-right text-rose-600">{num(b.advances_outstanding)}</TableCell>
                      <TableCell className="text-right font-bold">{num(b.final_available_cash)}</TableCell>
                      <TableCell className="text-right">{b.rate_today ?? "—"}</TableCell>
                      <TableCell className="text-right font-bold">{num(b.final_available_cash_egp)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Spec §2.4 — daily FX revaluation: EGP equivalent only, real GL entry per run */}
        <TabsContent value="fx" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-base">Daily FX revaluation (CBE rate of the same day)</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    EGP value (today) − EGP value (yesterday) for the same foreign-currency balance.
                    The foreign-currency balance never changes; each difference posts a real journal entry
                    to FX Revaluation Gain / Loss.
                  </p>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <Label className="text-xs">Revaluation date</Label>
                    <Input type="date" value={revalDate} onChange={(e) => setRevalDate(e.target.value)} className="w-44" />
                  </div>
                  <Button onClick={() => revalMutation.mutate(revalDate)} disabled={revalMutation.isPending}>
                    <RefreshCw className="h-4 w-4 mr-2" /> Run revaluation
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">FX Balance</TableHead>
                    <TableHead className="text-right">Rate (prev)</TableHead>
                    <TableHead className="text-right">Rate (today)</TableHead>
                    <TableHead className="text-right">EGP (prev)</TableHead>
                    <TableHead className="text-right">EGP (today)</TableHead>
                    <TableHead className="text-right">FX Difference (EGP)</TableHead>
                    <TableHead>GL Entry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fxLog.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No revaluation recorded yet.
                    </TableCell></TableRow>
                  ) : fxLog.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>{f.reval_date}</TableCell>
                      <TableCell className="font-medium">{f.currency}</TableCell>
                      <TableCell className="text-right">{num(f.fx_balance)}</TableCell>
                      <TableCell className="text-right">{f.rate_prev ?? "—"}</TableCell>
                      <TableCell className="text-right">{f.rate_today ?? "—"}</TableCell>
                      <TableCell className="text-right">{num(f.base_value_prev)}</TableCell>
                      <TableCell className="text-right">{num(f.base_value_today)}</TableCell>
                      <TableCell className={`text-right font-bold ${Number(f.fx_difference) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {num(f.fx_difference)}
                      </TableCell>
                      <TableCell>
                        {f.journal_entry_id
                          ? <Badge variant="default">Posted</Badge>
                          : <Badge variant="outline">—</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>


      {/* Create voucher */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              New {form.payment_subtype ? SUBTYPE_LABEL[form.payment_subtype] : "Receipt"} Voucher
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            {form.payment_subtype && (
              <div className="col-span-2">
                <Label>Payment voucher type</Label>
                <Select value={form.payment_subtype}
                  onValueChange={(v) => setForm({ ...form, payment_subtype: v as PaymentSubtype })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SUBTYPE_LABEL) as PaymentSubtype[]).map((s) => (
                      <SelectItem key={s} value={s}>{SUBTYPE_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Voucher Number</Label>
              <Input value={form.voucher_no} onChange={(e) => setForm({ ...form, voucher_no: e.target.value })} />
            </div>
            <div>
              <Label>Voucher Date</Label>
              <Input type="date" value={form.voucher_date} onChange={(e) => setForm({ ...form, voucher_date: e.target.value })} />
            </div>
            <div>
              <Label>Company</Label>
              <Select value={form.company_id} onValueChange={(v) => setForm({ ...form, company_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Station / Branch</Label>
              <Select value={form.station_id} onValueChange={(v) => setForm({ ...form, station_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
                <SelectContent>
                  {stations.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {isGeneral && (
              <div className="col-span-2">
                <Label>Expense item</Label>
                <Input value={form.expense_item} onChange={(e) => setForm({ ...form, expense_item: e.target.value })} />
              </div>
            )}

            {isCustody && (
              <div>
                <Label>Custody kind</Label>
                <Select value={form.pending_kind} onValueChange={(v) => setForm({ ...form, pending_kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company">Company custody</SelectItem>
                    <SelectItem value="current">Current-account custody</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {isAdvance && (
              <div>
                <Label>Repayment plan</Label>
                <Select value={form.repayment_plan} onValueChange={(v) => setForm({ ...form, repayment_plan: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REPAYMENT_PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isCost && (
              <>
                <div>
                  <Label>Cost centre 1 — Customer / Airline</Label>
                  <Select value={form.airline_id} onValueChange={(v) => setForm({ ...form, airline_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select airline" /></SelectTrigger>
                    <SelectContent>
                      {airlines.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cost centre 3 — Service type</Label>
                  <Select value={form.service_type} onValueChange={(v) => setForm({ ...form, service_type: v })}>
                    <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Security">Security</SelectItem>
                      <SelectItem value="Handling">Handling</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cost centre 4 — Supplier</Label>
                  <Select value={form.supplier_id} onValueChange={(v) => setForm({ ...form, supplier_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 text-xs text-muted-foreground">
                  Cost centre 2 (station) is set above; the GL account is selected below.
                </div>
                <div className="col-span-2">
                  <Label>Flight schedule ID (required for accounts starting with 8)</Label>
                  <Input value={form.flight_schedule_id}
                    onChange={(e) => setForm({ ...form, flight_schedule_id: e.target.value })} />
                </div>
              </>
            )}

            <AccountPicker
              accounts={glAccounts}
              value={form.account_id}
              onChange={(v) => setForm({ ...form, account_id: v })}
              side={form.payment_subtype === null ? "credit" : "debit"}
            />

            <div>
              <Label>Party Type</Label>
              <Select value={form.party_type} onValueChange={(v) => setForm({ ...form, party_type: v })}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {PARTY_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{isCustody || isAdvance ? "Beneficiary" : "Party Name"}</Label>
              <Input value={form.party_name} onChange={(e) => setForm({ ...form, party_name: e.target.value })} />
            </div>
            <div>
              <Label>Bank Account</Label>
              <Select value={form.bank_account_id}
                onValueChange={(v) => setForm({ ...form, bank_account_id: v, cash_account_id: "" })}>
                <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                <SelectContent>
                  {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.account_name} ({b.currency})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Treasury / Cash box</Label>
              <Select value={form.cash_account_id}
                onValueChange={(v) => setForm({ ...form, cash_account_id: v, bank_account_id: "" })}>
                <SelectTrigger><SelectValue placeholder="Select cash box" /></SelectTrigger>
                <SelectContent>
                  {cash.map((c) => <SelectItem key={c.id} value={c.id}>{c.account_name} ({c.currency})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="col-span-2">
              <Label>Exchange rate (leave 0 to use the daily CBE rate of the voucher date)</Label>
              <Input type="number" min="0" step="0.0001" value={form.exchange_rate}
                onChange={(e) => setForm({ ...form, exchange_rate: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Saving..." : "Create Voucher"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settle custody */}
      <Dialog open={!!settleTarget} onOpenChange={(o) => !o && setSettleTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Settle custody {settleTarget?.voucher_no}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Custody amount: {num(settleTarget?.amount)} {settleTarget?.currency}. The difference between the
              custody amount and the actual amount spent is returned to the treasury automatically, and the
              accounting entry is created only now.
            </p>
            <div>
              <Label>Actual amount spent</Label>
              <Input type="number" min="0" step="0.01" value={settleAmount}
                onChange={(e) => setSettleAmount(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Settlement notes</Label>
              <Textarea rows={3} value={settleNotes} onChange={(e) => setSettleNotes(e.target.value)} />
            </div>
            <div className="text-sm">
              Returned to treasury:{" "}
              <span className="font-semibold">
                {num(Math.max(Number(settleTarget?.amount || 0) - Number(settleAmount || 0), 0))} {settleTarget?.currency}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleTarget(null)}>Cancel</Button>
            <Button onClick={() => settle.mutate()} disabled={settle.isPending}>
              {settle.isPending ? "Settling..." : "Settle custody"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record advance recovery */}
      <Dialog open={!!recoverTarget} onOpenChange={(o) => !o && setRecoverTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record advance recovery {recoverTarget?.voucher_no}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Remaining balance:{" "}
              {num(Math.max(Number(recoverTarget?.amount || 0) - Number(recoverTarget?.recovered_amount || 0), 0))}{" "}
              {recoverTarget?.currency} · Plan: {recoverTarget?.repayment_plan ?? "—"}
            </p>
            <div>
              <Label>Instalment amount</Label>
              <Input type="number" min="0" step="0.01" value={recoverAmount}
                onChange={(e) => setRecoverAmount(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecoverTarget(null)}>Cancel</Button>
            <Button onClick={() => recover.mutate()} disabled={recover.isPending}>
              {recover.isPending ? "Saving..." : "Record recovery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
