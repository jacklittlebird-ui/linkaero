// Bank Reconciliation Workbench (Phase 2h)
// -------------------------------------------------------------
// Side-by-side view: uploaded/pasted bank statement lines on the left,
// unreconciled system ledger (payments + receipts) on the right.
// - Auto-suggest matches by amount within tolerance and ±5 day window.
// - One-click match flags a ledger entry with the current reconciliation_id.
// - Recalc button calls recalc_bank_reconciliation(_id) RPC.

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, Wand2, Link2, Unlink, Save, Upload } from "lucide-react";
import { format, differenceInDays } from "date-fns";

interface LedgerRow {
  kind: "payment" | "receipt";
  id: string;
  ref: string;
  date: string;
  party: string;
  amount: number; // signed (payment negative, receipt positive)
  currency: string;
  reconciliation_id: string | null;
}

interface StmtLine {
  id: string;
  date: string;
  description: string;
  amount: number; // signed
  matched_ledger_id?: string;
}

const money = (n: number, c = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: c || "USD" }).format(n || 0);

const uid = () => Math.random().toString(36).slice(2, 10);

export default function BankReconciliationPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [statementDate, setStatementDate] = useState<string>(
    format(new Date(), "yyyy-MM-dd")
  );
  const [statementBalance, setStatementBalance] = useState<number>(0);
  const [tolerance, setTolerance] = useState<number>(0.5);
  const [pasteText, setPasteText] = useState("");
  const [stmtLines, setStmtLines] = useState<StmtLine[]>([]);
  const [recId, setRecId] = useState<string | null>(null);

  const banksQuery = useQuery({
    queryKey: ["bank-accounts-active"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_accounts")
        .select("id, account_name, bank_name, currency, opening_balance")
        .order("account_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const ledgerQuery = useQuery({
    queryKey: ["bank-ledger", bankAccountId, statementDate],
    enabled: !!session && !!bankAccountId,
    queryFn: async () => {
      const [pay, rec] = await Promise.all([
        supabase
          .from("payments")
          .select("id, payment_no, payment_date, vendor_name, amount, currency, status, reconciliation_id")
          .eq("bank_account_id", bankAccountId)
          .lte("payment_date", statementDate)
          .eq("status", "Posted"),
        supabase
          .from("receipts")
          .select("id, receipt_no, receipt_date, customer_name, amount, currency, status, reconciliation_id")
          .eq("bank_account_id", bankAccountId)
          .lte("receipt_date", statementDate)
          .eq("status", "Posted"),
      ]);
      const rows: LedgerRow[] = [];
      (pay.data || []).forEach((r: any) =>
        rows.push({
          kind: "payment",
          id: r.id,
          ref: r.payment_no,
          date: r.payment_date,
          party: r.vendor_name || "-",
          amount: -Number(r.amount ?? 0),
          currency: r.currency || "USD",
          reconciliation_id: r.reconciliation_id,
        })
      );
      (rec.data || []).forEach((r: any) =>
        rows.push({
          kind: "receipt",
          id: r.id,
          ref: r.receipt_no,
          date: r.receipt_date,
          party: r.customer_name || "-",
          amount: Number(r.amount ?? 0),
          currency: r.currency || "USD",
          reconciliation_id: r.reconciliation_id,
        })
      );
      rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return rows;
    },
  });

  const ledger = ledgerQuery.data ?? [];
  const unreconciledLedger = ledger.filter((r) => !r.reconciliation_id);
  const reconciledLedger = ledger.filter((r) => r.reconciliation_id);

  // --- Open / create reconciliation
  const openReconciliation = useMutation({
    mutationFn: async () => {
      if (!bankAccountId) throw new Error("Select a bank account");
      const { data: existing } = await supabase
        .from("bank_reconciliations")
        .select("*")
        .eq("bank_account_id", bankAccountId)
        .eq("statement_date", statementDate)
        .maybeSingle();

      let row = existing;
      if (!row) {
        const { data, error } = await supabase
          .from("bank_reconciliations")
          .insert({
            bank_account_id: bankAccountId,
            statement_date: statementDate,
            statement_balance: statementBalance,
            status: "draft",
          })
          .select("*")
          .single();
        if (error) throw error;
        row = data;
      } else {
        await supabase
          .from("bank_reconciliations")
          .update({ statement_balance: statementBalance })
          .eq("id", row.id);
      }

      const { data: recalced } = await supabase.rpc("recalc_bank_reconciliation", { _id: row.id });
      return recalced ?? row;
    },
    onSuccess: (row: any) => {
      setRecId(row.id);
      toast.success("Reconciliation opened");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // --- Match ledger row → statement line
  const matchMutation = useMutation({
    mutationFn: async ({ ledger, stmt }: { ledger: LedgerRow; stmt: StmtLine }) => {
      if (!recId) throw new Error("Open the reconciliation first");
      const table = ledger.kind === "payment" ? "payments" : "receipts";
      const { error } = await supabase
        .from(table)
        .update({ reconciliation_id: recId, reconciled_at: new Date().toISOString() })
        .eq("id", ledger.id);
      if (error) throw error;
      setStmtLines((ls) =>
        ls.map((l) => (l.id === stmt.id ? { ...l, matched_ledger_id: ledger.id } : l))
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bank-ledger", bankAccountId, statementDate] });
      if (recId) await supabase.rpc("recalc_bank_reconciliation", { _id: recId });
      toast.success("Matched");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unmatchMutation = useMutation({
    mutationFn: async (row: LedgerRow) => {
      const table = row.kind === "payment" ? "payments" : "receipts";
      const { error } = await supabase
        .from(table)
        .update({ reconciliation_id: null, reconciled_at: null })
        .eq("id", row.id);
      if (error) throw error;
      setStmtLines((ls) =>
        ls.map((l) => (l.matched_ledger_id === row.id ? { ...l, matched_ledger_id: undefined } : l))
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bank-ledger", bankAccountId, statementDate] });
      if (recId) await supabase.rpc("recalc_bank_reconciliation", { _id: recId });
      toast.success("Unmatched");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // --- Parse pasted statement (CSV: date,description,amount)
  const parsePaste = () => {
    const lines = pasteText.split(/\r?\n/).filter((l) => l.trim());
    const parsed: StmtLine[] = [];
    for (const l of lines) {
      const parts = l.split(/[,\t;]/).map((s) => s.trim());
      if (parts.length < 3) continue;
      const [date, description, amountStr] = parts;
      const amount = Number(amountStr.replace(/[^0-9.\-]/g, ""));
      if (isNaN(amount)) continue;
      parsed.push({ id: uid(), date, description, amount });
    }
    if (!parsed.length) {
      toast.error("Could not parse any lines. Format: YYYY-MM-DD, description, amount");
      return;
    }
    setStmtLines((prev) => [...prev, ...parsed]);
    setPasteText("");
    toast.success(`Added ${parsed.length} statement lines`);
  };

  const clearStmt = () => setStmtLines([]);

  // --- Auto-suggest: match each unmatched statement line to nearest unreconciled ledger row
  const autoSuggest = () => {
    if (!recId) return toast.error("Open the reconciliation first");
    const available = unreconciledLedger.slice();
    const claimed = new Set<string>();
    const suggestions: { stmt: StmtLine; ledger: LedgerRow }[] = [];
    for (const s of stmtLines.filter((l) => !l.matched_ledger_id)) {
      const cand = available
        .filter((l) => !claimed.has(l.id))
        .filter((l) => Math.abs(l.amount - s.amount) <= tolerance)
        .sort(
          (a, b) =>
            Math.abs(differenceInDays(new Date(a.date), new Date(s.date))) -
            Math.abs(differenceInDays(new Date(b.date), new Date(s.date)))
        )[0];
      if (cand && Math.abs(differenceInDays(new Date(cand.date), new Date(s.date))) <= 5) {
        claimed.add(cand.id);
        suggestions.push({ stmt: s, ledger: cand });
      }
    }
    if (!suggestions.length) return toast.info("No confident matches found");
    Promise.all(suggestions.map((p) => matchMutation.mutateAsync(p))).then(() =>
      toast.success(`Auto-matched ${suggestions.length} lines`)
    );
  };

  // --- KPIs
  const stmtIn = stmtLines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
  const stmtOut = stmtLines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0);
  const bank = banksQuery.data?.find((b) => b.id === bankAccountId);
  const currency = bank?.currency || "USD";
  const openingBal = Number(bank?.opening_balance ?? 0);
  const sysBalance =
    openingBal + ledger.reduce((s, r) => s + r.amount, 0);
  const diff = statementBalance - sysBalance;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bank Reconciliation Workbench</h1>
        <p className="text-sm text-muted-foreground">
          Match imported statement lines to posted payments and receipts. Auto-suggest by amount
          and date, then flag matched ledger entries with the current reconciliation.
        </p>
      </div>

      {/* Setup */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Select Statement</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-2">
            <Label>Bank Account</Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger><SelectValue placeholder="Select bank account" /></SelectTrigger>
              <SelectContent>
                {(banksQuery.data ?? []).map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.account_name} — {b.bank_name} ({b.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Statement Date</Label>
            <DateInput  value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
          </div>
          <div>
            <Label>Statement Balance</Label>
            <Input
              type="number"
              value={statementBalance}
              onChange={(e) => setStatementBalance(Number(e.target.value))}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => openReconciliation.mutate()} disabled={!bankAccountId}>
              <Save className="h-4 w-4 mr-1" /> Open / Recalc
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Statement Balance</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold">{money(statementBalance, currency)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">System Balance</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold">{money(sysBalance, currency)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Difference</CardTitle></CardHeader>
          <CardContent className={`text-xl font-bold ${Math.abs(diff) < 0.01 ? "text-emerald-600" : "text-rose-600"}`}>
            {money(diff, currency)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Matched / Total</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold">
            {reconciledLedger.length} / {ledger.length}
          </CardContent>
        </Card>
      </div>

      {/* Import panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" /> 2. Import Statement Lines
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label>Paste CSV (date, description, amount — negative for debits)</Label>
          <Textarea
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="2026-07-01, WIRE ACME LTD, -1250.00&#10;2026-07-02, INCOMING SWIFT, 4500.00"
          />
          <div className="flex flex-wrap gap-2 items-end">
            <Button onClick={parsePaste} variant="outline"><Upload className="h-4 w-4 mr-1" /> Parse</Button>
            <Button onClick={clearStmt} variant="ghost">Clear</Button>
            <div className="flex-1" />
            <div className="max-w-[140px]">
              <Label className="text-xs">Match Tolerance</Label>
              <Input type="number" step="0.01" value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
            </div>
            <Button onClick={autoSuggest} disabled={!recId || !stmtLines.length}>
              <Wand2 className="h-4 w-4 mr-1" /> Auto-Suggest
            </Button>
            <Button variant="outline" onClick={() => ledgerQuery.refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh Ledger
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Stat: In {money(stmtIn, currency)} · Out {money(stmtOut, currency)} · Net{" "}
            {money(stmtIn + stmtOut, currency)}
          </p>
        </CardContent>
      </Card>

      {/* Side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Statement Lines ({stmtLines.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stmtLines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{l.date}</TableCell>
                    <TableCell className="text-xs">{l.description}</TableCell>
                    <TableCell className={`text-right ${l.amount < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {money(l.amount, currency)}
                    </TableCell>
                    <TableCell>
                      {l.matched_ledger_id ? (
                        <Badge className="bg-emerald-600">Matched</Badge>
                      ) : (
                        <Badge variant="outline">Open</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!stmtLines.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No statement lines yet — paste CSV above.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Ledger — Unreconciled ({unreconciledLedger.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {unreconciledLedger.map((r) => {
                  // pick first open stmt line with close amount
                  const stmtCandidate = stmtLines.find(
                    (s) => !s.matched_ledger_id && Math.abs(s.amount - r.amount) <= tolerance
                  );
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{r.date}</TableCell>
                      <TableCell className="font-mono text-xs">{r.ref}</TableCell>
                      <TableCell className="text-xs">{r.party}</TableCell>
                      <TableCell className={`text-right ${r.amount < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {money(r.amount, r.currency)}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!recId || !stmtCandidate}
                          onClick={() =>
                            stmtCandidate && matchMutation.mutate({ ledger: r, stmt: stmtCandidate })
                          }
                        >
                          <Link2 className="h-3 w-3 mr-1" /> Match
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!unreconciledLedger.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      {ledgerQuery.isLoading
                        ? "Loading..."
                        : bankAccountId
                        ? "All ledger entries reconciled."
                        : "Select a bank account."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Reconciled */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reconciled Ledger ({reconciledLedger.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Party</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciledLedger.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.date}</TableCell>
                  <TableCell className="font-mono text-xs">{r.ref}</TableCell>
                  <TableCell className="text-xs">{r.party}</TableCell>
                  <TableCell className={`text-right ${r.amount < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {money(r.amount, r.currency)}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => unmatchMutation.mutate(r)}>
                      <Unlink className="h-3 w-3 mr-1" /> Unmatch
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!reconciledLedger.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    Nothing reconciled yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
