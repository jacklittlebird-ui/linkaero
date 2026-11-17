import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Landmark, Plus, Trash2, Download } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

type GrantType = "asset_related" | "income_related";
type Presentation = "deferred_income" | "reduce_asset" | "other_income" | "reduce_expense";

type Grant = {
  id: string;
  name: string;
  grantor: string;
  type: GrantType;
  presentation: Presentation;
  amount: number;
  grantDate: string;
  recognitionStart: string;
  recognitionEnd: string;
  reportingDate: string;
  conditionsMet: boolean;
  repaymentRequired: boolean;
  repaymentAmount: number;
  notes: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const STORAGE_KEY = "gov-grants.v1";
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const today = () => new Date().toISOString().slice(0, 10);

const empty = (): Grant => ({
  id: uid(),
  name: "",
  grantor: "",
  type: "asset_related",
  presentation: "deferred_income",
  amount: 0,
  grantDate: today(),
  recognitionStart: today(),
  recognitionEnd: today(),
  reportingDate: today(),
  conditionsMet: true,
  repaymentRequired: false,
  repaymentAmount: 0,
  notes: "",
});

function computeRecognition(g: Grant) {
  const start = new Date(g.recognitionStart).getTime();
  const end = new Date(g.recognitionEnd).getTime();
  const rpt = new Date(g.reportingDate).getTime();
  const totalDays = Math.max(1, (end - start) / 86400000);
  const elapsed = Math.max(0, Math.min(totalDays, (rpt - start) / 86400000));
  const pct = elapsed / totalDays;
  const netAmount = g.amount - (g.repaymentRequired ? g.repaymentAmount : 0);
  const recognized = g.conditionsMet ? netAmount * pct : 0;
  const deferred = Math.max(0, netAmount - recognized);
  return { pct, netAmount, recognized, deferred };
}

const PRESENTATION_LABEL: Record<Presentation, string> = {
  deferred_income: "Deferred Income (SoFP liability)",
  reduce_asset: "Deducted from Asset Cost",
  other_income: "Other Income (P&L)",
  reduce_expense: "Deducted from Related Expense",
};

export default function GovernmentGrantsPage() {
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
    let gross = 0, recognized = 0, deferred = 0, repay = 0;
    for (const g of grants) {
      const r = computeRecognition(g);
      gross += g.amount;
      recognized += r.recognized;
      deferred += r.deferred;
      if (g.repaymentRequired) repay += g.repaymentAmount;
    }
    return { gross, recognized, deferred, repay };
  }, [grants]);

  const handleExport = () => {
    exportToExcel(
      grants.map((g) => {
        const r = computeRecognition(g);
        return {
          Grant: g.name,
          Grantor: g.grantor,
          Type: g.type,
          Presentation: PRESENTATION_LABEL[g.presentation],
          Amount: g.amount,
          "Grant Date": g.grantDate,
          "Recog. Start": g.recognitionStart,
          "Recog. End": g.recognitionEnd,
          "Conditions Met": g.conditionsMet ? "Yes" : "No",
          Repayment: g.repaymentRequired ? g.repaymentAmount : 0,
          "% Recognized": (r.pct * 100).toFixed(2),
          Recognized: r.recognized.toFixed(2),
          Deferred: r.deferred.toFixed(2),
          Notes: g.notes,
        };
      }),
      "Government Grants",
      `government-grants-${today()}`,
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Landmark className="w-7 h-7 text-primary" />
            Government Grants
          </h1>
          <p className="text-muted-foreground">IAS 20 — Recognition, presentation and repayment of government assistance</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}><Download className="w-4 h-4 mr-1" />Export</Button>
          <Button onClick={() => setGrants((x) => [...x, empty()])}><Plus className="w-4 h-4 mr-1" />Add Grant</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Grants Received</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(totals.gross)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Recognized in P&L</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-primary">{fmt(totals.recognized)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Deferred Income</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-amber-600">{fmt(totals.deferred)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Repayment Obligation</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-rose-600">{fmt(totals.repay)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Grants Register</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[140px]">Grant</TableHead>
                  <TableHead>Grantor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Presentation</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Recog. Start</TableHead>
                  <TableHead>Recog. End</TableHead>
                  <TableHead>Reporting Date</TableHead>
                  <TableHead className="text-center">Conditions</TableHead>
                  <TableHead className="text-right">Repayment</TableHead>
                  <TableHead className="text-right">Recognized</TableHead>
                  <TableHead className="text-right">Deferred</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.length === 0 && (
                  <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground">No grants — click Add to begin</TableCell></TableRow>
                )}
                {grants.map((g) => {
                  const r = computeRecognition(g);
                  return (
                    <TableRow key={g.id}>
                      <TableCell><Input value={g.name} onChange={(e) => update(g.id, { name: e.target.value })} placeholder="e.g. Aviation subsidy" /></TableCell>
                      <TableCell><Input value={g.grantor} onChange={(e) => update(g.id, { grantor: e.target.value })} placeholder="Ministry / Authority" /></TableCell>
                      <TableCell>
                        <Select value={g.type} onValueChange={(v) => update(g.id, { type: v as GrantType })}>
                          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="asset_related">Asset-related</SelectItem>
                            <SelectItem value="income_related">Income-related</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={g.presentation} onValueChange={(v) => update(g.id, { presentation: v as Presentation })}>
                          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="deferred_income">Deferred Income</SelectItem>
                            <SelectItem value="reduce_asset">Reduce Asset Cost</SelectItem>
                            <SelectItem value="other_income">Other Income (P&L)</SelectItem>
                            <SelectItem value="reduce_expense">Reduce Related Expense</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input type="number" className="w-28" value={g.amount} onChange={(e) => update(g.id, { amount: Number(e.target.value) || 0 })} /></TableCell>
                      <TableCell><DateInput  className="w-36" value={g.recognitionStart} onChange={(e) => update(g.id, { recognitionStart: e.target.value })} /></TableCell>
                      <TableCell><DateInput  className="w-36" value={g.recognitionEnd} onChange={(e) => update(g.id, { recognitionEnd: e.target.value })} /></TableCell>
                      <TableCell><DateInput  className="w-36" value={g.reportingDate} onChange={(e) => update(g.id, { reportingDate: e.target.value })} /></TableCell>
                      <TableCell className="text-center">
                        <input type="checkbox" checked={g.conditionsMet} onChange={(e) => update(g.id, { conditionsMet: e.target.checked })} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <input type="checkbox" checked={g.repaymentRequired} onChange={(e) => update(g.id, { repaymentRequired: e.target.checked })} />
                          {g.repaymentRequired && (
                            <Input type="number" className="w-24" value={g.repaymentAmount} onChange={(e) => update(g.id, { repaymentAmount: Number(e.target.value) || 0 })} />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-primary">{fmt(r.recognized)}</TableCell>
                      <TableCell className="text-right font-medium text-amber-600">{fmt(r.deferred)}</TableCell>
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
        <CardHeader><CardTitle>Guidance & Suggested Journal Entries</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-3">
          <div>
            <Badge className="mb-1">On receipt (Deferred Income method)</Badge>
            <div className="pl-2 space-y-1">
              <div className="flex justify-between"><span>Dr Cash / Bank</span><span className="font-mono">{fmt(totals.gross)}</span></div>
              <div className="flex justify-between pl-6 text-muted-foreground"><span>Cr Deferred grant income (liability)</span><span className="font-mono">{fmt(totals.gross)}</span></div>
            </div>
          </div>
          <div>
            <Badge variant="secondary" className="mb-1">Periodic recognition</Badge>
            <div className="pl-2 space-y-1">
              <div className="flex justify-between"><span>Dr Deferred grant income</span><span className="font-mono">{fmt(totals.recognized)}</span></div>
              <div className="flex justify-between pl-6 text-muted-foreground"><span>Cr Other income / Reduce depreciation / Reduce expense</span><span className="font-mono">{fmt(totals.recognized)}</span></div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-2">
            Grants are recognised only when there is reasonable assurance that the entity will comply with the conditions attached
            and the grants will be received (IAS 20.7). Grants related to income may be presented as other income or deducted from the
            related expense. Grants related to assets may be presented as deferred income or deducted in arriving at the asset's
            carrying amount (IAS 20.24). Repayments are accounted for as a change in accounting estimate (IAS 20.32).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
