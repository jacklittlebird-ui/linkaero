import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, Plus, Trash2 } from "lucide-react";

type Account = { id: string; account_type: string };
type Line = { account_id: string; debit: number | null; credit: number | null };
type Issuance = { id: string; date: string; shares: number; note: string };
type Dilutive = { id: string; name: string; shares: number };

const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

const uid = () => Math.random().toString(36).slice(2, 10);

const STORAGE_KEY = "eps.inputs.v1";

export default function EarningsPerSharePage() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const lastDay = new Date(today.getFullYear(), 11, 31).toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(firstDay);
  const [toDate, setToDate] = useState(lastDay);
  const [openingShares, setOpeningShares] = useState<number>(1_000_000);
  const [preferredDividends, setPreferredDividends] = useState<number>(0);
  const [issuances, setIssuances] = useState<Issuance[]>([]);
  const [dilutives, setDilutives] = useState<Dilutive[]>([]);

  // Load persisted inputs
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.openingShares === "number") setOpeningShares(s.openingShares);
        if (typeof s.preferredDividends === "number") setPreferredDividends(s.preferredDividends);
        if (Array.isArray(s.issuances)) setIssuances(s.issuances);
        if (Array.isArray(s.dilutives)) setDilutives(s.dilutives);
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ openingShares, preferredDividends, issuances, dilutives }),
    );
  }, [openingShares, preferredDividends, issuances, dilutives]);

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ["eps-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("chart_of_accounts").select("id, account_type");
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const { data: lines = [] } = useQuery<Line[]>({
    queryKey: ["eps-lines", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entry_lines")
        .select("account_id, debit, credit, journal_entries!inner(entry_date, status)")
        .gte("journal_entries.entry_date", fromDate)
        .lte("journal_entries.entry_date", toDate)
        .eq("journal_entries.status", "Posted");
      if (error) throw error;
      return (data ?? []) as unknown as Line[];
    },
  });

  const netIncome = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, (a.account_type || "").toLowerCase()]));
    let revenue = 0;
    let expense = 0;
    for (const l of lines) {
      const t = byId.get(l.account_id);
      if (!t) continue;
      const debit = Number(l.debit || 0);
      const credit = Number(l.credit || 0);
      if (t === "revenue") revenue += credit - debit;
      else if (t === "expense") expense += debit - credit;
    }
    return revenue - expense;
  }, [accounts, lines]);

  const niAvailable = netIncome - preferredDividends;

  const periodDays = useMemo(() => {
    const a = new Date(fromDate).getTime();
    const b = new Date(toDate).getTime();
    return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
  }, [fromDate, toDate]);

  const weightedShares = useMemo(() => {
    const start = new Date(fromDate).getTime();
    const end = new Date(toDate).getTime() + 86_400_000; // inclusive
    let total = openingShares * periodDays;
    for (const iss of issuances) {
      const t = new Date(iss.date).getTime();
      if (Number.isNaN(t) || t < start || t > end) continue;
      const daysOutstanding = Math.max(0, Math.round((end - t) / 86_400_000));
      total += Number(iss.shares || 0) * daysOutstanding;
    }
    return total / periodDays;
  }, [openingShares, issuances, fromDate, toDate, periodDays]);

  const dilutiveTotal = useMemo(
    () => dilutives.reduce((sum, d) => sum + Number(d.shares || 0), 0),
    [dilutives],
  );

  const basicEps = weightedShares > 0 ? niAvailable / weightedShares : 0;
  const dilutedEps = weightedShares + dilutiveTotal > 0 ? niAvailable / (weightedShares + dilutiveTotal) : 0;

  const addIssuance = () =>
    setIssuances((x) => [...x, { id: uid(), date: fromDate, shares: 0, note: "" }]);
  const addDilutive = () => setDilutives((x) => [...x, { id: uid(), name: "", shares: 0 }]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-primary" />
            Earnings Per Share
          </h1>
          <p className="text-muted-foreground">IAS 33 — Basic and diluted EPS with weighted-average shares</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Period & Share Base</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label>From</Label>
            <DateInput  value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <DateInput  value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <Label>Opening Shares Outstanding</Label>
            <Input
              type="number"
              value={openingShares}
              onChange={(e) => setOpeningShares(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label>Preferred Dividends</Label>
            <Input
              type="number"
              value={preferredDividends}
              onChange={(e) => setPreferredDividends(Number(e.target.value) || 0)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Net Income</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(netIncome)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">NI Available to Common</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(niAvailable)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Weighted Avg Shares</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(weightedShares, 0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Dilutive Shares</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(dilutiveTotal, 0)}</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-primary">
          <CardHeader><CardTitle>Basic EPS</CardTitle></CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-primary">{fmt(basicEps, 4)}</div>
            <p className="text-xs text-muted-foreground mt-2">= NI available ÷ Weighted-avg shares</p>
          </CardContent>
        </Card>
        <Card className="border-primary">
          <CardHeader><CardTitle>Diluted EPS</CardTitle></CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-primary">{fmt(dilutedEps, 4)}</div>
            <p className="text-xs text-muted-foreground mt-2">= NI available ÷ (WASO + dilutive potential shares)</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Share Issuances During Period</CardTitle>
          <Button size="sm" onClick={addIssuance}><Plus className="w-4 h-4 mr-1" />Add</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Shares Issued</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issuances.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No issuances</TableCell></TableRow>
              )}
              {issuances.map((iss) => (
                <TableRow key={iss.id}>
                  <TableCell>
                    <DateInput  value={iss.date} onChange={(e) => setIssuances((x) => x.map((r) => r.id === iss.id ? { ...r, date: e.target.value } : r))} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={iss.shares} onChange={(e) => setIssuances((x) => x.map((r) => r.id === iss.id ? { ...r, shares: Number(e.target.value) || 0 } : r))} />
                  </TableCell>
                  <TableCell>
                    <Input value={iss.note} onChange={(e) => setIssuances((x) => x.map((r) => r.id === iss.id ? { ...r, note: e.target.value } : r))} />
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => setIssuances((x) => x.filter((r) => r.id !== iss.id))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Potential Dilutive Instruments</CardTitle>
          <Button size="sm" onClick={addDilutive}><Plus className="w-4 h-4 mr-1" />Add</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Instrument</TableHead>
                <TableHead>Convertible Shares</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dilutives.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No dilutive instruments</TableCell></TableRow>
              )}
              {dilutives.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Input placeholder="Options / Convertibles / Warrants" value={d.name} onChange={(e) => setDilutives((x) => x.map((r) => r.id === d.id ? { ...r, name: e.target.value } : r))} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={d.shares} onChange={(e) => setDilutives((x) => x.map((r) => r.id === d.id ? { ...r, shares: Number(e.target.value) || 0 } : r))} />
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => setDilutives((x) => x.filter((r) => r.id !== d.id))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
