import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Building2, Plus, Trash2, Download, AlertTriangle, TrendingDown } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

type IdAsset = { id: string; name: string; fairValue: number; usefulLife: number };
type Combination = {
  id: string;
  acquirerName: string;
  acquireeName: string;
  acquisitionDate: string;
  ownershipPct: number;
  // Consideration transferred (IFRS 3.37)
  cashPaid: number;
  equityIssued: number;
  contingentConsideration: number;
  // Identifiable net assets at fair value (IFRS 3.18)
  tangibleAssets: number;
  identifiableIntangibles: IdAsset[];
  assumedLiabilities: number;
  // NCI (IFRS 3.19)
  nciMeasurement: "fair-value" | "proportionate";
  nciFairValue: number;
  // Impairment testing
  goodwillImpairmentToDate: number;
  notes: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const KEY = "ifrs3.combinations.v1";
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const emptyCombination = (): Combination => ({
  id: uid(),
  acquirerName: "",
  acquireeName: "",
  acquisitionDate: new Date().toISOString().slice(0, 10),
  ownershipPct: 100,
  cashPaid: 0,
  equityIssued: 0,
  contingentConsideration: 0,
  tangibleAssets: 0,
  identifiableIntangibles: [],
  assumedLiabilities: 0,
  nciMeasurement: "fair-value",
  nciFairValue: 0,
  goodwillImpairmentToDate: 0,
  notes: "",
});

function computeGoodwill(c: Combination) {
  const consideration = c.cashPaid + c.equityIssued + c.contingentConsideration;
  const intangiblesFV = c.identifiableIntangibles.reduce((s, a) => s + a.fairValue, 0);
  const netIdentifiable = c.tangibleAssets + intangiblesFV - c.assumedLiabilities;
  const nci = c.nciMeasurement === "fair-value"
    ? c.nciFairValue
    : netIdentifiable * (1 - c.ownershipPct / 100);
  const goodwill = consideration + nci - netIdentifiable;
  const carrying = Math.max(0, goodwill - c.goodwillImpairmentToDate);
  return { consideration, intangiblesFV, netIdentifiable, nci, goodwill, carrying };
}

export default function BusinessCombinationsPage() {
  const [items, setItems] = useState<Combination[]>([]);

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
    return items.reduce((acc, c) => {
      const r = computeGoodwill(c);
      acc.consideration += r.consideration;
      acc.netIdentifiable += r.netIdentifiable;
      acc.nci += r.nci;
      acc.goodwill += r.goodwill;
      acc.carrying += r.carrying;
      acc.impairment += c.goodwillImpairmentToDate;
      if (r.goodwill < 0) acc.bargainCount += 1;
      return acc;
    }, { consideration: 0, netIdentifiable: 0, nci: 0, goodwill: 0, carrying: 0, impairment: 0, bargainCount: 0 });
  }, [items]);

  const update = (id: string, patch: Partial<Combination>) => {
    setItems(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const addIntangible = (id: string) => {
    setItems(prev => prev.map(c => c.id === id ? {
      ...c,
      identifiableIntangibles: [...c.identifiableIntangibles, { id: uid(), name: "", fairValue: 0, usefulLife: 0 }],
    } : c));
  };

  const updateIntangible = (cid: string, iid: string, patch: Partial<IdAsset>) => {
    setItems(prev => prev.map(c => c.id === cid ? {
      ...c,
      identifiableIntangibles: c.identifiableIntangibles.map(a => a.id === iid ? { ...a, ...patch } : a),
    } : c));
  };

  const removeIntangible = (cid: string, iid: string) => {
    setItems(prev => prev.map(c => c.id === cid ? {
      ...c,
      identifiableIntangibles: c.identifiableIntangibles.filter(a => a.id !== iid),
    } : c));
  };

  const handleExport = () => {
    const rows = items.map(c => {
      const r = computeGoodwill(c);
      return {
        Acquirer: c.acquirerName,
        Acquiree: c.acquireeName,
        "Acquisition Date": c.acquisitionDate,
        "Ownership %": c.ownershipPct,
        Consideration: r.consideration,
        "Net Identifiable Assets": r.netIdentifiable,
        NCI: r.nci,
        "Goodwill / (Bargain)": r.goodwill,
        "Impairment to Date": c.goodwillImpairmentToDate,
        "Carrying Goodwill": r.carrying,
      };
    });
    exportToExcel(rows, "Combinations", "business-combinations-ifrs3");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" /> Business Combinations & Goodwill (IFRS 3)
          </h1>
          <p className="text-sm text-muted-foreground">
            Acquisition-method accounting: consideration transferred, identifiable net assets, NCI, and goodwill.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={!items.length}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button onClick={() => setItems(prev => [...prev, emptyCombination()])}>
            <Plus className="h-4 w-4 mr-2" /> Add Combination
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Consideration</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.consideration)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Net Identifiable Assets</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.netIdentifiable)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Non-Controlling Interest</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.nci)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Goodwill (gross)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-primary">{fmt(totals.goodwill)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Carrying Goodwill</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totals.carrying)}</div>
            <div className="text-xs text-muted-foreground">less {fmt(totals.impairment)} impairment</div></CardContent></Card>
      </div>

      {totals.bargainCount > 0 && (
        <Card className="border-amber-500/50">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
            <div className="text-sm">
              <b>{totals.bargainCount} bargain purchase(s) detected.</b> Per IFRS 3.36, reassess identification and
              measurement of assets acquired, liabilities assumed, NCI and consideration. Any excess remaining is
              recognised as a gain in profit or loss.
            </div>
          </CardContent>
        </Card>
      )}

      {items.map(c => {
        const r = computeGoodwill(c);
        const isBargain = r.goodwill < 0;
        return (
          <Card key={c.id}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {c.acquirerName || "Acquirer"} <span className="text-muted-foreground">acquires</span> {c.acquireeName || "Acquiree"}
                {isBargain
                  ? <Badge variant="destructive">Bargain purchase</Badge>
                  : <Badge>Goodwill: {fmt(r.goodwill)}</Badge>}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setItems(prev => prev.filter(x => x.id !== c.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><Label>Acquirer</Label><Input value={c.acquirerName} onChange={e => update(c.id, { acquirerName: e.target.value })} /></div>
                <div><Label>Acquiree</Label><Input value={c.acquireeName} onChange={e => update(c.id, { acquireeName: e.target.value })} /></div>
                <div><Label>Acquisition Date</Label><DateInput  value={c.acquisitionDate} onChange={e => update(c.id, { acquisitionDate: e.target.value })} /></div>
                <div><Label>Ownership %</Label><Input type="number" value={c.ownershipPct} onChange={e => update(c.id, { ownershipPct: +e.target.value })} /></div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Consideration Transferred (IFRS 3.37)</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div><Label>Cash Paid</Label><Input type="number" value={c.cashPaid} onChange={e => update(c.id, { cashPaid: +e.target.value })} /></div>
                  <div><Label>Equity Issued (FV)</Label><Input type="number" value={c.equityIssued} onChange={e => update(c.id, { equityIssued: +e.target.value })} /></div>
                  <div><Label>Contingent Consideration</Label><Input type="number" value={c.contingentConsideration} onChange={e => update(c.id, { contingentConsideration: +e.target.value })} /></div>
                  <div><Label>Total Consideration</Label><Input readOnly value={fmt(r.consideration)} /></div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Identifiable Net Assets at Fair Value (IFRS 3.18)</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div><Label>Tangible Assets (net)</Label><Input type="number" value={c.tangibleAssets} onChange={e => update(c.id, { tangibleAssets: +e.target.value })} /></div>
                  <div><Label>Identifiable Intangibles (FV)</Label><Input readOnly value={fmt(r.intangiblesFV)} /></div>
                  <div><Label>Assumed Liabilities</Label><Input type="number" value={c.assumedLiabilities} onChange={e => update(c.id, { assumedLiabilities: +e.target.value })} /></div>
                  <div><Label>Net Identifiable Assets</Label><Input readOnly value={fmt(r.netIdentifiable)} /></div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <Label>Identifiable Intangible Assets (IAS 38 recognition criteria)</Label>
                    <Button variant="outline" size="sm" onClick={() => addIntangible(c.id)}>
                      <Plus className="h-3 w-3 mr-1" /> Add
                    </Button>
                  </div>
                  {c.identifiableIntangibles.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name (e.g. Customer relationships, Brand, Technology)</TableHead>
                          <TableHead>Fair Value</TableHead>
                          <TableHead>Useful Life (years)</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {c.identifiableIntangibles.map(a => (
                          <TableRow key={a.id}>
                            <TableCell><Input value={a.name} onChange={e => updateIntangible(c.id, a.id, { name: e.target.value })} /></TableCell>
                            <TableCell><Input type="number" value={a.fairValue} onChange={e => updateIntangible(c.id, a.id, { fairValue: +e.target.value })} /></TableCell>
                            <TableCell><Input type="number" value={a.usefulLife} onChange={e => updateIntangible(c.id, a.id, { usefulLife: +e.target.value })} /></TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={() => removeIntangible(c.id, a.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Non-Controlling Interest (IFRS 3.19)</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label>NCI Measurement</Label>
                    <select
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={c.nciMeasurement}
                      onChange={e => update(c.id, { nciMeasurement: e.target.value as Combination["nciMeasurement"] })}
                    >
                      <option value="fair-value">Full FV method</option>
                      <option value="proportionate">Proportionate share of net assets</option>
                    </select>
                  </div>
                  {c.nciMeasurement === "fair-value" ? (
                    <div><Label>NCI Fair Value</Label><Input type="number" value={c.nciFairValue} onChange={e => update(c.id, { nciFairValue: +e.target.value })} /></div>
                  ) : (
                    <div><Label>NCI (proportionate)</Label><Input readOnly value={fmt(r.nci)} /></div>
                  )}
                  <div><Label>NCI Recognised</Label><Input readOnly value={fmt(r.nci)} /></div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Goodwill Calculation (IFRS 3.32)</h4>
                <div className="rounded-md border p-4 text-sm space-y-1 bg-muted/30">
                  <div className="flex justify-between"><span>Consideration transferred</span><span>{fmt(r.consideration)}</span></div>
                  <div className="flex justify-between"><span>+ Non-controlling interest</span><span>{fmt(r.nci)}</span></div>
                  <div className="flex justify-between"><span>− Net identifiable assets</span><span>({fmt(r.netIdentifiable)})</span></div>
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <span>{isBargain ? "Bargain purchase gain" : "Goodwill"}</span>
                    <span>{fmt(Math.abs(r.goodwill))}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" /> Goodwill Impairment (IAS 36)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>Cumulative Impairment</Label><Input type="number" value={c.goodwillImpairmentToDate} onChange={e => update(c.id, { goodwillImpairmentToDate: +e.target.value })} /></div>
                  <div><Label>Carrying Goodwill</Label><Input readOnly value={fmt(r.carrying)} /></div>
                  <div className="text-xs text-muted-foreground self-end pb-2">
                    Goodwill is not amortised; test annually and when indicators exist.
                  </div>
                </div>
              </div>

              <div>
                <Label>Notes / Disclosures (IFRS 3.B64)</Label>
                <Textarea rows={2} value={c.notes} onChange={e => update(c.id, { notes: e.target.value })} placeholder="Primary reasons for the combination, qualitative factors making up goodwill, etc." />
              </div>
            </CardContent>
          </Card>
        );
      })}

      {!items.length && (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No business combinations recorded. Click <b>Add Combination</b> to model an acquisition.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">IFRS 3 Reference</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p><b>Acquisition method (IFRS 3.4–5):</b> identify acquirer, determine acquisition date, recognise/measure identifiable assets, liabilities and NCI, and recognise goodwill or bargain purchase gain.</p>
          <p><b>Goodwill (IFRS 3.32):</b> consideration + NCI − net identifiable assets at fair value.</p>
          <p><b>NCI (IFRS 3.19):</b> measured at either fair value or the proportionate share of identifiable net assets, elected transaction-by-transaction.</p>
          <p><b>Bargain purchase (IFRS 3.34–36):</b> gain recognised in P&L only after reassessment.</p>
          <p><b>Subsequent measurement:</b> goodwill is not amortised (IAS 36); intangibles amortised over useful life; contingent consideration remeasured through P&L (financial liability) or not remeasured (equity).</p>
        </CardContent>
      </Card>
    </div>
  );
}
