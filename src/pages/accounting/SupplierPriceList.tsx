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
import { Plus, Pencil, Trash2, Search, Truck } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type PriceRow = {
  id: string;
  supplier_id?: string | null;
  service_type: string;
  station_code?: string | null;
  company_id?: string | null;
  unit_cost: number;
  currency: string;
  unit: string;
  tax_rate: number;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
  status: string;
};

type SupplierRef = { id: string; name: string; code?: string | null };
type StationRef = { id: string; code: string; name: string };
type CompanyRef = { id: string; code: string; name: string };

const CURRENCIES = ["EGP", "AED", "MAD", "JOD", "USD", "EUR", "SAR"];
const SERVICE_TYPES = ["Handling", "Security", "Catering", "Ramp", "Cargo", "Fuel", "VVIP", "Other"];
const UNITS = ["flight", "hour", "pax", "kg", "movement", "day", "month"];

const emptyForm = () => ({
  supplier_id: "", service_type: "Handling", station_code: "", company_id: "",
  unit_cost: "", currency: "EGP", unit: "flight", tax_rate: "0",
  start_date: "", end_date: "", notes: "", status: "Active",
});

export default function SupplierPriceListPage() {
  const { t } = useTranslation();
  const { data, isLoading, add, update, remove } = useSupabaseTable<PriceRow>("supplier_price_list", { orderBy: "created_at", ascending: false });
  const { data: suppliers } = useSupabaseTable<SupplierRef>("service_providers", { orderBy: "name", ascending: true });
  const { data: stations } = useSupabaseTable<StationRef>("finance_stations", { orderBy: "code", ascending: true });
  const { data: companies } = useSupabaseTable<CompanyRef>("companies", { orderBy: "code", ascending: true });

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<PriceRow | null>(null);
  const [form, setForm] = useState(emptyForm());

  const supplierOptions: SmartOption[] = useMemo(
    () => suppliers.map(s => ({ value: s.id, label: s.name, sub: s.code ?? undefined })),
    [suppliers],
  );
  const stationOptions: SmartOption[] = useMemo(
    () => stations.map(s => ({ value: s.code, label: `${s.code} — ${s.name}`, sub: s.code })),
    [stations],
  );
  const companyOptions: SmartOption[] = useMemo(
    () => companies.map(c => ({ value: c.id, label: `${c.code} — ${c.name}`, sub: c.code })),
    [companies],
  );

  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);
  const companyById = useMemo(() => new Map(companies.map(c => [c.id, c])), [companies]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => data.filter(r => {
    if (!q) return true;
    const s = r.supplier_id ? supplierById.get(r.supplier_id) : null;
    return (s?.name ?? "").toLowerCase().includes(q)
      || (r.service_type ?? "").toLowerCase().includes(q)
      || (r.station_code ?? "").toLowerCase().includes(q);
  }), [data, q, supplierById]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (r: PriceRow) => {
    setEditItem(r);
    setForm({
      supplier_id: r.supplier_id ?? "", service_type: r.service_type,
      station_code: r.station_code ?? "", company_id: r.company_id ?? "",
      unit_cost: r.unit_cost?.toString() ?? "", currency: r.currency, unit: r.unit,
      tax_rate: r.tax_rate?.toString() ?? "0",
      start_date: r.start_date ?? "", end_date: r.end_date ?? "",
      notes: r.notes ?? "", status: r.status,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const cost = parseFloat(form.unit_cost);
    const tax = parseFloat(form.tax_rate || "0");
    if (!form.service_type || !form.unit || !isFinite(cost) || cost < 0) {
      toast({ title: "Error", description: "Service Type, Unit and a valid Unit Cost are required", variant: "destructive" });
      return;
    }
    const payload: any = {
      supplier_id: form.supplier_id || null,
      service_type: form.service_type,
      station_code: form.station_code || null,
      company_id: form.company_id || null,
      unit_cost: cost,
      currency: form.currency,
      unit: form.unit,
      tax_rate: isFinite(tax) ? tax : 0,
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
    if (!confirm("Delete this cost entry?")) return;
    await remove(id);
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Truck size={22} /> {t("accounting.supplierPriceList")}</h1>
          <p className="text-muted-foreground text-sm">{t("accounting.supplierPriceListSubtitle")}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button onClick={openAdd}><Plus size={16} className="me-1" /> {t("common.add")}</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editItem ? t("common.edit") : t("common.add")} {t("accounting.supplierPriceList")}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-xs font-medium">{t("accounting.supplier")}</label>
                <SmartDropdown options={supplierOptions} value={form.supplier_id} onChange={v => setForm({ ...form, supplier_id: v })} placeholder="Select supplier..." /></div>
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
              <div><label className="text-xs font-medium">Unit Cost *</label>
                <Input type="number" step="0.01" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} /></div>
              <div><label className="text-xs font-medium">{t("accounting.unit")} *</label>
                <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><label className="text-xs font-medium">Tax Rate %</label>
                <Input type="number" step="0.01" value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })} /></div>
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
                <TableHead>{t("accounting.supplier")}</TableHead>
                <TableHead>{t("accounting.serviceType")}</TableHead>
                <TableHead>{t("accounting.station")}</TableHead>
                <TableHead>{t("accounting.company")}</TableHead>
                <TableHead className="text-end">Unit Cost</TableHead>
                <TableHead>{t("accounting.currency")}</TableHead>
                <TableHead>{t("accounting.unit")}</TableHead>
                <TableHead className="text-end">Tax %</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-end">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No costs yet</TableCell></TableRow>
              )}
              {filtered.map(r => {
                const s = r.supplier_id ? supplierById.get(r.supplier_id) : null;
                const c = r.company_id ? companyById.get(r.company_id) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{s?.name || "—"}</TableCell>
                    <TableCell>{r.service_type}</TableCell>
                    <TableCell className="font-mono text-xs">{r.station_code || "—"}</TableCell>
                    <TableCell className="text-xs">{c?.code || "—"}</TableCell>
                    <TableCell className="text-end font-mono">{Number(r.unit_cost).toFixed(2)}</TableCell>
                    <TableCell><Badge variant="outline">{r.currency}</Badge></TableCell>
                    <TableCell className="text-xs">{r.unit}</TableCell>
                    <TableCell className="text-end font-mono text-xs">{Number(r.tax_rate || 0).toFixed(2)}</TableCell>
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
