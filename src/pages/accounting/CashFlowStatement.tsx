import { useState, useMemo } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Waves, Download } from "lucide-react";

type Account = {
  id: string; code: string; name: string; account_type: string;
  opening_balance: number | null;
};
type Line = { account_id: string; debit: number | null; credit: number | null };

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Classify accounts into cash flow sections using account code prefixes / name keywords.
const classify = (a: Account): "cash" | "operating_wc" | "investing" | "financing" | "other" => {
  const name = (a.name || "").toLowerCase();
  const code = a.code || "";
  if (name.includes("cash") || name.includes("bank") || code.startsWith("101") || code.startsWith("11")) return "cash";
  const t = (a.account_type || "").toLowerCase();
  if (t === "asset") {
    if (name.includes("receivable") || name.includes("inventory") || name.includes("prepaid") || name.includes("advance")) return "operating_wc";
    if (name.includes("fixed") || name.includes("equipment") || name.includes("vehicle") || name.includes("property") || name.includes("intangible") || name.includes("investment")) return "investing";
    return "operating_wc";
  }
  if (t === "liability") {
    if (name.includes("payable") || name.includes("accrual") || name.includes("accrued") || name.includes("tax") || name.includes("wages")) return "operating_wc";
    if (name.includes("loan") || name.includes("borrow") || name.includes("note") || name.includes("bond") || name.includes("lease")) return "financing";
    return "operating_wc";
  }
  if (t === "equity") return "financing";
  return "other";
};

export default function CashFlowStatementPage() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const lastDay = today.toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(lastDay);

  const { data: accounts = [] } = useQuery({
    queryKey: ["coa_cf"],
    queryFn: async () => {
      const { data, error } = await supabase.from("chart_of_accounts").select("id,code,name,account_type,opening_balance").order("code");
      if (error) throw error;
      return data as Account[];
    },
  });

  const fetchLines = async (start: string, end: string) => {
    const { data: entries, error: e1 } = await supabase
      .from("journal_entries").select("id")
      .gte("entry_date", start).lte("entry_date", end).eq("status", "Posted");
    if (e1) throw e1;
    const ids = (entries || []).map((e: any) => e.id);
    if (ids.length === 0) return [] as Line[];
    const { data, error } = await supabase.from("journal_entry_lines").select("account_id,debit,credit").in("entry_id", ids);
    if (error) throw error;
    return data as Line[];
  };

  // Movement during the period (for depreciation, NI reconstruction)
  const { data: periodLines = [] } = useQuery({
    queryKey: ["jel_cf_period", from, to],
    queryFn: () => fetchLines(from, to),
  });

  // Movement from start of time up to period start (opening) & up to period end (closing) for WC accounts
  const { data: toStartLines = [] } = useQuery({
    queryKey: ["jel_cf_tostart", from],
    queryFn: () => fetchLines("1900-01-01", new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10)),
  });
  const { data: toEndLines = [] } = useQuery({
    queryKey: ["jel_cf_toend", to],
    queryFn: () => fetchLines("1900-01-01", to),
  });

  const cf = useMemo(() => {
    const bal = (ls: Line[]) => {
      const m = new Map<string, number>();
      for (const l of ls) {
        m.set(l.account_id, (m.get(l.account_id) || 0) + Number(l.debit || 0) - Number(l.credit || 0));
      }
      return m;
    };
    const opening = bal(toStartLines);
    const closing = bal(toEndLines);
    const period = bal(periodLines);

    let netIncome = 0;
    let depreciation = 0;
    let operatingWC = 0;
    let investing = 0;
    let financing = 0;
    let cashOpen = 0;
    let cashClose = 0;

    const wcRows: { name: string; change: number }[] = [];
    const invRows: { name: string; change: number }[] = [];
    const finRows: { name: string; change: number }[] = [];

    for (const a of accounts) {
      const openBal = Number(a.opening_balance || 0) + (opening.get(a.id) || 0);
      const closeBal = Number(a.opening_balance || 0) + (closing.get(a.id) || 0);
      const periodMove = period.get(a.id) || 0;
      const cls = classify(a);
      const t = (a.account_type || "").toLowerCase();

      if (cls === "cash") {
        cashOpen += openBal;
        cashClose += closeBal;
        continue;
      }
      // Net income: revenue (credit) - expense (debit) in period
      if (t === "revenue") netIncome += -periodMove; // credit balance normal
      if (t === "expense") netIncome += -periodMove; // periodMove positive = expense increased -> reduces NI
      // Depreciation: expense accounts with "deprec"/"amort" naming
      if (t === "expense" && /(deprec|amort)/i.test(a.name)) depreciation += periodMove;

      const change = closeBal - openBal;
      if (cls === "operating_wc") {
        // For asset WC: increase in asset = use of cash (-)
        // For liability WC: increase = source of cash (+); asset change already positive means -change on cash
        const cashEffect = t === "asset" ? -change : change;
        if (Math.abs(cashEffect) > 0.01) {
          operatingWC += cashEffect;
          wcRows.push({ name: `${t === "asset" ? "Change in" : "Change in"} ${a.name}`, change: cashEffect });
        }
      } else if (cls === "investing") {
        const cashEffect = t === "asset" ? -change : change;
        if (Math.abs(cashEffect) > 0.01) {
          investing += cashEffect;
          invRows.push({ name: a.name, change: cashEffect });
        }
      } else if (cls === "financing") {
        const cashEffect = t === "asset" ? -change : change;
        if (Math.abs(cashEffect) > 0.01) {
          financing += cashEffect;
          finRows.push({ name: a.name, change: cashEffect });
        }
      }
    }

    const operating = netIncome + depreciation + operatingWC;
    const netChange = operating + investing + financing;

    return { netIncome, depreciation, operatingWC, operating, investing, financing, netChange, cashOpen, cashClose, wcRows, invRows, finRows };
  }, [accounts, periodLines, toStartLines, toEndLines]);

  const exportCsv = () => {
    const rows: string[][] = [
      ["Section", "Item", "Amount"],
      ["Operating", "Net Income", String(cf.netIncome)],
      ["Operating", "Depreciation & Amortization", String(cf.depreciation)],
      ...cf.wcRows.map(r => ["Operating", r.name, String(r.change)]),
      ["Operating Total", "", String(cf.operating)],
      ...cf.invRows.map(r => ["Investing", r.name, String(r.change)]),
      ["Investing Total", "", String(cf.investing)],
      ...cf.finRows.map(r => ["Financing", r.name, String(r.change)]),
      ["Financing Total", "", String(cf.financing)],
      ["Net Change in Cash", "", String(cf.netChange)],
      ["Cash Opening", "", String(cf.cashOpen)],
      ["Cash Closing", "", String(cf.cashClose)],
    ];
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "cash_flow_statement.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const Section = ({ title, rows, total }: { title: string; rows: { name: string; change: number }[]; total: number }) => (
    <div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <Table>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell>{r.name}</TableCell>
              <TableCell className="text-right w-40">{fmt(r.change)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-bold border-t-2">
            <TableCell>Net cash from {title.toLowerCase()}</TableCell>
            <TableCell className="text-right">{fmt(total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Waves className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Statement of Cash Flows</h1>
            <p className="text-muted-foreground">Indirect method (IAS 7)</p>
          </div>
        </div>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
          <div><Label>From</Label><DateInput  value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><DateInput  value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Operating</CardTitle></CardHeader><CardContent className={`text-2xl font-bold ${cf.operating < 0 ? "text-destructive" : "text-primary"}`}>{fmt(cf.operating)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Investing</CardTitle></CardHeader><CardContent className={`text-2xl font-bold ${cf.investing < 0 ? "text-destructive" : ""}`}>{fmt(cf.investing)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Financing</CardTitle></CardHeader><CardContent className={`text-2xl font-bold ${cf.financing < 0 ? "text-destructive" : ""}`}>{fmt(cf.financing)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Net Change in Cash</CardTitle></CardHeader><CardContent className={`text-2xl font-bold ${cf.netChange < 0 ? "text-destructive" : "text-primary"}`}>{fmt(cf.netChange)}</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Cash Flows — {from} to {to}</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="font-semibold mb-2">Operating Activities</h3>
            <Table>
              <TableBody>
                <TableRow><TableCell>Net Income</TableCell><TableCell className="text-right w-40">{fmt(cf.netIncome)}</TableCell></TableRow>
                <TableRow><TableCell>Add: Depreciation & Amortization</TableCell><TableCell className="text-right">{fmt(cf.depreciation)}</TableCell></TableRow>
                {cf.wcRows.map((r, i) => (
                  <TableRow key={i}><TableCell>{r.name}</TableCell><TableCell className="text-right">{fmt(r.change)}</TableCell></TableRow>
                ))}
                <TableRow className="font-bold border-t-2"><TableCell>Net cash from operating activities</TableCell><TableCell className="text-right">{fmt(cf.operating)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
          <Section title="Investing Activities" rows={cf.invRows} total={cf.investing} />
          <Section title="Financing Activities" rows={cf.finRows} total={cf.financing} />

          <div className="border-t-4 pt-3 space-y-2">
            <div className="flex justify-between font-bold"><span>Net change in cash</span><span>{fmt(cf.netChange)}</span></div>
            <div className="flex justify-between"><span>Cash at beginning of period</span><span>{fmt(cf.cashOpen)}</span></div>
            <div className="flex justify-between font-bold"><span>Cash at end of period</span><span>{fmt(cf.cashClose)}</span></div>
            {Math.abs((cf.cashOpen + cf.netChange) - cf.cashClose) > 1 && (
              <div className="text-xs text-destructive">Reconciliation variance: {fmt((cf.cashOpen + cf.netChange) - cf.cashClose)}</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
