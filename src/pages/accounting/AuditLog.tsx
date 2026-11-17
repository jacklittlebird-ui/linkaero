// Phase 2b — Audit Log Viewer
// -------------------------------------------------------------
// Unified viewer for finance_audit_log and migration_audit_log with
// filtering by entity, actor, action, and date range. Row expansion
// shows a before/after JSON diff.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollText, Download, Eye, Filter } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";
import { format } from "date-fns";

type Tab = "finance" | "migration";
type Json = unknown;

interface FinanceRow {
  id: string;
  created_at: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  reason: string | null;
  before_data: Json | null;
  after_data: Json | null;
}
interface MigrationRow {
  id: string;
  migrated_at: string;
  entity_name: string;
  record_id: string | null;
  column_name: string | null;
  action: string;
  migrated_by: string | null;
  old_value: Json | null;
  new_value: Json | null;
}

const ACTION_VARIANT = (a: string): "default" | "secondary" | "destructive" | "outline" => {
  const s = (a || "").toLowerCase();
  if (s.includes("delete") || s.includes("void") || s.includes("reject")) return "destructive";
  if (s.includes("update") || s.includes("patch")) return "secondary";
  if (s.includes("insert") || s.includes("create") || s.includes("approve") || s.includes("post")) return "default";
  return "outline";
};

export default function AuditLogPage() {
  const [tab, setTab] = useState<Tab>("finance");
  const [entity, setEntity] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<{ before: Json; after: Json; title: string } | null>(null);

  const finance = useQuery({
    queryKey: ["finance_audit_log"],
    enabled: tab === "finance",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as FinanceRow[];
    },
  });

  const migration = useQuery({
    queryKey: ["migration_audit_log"],
    enabled: tab === "migration",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("migration_audit_log")
        .select("*")
        .order("migrated_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as MigrationRow[];
    },
  });

  const financeActions = useMemo(
    () => Array.from(new Set((finance.data ?? []).map((r) => r.action))).sort(),
    [finance.data],
  );
  const migrationActions = useMemo(
    () => Array.from(new Set((migration.data ?? []).map((r) => r.action))).sort(),
    [migration.data],
  );

  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    if (from && t < new Date(from).getTime()) return false;
    if (to && t > new Date(to).getTime() + 86400000) return false;
    return true;
  };

  const financeFiltered = useMemo(() => {
    return (finance.data ?? []).filter((r) => {
      if (entity && !`${r.entity_type} ${r.entity_id}`.toLowerCase().includes(entity.toLowerCase())) return false;
      if (actor && !`${r.actor_name ?? ""} ${r.actor_id ?? ""}`.toLowerCase().includes(actor.toLowerCase())) return false;
      if (action !== "all" && r.action !== action) return false;
      if (!inRange(r.created_at)) return false;
      return true;
    });
  }, [finance.data, entity, actor, action, from, to]);

  const migrationFiltered = useMemo(() => {
    return (migration.data ?? []).filter((r) => {
      if (entity && !`${r.entity_name} ${r.record_id ?? ""}`.toLowerCase().includes(entity.toLowerCase())) return false;
      if (actor && !(r.migrated_by ?? "").toLowerCase().includes(actor.toLowerCase())) return false;
      if (action !== "all" && r.action !== action) return false;
      if (!inRange(r.migrated_at)) return false;
      return true;
    });
  }, [migration.data, entity, actor, action, from, to]);

  const exportRows = () => {
    if (tab === "finance") {
      exportToExcel(
        financeFiltered.map((r) => ({
          When: format(new Date(r.created_at), "dd/MM/yyyy HH:mm"),
          Entity: r.entity_type,
          "Entity ID": r.entity_id,
          Action: r.action,
          Actor: r.actor_name || r.actor_id || "",
          Reason: r.reason || "",
        })),
        "Finance Audit Log",
        `finance-audit-${format(new Date(), "yyyyMMdd")}.xlsx`,
      );
    } else {
      exportToExcel(
        migrationFiltered.map((r) => ({
          When: format(new Date(r.migrated_at), "dd/MM/yyyy HH:mm"),
          Entity: r.entity_name,
          "Record ID": r.record_id || "",
          Column: r.column_name || "",
          Action: r.action,
          "Migrated By": r.migrated_by || "",
        })),
        "Migration Audit Log",
        `migration-audit-${format(new Date(), "yyyyMMdd")}.xlsx`,
      );
    }
  };

  const actionsList = tab === "finance" ? financeActions : migrationActions;

  const kpis = useMemo(() => {
    const list = tab === "finance" ? financeFiltered : migrationFiltered;
    const uniqueActors = new Set(
      list.map((r) =>
        tab === "finance"
          ? (r as FinanceRow).actor_id ?? (r as FinanceRow).actor_name ?? ""
          : (r as MigrationRow).migrated_by ?? "",
      ),
    );
    const uniqueEntities = new Set(
      list.map((r) =>
        tab === "finance" ? (r as FinanceRow).entity_type : (r as MigrationRow).entity_name,
      ),
    );
    return { total: list.length, actors: uniqueActors.size, entities: uniqueEntities.size };
  }, [tab, financeFiltered, migrationFiltered]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="h-6 w-6" /> Audit Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Trace who did what and when across finance and data-migration events.
          </p>
        </div>
        <Button variant="outline" onClick={exportRows}>
          <Download className="h-4 w-4 mr-2" /> Export
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Events</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.total}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Distinct Actors</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.actors}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Distinct Entities</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.entities}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Filter className="h-4 w-4" /> Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div>
            <Label>Entity contains</Label>
            <Input value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="e.g. invoice" />
          </div>
          <div>
            <Label>Actor contains</Label>
            <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="name or id" />
          </div>
          <div>
            <Label>Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actionsList.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>From</Label>
            <DateInput  value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <DateInput  value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setAction("all"); }}>
        <TabsList>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="migration">Migrations</TabsTrigger>
        </TabsList>

        <TabsContent value="finance" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {financeFiltered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No events.</TableCell></TableRow>
                  ) : financeFiltered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{format(new Date(r.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                      <TableCell><span className="font-mono text-xs">{r.entity_type}</span><div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.entity_id}</div></TableCell>
                      <TableCell><Badge variant={ACTION_VARIANT(r.action)}>{r.action}</Badge></TableCell>
                      <TableCell>{r.actor_name || <span className="text-muted-foreground font-mono text-xs">{r.actor_id}</span>}</TableCell>
                      <TableCell className="max-w-xs truncate" title={r.reason || ""}>{r.reason || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline"
                          onClick={() => setSelected({ before: r.before_data, after: r.after_data, title: `${r.entity_type} · ${r.action}` })}>
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="migration" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Column</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Migrated By</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {migrationFiltered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No events.</TableCell></TableRow>
                  ) : migrationFiltered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{format(new Date(r.migrated_at), "dd/MM/yyyy HH:mm")}</TableCell>
                      <TableCell><span className="font-mono text-xs">{r.entity_name}</span><div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.record_id}</div></TableCell>
                      <TableCell className="font-mono text-xs">{r.column_name || "—"}</TableCell>
                      <TableCell><Badge variant={ACTION_VARIANT(r.action)}>{r.action}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{r.migrated_by || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline"
                          onClick={() => setSelected({ before: r.old_value, after: r.new_value, title: `${r.entity_name} · ${r.column_name || r.action}` })}>
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">BEFORE</div>
              <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-[60vh]">
                {selected?.before ? JSON.stringify(selected.before, null, 2) : "—"}
              </pre>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">AFTER</div>
              <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-[60vh]">
                {selected?.after ? JSON.stringify(selected.after, null, 2) : "—"}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
