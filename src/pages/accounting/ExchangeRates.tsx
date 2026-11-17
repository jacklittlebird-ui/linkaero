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
import { Plus, Pencil, Trash2, Search, TrendingUp } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

type RateRow = {
  id: string;
  rate_date: string;
  base_currency: string;
  quote_currency: string;
  buy_rate?: number | null;
  sell_rate?: number | null;
  mid_rate: number;
  source?: string | null;
};

const CURRENCIES = ["EGP", "AED", "MAD", "JOD", "USD", "EUR", "SAR", "GBP", "CHF", "KWD"];

const emptyForm = () => ({
  rate_date: format(new Date(), "yyyy-MM-dd"),
  base_currency: "USD",
  quote_currency: "EGP",
  buy_rate: "",
  sell_rate: "",
  mid_rate: "",
  source: "Manual",
});

export default function ExchangeRatesPage() {
  const { t } = useTranslation();
  const { data, isLoading, add, update, remove } = useSupabaseTable<RateRow>("exchange_rates", { orderBy: "rate_date", ascending: false });
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<RateRow | null>(null);
  const [form, setForm] = useState(emptyForm());

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () => data.filter(r => !q || r.base_currency.toLowerCase().includes(q) || r.quote_currency.toLowerCase().includes(q) || (r.source ?? "").toLowerCase().includes(q)),
    [data, q],
  );

  const openAdd = () => { setEditItem(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (r: RateRow) => {
    setEditItem(r);
    setForm({
      rate_date: r.rate_date,
      base_currency: r.base_currency,
      quote_currency: r.quote_currency,
      buy_rate: r.buy_rate?.toString() ?? "",
      sell_rate: r.sell_rate?.toString() ?? "",
      mid_rate: r.mid_rate.toString(),
      source: r.source ?? "Manual",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const mid = parseFloat(form.mid_rate);
    if (!form.rate_date || !form.base_currency || !form.quote_currency || !isFinite(mid) || mid <= 0) {
      toast({ title: "Error", description: "Date, currencies and a valid mid rate are required", variant: "destructive" });
      return;
    }
    if (form.base_currency === form.quote_currency) {
      toast({ title: "Error", description: "Base and quote currency must differ", variant: "destructive" });
      return;
    }
    const payload: any = {
      rate_date: form.rate_date,
      base_currency: form.base_currency,
      quote_currency: form.quote_currency,
      mid_rate: mid,
      buy_rate: form.buy_rate === "" ? null : parseFloat(form.buy_rate),
      sell_rate: form.sell_rate === "" ? null : parseFloat(form.sell_rate),
      source: form.source || null,
    };
    if (editItem) await update({ id: editItem.id, ...payload });
    else await add(payload);
    setDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this exchange rate?")) return;
    await remove(id);
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><TrendingUp size={22} /> {t("accounting.exchangeRates")}</h1>
          <p className="text-muted-foreground text-sm">{t("accounting.exchangeRatesSubtitle")}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button onClick={openAdd}><Plus size={16} className="me-1" /> {t("common.add")}</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editItem ? t("common.edit") : t("common.add")} {t("accounting.exchangeRates")}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-xs font-medium">{t("accounting.date")} *</label>
                <DateInput  value={form.rate_date} onChange={e => setForm({ ...form, rate_date: e.target.value })} /></div>
              <div><label className="text-xs font-medium">{t("accounting.baseCurrency")} *</label>
                <Select value={form.base_currency} onValueChange={v => setForm({ ...form, base_currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><label className="text-xs font-medium">{t("accounting.quoteCurrency")} *</label>
                <Select value={form.quote_currency} onValueChange={v => setForm({ ...form, quote_currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><label className="text-xs font-medium">{t("accounting.midRate")} *</label>
                <Input type="number" step="0.000001" value={form.mid_rate} onChange={e => setForm({ ...form, mid_rate: e.target.value })} /></div>
              <div><label className="text-xs font-medium">{t("accounting.source")}</label>
                <Input value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></div>
              <div><label className="text-xs font-medium">{t("accounting.buyRate")}</label>
                <Input type="number" step="0.000001" value={form.buy_rate} onChange={e => setForm({ ...form, buy_rate: e.target.value })} /></div>
              <div><label className="text-xs font-medium">{t("accounting.sellRate")}</label>
                <Input type="number" step="0.000001" value={form.sell_rate} onChange={e => setForm({ ...form, sell_rate: e.target.value })} /></div>
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
                <TableHead>{t("accounting.date")}</TableHead>
                <TableHead>{t("accounting.baseCurrency")}</TableHead>
                <TableHead>{t("accounting.quoteCurrency")}</TableHead>
                <TableHead className="text-end">{t("accounting.midRate")}</TableHead>
                <TableHead className="text-end">{t("accounting.buyRate")}</TableHead>
                <TableHead className="text-end">{t("accounting.sellRate")}</TableHead>
                <TableHead>{t("accounting.source")}</TableHead>
                <TableHead className="text-end">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No exchange rates yet</TableCell></TableRow>
              )}
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.rate_date}</TableCell>
                  <TableCell><Badge variant="outline">{r.base_currency}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{r.quote_currency}</Badge></TableCell>
                  <TableCell className="text-end font-mono">{Number(r.mid_rate).toFixed(4)}</TableCell>
                  <TableCell className="text-end font-mono text-muted-foreground">{r.buy_rate != null ? Number(r.buy_rate).toFixed(4) : "—"}</TableCell>
                  <TableCell className="text-end font-mono text-muted-foreground">{r.sell_rate != null ? Number(r.sell_rate).toFixed(4) : "—"}</TableCell>
                  <TableCell className="text-xs">{r.source || "—"}</TableCell>
                  <TableCell className="text-end">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}><Trash2 size={14} className="text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
