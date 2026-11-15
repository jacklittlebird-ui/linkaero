import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MaskedTimeInput } from "@/components/ui/masked-time-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  Building2, MapPin, Globe, Shield, Bell, User, Monitor, Lock, Clock,
  Save, Plus, Pencil, Trash2, Key, Eye, EyeOff, RefreshCw, History, Palette, Sun, Moon, Check,
  Sparkles, Layout, Type, Contrast, Wand2, PanelLeft
} from "lucide-react";
import { applyTheme, loadTheme, saveTheme, DEFAULT_THEME, THEME_PRESETS, type ThemeSettings, type SidebarStyle, type BackgroundStyle } from "@/lib/themeStorage";
import { formatDateDMY } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────
interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  station: string | null;
  avatar_url: string | null;
}

interface StationRow {
  id: string;
  iata_code: string;
  name: string;
  city: string;
  status: string;
}

// ─── Company Profile Tab ─────────────────────────────────
function CompanyProfileTab() {
  const [companyName, setCompanyName] = useState("Link Aero");
  const [companyNameAr, setCompanyNameAr] = useState("لينك ايرو");
  const [email, setEmail] = useState("info@linkaero.com");
  const [phone, setPhone] = useState("+20 2 1234 5678");
  const [website, setWebsite] = useState("www.linkaero.com");
  const [address, setAddress] = useState("Cairo International Airport, Terminal 2");
  const [city, setCity] = useState("Cairo");
  const [country, setCountry] = useState("Egypt");
  const [taxId, setTaxId] = useState("");
  const [crNo, setCrNo] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [fiscalYearStart, setFiscalYearStart] = useState("January");

  const handleSave = () => {
    toast.success("Company profile saved successfully");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 size={18} className="text-primary" /> Company Information</CardTitle>
          <CardDescription>Basic company details and branding</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Company Name (English)</Label><Input value={companyName} onChange={e => setCompanyName(e.target.value)} /></div>
            <div><Label>Company Name (Arabic)</Label><Input value={companyNameAr} onChange={e => setCompanyNameAr(e.target.value)} dir="rtl" /></div>
            <div><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} /></div>
            <div><Label>Website</Label><Input value={website} onChange={e => setWebsite(e.target.value)} /></div>
            <div><Label>Tax ID / VAT No.</Label><Input value={taxId} onChange={e => setTaxId(e.target.value)} /></div>
            <div><Label>Commercial Registration No.</Label><Input value={crNo} onChange={e => setCrNo(e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin size={18} className="text-teal" /> Address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Address</Label><Textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} /></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>City</Label><Input value={city} onChange={e => setCity(e.target.value)} /></div>
            <div><Label>Country</Label><Input value={country} onChange={e => setCountry(e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe size={18} className="text-cyan" /> Financial Defaults</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Default Currency</Label>
            <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD – US Dollar</SelectItem>
                <SelectItem value="EUR">EUR – Euro</SelectItem>
                <SelectItem value="EGP">EGP – Egyptian Pound</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fiscal Year Start</Label>
            <Select value={fiscalYearStart} onValueChange={setFiscalYearStart}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["January","February","March","April","May","June","July","August","September","October","November","December"].map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} className="gap-2"><Save size={16} /> Save Company Profile</Button>
      </div>
    </div>
  );
}

// ─── Station Management Tab ──────────────────────────────
function StationManagementTab() {
  const [stations, setStations] = useState<StationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultStation, setDefaultStation] = useState("CAI");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("airports").select("id, iata_code, name, city, status").order("iata_code");
      setStations(data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin size={18} className="text-emerald" /> Active Stations</CardTitle>
          <CardDescription>Stations are managed from the Airports module. Configure station-level defaults here.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Label>Default Station</Label>
            <Select value={defaultStation} onValueChange={v => { setDefaultStation(v); toast.success(`Default station set to ${v}`); }}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {stations.filter(s => s.status === "Active").map(s => (
                  <SelectItem key={s.id} value={s.iata_code}>{s.iata_code} – {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Separator className="my-4" />
          {loading ? <p className="text-muted-foreground text-sm">Loading stations...</p> : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="data-table-header"><th className="p-2 text-left">IATA</th><th className="p-2 text-left">Name</th><th className="p-2 text-left">City</th><th className="p-2 text-left">Status</th></tr></thead>
                <tbody>
                  {stations.map(s => (
                    <tr key={s.id} className="data-table-row">
                      <td className="p-2 font-mono font-semibold">{s.iata_code}</td>
                      <td className="p-2">{s.name}</td>
                      <td className="p-2 text-muted-foreground">{s.city}</td>
                      <td className="p-2"><Badge variant={s.status === "Active" ? "default" : "secondary"} className={s.status === "Active" ? "bg-success/15 text-success border-0" : ""}>{s.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── System Preferences Tab ──────────────────────────────
function SystemPreferencesTab() {
  const initial = (() => {
    try {
      const raw = localStorage.getItem("app:system");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const [timezone, setTimezone] = useState(initial?.timezone || "Africa/Cairo");
  const [dateFormat, setDateFormat] = useState(initial?.dateFormat || "DD/MM/YYYY");
  const [timeFormat, setTimeFormat] = useState(initial?.timeFormat || "24h");
  const [language, setLanguage] = useState(initial?.language || "en");
  const [autoLogout, setAutoLogout] = useState(initial?.autoLogout || "30");
  const [paginationSize, setPaginationSize] = useState(initial?.paginationSize || "25");
  const [enableAnimations, setEnableAnimations] = useState(initial?.enableAnimations ?? true);
  const [compactMode, setCompactMode] = useState(initial?.compactMode ?? false);

  const handleSave = () => {
    const payload = { timezone, dateFormat, timeFormat, language, autoLogout, paginationSize, enableAnimations, compactMode };
    localStorage.setItem("app:system", JSON.stringify(payload));
    document.documentElement.classList.toggle("no-animations", !enableAnimations);
    document.documentElement.classList.toggle("compact", compactMode);
    toast.success("System preferences saved");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe size={18} className="text-sky" /> Regional Settings</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Africa/Cairo">Africa/Cairo (UTC+2)</SelectItem>
                <SelectItem value="Europe/London">Europe/London (UTC+0)</SelectItem>
                <SelectItem value="America/New_York">America/New York (UTC-5)</SelectItem>
                <SelectItem value="Asia/Dubai">Asia/Dubai (UTC+4)</SelectItem>
                <SelectItem value="Asia/Riyadh">Asia/Riyadh (UTC+3)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date Format</Label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Time Format</Label>
            <Select value={timeFormat} onValueChange={setTimeFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24-Hour</SelectItem>
                <SelectItem value="12h">12-Hour (AM/PM)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar" data-no-translate>العربية</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Monitor size={18} className="text-violet" /> Display & Performance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Auto Logout (minutes)</Label>
              <Select value={autoLogout} onValueChange={setAutoLogout}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="120">2 hours</SelectItem>
                  <SelectItem value="never">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Default Page Size</Label>
              <Select value={paginationSize} onValueChange={setPaginationSize}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 rows</SelectItem>
                  <SelectItem value="25">25 rows</SelectItem>
                  <SelectItem value="50">50 rows</SelectItem>
                  <SelectItem value="100">100 rows</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div><Label>Enable Animations</Label><p className="text-xs text-muted-foreground">Smooth transitions and effects</p></div>
            <Switch checked={enableAnimations} onCheckedChange={setEnableAnimations} />
          </div>
          <div className="flex items-center justify-between">
            <div><Label>Compact Mode</Label><p className="text-xs text-muted-foreground">Reduce spacing for denser layouts</p></div>
            <Switch checked={compactMode} onCheckedChange={setCompactMode} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} className="gap-2"><Save size={16} /> Save Preferences</Button>
      </div>
    </div>
  );
}

// ─── Security & Access Tab ───────────────────────────────
function SecurityTab() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [ipWhitelist, setIpWhitelist] = useState(false);
  const [auditLogEnabled, setAuditLogEnabled] = useState(true);

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return; }
    if (newPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated successfully");
    setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Key size={18} className="text-orange" /> Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div>
            <Label>Current Password</Label>
            <div className="relative">
              <Input type={showCurrent ? "text" : "password"} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
              <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-2 top-2.5 text-muted-foreground">{showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
          </div>
          <div>
            <Label>New Password</Label>
            <div className="relative">
              <Input type={showNew ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-2 top-2.5 text-muted-foreground">{showNew ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
          </div>
          <div>
            <Label>Confirm New Password</Label>
            <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
          </div>
          <Button onClick={handleChangePassword} className="gap-2"><Lock size={16} /> Update Password</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield size={18} className="text-rose" /> Security Policies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><Label>Two-Factor Authentication</Label><p className="text-xs text-muted-foreground">Require 2FA for all admin accounts</p></div>
            <Switch checked={twoFactor} onCheckedChange={setTwoFactor} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div><Label>IP Whitelisting</Label><p className="text-xs text-muted-foreground">Restrict access to specific IP addresses</p></div>
            <Switch checked={ipWhitelist} onCheckedChange={setIpWhitelist} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div><Label>Audit Logging</Label><p className="text-xs text-muted-foreground">Track all user actions for compliance</p></div>
            <Switch checked={auditLogEnabled} onCheckedChange={setAuditLogEnabled} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><History size={18} className="text-indigo" /> Active Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="data-table-header"><th className="p-2 text-left">Device</th><th className="p-2 text-left">IP Address</th><th className="p-2 text-left">Last Active</th><th className="p-2 text-left">Status</th></tr></thead>
              <tbody>
                <tr className="data-table-row">
                  <td className="p-2">Current Browser</td>
                  <td className="p-2 font-mono text-muted-foreground">—</td>
                  <td className="p-2 text-muted-foreground">Now</td>
                  <td className="p-2"><Badge className="bg-success/15 text-success border-0">Active</Badge></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Notification Preferences Tab ────────────────────────
function NotificationPreferencesTab() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState({
    email_enabled: true, push_enabled: true,
    flight_alerts: true, invoice_alerts: true, contract_alerts: true,
    staff_alerts: true, system_alerts: true,
    quiet_hours_enabled: false, quiet_hours_start: "22:00", quiet_hours_end: "07:00"
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("notification_preferences").select("*").eq("user_id", user.id).maybeSingle();
      if (data) setPrefs(data as any);
      setLoading(false);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    const { error } = await supabase.from("notification_preferences").upsert({ user_id: user.id, ...prefs }, { onConflict: "user_id" });
    if (error) { toast.error(error.message); return; }
    toast.success("Notification preferences saved");
  };

  const toggle = (key: string) => setPrefs(p => ({ ...p, [key]: !(p as any)[key] }));

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  const alerts = [
    { key: "flight_alerts", label: "Flight Alerts", desc: "Delays, cancellations, schedule changes", color: "text-sky" },
    { key: "invoice_alerts", label: "Invoice Alerts", desc: "New invoices, overdue payments", color: "text-amber" },
    { key: "contract_alerts", label: "Contract Alerts", desc: "Expiring contracts, renewals", color: "text-violet" },
    { key: "staff_alerts", label: "Staff Alerts", desc: "Roster changes, certification expiry", color: "text-teal" },
    { key: "system_alerts", label: "System Alerts", desc: "Maintenance, security updates", color: "text-rose" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell size={18} className="text-warning" /> Delivery Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><Label>Email Notifications</Label><p className="text-xs text-muted-foreground">Receive alerts via email</p></div>
            <Switch checked={prefs.email_enabled} onCheckedChange={() => toggle("email_enabled")} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div><Label>Push Notifications</Label><p className="text-xs text-muted-foreground">Browser push notifications</p></div>
            <Switch checked={prefs.push_enabled} onCheckedChange={() => toggle("push_enabled")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alert Categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {alerts.map(a => (
            <div key={a.key}>
              <div className="flex items-center justify-between">
                <div><Label className={a.color}>{a.label}</Label><p className="text-xs text-muted-foreground">{a.desc}</p></div>
                <Switch checked={(prefs as any)[a.key]} onCheckedChange={() => toggle(a.key)} />
              </div>
              <Separator className="mt-3" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock size={18} className="text-fuchsia" /> Quiet Hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><Label>Enable Quiet Hours</Label><p className="text-xs text-muted-foreground">Pause non-critical notifications</p></div>
            <Switch checked={prefs.quiet_hours_enabled} onCheckedChange={() => toggle("quiet_hours_enabled")} />
          </div>
          {prefs.quiet_hours_enabled && (
            <div className="grid grid-cols-2 gap-4 mt-2">
              <div><Label>Start</Label><MaskedTimeInput value={prefs.quiet_hours_start || ""} onChange={v => setPrefs(p => ({ ...p, quiet_hours_start: v }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
              <div><Label>End</Label><MaskedTimeInput value={prefs.quiet_hours_end || ""} onChange={v => setPrefs(p => ({ ...p, quiet_hours_end: v }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} className="gap-2"><Save size={16} /> Save Notification Preferences</Button>
      </div>
    </div>
  );
}

// ─── User Profile Tab ────────────────────────────────────
function UserProfileTab() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [station, setStation] = useState("");
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
      if (p) { setProfile(p); setFullName(p.full_name || ""); setStation(p.station || ""); }
      const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      setRoles((r || []).map((x: any) => x.role));
      setLoading(false);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!profile) return;
    const { error } = await supabase.from("profiles").update({ full_name: fullName, station }).eq("id", profile.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Profile updated");
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  const roleColors: Record<string, string> = {
    admin: "bg-rose/15 text-rose",
    station_manager: "bg-indigo/15 text-indigo",
    station_ops: "bg-teal/15 text-teal",
    employee: "bg-sky/15 text-sky",
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User size={18} className="text-primary" /> My Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold">
              {fullName ? fullName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "U"}
            </div>
            <div>
              <p className="text-lg font-semibold">{fullName || "—"}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <div className="flex gap-1 mt-1">
                {roles.map(r => (
                  <Badge key={r} className={`${roleColors[r] || "bg-muted text-muted-foreground"} border-0 text-xs`}>
                    {r.replace("_", " ")}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Full Name</Label><Input value={fullName} onChange={e => setFullName(e.target.value)} /></div>
            <div><Label>Station</Label><Input value={station} onChange={e => setStation(e.target.value)} placeholder="e.g. CAI" /></div>
            <div><Label>Email</Label><Input value={user?.email || ""} disabled className="opacity-60" /></div>
            <div><Label>User ID</Label><Input value={user?.id || ""} disabled className="opacity-60 font-mono text-xs" /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw size={18} className="text-lime" /> Account Info</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Joined:</span> <span className="font-medium">{user?.created_at ? formatDateDMY(user.created_at) : "—"}</span></div>
          <div><span className="text-muted-foreground">Last Sign In:</span> <span className="font-medium">{user?.last_sign_in_at ? formatDateDMY(user.last_sign_in_at) : "—"}</span></div>
          <div><span className="text-muted-foreground">Email Confirmed:</span> <span className="font-medium">{user?.email_confirmed_at ? "Yes" : "No"}</span></div>
          <div><span className="text-muted-foreground">Provider:</span> <span className="font-medium capitalize">{user?.app_metadata?.provider || "email"}</span></div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} className="gap-2"><Save size={16} /> Save Profile</Button>
      </div>
    </div>
  );
}

// ─── Theme & Appearance Tab ──────────────────────────────
const themeColors = [
  { name: "Default Indigo", value: "243 55% 25%", preview: "hsl(243, 55%, 25%)" },
  { name: "Royal Indigo", value: "243 55% 50%", preview: "hsl(243, 55%, 50%)" },
  { name: "Midnight Blue", value: "222 70% 25%", preview: "hsl(222, 70%, 25%)" },
  { name: "Ocean Blue", value: "210 80% 45%", preview: "hsl(210, 80%, 45%)" },
  { name: "Sky", value: "200 85% 50%", preview: "hsl(200, 85%, 50%)" },
  { name: "Cyan", value: "190 80% 42%", preview: "hsl(190, 80%, 42%)" },
  { name: "Teal", value: "170 60% 36%", preview: "hsl(170, 60%, 36%)" },
  { name: "Emerald", value: "160 60% 38%", preview: "hsl(160, 60%, 38%)" },
  { name: "Forest Green", value: "145 55% 30%", preview: "hsl(145, 55%, 30%)" },
  { name: "Mint", value: "152 60% 45%", preview: "hsl(152, 60%, 45%)" },
  { name: "Lime", value: "85 70% 40%", preview: "hsl(85, 70%, 40%)" },
  { name: "Olive", value: "70 45% 35%", preview: "hsl(70, 45%, 35%)" },
  { name: "Amber", value: "45 93% 42%", preview: "hsl(45, 93%, 42%)" },
  { name: "Gold", value: "40 85% 45%", preview: "hsl(40, 85%, 45%)" },
  { name: "Orange", value: "25 90% 50%", preview: "hsl(25, 90%, 50%)" },
  { name: "Burnt Orange", value: "15 80% 45%", preview: "hsl(15, 80%, 45%)" },
  { name: "Crimson", value: "0 84% 50%", preview: "hsl(0, 84%, 50%)" },
  { name: "Ruby", value: "350 80% 42%", preview: "hsl(350, 80%, 42%)" },
  { name: "Rose", value: "350 70% 50%", preview: "hsl(350, 70%, 50%)" },
  { name: "Pink", value: "330 75% 55%", preview: "hsl(330, 75%, 55%)" },
  { name: "Fuchsia", value: "292 70% 50%", preview: "hsl(292, 70%, 50%)" },
  { name: "Magenta", value: "310 70% 45%", preview: "hsl(310, 70%, 45%)" },
  { name: "Violet", value: "270 60% 50%", preview: "hsl(270, 60%, 50%)" },
  { name: "Purple", value: "260 55% 40%", preview: "hsl(260, 55%, 40%)" },
  { name: "Lavender", value: "255 50% 55%", preview: "hsl(255, 50%, 55%)" },
  { name: "Slate", value: "215 25% 35%", preview: "hsl(215, 25%, 35%)" },
  { name: "Charcoal", value: "220 15% 25%", preview: "hsl(220, 15%, 25%)" },
  { name: "Bronze", value: "30 50% 35%", preview: "hsl(30, 50%, 35%)" },
  { name: "Coffee", value: "25 35% 28%", preview: "hsl(25, 35%, 28%)" },
];

const accentColors = [
  { name: "Green", value: "152 60% 45%", preview: "hsl(152, 60%, 45%)" },
  { name: "Cyan", value: "190 80% 45%", preview: "hsl(190, 80%, 45%)" },
  { name: "Amber", value: "45 93% 47%", preview: "hsl(45, 93%, 47%)" },
  { name: "Pink", value: "340 75% 55%", preview: "hsl(340, 75%, 55%)" },
  { name: "Orange", value: "25 90% 55%", preview: "hsl(25, 90%, 55%)" },
  { name: "Lime", value: "85 70% 45%", preview: "hsl(85, 70%, 45%)" },
];

function ThemeAppearanceTab() {
  const [theme, setTheme] = useState<ThemeSettings>(() => loadTheme());

  const update = (patch: Partial<ThemeSettings>) => {
    const next = { ...theme, ...patch };
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  };

  const handleReset = () => {
    setTheme(DEFAULT_THEME);
    applyTheme(DEFAULT_THEME);
    localStorage.removeItem("app:theme");
    toast.success("Theme reset to defaults");
  };

  const applyPreset = (id: string) => {
    const p = THEME_PRESETS.find(x => x.id === id);
    if (!p) return;
    const next: ThemeSettings = {
      ...theme,
      mode: p.mode, primary: p.primary, accent: p.accent, radius: p.radius,
      sidebarStyle: p.sidebarStyle, backgroundStyle: p.backgroundStyle,
    };
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
    toast.success(`Applied "${p.name}" preset`);
  };

  // Parse HSL triplet "H S% L%" into separate numbers
  const parseHSL = (hsl: string): [number, number, number] => {
    const m = hsl.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
    return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : [0, 0, 0];
  };
  const formatHSL = (h: number, s: number, l: number) => `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;

  const [pH, pS, pL] = parseHSL(theme.primary);
  const [aH, aS, aL] = parseHSL(theme.accent);

  return (
    <div className="space-y-6">
      {/* PRESETS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles size={18} className="text-primary" /> Theme Presets</CardTitle>
          <CardDescription>One-click curated palettes for different ops scenarios</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {THEME_PRESETS.map(p => {
              const active = theme.primary === p.primary && theme.accent === p.accent && theme.mode === p.mode;
              return (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`group relative overflow-hidden rounded-lg border-2 p-3 text-left transition-all ${active ? "border-primary shadow-md" : "border-border hover:border-muted-foreground/40"}`}
                >
                  {active && <div className="absolute top-2 right-2 z-10"><Check size={14} className="text-primary" /></div>}
                  <div className="flex gap-1.5 mb-2">
                    <div className="w-7 h-7 rounded-md shadow-inner" style={{ background: `hsl(${p.primary})` }} />
                    <div className="w-7 h-7 rounded-md shadow-inner" style={{ background: `hsl(${p.accent})` }} />
                    <div className={`w-7 h-7 rounded-md border ${p.mode === "dark" ? "bg-gray-900" : "bg-white"}`} />
                  </div>
                  <p className="text-xs font-bold text-foreground">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{p.description}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* MODE */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sun size={18} className="text-amber" /> Appearance Mode</CardTitle>
          <CardDescription>Choose between light and dark mode</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <button
              onClick={() => update({ mode: "light" })}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${theme.mode === "light" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"}`}
            >
              {theme.mode === "light" && <div className="absolute top-2 right-2"><Check size={14} className="text-primary" /></div>}
              <div className="w-12 h-12 rounded-lg bg-white border shadow-sm flex items-center justify-center">
                <Sun size={20} className="text-amber" />
              </div>
              <span className="text-sm font-semibold text-foreground">Light</span>
            </button>
            <button
              onClick={() => update({ mode: "dark" })}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${theme.mode === "dark" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"}`}
            >
              {theme.mode === "dark" && <div className="absolute top-2 right-2"><Check size={14} className="text-primary" /></div>}
              <div className="w-12 h-12 rounded-lg bg-gray-900 border border-gray-700 flex items-center justify-center">
                <Moon size={20} className="text-sky" />
              </div>
              <span className="text-sm font-semibold text-foreground">Dark</span>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* PRIMARY COLOR PALETTE + CUSTOM HSL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Palette size={18} className="text-primary" /> Primary Color</CardTitle>
          <CardDescription>Main brand color used for buttons, links, and highlights</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {themeColors.map(c => (
              <button
                key={c.value}
                onClick={() => update({ primary: c.value })}
                className={`relative group flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all ${theme.primary === c.value ? "border-foreground shadow-md" : "border-transparent hover:border-border"}`}
              >
                <div className="w-10 h-10 rounded-full shadow-inner border border-black/10 flex items-center justify-center" style={{ backgroundColor: c.preview }}>
                  {theme.primary === c.value && <Check size={16} className="text-white drop-shadow" />}
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground">{c.name}</span>
              </button>
            ))}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Wand2 size={14} className="text-muted-foreground" />
              <Label className="text-xs font-semibold uppercase tracking-wide">Custom HSL</Label>
              <div className="ml-auto w-8 h-8 rounded-md border" style={{ background: `hsl(${theme.primary})` }} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[11px] text-muted-foreground">Hue ({Math.round(pH)})</Label>
                <input type="range" min="0" max="360" value={pH} onChange={e => update({ primary: formatHSL(+e.target.value, pS, pL) })}
                  className="w-full h-2 rounded accent-primary"
                  style={{ background: "linear-gradient(to right, hsl(0 70% 50%),hsl(60 70% 50%),hsl(120 70% 50%),hsl(180 70% 50%),hsl(240 70% 50%),hsl(300 70% 50%),hsl(360 70% 50%))" }} />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Saturation ({Math.round(pS)}%)</Label>
                <input type="range" min="0" max="100" value={pS} onChange={e => update({ primary: formatHSL(pH, +e.target.value, pL) })} className="w-full h-2 rounded accent-primary" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Lightness ({Math.round(pL)}%)</Label>
                <input type="range" min="0" max="100" value={pL} onChange={e => update({ primary: formatHSL(pH, pS, +e.target.value) })} className="w-full h-2 rounded accent-primary" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ACCENT COLOR PALETTE + CUSTOM */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Palette size={18} className="text-accent" /> Accent Color</CardTitle>
          <CardDescription>Used for success states, sidebar highlights, and accents</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {accentColors.map(c => (
              <button
                key={c.value}
                onClick={() => update({ accent: c.value })}
                className={`relative group flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all ${theme.accent === c.value ? "border-foreground shadow-md" : "border-transparent hover:border-border"}`}
              >
                <div className="w-10 h-10 rounded-full shadow-inner border border-black/10 flex items-center justify-center" style={{ backgroundColor: c.preview }}>
                  {theme.accent === c.value && <Check size={16} className="text-white drop-shadow" />}
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground">{c.name}</span>
              </button>
            ))}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Wand2 size={14} className="text-muted-foreground" />
              <Label className="text-xs font-semibold uppercase tracking-wide">Custom HSL</Label>
              <div className="ml-auto w-8 h-8 rounded-md border" style={{ background: `hsl(${theme.accent})` }} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[11px] text-muted-foreground">Hue ({Math.round(aH)})</Label>
                <input type="range" min="0" max="360" value={aH} onChange={e => update({ accent: formatHSL(+e.target.value, aS, aL) })} className="w-full h-2 rounded accent-primary" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Saturation ({Math.round(aS)}%)</Label>
                <input type="range" min="0" max="100" value={aS} onChange={e => update({ accent: formatHSL(aH, +e.target.value, aL) })} className="w-full h-2 rounded accent-primary" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Lightness ({Math.round(aL)}%)</Label>
                <input type="range" min="0" max="100" value={aL} onChange={e => update({ accent: formatHSL(aH, aS, +e.target.value) })} className="w-full h-2 rounded accent-primary" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SIDEBAR STYLE */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PanelLeft size={18} className="text-primary" /> Sidebar Style</CardTitle>
          <CardDescription>How the navigation panel renders</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              { id: "tinted", label: "Tinted", desc: "Primary-color tint" },
              { id: "dark",   label: "Dark",   desc: "Always dark" },
              { id: "light",  label: "Light",  desc: "White panel" },
              { id: "glass",  label: "Glass",  desc: "Frosted blur" },
            ] as { id: SidebarStyle; label: string; desc: string }[]).map(s => {
              const active = theme.sidebarStyle === s.id;
              const preview =
                s.id === "tinted" ? `hsl(${theme.primary})` :
                s.id === "dark"   ? "hsl(220 25% 12%)" :
                s.id === "light"  ? "hsl(0 0% 100%)" :
                                    "hsl(0 0% 100% / 0.55)";
              return (
                <button key={s.id} onClick={() => update({ sidebarStyle: s.id })}
                  className={`relative flex flex-col gap-2 p-3 rounded-lg border-2 transition-all ${active ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"}`}>
                  {active && <div className="absolute top-2 right-2"><Check size={14} className="text-primary" /></div>}
                  <div className="flex gap-1.5 h-12">
                    <div className="w-1/3 rounded border" style={{ background: preview, backdropFilter: s.id === "glass" ? "blur(6px)" : undefined }} />
                    <div className="flex-1 rounded bg-muted/40 border" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{s.label}</p>
                    <p className="text-[10px] text-muted-foreground">{s.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* BACKGROUND STYLE */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Layout size={18} className="text-primary" /> Background Style</CardTitle>
          <CardDescription>Workspace background — solid or atmospheric</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {([
              { id: "solid", label: "Solid", desc: "Flat color" },
              { id: "subtle-gradient", label: "Subtle Gradient", desc: "Soft brand glow" },
              { id: "mesh", label: "Mesh", desc: "Multi-point gradient" },
            ] as { id: BackgroundStyle; label: string; desc: string }[]).map(b => {
              const active = theme.backgroundStyle === b.id;
              const bg =
                b.id === "solid" ? "hsl(var(--background))" :
                b.id === "subtle-gradient" ? `radial-gradient(ellipse at 0% 0%, hsl(${theme.primary} / 0.15), transparent 60%), radial-gradient(ellipse at 100% 100%, hsl(${theme.accent} / 0.12), transparent 60%), hsl(var(--background))` :
                `radial-gradient(at 20% 10%, hsl(${theme.primary} / 0.25), transparent 50%), radial-gradient(at 80% 0%, hsl(${theme.accent} / 0.25), transparent 50%), radial-gradient(at 100% 80%, hsl(${theme.primary} / 0.18), transparent 50%), hsl(var(--background))`;
              return (
                <button key={b.id} onClick={() => update({ backgroundStyle: b.id })}
                  className={`relative flex flex-col gap-2 p-3 rounded-lg border-2 transition-all ${active ? "border-primary" : "border-border hover:border-muted-foreground/30"}`}>
                  {active && <div className="absolute top-2 right-2 z-10"><Check size={14} className="text-primary" /></div>}
                  <div className="h-16 rounded border" style={{ background: bg }} />
                  <div>
                    <p className="text-xs font-semibold text-foreground">{b.label}</p>
                    <p className="text-[10px] text-muted-foreground">{b.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* TYPOGRAPHY & DENSITY */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Type size={18} className="text-primary" /> Typography Scale</CardTitle>
          <CardDescription>Adjusts root font size for the entire app (12 – 25 px)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 max-w-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">12 px</span>
              <span className="text-sm font-semibold text-foreground">{theme.fontScale}px</span>
              <span className="text-xs text-muted-foreground">25 px</span>
            </div>
            <input
              type="range"
              min={12}
              max={25}
              step={1}
              value={/^\d+$/.test(theme.fontScale) ? parseInt(theme.fontScale, 10) : 16}
              onChange={e => update({ fontScale: e.target.value })}
              className="w-full h-2 rounded accent-primary"
            />
            <div className="flex flex-wrap gap-2">
              {[12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map(px => {
                const active = theme.fontScale === String(px);
                return (
                  <button
                    key={px}
                    onClick={() => update({ fontScale: String(px) })}
                    className={`relative px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                    }`}
                  >
                    {px}px
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Preview: <span className="text-foreground" style={{ fontSize: `${/^\d+$/.test(theme.fontScale) ? theme.fontScale : 16}px`, fontWeight: ({normal:400,medium:500,semibold:600,bold:700} as any)[theme.fontWeight ?? "normal"] }}>The quick brown fox jumps over the lazy dog.</span>
            </p>

            <div className="pt-4 border-t border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Font Weight</span>
                <span className="text-xs text-muted-foreground capitalize">{theme.fontWeight ?? "normal"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: "normal",   label: "Normal",   w: 400 },
                  { id: "medium",   label: "Medium",   w: 500 },
                  { id: "semibold", label: "Semibold", w: 600 },
                  { id: "bold",     label: "Bold",     w: 700 },
                ] as const).map(opt => {
                  const active = (theme.fontWeight ?? "normal") === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => update({ fontWeight: opt.id })}
                      style={{ fontWeight: opt.w }}
                      className={`px-3 py-1.5 rounded-md border text-sm transition-all ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Applies globally; headings and bold text remain stronger.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BORDER RADIUS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Monitor size={18} className="text-violet" /> Border Radius</CardTitle>
          <CardDescription>Controls the roundness of buttons, cards, and inputs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {[
              { label: "None", val: "0" },
              { label: "Small", val: "0.25" },
              { label: "Medium", val: "0.5" },
              { label: "Large", val: "0.75" },
              { label: "Full", val: "1" },
            ].map(r => (
              <button
                key={r.val}
                onClick={() => update({ radius: r.val })}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all ${theme.radius === r.val ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"}`}
              >
                <div className="w-10 h-10 bg-primary/20 border border-primary/30" style={{ borderRadius: `${r.val}rem` }} />
                <span className="text-[10px] font-semibold text-muted-foreground">{r.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ACCESSIBILITY */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Contrast size={18} className="text-primary" /> Accessibility</CardTitle>
          <CardDescription>High-contrast mode for improved readability</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div>
              <p className="text-sm font-semibold text-foreground">High contrast</p>
              <p className="text-xs text-muted-foreground">Increases borders and text contrast across the app</p>
            </div>
            <Switch checked={theme.highContrast} onCheckedChange={(v) => update({ highContrast: !!v })} />
          </div>
        </CardContent>
      </Card>

      {/* PREVIEW */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Eye size={18} /> Live Preview</CardTitle>
          <CardDescription>See how your theme choices look</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button>Primary Button</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge className="bg-success/15 text-success border-0">Success</Badge>
            <Badge className="bg-warning/15 text-warning border-0">Warning</Badge>
            <Badge className="bg-info/15 text-info border-0">Info</Badge>
            <Badge className="bg-destructive/15 text-destructive border-0">Error</Badge>
          </div>

          {/* Mini app preview */}
          <div className="rounded-lg border overflow-hidden grid grid-cols-[120px_1fr] h-48">
            <div className="p-3 space-y-2" style={{
              background: theme.sidebarStyle === "dark" ? "hsl(220 25% 12%)" :
                          theme.sidebarStyle === "light" ? "hsl(0 0% 100%)" :
                          theme.sidebarStyle === "glass" ? "hsl(var(--background) / 0.55)" :
                          `hsl(${theme.primary})`,
              color: ["dark", "tinted"].includes(theme.sidebarStyle) ? "white" : "hsl(var(--foreground))"
            }}>
              <div className="text-[10px] font-bold uppercase opacity-80">Sidebar</div>
              <div className="h-2 rounded bg-current opacity-30" />
              <div className="h-2 rounded bg-current opacity-20 w-3/4" />
              <div className="h-2 rounded bg-current opacity-20 w-2/3" />
              <div className="h-6 rounded mt-2" style={{ background: `hsl(${theme.accent})` }} />
            </div>
            <div className="p-3 bg-card flex flex-col gap-2">
              <div className="h-3 rounded bg-foreground/80 w-1/2" />
              <div className="h-2 rounded bg-muted-foreground/40 w-3/4" />
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="h-12 rounded border" style={{ background: `hsl(${theme.primary} / 0.1)`, borderRadius: `${theme.radius}rem` }} />
                <div className="h-12 rounded border" style={{ background: `hsl(${theme.accent} / 0.1)`, borderRadius: `${theme.radius}rem` }} />
                <div className="h-12 rounded border bg-muted" style={{ borderRadius: `${theme.radius}rem` }} />
              </div>
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <div className="w-8 h-8 rounded-full bg-primary" title="Primary" />
            <div className="w-8 h-8 rounded-full bg-accent" title="Accent" />
            <div className="w-8 h-8 rounded-full bg-info" title="Info" />
            <div className="w-8 h-8 rounded-full bg-success" title="Success" />
            <div className="w-8 h-8 rounded-full bg-warning" title="Warning" />
            <div className="w-8 h-8 rounded-full bg-destructive" title="Destructive" />
            <div className="w-8 h-8 rounded-full bg-indigo" title="Indigo" />
            <div className="w-8 h-8 rounded-full bg-violet" title="Violet" />
            <div className="w-8 h-8 rounded-full bg-rose" title="Rose" />
            <div className="w-8 h-8 rounded-full bg-teal" title="Teal" />
            <div className="w-8 h-8 rounded-full bg-cyan" title="Cyan" />
            <div className="w-8 h-8 rounded-full bg-orange" title="Orange" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={handleReset} className="gap-2"><RefreshCw size={16} /> Reset to Defaults</Button>
        <Button onClick={() => toast.success("Theme preferences saved")} className="gap-2"><Save size={16} /> Save Theme</Button>
      </div>
    </div>
  );
}

// ─── Main Settings Page ──────────────────────────────────
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("profile");

  const tabs = [
    { value: "profile", label: "My Profile", icon: <User size={15} /> },
    { value: "company", label: "Company", icon: <Building2 size={15} /> },
    { value: "stations", label: "Stations", icon: <MapPin size={15} /> },
    { value: "theme", label: "Theme", icon: <Palette size={15} /> },
    { value: "system", label: "System", icon: <Monitor size={15} /> },
    { value: "security", label: "Security", icon: <Shield size={15} /> },
    { value: "notifications", label: "Notifications", icon: <Bell size={15} /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your account, company, and system preferences</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
          {tabs.map(t => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5 text-sm">
              {t.icon}{t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="profile"><UserProfileTab /></TabsContent>
          <TabsContent value="company"><CompanyProfileTab /></TabsContent>
          <TabsContent value="stations"><StationManagementTab /></TabsContent>
          <TabsContent value="theme"><ThemeAppearanceTab /></TabsContent>
          <TabsContent value="system"><SystemPreferencesTab /></TabsContent>
          <TabsContent value="security"><SecurityTab /></TabsContent>
          <TabsContent value="notifications"><NotificationPreferencesTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}