import { useState, useMemo, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, Trash2 } from "lucide-react";

type Obligation = {
  id: string;
  description: string;
  ssp: number; // standalone selling price
  recognition: "point_in_time" | "over_time";
  startDate: string;
  endDate: string;
  percentComplete: number; // 0-100 for over_time
  delivered: boolean; // for point_in_time
};

type Contract = {
  id: string;
  customer: string;
  contractNo: string;
  contractDate: string;
  transactionPrice: number;
  obligations: Obligation[];
};

const STORAGE_KEY = "rev-rec.contracts.v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const today = () => new Date().toISOString().slice(0, 10);

const emptyObligation = (): Obligation => ({
  id: uid(),
  description: "",
  ssp: 0,
  recognition: "over_time",
  startDate: today(),
  endDate: today(),
  percentComplete: 0,
  delivered: false,
});

const emptyContract = (): Contract => ({
  id: uid(),
  customer: "",
  contractNo: "",
  contractDate: today(),
  transactionPrice: 0,
  obligations: [emptyObligation()],
});

export default function RevenueRecognitionPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setContracts(parsed);
          if (parsed[0]) setActiveId(parsed[0].id);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts));
  }, [contracts]);

  const active = contracts.find((c) => c.id === activeId) || null;

  const updateActive = (patch: Partial<Contract>) => {
    if (!active) return;
    setContracts((cs) => cs.map((c) => (c.id === active.id ? { ...c, ...patch } : c)));
  };

  const updateObligation = (obId: string, patch: Partial<Obligation>) => {
    if (!active) return;
    setContracts((cs) =>
      cs.map((c) =>
        c.id === active.id
          ? { ...c, obligations: c.obligations.map((o) => (o.id === obId ? { ...o, ...patch } : o)) }
          : c,
      ),
    );
  };

  const addContract = () => {
    const c = emptyContract();
    setContracts((cs) => [...cs, c]);
    setActiveId(c.id);
  };

  const deleteContract = (id: string) => {
    setContracts((cs) => cs.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const totalSsp = active ? active.obligations.reduce((s, o) => s + Number(o.ssp || 0), 0) : 0;

  const allocations = useMemo(() => {
    if (!active || totalSsp <= 0) return [] as Array<Obligation & { allocated: number; recognized: number; deferred: number }>;
    return active.obligations.map((o) => {
      const allocated = active.transactionPrice * (Number(o.ssp || 0) / totalSsp);
      let recognized = 0;
      if (o.recognition === "over_time") recognized = allocated * Math.min(100, Math.max(0, o.percentComplete)) / 100;
      else recognized = o.delivered ? allocated : 0;
      const deferred = allocated - recognized;
      return { ...o, allocated, recognized, deferred };
    });
  }, [active, totalSsp]);

  const totals = useMemo(() => {
    const allocated = allocations.reduce((s, a) => s + a.allocated, 0);
    const recognized = allocations.reduce((s, a) => s + a.recognized, 0);
    const deferred = allocations.reduce((s, a) => s + a.deferred, 0);
    return { allocated, recognized, deferred };
  }, [allocations]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="w-7 h-7 text-primary" />
            Revenue Recognition
          </h1>
          <p className="text-muted-foreground">IFRS 15 — 5-step model: identify contract → obligations → transaction price → allocate → recognize</p>
        </div>
        <Button onClick={addContract}><Plus className="w-4 h-4 mr-1" />New Contract</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>Contracts</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {contracts.length === 0 && <p className="text-sm text-muted-foreground">No contracts yet.</p>}
            {contracts.map((c) => (
              <div key={c.id} className={`p-3 rounded border cursor-pointer flex justify-between items-center ${activeId === c.id ? "border-primary bg-accent" : ""}`} onClick={() => setActiveId(c.id)}>
                <div>
                  <div className="font-medium">{c.contractNo || "(no ref)"}</div>
                  <div className="text-xs text-muted-foreground">{c.customer || "—"}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); deleteContract(c.id); }}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          {!active && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Select or create a contract</CardContent></Card>
          )}
          {active && (
            <>
              <Card>
                <CardHeader><CardTitle>Contract Details</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Customer</Label>
                    <Input value={active.customer} onChange={(e) => updateActive({ customer: e.target.value })} />
                  </div>
                  <div>
                    <Label>Contract Number</Label>
                    <Input value={active.contractNo} onChange={(e) => updateActive({ contractNo: e.target.value })} />
                  </div>
                  <div>
                    <Label>Contract Date</Label>
                    <DateInput  value={active.contractDate} onChange={(e) => updateActive({ contractDate: e.target.value })} />
                  </div>
                  <div>
                    <Label>Transaction Price</Label>
                    <Input type="number" value={active.transactionPrice} onChange={(e) => updateActive({ transactionPrice: Number(e.target.value) || 0 })} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Performance Obligations</CardTitle>
                  <Button size="sm" onClick={() => updateActive({ obligations: [...active.obligations, emptyObligation()] })}>
                    <Plus className="w-4 h-4 mr-1" />Add
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {active.obligations.map((o) => (
                    <div key={o.id} className="border rounded p-3 grid grid-cols-1 md:grid-cols-6 gap-3">
                      <div className="md:col-span-2">
                        <Label>Description</Label>
                        <Input value={o.description} onChange={(e) => updateObligation(o.id, { description: e.target.value })} />
                      </div>
                      <div>
                        <Label>SSP</Label>
                        <Input type="number" value={o.ssp} onChange={(e) => updateObligation(o.id, { ssp: Number(e.target.value) || 0 })} />
                      </div>
                      <div>
                        <Label>Recognition</Label>
                        <Select value={o.recognition} onValueChange={(v) => updateObligation(o.id, { recognition: v as Obligation["recognition"] })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="point_in_time">Point in Time</SelectItem>
                            <SelectItem value="over_time">Over Time</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {o.recognition === "over_time" ? (
                        <div>
                          <Label>% Complete</Label>
                          <Input type="number" min={0} max={100} value={o.percentComplete} onChange={(e) => updateObligation(o.id, { percentComplete: Number(e.target.value) || 0 })} />
                        </div>
                      ) : (
                        <div>
                          <Label>Delivered</Label>
                          <Select value={o.delivered ? "yes" : "no"} onValueChange={(v) => updateObligation(o.id, { delivered: v === "yes" })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="no">No</SelectItem>
                              <SelectItem value="yes">Yes</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="flex items-end">
                        <Button size="icon" variant="ghost" onClick={() => updateActive({ obligations: active.obligations.filter((x) => x.id !== o.id) })}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Total Allocated</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold">{fmt(totals.allocated)}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue Recognized</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold text-primary">{fmt(totals.recognized)}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Contract Liability (Deferred)</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold text-orange-600">{fmt(totals.deferred)}</div></CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle>Allocation & Recognition Schedule</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Obligation</TableHead>
                        <TableHead>Basis</TableHead>
                        <TableHead className="text-right">SSP</TableHead>
                        <TableHead className="text-right">Allocated</TableHead>
                        <TableHead className="text-right">Recognized</TableHead>
                        <TableHead className="text-right">Deferred</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allocations.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>{a.description || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={a.recognition === "over_time" ? "default" : "secondary"}>
                              {a.recognition === "over_time" ? "Over Time" : "Point in Time"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{fmt(a.ssp)}</TableCell>
                          <TableCell className="text-right">{fmt(a.allocated)}</TableCell>
                          <TableCell className="text-right text-primary">{fmt(a.recognized)}</TableCell>
                          <TableCell className="text-right text-orange-600">{fmt(a.deferred)}</TableCell>
                        </TableRow>
                      ))}
                      {allocations.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Enter SSP and transaction price to compute allocations</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
