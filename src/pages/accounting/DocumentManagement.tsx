import { useState, useRef } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
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
import { FileText, Upload, Download, PenLine, Clock, AlertTriangle, CheckCircle2, Plus } from "lucide-react";

type Document = {
  id: string; title: string; category: string; description: string | null;
  current_version: number; status: string; expiry_date: string | null;
  tags: string[] | null; uploaded_by: string | null; created_at: string;
};
type Version = {
  id: string; document_id: string; version_number: number; storage_path: string;
  file_name: string; file_size: number | null; mime_type: string | null; notes: string | null; created_at: string;
};
type Signature = {
  id: string; document_id: string; signer_name: string; signer_email: string | null;
  role_label: string | null; status: string; signed_at: string | null; order_index: number;
  signer_user_id: string | null;
};

const CATEGORIES = ["contract", "invoice", "policy", "compliance", "hr", "legal", "general"];

export default function DocumentManagementPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newVersionOpen, setNewVersionOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [signOpen, setSignOpen] = useState<Signature | null>(null);
  const [signatureText, setSignatureText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const versionFileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ title: "", category: "contract", description: "", expiry_date: "", file: null as File | null });
  const [versionForm, setVersionForm] = useState({ notes: "", file: null as File | null });
  const [sigForm, setSigForm] = useState({ signer_name: "", signer_email: "", role_label: "", order_index: 1 });

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Document[];
    },
  });

  const selected = documents.find((d) => d.id === selectedId) ?? documents[0] ?? null;

  const { data: versions = [] } = useQuery<Version[]>({
    queryKey: ["document_versions", selected?.id],
    enabled: !!selected?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("document_versions").select("*").eq("document_id", selected!.id).order("version_number", { ascending: false });
      if (error) throw error;
      return data as Version[];
    },
  });

  const { data: signatures = [] } = useQuery<Signature[]>({
    queryKey: ["document_signatures", selected?.id],
    enabled: !!selected?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("document_signatures").select("*").eq("document_id", selected!.id).order("order_index");
      if (error) throw error;
      return data as Signature[];
    },
  });

  const { data: mySignatures = [] } = useQuery<any[]>({
    queryKey: ["my_signatures", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("document_signatures")
        .select("*, documents(title, category)")
        .eq("signer_user_id", user!.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const uploadDoc = useMutation({
    mutationFn: async () => {
      if (!form.file) throw new Error("Select a file");
      const { data: doc, error: e1 } = await supabase.from("documents").insert({
        title: form.title, category: form.category, description: form.description || null,
        expiry_date: form.expiry_date || null, uploaded_by: user?.id, status: "active",
      }).select().single();
      if (e1) throw e1;

      const path = `${doc.id}/v1_${Date.now()}_${form.file.name}`;
      const { error: eu } = await supabase.storage.from("document-uploads").upload(path, form.file);
      if (eu) throw eu;

      const { error: e2 } = await supabase.from("document_versions").insert({
        document_id: doc.id, version_number: 1, storage_path: path,
        file_name: form.file.name, file_size: form.file.size, mime_type: form.file.type, uploaded_by: user?.id,
      });
      if (e2) throw e2;
      return doc;
    },
    onSuccess: (d: any) => {
      toast.success("Document uploaded");
      setUploadOpen(false);
      setForm({ title: "", category: "contract", description: "", expiry_date: "", file: null });
      setSelectedId(d.id);
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const uploadVersion = useMutation({
    mutationFn: async () => {
      if (!versionForm.file || !selected) throw new Error("Select a file");
      const nextV = (selected.current_version || 1) + 1;
      const path = `${selected.id}/v${nextV}_${Date.now()}_${versionForm.file.name}`;
      const { error: eu } = await supabase.storage.from("document-uploads").upload(path, versionForm.file);
      if (eu) throw eu;
      const { error: e2 } = await supabase.from("document_versions").insert({
        document_id: selected.id, version_number: nextV, storage_path: path,
        file_name: versionForm.file.name, file_size: versionForm.file.size, mime_type: versionForm.file.type,
        notes: versionForm.notes || null, uploaded_by: user?.id,
      });
      if (e2) throw e2;
      await supabase.from("documents").update({ current_version: nextV }).eq("id", selected.id);
    },
    onSuccess: () => {
      toast.success("New version uploaded");
      setNewVersionOpen(false);
      setVersionForm({ notes: "", file: null });
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["document_versions", selected?.id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const downloadFile = async (v: Version) => {
    const { data, error } = await supabase.storage.from("document-uploads").createSignedUrl(v.storage_path, 60);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const addSignature = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const currentV = versions[0];
      const { error } = await supabase.from("document_signatures").insert({
        document_id: selected.id, version_id: currentV?.id, requested_by: user?.id,
        signer_name: sigForm.signer_name, signer_email: sigForm.signer_email || null,
        role_label: sigForm.role_label || null, order_index: sigForm.order_index, status: "pending",
      });
      if (error) throw error;
      await supabase.from("documents").update({ status: "pending_signature" }).eq("id", selected.id);
    },
    onSuccess: () => {
      toast.success("Signature request added");
      setSigOpen(false);
      setSigForm({ signer_name: "", signer_email: "", role_label: "", order_index: (signatures.length || 0) + 1 });
      qc.invalidateQueries({ queryKey: ["document_signatures", selected?.id] });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const signDocument = useMutation({
    mutationFn: async () => {
      if (!signOpen) return;
      const { error } = await supabase.from("document_signatures").update({
        status: "signed", signed_at: new Date().toISOString(), signature_data: signatureText,
      }).eq("id", signOpen.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Document signed");
      // if all signatures signed, mark doc as signed
      if (selected) {
        const { data } = await supabase.from("document_signatures").select("status").eq("document_id", selected.id);
        if (data && data.every((s: any) => s.status === "signed")) {
          await supabase.from("documents").update({ status: "signed" }).eq("id", selected.id);
        }
      }
      setSignOpen(null); setSignatureText("");
      qc.invalidateQueries({ queryKey: ["document_signatures", selected?.id] });
      qc.invalidateQueries({ queryKey: ["my_signatures", user?.id] });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const expiring = documents.filter((d) => d.expiry_date && differenceInDays(new Date(d.expiry_date), new Date()) <= 30 && differenceInDays(new Date(d.expiry_date), new Date()) >= 0);
  const expired = documents.filter((d) => d.expiry_date && differenceInDays(new Date(d.expiry_date), new Date()) < 0);
  const pendingSig = documents.filter((d) => d.status === "pending_signature").length;

  const statusBadge = (s: string) => {
    const map: Record<string, any> = {
      active: <Badge variant="secondary">Active</Badge>,
      draft: <Badge variant="outline">Draft</Badge>,
      pending_signature: <Badge className="bg-amber-500">Pending Signature</Badge>,
      signed: <Badge className="bg-green-600">Signed</Badge>,
      expired: <Badge variant="destructive">Expired</Badge>,
      archived: <Badge variant="outline">Archived</Badge>,
    };
    return map[s] ?? <Badge variant="outline">{s}</Badge>;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Document Management & E-Signature</h1>
          <p className="text-muted-foreground">Upload contracts and documents, track versions, and route signature requests.</p>
        </div>
        <Button onClick={() => setUploadOpen(true)}><Upload className="w-4 h-4 mr-2" />Upload Document</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Total Documents</div><div className="text-3xl font-bold">{documents.length}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Pending Signatures</div><div className="text-3xl font-bold text-amber-600">{pendingSig}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Expiring ≤30d</div><div className="text-3xl font-bold text-orange-600">{expiring.length}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Expired</div><div className="text-3xl font-bold text-destructive">{expired.length}</div></CardContent></Card>
      </div>

      {mySignatures.length > 0 && (
        <Card className="border-amber-500">
          <CardHeader><CardTitle className="flex items-center gap-2"><PenLine className="w-5 h-5 text-amber-600" />My Pending Signatures ({mySignatures.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {mySignatures.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between p-3 rounded-md border">
                <div>
                  <div className="font-medium">{s.documents?.title}</div>
                  <div className="text-xs text-muted-foreground">{s.role_label} · Order #{s.order_index}</div>
                </div>
                <Button size="sm" onClick={() => setSignOpen(s)}><PenLine className="w-4 h-4 mr-2" />Sign</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
          <CardContent className="space-y-1 max-h-[600px] overflow-y-auto">
            {documents.length === 0 && <p className="text-sm text-muted-foreground">No documents yet.</p>}
            {documents.map((d) => (
              <button key={d.id} onClick={() => setSelectedId(d.id)}
                className={`w-full text-left p-3 rounded-md border transition-colors ${selected?.id === d.id ? "bg-muted border-primary" : "hover:bg-muted/50"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <Badge variant="outline" className="mr-1">{d.category}</Badge>
                      v{d.current_version}
                    </div>
                  </div>
                  {statusBadge(d.status)}
                </div>
                {d.expiry_date && (
                  <div className={`text-xs mt-2 flex items-center gap-1 ${
                    differenceInDays(new Date(d.expiry_date), new Date()) < 0 ? "text-destructive" :
                    differenceInDays(new Date(d.expiry_date), new Date()) <= 30 ? "text-orange-600" : "text-muted-foreground"
                  }`}>
                    <Clock className="w-3 h-3" />Expires {format(new Date(d.expiry_date), "dd/MM/yyyy")}
                  </div>
                )}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          {selected ? (
            <>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{selected.title}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      <Badge variant="outline" className="mr-2">{selected.category}</Badge>
                      Version {selected.current_version} · {statusBadge(selected.status)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setNewVersionOpen(true)}><Upload className="w-4 h-4 mr-2" />New Version</Button>
                    <Button size="sm" onClick={() => { setSigForm({ signer_name: "", signer_email: "", role_label: "", order_index: signatures.length + 1 }); setSigOpen(true); }}>
                      <Plus className="w-4 h-4 mr-2" />Request Signature
                    </Button>
                  </div>
                </div>
                {selected.description && <p className="text-sm mt-2">{selected.description}</p>}
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="versions">
                  <TabsList>
                    <TabsTrigger value="versions">Versions ({versions.length})</TabsTrigger>
                    <TabsTrigger value="signatures">Signatures ({signatures.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="versions" className="mt-4">
                    <Table>
                      <TableHeader><TableRow><TableHead>Ver</TableHead><TableHead>File</TableHead><TableHead>Size</TableHead><TableHead>Uploaded</TableHead><TableHead>Notes</TableHead><TableHead></TableHead></TableRow></TableHeader>
                      <TableBody>
                        {versions.map((v) => (
                          <TableRow key={v.id}>
                            <TableCell><Badge variant="outline">v{v.version_number}</Badge></TableCell>
                            <TableCell className="max-w-xs truncate"><FileText className="w-4 h-4 inline mr-2" />{v.file_name}</TableCell>
                            <TableCell>{v.file_size ? `${Math.round(v.file_size / 1024)} KB` : "—"}</TableCell>
                            <TableCell>{format(new Date(v.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                            <TableCell className="text-sm">{v.notes || "—"}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={() => downloadFile(v)}><Download className="w-4 h-4" /></Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TabsContent>
                  <TabsContent value="signatures" className="mt-4">
                    <Table>
                      <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Signer</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Signed At</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {signatures.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No signature requests.</TableCell></TableRow>}
                        {signatures.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>{s.order_index}</TableCell>
                            <TableCell><div className="font-medium">{s.signer_name}</div><div className="text-xs text-muted-foreground">{s.signer_email}</div></TableCell>
                            <TableCell>{s.role_label || "—"}</TableCell>
                            <TableCell>
                              {s.status === "signed" ? <Badge className="bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1" />Signed</Badge>
                                : s.status === "declined" ? <Badge variant="destructive">Declined</Badge>
                                : <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>}
                            </TableCell>
                            <TableCell>{s.signed_at ? format(new Date(s.signed_at), "dd/MM/yyyy HH:mm") : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </>
          ) : (
            <CardContent className="py-16 text-center text-muted-foreground">Upload a document to begin.</CardContent>
          )}
        </Card>
      </div>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Expiry Date</Label><DateInput  value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <Label>File</Label>
              <Input ref={fileRef} type="file" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button onClick={() => uploadDoc.mutate()} disabled={uploadDoc.isPending || !form.title || !form.file}>Upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New version dialog */}
      <Dialog open={newVersionOpen} onOpenChange={setNewVersionOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload New Version</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Change Notes</Label><Textarea value={versionForm.notes} onChange={(e) => setVersionForm({ ...versionForm, notes: e.target.value })} placeholder="What changed in this version?" /></div>
            <div><Label>File</Label><Input ref={versionFileRef} type="file" onChange={(e) => setVersionForm({ ...versionForm, file: e.target.files?.[0] ?? null })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewVersionOpen(false)}>Cancel</Button>
            <Button onClick={() => uploadVersion.mutate()} disabled={uploadVersion.isPending || !versionForm.file}>Upload Version</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add signature request dialog */}
      <Dialog open={sigOpen} onOpenChange={setSigOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Signature</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Signer Name</Label><Input value={sigForm.signer_name} onChange={(e) => setSigForm({ ...sigForm, signer_name: e.target.value })} /></div>
            <div><Label>Signer Email</Label><Input type="email" value={sigForm.signer_email} onChange={(e) => setSigForm({ ...sigForm, signer_email: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Role</Label><Input value={sigForm.role_label} onChange={(e) => setSigForm({ ...sigForm, role_label: e.target.value })} placeholder="e.g. CFO" /></div>
              <div><Label>Order</Label><Input type="number" value={sigForm.order_index} onChange={(e) => setSigForm({ ...sigForm, order_index: +e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSigOpen(false)}>Cancel</Button>
            <Button onClick={() => addSignature.mutate()} disabled={addSignature.isPending || !sigForm.signer_name}>Add Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign dialog */}
      <Dialog open={!!signOpen} onOpenChange={(o) => !o && setSignOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Sign Document</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">By typing your full name below and clicking Sign, you agree that this constitutes your legal electronic signature.</p>
            <div><Label>Type your full name</Label><Input value={signatureText} onChange={(e) => setSignatureText(e.target.value)} className="font-serif text-lg" /></div>
            {signOpen && <div className="text-xs text-muted-foreground">Signing as: <strong>{signOpen.signer_name}</strong> · {signOpen.role_label}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOpen(null)}>Cancel</Button>
            <Button onClick={() => signDocument.mutate()} disabled={signDocument.isPending || signatureText.trim().length < 3}>
              <PenLine className="w-4 h-4 mr-2" />Sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
