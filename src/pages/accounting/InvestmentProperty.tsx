import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building, Plus, Trash2, Download, AlertTriangle } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

type Model = "cost" | "fair-value";
type Property = {
  id: string;
  name: string;
  location: string;
  acquisitionDate: string;
  cost: number;
  accumulatedDepreciation: number;
  usefulLife: number;
  residualValue: number;
  model: Model;
  fairValue: number;
  priorFairValue: number;
  rentalIncome: number;
  directOperatingExpenses: number;
  isLeased: boolean;
  notes: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const KEY = "ias40.investment-property.v1";
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const empty = (): Property => ({
  id: uid(),
  name: "",
  location: "",
  acquisitionDate: new Date().toISOString().slice(0, 10),
  cost: 0,
  accumulatedDepreciation: 0,
  usefulLife: 40,
  residualValue: 0,
  model: "cost",
  fairValue: 0,
  priorFairValue: 0,
  rentalIncome: 0,
  directOperatingExpenses: 0,
  isLeased: false,
  notes: "",
});

function compute(p: Property) {
  const depreciableBase = Math.max(0, p.cost - p.residualValue);
  const annualDep = p.usefulLife > 0 ? depreciableBase / p.usefulLife : 0;
  const costCarrying = Math.max(0, p.cost - p.accumulatedDepreciation);
  const carrying = p.model === "fair-value" ? p.fairValue : costCarrying;
  const fvGain = p.model === "fair-value" ? p.fairValue - p.priorFairValue : 0;
  const netRental = p.rentalIncome - p.directOperatingExpenses;
  return { annualDep, costCarrying, carrying, fvGain, netRental };
}

export default function InvestmentPropertyPage() {
  const [items, setItems] = useState<Property[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const totals = useMemo(() => items.reduce((acc, p) => {
    const c = compute(p);
    acc.cost += p.cost;
    acc.carrying += c.carrying;
    acc.fvGain += c.fvGain;
    acc.rental += c.netRental;
    acc.annualDep += p.model === "cost" ? c.annualDep : 0;
    return acc;
  }, { cost: 0, carrying: 0, fvGain: 0, rental: 0, annualDep: 0 }), [items]);

  const modelsMixed = useMemo(() => {
    const models = new Set(items.map(i => i.model));
    return items.length > 1 && models.size > 1;
  }, [items]);

  const update = (id: string, patch: Partial<Property>) => {
    setItems(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  };

  const handleExport = () => {
    const rows = items.map(p => {
      const c = compute(p);
      return {
        Property: p.name,
        Location: p.location,
        Acquired: p.acquisitionDate,
        Model: p.model,
        Cost: p.cost,
        "Accum. Depreciation": p.accumulatedDepreciation,
        "Cost-model Carrying": c.costCarrying,
        "Fair Value": p.fairValue,
        "FV Gain/(Loss)": c.fvGain,
        "Carrying (recognised)": c.carrying,
        "Rental Income": p.rentalIncome,
        "Direct Op. Expenses": p.directOperatingExpenses,
        "Net Rental": c.netRental,
      };
    });
    exportToExcel(rows, "Investment Property", "investment-property-ias40");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building className="h-6 w-6" /> Investment Property (IAS 40)
          </h1>
          <p className="text-sm text-muted-foreground">
            Property held to earn rentals or for capital appreciation — cost or fair-value model.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={!items.length}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button onClick={() => setItems(prev => [...prev, empty()])}>
            <Plus className="h-4 w-4 mr-2" /> Add Property
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Cost</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.cost)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Carrying Amount</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.carrying)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">FV Gain/(Loss) P&L</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${totals.fvGain >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(totals.fvGain)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Net Rental</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.rental)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Annual Depreciation</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.annualDep)}</div>
            <div className="text-xs text-muted-foreground">cost-model only</div></CardContent></Card>
      </div>

      {modelsMixed && (
        <Card className="border-amber-500/50">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
            <div className="text-sm">
              <b>Mixed measurement models.</b> IAS 40.30 requires the entity to apply the same model to all
              investment property (with narrow exceptions). Review classification consistency.
            </div>
          </CardContent>
        </Card>
      )}

      {items.map(p => {
        const c = compute(p);
        return (
          <Card key={p.id}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {p.name || "Unnamed property"}
                <Badge variant="outline">{p.model === "fair-value" ? "Fair-value model" : "Cost model"}</Badge>
                {p.isLeased && <Badge variant="secondary">Leased (IFRS 16 ROU)</Badge>}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setItems(prev => prev.filter(x => x.id !== p.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><Label>Property Name</Label><Input value={p.name} onChange={e => update(p.id, { name: e.target.value })} /></div>
                <div><Label>Location</Label><Input value={p.location} onChange={e => update(p.id, { location: e.target.value })} /></div>
                <div><Label>Acquisition Date</Label><DateInput  value={p.acquisitionDate} onChange={e => update(p.id, { acquisitionDate: e.target.value })} /></div>
                <div>
                  <Label>Measurement Model</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={p.model}
                    onChange={e => update(p.id, { model: e.target.value as Model })}
                  >
                    <option value="cost">Cost (IAS 40.56)</option>
                    <option value="fair-value">Fair value (IAS 40.33)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><Label>Cost</Label><Input type="number" value={p.cost} onChange={e => update(p.id, { cost: +e.target.value })} /></div>
                <div><Label>Residual Value</Label><Input type="number" value={p.residualValue} onChange={e => update(p.id, { residualValue: +e.target.value })} /></div>
                <div><Label>Useful Life (yrs)</Label><Input type="number" value={p.usefulLife} onChange={e => update(p.id, { usefulLife: +e.target.value })} /></div>
                <div><Label>Accum. Depreciation</Label><Input type="number" value={p.accumulatedDepreciation} onChange={e => update(p.id, { accumulatedDepreciation: +e.target.value })} /></div>
              </div>

              {p.model === "fair-value" && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div><Label>Prior Fair Value</Label><Input type="number" value={p.priorFairValue} onChange={e => update(p.id, { priorFairValue: +e.target.value })} /></div>
                  <div><Label>Current Fair Value</Label><Input type="number" value={p.fairValue} onChange={e => update(p.id, { fairValue: +e.target.value })} /></div>
                  <div><Label>FV Gain/(Loss) → P&L</Label><Input readOnly value={fmt(c.fvGain)} /></div>
                  <div className="text-xs text-muted-foreground self-end pb-2">
                    Under FV model, changes go to P&L (IAS 40.35). No depreciation.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><Label>Rental Income</Label><Input type="number" value={p.rentalIncome} onChange={e => update(p.id, { rentalIncome: +e.target.value })} /></div>
                <div><Label>Direct Operating Expenses</Label><Input type="number" value={p.directOperatingExpenses} onChange={e => update(p.id, { directOperatingExpenses: +e.target.value })} /></div>
                <div><Label>Net Rental</Label><Input readOnly value={fmt(c.netRental)} /></div>
                <div>
                  <Label>Leased Property?</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={p.isLeased ? "yes" : "no"}
                    onChange={e => update(p.id, { isLeased: e.target.value === "yes" })}
                  >
                    <option value="no">Owned</option>
                    <option value="yes">Held under lease (ROU)</option>
                  </select>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Cost less accumulated depreciation</TableCell>
                    <TableCell className="text-right">{fmt(c.costCarrying)}</TableCell>
                  </TableRow>
                  {p.model === "cost" && (
                    <TableRow>
                      <TableCell>Annual depreciation charge</TableCell>
                      <TableCell className="text-right">{fmt(c.annualDep)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow className="font-semibold bg-muted/30">
                    <TableCell>Carrying amount recognised</TableCell>
                    <TableCell className="text-right">{fmt(c.carrying)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      {!items.length && (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No investment properties. Click <b>Add Property</b> to start.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">IAS 40 Reference</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p><b>Definition (IAS 40.5):</b> land or building held to earn rentals or for capital appreciation, not for use or sale in the ordinary course of business.</p>
          <p><b>Measurement (IAS 40.30):</b> choose the fair value model or cost model and apply to all investment property; disclose fair value even when the cost model is used.</p>
          <p><b>Fair value model (IAS 40.35):</b> gains and losses go to profit or loss; no depreciation is charged.</p>
          <p><b>Transfers (IAS 40.57):</b> only when there is a change in use, evidenced by commencement/end of owner-occupation, lease to another party, or development for sale.</p>
        </CardContent>
      </Card>
    </div>
  );
}
