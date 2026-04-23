"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore, UserRole, MOCK_USERS_BY_ROLE } from "@/store/auth.store";
import { Shield, UserPlus, Edit2, Lock } from "lucide-react";
import { toast } from "sonner";

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  MANAGEMENT: "Management",
  SALES_REP: "Sales Rep",
  SALES_MANAGER: "Sales Manager",
  FINANCE: "Finance",
  PRODUCTION: "Production Operator",
  PRODUCTION_MANAGER: "Production Manager",
  RD: "R&D / Engineering",
  QC_INSPECTOR: "QC Inspector",
  QC_MANAGER: "QC Manager",
  STORES: "Stores",
  CUSTOMER: "Customer Portal",
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: "Full system access including user management and audit logs",
  MANAGEMENT: "All modules (read) + approvals — no direct CRM/WO creation",
  SALES_REP: "Own deals, leads, accounts, dispatch, support tickets",
  SALES_MANAGER: "All CRM data across reps, pipeline reports, reassignment",
  FINANCE: "PO approval, invoices, ledger, GST, Tally export",
  PRODUCTION: "WIP stage advancement, component assignment, stage notes",
  PRODUCTION_MANAGER: "All production + manual WO creation, scheduling, capacity",
  RD: "BOM creation/editing (DRAFT), ECN initiation",
  QC_INSPECTOR: "Inspection queue, defect logging, certificate issuance",
  QC_MANAGER: "All QC + template management, quarantine, amendment",
  STORES: "Inward entry, cycle count, stock adjustment, transfers",
  CUSTOMER: "Own orders, invoices, QC certs, support tickets (portal only)",
};

type MockUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  status: "ACTIVE" | "INACTIVE";
  lastLogin: string;
};

const MOCK_USERS: MockUser[] = [
  { id: "u1", name: "Chetan (HOD)", email: "chetan@instigenie.in", role: "PRODUCTION_MANAGER", department: "Manufacturing", status: "ACTIVE", lastLogin: "2026-04-18" },
  { id: "u2", name: "Shubham", email: "shubham@instigenie.in", role: "PRODUCTION", department: "Manufacturing", status: "ACTIVE", lastLogin: "2026-04-18" },
  { id: "u3", name: "Sanju", email: "sanju@instigenie.in", role: "PRODUCTION", department: "Manufacturing", status: "ACTIVE", lastLogin: "2026-04-17" },
  { id: "u4", name: "Jatin", email: "jatin@instigenie.in", role: "PRODUCTION", department: "Manufacturing", status: "ACTIVE", lastLogin: "2026-04-18" },
  { id: "u5", name: "Rishabh", email: "rishabh@instigenie.in", role: "PRODUCTION", department: "Manufacturing", status: "ACTIVE", lastLogin: "2026-04-16" },
  { id: "u6", name: "Binsu", email: "binsu@instigenie.in", role: "QC_INSPECTOR", department: "Quality", status: "ACTIVE", lastLogin: "2026-04-18" },
  { id: "u7", name: "Saurabh", email: "saurabh@instigenie.in", role: "STORES", department: "Warehouse", status: "ACTIVE", lastLogin: "2026-04-15" },
  { id: "u8", name: "Minakshi", email: "minakshi@instigenie.in", role: "STORES", department: "Warehouse", status: "ACTIVE", lastLogin: "2026-04-14" },
  { id: "u9", name: "Priya Sharma", email: "priya@instigenie.in", role: "SALES_REP", department: "Sales", status: "ACTIVE", lastLogin: "2026-04-18" },
  { id: "u10", name: "Anita Das", email: "anita@instigenie.in", role: "FINANCE", department: "Finance", status: "ACTIVE", lastLogin: "2026-04-18" },
  { id: "u11", name: "QC Manager", email: "qcmgr@instigenie.in", role: "QC_MANAGER", department: "Quality", status: "ACTIVE", lastLogin: "2026-04-17" },
  { id: "u12", name: "Management User", email: "mgmt@instigenie.in", role: "MANAGEMENT", department: "Management", status: "ACTIVE", lastLogin: "2026-04-18" },
];

const ROLE_COLORS: Partial<Record<UserRole, string>> = {
  SUPER_ADMIN: "bg-red-50 text-red-700 border-red-200",
  MANAGEMENT: "bg-purple-50 text-purple-700 border-purple-200",
  SALES_REP: "bg-blue-50 text-blue-700 border-blue-200",
  SALES_MANAGER: "bg-blue-50 text-blue-700 border-blue-200",
  FINANCE: "bg-green-50 text-green-700 border-green-200",
  PRODUCTION: "bg-amber-50 text-amber-700 border-amber-200",
  PRODUCTION_MANAGER: "bg-orange-50 text-orange-700 border-orange-200",
  RD: "bg-cyan-50 text-cyan-700 border-cyan-200",
  QC_INSPECTOR: "bg-indigo-50 text-indigo-700 border-indigo-200",
  QC_MANAGER: "bg-violet-50 text-violet-700 border-violet-200",
  STORES: "bg-teal-50 text-teal-700 border-teal-200",
  CUSTOMER: "bg-gray-50 text-gray-600 border-gray-200",
};

export default function UsersRolesPage() {
  const { role: currentRole } = useAuthStore();
  const [users, setUsers] = useState<MockUser[]>(MOCK_USERS);
  const [editUser, setEditUser] = useState<MockUser | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [newRole, setNewRole] = useState<UserRole | "">("");
  const [activeTab, setActiveTab] = useState<"users" | "roles">("users");

  const roleCount = Object.entries(
    users.reduce((acc, u) => ({ ...acc, [u.role]: (acc[u.role] ?? 0) + 1 }), {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]);

  function handleEditRole(user: MockUser) {
    setEditUser(user);
    setNewRole(user.role);
    setEditDialogOpen(true);
  }

  function handleSaveRole() {
    if (!editUser || !newRole) return;
    setUsers((prev) =>
      prev.map((u) => (u.id === editUser.id ? { ...u, role: newRole as UserRole } : u))
    );
    toast.success(`Role updated: ${editUser.name} → ${ROLE_LABELS[newRole as UserRole]}`);
    setEditDialogOpen(false);
    setEditUser(null);
  }

  if (currentRole !== "SUPER_ADMIN") {
    return (
      <div className="p-6 max-w-[900px] mx-auto">
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
            <Lock className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold">Access Restricted</h2>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            User & Role management is restricted to Super Admin only. Your current role is{" "}
            <span className="font-medium">{currentRole ? ROLE_LABELS[currentRole] : "Unknown"}</span>.
          </p>
          <p className="text-xs text-muted-foreground">Use the role switcher in the sidebar to switch to Super Admin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {/* Edit Role Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { if (!open) setEditDialogOpen(false); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Edit User Role</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                  {editUser.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{editUser.name}</p>
                  <p className="text-xs text-muted-foreground">{editUser.email}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>New Role</Label>
                <Select
                  value={newRole}
                  onValueChange={(v) => setNewRole((v ?? "") as UserRole)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {newRole && (
                <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
                  {ROLE_DESCRIPTIONS[newRole as UserRole]}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveRole} disabled={!newRole}>Save Role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users & Roles</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage system users and their access permissions. All permissions enforced at API layer.
          </p>
        </div>
        <Button onClick={() => toast.info("Invite user — coming in Phase 1 backend.")}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite User
        </Button>
      </div>

      {/* Tab Toggle */}
      <div className="flex gap-2 border-b pb-0">
        {(["users", "roles"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "users" ? "Users" : "Role Definitions"}
          </button>
        ))}
      </div>

      {activeTab === "users" && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Total Users</p>
              <p className="text-2xl font-bold mt-1">{users.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-2xl font-bold mt-1 text-green-600">{users.filter((u) => u.status === "ACTIVE").length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Production Team</p>
              <p className="text-2xl font-bold mt-1">{users.filter((u) => u.role === "PRODUCTION" || u.role === "PRODUCTION_MANAGER").length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Roles in Use</p>
              <p className="text-2xl font-bold mt-1">{new Set(users.map((u) => u.role)).size}</p>
            </Card>
          </div>

          {/* Users Table */}
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                          {user.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium">{user.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[user.role] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                        {ROLE_LABELS[user.role]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{user.department}</TableCell>
                    <TableCell>
                      <StatusBadge status={user.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{user.lastLogin}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleEditRole(user)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {activeTab === "roles" && (
        <div className="space-y-4">
          {/* Role usage summary */}
          <div className="flex flex-wrap gap-2 mb-2">
            {roleCount.map(([role, count]) => (
              <span key={role} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${ROLE_COLORS[role as UserRole] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                {ROLE_LABELS[role as UserRole]}
                <Badge variant="secondary" className="h-4 text-[10px] px-1">{count}</Badge>
              </span>
            ))}
          </div>

          {/* Role definitions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
              <Card key={role} className="overflow-hidden">
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">{ROLE_LABELS[role]}</CardTitle>
                    <div className="flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {users.filter((u) => u.role === role).length} user{users.filter((u) => u.role === role).length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
            ⚠ All permissions are enforced at the API middleware layer — not just the UI. Frontend role restrictions are a UX feature only.
          </p>
        </div>
      )}
    </div>
  );
}
