// Phase 2r: Customer Statements & Portal
// - Airline customers see their own invoices, payment history, and account statements
// - Finance/admin manage customer-user ↔ airline mappings and can view any airline's statement
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
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FileText, Download, Users, Receipt, Wallet, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";

type CustomerUser = {
  id: string;
  user_id: string;
  airline_iata: string;
  is_active: boolean;
  created_at: string;
};

type Invoice = {
  id: string;
  invoice_no: string;
  date: string;
  due_date: string | null;
  airline_iata: string | null;
  operator: string | null;
  description: string | null;
  flight_ref: string | null;
  total: number;
  currency: string;
  status: string;
  payment_date: string | null;
  payment_ref: string | null;
};

type StatementRow = {
  entry_date: string;
  entry_type: string;
  reference: string | null;
  description: string | null;
  currency: string | null;
  debit: number | null;
  credit: number | null;
  running_balance: number | null;
};

const fmtDate = (d?: string | null) => (d ? format(new Date(d), "dd/MM/yyyy") : "—");
const fmtMoney = (n?: number | null, c?: string | null) =>
  n == null ? "—" : `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${c ? " " + c : ""}`;

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  const v = (s || "").toLowerCase();
  if (v === "paid") return "default";
  if (v === "overdue") return "destructive";
  if (v === "sent" || v === "finalized") return "secondary";
  return "outline";
};

export default function CustomerPortal() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;

  const [selectedAirline, setSelectedAirline] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [mappingOpen, setMappingOpen] = useState(false);
  const [newMapping, setNewMapping] = useState({ user_id: "", airline_iata: "" });

  // Is finance/admin?
  const { data: roleInfo } = useQuery({
    queryKey: ["customer-portal-role", uid],
    queryFn: async () => {
      if (!uid) return { isFinance: false };
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const roles = (data || []).map((r: any) => r.role);
      const isFinance = roles.some((r) => ["admin", "general_accounts", "receivables", "payables", "accountant"].includes(r));
      return { isFinance };
    },
    enabled: !!uid,
  });
  const isFinance = !!roleInfo?.isFinance;

  // Current customer airline (for portal users)
  const { data: myAirline } = useQuery({
    queryKey: ["my-customer-airline", uid],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_customer_airline_iata");
      if (error) return null;
      return data as string | null;
    },
    enabled: !!uid,
  });

  const activeAirline = (isFinance ? selectedAirline : myAirline) || "";

  // Airlines list for finance dropdown
  const { data: airlines = [] } = useQuery({
    queryKey: ["customer-portal-airlines"],
    queryFn: async () => {
      const { data } = await supabase.from("airlines").select("iata_code,name").order("iata_code");
      return (data || []).filter((a: any) => a.iata_code);
    },
    enabled: isFinance,
  });

  // Invoices for the active airline
  const { data: invoices = [], isLoading: invLoading } = useQuery({
    queryKey: ["customer-invoices", activeAirline],
    queryFn: async () => {
      if (!activeAirline) return [];
      const { data, error } = await supabase
        .from("v_customer_invoices" as any)
        .select("*")
        .ilike("airline_iata", activeAirline)
        .order("date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data || []) as unknown) as Invoice[];
    },
    enabled: !!activeAirline,
  });

  // Statement
  const { data: statement = [], isLoading: stmtLoading, refetch: refetchStmt } = useQuery({
    queryKey: ["customer-statement", activeAirline, fromDate, toDate],
    queryFn: async () => {
      if (!activeAirline) return [];
      const { data, error } = await supabase.rpc("get_customer_statement", {
        _from: fromDate, _to: toDate, _airline_iata: activeAirline,
      });
      if (error) throw error;
      return (data || []) as StatementRow[];
    },
    enabled: !!activeAirline,
  });

  // Customer mappings (finance only)
  const { data: mappings = [] } = useQuery({
    queryKey: ["customer-users"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_users").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as CustomerUser[];
    },
    enabled: isFinance,
  });

  const kpis = useMemo(() => {
    const total = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
    const paid = invoices.filter((i) => i.status.toLowerCase() === "paid").reduce((s, i) => s + Number(i.total || 0), 0);
    const outstanding = total - paid;
    const closing = statement.length ? Number(statement[statement.length - 1].running_balance || 0) : 0;
    return { total, paid, outstanding, closing };
  }, [invoices, statement]);

  const addMapping = useMutation({
    mutationFn: async () => {
      if (!newMapping.user_id || !newMapping.airline_iata) throw new Error("User ID and airline IATA required");
      const { error } = await supabase.from("customer_users").insert({
        user_id: newMapping.user_id.trim(),
        airline_iata: newMapping.airline_iata.trim().toUpperCase(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Customer user mapped");
      setMappingOpen(false);
      setNewMapping({ user_id: "", airline_iata: "" });
      qc.invalidateQueries({ queryKey: ["customer-users"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to add mapping"),
  });

  const removeMapping = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customer_users").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mapping removed");
      qc.invalidateQueries({ queryKey: ["customer-users"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to remove"),
  });

  const exportStatement = () => {
    if (!statement.length) return;
    const rows = statement.map((r) => ({
      Date: fmtDate(r.entry_date),
      Type: r.entry_type,
      Reference: r.reference || "",
      Description: r.description || "",
      Currency: r.currency || "",
      Debit: r.debit || 0,
      Credit: r.credit || 0,
      Balance: r.running_balance || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statement");
    XLSX.writeFile(wb, `Statement_${activeAirline}_${fromDate}_to_${toDate}.xlsx`);
  };

  const exportInvoices = () => {
    if (!invoices.length) return;
    const rows = invoices.map((i) => ({
      "Invoice No": i.invoice_no,
      Date: fmtDate(i.date),
      "Due Date": fmtDate(i.due_date),
      Description: i.description || i.flight_ref || "",
      Total: i.total,
      Currency: i.currency,
      Status: i.status,
      "Payment Date": fmtDate(i.payment_date),
      "Payment Ref": i.payment_ref || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invoices");
    XLSX.writeFile(wb, `Invoices_${activeAirline}.xlsx`);
  };

  if (!isFinance && !myAirline) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardHeader><CardTitle>Customer Portal</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Your account is not linked to a customer airline yet. Please contact the finance team to grant portal access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="h-8 w-8" /> Customer Portal
          </h1>
          <p className="text-muted-foreground mt-1">
            {isFinance ? "Review any airline customer's statement, invoices, and payment history." : "View your invoices, statements, and payment history."}
          </p>
        </div>
        {isFinance && (
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <Label className="text-xs">Airline (IATA)</Label>
              <select
                value={selectedAirline}
                onChange={(e) => setSelectedAirline(e.target.value.toUpperCase())}
                className="h-10 border rounded-md px-2 min-w-[180px] bg-background"
              >
                <option value="">Select airline…</option>
                {airlines.map((a: any) => (
                  <option key={a.iata_code} value={a.iata_code}>{a.iata_code} — {a.name}</option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={() => setMappingOpen(true)}>
              <Users className="h-4 w-4 mr-2" /> Manage Users
            </Button>
          </div>
        )}
      </div>

      {activeAirline && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Total Invoiced</div><div className="text-2xl font-bold mt-1">{fmtMoney(kpis.total)}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Paid</div><div className="text-2xl font-bold mt-1 text-green-600">{fmtMoney(kpis.paid)}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Outstanding</div><div className="text-2xl font-bold mt-1 text-orange-600">{fmtMoney(kpis.outstanding)}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Statement Balance</div><div className="text-2xl font-bold mt-1">{fmtMoney(kpis.closing)}</div></CardContent></Card>
          </div>

          <Tabs defaultValue="statement" className="w-full">
            <TabsList>
              <TabsTrigger value="statement"><FileText className="h-4 w-4 mr-2" />Statement</TabsTrigger>
              <TabsTrigger value="invoices"><Receipt className="h-4 w-4 mr-2" />Invoices</TabsTrigger>
              <TabsTrigger value="payments"><Wallet className="h-4 w-4 mr-2" />Payments</TabsTrigger>
            </TabsList>

            <TabsContent value="statement">
              <Card>
                <CardHeader>
                  <div className="flex items-end justify-between gap-4 flex-wrap">
                    <CardTitle>Account Statement — {activeAirline}</CardTitle>
                    <div className="flex gap-2 items-end flex-wrap">
                      <div>
                        <Label className="text-xs">From</Label>
                        <DateInput  value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
                      </div>
                      <div>
                        <Label className="text-xs">To</Label>
                        <DateInput  value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
                      </div>
                      <Button variant="outline" onClick={() => refetchStmt()}>Refresh</Button>
                      <Button onClick={exportStatement} disabled={!statement.length}>
                        <Download className="h-4 w-4 mr-2" /> Export
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stmtLoading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                        {!stmtLoading && statement.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No activity in this period.</TableCell></TableRow>}
                        {statement.map((r, idx) => (
                          <TableRow key={idx} className={r.entry_type === "OPENING" || r.entry_type === "CLOSING" ? "font-semibold bg-muted/40" : ""}>
                            <TableCell>{fmtDate(r.entry_date)}</TableCell>
                            <TableCell><Badge variant="outline">{r.entry_type}</Badge></TableCell>
                            <TableCell className="font-mono text-xs">{r.reference || "—"}</TableCell>
                            <TableCell>{r.description || "—"}</TableCell>
                            <TableCell className="text-right">{r.debit ? fmtMoney(r.debit) : "—"}</TableCell>
                            <TableCell className="text-right">{r.credit ? fmtMoney(r.credit) : "—"}</TableCell>
                            <TableCell className="text-right font-semibold">{fmtMoney(r.running_balance)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="invoices">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Invoices — {activeAirline}</CardTitle>
                    <Button onClick={exportInvoices} disabled={!invoices.length}>
                      <Download className="h-4 w-4 mr-2" /> Export
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Payment</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invLoading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                        {!invLoading && invoices.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No invoices yet.</TableCell></TableRow>}
                        {invoices.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell className="font-mono">{i.invoice_no}</TableCell>
                            <TableCell>{fmtDate(i.date)}</TableCell>
                            <TableCell>{fmtDate(i.due_date)}</TableCell>
                            <TableCell className="max-w-[280px] truncate">{i.description || i.flight_ref || "—"}</TableCell>
                            <TableCell className="text-right">{fmtMoney(i.total, i.currency)}</TableCell>
                            <TableCell><Badge variant={statusVariant(i.status)}>{i.status}</Badge></TableCell>
                            <TableCell className="text-xs">
                              {i.payment_date ? `${fmtDate(i.payment_date)}${i.payment_ref ? ` (${i.payment_ref})` : ""}` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payments">
              <Card>
                <CardHeader><CardTitle>Payment History — {activeAirline}</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Payment Date</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Applied Invoice</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.filter((i) => i.payment_date).length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No payments recorded.</TableCell></TableRow>
                        )}
                        {invoices.filter((i) => i.payment_date).map((i) => (
                          <TableRow key={i.id}>
                            <TableCell>{fmtDate(i.payment_date)}</TableCell>
                            <TableCell className="font-mono text-xs">{i.payment_ref || "—"}</TableCell>
                            <TableCell className="font-mono">{i.invoice_no}</TableCell>
                            <TableCell className="text-right">{fmtMoney(i.total, i.currency)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {isFinance && !activeAirline && (
        <Card><CardContent className="pt-6 text-muted-foreground">Select an airline above to view its portal data.</CardContent></Card>
      )}

      <Dialog open={mappingOpen} onOpenChange={setMappingOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Customer User Mappings</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_auto] gap-2 items-end">
              <div>
                <Label className="text-xs">User ID (auth UUID)</Label>
                <Input value={newMapping.user_id} onChange={(e) => setNewMapping((p) => ({ ...p, user_id: e.target.value }))} placeholder="uuid…" />
              </div>
              <div>
                <Label className="text-xs">Airline IATA</Label>
                <Input value={newMapping.airline_iata} onChange={(e) => setNewMapping((p) => ({ ...p, airline_iata: e.target.value.toUpperCase() }))} placeholder="MS" />
              </div>
              <Button onClick={() => addMapping.mutate()} disabled={addMapping.isPending}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
            <div className="max-h-[360px] overflow-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Airline</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No mappings yet.</TableCell></TableRow>}
                  {mappings.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.user_id}</TableCell>
                      <TableCell>{m.airline_iata}</TableCell>
                      <TableCell>{m.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => removeMapping.mutate(m.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
