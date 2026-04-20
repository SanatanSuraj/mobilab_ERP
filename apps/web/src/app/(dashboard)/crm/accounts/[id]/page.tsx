"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  accounts,
  contacts,
  getContactsForAccount,
  supportTickets,
  getCrmActivitiesForEntity,
  getHealthScoreColor,
  getHealthScoreLabel,
  getContactById,
  type CrmActivity,
} from "@/data/crm-mock";
import {
  deals,
  getUserById,
  formatCurrency,
  formatDate,
  type Activity,
} from "@/data/mock";
import {
  ArrowLeft,
  Building2,
  Phone,
  Globe,
  MapPin,
  FileText,
  Users,
  DollarSign,
  Activity as ActivityIcon,
  Heart,
  Star,
} from "lucide-react";

function crmToActivity(crm: CrmActivity): Activity {
  return {
    id: crm.id,
    entityType: crm.entityType as Activity["entityType"],
    entityId: crm.entityId,
    type: crm.type === "whatsapp" || crm.type === "email" || crm.type === "call" || crm.type === "meeting"
      ? "comment"
      : crm.type as Activity["type"],
    user: crm.user,
    content: crm.content,
    timestamp: crm.timestamp,
  };
}

export default function AccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;

  const account = accounts.find((a) => a.id === accountId);

  if (!account) {
    return (
      <div className="p-6">
        <div className="text-center py-20">
          <h2 className="text-xl font-semibold mb-2">Account not found</h2>
          <p className="text-muted-foreground mb-4">
            The account you are looking for does not exist.
          </p>
          <Button variant="outline" onClick={() => router.push("/crm/accounts")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Accounts
          </Button>
        </div>
      </div>
    );
  }

  const owner = getUserById(account.ownerId);
  const accountContacts = getContactsForAccount(account.id);
  const accountDeals = deals.filter((d) => d.company === account.name);
  const accountTickets = supportTickets.filter((t) => t.accountId === account.id);
  const crmActivities = getCrmActivitiesForEntity("account", account.id);
  const feedActivities = crmActivities.map(crmToActivity);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4"
        onClick={() => router.push("/crm/accounts")}
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Accounts
      </Button>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{account.name}</h1>
              {account.isKeyAccount && (
                <Badge className="bg-amber-50 text-amber-700 border-amber-200" variant="outline">
                  <Star className="h-3 w-3 mr-1" />
                  Key Account
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-muted-foreground">{account.industry}</span>
              <Badge
                variant="outline"
                className={`text-xs font-medium ${getHealthScoreColor(account.healthScore)}`}
              >
                {account.healthScore} &middot; {getHealthScoreLabel(account.healthScore)}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="deals">Deals</TabsTrigger>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Account Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Address</p>
                      <p className="text-sm font-medium">
                        {account.address}, {account.city}, {account.state}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p className="text-sm font-medium">{account.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Globe className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Website</p>
                      <p className="text-sm font-medium">{account.website}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">GSTIN</p>
                      <p className="text-sm font-medium font-mono">{account.gstin}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Employees</p>
                      <p className="text-sm font-medium">{account.employeeCount.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Account Owner</p>
                      <p className="text-sm font-medium">{owner?.name ?? "Unassigned"}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Revenue
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{formatCurrency(account.annualRevenue)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Annual revenue</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Heart className="h-4 w-4" />
                    Health Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl font-bold">{account.healthScore}</span>
                    <Badge
                      variant="outline"
                      className={`text-xs ${getHealthScoreColor(account.healthScore)}`}
                    >
                      {getHealthScoreLabel(account.healthScore)}
                    </Badge>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        account.healthScore >= 80
                          ? "bg-green-500"
                          : account.healthScore >= 60
                          ? "bg-amber-500"
                          : "bg-red-500"
                      }`}
                      style={{ width: `${account.healthScore}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Contacts Tab */}
        <TabsContent value="contacts">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Contacts ({accountContacts.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Name</TableHead>
                      <TableHead>Designation</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountContacts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <span className="text-sm font-medium">
                            {c.firstName} {c.lastName}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{c.designation}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{c.email}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{c.phone}</span>
                        </TableCell>
                        <TableCell>
                          {c.isPrimary ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                              Primary
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">&mdash;</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {accountContacts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No contacts found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deals Tab */}
        <TabsContent value="deals">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Deals ({accountDeals.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Title</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Probability</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountDeals.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Link
                            href={`/crm/deals/${d.id}`}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {d.title}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={d.stage} />
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm font-medium">{formatCurrency(d.value)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm">{d.probability}%</span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {accountDeals.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No deals found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tickets Tab */}
        <TabsContent value="tickets">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Support Tickets ({accountTickets.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Ticket #</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>SLA Deadline</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountTickets.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <span className="text-sm font-medium font-mono">{t.ticketNumber}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{t.subject}</span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={t.priority} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {formatDate(t.slaDeadline)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {accountTickets.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No tickets found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity Feed</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed activities={feedActivities} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
