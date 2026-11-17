import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PackageMinus, Plus, Trash2, Download, AlertTriangle } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

type Status = "held_for_sale" | "sold" | "abandoned" | "reclassified_back";
type Classification = "asset" | "disposal_group" | "discontinued_op";

type HeldForSaleItem = {
  id: string;
  name: string;
  classification: Classification;
  status: Status;
  classificationDate: string;
  expectedSaleDate: string;
  carryingAmount: number;      // just before reclassification
  fairValue: number;
  costsToSell: number;
  // Discontinued op figures (only relevant when classification=discontinued_op)
  discOpRevenue: number;
  discOpExpenses: number;
  discOpTaxExpense: number;
  notes: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const STORAGE_KEY = "held-for-sale.v1";
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const today = () => new Date().toISOString().slice(0, 10);

const empty = (): HeldForSaleItem => ({
  id: uid(),
  name: "",
  classification: "asset",
  status: "held_for_sale",
  classificationDate: today(),
  expectedSaleDate: today(),
  carryingAmount: 0,
  fairValue: 0,
  costsToSell: 0,
  discOpRevenue: 0,
  discOpExpenses: 0,
  discOpTaxExpense: 0,
  notes: "",
});

function compute(i: HeldForSaleItem) {
  const fvLessCosts = i.fairValue - i.costsToSell;
  // Measure at lower of carrying amount and FV less costs to sell (IFRS 5.15)
  const measuredAt = Math.min(i.carryingAmount, fvLessCosts);
  const impairment = Math.max(0, i.carryingAmount - fvLessCosts);
  const discOpPBT = i.discOpRevenue - i.discOpExpenses;
  const discOpPAT = discOpPBT - i.discOpTaxExpense;
  // Aging check — reclassification should generally complete within 12 months (IFRS 5.8)
  const days = Math.max(0, (new Date().getTime() - new Date(i.classificationDate).getTime()) / 86400000);
  const stalePastYear = days > 365 && i.status === "held_for_sale";
  return { fvLessCosts, measuredAt, impairment, discOpPBT, discOpPAT, days, stalePastYear };
}

const CLASS_LABEL: Record<Classification, string> = {
  asset: "Individual Asset",
  disposal_group: "Disposal Group",
  discontinued_op: "Discontinued Operation",
};

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  held_for_sale: "default",
  sold: "secondary",
  abandoned: "destructive",
  reclassified_back: "outline",
};

export default function HeldForSalePage() {
  const [items, setItems] = useState<HeldForSaleItem[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const update = (id: string, patch: Partial<HeldForSaleItem>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const totals = useMemo(() => {
    let carrying = 0, measured = 0, impairment = 0, discOpPAT = 0;
    let staleCount = 0;
    for (const i of items) {
      const r = compute(i);
      if (i.status === "held_for_sale") {
        carrying += i.carryingAmount;
        measured += r.measuredAt;
        impairment += r.impairment;
      }
      if (i.classification === "discontinued_op") {
        discOpPAT += r.discOpPAT;
      }
      if (r.stalePastYear) staleCount += 1;
    }
    return { carrying, measured, impairment, discOpPAT, staleCount };
  }, [items]);

  const handleExport = () => {
    exportToExcel(
      items.map((i) => {
        const r = compute(i);
        return {
          Name: i.name,
          Classification: CLASS_LABEL[i.classification],
          Status: i.status,
          "Classification Date": i.classificationDate,
          "Expected Sale": i.expectedSaleDate,
          "Carrying Amount": i.carryingAmount,
          "Fair Value": i.fairValue,
          "Costs to Sell": i.costsToSell,
          "FV less Costs": r.fvLessCosts,
          "Measured At": r.measuredAt,
          Impairment: r.impairment,
          "Disc Op Revenue": i.discOpRevenue,
          "Disc Op Expenses": i.discOpExpenses,
          "Disc Op Tax": i.discOpTaxExpense,
          "Disc Op PAT": r.discOpPAT,
          "Days Held": Math.floor(r.days),
          Notes: i.notes,
        };
      }),
      "Held for Sale",
      `held-for-sale-${today()}`,
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <PackageMinus className="w-7 h-7 text-primary" />
            Held-for-Sale & Discontinued Operations
          </h1>
          <p className="text-muted-foreground">IFRS 5 — Measurement, presentation and discontinued operations disclosures</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}><Download className="w-4 h-4 mr-1" />Export</Button>
          <Button onClick={() => setItems((x) => [...x, empty()])}><Plus className="w-4 h-4 mr-1" />Add Item</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Carrying (Held-for-Sale)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(totals.carrying)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Measured Value</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-primary">{fmt(totals.measured)}</div><p className="text-xs text-muted-foreground">Lower of CA & FV − costs</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Impairment on Reclassification</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-rose-600">{fmt(totals.impairment)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Discontinued Ops PAT</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${totals.discOpPAT >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(totals.discOpPAT)}</div></CardContent></Card>
      </div>

      {totals.staleCount > 0 && (
        <div className="flex items-start gap-2 p-3 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
          <div>
            <strong>{totals.staleCount}</strong> item(s) classified as held-for-sale for more than 12 months.
            IFRS 5.9 requires the sale to be highly probable and expected to complete within one year; reassess whether the criteria
            remain met or reclassify back per IFRS 5.26.
          </div>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Register</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">Item</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Classification Date</TableHead>
                  <TableHead>Expected Sale</TableHead>
                  <TableHead className="text-right">Carrying</TableHead>
                  <TableHead className="text-right">Fair Value</TableHead>
                  <TableHead className="text-right">Costs to Sell</TableHead>
                  <TableHead className="text-right">Measured At</TableHead>
                  <TableHead className="text-right">Impairment</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">No items — click Add to begin</TableCell></TableRow>
                )}
                {items.map((i) => {
                  const r = compute(i);
                  return (
                    <TableRow key={i.id}>
                      <TableCell><Input value={i.name} onChange={(e) => update(i.id, { name: e.target.value })} placeholder="e.g. Aircraft SU-BVH" /></TableCell>
                      <TableCell>
                        <Select value={i.classification} onValueChange={(v) => update(i.id, { classification: v as Classification })}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="asset">Individual Asset</SelectItem>
                            <SelectItem value="disposal_group">Disposal Group</SelectItem>
                            <SelectItem value="discontinued_op">Discontinued Op</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={i.status} onValueChange={(v) => update(i.id, { status: v as Status })}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="held_for_sale">Held for Sale</SelectItem>
                            <SelectItem value="sold">Sold</SelectItem>
                            <SelectItem value="abandoned">Abandoned</SelectItem>
                            <SelectItem value="reclassified_back">Reclassified Back</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><DateInput  className="w-36" value={i.classificationDate} onChange={(e) => update(i.id, { classificationDate: e.target.value })} /></TableCell>
                      <TableCell><DateInput  className="w-36" value={i.expectedSaleDate} onChange={(e) => update(i.id, { expectedSaleDate: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" className="w-28" value={i.carryingAmount} onChange={(e) => update(i.id, { carryingAmount: Number(e.target.value) || 0 })} /></TableCell>
                      <TableCell><Input type="number" className="w-28" value={i.fairValue} onChange={(e) => update(i.id, { fairValue: Number(e.target.value) || 0 })} /></TableCell>
                      <TableCell><Input type="number" className="w-24" value={i.costsToSell} onChange={(e) => update(i.id, { costsToSell: Number(e.target.value) || 0 })} /></TableCell>
                      <TableCell className="text-right font-medium text-primary">{fmt(r.measuredAt)}</TableCell>
                      <TableCell className="text-right">
                        {r.impairment > 0 ? <Badge variant="destructive">{fmt(r.impairment)}</Badge> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => setItems((xs) => xs.filter((x) => x.id !== i.id))}>
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
        <CardHeader><CardTitle>Discontinued Operations — Single Amount Disclosure</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operation</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">PBT</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">PAT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.filter((i) => i.classification === "discontinued_op").length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No discontinued operations</TableCell></TableRow>
              )}
              {items.filter((i) => i.classification === "discontinued_op").map((i) => {
                const r = compute(i);
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.name || "—"}</TableCell>
                    <TableCell><Input type="number" className="w-28 ml-auto" value={i.discOpRevenue} onChange={(e) => update(i.id, { discOpRevenue: Number(e.target.value) || 0 })} /></TableCell>
                    <TableCell><Input type="number" className="w-28 ml-auto" value={i.discOpExpenses} onChange={(e) => update(i.id, { discOpExpenses: Number(e.target.value) || 0 })} /></TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.discOpPBT)}</TableCell>
                    <TableCell><Input type="number" className="w-24 ml-auto" value={i.discOpTaxExpense} onChange={(e) => update(i.id, { discOpTaxExpense: Number(e.target.value) || 0 })} /></TableCell>
                    <TableCell className={`text-right font-mono font-medium ${r.discOpPAT >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(r.discOpPAT)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            <Label className="font-medium">IFRS 5.33:</Label> Present a single amount in the statement of P&L comprising post-tax profit
            or loss of discontinued operations and any gain/loss on measurement to fair value less costs to sell. Held-for-sale assets
            are not depreciated (IFRS 5.25) and are presented separately from other assets in the SoFP.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
