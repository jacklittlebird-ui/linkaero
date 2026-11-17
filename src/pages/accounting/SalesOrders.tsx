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
import { useToast } from "@/hooks/use-toast";
import { FileText, Package, TrendingUp, Trash2, Plus, ArrowRight } from "lucide-react";

type Airline = { id: string; name: string };
type Line = {
  id?: string;
  service_code?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  line_total?: number;
};
type Quote = {
  id: string;
  quote_number: string;
  airline_id: string | null;
  station: string | null;
  quote_date: string;
  valid_until: string | null;
  status: string;
  currency: string;
  total_amount: number;
  notes: string | null;
};
type Order = {
  id: string;
  order_number: string;
  source_quotation_id: string | null;
  airline_id: string | null;
  station: string | null;
  order_date: string;
  expected_delivery: string | null;
  status: string;
  currency: string;
  total_amount: number;
  invoice_id: string | null;
  notes: string | null;
};

const QUOTE_STATUS = ["draft", "sent", "accepted", "rejected", "expired", "converted"];
const ORDER_STATUS = ["draft", "confirmed", "in_progress", "delivered", "invoiced", "cancelled"];

export default function SalesOrders() {
  const { toast } = useToast();
  const [airlines, setAirlines] = useState<Airline[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quote, setQuote] = useState<Partial<Quote>>({});
  const [quoteLines, setQuoteLines] = useState<Line[]>([]);
  const [orderOpen, setOrderOpen] = useState(false);
  const [order, setOrder] = useState<Partial<Order>>({});
  const [orderLines, setOrderLines] = useState<Line[]>([]);

  async function load() {
    setLoading(true);
    const [{ data: al }, { data: q }, { data: o }] = await Promise.all([
      supabase.from("airlines").select("id, name").order("name"),
      supabase.from("sales_quotations").select("*").order("quote_date", { ascending: false }),
      supabase.from("sales_orders").select("*").order("order_date", { ascending: false }),
    ]);
    setAirlines(al || []);
    setQuotes(q || []);
    setOrders(o || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const airlineName = (id: string | null) => airlines.find((a) => a.id === id)?.name || "—";

  const kpi = useMemo(() => ({
    quotes: quotes.length,
    openQuotes: quotes.filter((q) => ["draft", "sent"].includes(q.status)).length,
    orders: orders.length,
    pipeline: quotes.filter((q) => q.status !== "rejected" && q.status !== "expired").reduce((s, q) => s + Number(q.total_amount || 0), 0),
    orderValue: orders.reduce((s, o) => s + Number(o.total_amount || 0), 0),
  }), [quotes, orders]);

  function newLine(): Line {
    return { description: "", quantity: 1, unit_price: 0, discount_pct: 0, tax_pct: 0 };
  }
  function calcTotal(lines: Line[]) {
    return lines.reduce((s, l) => {
      const gross = (l.quantity || 0) * (l.unit_price || 0);
      const net = gross * (1 - (l.discount_pct || 0) / 100);
      return s + net * (1 + (l.tax_pct || 0) / 100);
    }, 0);
  }

  function openNewQuote() {
    setQuote({ quote_date: new Date().toISOString().slice(0, 10), status: "draft", currency: "USD" });
    setQuoteLines([newLine()]);
    setQuoteOpen(true);
  }
  async function editQuote(q: Quote) {
    setQuote(q);
    const { data } = await supabase.from("sales_quotation_lines").select("*").eq("quotation_id", q.id).order("sort_order");
    setQuoteLines((data as Line[]) || []);
    setQuoteOpen(true);
  }
  async function saveQuote() {
    if (!quote.airline_id) return toast({ title: "Airline required", variant: "destructive" });
    const isNew = !quote.id;
    const payload: any = {
      airline_id: quote.airline_id,
      station: quote.station || null,
      quote_date: quote.quote_date,
      valid_until: quote.valid_until || null,
      status: quote.status || "draft",
      currency: quote.currency || "USD",
      notes: quote.notes || null,
    };
    let quoteId = quote.id;
    if (isNew) {
      payload.quote_number = "QT-" + Date.now();
      const { data, error } = await supabase.from("sales_quotations").insert(payload).select().single();
      if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
      quoteId = data.id;
    } else {
      const { error } = await supabase.from("sales_quotations").update(payload).eq("id", quote.id!);
      if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
      await supabase.from("sales_quotation_lines").delete().eq("quotation_id", quote.id!);
    }
    const linesPayload = quoteLines
      .filter((l) => l.description.trim())
      .map((l, i) => ({
        quotation_id: quoteId,
        service_code: l.service_code || null,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_pct: l.discount_pct,
        tax_pct: l.tax_pct,
        sort_order: i,
      }));
    if (linesPayload.length) {
      const { error } = await supabase.from("sales_quotation_lines").insert(linesPayload);
      if (error) return toast({ title: "Lines failed", description: error.message, variant: "destructive" });
    }
    toast({ title: "Quote saved" });
    setQuoteOpen(false);
    load();
  }
  async function deleteQuote(id: string) {
    if (!confirm("Delete this quotation?")) return;
    await supabase.from("sales_quotations").delete().eq("id", id);
    load();
  }
  async function convertQuote(id: string) {
    const { error } = await supabase.rpc("convert_quotation_to_order", { _quote_id: id });
    if (error) return toast({ title: "Convert failed", description: error.message, variant: "destructive" });
    toast({ title: "Converted to order" });
    load();
  }

  function openNewOrder() {
    setOrder({ order_date: new Date().toISOString().slice(0, 10), status: "draft", currency: "USD" });
    setOrderLines([newLine()]);
    setOrderOpen(true);
  }
  async function editOrder(o: Order) {
    setOrder(o);
    const { data } = await supabase.from("sales_order_lines").select("*").eq("order_id", o.id).order("sort_order");
    setOrderLines((data as Line[]) || []);
    setOrderOpen(true);
  }
  async function saveOrder() {
    if (!order.airline_id) return toast({ title: "Airline required", variant: "destructive" });
    const isNew = !order.id;
    const payload: any = {
      airline_id: order.airline_id,
      station: order.station || null,
      order_date: order.order_date,
      expected_delivery: order.expected_delivery || null,
      status: order.status || "draft",
      currency: order.currency || "USD",
      notes: order.notes || null,
    };
    let orderId = order.id;
    if (isNew) {
      payload.order_number = "SO-" + Date.now();
      const { data, error } = await supabase.from("sales_orders").insert(payload).select().single();
      if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
      orderId = data.id;
    } else {
      const { error } = await supabase.from("sales_orders").update(payload).eq("id", order.id!);
      if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
      await supabase.from("sales_order_lines").delete().eq("order_id", order.id!);
    }
    const linesPayload = orderLines
      .filter((l) => l.description.trim())
      .map((l, i) => ({
        order_id: orderId,
        service_code: l.service_code || null,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_pct: l.discount_pct,
        tax_pct: l.tax_pct,
        sort_order: i,
      }));
    if (linesPayload.length) {
      const { error } = await supabase.from("sales_order_lines").insert(linesPayload);
      if (error) return toast({ title: "Lines failed", description: error.message, variant: "destructive" });
    }
    toast({ title: "Order saved" });
    setOrderOpen(false);
    load();
  }
  async function deleteOrder(id: string) {
    if (!confirm("Delete this order?")) return;
    await supabase.from("sales_orders").delete().eq("id", id);
    load();
  }
  async function invoiceOrder(id: string) {
    const { error } = await supabase.rpc("convert_order_to_invoice", { _order_id: id });
    if (error) return toast({ title: "Invoice failed", description: error.message, variant: "destructive" });
    toast({ title: "Invoice created" });
    load();
  }

  const statusBadge = (s: string) => {
    const v: any = ["accepted", "confirmed", "delivered"].includes(s) ? "default"
      : ["rejected", "cancelled", "expired"].includes(s) ? "destructive"
      : ["converted", "invoiced"].includes(s) ? "secondary" : "outline";
    return <Badge variant={v}>{s}</Badge>;
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sales Quotations & Orders</h1>
          <p className="text-sm text-muted-foreground">Quote-to-cash pipeline with conversion to invoice</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi icon={<FileText className="h-4 w-4" />} label="Total Quotes" value={String(kpi.quotes)} />
        <Kpi icon={<FileText className="h-4 w-4" />} label="Open Quotes" value={String(kpi.openQuotes)} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Pipeline Value" value={kpi.pipeline.toLocaleString()} />
        <Kpi icon={<Package className="h-4 w-4" />} label="Orders" value={String(kpi.orders)} />
        <Kpi icon={<Package className="h-4 w-4" />} label="Order Value" value={kpi.orderValue.toLocaleString()} />
      </div>

      <Tabs defaultValue="quotes">
        <TabsList>
          <TabsTrigger value="quotes">Quotations</TabsTrigger>
          <TabsTrigger value="orders">Sales Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="quotes">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Quotations</CardTitle>
              <Button size="sm" onClick={openNewQuote}><Plus className="h-4 w-4 mr-1" />New Quote</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Airline</TableHead>
                  <TableHead>Valid Until</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loading ? <TableRow><TableCell colSpan={7}>Loading…</TableCell></TableRow>
                    : quotes.length === 0 ? <TableRow><TableCell colSpan={7}>No quotations.</TableCell></TableRow>
                    : quotes.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="font-mono text-xs">{q.quote_number}</TableCell>
                        <TableCell>{new Date(q.quote_date).toLocaleDateString("en-GB")}</TableCell>
                        <TableCell>{airlineName(q.airline_id)}</TableCell>
                        <TableCell>{q.valid_until ? new Date(q.valid_until).toLocaleDateString("en-GB") : "—"}</TableCell>
                        <TableCell>{Number(q.total_amount).toLocaleString()} {q.currency}</TableCell>
                        <TableCell>{statusBadge(q.status)}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="outline" onClick={() => editQuote(q)}>Edit</Button>
                          {q.status !== "converted" && q.status !== "rejected" && (
                            <Button size="sm" variant="secondary" onClick={() => convertQuote(q.id)}>
                              <ArrowRight className="h-3 w-3 mr-1" />Convert
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => deleteQuote(q.id)}><Trash2 className="h-3 w-3" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Sales Orders</CardTitle>
              <Button size="sm" onClick={openNewOrder}><Plus className="h-4 w-4 mr-1" />New Order</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Airline</TableHead>
                  <TableHead>Expected</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loading ? <TableRow><TableCell colSpan={7}>Loading…</TableCell></TableRow>
                    : orders.length === 0 ? <TableRow><TableCell colSpan={7}>No orders.</TableCell></TableRow>
                    : orders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                        <TableCell>{new Date(o.order_date).toLocaleDateString("en-GB")}</TableCell>
                        <TableCell>{airlineName(o.airline_id)}</TableCell>
                        <TableCell>{o.expected_delivery ? new Date(o.expected_delivery).toLocaleDateString("en-GB") : "—"}</TableCell>
                        <TableCell>{Number(o.total_amount).toLocaleString()} {o.currency}</TableCell>
                        <TableCell>{statusBadge(o.status)}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="outline" onClick={() => editOrder(o)}>Edit</Button>
                          {o.status !== "invoiced" && o.status !== "cancelled" && (
                            <Button size="sm" variant="secondary" onClick={() => invoiceOrder(o.id)}>Invoice</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => deleteOrder(o.id)}><Trash2 className="h-3 w-3" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Quote Dialog */}
      <Dialog open={quoteOpen} onOpenChange={setQuoteOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{quote.id ? "Edit" : "New"} Quotation</DialogTitle></DialogHeader>
          <QuoteOrderForm
            header={quote as any}
            setHeader={setQuote as any}
            lines={quoteLines}
            setLines={setQuoteLines}
            airlines={airlines}
            statuses={QUOTE_STATUS}
            calcTotal={calcTotal}
            extraFields={<>
              <div>
                <Label>Valid Until</Label>
                <DateInput  value={quote.valid_until || ""} onChange={(e) => setQuote({ ...quote, valid_until: e.target.value })} />
              </div>
            </>}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteOpen(false)}>Cancel</Button>
            <Button onClick={saveQuote}>Save Quote</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order Dialog */}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{order.id ? "Edit" : "New"} Sales Order</DialogTitle></DialogHeader>
          <QuoteOrderForm
            header={order as any}
            setHeader={setOrder as any}
            lines={orderLines}
            setLines={setOrderLines}
            airlines={airlines}
            statuses={ORDER_STATUS}
            calcTotal={calcTotal}
            dateLabel="Order Date"
            dateKey="order_date"
            extraFields={<>
              <div>
                <Label>Expected Delivery</Label>
                <DateInput  value={order.expected_delivery || ""} onChange={(e) => setOrder({ ...order, expected_delivery: e.target.value })} />
              </div>
            </>}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderOpen(false)}>Cancel</Button>
            <Button onClick={saveOrder}>Save Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuoteOrderForm({ header, setHeader, lines, setLines, airlines, statuses, calcTotal, extraFields, dateLabel = "Quote Date", dateKey = "quote_date" }: any) {
  const total = calcTotal(lines);
  function updLine(i: number, k: keyof Line, v: any) {
    const next = [...lines]; (next[i] as any)[k] = v; setLines(next);
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Airline</Label>
          <Select value={header.airline_id || ""} onValueChange={(v) => setHeader({ ...header, airline_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{airlines.map((a: Airline) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Station</Label>
          <Input value={header.station || ""} onChange={(e) => setHeader({ ...header, station: e.target.value })} />
        </div>
        <div>
          <Label>{dateLabel}</Label>
          <DateInput  value={header[dateKey] || ""} onChange={(e) => setHeader({ ...header, [dateKey]: e.target.value })} />
        </div>
        {extraFields}
        <div>
          <Label>Currency</Label>
          <Input value={header.currency || "USD"} onChange={(e) => setHeader({ ...header, currency: e.target.value })} />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={header.status || "draft"} onValueChange={(v) => setHeader({ ...header, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{statuses.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Line Items</Label>
          <Button size="sm" variant="outline" onClick={() => setLines([...lines, { description: "", quantity: 1, unit_price: 0, discount_pct: 0, tax_pct: 0 }])}>
            <Plus className="h-3 w-3 mr-1" />Add
          </Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Description</TableHead><TableHead>Qty</TableHead><TableHead>Unit</TableHead>
            <TableHead>Disc %</TableHead><TableHead>Tax %</TableHead><TableHead>Total</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {lines.map((l: Line, i: number) => {
              const gross = (l.quantity || 0) * (l.unit_price || 0);
              const net = gross * (1 - (l.discount_pct || 0) / 100);
              const lt = net * (1 + (l.tax_pct || 0) / 100);
              return (
                <TableRow key={i}>
                  <TableCell><Input value={l.description} onChange={(e) => updLine(i, "description", e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="w-20" value={l.quantity} onChange={(e) => updLine(i, "quantity", Number(e.target.value))} /></TableCell>
                  <TableCell><Input type="number" className="w-24" value={l.unit_price} onChange={(e) => updLine(i, "unit_price", Number(e.target.value))} /></TableCell>
                  <TableCell><Input type="number" className="w-20" value={l.discount_pct} onChange={(e) => updLine(i, "discount_pct", Number(e.target.value))} /></TableCell>
                  <TableCell><Input type="number" className="w-20" value={l.tax_pct} onChange={(e) => updLine(i, "tax_pct", Number(e.target.value))} /></TableCell>
                  <TableCell className="font-medium">{lt.toFixed(2)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_: any, ix: number) => ix !== i))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="mt-3 flex justify-end text-lg font-semibold">
          Total: {total.toFixed(2)} {header.currency || "USD"}
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea value={header.notes || ""} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
      </div>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
