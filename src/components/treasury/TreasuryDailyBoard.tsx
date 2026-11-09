import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { computeDay, isPending, TVoucher } from "@/lib/treasuryBalance";

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const toDMY = (iso: string) => iso.split("-").reverse().join("/");
const fromDMY = (s: string) => { const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

type Row = TVoucher & { id: string; voucher_no: string; description: string; party_name: string | null };

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="border-r-4 border-accent pr-2 text-base font-bold">{children}</h2>
);

export default function TreasuryDailyBoard() {
  const today = new Date().toISOString().slice(0, 10);
  const [dateText, setDateText] = useState(toDMY(today));
  const date = fromDMY(dateText) ?? today;

  const { data: vouchers = [] } = useQuery({
    queryKey: ["treasury_vouchers_board"],
    queryFn: async () => {
      const { data, error } = await supabase.from("treasury_vouchers")
        .select("id,voucher_no,voucher_type,payment_subtype,status,currency,amount,voucher_date,description,party_name,settled_amount")
        .neq("status", "void").limit(10000);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const currencies = useMemo(() => {
    const s = Array.from(new Set(vouchers.map((v) => v.currency)));
    return s.length ? s.sort((a, b) => (a === "EGP" ? -1 : b === "EGP" ? 1 : a.localeCompare(b))) : ["EGP"];
  }, [vouchers]);
  const [cur, setCur] = useState<string | null>(null);
  const currency = cur ?? currencies[0];

  const day = computeDay(vouchers, currency, date);
  const ins = vouchers.filter((v) => v.currency === currency && v.voucher_date === date && v.voucher_type === "receipt" && ["approved", "posted", "settled"].includes(v.status));
  const outs = vouchers.filter((v) => v.currency === currency && v.voucher_date === date && v.voucher_type !== "receipt" && !isPending(v) && ["approved", "posted", "settled"].includes(v.status));
  const pendings = vouchers.filter((v) => v.currency === currency && isPending(v) && v.voucher_date <= date);
  const active = pendings.filter((v) => v.status !== "settled");
  const settled = pendings.filter((v) => v.status === "settled");
  const rows = Math.max(ins.length, outs.length, 1);

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
          <Label htmlFor="tb-date">تاريخ الكشف (DD/MM/YYYY)</Label>
          <Input id="tb-date" value={dateText} maxLength={10} className="w-36" onChange={(e) => setDateText(e.target.value)} />
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
      </div>

      <Heading>معادلة الرصيد لكل عملة ({currency})</Heading>
      <div className="flex flex-wrap items-center gap-2 text-center">
        {pill(`رصيد أول المدة ${fmt(day.opening)}`, "bg-primary/10 text-primary")}<span>+</span>
        {pill(`إجمالي وارد ${fmt(day.receipts)}`, "bg-success/10 text-success")}<span>−</span>
        {pill(`إجمالي منصرف ${fmt(day.payments)}`, "bg-destructive/10 text-destructive")}<span>=</span>
        {pill(`رصيد كاش ${fmt(day.cash)}`, "bg-success/10 text-success")}<span>−</span>
        {pill(`معلقات ${fmt(day.pending)}`, "bg-warning/10 text-warning")}<span>=</span>
        {pill(`الرصيد النهائي ${fmt(day.final)}`, "bg-primary text-primary-foreground")}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
        <Info className="h-4 w-4" /> شيكات تحت التحصيل = رصيد منفصل تماماً — لا يدخل في معادلة الكاش أبداً
      </div>

      <Heading>الكشف اليومي — T-Account (لكل عملة كشف مستقل)</Heading>
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
            <div><div className="text-xs opacity-80">− معلقات</div><div className="font-bold text-warning">{fmt(day.pending)}</div></div>
            <div><div className="text-xs opacity-80">الرصيد الفعلي</div><div className="font-bold">{fmt(day.final)}</div></div>
          </div>
        </CardContent>
      </Card>

      <Heading>تسوية المعلقات</Heading>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <div className="mb-2 text-center font-bold text-warning">المعلقات النشطة ({fmt(day.pending)})</div>
          {active.length === 0 ? <p className="text-center text-sm text-muted-foreground">لا توجد معلقات</p> :
            active.map((v) => (
              <div key={v.id} className="flex items-center justify-between border-t py-2 text-sm">
                <span>{v.voucher_no} — {v.description || v.party_name}</span>
                <span className="flex items-center gap-2">{fmt(Number(v.amount))}
                  <Button asChild size="sm" variant="outline"><Link to="/accounting/treasury-vouchers">تسوية</Link></Button>
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
    </div>
  );
}
