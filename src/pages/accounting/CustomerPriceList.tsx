import { useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useTranslation } from "react-i18next";
import { useSupabaseTable } from "@/hooks/useSupabaseQuery";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SmartDropdown, type SmartOption } from "@/components/ui/smart-dropdown";
import { Plus, Pencil, Trash2, Search, Tag } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type PriceRow = {
  id: string;
  airline_id?: string | null;
  airline_iata?: string | null;
  service_type: string;
  station_code?: string | null;
  company_id?: string | null;
  unit_price: number;
  currency: string;
  unit: string;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
  status: string;
};

type AirlineRef = { id: string; iata_code?: string | null; name: string };
type StationRef = { id: string; code: string; name: string };
type CompanyRef = { id: string; code: string; name: string };

const CURRENCIES = ["EGP", "AED", "MAD", "JOD", "USD", "EUR", "SAR"];
const SERVICE_TYPES = ["Handling", "Security", "Catering", "Ramp", "Cargo", "VVIP", "Other"];
const UNITS = ["flight", "hour", "pax", "kg", "movement", "day"];

const emptyForm = () => ({
  airline_id: "", service_type: "Handling", station_code: "", company_id: "",
  unit_price: "", currency: "EGP", unit: "flight",
  start_date: "", end_date: "", notes: "", status: "Active",
});

export default function CustomerPriceListPage() {
  const { t } = useTranslation();
  const { data, isLoading, add, update, remove } = useSupabaseTable<PriceRow>("customer_price_list", { orderBy: "created_at", ascending: false });
  const { data: airlines } = useSupabaseTable<AirlineRef>("airlines", { orderBy: "name", ascending: true });
  const { data: stations } = useSupabaseTable<StationRef>("finance_stations", { orderBy: "code", ascending: true });
  const { data: companies } = useSupabaseTable<CompanyRef>("companies", { orderBy: "code", ascending: true });

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<PriceRow | null>(null);
  const [form, setForm] = useState(emptyForm());

  const airlineOptions: SmartOption[] = useMemo(
    () => airlines.map(a => ({ value: a.id, label: `${a.iata_code ?? ""} — ${a.name}`.replace(/^\s*—\s*/, ""), sub: a.iata_code ?? undefined })),
    [airlines],
  );
  const stationOptions: SmartOption[] = useMemo(
    () => stations.map(s => ({ value: s.code, label: `${s.code} — ${s.name}`, sub: s.code })),
    [stations],
  );
  const companyOptions: SmartOption[] = useMemo(
    () => companies.map(c => ({ value: c.id, label: `${c.code} — ${c.name}`, sub: c.code })),
    [companies],
  );

  const airlineById = useMemo(() => new Map(airlines.map(a => [a.id, a])), [airlines]);
  const companyById = useMemo(() => new Map(companies.map(c => [c.id, c])), [companies]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => data.filter(r => {
    if (!q) return true;
    const a = r.airline_id ? airlineById.get(r.airline_id) : null;
    return (a?.name ?? "").toLowerCase().includes(q)
      || (r.service_type ?? "").toLowerCase().includes(q)
      || (r.station_code ?? "").toLowerCase().includes(q)
      || (r.airline_iata ?? "").toLowerCase().includes(q);
  }), [data, q, airlineById]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (r: PriceRow) => {
    setEditItem(r);
    setForm({
      airline_id: r.airline_id ?? "", service_type: r.service_type, station_code: r.station_code ?? "",
      company_id: r.company_id ?? "", unit_price: r.unit_price?.toString() ?? "",
      currency: r.currency, unit: r.unit,
      start_date: r.start_date ?? "", end_date: r.end_date ?? "",
      notes: r.notes ?? "", status: r.status,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const price = parseFloat(form.unit_price);
    if (!form.service_type || !form.unit || !isFinite(price) || price < 0) {
      toast({ title: "Error", description: "Service Type, Unit and a valid Unit Price are required", variant: "destructive" });
      return;
    }
    const airline = form.airline_id ? airlineById.get(form.airline_id) : null;
    const payload: any = {
      airline_id: form.airline_id || null,
      airline_iata: airline?.iata_code || null,
      service_type: form.service_type,
      station_code: form.station_code || null,
      company_id: form.company_id || null,
      unit_price: price,
      currency: form.currency,
      unit: form.unit,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      notes: form.notes || null,
      status: form.status,
    };
    if (editItem) await update({ id: editItem.id, ...payload });
    else await add(payload);
    setDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this price entry?")) return;
    await remove(id);
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Tag size={22} /> {t("accounting.customerPriceList")}</h1>
          <p className="text-muted-foreground text-sm">{t("accounting.customerPriceListSubtitle")}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button onClick={openAdd}><Plus size={16} className="me-1" /> {t("common.add")}</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editItem ? t("common.edit") : t("common.add")} {t("accounting.customerPriceList")}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-xs font-medium">{t("accounting.airline")}</label>
                <SmartDropdown options={airlineOptions} value={form.airline_id} onChange={v => setForm({ ...form, airline_id: v })} placeholder="Select airline..." /></div>
              <div><label className="text-xs font-medium">{t("accounting.serviceType")} *</label>
                <Select value={form.service_type} onValueChange={v => setForm({ ...form, service_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SERVICE_TYPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><label className="text-xs font-medium">{t("accounting.station")}</label>
                <SmartDropdown options={stationOptions} value={form.station_code} onChange={v => setForm({ ...form, station_code: v })} placeholder="Any station" /></div>
              <div><label className="text-xs font-medium">{t("accounting.company")}</label>
                <SmartDropdown options={companyOptions} value={form.company_id} onChange={v => setForm({ ...form, company_id: v })} placeholder="Any company" /></div>
              <div><label className="text-xs font-medium">{t("accounting.currency")} *</label>
                <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><label className="text-xs font-medium">{t("accounting.unitPrice")} *</label>
                <Input type="number" step="0.01" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} /></div>
              <div><label className="text-xs font-medium">{t("accounting.unit")} *</label>
                <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><label className="text-xs font-medium">{t("accounting.startDate")}</label>
                <DateInput  value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
              <div><label className="text-xs font-medium">{t("accounting.endDate")}</label>
                <DateInput  value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
              <div className="col-span-2"><label className="text-xs font-medium">Notes</label>
                <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              <div><label className="text-xs font-medium">{t("common.status")}</label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">{t("common.active")}</SelectItem>
                    <SelectItem value="Inactive">{t("common.inactive")}</SelectItem>
                  </SelectContent>
                </Select></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
              <Button onClick={handleSave}>{t("common.save")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-muted-foreground" />
            <Input placeholder={t("common.search") + "..."} value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("accounting.airline")}</TableHead>
                <TableHead>{t("accounting.serviceType")}</TableHead>
                <TableHead>{t("accounting.station")}</TableHead>
                <TableHead>{t("accounting.company")}</TableHead>
                <TableHead className="text-end">{t("accounting.unitPrice")}</TableHead>
                <TableHead>{t("accounting.currency")}</TableHead>
                <TableHead>{t("accounting.unit")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-end">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No prices yet</TableCell></TableRow>
              )}
              {filtered.map(r => {
                const a = r.airline_id ? airlineById.get(r.airline_id) : null;
                const c = r.company_id ? companyById.get(r.company_id) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{a ? `${a.iata_code ?? ""} ${a.name}`.trim() : r.airline_iata || "—"}</TableCell>
                    <TableCell>{r.service_type}</TableCell>
                    <TableCell className="font-mono text-xs">{r.station_code || "—"}</TableCell>
                    <TableCell className="text-xs">{c?.code || "—"}</TableCell>
                    <TableCell className="text-end font-mono">{Number(r.unit_price).toFixed(2)}</TableCell>
                    <TableCell><Badge variant="outline">{r.currency}</Badge></TableCell>
                    <TableCell className="text-xs">{r.unit}</TableCell>
                    <TableCell><Badge variant={r.status === "Active" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}><Trash2 size={14} className="text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
