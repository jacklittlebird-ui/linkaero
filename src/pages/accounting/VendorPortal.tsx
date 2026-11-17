// Phase 2q: Vendor Portal & Self-Service
// - Vendor self-service: submit invoices, view payment status, upload documents
// - Finance/admin console: review vendor submissions, approve/reject, promote to vendor_invoices
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckCircle2, XCircle, Upload, Plus, FileUp, Store, Inbox, FileText } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

const DOC_TYPES = ["tax_certificate", "bank_letter", "trade_license", "insurance", "nda", "other"] as const;
const CURRENCIES = ["EGP", "USD", "EUR", "GBP", "AED", "SAR"] as const;

type Submission = {
  id: string;
  vendor_id: string;
  submission_no: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  amount: number;
  vat: number;
  total: number;
  description: string | null;
  attachment_url: string | null;
  status: string;
  reviewer_notes: string | null;
  approved_vendor_invoice_id: string | null;
  created_at: string;
};

type VendorDoc = {
  id: string;
  vendor_id: string;
  doc_type: string;
  doc_name: string;
  file_url: string | null;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
};

type Vendor = { id: string; name: string; vendor_code?: string | null };

export default function VendorPortal() {
  const qc = useQueryClient();

  const { data: session } = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: myVendorId } = useQuery({
    queryKey: ["current-vendor-id", session?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_vendor_id");
      if (error) return null;
      return (data as string) || null;
    },
    enabled: !!session,
  });

  const { data: isFinance = false } = useQuery({
    queryKey: ["is-finance-or-admin", session?.id],
    queryFn: async () => {
      if (!session) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.id);
      const roles = (data ?? []).map((r: any) => r.role);
      return roles.some((r) =>
        ["admin", "general_accounts", "receivables", "payables", "accountant"].includes(r)
      );
    },
    enabled: !!session,
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["service-providers-simple"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_providers")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Vendor[];
    },
  });

  const { data: submissions = [], isLoading: loadingSubs } = useQuery({
    queryKey: ["vendor-submissions", myVendorId, isFinance],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_invoice_submissions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Submission[];
    },
    enabled: !!session,
  });

  const { data: docs = [] } = useQuery({
    queryKey: ["vendor-docs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_documents")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as VendorDoc[];
    },
    enabled: !!session,
  });

  const { data: paidStatus = [] } = useQuery({
    queryKey: ["vendor-payment-status", myVendorId, isFinance],
    queryFn: async () => {
      let q = supabase.from("vendor_invoices").select("id, invoice_no, vendor_id, vendor_name, date, due_date, total, currency, status");
      if (myVendorId && !isFinance) q = q.eq("vendor_id", myVendorId);
      const { data, error } = await q.order("date", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!session,
  });

  const vendorName = (id: string | null | undefined) =>
    vendors.find((v) => v.id === id)?.name ?? id ?? "—";

  // Submission form
  const [subDialog, setSubDialog] = useState(false);
  const [subForm, setSubForm] = useState({
    vendor_id: "",
    invoice_no: "",
    invoice_date: format(new Date(), "yyyy-MM-dd"),
    due_date: "",
    currency: "EGP",
    amount: "",
    vat: "",
    description: "",
    file: null as File | null,
  });

  const openSubmission = () => {
    setSubForm({
      vendor_id: myVendorId ?? "",
      invoice_no: "",
      invoice_date: format(new Date(), "yyyy-MM-dd"),
      due_date: "",
      currency: "EGP",
      amount: "",
      vat: "",
      description: "",
      file: null,
    });
    setSubDialog(true);
  };

  const submitInvoice = useMutation({
    mutationFn: async () => {
      const vId = subForm.vendor_id || myVendorId;
      if (!vId) throw new Error("Vendor is required");
      if (!subForm.invoice_no) throw new Error("Invoice # is required");
      const amount = Number(subForm.amount) || 0;
      const vat = Number(subForm.vat) || 0;
      let attachment_url: string | null = null;
      if (subForm.file) {
        const path = `${vId}/${Date.now()}-${subForm.file.name}`;
        const { error: upErr } = await supabase.storage
          .from("vendor-uploads").upload(path, subForm.file, { upsert: false });
        if (upErr) throw upErr;
        attachment_url = path;
      }
      const submission_no = `VSUB-${Date.now()}`;
      const { error } = await supabase.from("vendor_invoice_submissions").insert({
        vendor_id: vId,
        submitted_by: session?.id ?? null,
        submission_no,
        invoice_no: subForm.invoice_no,
        invoice_date: subForm.invoice_date,
        due_date: subForm.due_date || null,
        currency: subForm.currency,
        amount,
        vat,
        total: amount + vat,
        description: subForm.description || null,
        attachment_url,
        status: "submitted",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invoice submitted");
      setSubDialog(false);
      qc.invalidateQueries({ queryKey: ["vendor-submissions"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  // Review actions
  const [reviewDialog, setReviewDialog] = useState<Submission | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const openReview = (s: Submission) => {
    setReviewDialog(s);
    setReviewNotes(s.reviewer_notes ?? "");
  };

  const rejectSubmission = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("vendor_invoice_submissions")
        .update({
          status: "rejected",
          reviewer_notes: reviewNotes || null,
          reviewed_by: session?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Submission rejected");
      setReviewDialog(null);
      qc.invalidateQueries({ queryKey: ["vendor-submissions"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const approveSubmission = useMutation({
    mutationFn: async (s: Submission) => {
      const { data: created, error: cErr } = await supabase
        .from("vendor_invoices")
        .insert({
          invoice_no: s.invoice_no,
          vendor_id: s.vendor_id,
          vendor_name: vendorName(s.vendor_id),
          date: s.invoice_date,
          due_date: s.due_date,
          currency: s.currency,
          amount: s.amount,
          vat: s.vat,
          total: s.total,
          status: "Pending",
          notes: s.description,
        })
        .select("id")
        .single();
      if (cErr) throw cErr;
      const { error: uErr } = await supabase
        .from("vendor_invoice_submissions")
        .update({
          status: "approved",
          reviewer_notes: reviewNotes || null,
          approved_vendor_invoice_id: created.id,
          reviewed_by: session?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", s.id);
      if (uErr) throw uErr;
    },
    onSuccess: () => {
      toast.success("Submission approved and vendor invoice created");
      setReviewDialog(null);
      qc.invalidateQueries({ queryKey: ["vendor-submissions"] });
      qc.invalidateQueries({ queryKey: ["vendor-payment-status"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  // Document upload
  const [docDialog, setDocDialog] = useState(false);
  const [docForm, setDocForm] = useState({
    vendor_id: "",
    doc_type: "tax_certificate" as string,
    doc_name: "",
    expiry_date: "",
    notes: "",
    file: null as File | null,
  });

  const openDoc = () => {
    setDocForm({
      vendor_id: myVendorId ?? "",
      doc_type: "tax_certificate",
      doc_name: "",
      expiry_date: "",
      notes: "",
      file: null,
    });
    setDocDialog(true);
  };

  const uploadDoc = useMutation({
    mutationFn: async () => {
      const vId = docForm.vendor_id || myVendorId;
      if (!vId) throw new Error("Vendor is required");
      if (!docForm.doc_name) throw new Error("Document name is required");
      let file_url: string | null = null;
      if (docForm.file) {
        const path = `${vId}/docs/${Date.now()}-${docForm.file.name}`;
        const { error: upErr } = await supabase.storage
          .from("vendor-uploads").upload(path, docForm.file);
        if (upErr) throw upErr;
        file_url = path;
      }
      const { error } = await supabase.from("vendor_documents").insert({
        vendor_id: vId,
        uploaded_by: session?.id ?? null,
        doc_type: docForm.doc_type,
        doc_name: docForm.doc_name,
        expiry_date: docForm.expiry_date || null,
        notes: docForm.notes || null,
        file_url,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Document uploaded");
      setDocDialog(false);
      qc.invalidateQueries({ queryKey: ["vendor-docs"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const downloadFile = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("vendor-uploads").createSignedUrl(path, 60);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const kpis = useMemo(() => {
    const submitted = submissions.filter((s) => s.status === "submitted").length;
    const approved = submissions.filter((s) => s.status === "approved").length;
    const rejected = submissions.filter((s) => s.status === "rejected").length;
    const totalSubmitted = submissions.reduce((s, x) => s + (x.total || 0), 0);
    return { submitted, approved, rejected, totalSubmitted };
  }, [submissions]);

  const statusBadge = (s: string) => {
    if (s === "approved") return <Badge>approved</Badge>;
    if (s === "rejected") return <Badge variant="destructive">rejected</Badge>;
    if (s === "submitted") return <Badge variant="secondary">submitted</Badge>;
    return <Badge variant="outline">{s}</Badge>;
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vendor Portal</h1>
          <p className="text-sm text-muted-foreground">
            {isFinance
              ? "Review vendor submissions, approve invoices, and manage vendor documents"
              : myVendorId
                ? "Submit invoices, upload documents, and track payment status"
                : "Vendor account not linked. Contact finance to grant access."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openDoc} disabled={!isFinance && !myVendorId}>
            <FileUp className="w-4 h-4 mr-2" /> Upload Document
          </Button>
          <Button onClick={openSubmission} disabled={!isFinance && !myVendorId}>
            <Plus className="w-4 h-4 mr-2" /> Submit Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Submitted (pending review)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.submitted}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Approved</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.approved}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Rejected</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.rejected}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Submitted Value</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.totalSubmitted.toLocaleString()}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="submissions">
        <TabsList>
          <TabsTrigger value="submissions"><Inbox className="w-4 h-4 mr-2" />Submissions</TabsTrigger>
          <TabsTrigger value="payments"><Store className="w-4 h-4 mr-2" />Payment Status</TabsTrigger>
          <TabsTrigger value="documents"><FileText className="w-4 h-4 mr-2" />Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="submissions">
          <Card>
            <CardHeader><CardTitle>Invoice Submissions</CardTitle></CardHeader>
            <CardContent>
              {loadingSubs ? <div>Loading…</div> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Submission #</TableHead>
                      {isFinance && <TableHead>Vendor</TableHead>}
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">VAT</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attach</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submissions.length === 0 ? (
                      <TableRow><TableCell colSpan={isFinance ? 11 : 10} className="text-center text-muted-foreground py-6">
                        No submissions yet
                      </TableCell></TableRow>
                    ) : submissions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.submission_no}</TableCell>
                        {isFinance && <TableCell>{vendorName(s.vendor_id)}</TableCell>}
                        <TableCell>{s.invoice_no}</TableCell>
                        <TableCell>{format(parseISO(s.invoice_date), "dd/MM/yyyy")}</TableCell>
                        <TableCell>{s.currency}</TableCell>
                        <TableCell className="text-right">{Number(s.amount).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{Number(s.vat).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-semibold">{Number(s.total).toLocaleString()}</TableCell>
                        <TableCell>{statusBadge(s.status)}</TableCell>
                        <TableCell>
                          {s.attachment_url ? (
                            <Button size="sm" variant="ghost" onClick={() => downloadFile(s.attachment_url!)}>
                              <Upload className="w-4 h-4" />
                            </Button>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {isFinance && s.status === "submitted" && (
                            <Button size="sm" variant="outline" onClick={() => openReview(s)}>Review</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader><CardTitle>Vendor Invoice Payment Status</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    {isFinance && <TableHead>Vendor</TableHead>}
                    <TableHead>Date</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paidStatus.length === 0 ? (
                    <TableRow><TableCell colSpan={isFinance ? 7 : 6} className="text-center text-muted-foreground py-6">
                      No vendor invoices
                    </TableCell></TableRow>
                  ) : (paidStatus as any[]).map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono">{i.invoice_no}</TableCell>
                      {isFinance && <TableCell>{i.vendor_name ?? vendorName(i.vendor_id)}</TableCell>}
                      <TableCell>{i.date ? format(parseISO(i.date), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell>{i.due_date ? format(parseISO(i.due_date), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell>{i.currency}</TableCell>
                      <TableCell className="text-right">{Number(i.total ?? 0).toLocaleString()}</TableCell>
                      <TableCell>
                        {String(i.status).toLowerCase() === "paid"
                          ? <Badge>Paid</Badge>
                          : <Badge variant="secondary">{i.status}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader><CardTitle>Vendor Documents</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {isFinance && <TableHead>Vendor</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.length === 0 ? (
                    <TableRow><TableCell colSpan={isFinance ? 7 : 6} className="text-center text-muted-foreground py-6">
                      No documents uploaded
                    </TableCell></TableRow>
                  ) : docs.map((d) => (
                    <TableRow key={d.id}>
                      {isFinance && <TableCell>{vendorName(d.vendor_id)}</TableCell>}
                      <TableCell><Badge variant="outline">{d.doc_type}</Badge></TableCell>
                      <TableCell>{d.doc_name}</TableCell>
                      <TableCell>
                        {d.expiry_date
                          ? <span className={new Date(d.expiry_date) < new Date() ? "text-destructive font-medium" : ""}>
                              {format(parseISO(d.expiry_date), "dd/MM/yyyy")}
                            </span>
                          : "—"}
                      </TableCell>
                      <TableCell>{format(parseISO(d.created_at), "dd/MM/yyyy")}</TableCell>
                      <TableCell>
                        {d.file_url
                          ? <Button size="sm" variant="ghost" onClick={() => downloadFile(d.file_url!)}>
                              <Upload className="w-4 h-4" />
                            </Button>
                          : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{d.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Submission Dialog */}
      <Dialog open={subDialog} onOpenChange={setSubDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submit Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {isFinance && (
              <div>
                <Label>Vendor</Label>
                <Select value={subForm.vendor_id} onValueChange={(v) => setSubForm(f => ({ ...f, vendor_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Invoice #</Label>
                <Input value={subForm.invoice_no}
                  onChange={(e) => setSubForm(f => ({ ...f, invoice_no: e.target.value }))} />
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={subForm.currency} onValueChange={(v) => setSubForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Invoice Date</Label>
                <DateInput  value={subForm.invoice_date}
                  onChange={(e) => setSubForm(f => ({ ...f, invoice_date: e.target.value }))} />
              </div>
              <div>
                <Label>Due Date</Label>
                <DateInput  value={subForm.due_date}
                  onChange={(e) => setSubForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" step="0.01" value={subForm.amount}
                  onChange={(e) => setSubForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>VAT</Label>
                <Input type="number" step="0.01" value={subForm.vat}
                  onChange={(e) => setSubForm(f => ({ ...f, vat: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={3} value={subForm.description}
                onChange={(e) => setSubForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>Attachment (PDF or Image)</Label>
              <Input type="file" accept=".pdf,image/*"
                onChange={(e) => setSubForm(f => ({ ...f, file: e.target.files?.[0] ?? null }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubDialog(false)}>Cancel</Button>
            <Button onClick={() => submitInvoice.mutate()} disabled={submitInvoice.isPending}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={(o) => !o && setReviewDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review Submission</DialogTitle></DialogHeader>
          {reviewDialog && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Vendor:</span> {vendorName(reviewDialog.vendor_id)}</div>
                <div><span className="text-muted-foreground">Invoice:</span> {reviewDialog.invoice_no}</div>
                <div><span className="text-muted-foreground">Date:</span> {format(parseISO(reviewDialog.invoice_date), "dd/MM/yyyy")}</div>
                <div><span className="text-muted-foreground">Total:</span> {reviewDialog.currency} {Number(reviewDialog.total).toLocaleString()}</div>
              </div>
              {reviewDialog.description && (
                <div className="text-sm"><span className="text-muted-foreground">Description:</span> {reviewDialog.description}</div>
              )}
              {reviewDialog.attachment_url && (
                <Button size="sm" variant="outline" onClick={() => downloadFile(reviewDialog.attachment_url!)}>
                  <Upload className="w-4 h-4 mr-2" />Open attachment
                </Button>
              )}
              <div>
                <Label>Reviewer notes</Label>
                <Textarea rows={3} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="destructive" onClick={() => reviewDialog && rejectSubmission.mutate(reviewDialog.id)} disabled={rejectSubmission.isPending}>
              <XCircle className="w-4 h-4 mr-2" />Reject
            </Button>
            <Button onClick={() => reviewDialog && approveSubmission.mutate(reviewDialog)} disabled={approveSubmission.isPending}>
              <CheckCircle2 className="w-4 h-4 mr-2" />Approve & Create Vendor Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Dialog */}
      <Dialog open={docDialog} onOpenChange={setDocDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {isFinance && (
              <div>
                <Label>Vendor</Label>
                <Select value={docForm.vendor_id} onValueChange={(v) => setDocForm(f => ({ ...f, vendor_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={docForm.doc_type} onValueChange={(v) => setDocForm(f => ({ ...f, doc_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Expiry Date</Label>
                <DateInput  value={docForm.expiry_date}
                  onChange={(e) => setDocForm(f => ({ ...f, expiry_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Document Name</Label>
              <Input value={docForm.doc_name}
                onChange={(e) => setDocForm(f => ({ ...f, doc_name: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={docForm.notes}
                onChange={(e) => setDocForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div>
              <Label>File</Label>
              <Input type="file"
                onChange={(e) => setDocForm(f => ({ ...f, file: e.target.files?.[0] ?? null }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocDialog(false)}>Cancel</Button>
            <Button onClick={() => uploadDoc.mutate()} disabled={uploadDoc.isPending}>Upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
