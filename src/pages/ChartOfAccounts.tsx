import { useState, useMemo } from "react";
import { useSupabaseTable } from "@/hooks/useSupabaseQuery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Pencil, Trash2, ChevronRight, ChevronDown, FolderTree, Download } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { toast } from "@/hooks/use-toast";

type AccountRow = {
  id: string; code: string; name: string; name_ar: string; account_type: string;
  parent_id: string | null; level: number; is_group: boolean;
  opening_balance: number; current_balance: number; currency: string;
  description: string; status: string;
};

const TYPE_COLORS: Record<string, string> = {
  Asset: "bg-blue-100 text-blue-800",
  Liability: "bg-red-100 text-red-800",
  Equity: "bg-purple-100 text-purple-800",
  Revenue: "bg-green-100 text-green-800",
  Expense: "bg-orange-100 text-orange-800",
};

export default function ChartOfAccountsPage() {
  const { data, isLoading, add, update, remove } = useSupabaseTable<AccountRow>("chart_of_accounts", { orderBy: "code", ascending: true });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<AccountRow | null>(null);
  const emptyForm = { code: "", name: "", name_ar: "", account_type: "Asset", parent_id: "", level: 1, is_group: false, opening_balance: 0, currency: "USD", description: "", status: "Active" };
  const [form, setForm] = useState<any>(emptyForm);

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Build tree
  const tree = useMemo(() => {
    const roots: AccountRow[] = [];
    const childrenMap: Record<string, AccountRow[]> = {};
    data.forEach(a => {
      if (a.parent_id) {
        if (!childrenMap[a.parent_id]) childrenMap[a.parent_id] = [];
        childrenMap[a.parent_id].push(a);
      } else {
        roots.push(a);
      }
    });
    return { roots, childrenMap };
  }, [data]);

  const filtered = search || typeFilter !== "all"
    ? data.filter(a => {
        const ms = a.name.toLowerCase().includes(search.toLowerCase()) || a.code.includes(search) || a.name_ar.includes(search);
        const mt = typeFilter === "all" || a.account_type === typeFilter;
        return ms && mt;
      })
    : null;

  const groupAccounts = data.filter(a => a.is_group);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (a: AccountRow) => { setEditItem(a); setForm({ code: a.code, name: a.name, name_ar: a.name_ar, account_type: a.account_type, parent_id: a.parent_id || "", level: a.level, is_group: a.is_group, opening_balance: a.opening_balance, currency: a.currency, description: a.description, status: a.status }); setDialogOpen(true); };

  const handleSave = async () => {
    if (!form.code || !form.name) { toast({ title: "Error", description: "Code and name required", variant: "destructive" }); return; }
    if (!form.parent_id && !(editItem && !editItem.parent_id)) {
      toast({ title: "Parent account required", description: "يجب ربط الحساب بحساب رئيسي/فرعي (ميزانية أو قائمة دخل)", variant: "destructive" });
      return;
    }
    const payload: any = { ...form, opening_balance: Number(form.opening_balance) || 0 };
    if (!payload.parent_id) payload.parent_id = null;
    const parent = data.find(a => a.id === payload.parent_id);
    if (parent) { payload.account_type = parent.account_type; payload.level = (parent.level || 0) + 1; }
    if (editItem) { await update({ id: editItem.id, ...payload }); } else { await add(payload); }
    setDialogOpen(false);
  };

  const renderRow = (account: AccountRow, depth: number = 0) => {
    const children = tree.childrenMap[account.id] || [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(account.id);
    const rows: React.ReactNode[] = [];

    rows.push(
      <TableRow key={account.id} className={account.is_group ? "bg-muted/30 font-medium" : ""}>
        <TableCell>
          <div className="flex items-center" style={{ paddingLeft: depth * 20 }}>
            {hasChildren ? (
              <button onClick={() => toggleExpand(account.id)} className="mr-1 p-0.5 hover:bg-muted rounded">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : <span className="w-5" />}
            <span className="font-mono text-xs text-muted-foreground mr-2">{account.code}</span>
          </div>
        </TableCell>
        <TableCell className={account.is_group ? "font-semibold" : ""}>{account.name}</TableCell>
        <TableCell className="text-muted-foreground text-sm">{account.name_ar}</TableCell>
        <TableCell><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[account.account_type] || ""}`}>{account.account_type}</span></TableCell>
        <TableCell className="text-right font-mono text-sm">{account.is_group ? "" : (account.current_balance ?? 0).toLocaleString()}</TableCell>
        <TableCell>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={() => openEdit(account)}><Pencil size={14} /></Button>
            {!account.is_group && <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(account.id)}><Trash2 size={14} /></Button>}
          </div>
        </TableCell>
      </TableRow>
    );

    if (hasChildren && isExpanded) {
      children.forEach(child => rows.push(...(renderRow(child, depth + 1) as any)));
    }
    return rows;
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  // Stats
  const typeCounts = ["Asset", "Liability", "Equity", "Revenue", "Expense"].map(t => ({
    type: t, count: data.filter(a => a.account_type === t && !a.is_group).length,
    total: data.filter(a => a.account_type === t && !a.is_group).reduce((s, a) => s + a.current_balance, 0),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Chart of Accounts</h1>
          <p className="text-muted-foreground text-sm">شجرة الحسابات · {data.length} accounts</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            exportToExcel(data.filter(a => !a.is_group).map(a => ({
              Code: a.code, Name: a.name, "Name AR": a.name_ar, Type: a.account_type,
              Balance: a.current_balance, "Opening Balance": a.opening_balance, Currency: a.currency, Status: a.status,
            })), "Chart of Accounts", "chart_of_accounts.xlsx");
            toast({ title: "Exported", description: "Chart of accounts exported." });
          }}><Download size={14} className="mr-1" /> Export</Button>
          <Button variant="outline" onClick={() => setExpanded(new Set(data.filter(a => a.is_group).map(a => a.id)))}>Expand All</Button>
          <Button variant="outline" onClick={() => setExpanded(new Set())}>Collapse All</Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild><Button onClick={openAdd}><Plus size={16} className="mr-1" /> Add Account</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editItem ? "Edit Account" : "Add Account"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="text-xs text-muted-foreground">Code</label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
                  <div className="col-span-2"><label className="text-xs text-muted-foreground">Name (EN)</label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                </div>
                <div><label className="text-xs text-muted-foreground">الاسم بالعربي</label><Input value={form.name_ar} onChange={e => setForm({ ...form, name_ar: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Account Type</label>
                    <Select value={form.account_type} onValueChange={v => setForm({ ...form, account_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{["Asset", "Equity", "Expense", "Liability", "Revenue"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Parent Account (required) — الحساب الرئيسي</label>
                    <Select value={form.parent_id || "none"} onValueChange={v => {
                      const p = data.find(a => a.id === v);
                      setForm({ ...form, parent_id: v === "none" ? "" : v, ...(p ? { account_type: p.account_type, level: (p.level || 0) + 1 } : {}) });
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{editItem && !editItem.parent_id && <SelectItem value="none">No Parent (Root)</SelectItem>}{groupAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="text-xs text-muted-foreground">Level</label><Input type="number" value={form.level} onChange={e => setForm({ ...form, level: parseInt(e.target.value) || 1 })} min={1} /></div>
                  <div>
                    <label className="text-xs text-muted-foreground">Currency</label>
                    <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="EGP">EGP</SelectItem><SelectItem value="EUR">EUR</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><label className="text-xs text-muted-foreground">Opening Balance</label><Input type="number" value={form.opening_balance} onChange={e => setForm({ ...form, opening_balance: e.target.value })} /></div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_group} onChange={e => setForm({ ...form, is_group: e.target.checked })} id="is_group" />
                  <label htmlFor="is_group" className="text-sm">Group Account (حساب تجميعي)</label>
                </div>
                <div><label className="text-xs text-muted-foreground">Description</label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                <Button className="w-full" onClick={handleSave}>{editItem ? "Update" : "Add"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Type summary cards */}
      <div className="grid grid-cols-5 gap-3">
        {typeCounts.map(t => (
          <Card key={t.type} className="cursor-pointer" onClick={() => setTypeFilter(typeFilter === t.type ? "all" : t.type)}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{t.type}</p>
              <p className="text-lg font-bold">{t.count}</p>
              <p className="text-xs font-mono text-muted-foreground">{t.total.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={16} /><Input placeholder="Search accounts…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Types</SelectItem>{["Asset", "Equity", "Expense", "Liability", "Revenue"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Code</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered
                ? filtered.map(a => renderRow(a, 0)).flat()
                : tree.roots.map(a => renderRow(a, 0)).flat()
              }
              {(filtered ? filtered.length : tree.roots.length) === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No accounts found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
