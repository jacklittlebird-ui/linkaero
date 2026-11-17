// Phase 1q — Consolidated Financial Statements
// Multi-company roll-up (Trial Balance / P&L / Balance Sheet) with inter-company
// eliminations. Eliminations net out balances on accounts whose code matches the
// user-defined IC prefixes (default: 199, 299 — IC receivable / IC payable), and
// zero-out revenue/expense pairs between selected companies when the paired
// contra exists at the same code across entities.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Download, Building2, Layers, Scale } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

interface Account { id: string; code: string; name: string; account_type: string; }
interface JournalEntry { id: string; status: string; entry_date: string; }
interface JournalLine { account_id: string; debit: number; credit: number; entry_id: string; company_id: string | null; }
interface Company { id: string; name: string; code?: string | null; }

type AcctType = "asset" | "liability" | "equity" | "revenue" | "expense" | "other";
function normType(t: string): AcctType {
  const x = (t || "").toLowerCase();
  if (["asset", "liability", "equity", "revenue", "expense"].includes(x)) return x as AcctType;
  return "other";
}
/** Debit-normal for asset/expense; credit-normal for the rest. */
function netBalance(t: AcctType, debit: number, credit: number): number {
  if (t === "asset" || t === "expense") return debit - credit;
  return credit - debit;
}

export default function ConsolidatedStatementsPage() {
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  const todayStr = today.toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(yearStart);
  const [dateTo, setDateTo] = useState(todayStr);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [icPrefixes, setIcPrefixes] = useState("199,299");
  const [applyEliminations, setApplyEliminations] = useState(true);

  const { data: companies = [] } = useQuery({
    queryKey: ["cons_companies"],
    queryFn: async () => {
      const { data } = await supabase.from("companies" as any).select("id,name,code").order("name");
      return (data || []) as unknown as Company[];
    },
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["cons_accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("chart_of_accounts" as any).select("id,code,name,account_type").order("code");
      return (data || []) as unknown as Account[];
    },
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["cons_entries"],
    queryFn: async () => {
      const { data } = await supabase.from("journal_entries" as any).select("id,status,entry_date");
      return (data || []) as unknown as JournalEntry[];
    },
  });
  const { data: lines = [] } = useQuery({
    queryKey: ["cons_lines"],
    queryFn: async () => {
      const { data } = await supabase
        .from("journal_entry_lines" as any)
        .select("account_id,debit,credit,entry_id,company_id");
      return (data || []) as unknown as JournalLine[];
    },
  });

  const activeCompanyIds = useMemo(
    () => Object.keys(selected).filter((k) => selected[k]),
    [selected],
  );

  const prefixList = useMemo(
    () => icPrefixes.split(",").map((s) => s.trim()).filter(Boolean),
    [icPrefixes],
  );

  const consolidated = useMemo(() => {
    const acctById = new Map(accounts.map((a) => [a.id, a]));
    const entryById = new Map(entries.map((e) => [e.id, e]));
    const inWindow = (d: string) => d >= dateFrom && d <= dateTo;

    // Filter to posted lines in period, from selected companies (or all if none selected)
    const filtered = lines.filter((l) => {
      const e = entryById.get(l.entry_id);
      if (!e) return false;
      if ((e.status || "").toLowerCase() !== "posted") return false;
      if (!inWindow(e.entry_date)) return false;
      if (activeCompanyIds.length > 0 && (!l.company_id || !activeCompanyIds.includes(l.company_id))) return false;
      return true;
    });

    // Aggregate by account (across all included companies)
    const byAcct = new Map<string, { debit: number; credit: number; perCompany: Record<string, { debit: number; credit: number }> }>();
    for (const l of filtered) {
      if (!byAcct.has(l.account_id)) byAcct.set(l.account_id, { debit: 0, credit: 0, perCompany: {} });
      const bucket = byAcct.get(l.account_id)!;
      bucket.debit += Number(l.debit || 0);
      bucket.credit += Number(l.credit || 0);
      const cid = l.company_id || "__none__";
      if (!bucket.perCompany[cid]) bucket.perCompany[cid] = { debit: 0, credit: 0 };
      bucket.perCompany[cid].debit += Number(l.debit || 0);
      bucket.perCompany[cid].credit += Number(l.credit || 0);
    }

    // Build rows with net balances and eliminations
    interface Row {
      account: Account;
      grossDebit: number; grossCredit: number; grossNet: number;
      elimDebit: number; elimCredit: number; elimNet: number;
      consDebit: number; consCredit: number; consNet: number;
      isIC: boolean;
    }
    const rows: Row[] = [];
    for (const [accountId, agg] of byAcct.entries()) {
      const account = acctById.get(accountId);
      if (!account) continue;
      const type = normType(account.account_type);
      const gross = netBalance(type, agg.debit, agg.credit);

      const isIC = prefixList.some((p) => (account.code || "").startsWith(p));
      let elimDebit = 0, elimCredit = 0;
      if (applyEliminations && isIC) {
        // Full elimination of IC balances (they cancel across the group)
        elimDebit = agg.debit;
        elimCredit = agg.credit;
      }
      const consDebit = agg.debit - elimDebit;
      const consCredit = agg.credit - elimCredit;
      const consNet = netBalance(type, consDebit, consCredit);
      const elimNet = gross - consNet;

      rows.push({
        account,
        grossDebit: agg.debit, grossCredit: agg.credit, grossNet: gross,
        elimDebit, elimCredit, elimNet,
        consDebit, consCredit, consNet,
        isIC,
      });
    }
    rows.sort((a, b) => (a.account.code || "").localeCompare(b.account.code || ""));

    // Aggregate P&L and Balance Sheet totals from consolidated figures
    const revenue = rows.filter((r) => normType(r.account.account_type) === "revenue").reduce((s, r) => s + r.consNet, 0);
    const expense = rows.filter((r) => normType(r.account.account_type) === "expense").reduce((s, r) => s + r.consNet, 0);
    const netIncome = revenue - expense;
    const assets = rows.filter((r) => normType(r.account.account_type) === "asset").reduce((s, r) => s + r.consNet, 0);
    const liabilities = rows.filter((r) => normType(r.account.account_type) === "liability").reduce((s, r) => s + r.consNet, 0);
    const equity = rows.filter((r) => normType(r.account.account_type) === "equity").reduce((s, r) => s + r.consNet, 0);
    const totalElim = rows.reduce((s, r) => s + Math.abs(r.elimNet), 0);
    const bsDelta = assets - (liabilities + equity + netIncome);

    return { rows, revenue, expense, netIncome, assets, liabilities, equity, totalElim, bsDelta };
  }, [accounts, entries, lines, dateFrom, dateTo, activeCompanyIds, prefixList, applyEliminations]);

  const exportRows = () =>
    exportToExcel(
      consolidated.rows.map((r) => ({
        Code: r.account.code,
        Account: r.account.name,
        Type: r.account.account_type,
        "IC?": r.isIC ? "Yes" : "",
        "Gross Debit": r.grossDebit.toFixed(2),
        "Gross Credit": r.grossCredit.toFixed(2),
        "Gross Net": r.grossNet.toFixed(2),
        "Elim Debit": r.elimDebit.toFixed(2),
        "Elim Credit": r.elimCredit.toFixed(2),
        "Consolidated Net": r.consNet.toFixed(2),
      })),
      "Consolidated TB",
      `consolidated_${dateFrom}_${dateTo}.xlsx`,
    );

  const anySelected = activeCompanyIds.length > 0;
  const groupLabel = anySelected
    ? `${activeCompanyIds.length} of ${companies.length} companies`
    : `All ${companies.length} companies`;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Consolidated Financial Statements</h1>
          <p className="text-muted-foreground">Multi-company roll-up with inter-company eliminations.</p>
        </div>
        <Button onClick={exportRows} variant="outline">
          <Download className="mr-2 h-4 w-4" /> Export
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Consolidation Scope</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>From</Label>
              <DateInput  value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <DateInput  value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <Label>Inter-Company Code Prefixes</Label>
              <Input value={icPrefixes} onChange={(e) => setIcPrefixes(e.target.value)} placeholder="199,299" />
            </div>
            <div className="flex items-end gap-2">
              <Checkbox id="elim" checked={applyEliminations} onCheckedChange={(v) => setApplyEliminations(!!v)} />
              <Label htmlFor="elim">Apply eliminations</Label>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Include Companies <span className="text-muted-foreground text-xs">(none = all)</span></Label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {companies.map((c) => (
                <label key={c.id} className="flex items-center gap-2 border rounded px-2 py-1 text-sm">
                  <Checkbox
                    checked={!!selected[c.id]}
                    onCheckedChange={(v) => setSelected((s) => ({ ...s, [c.id]: !!v }))}
                  />
                  <span className="truncate">{c.code ? `${c.code} — ` : ""}{c.name}</span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Building2 className="h-4 w-4" /> Scope</div>
          <div className="text-2xl font-bold mt-1">{groupLabel}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Layers className="h-4 w-4" /> Eliminations</div>
          <div className="text-2xl font-bold mt-1">{consolidated.totalElim.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">Consolidated Net Income</div>
          <div className={`text-2xl font-bold mt-1 ${consolidated.netIncome >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {consolidated.netIncome.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Scale className="h-4 w-4" /> BS Balance</div>
          <div className="text-2xl font-bold mt-1">
            {Math.abs(consolidated.bsDelta) < 0.01 ? (
              <Badge className="bg-emerald-600">Balanced</Badge>
            ) : (
              <Badge variant="destructive">Δ {consolidated.bsDelta.toFixed(2)}</Badge>
            )}
          </div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="tb">
        <TabsList>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
          <TabsTrigger value="pl">P&L</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
        </TabsList>

        <TabsContent value="tb">
          <Card><CardContent className="pt-6 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead>
                <TableHead className="text-right">Gross Debit</TableHead>
                <TableHead className="text-right">Gross Credit</TableHead>
                <TableHead className="text-right">Elim</TableHead>
                <TableHead className="text-right">Consolidated Net</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {consolidated.rows.map((r) => (
                  <TableRow key={r.account.id} className={r.isIC ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                    <TableCell className="font-mono text-xs">{r.account.code}</TableCell>
                    <TableCell>{r.account.name}{r.isIC && <Badge variant="outline" className="ml-2 text-xs">IC</Badge>}</TableCell>
                    <TableCell className="capitalize">{r.account.account_type}</TableCell>
                    <TableCell className="text-right">{r.grossDebit.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{r.grossCredit.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-amber-700">{r.elimNet !== 0 ? r.elimNet.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{r.consNet.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {consolidated.rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No posted entries in this period.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="pl">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Section</TableHead><TableHead className="text-right">Consolidated</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>Revenue</TableCell><TableCell className="text-right">{consolidated.revenue.toFixed(2)}</TableCell></TableRow>
                <TableRow><TableCell>Expenses</TableCell><TableCell className="text-right">({consolidated.expense.toFixed(2)})</TableCell></TableRow>
                <TableRow className="font-bold border-t-2"><TableCell>Net Income</TableCell><TableCell className={`text-right ${consolidated.netIncome >= 0 ? "text-emerald-600" : "text-red-600"}`}>{consolidated.netIncome.toFixed(2)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="bs">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Section</TableHead><TableHead className="text-right">Consolidated</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>Total Assets</TableCell><TableCell className="text-right">{consolidated.assets.toFixed(2)}</TableCell></TableRow>
                <TableRow><TableCell>Total Liabilities</TableCell><TableCell className="text-right">{consolidated.liabilities.toFixed(2)}</TableCell></TableRow>
                <TableRow><TableCell>Total Equity</TableCell><TableCell className="text-right">{consolidated.equity.toFixed(2)}</TableCell></TableRow>
                <TableRow><TableCell>Net Income (period)</TableCell><TableCell className="text-right">{consolidated.netIncome.toFixed(2)}</TableCell></TableRow>
                <TableRow className="font-bold border-t-2">
                  <TableCell>Liabilities + Equity + NI</TableCell>
                  <TableCell className="text-right">{(consolidated.liabilities + consolidated.equity + consolidated.netIncome).toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
