"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Users, UserCheck, UserX, Clock, Plus } from "lucide-react";
import { employees, type Employee } from "@/data/mock";

export default function EmployeesPage() {
  const router = useRouter();

  const active = employees.filter((e) => e.status === "active").length;
  const onLeave = employees.filter((e) => e.status === "on_leave").length;

  const columns: Column<Employee>[] = [
    {
      key: "name",
      header: "Employee",
      render: (e) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs bg-primary/10 text-primary">{e.avatar}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-sm">{e.name}</p>
            <p className="text-xs text-muted-foreground">{e.email}</p>
          </div>
        </div>
      ),
    },
    { key: "department", header: "Department", sortable: true },
    { key: "designation", header: "Designation" },
    {
      key: "status",
      header: "Status",
      render: (e) => <StatusBadge status={e.status} />,
    },
    { key: "phone", header: "Phone" },
    {
      key: "leaveBalance",
      header: "Leave Balance",
      render: (e) => (
        <div className="text-xs space-x-2">
          <span className="text-muted-foreground">CL: <span className="font-medium text-foreground">{e.leaveBalance.casual}</span></span>
          <span className="text-muted-foreground">SL: <span className="font-medium text-foreground">{e.leaveBalance.sick}</span></span>
          <span className="text-muted-foreground">EL: <span className="font-medium text-foreground">{e.leaveBalance.earned}</span></span>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Employee Directory"
        description="Manage your team members"
        actions={<Button><Plus className="h-4 w-4 mr-2" /> Add Employee</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard title="Total Employees" value={String(employees.length)} icon={Users} />
        <KPICard title="Active" value={String(active)} icon={UserCheck} change={`${Math.round((active / employees.length) * 100)}% of total`} trend="up" />
        <KPICard title="On Leave" value={String(onLeave)} icon={Clock} />
        <KPICard title="Departments" value="5" icon={UserX} />
      </div>

      <DataTable<Employee>
        data={employees}
        columns={columns}
        searchKey="name"
        searchPlaceholder="Search employees..."
        onRowClick={(e) => router.push(`/hr/employees/${e.id}`)}
      />
    </div>
  );
}
