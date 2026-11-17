import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Shield, Plus, Trash2, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

type HedgeType = "cash-flow" | "fair-value" | "net-investment";
type Relationship = {
  id: string;
  name: string;
  hedgeType: HedgeType;
  hedgedItem: string;                // e.g. "Forecast jet fuel purchases – Q3 2026"
  hedgingInstrument: string;         // e.g. "Brent crude swap 500,000 bbl"
  notional: number;
  currency: string;
  inceptionDate: string;
  maturityDate: string;
  // Period movements
  fvInstrumentChange: number;        // Δ FV of hedging instrument this period
  fvHedgedItemChange: number;        // Δ FV / expected CF of the hedged item (opposite sign expected)
  reclassifiedToPL: number;          // For cash-flow: amount recycled from OCI to P&L this period
  // Cumulative OCI (cash-flow / net investment) — user maintained
  openingCashFlowReserve: number;
  // Economic relationship & documentation (IFRS 9.6.4.1)
  economicRelationship: boolean;
  creditRiskDominant: boolean;
  hedgeRatioAppropriate: boolean;
  documentationComplete: boolean;
  notes: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const KEY = "ifrs9.hedges.v1";
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${n.toFixed(1)}%`;

const empty = (): Relationship => ({
  id: uid(),
  name: "",
  hedgeType: "cash-flow",
  hedgedItem: "",
  hedgingInstrument: "",
  notional: 0,
  currency: "USD",
  inceptionDate: new Date().toISOString().slice(0, 10),
  maturityDate: "",
  fvInstrumentChange: 0,
  fvHedgedItemChange: 0,
  reclassifiedToPL: 0,
  openingCashFlowReserve: 0,
  economicRelationship: true,
  creditRiskDominant: false,
  hedgeRatioAppropriate: true,
  documentationComplete: true,
  notes: "",
});

/**
 * IFRS 9 hedge mechanics:
 *  - Cash-flow hedge: effective portion → OCI (cash-flow reserve); ineffective portion → P&L.
 *    Effective portion = the lower (in absolute value) of cumulative FV change of the instrument
 *    and cumulative FV change of expected cash flows on the hedged item, subject to hedge ratio.
 *  - Fair-value hedge: both instrument change and hedged-item change go to P&L; the hedged item's
 *    carrying amount is adjusted for the hedged risk.
 *  - Net-investment hedge: effective portion → OCI (FCTR); ineffective → P&L; recycled on disposal.
 */
function computeEffectiveness(r: Relationship) {
  const instr = r.fvInstrumentChange;
  const item = r.fvHedgedItemChange;
  // Dollar-offset (period): perfectly offsetting = opposite sign, same magnitude.
  const offset = instr + item; // ideally ~0
  const absInstr = Math.abs(instr);
  const absItem = Math.abs(item);
  const denom = Math.max(absInstr, absItem);
  const effectivenessPct = denom === 0 ? 100 : (1 - Math.abs(offset) / denom) * 100;

  // Effective vs ineffective portion (for cash-flow / net-investment)
  const effectivePortion = Math.sign(-item) * Math.min(absInstr, absItem);
  const ineffectivePortion = instr - effectivePortion;

  // Qualifying criteria pass (IFRS 9.6.4.1)
  const qualifies =
    r.economicRelationship &&
    !r.creditRiskDominant &&
    r.hedgeRatioAppropriate &&
    r.documentationComplete;

  return { instr, item, offset, effectivenessPct, effectivePortion, ineffectivePortion, qualifies };
}

function computeAccounting(r: Relationship) {
  const eff = computeEffectiveness(r);
  let ociMovement = 0;
  let plMovement = 0;
  let hedgedItemAdjustment = 0;

  if (!eff.qualifies) {
    // Fails qualifying — instrument change goes fully to P&L
    plMovement = eff.instr;
  } else if (r.hedgeType === "cash-flow" || r.hedgeType === "net-investment") {
    ociMovement = eff.effectivePortion;
    plMovement = eff.ineffectivePortion - r.reclassifiedToPL + (r.hedgeType === "cash-flow" ? r.reclassifiedToPL : 0);
    // For clarity: ineffective portion + reclassified from OCI to P&L
    plMovement = eff.ineffectivePortion + r.reclassifiedToPL;
    ociMovement = eff.effectivePortion - r.reclassifiedToPL;
  } else {
    // Fair-value hedge: both to P&L; hedged item is remeasured for the hedged risk
    plMovement = eff.instr + eff.item;
    hedgedItemAdjustment = eff.item;
  }

  const closingReserve = r.openingCashFlowReserve + ociMovement;

  return { ...eff, ociMovement, plMovement, hedgedItemAdjustment, closingReserve };
}

export default function HedgeAccountingPage() {
  const [items, setItems] = useState<Relationship[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const totals = useMemo(() => {
    return items.reduce((acc, r) => {
      const a = computeAccounting(r);
      acc.notional += r.notional;
      acc.oci += a.ociMovement;
      acc.pl += a.plMovement;
      acc.closingReserve += a.closingReserve;
      if (!a.qualifies) acc.failing += 1;
      if (a.effectivenessPct < 80) acc.lowEffectiveness += 1;
      return acc;
    }, { notional: 0, oci: 0, pl: 0, closingReserve: 0, failing: 0, lowEffectiveness: 0 });
  }, [items]);

  const update = (id: string, patch: Partial<Relationship>) => {
    setItems(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const handleExport = () => {
    const rows = items.map(r => {
      const a = computeAccounting(r);
      return {
        Name: r.name,
        Type: r.hedgeType,
        "Hedged Item": r.hedgedItem,
        Instrument: r.hedgingInstrument,
        Notional: r.notional,
        Currency: r.currency,
        Inception: r.inceptionDate,
        Maturity: r.maturityDate,
        "Δ FV Instrument": r.fvInstrumentChange,
        "Δ FV Hedged Item": r.fvHedgedItemChange,
        "Effectiveness %": a.effectivenessPct.toFixed(2),
        "Effective Portion": a.effectivePortion,
        "Ineffective Portion": a.ineffectivePortion,
        "OCI Movement": a.ociMovement,
        "P&L Movement": a.plMovement,
        "Closing CF Reserve": a.closingReserve,
        Qualifies: a.qualifies ? "Yes" : "No",
      };
    });
    exportToExcel(rows, "Hedges", "hedge-accounting-ifrs9");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6" /> Hedge Accounting (IFRS 9)
          </h1>
          <p className="text-sm text-muted-foreground">
            Cash-flow, fair-value, and net-investment hedges with effectiveness testing and OCI/P&L split.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={!items.length}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button onClick={() => setItems(prev => [...prev, empty()])}>
            <Plus className="h-4 w-4 mr-2" /> Add Relationship
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Notional</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.notional)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">OCI Movement</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${totals.oci >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(totals.oci)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">P&L Movement</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${totals.pl >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(totals.pl)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Cash-Flow Reserve (closing)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.closingReserve)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Alerts</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.failing + totals.lowEffectiveness}</div>
            <div className="text-xs text-muted-foreground">{totals.failing} failing · {totals.lowEffectiveness} low effectiveness</div>
          </CardContent></Card>
      </div>

      {items.map(r => {
        const a = computeAccounting(r);
        const highlyEffective = a.effectivenessPct >= 80 && a.effectivenessPct <= 125;
        return (
          <Card key={r.id}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {r.name || "Unnamed hedge relationship"}
                <Badge variant="outline">{r.hedgeType.replace("-", " ")}</Badge>
                {a.qualifies
                  ? <Badge className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Qualifies</Badge>
                  : <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Fails criteria</Badge>}
                <Badge variant={highlyEffective ? "default" : "destructive"}>
                  Effectiveness {pct(a.effectivenessPct)}
                </Badge>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setItems(prev => prev.filter(x => x.id !== r.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><Label>Relationship Name</Label><Input value={r.name} onChange={e => update(r.id, { name: e.target.value })} /></div>
                <div>
                  <Label>Hedge Type</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={r.hedgeType}
                    onChange={e => update(r.id, { hedgeType: e.target.value as HedgeType })}
                  >
                    <option value="cash-flow">Cash-flow hedge</option>
                    <option value="fair-value">Fair-value hedge</option>
                    <option value="net-investment">Net-investment hedge</option>
                  </select>
                </div>
                <div><Label>Inception</Label><DateInput  value={r.inceptionDate} onChange={e => update(r.id, { inceptionDate: e.target.value })} /></div>
                <div><Label>Maturity</Label><DateInput  value={r.maturityDate} onChange={e => update(r.id, { maturityDate: e.target.value })} /></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2"><Label>Hedged Item</Label><Input value={r.hedgedItem} onChange={e => update(r.id, { hedgedItem: e.target.value })} placeholder="e.g. Forecast jet fuel purchases Q3 2026" /></div>
                <div className="md:col-span-2"><Label>Hedging Instrument</Label><Input value={r.hedgingInstrument} onChange={e => update(r.id, { hedgingInstrument: e.target.value })} placeholder="e.g. Brent swap 500,000 bbl @ USD 78" /></div>
                <div><Label>Notional</Label><Input type="number" value={r.notional} onChange={e => update(r.id, { notional: +e.target.value })} /></div>
                <div><Label>Currency</Label><Input value={r.currency} onChange={e => update(r.id, { currency: e.target.value })} /></div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Period Movements (IFRS 9.6.5)</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div><Label>Δ FV Hedging Instrument</Label><Input type="number" value={r.fvInstrumentChange} onChange={e => update(r.id, { fvInstrumentChange: +e.target.value })} /></div>
                  <div><Label>Δ FV / CF of Hedged Item</Label><Input type="number" value={r.fvHedgedItemChange} onChange={e => update(r.id, { fvHedgedItemChange: +e.target.value })} /></div>
                  {r.hedgeType !== "fair-value" && (
                    <>
                      <div><Label>Reclassified OCI → P&L</Label><Input type="number" value={r.reclassifiedToPL} onChange={e => update(r.id, { reclassifiedToPL: +e.target.value })} /></div>
                      <div><Label>Opening CF Reserve</Label><Input type="number" value={r.openingCashFlowReserve} onChange={e => update(r.id, { openingCashFlowReserve: +e.target.value })} /></div>
                    </>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Qualifying Criteria (IFRS 9.6.4.1)</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={r.economicRelationship} onChange={e => update(r.id, { economicRelationship: e.target.checked })} /> Economic relationship exists</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!r.creditRiskDominant} onChange={e => update(r.id, { creditRiskDominant: !e.target.checked })} /> Credit risk does NOT dominate</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={r.hedgeRatioAppropriate} onChange={e => update(r.id, { hedgeRatioAppropriate: e.target.checked })} /> Hedge ratio appropriate</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={r.documentationComplete} onChange={e => update(r.id, { documentationComplete: e.target.checked })} /> Formal documentation complete</label>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Accounting Outcome</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Treatment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Effective portion</TableCell>
                      <TableCell className="text-right">{fmt(a.effectivePortion)}</TableCell>
                      <TableCell>{r.hedgeType === "fair-value" ? "P&L (both sides)" : "OCI (reserve)"}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Ineffective portion</TableCell>
                      <TableCell className="text-right">{fmt(a.ineffectivePortion)}</TableCell>
                      <TableCell>P&L</TableCell>
                    </TableRow>
                    {r.hedgeType !== "fair-value" && (
                      <TableRow>
                        <TableCell>Reclassified from OCI</TableCell>
                        <TableCell className="text-right">{fmt(r.reclassifiedToPL)}</TableCell>
                        <TableCell>P&L (recycling)</TableCell>
                      </TableRow>
                    )}
                    {r.hedgeType === "fair-value" && (
                      <TableRow>
                        <TableCell>Hedged item carrying adjustment</TableCell>
                        <TableCell className="text-right">{fmt(a.hedgedItemAdjustment)}</TableCell>
                        <TableCell>Balance sheet (basis adj)</TableCell>
                      </TableRow>
                    )}
                    <TableRow className="font-semibold">
                      <TableCell>Total P&L impact</TableCell>
                      <TableCell className="text-right">{fmt(a.plMovement)}</TableCell>
                      <TableCell>—</TableCell>
                    </TableRow>
                    <TableRow className="font-semibold">
                      <TableCell>Total OCI impact</TableCell>
                      <TableCell className="text-right">{fmt(a.ociMovement)}</TableCell>
                      <TableCell>—</TableCell>
                    </TableRow>
                    {r.hedgeType !== "fair-value" && (
                      <TableRow className="font-semibold bg-muted/40">
                        <TableCell>Closing cash-flow reserve</TableCell>
                        <TableCell className="text-right">{fmt(a.closingReserve)}</TableCell>
                        <TableCell>Equity</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {!highlyEffective && (
                <div className="rounded-md border border-amber-500/50 p-3 text-sm flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                  <div>
                    Effectiveness of <b>{pct(a.effectivenessPct)}</b> is outside the historical 80–125% guidance.
                    Under IFRS 9 there is no bright line, but this warrants investigation of the hedge ratio and
                    possible rebalancing (IFRS 9.6.5.5).
                  </div>
                </div>
              )}

              <div>
                <Label>Notes / Risk management objective</Label>
                <Textarea rows={2} value={r.notes} onChange={e => update(r.id, { notes: e.target.value })} placeholder="Risk management strategy and objective, why the hedge is expected to be effective." />
              </div>
            </CardContent>
          </Card>
        );
      })}

      {!items.length && (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No hedge relationships. Click <b>Add Relationship</b> to model a cash-flow, fair-value, or net-investment hedge.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">IFRS 9 Reference</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p><b>Qualifying criteria (IFRS 9.6.4.1):</b> economic relationship, credit risk not dominant, hedge ratio consistent with risk management strategy, formal designation & documentation at inception.</p>
          <p><b>Cash-flow hedge (IFRS 9.6.5.11):</b> effective portion → OCI (cash-flow hedge reserve); ineffective → P&L; reclassify to P&L when the hedged forecast affects earnings.</p>
          <p><b>Fair-value hedge (IFRS 9.6.5.8):</b> Δ FV of instrument → P&L; hedged item carrying amount adjusted for the hedged risk with the offset in P&L.</p>
          <p><b>Net-investment hedge (IFRS 9.6.5.13):</b> treated similarly to a cash-flow hedge; recycled to P&L on disposal of the foreign operation.</p>
          <p><b>Rebalancing (IFRS 9.6.5.5):</b> adjust the hedge ratio when the risk management objective remains but the ratio no longer reflects the economic relationship.</p>
        </CardContent>
      </Card>
    </div>
  );
}
