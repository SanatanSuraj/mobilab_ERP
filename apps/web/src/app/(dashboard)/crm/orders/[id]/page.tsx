"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  orders,
  deliveryChallans,
  getAccountById,
  getContactById,
  getCrmActivitiesForEntity,
  type Order,
} from "@/data/crm-mock";
import { getUserById, formatCurrency, formatDate, type Activity } from "@/data/mock";
import {
  ArrowLeft,
  Building2,
  User,
  FileText,
  Calendar,
  Truck,
  Package,
  Check,
  X,
  MessageCircle,
  Mail,
  Hash,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const dispatchStages = ["dispatched", "in_transit", "delivered"] as const;

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const order = orders.find((o) => o.id === params.id);
  const [orderStatus, setOrderStatus] = useState(order?.status ?? "confirmed");

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Order not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  const account = getAccountById(order.accountId);
  const contact = getContactById(order.contactId);
  const challan = deliveryChallans.find((dc) => dc.orderId === order.id);

  const crmActs = getCrmActivitiesForEntity("order", order.id);
  const adaptedActivities = crmActs.map((a) => ({
    ...a,
    entityType: a.entityType as any,
  })) as any as Activity[];

  const nextStatus = (): string | null => {
    const flow = ["confirmed", "processing", "ready_to_dispatch", "dispatched", "in_transit", "delivered"];
    const idx = flow.indexOf(orderStatus);
    if (idx < flow.length - 1) return flow[idx + 1];
    return null;
  };

  const advanceStatus = () => {
    const next = nextStatus();
    if (next) {
      setOrderStatus(next as Order["status"]);
      if (next === "dispatched") {
        toast.success("Order dispatched. Customer notified via WhatsApp");
      } else {
        toast.success(`Status updated to ${next.replace(/_/g, " ")}`);
      }
    }
  };

  const dispatchIdx = dispatchStages.indexOf(
    orderStatus as (typeof dispatchStages)[number]
  );

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <Link
        href="/crm/orders"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Orders
      </Link>

      <PageHeader
        title={order.orderNumber}
        description={account?.name ?? ""}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={orderStatus} />
            {order.whatsappSent && (
              <MessageCircle className="h-4 w-4 text-green-600" />
            )}
            {order.emailSent && <Mail className="h-4 w-4 text-blue-600" />}
          </div>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="mt-4">
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
                  <FileText className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Quotation Ref</span>
                </div>
                <p className="text-sm font-medium">{order.quotationRef}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Order Date</span>
                </div>
                <p className="text-sm font-medium">{formatDate(order.orderDate)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Truck className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Expected Delivery</span>
                </div>
                <p className="text-sm font-medium">
                  {formatDate(order.expectedDelivery)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Package className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">
                    Finished Goods Available
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {order.fgAvailable ? (
                    <>
                      <Check className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-600">
                        Available
                      </span>
                    </>
                  ) : (
                    <>
                      <X className="h-4 w-4 text-red-500" />
                      <span className="text-sm font-medium text-red-500">
                        Not Available
                      </span>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Grand Total</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(order.grandTotal)}
                  </p>
                </div>
                {nextStatus() && (
                  <Button size="sm" onClick={advanceStatus}>
                    Mark as{" "}
                    {nextStatus()!.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ITEMS */}
        <TabsContent value="items" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Order Items</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  toast.success("Serial numbers assigned to all eligible items")
                }
              >
                <Hash className="h-4 w-4 mr-1.5" />
                Assign Serial Numbers
              </Button>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead>Serial Numbers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium text-sm">
                          {item.productName}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatCurrency(item.unitPrice)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.serialNumbers && item.serialNumbers.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {item.serialNumbers.map((sn) => (
                                <span
                                  key={sn}
                                  className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono"
                                >
                                  {sn}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Not assigned
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* DISPATCH */}
        <TabsContent value="dispatch" className="mt-4 space-y-4">
          {/* Dispatch pipeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Dispatch Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {dispatchStages.map((stage, idx) => {
                  const isActive = dispatchIdx >= idx;
                  const isCurrent = dispatchIdx === idx;
                  return (
                    <div key={stage} className="flex items-center gap-2 flex-1">
                      <div
                        className={`flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${
                          isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-muted text-muted-foreground"
                        } ${isCurrent ? "ring-2 ring-green-500" : ""}`}
                      >
                        {isActive ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Clock className="h-4 w-4" />
                        )}
                      </div>
                      <span
                        className={`text-xs font-medium ${
                          isActive ? "text-green-700" : "text-muted-foreground"
                        }`}
                      >
                        {stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                      {idx < dispatchStages.length - 1 && (
                        <div
                          className={`flex-1 h-0.5 ${
                            dispatchIdx > idx ? "bg-green-400" : "bg-muted"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {nextStatus() && (
                <div className="mt-4">
                  <Button size="sm" onClick={advanceStatus}>
                    Mark as{" "}
                    {nextStatus()!.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Delivery Challan */}
          {challan ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Delivery Challan - {challan.challanNumber}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Transporter</p>
                    <p className="text-sm font-medium">
                      {challan.transporterName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Vehicle</p>
                    <p className="text-sm font-medium">{challan.vehicleNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="h-3 w-3" /> Driver
                    </p>
                    <p className="text-sm font-medium">{challan.driverName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3" /> Driver Phone
                    </p>
                    <p className="text-sm font-medium">{challan.driverPhone}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Dispatch Date</p>
                    <p className="text-sm font-medium">
                      {formatDate(challan.dispatchDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Expected Arrival
                    </p>
                    <p className="text-sm font-medium">
                      {formatDate(challan.expectedArrival)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <StatusBadge status={challan.status} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <Truck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  No delivery challan created yet
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    toast.success("Delivery challan created successfully")
                  }
                >
                  Create Delivery Challan
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ACTIVITY */}
        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity Feed</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed activities={adaptedActivities} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
