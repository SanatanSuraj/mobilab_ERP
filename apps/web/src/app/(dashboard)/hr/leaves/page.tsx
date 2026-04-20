"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, Clock, CheckCircle, XCircle, Plus, Check, X } from "lucide-react";
import { leaveRequests, employees, getUserById, formatDate, type LeaveRequest } from "@/data/mock";
import { toast } from "sonner";

export default function LeavesPage() {
  const [leaves, setLeaves] = useState(leaveRequests);
  const [dialogOpen, setDialogOpen] = useState(false);

  const pending = leaves.filter((l) => l.status === "pending");
  const approved = leaves.filter((l) => l.status === "approved");
  const rejected = leaves.filter((l) => l.status === "rejected");

  function handleApprove(id: string) {
    setLeaves((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status: "approved" as const, approvedBy: "u7" } : l))
    );
    toast.success("Leave request approved");
  }

  function handleReject(id: string) {
    setLeaves((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status: "rejected" as const } : l))
    );
    toast.error("Leave request rejected");
  }

  function LeaveCard({ leave }: { leave: LeaveRequest }) {
    const emp = employees.find((e) => e.id === leave.employeeId);
    const approver = leave.approvedBy ? getUserById(leave.approvedBy) : null;
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <Avatar className="h-9 w-9 mt-0.5">
                <AvatarFallback className="text-xs bg-primary/10 text-primary">{emp?.avatar}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">{emp?.name}</p>
                <p className="text-xs text-muted-foreground">{emp?.designation} - {emp?.department}</p>
                <div className="flex items-center gap-3 mt-2">
                  <Badge variant="outline" className="capitalize text-xs">{leave.type}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(leave.startDate)} - {formatDate(leave.endDate)} ({leave.days} day{leave.days > 1 ? "s" : ""})
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1.5">{leave.reason}</p>
                {approver && (
                  <p className="text-xs text-muted-foreground mt-1">Approved by {approver.name}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={leave.status} />
              {leave.status === "pending" && (
                <div className="flex gap-1 ml-2">
                  <Button size="icon" variant="outline" className="h-7 w-7 text-green-600 hover:bg-green-50" onClick={() => handleApprove(leave.id)}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="outline" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => handleReject(leave.id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Leave Management"
        description="Review and manage leave requests"
        actions={
          <>
          <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-2" /> Apply Leave</Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Apply for Leave</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Leave Type</Label>
                  <Select>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="casual">Casual Leave</SelectItem>
                      <SelectItem value="sick">Sick Leave</SelectItem>
                      <SelectItem value="earned">Earned Leave</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input type="date" />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input type="date" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Reason</Label>
                  <Textarea placeholder="Enter reason for leave..." />
                </div>
                <Button className="w-full" onClick={() => { setDialogOpen(false); toast.success("Leave request submitted"); }}>
                  Submit Request
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard title="Total Requests" value={String(leaves.length)} icon={Calendar} />
        <KPICard title="Pending" value={String(pending.length)} icon={Clock} change="Needs action" trend="neutral" />
        <KPICard title="Approved" value={String(approved.length)} icon={CheckCircle} />
        <KPICard title="Rejected" value={String(rejected.length)} icon={XCircle} />
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
          <TabsTrigger value="all">All ({leaves.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4 space-y-2">
          {pending.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No pending requests</p>}
          {pending.map((l) => <LeaveCard key={l.id} leave={l} />)}
        </TabsContent>
        <TabsContent value="approved" className="mt-4 space-y-2">
          {approved.map((l) => <LeaveCard key={l.id} leave={l} />)}
        </TabsContent>
        <TabsContent value="rejected" className="mt-4 space-y-2">
          {rejected.map((l) => <LeaveCard key={l.id} leave={l} />)}
        </TabsContent>
        <TabsContent value="all" className="mt-4 space-y-2">
          {leaves.map((l) => <LeaveCard key={l.id} leave={l} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
