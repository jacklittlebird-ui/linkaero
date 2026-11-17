import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Users as UsersIcon, Plus, Shield, Trash2, Pencil } from "lucide-react";
import { formatDateDMY } from "@/lib/utils";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";

type AppRole = "admin" | "station_manager" | "station_ops" | "employee" | "clearance" | "contracts" | "operations" | "receivables" | "payables" | "general_accounts" | "accountant" | "treasury" | "viewer";

interface UserProfile {
  id: string;
  user_id: string;
  full_name: string | null;
  station: string | null;
  created_at: string;
}

interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

const ROLE_COLORS: Record<AppRole, string> = {
  admin: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  station_manager: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  station_ops: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  employee: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  clearance: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  contracts: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  operations: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  receivables: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  payables: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  general_accounts: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  accountant: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  treasury: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  viewer: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
};

const ALL_ROLES: AppRole[] = ["admin", "accountant", "clearance", "contracts", "employee", "general_accounts", "operations", "payables", "receivables", "station_manager", "station_ops", "treasury", "viewer"];

export default function UsersPage() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Add role dialog
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<AppRole>("employee");

  // Create user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("employee");
  const [creating, setCreating] = useState(false);

  // Edit user dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<UserProfile | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editStation, setEditStation] = useState("");

  const fetchData = async () => {
    setLoading(true);
    const [profilesRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("*"),
    ]);
    if (profilesRes.data) setProfiles(profilesRes.data);
    if (rolesRes.data) setRoles(rolesRes.data);

    if (user) {
      const { data } = await supabase.rpc("is_admin", { _user_id: user.id });
      setIsAdmin(!!data);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const usersPag = usePagination(profiles, { resetKey: profiles.length });

  const getUserRoles = (userId: string) =>
    roles.filter((r) => r.user_id === userId);

  const handleAddRole = async () => {
    if (!selectedUserId || !selectedRole) return;
    const { error } = await supabase.from("user_roles").insert({
      user_id: selectedUserId,
      role: selectedRole,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Role added");
      setAddRoleOpen(false);
      fetchData();
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Role removed");
      fetchData();
    }
  };

  const handleCreateUser = async () => {
    if (!newEmail || !newPassword) return;
    setCreating(true);

    const { data, error } = await supabase.auth.signUp({
      email: newEmail,
      password: newPassword,
      options: { data: { full_name: newFullName } },
    });

    if (error) {
      toast.error(error.message);
      setCreating(false);
      return;
    }

    if (data.user) {
      await supabase.from("user_roles").insert({
        user_id: data.user.id,
        role: newRole,
      });
    }

    toast.success("User created");
    setCreateOpen(false);
    setNewEmail("");
    setNewPassword("");
    setNewFullName("");
    setNewRole("employee");
    setCreating(false);
    setTimeout(fetchData, 1500);
  };

  const openEdit = (p: UserProfile) => {
    setEditProfile(p);
    setEditFullName(p.full_name || "");
    setEditStation(p.station || "");
    setEditOpen(true);
  };

  const handleEditUser = async () => {
    if (!editProfile) return;
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: editFullName, station: editStation })
      .eq("id", editProfile.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("User updated");
      setEditOpen(false);
      setEditProfile(null);
      fetchData();
    }
  };

  const handleDeleteUser = async (profile: UserProfile) => {
    // Delete roles first, then profile
    await supabase.from("user_roles").delete().eq("user_id", profile.user_id);
    const { error } = await supabase.from("profiles").delete().eq("id", profile.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("User deleted");
      fetchData();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UsersIcon className="h-6 w-6" /> Users
          </h1>
          <p className="text-muted-foreground text-sm">
            Manage system users and their roles
          </p>
        </div>
        {isAdmin && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" /> Add User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>Full Name</Label>
                  <Input value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div>
                  <Label>Role</Label>
                  <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ALL_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreateUser} disabled={creating || !newEmail || !newPassword}>
                  {creating ? "Creating..." : "Create User"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Full Name</Label>
              <Input value={editFullName} onChange={(e) => setEditFullName(e.target.value)} />
            </div>
            <div>
              <Label>Station</Label>
              <Input value={editStation} onChange={(e) => setEditStation(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEditUser}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Users ({profiles.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Station</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Joined</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersPag.pageRows.map((p) => {
                  const userRoles = getUserRoles(p.user_id);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.full_name || "—"}</TableCell>
                      <TableCell>{p.station || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {userRoles.length === 0 && (
                            <span className="text-muted-foreground text-xs">No roles</span>
                          )}
                          {userRoles.map((r) => (
                            <Badge key={r.id} variant="secondary" className={`${ROLE_COLORS[r.role]} text-xs`}>
                              {r.role.replace(/_/g, " ")}
                              {isAdmin && (
                                <button
                                  onClick={() => handleRemoveRole(r.id)}
                                  className="ml-1 hover:text-destructive"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDateDMY(p.created_at)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* Add Role */}
                            <Dialog open={addRoleOpen && selectedUserId === p.user_id} onOpenChange={(open) => {
                              setAddRoleOpen(open);
                              if (open) setSelectedUserId(p.user_id);
                            }}>
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <Shield className="h-3 w-3 mr-1" /> Role
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Add Role to {p.full_name}</DialogTitle>
                                </DialogHeader>
                                <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as AppRole)}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {ALL_ROLES.filter((r) => !userRoles.some((ur) => ur.role === r)).map((r) => (
                                      <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <DialogFooter>
                                  <Button onClick={handleAddRole}>Add Role</Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>

                            {/* Edit */}
                            <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                              <Pencil className="h-3 w-3" />
                            </Button>

                            {/* Delete */}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete User</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete {p.full_name || "this user"}? This will remove their profile and all assigned roles. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDeleteUser(p)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <TablePagination {...usersPag} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
