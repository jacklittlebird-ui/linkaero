import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Printer, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { printRtlReport } from "@/lib/printTable";
import { monthBounds } from "@/lib/flightCostReport";
import { useAuth } from "@/contexts/AuthContext";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");

interface Row {
  id: string; voucher_no: string; voucher_date: string; flight_no: string; flight_date: string | null;
  description: string; party_name: string | null; currency: string; amount: number; base_amount: number;
  status: string; airline_id: string | null; service_type: string | null;
}

/** Monthly report for Collections: every treasury cost payment linked to a flight. */
export default function FlightCostReportPage() {
  const { session } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(`${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`);
  const bounds = monthBounds(month);

  const { data: airlines = [] } = useQuery({
    queryKey: ["airlines_min"],
    queryFn: async () => (await supabase.from("airlines").select("id,name").order("name")).data ?? [],
  });

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["flight_cost_report", bounds?.from, bounds?.to],
    enabled: !!session && !!bounds,
    queryFn: async () => {
      if (!bounds) return [];
      const result: Row[] = [];
      for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("treasury_vouchers")
        .select("id,voucher_no,voucher_date,flight_no,flight_date,description,party_name,currency,amount,base_amount,status,airline_id,service_type")
        .eq("payment_subtype", "cost").not("flight_no", "is", null).neq("status", "void")
        .gte("flight_date", bounds.from).lte("flight_date", bounds.to)
        .order("flight_date").order("flight_no").order("id").range(offset, offset + 999);
      if (error) throw error;
      result.push(...(data ?? []) as Row[]);
      if (!data || data.length < 1000) break;
      }
      return result;
    },
  });

  const airlineName = (id: string | null) => airlines.find((a: any) => a.id === id)?.name ?? "";
  const totals = useMemo(() => {
    const byCur: Record<string, number> = {};
    let egp = 0;
    for (const r of rows) { byCur[r.currency] = (byCur[r.currency] ?? 0) + Number(r.amount); egp += Number(r.base_amount || 0); }
    return { byCur, egp };
  }, [rows]);

  const head = ["تاريخ الرحلة", "رقم الرحلة", "شركة الطيران", "الخدمة", "رقم الإذن", "تاريخ الإذن", "البيان / المورد", "العملة", "المبلغ", "المعادل بالجنيه", "الحالة"];
  const body = rows.map((r) => [dmy(r.flight_date), r.flight_no, airlineName(r.airline_id), r.service_type ?? "", r.voucher_no, dmy(r.voucher_date),
    r.description || r.party_name || "", r.currency, fmt(Number(r.amount)), fmt(Number(r.base_amount || 0)), r.status]);
  const summary: [string, string][] = [["عدد الحركات", String(rows.length)], ...Object.entries(totals.byCur).map(([c, v]) => [`إجمالي ${c}`, fmt(v)] as [string, string]), ["الإجمالي بالجنيه", fmt(totals.egp)]];
  const doPrint = () => printRtlReport({ title: "تقرير تكاليف الطائرات المنصرفة من الخزينة", subtitle: `شهر ${month}`, summary, head, body,
    footer: ["", "", "", "", "", "", "الإجمالي", "", "", fmt(totals.egp), ""] });
  const doExcel = () => exportToExcel(rows.map((r, i) => Object.fromEntries(head.map((h, j) => [h, j === 8 ? Number(r.amount) : j === 9 ? Number(r.base_amount || 0) : body[i][j]]))),
    "Flight costs", `flight-costs-${bounds?.from.slice(0, 7)}.xlsx`);

  return (
    <div dir="rtl" className="space-y-4">
      <h1 className="text-2xl font-bold">تقرير تكاليف الطائرات الشهري</h1>
      <p className="text-sm text-muted-foreground">يُجمع تلقائياً من إيصالات صرف التكلفة في الخزينة التي تحمل رقم رحلة وتاريخها.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="fc-month">الشهر (MM/YYYY)</Label>
          <Input id="fc-month" className="w-32" maxLength={7} value={month}
            onChange={(e) => { const d = e.target.value.replace(/\D/g, "").slice(0, 6); setMonth(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d); }} />
        </div>
        <Button variant="outline" size="sm" onClick={doPrint} disabled={!bounds || isLoading || !!error}><Printer className="ms-1 h-4 w-4" />طباعة</Button>
        <Button variant="outline" size="sm" onClick={doPrint} disabled={!bounds || isLoading || !!error}><FileText className="ms-1 h-4 w-4" />تصدير PDF</Button>
        <Button variant="outline" size="sm" onClick={doExcel} disabled={!rows.length}><FileSpreadsheet className="ms-1 h-4 w-4" />تصدير Excel</Button>
      </div>
      {error && <p role="alert" className="text-destructive">تعذر تحميل تقرير تكاليف الرحلات؛ أعد المحاولة.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {summary.map(([k, v]) => <Card key={k}><CardContent className="p-4 text-center"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-bold">{v}</div></CardContent></Card>)}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">الحركات</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr>{head.map((h) => <th key={h} className="p-2 text-right whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {body.map((r, i) => <tr key={rows[i].id} className="border-t">{r.map((c, j) => <td key={j} className="p-2 whitespace-nowrap">{c}</td>)}</tr>)}
              {!rows.length && <tr><td colSpan={head.length} className="p-4 text-center text-muted-foreground">{!bounds ? "أدخل الشهر بصيغة MM/YYYY" : isLoading ? "جاري التحميل…" : "لا توجد تكاليف رحلات لهذا الشهر"}</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
