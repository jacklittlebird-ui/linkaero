import { useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Plus, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

type Party = { id: string; party_name: string; relationship_type: string; related_company_id: string | null; tax_id: string | null; country: string | null; is_active: boolean; notes: string | null };
type Txn = { id: string; related_party_id: string; company_id: string | null; transaction_date: string; transaction_type: string; description: string; amount: number; currency: string; reference_document: string | null; arms_length: boolean; disclosure_period: string | null; notes: string | null };

const REL_TYPES = ["Parent", "Subsidiary", "Associate", "Joint Venture", "Key Management", "Shareholder", "Other"];
const TXN_TYPES = ["Sale of Services", "Purchase of Services", "Loan Granted", "Loan Received", "Interest", "Management Fee", "Dividend", "Guarantee", "Cost Recharge", "Other"];

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RelatedPartiesPage() {
  const qc = useQueryClient();
  const [partyOpen, setPartyOpen] = useState(false);
  const [txnOpen, setTxnOpen] = useState(false);
  const [period, setPeriod] = useState(format(new Date(), "yyyy"));

  const [pForm, setPForm] = useState({ party_name: "", relationship_type: "Associate", related_company_id: "", tax_id: "", country: "", is_active: true, notes: "" });
  const [tForm, setTForm] = useState({
    related_party_id: "", company_id: "", transaction_date: format(new Date(), "yyyy-MM-dd"),
    transaction_type: "Sale of Services", description: "", amount: "", currency: "EGP",
    reference_document: "", arms_length: true, disclosure_period: format(new Date(), "yyyy"), notes: "",
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: parties = [], isLoading: loadingP } = useQuery({
    queryKey: ["related_parties"],
    queryFn: async () => {
      const { data, error } = await supabase.from("related_parties").select("*").order("party_name");
      if (error) throw error;
      return (data ?? []) as Party[];
    },
  });

  const { data: txns = [], isLoading: loadingT } = useQuery({
    queryKey: ["related_party_transactions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("related_party_transactions").select("*").order("transaction_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Txn[];
    },
  });

  const partyMap = useMemo(() => new Map(parties.map(p => [p.id, p])), [parties]);
  const companyMap = useMemo(() => new Map(companies.map(c => [c.id, c.name])), [companies]);

  const createParty = useMutation({
    mutationFn: async () => {
      if (!pForm.party_name.trim()) throw new Error("Name required");
      const { error } = await supabase.from("related_parties").insert({
        party_name: pForm.party_name.trim(),
        relationship_type: pForm.relationship_type,
        related_company_id: pForm.related_company_id || null,
        tax_id: pForm.tax_id || null,
        country: pForm.country || null,
        is_active: pForm.is_active,
        notes: pForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Related party added");
      qc.invalidateQueries({ queryKey: ["related_parties"] });
      setPartyOpen(false);
      setPForm({ party_name: "", relationship_type: "Associate", related_company_id: "", tax_id: "", country: "", is_active: true, notes: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createTxn = useMutation({
    mutationFn: async () => {
      if (!tForm.related_party_id) throw new Error("Select a related party");
      if (!tForm.description.trim()) throw new Error("Description required");
      const { error } = await supabase.from("related_party_transactions").insert({
        related_party_id: tForm.related_party_id,
        company_id: tForm.company_id || null,
        transaction_date: tForm.transaction_date,
        transaction_type: tForm.transaction_type,
        description: tForm.description.trim(),
        amount: parseFloat(tForm.amount) || 0,
        currency: tForm.currency,
        reference_document: tForm.reference_document || null,
        arms_length: tForm.arms_length,
        disclosure_period: tForm.disclosure_period || null,
        notes: tForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transaction recorded");
      qc.invalidateQueries({ queryKey: ["related_party_transactions"] });
      setTxnOpen(false);
      setTForm({ ...tForm, description: "", amount: "", reference_document: "", notes: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleParty = useMutation({
    mutationFn: async (p: Party) => {
      const { error } = await supabase.from("related_parties").update({ is_active: !p.is_active }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["related_parties"] }),
  });

  // Disclosure summary for selected period
  const periodTxns = txns.filter(t => (t.disclosure_period || "").startsWith(period) || t.transaction_date.startsWith(period));
  const summary = useMemo(() => {
    const byParty = new Map<string, { count: number; total: number; nonArm: number }>();
    for (const t of periodTxns) {
      const key = t.related_party_id;
      const s = byParty.get(key) ?? { count: 0, total: 0, nonArm: 0 };
      s.count += 1;
      s.total += Number(t.amount || 0);
      if (!t.arms_length) s.nonArm += 1;
      byParty.set(key, s);
    }
    return Array.from(byParty.entries()).map(([id, s]) => ({ party: partyMap.get(id), ...s }));
  }, [periodTxns, partyMap]);

  const totalDisclosure = summary.reduce((s, r) => s + r.total, 0);
  const nonArmCount = periodTxns.filter(t => !t.arms_length).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Related Party Transactions</h1>
        <p className="text-sm text-muted-foreground">IAS 24 register — track related parties, log transactions, and produce disclosure summaries.</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card><CardHeader><CardTitle className="text-sm">Related Parties</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{parties.length}</div><div className="text-xs text-muted-foreground">{parties.filter(p => p.is_active).length} active</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Transactions ({period})</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{periodTxns.length}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Disclosure Total</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{fmt(totalDisclosure)}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2">Non-Arm's-Length {nonArmCount > 0 && <AlertTriangle className="w-4 h-4 text-destructive" />}</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-destructive">{nonArmCount}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="disclosure">
        <TabsList>
          <TabsTrigger value="disclosure">Disclosure Summary</TabsTrigger>
          <TabsTrigger value="parties">Parties</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>

        <TabsContent value="disclosure">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Disclosure for period</CardTitle>
              <Input className="w-32" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="YYYY" />
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Party</TableHead>
                    <TableHead>Relationship</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="text-right">Non-Arm's-Length</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.party?.party_name ?? "—"}</TableCell>
                      <TableCell>{r.party?.relationship_type ?? "—"}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{fmt(r.total)}</TableCell>
                      <TableCell className="text-right">{r.nonArm > 0 ? <span className="text-destructive font-semibold">{r.nonArm}</span> : 0}</TableCell>
                    </TableRow>
                  ))}
                  {summary.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No transactions in this period.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="parties">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Related Parties</CardTitle>
              <Dialog open={partyOpen} onOpenChange={setPartyOpen}>
                <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Party</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Related Party</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2"><Label>Party Name</Label><Input value={pForm.party_name} onChange={(e) => setPForm({ ...pForm, party_name: e.target.value })} /></div>
                    <div><Label>Relationship</Label>
                      <Select value={pForm.relationship_type} onValueChange={(v) => setPForm({ ...pForm, relationship_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{REL_TYPES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Related Company</Label>
                      <Select value={pForm.related_company_id} onValueChange={(v) => setPForm({ ...pForm, related_company_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                        <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Tax ID</Label><Input value={pForm.tax_id} onChange={(e) => setPForm({ ...pForm, tax_id: e.target.value })} /></div>
                    <div><Label>Country</Label><Input value={pForm.country} onChange={(e) => setPForm({ ...pForm, country: e.target.value })} /></div>
                    <div className="col-span-2 flex items-center gap-2"><Switch checked={pForm.is_active} onCheckedChange={(v) => setPForm({ ...pForm, is_active: v })} /><Label>Active</Label></div>
                    <div className="col-span-2"><Label>Notes</Label><Textarea value={pForm.notes} onChange={(e) => setPForm({ ...pForm, notes: e.target.value })} /></div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" onClick={() => setPartyOpen(false)}>Cancel</Button>
                    <Button onClick={() => createParty.mutate()} disabled={createParty.isPending}>{createParty.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loadingP ? <Loader2 className="w-6 h-6 animate-spin" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Relationship</TableHead><TableHead>Company</TableHead><TableHead>Country</TableHead><TableHead>Tax ID</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {parties.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.party_name}</TableCell>
                        <TableCell>{p.relationship_type}</TableCell>
                        <TableCell>{p.related_company_id ? companyMap.get(p.related_company_id) : "—"}</TableCell>
                        <TableCell>{p.country ?? "—"}</TableCell>
                        <TableCell>{p.tax_id ?? "—"}</TableCell>
                        <TableCell>{p.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                        <TableCell><Button size="sm" variant="outline" onClick={() => toggleParty.mutate(p)}>{p.is_active ? "Deactivate" : "Reactivate"}</Button></TableCell>
                      </TableRow>
                    ))}
                    {parties.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No related parties yet.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Transactions</CardTitle>
              <Dialog open={txnOpen} onOpenChange={setTxnOpen}>
                <DialogTrigger asChild><Button disabled={parties.length === 0}><Plus className="w-4 h-4 mr-2" />New Transaction</Button></DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader><DialogTitle>Record Related-Party Transaction</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2"><Label>Related Party</Label>
                      <Select value={tForm.related_party_id} onValueChange={(v) => setTForm({ ...tForm, related_party_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Select party" /></SelectTrigger>
                        <SelectContent>{parties.filter(p => p.is_active).map(p => <SelectItem key={p.id} value={p.id}>{p.party_name} ({p.relationship_type})</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Reporting Company</Label>
                      <Select value={tForm.company_id} onValueChange={(v) => setTForm({ ...tForm, company_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                        <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Date</Label><DateInput  value={tForm.transaction_date} onChange={(e) => setTForm({ ...tForm, transaction_date: e.target.value })} /></div>
                    <div><Label>Type</Label>
                      <Select value={tForm.transaction_type} onValueChange={(v) => setTForm({ ...tForm, transaction_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{TXN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Amount</Label><Input type="number" step="0.01" value={tForm.amount} onChange={(e) => setTForm({ ...tForm, amount: e.target.value })} /></div>
                    <div><Label>Currency</Label><Input value={tForm.currency} onChange={(e) => setTForm({ ...tForm, currency: e.target.value })} /></div>
                    <div><Label>Disclosure Period</Label><Input value={tForm.disclosure_period} onChange={(e) => setTForm({ ...tForm, disclosure_period: e.target.value })} placeholder="YYYY or YYYY-MM" /></div>
                    <div className="col-span-2"><Label>Description</Label><Input value={tForm.description} onChange={(e) => setTForm({ ...tForm, description: e.target.value })} /></div>
                    <div className="col-span-2"><Label>Reference Document</Label><Input value={tForm.reference_document} onChange={(e) => setTForm({ ...tForm, reference_document: e.target.value })} placeholder="Invoice, contract, JE reference" /></div>
                    <div className="col-span-2 flex items-center gap-2"><Switch checked={tForm.arms_length} onCheckedChange={(v) => setTForm({ ...tForm, arms_length: v })} /><Label>Conducted at arm's length</Label></div>
                    <div className="col-span-2"><Label>Notes</Label><Textarea value={tForm.notes} onChange={(e) => setTForm({ ...tForm, notes: e.target.value })} /></div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" onClick={() => setTxnOpen(false)}>Cancel</Button>
                    <Button onClick={() => createTxn.mutate()} disabled={createTxn.isPending}>{createTxn.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loadingT ? <Loader2 className="w-6 h-6 animate-spin" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Ref</TableHead><TableHead>Arm's Length</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {txns.map(t => (
                      <TableRow key={t.id}>
                        <TableCell>{t.transaction_date}</TableCell>
                        <TableCell>{partyMap.get(t.related_party_id)?.party_name ?? "—"}</TableCell>
                        <TableCell>{t.transaction_type}</TableCell>
                        <TableCell className="max-w-sm truncate">{t.description}</TableCell>
                        <TableCell className="text-right">{fmt(t.amount)} {t.currency}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.reference_document ?? "—"}</TableCell>
                        <TableCell>{t.arms_length ? <Badge variant="secondary">Yes</Badge> : <Badge variant="destructive">No</Badge>}</TableCell>
                      </TableRow>
                    ))}
                    {txns.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No transactions recorded.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
