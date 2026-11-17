import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Info, Printer, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { printRtlReport } from "@/lib/printTable";
import { computeRange, isPending, isAdvance, isCustody, advanceRemaining, TVoucher } from "@/lib/treasuryBalance";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const toDMY = (iso: string) => iso.split("-").reverse().join("/");
const fromDMY = (s: string) => { const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

type Row = TVoucher & { id: string; voucher_no: string; description: string; party_name: string | null; repayment_plan?: string | null };

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="border-r-4 border-accent pr-2 text-base font-bold">{children}</h2>
);

export default function TreasuryDailyBoard() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [repayTarget, setRepayTarget] = useState<Row | null>(null);
  const [repayAmount, setRepayAmount] = useState(0);
  const recovery = useMutation({
    mutationFn: async () => {
      if (!repayTarget || repayAmount <= 0 || repayAmount > advanceRemaining(repayTarget)) throw new Error("أدخل مبلغ سداد لا يتجاوز المتبقي");
      const { error } = await supabase.rpc("record_advance_recovery", { _voucher_id: repayTarget.id, _amount: repayAmount, _notes: "سداد الموظف للخزينة" });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of ["treasury_vouchers_board", "treasury_vouchers", "v_treasury_balances", "journal_entries"]) qc.invalidateQueries({ queryKey: [key] });
      setRepayTarget(null); toast.success("تم تسجيل السداد وترحيل سند القبض");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const today = new Date().toISOString().slice(0, 10);
  const [fromText, setFromText] = useState(toDMY(today));
  const [toText, setToText] = useState(toDMY(today));
  const to = fromDMY(toText) ?? today;
  const fromRaw = fromDMY(fromText) ?? to;
  const from = fromRaw > to ? to : fromRaw;
  const date = to;
  const mask = (raw: string) => { const d = raw.replace(/\D/g, "").slice(0, 8); return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join("/"); };

  const { data: vouchers = [], isLoading, error } = useQuery({
    queryKey: ["treasury_vouchers_board"],
    enabled: !!session,
    queryFn: async () => {
      const result: Row[] = [];
      for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("treasury_vouchers")
        .select("id,voucher_no,voucher_type,payment_subtype,status,currency,amount,voucher_date,description,party_name,settled_amount,recovered_amount,repayment_plan")
        .neq("status", "void").order("voucher_date").order("id").range(offset, offset + 999);
      if (error) throw error;
      result.push(...(data ?? []) as unknown as Row[]);
      if (!data || data.length < 1000) break;
      }
      return result;
    },
  });

  const currencies = useMemo(() => {
    const s = Array.from(new Set(vouchers.map((v) => v.currency)));
    return s.length ? s.sort((a, b) => (a === "EGP" ? -1 : b === "EGP" ? 1 : a.localeCompare(b))) : ["EGP"];
  }, [vouchers]);
  const [cur, setCur] = useState<string | null>(null);
  const currency = cur ?? currencies[0];

  const day = computeRange(vouchers, currency, from, to);
  const inRange = (v: Row) => v.voucher_date >= from && v.voucher_date <= to;
  const ins = vouchers.filter((v) => v.currency === currency && inRange(v) && v.voucher_type === "receipt" && ["approved", "posted", "settled"].includes(v.status));
  const outs = vouchers.filter((v) => v.currency === currency && inRange(v) && v.voucher_type !== "receipt" && !isPending(v) && ["approved", "posted", "settled"].includes(v.status));
  const pendings = vouchers.filter((v) => v.currency === currency && isCustody(v) && v.voucher_date <= date);
  const advances = vouchers.filter((v) => v.currency === currency && isAdvance(v) && v.voucher_date <= date);
  const active = pendings.filter((v) => v.status !== "settled");
  const settled = pendings.filter((v) => v.status === "settled");
  const rows = Math.max(ins.length, outs.length, 1);

  const statement = [...ins, ...outs].sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_no.localeCompare(b.voucher_no));
  let run = day.opening;
  const stRows = statement.map((v) => {
    const isIn = v.voucher_type === "receipt"; const amt = Number(v.amount);
    run += isIn ? amt : -amt;
    return { date: toDMY(v.voucher_date), no: v.voucher_no, desc: v.description || v.party_name || "", inAmt: isIn ? amt : 0, outAmt: isIn ? 0 : amt, bal: run };
  });
  const period = `من ${toDMY(from)} إلى ${toDMY(to)} — ${currency}`;
  const summary: [string, string][] = [["رصيد أول المدة", fmt(day.opening)], ["إجمالي وارد", fmt(day.receipts)], ["إجمالي منصرف", fmt(day.payments)], ["رصيد كاش", fmt(day.cash)], ["معلقات", fmt(day.pending)], ["السلف", fmt(day.advances)], ["الرصيد النهائي", fmt(day.final)]];
  const head = ["التاريخ", "رقم الإذن", "البيان", "وارد", "منصرف", "الرصيد"];
  const doPrint = () => printRtlReport({ title: "كشف حركة الخزينة", subtitle: period, summary, head,
    body: [["", "", "رصيد أول المدة", "", "", fmt(day.opening)], ...stRows.map((r) => [r.date, r.no, r.desc, r.inAmt ? fmt(r.inAmt) : "", r.outAmt ? fmt(r.outAmt) : "", fmt(r.bal)])],
    footer: ["", "", "الإجمالي", fmt(day.receipts), fmt(day.payments), fmt(day.cash)],
    sections: [
      { title: "الخزينة — T-Account", head: ["الوارد — رقم السند / البيان", "المبلغ", "المنصرف — رقم السند / البيان", "المبلغ"], body: Array.from({ length: rows }, (_, i) => [ins[i] ? `${ins[i].voucher_no} — ${ins[i].description}` : "", ins[i] ? fmt(Number(ins[i].amount)) : "", outs[i] ? `${outs[i].voucher_no} — ${outs[i].description}` : "", outs[i] ? fmt(Number(outs[i].amount)) : ""]), footer: ["إجمالي وارد", fmt(day.receipts), "إجمالي منصرف", fmt(day.payments)] },
      { title: "بيان المعلقات", head: ["التاريخ", "السند", "البيان", "المبلغ", "الحالة", "المسوّى"], body: pendings.map((v) => [toDMY(v.voucher_date), v.voucher_no, v.description || v.party_name || "", fmt(Number(v.amount)), v.status === "settled" ? "مسوّى" : "نشط", fmt(Number(v.settled_amount || 0))]) },
      { title: "بيان سلف الموظفين — HR", head: ["التاريخ", "السند", "الموظف", "السلفة", "المسدد", "المتبقي", "خطة السداد"], body: advances.map((v) => [toDMY(v.voucher_date), v.voucher_no, v.party_name || v.description, fmt(Number(v.amount)), fmt(Number(v.recovered_amount || 0)), fmt(advanceRemaining(v)), v.repayment_plan || "—"]) },
    ] });
  const doExcel = () => exportToExcel([
    { "التاريخ": "", "رقم الإذن": "", "البيان": "رصيد أول المدة", "وارد": "", "منصرف": "", "الرصيد": day.opening },
    ...stRows.map((r) => ({ "التاريخ": r.date, "رقم الإذن": r.no, "البيان": r.desc, "وارد": r.inAmt || "", "منصرف": r.outAmt || "", "الرصيد": r.bal })),
    { "التاريخ": "", "رقم الإذن": "", "البيان": "الإجمالي", "وارد": day.receipts, "منصرف": day.payments, "الرصيد": day.cash },
    { "التاريخ": "", "رقم الإذن": "", "البيان": "معلقات", "وارد": "", "منصرف": "", "الرصيد": day.pending },
    { "التاريخ": "", "رقم الإذن": "", "البيان": "الرصيد النهائي", "وارد": "", "منصرف": "", "الرصيد": day.final },
  ], "Treasury", `treasury-statement-${currency}-${from}_${to}.xlsx`);

  const pill = (label: string, cls: string) => (
    <div className={`rounded-lg px-4 py-3 text-sm font-bold ${cls}`}>{label}</div>
  );

  return (
    <div dir="rtl" className="space-y-6">
      <Heading>أنواع الأذون الثلاثة</Heading>
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { t: "إذن استلام", e: "Receipt Voucher", d: "وارد / دائن", c: "border-success/40 bg-success/10 text-success" },
          { t: "إذن صرف", e: "Payment Voucher", d: "صادر / مدين", c: "border-destructive/40 bg-destructive/10 text-destructive" },
          { t: "إذن معلق", e: "Pending Voucher", d: "سلفة مؤقتة — لم تُسوَّ", c: "border-warning/40 bg-warning/10 text-warning" },
        ].map((x) => (
          <div key={x.t} className={`rounded-lg border p-4 text-center ${x.c}`}>
            <div className="font-bold">{x.t}</div>
            <div className="text-xs opacity-80">{x.e}</div>
            <div className="text-xs opacity-80">{x.d}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label htmlFor="tb-from">من تاريخ (DD/MM/YYYY)</Label>
          <Input id="tb-from" value={fromText} maxLength={10} className="w-36" onChange={(e) => setFromText(mask(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="tb-to">إلى تاريخ (DD/MM/YYYY)</Label>
          <Input id="tb-to" value={toText} maxLength={10} className="w-36" onChange={(e) => setToText(mask(e.target.value))} />
        </div>
        <div>
          <Label>العملة</Label>
          <div className="flex gap-1">
            {currencies.map((c) => (
              <Button key={c} size="sm" variant={c === currency ? "default" : "outline"} onClick={() => setCur(c)}>{c}</Button>
            ))}
          </div>
        </div>
        <Button asChild variant="outline" size="sm"><Link to="/accounting/treasury-vouchers">إصدار إذن جديد</Link></Button>
        <Button variant="outline" size="sm" onClick={doPrint} disabled={isLoading || !!error}><Printer className="ms-1 h-4 w-4" />طباعة</Button>
        <Button variant="outline" size="sm" onClick={doPrint} disabled={isLoading || !!error}><FileText className="ms-1 h-4 w-4" />تصدير PDF</Button>
        <Button variant="outline" size="sm" onClick={doExcel} disabled={isLoading || !!error}><FileSpreadsheet className="ms-1 h-4 w-4" />تصدير Excel</Button>
      </div>
      {error && <p role="alert" className="text-destructive">تعذر تحميل كشف حركة الخزينة؛ أعد المحاولة.</p>}
      <p className="text-xs text-muted-foreground">تصدير PDF يفتح نافذة الطباعة — اختر «حفظ بصيغة PDF».</p>

      <Heading>معادلة الرصيد لكل عملة ({currency})</Heading>
      <div className="flex flex-wrap items-center gap-2 text-center">
        {pill(`رصيد أول المدة ${fmt(day.opening)}`, "bg-primary/10 text-primary")}<span>+</span>
        {pill(`إجمالي وارد ${fmt(day.receipts)}`, "bg-success/10 text-success")}<span>−</span>
        {pill(`إجمالي منصرف ${fmt(day.payments)}`, "bg-destructive/10 text-destructive")}<span>=</span>
        {pill(`رصيد كاش ${fmt(day.cash)}`, "bg-success/10 text-success")}<span>−</span>
        {pill(`معلقات ${fmt(day.pending)}`, "bg-warning/10 text-warning")}<span>−</span>
        {pill(`السلف ${fmt(day.advances)}`, "bg-warning/10 text-warning")}<span>=</span>
        {pill(`الرصيد النهائي ${fmt(day.final)}`, "bg-primary text-primary-foreground")}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
        <Info className="h-4 w-4" /> شيكات تحت التحصيل = رصيد منفصل تماماً — لا يدخل في معادلة الكاش أبداً
      </div>

      <Heading>كشف الحركة {period}</Heading>
      <Card className="overflow-x-auto">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr>{head.map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead>
            <tbody>
              <tr className="border-t font-bold"><td className="p-2" colSpan={5}>رصيد أول المدة</td><td className="p-2">{fmt(day.opening)}</td></tr>
              {stRows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{r.date}</td><td className="p-2">{r.no}</td><td className="p-2">{r.desc}</td>
                  <td className="p-2 text-success">{r.inAmt ? fmt(r.inAmt) : ""}</td>
                  <td className="p-2 text-destructive">{r.outAmt ? fmt(r.outAmt) : ""}</td>
                  <td className="p-2">{fmt(r.bal)}</td>
                </tr>
              ))}
              {stRows.length === 0 && <tr className="border-t"><td colSpan={6} className="p-3 text-center text-muted-foreground">لا توجد حركات في هذه الفترة</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Heading>الكشف — T-Account (لكل عملة كشف مستقل)</Heading>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid grid-cols-2 text-sm font-bold">
            <div className="bg-success/10 p-3 text-success">وارد (دائن) ▲</div>
            <div className="bg-destructive/10 p-3 text-destructive">منصرف (مدين) ▼</div>
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="grid grid-cols-2 border-t text-sm">
              {[ins[i], outs[i]].map((v, j) => (
                <div key={j} className={`flex justify-between p-3 ${j === 0 ? "border-l" : ""}`}>
                  <span>{v ? (v.description || v.party_name || v.voucher_no) : "—"}</span>
                  {v && <span className={j === 0 ? "text-success" : "text-destructive"}>{fmt(Number(v.amount))}</span>}
                </div>
              ))}
            </div>
          ))}
          <div className="grid grid-cols-2 border-t bg-muted/50 text-sm font-bold">
            <div className="flex justify-between border-l p-3"><span>إجمالي الوارد</span><span className="text-success">{fmt(day.receipts)}</span></div>
            <div className="flex justify-between p-3"><span>إجمالي المنصرف</span><span className="text-destructive">{fmt(day.payments)}</span></div>
          </div>
          <div className="grid grid-cols-3 bg-primary p-4 text-center text-primary-foreground">
            <div><div className="text-xs opacity-80">رصيد أول + وارد − منصرف</div><div className="font-bold">{fmt(day.cash)}</div></div>
            <div><div className="text-xs opacity-80">− معلقات / سلف</div><div className="font-bold text-warning">{fmt(day.pending)} / {fmt(day.advances)}</div></div>
            <div><div className="text-xs opacity-80">الرصيد الفعلي</div><div className="font-bold">{fmt(day.final)}</div></div>
          </div>
        </CardContent>
      </Card>

      <Heading>بيان سلف الموظفين ({fmt(day.advances)})</Heading>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted"><tr>{["التاريخ", "السند", "الموظف", "السلفة", "المسدد", "المتبقي", "التسوية"].map((h) => <th className="p-2 text-right" key={h}>{h}</th>)}</tr></thead>
          <tbody>{advances.map((v) => <tr className="border-t" key={v.id}>
            <td className="p-2">{toDMY(v.voucher_date)}</td><td className="p-2">{v.voucher_no}</td><td className="p-2">{v.party_name || v.description}</td>
            <td className="p-2">{fmt(Number(v.amount))}</td><td className="p-2">{fmt(Number(v.recovered_amount || 0))}</td><td className="p-2">{fmt(advanceRemaining(v))}</td>
            <td className="p-2">{["approved", "posted"].includes(v.status) && advanceRemaining(v) > 0 ? <Button size="sm" variant="outline" onClick={() => { setRepayTarget(v); setRepayAmount(advanceRemaining(v)); }}>تسوية</Button> : advanceRemaining(v) === 0 ? "مسوّاة" : "بانتظار الاعتماد"}</td>
          </tr>)}{!advances.length && <tr><td className="p-3 text-center" colSpan={7}>لا توجد سلف</td></tr>}</tbody>
        </table>
      </div>
      <Heading>تسوية المعلقات</Heading>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <div className="mb-2 text-center font-bold text-warning">المعلقات النشطة ({fmt(day.pending)})</div>
          {active.length === 0 ? <p className="text-center text-sm text-muted-foreground">لا توجد معلقات</p> :
            active.map((v) => (
              <div key={v.id} className="flex items-center justify-between border-t py-2 text-sm">
                <span>{v.voucher_no} — {v.description || v.party_name}</span>
                <span className="flex items-center gap-2">{fmt(Number(v.amount))}
                  <Button asChild size="sm" variant="outline"><Link to="/accounting/treasury-vouchers?tab=pending_custody">تسوية</Link></Button>
                </span>
              </div>
            ))}
        </div>
        <div className="rounded-lg border border-success/40 bg-success/10 p-4">
          <div className="mb-2 text-center font-bold text-success">المعلقات المسواة (للإيضاح فقط — لا تُحسب)</div>
          {settled.length === 0 ? <p className="text-center text-sm text-muted-foreground">لا توجد</p> :
            settled.map((v) => (
              <div key={v.id} className="flex justify-between border-t py-2 text-sm text-success">
                <span>{v.voucher_no} — {v.description || v.party_name}</span><span>{fmt(Number(v.amount))}</span>
              </div>
            ))}
        </div>
      </div>
      <div className="rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
        عند التسوية: المبلغ المصروف فعلاً ← إذن صرف ببنوده | المرتجع ← يعود للكاش | المعلق ← يختفي من الرصيد
      </div>
      <Dialog open={!!repayTarget} onOpenChange={(open) => { if (!open) setRepayTarget(null); }}>
        <DialogContent dir="rtl"><DialogHeader><DialogTitle>تسوية سلفة — {repayTarget?.voucher_no}</DialogTitle></DialogHeader>
          <p>{repayTarget?.party_name} — المتبقي: {repayTarget ? fmt(advanceRemaining(repayTarget)) : ""} {repayTarget?.currency}</p>
          <Label htmlFor="advance-repaid">المبلغ الذي سدده الموظف للخزينة</Label>
          <Input id="advance-repaid" type="number" min="0" step="0.01" value={repayAmount} onChange={(e) => setRepayAmount(Number(e.target.value))} />
          <DialogFooter><Button variant="outline" onClick={() => setRepayTarget(null)}>إلغاء</Button><Button disabled={recovery.isPending} onClick={() => recovery.mutate()}>تسجيل السداد</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
