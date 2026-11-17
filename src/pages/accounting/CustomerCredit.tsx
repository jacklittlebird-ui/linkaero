import { useEffect, useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ShieldCheck, TrendingUp, Users } from "lucide-react";

type Airline = { id: string; name: string; iata_code?: string | null };
type Profile = {
  id: string;
  airline_id: string;
  credit_limit: number;
  currency: string;
  payment_terms_days: number;
  credit_rating: string;
  risk_category: string;
  on_hold: boolean;
  hold_reason: string | null;
  last_review_date: string | null;
  next_review_date: string | null;
  notes: string | null;
};
type Exposure = {
  airline_id: string;
  credit_limit: number;
  currency: string;
  outstanding: number;
  overdue: number;
  available: number;
  utilization_pct: number;
  on_hold: boolean;
};

const RATINGS = ["A+", "A", "B", "C", "D"];
const RISKS = ["low", "medium", "high", "blocked"];

export default function CustomerCredit() {
  const { toast } = useToast();
  const [airlines, setAirlines] = useState<Airline[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [exposures, setExposures] = useState<Record<string, Exposure>>({});
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Profile> & { airline_id?: string }>({});
  const [events, setEvents] = useState<any[]>([]);
  const [eventsFor, setEventsFor] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: al }, { data: pr }] = await Promise.all([
      supabase.from("airlines").select("id, name, iata_code").order("name"),
      supabase.from("customer_credit_profiles").select("*"),
    ]);
    setAirlines(al || []);
    setProfiles(pr || []);
    // Fetch exposures for each profile
    const exp: Record<string, Exposure> = {};
    await Promise.all(
      (pr || []).map(async (p: Profile) => {
        const { data } = await supabase.rpc("get_customer_credit_exposure", { _airline_id: p.airline_id });
        if (data && data[0]) exp[p.airline_id] = data[0] as Exposure;
      })
    );
    setExposures(exp);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const list = Object.values(exposures);
    return {
      customers: profiles.length,
      onHold: profiles.filter((p) => p.on_hold).length,
      exposure: list.reduce((s, e) => s + Number(e.outstanding || 0), 0),
      overdue: list.reduce((s, e) => s + Number(e.overdue || 0), 0),
      breaches: list.filter((e) => e.credit_limit > 0 && e.outstanding > e.credit_limit).length,
    };
  }, [exposures, profiles]);

  const airlineName = (id: string) => airlines.find((a) => a.id === id)?.name || "—";

  function openNew() {
    setEditing({
      credit_limit: 0,
      currency: "USD",
      payment_terms_days: 30,
      credit_rating: "B",
      risk_category: "medium",
      on_hold: false,
    });
    setEditOpen(true);
  }
  function openEdit(p: Profile) {
    setEditing(p);
    setEditOpen(true);
  }

  async function save() {
    if (!editing.airline_id) {
      toast({ title: "Select an airline", variant: "destructive" });
      return;
    }
    const payload: any = {
      airline_id: editing.airline_id,
      credit_limit: Number(editing.credit_limit) || 0,
      currency: editing.currency || "USD",
      payment_terms_days: Number(editing.payment_terms_days) || 30,
      credit_rating: editing.credit_rating || "B",
      risk_category: editing.risk_category || "medium",
      on_hold: !!editing.on_hold,
      hold_reason: editing.hold_reason || null,
      last_review_date: editing.last_review_date || null,
      next_review_date: editing.next_review_date || null,
      notes: editing.notes || null,
    };
    const prev = profiles.find((p) => p.airline_id === editing.airline_id);
    const { error } = prev
      ? await supabase.from("customer_credit_profiles").update(payload).eq("id", (editing as any).id)
      : await supabase.from("customer_credit_profiles").insert(payload);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    // Log event
    if (prev && Number(prev.credit_limit) !== payload.credit_limit) {
      await supabase.from("customer_credit_events").insert({
        profile_id: prev.id,
        event_type: "limit_change",
        previous_value: String(prev.credit_limit),
        new_value: String(payload.credit_limit),
      });
    }
    if (prev && prev.on_hold !== payload.on_hold) {
      await supabase.from("customer_credit_events").insert({
        profile_id: prev.id,
        event_type: payload.on_hold ? "hold" : "release",
        reason: payload.hold_reason || null,
      });
    }
    toast({ title: "Saved" });
    setEditOpen(false);
    load();
  }

  async function viewEvents(profileId: string) {
    setEventsFor(profileId);
    const { data } = await supabase
      .from("customer_credit_events")
      .select("*")
      .eq("profile_id", profileId)
      .order("event_date", { ascending: false });
    setEvents(data || []);
  }

  const breaches = Object.values(exposures).filter(
    (e) => e.credit_limit > 0 && (e.outstanding > e.credit_limit || e.overdue > 0)
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customer Credit Management</h1>
          <p className="text-sm text-muted-foreground">Credit limits, exposure, holds and risk monitoring</p>
        </div>
        <Button onClick={openNew}>Add Credit Profile</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi icon={<Users className="h-4 w-4" />} label="Customers" value={String(totals.customers)} />
        <Kpi icon={<ShieldCheck className="h-4 w-4" />} label="On Hold" value={String(totals.onHold)} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Outstanding" value={totals.exposure.toLocaleString()} />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Overdue" value={totals.overdue.toLocaleString()} tone="warn" />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Limit Breaches" value={String(totals.breaches)} tone="danger" />
      </div>

      <Tabs defaultValue="profiles">
        <TabsList>
          <TabsTrigger value="profiles">Credit Profiles</TabsTrigger>
          <TabsTrigger value="alerts">Alerts & Breaches</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles">
          <Card>
            <CardHeader>
              <CardTitle>Profiles</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Airline</TableHead>
                    <TableHead>Limit</TableHead>
                    <TableHead>Outstanding</TableHead>
                    <TableHead>Available</TableHead>
                    <TableHead>Util %</TableHead>
                    <TableHead>Overdue</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={10}>Loading…</TableCell></TableRow>
                  ) : profiles.length === 0 ? (
                    <TableRow><TableCell colSpan={10}>No profiles yet.</TableCell></TableRow>
                  ) : profiles.map((p) => {
                    const e = exposures[p.airline_id];
                    const util = e?.utilization_pct ?? 0;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{airlineName(p.airline_id)}</TableCell>
                        <TableCell>{Number(p.credit_limit).toLocaleString()} {p.currency}</TableCell>
                        <TableCell>{Number(e?.outstanding || 0).toLocaleString()}</TableCell>
                        <TableCell>{Number(e?.available || 0).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={util > 100 ? "destructive" : util > 80 ? "secondary" : "outline"}>
                            {util}%
                          </Badge>
                        </TableCell>
                        <TableCell>{Number(e?.overdue || 0).toLocaleString()}</TableCell>
                        <TableCell><Badge variant="outline">{p.credit_rating}</Badge></TableCell>
                        <TableCell><Badge variant={p.risk_category === "blocked" || p.risk_category === "high" ? "destructive" : "secondary"}>{p.risk_category}</Badge></TableCell>
                        <TableCell>
                          {p.on_hold ? <Badge variant="destructive">On Hold</Badge> : <Badge variant="outline">Active</Badge>}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button size="sm" variant="ghost" onClick={() => viewEvents(p.id)}>History</Button>
                          <Button size="sm" variant="outline" onClick={() => openEdit(p)}>Edit</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>Credit Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              {breaches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active credit alerts.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Airline</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Limit</TableHead>
                      <TableHead>Outstanding</TableHead>
                      <TableHead>Overdue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breaches.map((e) => (
                      <TableRow key={e.airline_id}>
                        <TableCell>{airlineName(e.airline_id)}</TableCell>
                        <TableCell>
                          {e.outstanding > e.credit_limit ? (
                            <Badge variant="destructive">Limit Breach</Badge>
                          ) : (
                            <Badge variant="secondary">Overdue</Badge>
                          )}
                        </TableCell>
                        <TableCell>{Number(e.credit_limit).toLocaleString()}</TableCell>
                        <TableCell>{Number(e.outstanding).toLocaleString()}</TableCell>
                        <TableCell>{Number(e.overdue).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{(editing as any).id ? "Edit" : "New"} Credit Profile</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Airline</Label>
              <Select value={editing.airline_id || ""} onValueChange={(v) => setEditing({ ...editing, airline_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select airline" /></SelectTrigger>
                <SelectContent>
                  {airlines.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Credit Limit</Label>
              <Input type="number" value={editing.credit_limit ?? 0} onChange={(e) => setEditing({ ...editing, credit_limit: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Currency</Label>
              <Input value={editing.currency || "USD"} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} />
            </div>
            <div>
              <Label>Payment Terms (days)</Label>
              <Input type="number" value={editing.payment_terms_days ?? 30} onChange={(e) => setEditing({ ...editing, payment_terms_days: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Credit Rating</Label>
              <Select value={editing.credit_rating || "B"} onValueChange={(v) => setEditing({ ...editing, credit_rating: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RATINGS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Risk Category</Label>
              <Select value={editing.risk_category || "medium"} onValueChange={(v) => setEditing({ ...editing, risk_category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RISKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <Label>On Credit Hold</Label>
                <p className="text-xs text-muted-foreground">Blocks new invoices</p>
              </div>
              <Switch checked={!!editing.on_hold} onCheckedChange={(v) => setEditing({ ...editing, on_hold: v })} />
            </div>
            <div>
              <Label>Next Review Date</Label>
              <DateInput  value={editing.next_review_date || ""} onChange={(e) => setEditing({ ...editing, next_review_date: e.target.value })} />
            </div>
            {editing.on_hold && (
              <div className="col-span-2">
                <Label>Hold Reason</Label>
                <Input value={editing.hold_reason || ""} onChange={(e) => setEditing({ ...editing, hold_reason: e.target.value })} />
              </div>
            )}
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!eventsFor} onOpenChange={(o) => !o && setEventsFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Credit History</DialogTitle></DialogHeader>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Event</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Reason</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell>{new Date(ev.event_date).toLocaleDateString("en-GB")}</TableCell>
                    <TableCell><Badge variant="outline">{ev.event_type}</Badge></TableCell>
                    <TableCell>{ev.previous_value || "—"}</TableCell>
                    <TableCell>{ev.new_value || "—"}</TableCell>
                    <TableCell>{ev.reason || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "warn" | "danger" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-600" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
