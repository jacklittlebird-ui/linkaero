import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Percent, Plus, Trash2, Download, AlertTriangle } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

type Borrowing = { id: string; name: string; principal: number; rate: number; general: boolean };
type QualifyingAsset = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  suspensionDays: number;
  expenditures: { id: string; date: string; amount: number }[];
  specificBorrowingId: string | null;
  specificInvestmentIncome: number;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const KEY_B = "ias23.borrowings.v1";
const KEY_A = "ias23.assets.v1";
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${n.toFixed(2)}%`;

function daysBetween(a: string, b: string) {
  if (!a || !b) return 0;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24);
  return d > 0 ? d : 0;
}

function periodDays(asset: QualifyingAsset) {
  const gross = daysBetween(asset.startDate, asset.endDate);
  return Math.max(0, gross - (asset.suspensionDays || 0));
}

function weightedAverageExpenditure(asset: QualifyingAsset) {
  const total = periodDays(asset);
  if (!total || !asset.endDate) return 0;
  const end = new Date(asset.endDate).getTime();
  let wae = 0;
  for (const e of asset.expenditures) {
    if (!e.date) continue;
    const t = new Date(e.date).getTime();
    if (isNaN(t)) continue;
    const daysOutstanding = Math.max(0, (end - t) / (1000 * 60 * 60 * 24));
    wae += e.amount * (daysOutstanding / total);
  }
  return wae;
}

function generalCapitalisationRate(borrowings: Borrowing[]) {
  const general = borrowings.filter(b => b.general);
  const principal = general.reduce((s, b) => s + b.principal, 0);
  const interest = general.reduce((s, b) => s + b.principal * (b.rate / 100), 0);
  return principal > 0 ? (interest / principal) * 100 : 0;
}

export default function BorrowingCostsPage() {
  const [borrowings, setBorrowings] = useState<Borrowing[]>([]);
  const [assets, setAssets] = useState<QualifyingAsset[]>([]);

  useEffect(() => {
    try {
      const b = localStorage.getItem(KEY_B); if (b) setBorrowings(JSON.parse(b));
      const a = localStorage.getItem(KEY_A); if (a) setAssets(JSON.parse(a));
    } catch { /* noop */ }
  }, []);

  useEffect(() => { localStorage.setItem(KEY_B, JSON.stringify(borrowings)); }, [borrowings]);
  useEffect(() => { localStorage.setItem(KEY_A, JSON.stringify(assets)); }, [assets]);

  const capRate = useMemo(() => generalCapitalisationRate(borrowings), [borrowings]);

  const results = useMemo(() => assets.map(a => {
    const days = periodDays(a);
    const yearFrac = days / 365;
    const wae = weightedAverageExpenditure(a);
    const specific = a.specificBorrowingId ? borrowings.find(b => b.id === a.specificBorrowingId) : null;
    const specificInterest = specific ? specific.principal * (specific.rate / 100) * yearFrac : 0;
    const specificNet = Math.max(0, specificInterest - (a.specificInvestmentIncome || 0));
    const specificPrincipal = specific ? specific.principal : 0;
    const generalBase = Math.max(0, wae - specificPrincipal);
    const generalInterest = generalBase * (capRate / 100) * yearFrac;
    // Cap: cannot exceed total borrowing costs incurred (IAS 23.14)
    const totalIncurred = borrowings.reduce((s, b) => s + b.principal * (b.rate / 100) * yearFrac, 0);
    const totalToCapitalise = Math.min(specificNet + generalInterest, totalIncurred);
    return { asset: a, days, yearFrac, wae, specific, specificInterest, specificNet, generalBase, generalInterest, totalToCapitalise, totalIncurred };
  }), [assets, borrowings, capRate]);

  const totals = useMemo(() => results.reduce((acc, r) => {
    acc.wae += r.wae;
    acc.capitalised += r.totalToCapitalise;
    acc.incurred += r.totalIncurred;
    return acc;
  }, { wae: 0, capitalised: 0, incurred: 0 }), [results]);

  const addBorrowing = () => setBorrowings(p => [...p, { id: uid(), name: "", principal: 0, rate: 0, general: true }]);
  const updateBorrowing = (id: string, patch: Partial<Borrowing>) =>
    setBorrowings(p => p.map(b => b.id === id ? { ...b, ...patch } : b));
  const removeBorrowing = (id: string) => setBorrowings(p => p.filter(b => b.id !== id));

  const addAsset = () => setAssets(p => [...p, {
    id: uid(), name: "", startDate: new Date().toISOString().slice(0, 10), endDate: "",
    suspensionDays: 0, expenditures: [], specificBorrowingId: null, specificInvestmentIncome: 0,
  }]);
  const updateAsset = (id: string, patch: Partial<QualifyingAsset>) =>
    setAssets(p => p.map(a => a.id === id ? { ...a, ...patch } : a));
  const removeAsset = (id: string) => setAssets(p => p.filter(a => a.id !== id));

  const addExpenditure = (aid: string) =>
    setAssets(p => p.map(a => a.id === aid
      ? { ...a, expenditures: [...a.expenditures, { id: uid(), date: new Date().toISOString().slice(0, 10), amount: 0 }] }
      : a));
  const updateExpenditure = (aid: string, eid: string, patch: Partial<{ date: string; amount: number }>) =>
    setAssets(p => p.map(a => a.id === aid
      ? { ...a, expenditures: a.expenditures.map(e => e.id === eid ? { ...e, ...patch } : e) }
      : a));
  const removeExpenditure = (aid: string, eid: string) =>
    setAssets(p => p.map(a => a.id === aid ? { ...a, expenditures: a.expenditures.filter(e => e.id !== eid) } : a));

  const handleExport = () => {
    const rows = results.map(r => ({
      Asset: r.asset.name,
      "Capitalisation Period (days)": r.days,
      "Weighted Avg Expenditure": r.wae,
      "Specific Borrowing": r.specific?.name ?? "",
      "Specific Interest (net)": r.specificNet,
      "General Base": r.generalBase,
      "Capitalisation Rate %": capRate.toFixed(2),
      "General Interest": r.generalInterest,
      "Total Capitalised": r.totalToCapitalise,
      "Total Incurred (cap limit)": r.totalIncurred,
    }));
    exportToExcel(rows, "Borrowing Costs", "borrowing-costs-ias23");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Percent className="h-6 w-6" /> Borrowing Costs (IAS 23)
          </h1>
          <p className="text-sm text-muted-foreground">
            Capitalise borrowing costs directly attributable to qualifying assets; expense the rest.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={!assets.length}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button onClick={addAsset}><Plus className="h-4 w-4 mr-2" /> Qualifying Asset</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">General Capitalisation Rate</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{pct(capRate)}</div>
            <div className="text-xs text-muted-foreground">weighted average of general borrowings</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Weighted Avg Expenditure</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.wae)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Capitalised</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-primary">{fmt(totals.capitalised)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Interest Incurred</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.incurred)}</div>
            <div className="text-xs text-muted-foreground">upper cap per IAS 23.14</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Borrowings</CardTitle>
          <Button size="sm" variant="outline" onClick={addBorrowing}>
            <Plus className="h-3 w-3 mr-1" /> Add Borrowing
          </Button>
        </CardHeader>
        <CardContent>
          {borrowings.length === 0 ? (
            <div className="text-sm text-muted-foreground">Add borrowings to compute the capitalisation rate.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Principal</TableHead>
                  <TableHead>Rate %</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Annual Interest</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {borrowings.map(b => (
                  <TableRow key={b.id}>
                    <TableCell><Input value={b.name} onChange={e => updateBorrowing(b.id, { name: e.target.value })} placeholder="Facility A" /></TableCell>
                    <TableCell><Input type="number" value={b.principal} onChange={e => updateBorrowing(b.id, { principal: +e.target.value })} /></TableCell>
                    <TableCell><Input type="number" value={b.rate} onChange={e => updateBorrowing(b.id, { rate: +e.target.value })} /></TableCell>
                    <TableCell>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={b.general ? "general" : "specific"}
                        onChange={e => updateBorrowing(b.id, { general: e.target.value === "general" })}
                      >
                        <option value="general">General</option>
                        <option value="specific">Specific</option>
                      </select>
                    </TableCell>
                    <TableCell>{fmt(b.principal * b.rate / 100)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => removeBorrowing(b.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {results.map(r => (
        <Card key={r.asset.id}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {r.asset.name || "Qualifying asset"}
              <Badge>{r.days} capitalisation days</Badge>
              <Badge variant="outline">Capitalise {fmt(r.totalToCapitalise)}</Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => removeAsset(r.asset.id)}><Trash2 className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div><Label>Asset Name</Label><Input value={r.asset.name} onChange={e => updateAsset(r.asset.id, { name: e.target.value })} /></div>
              <div><Label>Capitalisation Start</Label><DateInput  value={r.asset.startDate} onChange={e => updateAsset(r.asset.id, { startDate: e.target.value })} /></div>
              <div><Label>End (ready for use)</Label><DateInput  value={r.asset.endDate} onChange={e => updateAsset(r.asset.id, { endDate: e.target.value })} /></div>
              <div><Label>Suspension Days (IAS 23.20)</Label><Input type="number" value={r.asset.suspensionDays} onChange={e => updateAsset(r.asset.id, { suspensionDays: +e.target.value })} /></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Specific Borrowing (if any)</Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={r.asset.specificBorrowingId ?? ""}
                  onChange={e => updateAsset(r.asset.id, { specificBorrowingId: e.target.value || null })}
                >
                  <option value="">— None —</option>
                  {borrowings.filter(b => !b.general).map(b => (
                    <option key={b.id} value={b.id}>{b.name || "Unnamed"} ({fmt(b.principal)} @ {b.rate}%)</option>
                  ))}
                </select>
              </div>
              <div><Label>Investment Income on Specific</Label><Input type="number" value={r.asset.specificInvestmentIncome} onChange={e => updateAsset(r.asset.id, { specificInvestmentIncome: +e.target.value })} /></div>
              <div><Label>Weighted Avg Expenditure</Label><Input readOnly value={fmt(r.wae)} /></div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Expenditures on the Qualifying Asset</Label>
                <Button size="sm" variant="outline" onClick={() => addExpenditure(r.asset.id)}>
                  <Plus className="h-3 w-3 mr-1" /> Add Expenditure
                </Button>
              </div>
              {r.asset.expenditures.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.asset.expenditures.map(e => (
                      <TableRow key={e.id}>
                        <TableCell><DateInput  value={e.date} onChange={ev => updateExpenditure(r.asset.id, e.id, { date: ev.target.value })} /></TableCell>
                        <TableCell><Input type="number" value={e.amount} onChange={ev => updateExpenditure(r.asset.id, e.id, { amount: +ev.target.value })} /></TableCell>
                        <TableCell><Button variant="ghost" size="sm" onClick={() => removeExpenditure(r.asset.id, e.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="rounded-md border p-4 text-sm space-y-1 bg-muted/30">
              <div className="flex justify-between"><span>Specific interest</span><span>{fmt(r.specificInterest)}</span></div>
              <div className="flex justify-between"><span>Less: investment income on specific</span><span>({fmt(r.asset.specificInvestmentIncome)})</span></div>
              <div className="flex justify-between"><span>Net specific borrowing cost</span><span>{fmt(r.specificNet)}</span></div>
              <div className="flex justify-between"><span>General base (WAE − specific principal)</span><span>{fmt(r.generalBase)}</span></div>
              <div className="flex justify-between"><span>× Capitalisation rate × period</span><span>{pct(capRate)} × {r.yearFrac.toFixed(3)}</span></div>
              <div className="flex justify-between"><span>General interest</span><span>{fmt(r.generalInterest)}</span></div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Amount capitalised (capped at incurred)</span>
                <span>{fmt(r.totalToCapitalise)}</span>
              </div>
            </div>

            {r.totalToCapitalise === r.totalIncurred && r.totalIncurred > 0 && (
              <div className="rounded-md border border-amber-500/50 p-3 text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                <div>Capitalisation limited by <b>IAS 23.14</b> — cannot exceed the total borrowing costs incurred during the period.</div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {!assets.length && (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No qualifying assets. Click <b>Qualifying Asset</b> to start.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">IAS 23 Reference</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p><b>Definition (IAS 23.5):</b> a qualifying asset takes a substantial period of time to get ready for its intended use or sale.</p>
          <p><b>Specific borrowing (IAS 23.12):</b> actual borrowing costs incurred less investment income earned on temporary reinvestment.</p>
          <p><b>General borrowings (IAS 23.14):</b> apply a weighted-average capitalisation rate to the excess of asset expenditures over specific borrowings; total capitalised must not exceed borrowing costs incurred.</p>
          <p><b>Suspension (IAS 23.20):</b> suspend capitalisation during extended periods when active development is interrupted.</p>
          <p><b>Cessation (IAS 23.22):</b> cease capitalising when substantially all activities to prepare the asset are complete.</p>
        </CardContent>
      </Card>
    </div>
  );
}
