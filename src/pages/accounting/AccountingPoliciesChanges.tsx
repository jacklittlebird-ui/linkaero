import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BookOpenCheck, Plus, Trash2, Download } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

type EntryType = "policy_change" | "estimate_change" | "prior_period_error";
type Treatment = "retrospective" | "prospective" | "retrospective_restatement";
type MaterialityLevel = "material" | "not_material";

type Entry = {
  id: string;
  title: string;
  entryType: EntryType;
  treatment: Treatment;
  effectiveDate: string;
  standardRef: string;         // e.g. IFRS 16, IAS 8
  description: string;
  reason: string;
  materiality: MaterialityLevel;
  // Financial impact
  impactCurrentYear: number;
  impactPriorYear: number;
  impactRetainedEarnings: number;
  disclosureComplete: boolean;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const STORAGE_KEY = "ias8.entries.v1";
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const today = () => new Date().toISOString().slice(0, 10);

const empty = (): Entry => ({
  id: uid(),
  title: "",
  entryType: "policy_change",
  treatment: "retrospective",
  effectiveDate: today(),
  standardRef: "",
  description: "",
  reason: "",
  materiality: "material",
  impactCurrentYear: 0,
  impactPriorYear: 0,
  impactRetainedEarnings: 0,
  disclosureComplete: false,
});

const TYPE_LABEL: Record<EntryType, string> = {
  policy_change: "Change in Accounting Policy",
  estimate_change: "Change in Accounting Estimate",
  prior_period_error: "Prior Period Error",
};

const TREATMENT_LABEL: Record<Treatment, string> = {
  retrospective: "Retrospective Application",
  prospective: "Prospective Application",
  retrospective_restatement: "Retrospective Restatement",
};

// Recommended IAS 8 treatment per entry type
const RECOMMENDED: Record<EntryType, Treatment> = {
  policy_change: "retrospective",           // IAS 8.19
  estimate_change: "prospective",           // IAS 8.36
  prior_period_error: "retrospective_restatement", // IAS 8.42
};

export default function AccountingPoliciesChangesPage() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setEntries(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  const update = (id: string, patch: Partial<Entry>) =>
    setEntries((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const totals = useMemo(() => {
    let current = 0, prior = 0, re = 0, misaligned = 0, pendingDisc = 0;
    for (const e of entries) {
      current += e.impactCurrentYear;
      prior += e.impactPriorYear;
      re += e.impactRetainedEarnings;
      if (RECOMMENDED[e.entryType] !== e.treatment) misaligned += 1;
      if (e.materiality === "material" && !e.disclosureComplete) pendingDisc += 1;
    }
    return { current, prior, re, misaligned, pendingDisc };
  }, [entries]);

  const handleExport = () => {
    exportToExcel(
      entries.map((e) => ({
        Title: e.title,
        Type: TYPE_LABEL[e.entryType],
        Treatment: TREATMENT_LABEL[e.treatment],
        "Effective Date": e.effectiveDate,
        Standard: e.standardRef,
        Materiality: e.materiality,
        "Impact Current Year": e.impactCurrentYear,
        "Impact Prior Year": e.impactPriorYear,
        "Impact Retained Earnings": e.impactRetainedEarnings,
        "Disclosure Complete": e.disclosureComplete ? "Yes" : "No",
        Description: e.description,
        Reason: e.reason,
      })),
      "IAS 8 Register",
      `ias8-register-${today()}`,
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BookOpenCheck className="w-7 h-7 text-primary" />
            Accounting Policies, Changes & Errors
          </h1>
          <p className="text-muted-foreground">IAS 8 — Register of policy changes, estimate revisions and prior-period errors</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}><Download className="w-4 h-4 mr-1" />Export</Button>
          <Button onClick={() => setEntries((x) => [...x, empty()])}><Plus className="w-4 h-4 mr-1" />Add Entry</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Impact — Current Year</CardTitle></CardHeader><CardContent><div className={`text-xl font-bold ${totals.current >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(totals.current)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Impact — Prior Year</CardTitle></CardHeader><CardContent><div className={`text-xl font-bold ${totals.prior >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(totals.prior)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Impact — Retained Earnings</CardTitle></CardHeader><CardContent><div className={`text-xl font-bold ${totals.re >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(totals.re)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Treatment Mismatch</CardTitle></CardHeader><CardContent><div className="text-xl font-bold text-amber-600">{totals.misaligned}</div><p className="text-xs text-muted-foreground">vs IAS 8 recommendation</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Pending Disclosures</CardTitle></CardHeader><CardContent><div className="text-xl font-bold text-rose-600">{totals.pendingDisc}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Register</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Treatment</TableHead>
                  <TableHead>Standard</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Materiality</TableHead>
                  <TableHead className="text-right">Current Yr</TableHead>
                  <TableHead className="text-right">Prior Yr</TableHead>
                  <TableHead className="text-right">Retained Earnings</TableHead>
                  <TableHead className="text-center">Disclosure</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">No entries — click Add to begin</TableCell></TableRow>
                )}
                {entries.map((e) => {
                  const mismatch = RECOMMENDED[e.entryType] !== e.treatment;
                  return (
                    <TableRow key={e.id}>
                      <TableCell><Input value={e.title} onChange={(v) => update(e.id, { title: v.target.value })} placeholder="e.g. Adopt IFRS 16" /></TableCell>
                      <TableCell>
                        <Select value={e.entryType} onValueChange={(v) => update(e.id, { entryType: v as EntryType })}>
                          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="policy_change">Policy Change</SelectItem>
                            <SelectItem value="estimate_change">Estimate Change</SelectItem>
                            <SelectItem value="prior_period_error">Prior Period Error</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Select value={e.treatment} onValueChange={(v) => update(e.id, { treatment: v as Treatment })}>
                            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="retrospective">Retrospective Application</SelectItem>
                              <SelectItem value="retrospective_restatement">Retrospective Restatement</SelectItem>
                              <SelectItem value="prospective">Prospective Application</SelectItem>
                            </SelectContent>
                          </Select>
                          {mismatch && <Badge variant="destructive" className="whitespace-nowrap">Review</Badge>}
                        </div>
                      </TableCell>
                      <TableCell><Input className="w-28" value={e.standardRef} onChange={(v) => update(e.id, { standardRef: v.target.value })} placeholder="IFRS 16" /></TableCell>
                      <TableCell><DateInput  className="w-36" value={e.effectiveDate} onChange={(v) => update(e.id, { effectiveDate: v.target.value })} /></TableCell>
                      <TableCell>
                        <Select value={e.materiality} onValueChange={(v) => update(e.id, { materiality: v as MaterialityLevel })}>
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="material">Material</SelectItem>
                            <SelectItem value="not_material">Not Material</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input type="number" className="w-28" value={e.impactCurrentYear} onChange={(v) => update(e.id, { impactCurrentYear: Number(v.target.value) || 0 })} /></TableCell>
                      <TableCell><Input type="number" className="w-28" value={e.impactPriorYear} onChange={(v) => update(e.id, { impactPriorYear: Number(v.target.value) || 0 })} /></TableCell>
                      <TableCell><Input type="number" className="w-28" value={e.impactRetainedEarnings} onChange={(v) => update(e.id, { impactRetainedEarnings: Number(v.target.value) || 0 })} /></TableCell>
                      <TableCell className="text-center">
                        <input type="checkbox" checked={e.disclosureComplete} onChange={(v) => update(e.id, { disclosureComplete: v.target.checked })} />
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => setEntries((xs) => xs.filter((x) => x.id !== e.id))}>
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
        <CardHeader><CardTitle>Description & Reason</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {entries.length === 0 && <p className="text-muted-foreground text-sm">No entries to describe.</p>}
          {entries.map((e) => (
            <div key={e.id} className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded p-3">
              <div className="md:col-span-2 font-medium">{e.title || "(untitled)"} — <span className="text-muted-foreground text-sm">{TYPE_LABEL[e.entryType]}</span></div>
              <div>
                <Label>Nature of change / error</Label>
                <Textarea rows={3} value={e.description} onChange={(v) => update(e.id, { description: v.target.value })} placeholder="Describe the change and the amount involved" />
              </div>
              <div>
                <Label>Reason (why the new treatment provides reliable & more relevant information)</Label>
                <Textarea rows={3} value={e.reason} onChange={(v) => update(e.id, { reason: v.target.value })} placeholder="IAS 8.14(b) rationale" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Guidance</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p><strong>IAS 8.19</strong> — Voluntary changes in accounting policy and changes required by a new IFRS with no specific transition provisions: apply <em>retrospectively</em>.</p>
          <p><strong>IAS 8.36</strong> — Changes in accounting estimates are recognised <em>prospectively</em> in the period of change and future periods affected.</p>
          <p><strong>IAS 8.42</strong> — Material prior-period errors are corrected by <em>retrospective restatement</em>, adjusting comparatives and opening retained earnings.</p>
          <p><strong>IAS 8.28-31 / .49</strong> — Disclose the nature, reasons, amount of adjustments per line item, and effect on EPS where applicable.</p>
        </CardContent>
      </Card>
    </div>
  );
}
