"use client";

// TODO(phase-5): HR module has no backend routes yet. Expected routes:
//   GET /hr/employees/:id - fetch employee detail + activity feed
//   GET /hr/leaves?employeeId=:id - fetch employee leave history
// Mock imports left in place until the HR module ships in apps/api/src/modules/hr.

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Mail, Phone, Building2, Calendar, UserCircle } from "lucide-react";
import { employees, leaveRequests, getUserById, getActivitiesForEntity, formatDate } from "@/data/mock";

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const employee = employees.find((e) => e.id === id);

  if (!employee) {
    return <div className="p-8 text-center text-muted-foreground">Employee not found</div>;
  }

  const empLeaves = leaveRequests.filter((lr) => lr.employeeId === employee.id);
  const manager = employee.reportingTo ? getUserById(employee.reportingTo) : null;
  const empActivities = getActivitiesForEntity("employee", employee.id);

  const totalLeave = employee.leaveBalance.casual + employee.leaveBalance.sick + employee.leaveBalance.earned;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title={employee.name}
        description={employee.designation}
        actions={<StatusBadge status={employee.status} />}
      />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="leaves">Leave History ({empLeaves.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="md:col-span-1">
              <CardContent className="p-6 flex flex-col items-center text-center">
                <Avatar className="h-20 w-20 mb-4">
                  <AvatarFallback className="text-2xl bg-primary/10 text-primary">{employee.avatar}</AvatarFallback>
                </Avatar>
                <h2 className="text-lg font-semibold">{employee.name}</h2>
                <p className="text-sm text-muted-foreground">{employee.designation}</p>
                <StatusBadge status={employee.status} className="mt-2" />
                <Separator className="my-4" />
                <div className="space-y-3 w-full text-left">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{employee.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{employee.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span>{employee.department}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>Joined {formatDate(employee.joinDate)}</span>
                  </div>
                  {manager && (
                    <div className="flex items-center gap-2 text-sm">
                      <UserCircle className="h-4 w-4 text-muted-foreground" />
                      <span>Reports to {manager.name}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Leave Balance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { type: "Casual Leave", balance: employee.leaveBalance.casual, total: 12, color: "bg-blue-500" },
                  { type: "Sick Leave", balance: employee.leaveBalance.sick, total: 8, color: "bg-amber-500" },
                  { type: "Earned Leave", balance: employee.leaveBalance.earned, total: 18, color: "bg-green-500" },
                ].map((leave) => (
                  <div key={leave.type} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span>{leave.type}</span>
                      <span className="font-medium">{leave.balance} / {leave.total} days</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${leave.color}`}
                        style={{ width: `${(leave.balance / leave.total) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="leaves" className="mt-4">
          <div className="space-y-2">
            {empLeaves.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No leave history</p>}
            {empLeaves.map((lr) => (
              <Card key={lr.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Badge variant="outline" className="capitalize">{lr.type}</Badge>
                    <div>
                      <p className="text-sm font-medium">{formatDate(lr.startDate)} - {formatDate(lr.endDate)}</p>
                      <p className="text-xs text-muted-foreground">{lr.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{lr.days} day{lr.days > 1 ? "s" : ""}</span>
                    <StatusBadge status={lr.status} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <ActivityFeed activities={empActivities} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
