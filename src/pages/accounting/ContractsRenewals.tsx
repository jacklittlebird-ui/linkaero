// Phase 2p: Contracts & Renewals Center
// - Lifecycle tracking, auto-renewal alerts, SLA compliance dashboard
import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, RefreshCw, AlertTriangle, ShieldCheck, FileClock, Plus } from "lucide-react";
import { format, differenceInDays, addYears, parseISO } from "date-fns";
import { exportToExcel } from "@/lib/exportExcel";
import { toast } from "sonner";

type Contract = {
  id: string;
  contract_no: string;
  airline: string;
  airline_iata: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  auto_renew: boolean;
  currency: string;
  annual_value: number | null;
  renewal_notice_days: number | null;
  sla_uptime_target: number | null;
  sla_response_hours: number | null;
  last_renewed_at: string | null;
  renewal_status: string | null;
  contract_type: string | null;
  stations: string | null;
  services: string | null;
};

type SLAIncident = {
  id: string;
  contract_id: string;
  incident_date: string;
  incident_type: string;
  severity: string;
  description: string | null;
  response_time_hours: number | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
};

type RenewalEvent = {
  id: string;
  contract_id: string;
  event_type: string;
  event_date: string;
  previous_end_date: string | null;
  new_end_date: string | null;
  notes: string | null;
  created_at: string;
};

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const INCIDENT_TYPES = ["uptime", "response_time", "quality", "delivery", "other"] as const;
const EVENT_TYPES = ["renewed", "extended", "terminated", "notice_sent", "negotiating"] as const;

export default function ContractsRenewals() {
  const qc = useQueryClient();
  const [horizonDays, setHorizonDays] = useState(90);
  const [selectedContractId, setSelectedContractId] = useState<string>("");
  const [incidentDialog, setIncidentDialog] = useState(false);
  const [renewDialog, setRenewDialog] = useState(false);

  const [incidentForm, setIncidentForm] = useState({
    contract_id: "",
    incident_date: format(new Date(), "yyyy-MM-dd"),
    incident_type: "uptime" as string,
    severity: "medium" as string,
    description: "",
    response_time_hours: "",
  });

  const [renewForm, setRenewForm] = useState({
    contract_id: "",
    event_type: "renewed" as string,
    event_date: format(new Date(), "yyyy-MM-dd"),
    new_end_date: "",
    notes: "",
  });

  const { data: contracts = [], isLoading: loadingContracts } = useQuery({
    queryKey: ["contracts-renewals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .order("end_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Contract[];
    },
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ["contract-sla-incidents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_sla_incidents")
        .select("*")
        .order("incident_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SLAIncident[];
    },
  });

  const { data: renewals = [] } = useQuery({
    queryKey: ["contract-renewal-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_renewal_events")
        .select("*")
        .order("event_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RenewalEvent[];
    },
  });

  const today = useMemo(() => new Date(), []);

  const enriched = useMemo(() => {
    return contracts.map((c) => {
      const end = c.end_date ? parseISO(c.end_date) : null;
      const daysToExpiry = end ? differenceInDays(end, today) : null;
      const contractIncidents = incidents.filter((i) => i.contract_id === c.id);
      const openIncidents = contractIncidents.filter((i) => !i.resolved).length;
      const totalIncidents = contractIncidents.length;
      const critical = contractIncidents.filter((i) => i.severity === "critical").length;
      const avgResponse = contractIncidents.length
        ? contractIncidents.reduce((s, i) => s + (i.response_time_hours || 0), 0) / contractIncidents.length
        : null;
      const slaMet =
        c.sla_response_hours == null || avgResponse == null
          ? null
          : avgResponse <= c.sla_response_hours;
      return { ...c, daysToExpiry, openIncidents, totalIncidents, critical, avgResponse, slaMet };
    });
  }, [contracts, incidents, today]);

  const upcoming = useMemo(() => {
    return enriched
      .filter((c) => c.daysToExpiry != null && c.daysToExpiry <= horizonDays && c.daysToExpiry >= -30)
      .sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));
  }, [enriched, horizonDays]);

  const kpis = useMemo(() => {
    const active = enriched.filter((c) => (c.status || "").toLowerCase() === "active").length;
    const expiring30 = enriched.filter((c) => c.daysToExpiry != null && c.daysToExpiry <= 30 && c.daysToExpiry >= 0).length;
    const expired = enriched.filter((c) => c.daysToExpiry != null && c.daysToExpiry < 0).length;
    const openIncidents = incidents.filter((i) => !i.resolved).length;
    return { active, expiring30, expired, openIncidents };
  }, [enriched, incidents]);

  const openIncident = (contractId = "") => {
    setIncidentForm({
      contract_id: contractId,
      incident_date: format(new Date(), "yyyy-MM-dd"),
      incident_type: "uptime",
      severity: "medium",
      description: "",
      response_time_hours: "",
    });
    setIncidentDialog(true);
  };

  const openRenew = (contract?: Contract) => {
    const nextEnd = contract?.end_date
      ? format(addYears(parseISO(contract.end_date), 1), "yyyy-MM-dd")
      : "";
    setRenewForm({
      contract_id: contract?.id ?? "",
      event_type: "renewed",
      event_date: format(new Date(), "yyyy-MM-dd"),
      new_end_date: nextEnd,
      notes: "",
    });
    setRenewDialog(true);
  };

  const createIncident = useMutation({
    mutationFn: async () => {
      if (!incidentForm.contract_id) throw new Error("Choose a contract");
      const { error } = await supabase.from("contract_sla_incidents").insert({
        contract_id: incidentForm.contract_id,
        incident_date: incidentForm.incident_date,
        incident_type: incidentForm.incident_type,
        severity: incidentForm.severity,
        description: incidentForm.description || null,
        response_time_hours: incidentForm.response_time_hours
          ? Number(incidentForm.response_time_hours)
          : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("SLA incident logged");
      setIncidentDialog(false);
      qc.invalidateQueries({ queryKey: ["contract-sla-incidents"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to log incident"),
  });

  const resolveIncident = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("contract_sla_incidents")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Incident resolved");
      qc.invalidateQueries({ queryKey: ["contract-sla-incidents"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const recordRenewal = useMutation({
    mutationFn: async () => {
      if (!renewForm.contract_id) throw new Error("Choose a contract");
      const contract = contracts.find((c) => c.id === renewForm.contract_id);
      const { error: evErr } = await supabase.from("contract_renewal_events").insert({
        contract_id: renewForm.contract_id,
        event_type: renewForm.event_type,
        event_date: renewForm.event_date,
        previous_end_date: contract?.end_date ?? null,
        new_end_date: renewForm.new_end_date || null,
        notes: renewForm.notes || null,
      });
      if (evErr) throw evErr;

      if (renewForm.event_type === "renewed" || renewForm.event_type === "extended") {
        const patch: {
          renewal_status: string;
          last_renewed_at: string;
          end_date?: string;
        } = {
          renewal_status: "renewed",
          last_renewed_at: renewForm.event_date,
        };
        if (renewForm.new_end_date) patch.end_date = renewForm.new_end_date;
        const { error: cErr } = await supabase
          .from("contracts")
          .update(patch)
          .eq("id", renewForm.contract_id);
        if (cErr) throw cErr;
      } else if (renewForm.event_type === "terminated") {
        const { error: cErr } = await supabase
          .from("contracts")
          .update({ status: "Terminated", renewal_status: "terminated" })
          .eq("id", renewForm.contract_id);
        if (cErr) throw cErr;
      } else if (renewForm.event_type === "notice_sent") {
        const { error: cErr } = await supabase
          .from("contracts")
          .update({ renewal_status: "notice_sent" })
          .eq("id", renewForm.contract_id);
        if (cErr) throw cErr;
      }
    },
    onSuccess: () => {
      toast.success("Renewal recorded");
      setRenewDialog(false);
      qc.invalidateQueries({ queryKey: ["contract-renewal-events"] });
      qc.invalidateQueries({ queryKey: ["contracts-renewals"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const exportUpcoming = () => {
    exportToExcel(
      upcoming.map((c) => ({
        Contract: c.contract_no,
        Airline: c.airline,
        End_Date: c.end_date ?? "",
        Days_To_Expiry: c.daysToExpiry ?? "",
        Auto_Renew: c.auto_renew ? "Yes" : "No",
        Notice_Days: c.renewal_notice_days ?? "",
        Annual_Value: c.annual_value ?? 0,
        Currency: c.currency,
        Renewal_Status: c.renewal_status ?? "",
      })),
      "Renewals",
      "contract_renewals"
    );
  };

  const exportSla = () => {
    exportToExcel(
      enriched.map((c) => ({
        Contract: c.contract_no,
        Airline: c.airline,
        SLA_Uptime_Target: c.sla_uptime_target ?? "",
        SLA_Response_Hours: c.sla_response_hours ?? "",
        Avg_Response_Hours: c.avgResponse ?? "",
        Incidents_Total: c.totalIncidents,
        Incidents_Open: c.openIncidents,
        Critical: c.critical,
        SLA_Compliance: c.slaMet == null ? "n/a" : c.slaMet ? "met" : "breached",
      })),
      "SLA",
      "contract_sla_dashboard"
    );
  };

  const contractLabel = (id: string) => {
    const c = contracts.find((x) => x.id === id);
    return c ? `${c.contract_no} — ${c.airline}` : id;
  };

  const severityBadge = (s: string) => {
    const color =
      s === "critical" ? "destructive"
      : s === "high" ? "default"
      : s === "medium" ? "secondary"
      : "outline";
    return <Badge variant={color as any}>{s}</Badge>;
  };

  const expiryBadge = (days: number | null) => {
    if (days == null) return <Badge variant="outline">no end date</Badge>;
    if (days < 0) return <Badge variant="destructive">expired {Math.abs(days)}d</Badge>;
    if (days <= 30) return <Badge variant="destructive">{days}d</Badge>;
    if (days <= 90) return <Badge variant="secondary">{days}d</Badge>;
    return <Badge variant="outline">{days}d</Badge>;
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Contracts & Renewals Center</h1>
          <p className="text-sm text-muted-foreground">
            Contract lifecycle, renewal alerts, and SLA compliance dashboard
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openIncident()}>
            <AlertTriangle className="w-4 h-4 mr-2" /> Log SLA Incident
          </Button>
          <Button onClick={() => openRenew()}>
            <RefreshCw className="w-4 h-4 mr-2" /> Record Renewal
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Active Contracts</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.active}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Expiring ≤ 30 days</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive">{kpis.expiring30}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Expired</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.expired}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Open SLA Incidents</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.openIncidents}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="renewals">
        <TabsList>
          <TabsTrigger value="renewals"><FileClock className="w-4 h-4 mr-2" />Renewal Pipeline</TabsTrigger>
          <TabsTrigger value="sla"><ShieldCheck className="w-4 h-4 mr-2" />SLA Dashboard</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="history">Renewal History</TabsTrigger>
        </TabsList>

        <TabsContent value="renewals" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Upcoming Renewals</CardTitle>
              <div className="flex items-center gap-2">
                <Label className="text-sm">Horizon (days)</Label>
                <Input
                  type="number" className="w-24" value={horizonDays}
                  onChange={(e) => setHorizonDays(Math.max(1, Number(e.target.value) || 0))}
                />
                <Button size="sm" variant="outline" onClick={exportUpcoming}>
                  <Download className="w-4 h-4 mr-2" />Export
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingContracts ? <div>Loading…</div> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract</TableHead>
                      <TableHead>Airline</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Auto-Renew</TableHead>
                      <TableHead>Notice</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcoming.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                        No renewals within horizon
                      </TableCell></TableRow>
                    ) : upcoming.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.contract_no}</TableCell>
                        <TableCell>{c.airline}</TableCell>
                        <TableCell>{c.end_date ? format(parseISO(c.end_date), "dd/MM/yyyy") : "—"}</TableCell>
                        <TableCell>{expiryBadge(c.daysToExpiry)}</TableCell>
                        <TableCell>{c.auto_renew ? <Badge>Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                        <TableCell>{c.renewal_notice_days ?? "—"} d</TableCell>
                        <TableCell>
                          {c.renewal_status ? <Badge variant="secondary">{c.renewal_status}</Badge> : <Badge variant="outline">—</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          {c.annual_value ? `${c.currency} ${Number(c.annual_value).toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => openRenew(c)}>Renew</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sla" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>SLA Compliance</CardTitle>
              <Button size="sm" variant="outline" onClick={exportSla}>
                <Download className="w-4 h-4 mr-2" />Export
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract</TableHead>
                    <TableHead>Airline</TableHead>
                    <TableHead className="text-right">Uptime Target</TableHead>
                    <TableHead className="text-right">Response SLA (h)</TableHead>
                    <TableHead className="text-right">Avg Response (h)</TableHead>
                    <TableHead className="text-right">Incidents</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead>Compliance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enriched.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.contract_no}</TableCell>
                      <TableCell>{c.airline}</TableCell>
                      <TableCell className="text-right">{c.sla_uptime_target ?? "—"}</TableCell>
                      <TableCell className="text-right">{c.sla_response_hours ?? "—"}</TableCell>
                      <TableCell className="text-right">{c.avgResponse != null ? c.avgResponse.toFixed(1) : "—"}</TableCell>
                      <TableCell className="text-right">{c.totalIncidents}</TableCell>
                      <TableCell className="text-right">{c.openIncidents}</TableCell>
                      <TableCell>
                        {c.slaMet == null
                          ? <Badge variant="outline">n/a</Badge>
                          : c.slaMet
                            ? <Badge>met</Badge>
                            : <Badge variant="destructive">breached</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incidents" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>SLA Incidents</CardTitle>
              <Button size="sm" onClick={() => openIncident()}><Plus className="w-4 h-4 mr-2" />Log</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Contract</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Response (h)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                      No incidents logged
                    </TableCell></TableRow>
                  ) : incidents.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{format(parseISO(i.incident_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{contractLabel(i.contract_id)}</TableCell>
                      <TableCell>{i.incident_type}</TableCell>
                      <TableCell>{severityBadge(i.severity)}</TableCell>
                      <TableCell>{i.response_time_hours ?? "—"}</TableCell>
                      <TableCell>
                        {i.resolved ? <Badge>resolved</Badge> : <Badge variant="destructive">open</Badge>}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{i.description ?? "—"}</TableCell>
                      <TableCell>
                        {!i.resolved && (
                          <Button size="sm" variant="outline" onClick={() => resolveIncident.mutate(i.id)}>
                            Resolve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Renewal History</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Contract</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Prev End</TableHead>
                    <TableHead>New End</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renewals.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                      No renewal events yet
                    </TableCell></TableRow>
                  ) : renewals.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{format(parseISO(r.event_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{contractLabel(r.contract_id)}</TableCell>
                      <TableCell><Badge variant="secondary">{r.event_type}</Badge></TableCell>
                      <TableCell>{r.previous_end_date ? format(parseISO(r.previous_end_date), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell>{r.new_end_date ? format(parseISO(r.new_end_date), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell className="max-w-md truncate">{r.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Incident Dialog */}
      <Dialog open={incidentDialog} onOpenChange={setIncidentDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log SLA Incident</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Contract</Label>
              <Select value={incidentForm.contract_id} onValueChange={(v) => setIncidentForm(f => ({ ...f, contract_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select contract" /></SelectTrigger>
                <SelectContent>
                  {contracts.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.contract_no} — {c.airline}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Incident Date</Label>
                <DateInput  value={incidentForm.incident_date}
                  onChange={(e) => setIncidentForm(f => ({ ...f, incident_date: e.target.value }))} />
              </div>
              <div>
                <Label>Response Time (hours)</Label>
                <Input type="number" step="0.1" value={incidentForm.response_time_hours}
                  onChange={(e) => setIncidentForm(f => ({ ...f, response_time_hours: e.target.value }))} />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={incidentForm.incident_type} onValueChange={(v) => setIncidentForm(f => ({ ...f, incident_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severity</Label>
                <Select value={incidentForm.severity} onValueChange={(v) => setIncidentForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={3} value={incidentForm.description}
                onChange={(e) => setIncidentForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidentDialog(false)}>Cancel</Button>
            <Button onClick={() => createIncident.mutate()} disabled={createIncident.isPending}>Log Incident</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renewal Dialog */}
      <Dialog open={renewDialog} onOpenChange={setRenewDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Renewal Event</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Contract</Label>
              <Select value={renewForm.contract_id} onValueChange={(v) => setRenewForm(f => ({ ...f, contract_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select contract" /></SelectTrigger>
                <SelectContent>
                  {contracts.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.contract_no} — {c.airline}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Event Type</Label>
                <Select value={renewForm.event_type} onValueChange={(v) => setRenewForm(f => ({ ...f, event_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Event Date</Label>
                <DateInput  value={renewForm.event_date}
                  onChange={(e) => setRenewForm(f => ({ ...f, event_date: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label>New End Date (renew / extend only)</Label>
                <DateInput  value={renewForm.new_end_date}
                  onChange={(e) => setRenewForm(f => ({ ...f, new_end_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={renewForm.notes}
                onChange={(e) => setRenewForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewDialog(false)}>Cancel</Button>
            <Button onClick={() => recordRenewal.mutate()} disabled={recordRenewal.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
