import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Award, Plus, Trash2, Download } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

type SettlementType = "equity" | "cash";

type Grant = {
  id: string;
  name: string;
  recipient: string;
  settlementType: SettlementType;
  grantDate: string;
  vestingStart: string;
  vestingEnd: string;
  numInstruments: number;
  fairValuePerUnit: number; // at grant date for equity-settled; at reporting date for cash-settled
  expectedForfeitureRate: number; // 0..1
  reportingDate: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const STORAGE_KEY = "sbp.grants.v1";
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

const today = () => new Date().toISOString().slice(0, 10);

const empty = (): Grant => ({
  id: uid(),
  name: "",
  recipient: "",
  settlementType: "equity",
  grantDate: today(),
  vestingStart: today(),
  vestingEnd: today(),
  numInstruments: 0,
  fairValuePerUnit: 0,
  expectedForfeitureRate: 0,
  reportingDate: today(),
});

function computeExpense(g: Grant) {
  const start = new Date(g.vestingStart).getTime();
  const end = new Date(g.vestingEnd).getTime();
  const rpt = new Date(g.reportingDate).getTime();
  const totalDays = Math.max(1, (end - start) / 86400000);
  const elapsed = Math.max(0, Math.min(totalDays, (rpt - start) / 86400000));
  const vestingPct = elapsed / totalDays;
  const expectedVested = g.numInstruments * (1 - g.expectedForfeitureRate);
  const totalCost = expectedVested * g.fairValuePerUnit;
  const cumulativeExpense = totalCost * vestingPct;
  return { totalDays, elapsed, vestingPct, expectedVested, totalCost, cumulativeExpense };
}

export default function ShareBasedPaymentsPage() {
  const [grants, setGrants] = useState<Grant[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setGrants(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(grants));
  }, [grants]);

  const update = (id: string, patch: Partial<Grant>) =>
    setGrants((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const totals = useMemo(() => {
    let equityCum = 0;
    let cashCum = 0;
    let totalCost = 0;
    for (const g of grants) {
      const r = computeExpense(g);
      totalCost += r.totalCost;
      if (g.settlementType === "equity") equityCum += r.cumulativeExpense;
      else cashCum += r.cumulativeExpense;
    }
    return { equityCum, cashCum, totalCost, combined: equityCum + cashCum };
  }, [grants]);

  const handleExport = () => {
    exportToExcel(
      grants.map((g) => {
        const r = computeExpense(g);
        return {
          Grant: g.name,
          Recipient: g.recipient,
          Settlement: g.settlementType,
          "Grant Date": g.grantDate,
          "Vesting Start": g.vestingStart,
          "Vesting End": g.vestingEnd,
          Instruments: g.numInstruments,
          "FV / Unit": g.fairValuePerUnit,
          "Forfeiture %": g.expectedForfeitureRate * 100,
          "Vested %": (r.vestingPct * 100).toFixed(2),
          "Total Cost": r.totalCost.toFixed(2),
          "Cumulative Expense": r.cumulativeExpense.toFixed(2),
        };
      }),
      "Share-Based Payments",
      `share-based-payments-${today()}`,
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Award className="w-7 h-7 text-primary" />
            Share-Based Payments
          </h1>
          <p className="text-muted-foreground">IFRS 2 — Equity-settled and cash-settled awards with graded vesting</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}><Download className="w-4 h-4 mr-1" />Export</Button>
          <Button onClick={() => setGrants((x) => [...x, empty()])}><Plus className="w-4 h-4 mr-1" />Add Grant</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Grant-Date Cost</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(totals.totalCost)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Equity-Settled Cumulative</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-primary">{fmt(totals.equityCum)}</div><p className="text-xs text-muted-foreground">Cr Equity reserve</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Cash-Settled Cumulative</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-amber-600">{fmt(totals.cashCum)}</div><p className="text-xs text-muted-foreground">Cr Liability (remeasured)</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Expense to Date</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(totals.combined)}</div><p className="text-xs text-muted-foreground">Dr Staff cost</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Grants Register</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[140px]">Grant</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Settlement</TableHead>
                  <TableHead>Grant Date</TableHead>
                  <TableHead>Vesting Start</TableHead>
                  <TableHead>Vesting End</TableHead>
                  <TableHead>Reporting Date</TableHead>
                  <TableHead className="text-right">Instruments</TableHead>
                  <TableHead className="text-right">FV / Unit</TableHead>
                  <TableHead className="text-right">Forfeit %</TableHead>
                  <TableHead className="text-right">Vested %</TableHead>
                  <TableHead className="text-right">Cumulative Exp.</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.length === 0 && (
                  <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground">No grants — click Add to begin</TableCell></TableRow>
                )}
                {grants.map((g) => {
                  const r = computeExpense(g);
                  return (
                    <TableRow key={g.id}>
                      <TableCell><Input value={g.name} onChange={(e) => update(g.id, { name: e.target.value })} placeholder="ESOP 2026-A" /></TableCell>
                      <TableCell><Input value={g.recipient} onChange={(e) => update(g.id, { recipient: e.target.value })} placeholder="Employee / group" /></TableCell>
                      <TableCell>
                        <Select value={g.settlementType} onValueChange={(v) => update(g.id, { settlementType: v as SettlementType })}>
                          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="equity">Equity</SelectItem>
                            <SelectItem value="cash">Cash (SAR)</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><DateInput  className="w-36" value={g.grantDate} onChange={(e) => update(g.id, { grantDate: e.target.value })} /></TableCell>
                      <TableCell><DateInput  className="w-36" value={g.vestingStart} onChange={(e) => update(g.id, { vestingStart: e.target.value })} /></TableCell>
                      <TableCell><DateInput  className="w-36" value={g.vestingEnd} onChange={(e) => update(g.id, { vestingEnd: e.target.value })} /></TableCell>
                      <TableCell><DateInput  className="w-36" value={g.reportingDate} onChange={(e) => update(g.id, { reportingDate: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" className="w-24" value={g.numInstruments} onChange={(e) => update(g.id, { numInstruments: Number(e.target.value) || 0 })} /></TableCell>
                      <TableCell><Input type="number" step="0.01" className="w-24" value={g.fairValuePerUnit} onChange={(e) => update(g.id, { fairValuePerUnit: Number(e.target.value) || 0 })} /></TableCell>
                      <TableCell><Input type="number" step="0.01" min="0" max="1" className="w-20" value={g.expectedForfeitureRate} onChange={(e) => update(g.id, { expectedForfeitureRate: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })} /></TableCell>
                      <TableCell className="text-right">
                        <Badge variant={r.vestingPct >= 1 ? "default" : "secondary"}>{(r.vestingPct * 100).toFixed(1)}%</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-primary">{fmt(r.cumulativeExpense)}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => setGrants((xs) => xs.filter((x) => x.id !== g.id))}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Suggested Journal Entries (Period)</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="flex justify-between"><span>Dr Staff cost (P&L)</span><span className="font-mono">{fmt(totals.combined)}</span></div>
          <div className="flex justify-between pl-6"><span className="text-muted-foreground">Cr Share-based payment reserve (Equity)</span><span className="font-mono">{fmt(totals.equityCum)}</span></div>
          <div className="flex justify-between pl-6"><span className="text-muted-foreground">Cr Share-based payment liability</span><span className="font-mono">{fmt(totals.cashCum)}</span></div>
          <p className="text-xs text-muted-foreground pt-2">
            <Label className="font-medium">Note:</Label> Cash-settled awards are remeasured to fair value at each reporting date until settled (IFRS 2.30).
            Equity-settled awards are measured at grant-date fair value and not remeasured (IFRS 2.10).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
