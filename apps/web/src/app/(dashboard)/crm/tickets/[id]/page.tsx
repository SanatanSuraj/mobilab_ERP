"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  supportTickets,
  getAccountById,
  getContactById,
  type SupportTicket,
  type TicketComment,
} from "@/data/crm-mock";
import { getUserById, getProductById, formatDate } from "@/data/mock";
import {
  ArrowLeft,
  Building2,
  User,
  Tag,
  AlertTriangle,
  Shield,
  Clock,
  Send,
  Cpu,
  Package,
  Calendar,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const statusFlow = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;

function getSlaDisplay(slaDeadline: string, status: string): { text: string; isBreached: boolean } {
  if (status === "resolved" || status === "closed") {
    return { text: "Resolved", isBreached: false };
  }
  const now = new Date();
  const deadline = new Date(slaDeadline);
  const diff = deadline.getTime() - now.getTime();
  if (diff <= 0) {
    return { text: "SLA Breached", isBreached: true };
  }
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return { text: `${days}d ${hours % 24}h remaining`, isBreached: false };
  }
  return { text: `${hours}h ${mins}m remaining`, isBreached: false };
}

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ticket = supportTickets.find((t) => t.id === params.id);
  const [currentStatus, setCurrentStatus] = useState(ticket?.status ?? "open");
  const [comments, setComments] = useState<TicketComment[]>(ticket?.comments ?? []);
  const [newComment, setNewComment] = useState("");
  const [isInternal, setIsInternal] = useState(true);

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Ticket not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  const account = getAccountById(ticket.accountId);
  const contact = getContactById(ticket.contactId);
  const product = ticket.productId ? getProductById(ticket.productId) : null;
  const assignee = getUserById(ticket.assignedTo);
  const sla = getSlaDisplay(ticket.slaDeadline, currentStatus);

  const currentIdx = statusFlow.indexOf(currentStatus as (typeof statusFlow)[number]);
  const nextStatusLabel =
    currentIdx < statusFlow.length - 1
      ? statusFlow[currentIdx + 1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : null;

  const advanceStatus = () => {
    if (currentIdx < statusFlow.length - 1) {
      const next = statusFlow[currentIdx + 1];
      setCurrentStatus(next);
      toast.success(`Status updated to ${next.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`);
    }
  };

  const addComment = () => {
    if (!newComment.trim()) return;
    const comment: TicketComment = {
      id: `tc-new-${Date.now()}`,
      type: isInternal ? "internal" : "customer",
      user: isInternal ? "u1" : ticket.contactId,
      content: newComment,
      timestamp: new Date().toISOString(),
    };
    setComments([...comments, comment]);
    setNewComment("");
    toast.success("Comment added");
  };

  // Mock device traceability data
  const deviceHistory = [
    { stage: "Manufactured", date: "2025-11-01", detail: "Batch BT-231215" },
    { stage: "QC Passed", date: "2025-11-05", detail: "All tests passed" },
    { stage: "Dispatched", date: "2025-11-08", detail: `Shipped to ${account?.name}` },
    { stage: "Delivered", date: "2025-11-10", detail: "Received and installed" },
    { stage: "Ticket Created", date: formatDate(ticket.createdAt), detail: ticket.ticketNumber },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <Link
        href="/crm/tickets"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tickets
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {ticket.ticketNumber}
            </h1>
            <StatusBadge status={ticket.priority} />
            <StatusBadge status={currentStatus} />
          </div>
          <p className="text-sm text-muted-foreground">{ticket.subject}</p>
        </div>
        <div
          className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 ${
            sla.isBreached
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-green-50 text-green-700 border border-green-200"
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          {sla.text}
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="comments">
            Comments ({comments.length})
          </TabsTrigger>
          <TabsTrigger value="device">Device Traceability</TabsTrigger>
        </TabsList>

        {/* DETAILS */}
        <TabsContent value="details" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Account</span>
                </div>
                <p className="text-sm font-medium">{account?.name ?? "N/A"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <User className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Contact</span>
                </div>
                <p className="text-sm font-medium">
                  {contact
                    ? `${contact.firstName} ${contact.lastName}`
                    : "N/A"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Tag className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Category</span>
                </div>
                <StatusBadge status={ticket.category} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Priority</span>
                </div>
                <StatusBadge status={ticket.priority} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <User className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Assigned To</span>
                </div>
                <p className="text-sm font-medium">{assignee?.name ?? "N/A"}</p>
              </CardContent>
            </Card>
            {ticket.deviceSerial && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Cpu className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Device Serial</span>
                  </div>
                  <p className="text-sm font-mono font-medium">
                    {ticket.deviceSerial}
                  </p>
                </CardContent>
              </Card>
            )}
            {product && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Package className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Product</span>
                  </div>
                  <p className="text-sm font-medium">{product.name}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Status Flow */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Status Flow</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {statusFlow.map((stage, idx) => {
                  const isActive = currentIdx >= idx;
                  const isCurrent = currentIdx === idx;
                  return (
                    <div key={stage} className="flex items-center gap-1">
                      <div
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                          isCurrent
                            ? "bg-primary text-primary-foreground"
                            : isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isActive && <CheckCircle2 className="h-3 w-3" />}
                        {stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </div>
                      {idx < statusFlow.length - 1 && (
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
              {nextStatusLabel && (
                <div className="mt-4">
                  <Button size="sm" onClick={advanceStatus}>
                    Update to {nextStatusLabel}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Description */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {ticket.description}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COMMENTS */}
        <TabsContent value="comments" className="mt-4 space-y-4">
          {/* Add Comment */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Label htmlFor="internal-toggle" className="text-xs text-muted-foreground">
                  {isInternal ? "Internal Note" : "Customer Reply"}
                </Label>
                <Switch
                  id="internal-toggle"
                  checked={isInternal}
                  onCheckedChange={setIsInternal}
                />
              </div>
              <div className="flex gap-2">
                <Textarea
                  placeholder={
                    isInternal
                      ? "Add an internal note..."
                      : "Reply to customer..."
                  }
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="min-h-[60px] text-sm resize-none"
                />
                <Button
                  size="icon"
                  className="shrink-0 self-end"
                  onClick={addComment}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Comments Timeline */}
          <div className="space-y-3">
            {comments.map((comment) => {
              const isInternalComment = comment.type === "internal";
              const commenter = isInternalComment
                ? getUserById(comment.user)
                : getContactById(comment.user);
              const name = isInternalComment
                ? (commenter as any)?.name ?? "Team"
                : commenter
                ? `${(commenter as any).firstName} ${(commenter as any).lastName}`
                : "Customer";
              const initials = isInternalComment
                ? (commenter as any)?.avatar ?? "T"
                : name
                    .split(" ")
                    .map((n: string) => n[0])
                    .join("")
                    .slice(0, 2);

              return (
                <div
                  key={comment.id}
                  className={`flex gap-3 p-3 rounded-lg border ${
                    isInternalComment
                      ? "border-blue-200 bg-blue-50/30"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback
                      className={`text-[10px] ${
                        isInternalComment
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{name}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            isInternalComment
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {isInternalComment ? "Internal" : "Customer"}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(comment.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      {comment.content}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* DEVICE TRACEABILITY */}
        <TabsContent value="device" className="mt-4 space-y-4">
          {/* Device Info Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Device Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Serial Number</p>
                  <p className="text-sm font-mono font-medium">
                    {ticket.deviceSerial ?? "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Product</p>
                  <p className="text-sm font-medium">
                    {product?.name ?? "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Batch</p>
                  <p className="text-sm font-mono font-medium">BT-231215</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Warranty Status
                  </p>
                  <StatusBadge status="warranty" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Purchase Date</p>
                  <p className="text-sm font-medium">10 Nov 2025</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Customer</p>
                  <p className="text-sm font-medium">{account?.name ?? "N/A"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Device History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Device History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative">
                {deviceHistory.map((step, idx) => (
                  <div key={idx} className="flex gap-3 pb-4 last:pb-0">
                    <div className="flex flex-col items-center">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      </div>
                      {idx < deviceHistory.length - 1 && (
                        <div className="w-0.5 flex-1 bg-border mt-1" />
                      )}
                    </div>
                    <div className="pt-1">
                      <p className="text-sm font-medium">{step.stage}</p>
                      <p className="text-xs text-muted-foreground">
                        {step.date} &middot; {step.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
