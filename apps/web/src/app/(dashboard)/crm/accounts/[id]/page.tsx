"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getHealthScoreColor,
  getHealthScoreLabel,
} from "@/data/crm-mock";
import { formatCurrency, formatDate } from "@/data/mock";
import {
  useApiAccount,
  useApiContacts,
  useApiDeals,
  useApiTickets,
  useApiUpdateAccount,
} from "@/hooks/useCrmApi";
import type { UpdateAccount } from "@mobilab/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Phone,
  Globe,
  Mail,
  MapPin,
  FileText,
  Users,
  DollarSign,
  Heart,
  Pencil,
  Save,
  Star,
  X,
} from "lucide-react";

/**
 * Account detail — real /crm/accounts/:id via useApiAccount, plus three
 * side-queries scoped by accountId for the Contacts / Deals / Tickets tabs.
 *
 * What dropped vs the mock prototype:
 *   - Activity tab. There's no per-account activity endpoint in the real
 *     API yet; adding a fake one would regress the "real data everywhere"
 *     invariant. Bring it back when the backend grows an activity log.
 *   - Owner name resolution. Same reason as the list pages — no users
 *     API — so we show the uuid prefix until one lands.
 *
 * Contract shape deltas handled the same way as the list pages: decimal
 * strings parsed for display-only aggregates, nullable fields fall back
 * to "—", and the accountId filter replaces the mock's weak `company ===
 * account.name` fuzzy join for the Deals tab.
 */

function toNumber(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Inline-edit draft. Strings for nullable fields ("" → omit from PATCH so
// the backend doesn't null the existing value).
type EditDraft = {
  name: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  gstin: string;
  healthScore: string; // stringified int 0-100
  isKeyAccount: boolean;
  annualRevenue: string; // decimal string; "" → omit
  employeeCount: string; // stringified int; "" → omit
};

export default function AccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;

  const accountQuery = useApiAccount(accountId);
  const contactsQuery = useApiContacts({ accountId, limit: 100 });
  const dealsQuery = useApiDeals({ accountId, limit: 100 });
  const ticketsQuery = useApiTickets({ accountId, limit: 100 });
  const updateMut = useApiUpdateAccount(accountId);

  // Inline-edit state. `draft` is only meaningful when editMode is true;
  // it seeds from the server row on each Edit click so the form always
  // reflects the latest known values.
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<EditDraft>({
    name: "",
    industry: "",
    website: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    gstin: "",
    healthScore: "50",
    isKeyAccount: false,
    annualRevenue: "",
    employeeCount: "",
  });

  // Main-record loading: block on the account itself. Tab data loads
  // independently — a table-level skeleton inside each tab is cleaner than
  // holding the whole page hostage to the slowest query.
  if (accountQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    // 404 from the API surfaces as isError with a 404 problem; we can't
    // distinguish "not found" from "forbidden" (RLS hides both) without
    // parsing the problem. Show the same not-found UX either way — the
    // user's recourse is identical.
    const message =
      accountQuery.error instanceof Error
        ? accountQuery.error.message
        : "Account not found";
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Account unavailable</p>
            <p className="text-red-700 mt-1">{message}</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/crm/accounts")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Accounts
        </Button>
      </div>
    );
  }

  const account = accountQuery.data;
  const contacts = contactsQuery.data?.data ?? [];
  const deals = dealsQuery.data?.data ?? [];
  const tickets = ticketsQuery.data?.data ?? [];

  const locationParts = [account.address, account.city, account.state].filter(
    Boolean
  );

  function startEdit() {
    setDraft({
      name: account.name,
      industry: account.industry ?? "",
      website: account.website ?? "",
      phone: account.phone ?? "",
      email: account.email ?? "",
      address: account.address ?? "",
      city: account.city ?? "",
      state: account.state ?? "",
      postalCode: account.postalCode ?? "",
      gstin: account.gstin ?? "",
      healthScore: String(account.healthScore),
      isKeyAccount: account.isKeyAccount,
      annualRevenue: account.annualRevenue ?? "",
      employeeCount:
        account.employeeCount === null ? "" : String(account.employeeCount),
    });
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
  }

  function handleSave() {
    const name = draft.name.trim();
    if (!name) {
      toast.error("Account name is required.");
      return;
    }
    if (name.length > 200) {
      toast.error("Account name must be 200 characters or fewer.");
      return;
    }

    // Health score — must be integer 0-100.
    const healthScoreNum = Number(draft.healthScore);
    if (
      !Number.isInteger(healthScoreNum) ||
      healthScoreNum < 0 ||
      healthScoreNum > 100
    ) {
      toast.error("Health score must be an integer between 0 and 100.");
      return;
    }

    // Email — only validate if provided.
    const email = draft.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Email is not valid.");
      return;
    }

    // Annual revenue — decimal string if provided.
    const annualRevenue = draft.annualRevenue.trim();
    if (
      annualRevenue &&
      (!/^-?\d+(\.\d+)?$/.test(annualRevenue) || Number(annualRevenue) < 0)
    ) {
      toast.error("Annual revenue must be a non-negative number.");
      return;
    }

    // Employee count — non-negative int if provided.
    const employeeCountRaw = draft.employeeCount.trim();
    let employeeCount: number | undefined;
    if (employeeCountRaw) {
      const n = Number(employeeCountRaw);
      if (!Number.isInteger(n) || n < 0) {
        toast.error("Employee count must be a non-negative integer.");
        return;
      }
      employeeCount = n;
    }

    // Build the patch body. Empty strings for optional fields → omit so
    // the backend keeps the existing value rather than nulling it out.
    // UpdateAccount doesn't carry expectedVersion (contract: partial of
    // CreateAccount with no version check), so this is a pure PATCH.
    const body: UpdateAccount = {
      name,
      healthScore: healthScoreNum,
      isKeyAccount: draft.isKeyAccount,
    };
    const industry = draft.industry.trim();
    if (industry) body.industry = industry;
    const website = draft.website.trim();
    if (website) body.website = website;
    const phone = draft.phone.trim();
    if (phone) body.phone = phone;
    if (email) body.email = email;
    const address = draft.address.trim();
    if (address) body.address = address;
    const city = draft.city.trim();
    if (city) body.city = city;
    const stateVal = draft.state.trim();
    if (stateVal) body.state = stateVal;
    const postalCode = draft.postalCode.trim();
    if (postalCode) body.postalCode = postalCode;
    const gstin = draft.gstin.trim();
    if (gstin) body.gstin = gstin;
    if (annualRevenue) body.annualRevenue = annualRevenue;
    if (employeeCount !== undefined) body.employeeCount = employeeCount;

    updateMut.mutate(body, {
      onSuccess: () => {
        toast.success("Account updated");
        setEditMode(false);
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Failed to update account"
        );
      },
    });
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/crm/accounts")}
          disabled={editMode}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Accounts
        </Button>
        {editMode ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelEdit}
              disabled={updateMut.isPending}
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateMut.isPending}
            >
              <Save className="h-4 w-4 mr-1" />
              {updateMut.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={startEdit}
            title="Edit account details"
          >
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
        )}
      </div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {editMode ? (
                <Input
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  className="text-xl font-bold h-10 max-w-md"
                  placeholder="Account name"
                  maxLength={200}
                />
              ) : (
                <>
                  <h1 className="text-2xl font-bold tracking-tight">
                    {account.name}
                  </h1>
                  {account.isKeyAccount && (
                    <Badge
                      className="bg-amber-50 text-amber-700 border-amber-200"
                      variant="outline"
                    >
                      <Star className="h-3 w-3 mr-1" />
                      Key Account
                    </Badge>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {editMode ? (
                <>
                  <Input
                    value={draft.industry}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, industry: e.target.value }))
                    }
                    className="h-8 text-sm w-40"
                    placeholder="Industry"
                    maxLength={80}
                  />
                  <div className="flex items-center gap-2">
                    <Switch
                      id="is-key-account"
                      checked={draft.isKeyAccount}
                      onCheckedChange={(v) =>
                        setDraft((d) => ({ ...d, isKeyAccount: v }))
                      }
                    />
                    <Label
                      htmlFor="is-key-account"
                      className="text-xs text-muted-foreground"
                    >
                      Key Account
                    </Label>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground">
                    {account.industry ?? "—"}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-xs font-medium ${getHealthScoreColor(account.healthScore)}`}
                  >
                    {account.healthScore} &middot;{" "}
                    {getHealthScoreLabel(account.healthScore)}
                  </Badge>
                </>
              )}
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
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">
                  Account Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">
                        Address
                      </p>
                      {editMode ? (
                        <div className="space-y-2">
                          <Input
                            value={draft.address}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                address: e.target.value,
                              }))
                            }
                            placeholder="Street address"
                            maxLength={200}
                            className="h-8 text-sm"
                          />
                          <div className="grid grid-cols-3 gap-2">
                            <Input
                              value={draft.city}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  city: e.target.value,
                                }))
                              }
                              placeholder="City"
                              maxLength={80}
                              className="h-8 text-sm"
                            />
                            <Input
                              value={draft.state}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  state: e.target.value,
                                }))
                              }
                              placeholder="State"
                              maxLength={80}
                              className="h-8 text-sm"
                            />
                            <Input
                              value={draft.postalCode}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  postalCode: e.target.value,
                                }))
                              }
                              placeholder="PIN"
                              maxLength={20}
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm font-medium">
                          {locationParts.length
                            ? locationParts.join(", ")
                            : "—"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">
                        Phone
                      </p>
                      {editMode ? (
                        <Input
                          value={draft.phone}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, phone: e.target.value }))
                          }
                          placeholder="+91 98765 43210"
                          maxLength={40}
                          className="h-8 text-sm"
                        />
                      ) : (
                        <p className="text-sm font-medium">
                          {account.phone ?? "—"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Globe className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">
                        Website
                      </p>
                      {editMode ? (
                        <Input
                          value={draft.website}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              website: e.target.value,
                            }))
                          }
                          placeholder="https://example.com"
                          maxLength={200}
                          className="h-8 text-sm"
                        />
                      ) : (
                        <p className="text-sm font-medium">
                          {account.website ?? "—"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">
                        Email
                      </p>
                      {editMode ? (
                        <Input
                          value={draft.email}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              email: e.target.value,
                            }))
                          }
                          placeholder="contact@example.com"
                          type="email"
                          className="h-8 text-sm"
                        />
                      ) : (
                        <p className="text-sm font-medium">
                          {account.email ?? "—"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">
                        GSTIN
                      </p>
                      {editMode ? (
                        <Input
                          value={draft.gstin}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, gstin: e.target.value }))
                          }
                          placeholder="29ABCDE1234F1Z5"
                          maxLength={32}
                          className="h-8 text-sm font-mono"
                        />
                      ) : (
                        <p className="text-sm font-medium font-mono">
                          {account.gstin ?? "—"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">
                        Employees
                      </p>
                      {editMode ? (
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={draft.employeeCount}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              employeeCount: e.target.value,
                            }))
                          }
                          placeholder="0"
                          className="h-8 text-sm"
                        />
                      ) : (
                        <p className="text-sm font-medium">
                          {account.employeeCount === null
                            ? "—"
                            : account.employeeCount.toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Account Owner
                      </p>
                      <p className="text-sm font-medium">
                        {account.ownerId
                          ? account.ownerId.slice(0, 8)
                          : "Unassigned"}
                      </p>
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
                  {editMode ? (
                    <Input
                      value={draft.annualRevenue}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          annualRevenue: e.target.value,
                        }))
                      }
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  ) : (
                    <p className="text-2xl font-bold">
                      {account.annualRevenue === null
                        ? "—"
                        : formatCurrency(toNumber(account.annualRevenue))}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Annual revenue
                  </p>
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
                  {editMode ? (
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.healthScore}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          healthScore: e.target.value,
                        }))
                      }
                      placeholder="0-100"
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-2xl font-bold">
                          {account.healthScore}
                        </span>
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
                    </>
                  )}
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
                Contacts ({contacts.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {contactsQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
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
                      {contacts.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
                            <span className="text-sm font-medium">
                              {c.firstName} {c.lastName}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {c.designation ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {c.email ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {c.phone ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            {c.isPrimary ? (
                              <Badge
                                variant="outline"
                                className="bg-blue-50 text-blue-700 border-blue-200 text-xs"
                              >
                                Primary
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                &mdash;
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {contacts.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-center py-8 text-muted-foreground"
                          >
                            No contacts found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deals Tab */}
        <TabsContent value="deals">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Deals ({deals.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dealsQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Title</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right">
                          Probability
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deals.map((d) => (
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
                            <span className="text-sm font-medium">
                              {formatCurrency(toNumber(d.value))}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-sm">{d.probability}%</span>
                          </TableCell>
                        </TableRow>
                      ))}
                      {deals.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center py-8 text-muted-foreground"
                          >
                            No deals found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tickets Tab */}
        <TabsContent value="tickets">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Support Tickets ({tickets.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ticketsQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
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
                      {tickets.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>
                            <Link
                              href={`/crm/tickets/${t.id}`}
                              className="text-sm font-medium font-mono text-primary hover:underline"
                            >
                              {t.ticketNumber}
                            </Link>
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
                              {t.slaDeadline
                                ? formatDate(t.slaDeadline)
                                : "—"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                      {tickets.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-center py-8 text-muted-foreground"
                          >
                            No tickets found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
