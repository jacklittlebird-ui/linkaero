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
import { CalendarClock, Plus, Trash2, Download, AlertTriangle } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

type EventNature = "adjusting" | "non_adjusting";
type Status = "identified" | "adjusted" | "disclosed" | "no_action";

type SubsequentEvent = {
  id: string;
  title: string;
  eventDate: string;
  nature: EventNature;
  status: Status;
  financialImpact: number;
  goingConcernAffected: boolean;
  description: string;
  managementAction: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const STORAGE_KEY = "ias10.events.v1";
const REP_KEY = "ias10.reporting.v1";
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const today = () => new Date().toISOString().slice(0, 10);

const emptyEvent = (): SubsequentEvent => ({
  id: uid(),
  title: "",
  eventDate: today(),
  nature: "adjusting",
  status: "identified",
  financialImpact: 0,
  goingConcernAffected: false,
  description: "",
  managementAction: "",
});

const NATURE_HINTS: Record<EventNature, string> = {
  adjusting: "Provides evidence of conditions existing at reporting date — adjust the FS (IAS 10.8)",
  non_adjusting: "Indicates conditions arising after reporting date — disclose if material (IAS 10.10)",
};

export default function EventsAfterReportingPage() {
  const [reportingDate, setReportingDate] = useState(today());
  const [authorisationDate, setAuthorisationDate] = useState(today());
  const [events, setEvents] = useState<SubsequentEvent[]>([]);

  useEffect(() => {
    try {
      const rep = localStorage.getItem(REP_KEY);
      if (rep) {
        const p = JSON.parse(rep);
        if (p?.reportingDate) setReportingDate(p.reportingDate);
        if (p?.authorisationDate) setAuthorisationDate(p.authorisationDate);
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setEvents(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem(REP_KEY, JSON.stringify({ reportingDate, authorisationDate }));
  }, [reportingDate, authorisationDate]);

  const update = (id: string, patch: Partial<SubsequentEvent>) =>
    setEvents((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const summary = useMemo(() => {
    let adjusting = 0, nonAdjusting = 0, adjImpact = 0, disclose = 0, gc = 0, outOfWindow = 0;
    const rd = new Date(reportingDate).getTime();
    const ad = new Date(authorisationDate).getTime();
    for (const e of events) {
      const ed = new Date(e.eventDate).getTime();
      const inWindow = ed >= rd && ed <= ad;
      if (!inWindow) outOfWindow += 1;
      if (e.nature === "adjusting") { adjusting += 1; adjImpact += e.financialImpact; }
      else nonAdjusting += 1;
      if (e.nature === "non_adjusting" && e.status !== "disclosed" && e.status !== "no_action") disclose += 1;
      if (e.goingConcernAffected) gc += 1;
    }
    return { adjusting, nonAdjusting, adjImpact, disclose, gc, outOfWindow };
  }, [events, reportingDate, authorisationDate]);

  const handleExport = () => {
    exportToExcel(
      events.map((e) => ({
        Title: e.title,
        "Event Date": e.eventDate,
        Nature: e.nature,
        Status: e.status,
        "Financial Impact": e.financialImpact,
        "Going Concern": e.goingConcernAffected ? "Yes" : "No",
        Description: e.description,
        "Management Action": e.managementAction,
      })),
      "IAS 10 Events",
      `ias10-events-${today()}`,
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CalendarClock className="w-7 h-7 text-primary" />
            Events After the Reporting Period
          </h1>
          <p className="text-muted-foreground">IAS 10 — Adjusting and non-adjusting events between reporting date and authorisation for issue</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}><Download className="w-4 h-4 mr-1" />Export</Button>
          <Button onClick={() => setEvents((x) => [...x, emptyEvent()])}><Plus className="w-4 h-4 mr-1" />Add Event</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Reporting Window</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Reporting Date</Label>
            <DateInput  value={reportingDate} onChange={(e) => setReportingDate(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">End of the reporting period</p>
          </div>
          <div>
            <Label>Authorisation for Issue</Label>
            <DateInput  value={authorisationDate} onChange={(e) => setAuthorisationDate(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Date financial statements are authorised for issue (IAS 10.17)</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Adjusting Events</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-primary">{summary.adjusting}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Non-Adjusting Events</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-amber-600">{summary.nonAdjusting}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Net Adjustment</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${summary.adjImpact >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(summary.adjImpact)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Pending Disclosure</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-rose-600">{summary.disclose}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Going Concern Flags</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-rose-600">{summary.gc}</div></CardContent></Card>
      </div>

      {summary.outOfWindow > 0 && (
        <div className="flex items-start gap-2 p-3 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
          <div>
            <strong>{summary.outOfWindow}</strong> event(s) fall outside the window between reporting date and authorisation date.
            IAS 10 applies only to events within that window — verify the dates.
          </div>
        </div>
      )}

      {summary.gc > 0 && (
        <div className="flex items-start gap-2 p-3 rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 text-sm">
          <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5" />
          <div>
            Going concern impact identified. Per IAS 10.14, an entity shall not prepare its financial statements on a going concern basis
            if management determines after the reporting period that it intends to liquidate the entity or cease trading.
          </div>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Events Register</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">Title</TableHead>
                  <TableHead>Event Date</TableHead>
                  <TableHead>Nature</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Impact</TableHead>
                  <TableHead className="text-center">Going Concern</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No events — click Add to begin</TableCell></TableRow>
                )}
                {events.map((e) => {
                  const rd = new Date(reportingDate).getTime();
                  const ad = new Date(authorisationDate).getTime();
                  const ed = new Date(e.eventDate).getTime();
                  const inWindow = ed >= rd && ed <= ad;
                  return (
                    <TableRow key={e.id}>
                      <TableCell><Input value={e.title} onChange={(v) => update(e.id, { title: v.target.value })} placeholder="e.g. Customer bankruptcy" /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <DateInput  className="w-36" value={e.eventDate} onChange={(v) => update(e.id, { eventDate: v.target.value })} />
                          {!inWindow && <Badge variant="destructive">Out of window</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select value={e.nature} onValueChange={(v) => update(e.id, { nature: v as EventNature })}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="adjusting">Adjusting</SelectItem>
                            <SelectItem value="non_adjusting">Non-Adjusting</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={e.status} onValueChange={(v) => update(e.id, { status: v as Status })}>
                          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="identified">Identified</SelectItem>
                            <SelectItem value="adjusted">Adjusted in FS</SelectItem>
                            <SelectItem value="disclosed">Disclosed in Notes</SelectItem>
                            <SelectItem value="no_action">No Action Required</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input type="number" className="w-28" value={e.financialImpact} onChange={(v) => update(e.id, { financialImpact: Number(v.target.value) || 0 })} /></TableCell>
                      <TableCell className="text-center">
                        <input type="checkbox" checked={e.goingConcernAffected} onChange={(v) => update(e.id, { goingConcernAffected: v.target.checked })} />
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => setEvents((xs) => xs.filter((x) => x.id !== e.id))}>
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
        <CardHeader><CardTitle>Description & Management Response</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {events.length === 0 && <p className="text-muted-foreground text-sm">No events to describe.</p>}
          {events.map((e) => (
            <div key={e.id} className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded p-3">
              <div className="md:col-span-2 flex items-center justify-between">
                <div className="font-medium">{e.title || "(untitled)"}</div>
                <Badge variant={e.nature === "adjusting" ? "default" : "secondary"}>{e.nature === "adjusting" ? "Adjusting" : "Non-Adjusting"}</Badge>
              </div>
              <div className="md:col-span-2 text-xs text-muted-foreground">{NATURE_HINTS[e.nature]}</div>
              <div>
                <Label>Description</Label>
                <Textarea rows={3} value={e.description} onChange={(v) => update(e.id, { description: v.target.value })} placeholder="Nature and estimated financial effect" />
              </div>
              <div>
                <Label>Management Action</Label>
                <Textarea rows={3} value={e.managementAction} onChange={(v) => update(e.id, { managementAction: v.target.value })} placeholder="Adjustments made and/or disclosure wording" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Common Examples</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Badge className="mb-1">Adjusting (IAS 10.9)</Badge>
            <ul className="list-disc list-inside space-y-1">
              <li>Settlement of a court case confirming a present obligation at year-end</li>
              <li>Bankruptcy of a customer confirming impairment of receivables</li>
              <li>Sale of inventory below cost indicating NRV at year-end</li>
              <li>Discovery of fraud or errors showing FS were incorrect</li>
            </ul>
          </div>
          <div>
            <Badge variant="secondary" className="mb-1">Non-Adjusting (IAS 10.22)</Badge>
            <ul className="list-disc list-inside space-y-1">
              <li>Major business combination or disposal after year-end</li>
              <li>Significant decline in market value of investments</li>
              <li>Dividends declared after reporting date (IAS 10.12)</li>
              <li>Natural disaster or major litigation commencing post year-end</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
