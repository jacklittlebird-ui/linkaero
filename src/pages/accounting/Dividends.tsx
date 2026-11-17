import { useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Wallet } from "lucide-react";

const TYPES = ["cash", "stock", "interim", "final", "special"];
const STATUSES = ["declared", "approved", "paid", "cancelled"];

export default function DividendsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [openPay, setOpenPay] = useState(false);

  const { data: companies = [] } = useQuery({
    queryKey: ["companies_list"],
    queryFn: async () => (await supabase.from("companies").select("id, name").order("name")).data || [],
  });

  const { data: declarations = [] } = useQuery({
    queryKey: ["dividend_declarations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("dividend_declarations").select("*").order("declaration_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const current = declarations.find((d) => d.id === selected);

  const { data: payments = [] } = useQuery({
    queryKey: ["dividend_payments", selected],
    enabled: !!selected,
    queryFn: async () => (await supabase.from("dividend_payments").select("*").eq("declaration_id", selected).order("created_at")).data || [],
  });

  const totals = declarations.reduce(
    (a, d) => ({
      gross: a.gross + Number(d.total_amount || 0),
      wht: a.wht + Number(d.wht_amount || 0),
      net: a.net + Number(d.net_amount || 0),
    }),
    { gross: 0, wht: 0, net: 0 }
  );

  const createDeclaration = async (f: FormData) => {
    const payload: any = {
      declaration_date: f.get("declaration_date"),
      record_date: f.get("record_date") || null,
      payment_date: f.get("payment_date") || null,
      fiscal_year: Number(f.get("fiscal_year")),
      dividend_type: f.get("dividend_type") || "cash",
      total_amount: Number(f.get("total_amount") || 0),
      currency: f.get("currency") || "EGP",
      per_share_amount: f.get("per_share_amount") ? Number(f.get("per_share_amount")) : null,
      wht_rate: Number(f.get("wht_rate") || 0),
      board_resolution_ref: f.get("board_resolution_ref") || null,
      notes: f.get("notes") || null,
    };
    const companyId = f.get("company_id");
    if (companyId) payload.company_id = companyId;
    payload.wht_amount = payload.total_amount * payload.wht_rate;
    payload.net_amount = payload.total_amount - payload.wht_amount;
    const { data, error } = await supabase.from("dividend_declarations").insert(payload).select().single();
    if (error) return toast.error(error.message);
    toast.success("Declaration recorded");
    setOpenNew(false);
    setSelected(data.id);
    qc.invalidateQueries({ queryKey: ["dividend_declarations"] });
  };

  const updateStatus = async (status: string) => {
    if (!selected) return;
    const { error } = await supabase.from("dividend_declarations").update({ status }).eq("id", selected);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${status}`);
    qc.invalidateQueries({ queryKey: ["dividend_declarations"] });
  };

  const addPayment = async (f: FormData) => {
    if (!selected || !current) return;
    const gross = Number(f.get("gross_amount") || 0);
    const wht = gross * Number(current.wht_rate || 0);
    const payload: any = {
      declaration_id: selected,
      shareholder_name: f.get("shareholder_name"),
      shareholding_pct: f.get("shareholding_pct") ? Number(f.get("shareholding_pct")) : null,
      gross_amount: gross,
      wht_amount: wht,
      net_amount: gross - wht,
      payment_date: f.get("payment_date") || null,
      payment_reference: f.get("payment_reference") || null,
      status: f.get("status") || "pending",
    };
    const { error } = await supabase.from("dividend_payments").insert(payload);
    if (error) return toast.error(error.message);
    await supabase.rpc("recompute_dividend_totals", { p_declaration_id: selected });
    toast.success("Payment allocated");
    setOpenPay(false);
    qc.invalidateQueries({ queryKey: ["dividend_payments", selected] });
    qc.invalidateQueries({ queryKey: ["dividend_declarations"] });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dividend Declaration & Payment Register</h1>
          <p className="text-muted-foreground text-sm">Board resolutions, shareholder allocations & WHT on dividends</p>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Declare Dividend</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New Dividend Declaration</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createDeclaration(new FormData(e.currentTarget)); }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Company</Label>
                  <Select name="company_id">
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Fiscal Year</Label><Input type="number" name="fiscal_year" defaultValue={new Date().getFullYear() - 1} required /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Declaration Date</Label><DateInput  name="declaration_date" defaultValue={new Date().toISOString().slice(0,10)} required /></div>
                <div><Label>Record Date</Label><DateInput  name="record_date" /></div>
                <div><Label>Payment Date</Label><DateInput  name="payment_date" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Type</Label>
                  <Select name="dividend_type" defaultValue="cash">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Currency</Label><Input name="currency" defaultValue="EGP" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Total Amount</Label><Input type="number" step="0.01" name="total_amount" required /></div>
                <div><Label>Per Share</Label><Input type="number" step="0.000001" name="per_share_amount" /></div>
                <div><Label>WHT Rate</Label><Input type="number" step="0.0001" name="wht_rate" defaultValue="0.10" /></div>
              </div>
              <div><Label>Board Resolution Ref</Label><Input name="board_resolution_ref" /></div>
              <div><Label>Notes</Label><Textarea name="notes" /></div>
              <Button type="submit" className="w-full">Create</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Total Declared</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{totals.gross.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">WHT Withheld</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{totals.wht.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Net Paid to Shareholders</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{totals.net.toLocaleString()}</div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Declarations</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[600px] overflow-auto">
            {declarations.map((d) => (
              <button key={d.id} onClick={() => setSelected(d.id)}
                className={`w-full text-left p-3 rounded border ${selected === d.id ? "border-primary bg-primary/5" : "border-border"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">FY {d.fiscal_year} — {d.dividend_type}</span>
                  <Badge variant={d.status === "paid" ? "default" : d.status === "cancelled" ? "destructive" : "secondary"}>{d.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{d.declaration_date} · {Number(d.total_amount).toLocaleString()} {d.currency}</div>
              </button>
            ))}
            {declarations.length === 0 && <p className="text-sm text-muted-foreground">No declarations.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" />Declaration Detail</CardTitle></CardHeader>
          <CardContent>
            {!current ? (
              <p className="text-sm text-muted-foreground">Select a declaration.</p>
            ) : (
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="space-y-3 pt-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><Label className="text-muted-foreground">Declaration Date</Label><div>{current.declaration_date}</div></div>
                    <div><Label className="text-muted-foreground">Record Date</Label><div>{current.record_date || "—"}</div></div>
                    <div><Label className="text-muted-foreground">Payment Date</Label><div>{current.payment_date || "—"}</div></div>
                    <div><Label className="text-muted-foreground">Type</Label><div>{current.dividend_type}</div></div>
                    <div><Label className="text-muted-foreground">Per Share</Label><div>{current.per_share_amount ?? "—"} {current.currency}</div></div>
                    <div><Label className="text-muted-foreground">WHT Rate</Label><div>{(Number(current.wht_rate) * 100).toFixed(2)}%</div></div>
                    <div><Label className="text-muted-foreground">Board Ref</Label><div>{current.board_resolution_ref || "—"}</div></div>
                    <div><Label className="text-muted-foreground">Status</Label><div><Badge>{current.status}</Badge></div></div>
                  </div>
                  <div className="border rounded p-3 bg-muted/30 grid grid-cols-3 gap-3 text-sm">
                    <div><div className="text-xs text-muted-foreground">Gross</div><div className="font-semibold">{Number(current.total_amount).toLocaleString()}</div></div>
                    <div><div className="text-xs text-muted-foreground">WHT</div><div className="font-semibold">{Number(current.wht_amount).toLocaleString()}</div></div>
                    <div><div className="text-xs text-muted-foreground">Net</div><div className="font-semibold">{Number(current.net_amount).toLocaleString()}</div></div>
                  </div>
                  {current.notes && <div><Label className="text-muted-foreground">Notes</Label><div className="text-sm whitespace-pre-wrap">{current.notes}</div></div>}
                  <div className="flex gap-2 flex-wrap">
                    {STATUSES.filter((s) => s !== current.status).map((s) => (
                      <Button key={s} size="sm" variant="outline" onClick={() => updateStatus(s)}>Mark {s}</Button>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="payments" className="space-y-3 pt-4">
                  <Dialog open={openPay} onOpenChange={setOpenPay}>
                    <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Allocate to Shareholder</Button></DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Shareholder Allocation</DialogTitle></DialogHeader>
                      <form onSubmit={(e) => { e.preventDefault(); addPayment(new FormData(e.currentTarget)); }} className="space-y-3">
                        <div><Label>Shareholder</Label><Input name="shareholder_name" required /></div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Shareholding %</Label><Input type="number" step="0.0001" name="shareholding_pct" /></div>
                          <div><Label>Gross Amount</Label><Input type="number" step="0.01" name="gross_amount" required /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Payment Date</Label><DateInput  name="payment_date" /></div>
                          <div><Label>Reference</Label><Input name="payment_reference" /></div>
                        </div>
                        <div><Label>Status</Label>
                          <Select name="status" defaultValue="pending">
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="paid">Paid</SelectItem>
                              <SelectItem value="on_hold">On Hold</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button type="submit" className="w-full">Allocate</Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                  <Table>
                    <TableHeader><TableRow><TableHead>Shareholder</TableHead><TableHead className="text-right">%</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">WHT</TableHead><TableHead className="text-right">Net</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {payments.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.shareholder_name}</TableCell>
                          <TableCell className="text-right">{p.shareholding_pct != null ? `${Number(p.shareholding_pct).toFixed(2)}%` : "—"}</TableCell>
                          <TableCell className="text-right">{Number(p.gross_amount).toLocaleString()}</TableCell>
                          <TableCell className="text-right">{Number(p.wht_amount).toLocaleString()}</TableCell>
                          <TableCell className="text-right font-medium">{Number(p.net_amount).toLocaleString()}</TableCell>
                          <TableCell><Badge variant={p.status === "paid" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                      {payments.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No allocations.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
