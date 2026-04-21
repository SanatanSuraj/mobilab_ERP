"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { useApiContacts, useApiAccounts } from "@/hooks/useCrmApi";
import type { Contact } from "@mobilab/contracts";

/**
 * Contacts list — reads /crm/contacts via useApiContacts.
 *
 * Mock shape had a non-null `email/phone/designation/department` and
 * `linkedIn`; the contract types make those nullable and rename linkedIn
 * → linkedinUrl (see packages/contracts/src/crm.ts). Every nullable field
 * in this view uses the "—" em-dash fallback so a missing value never
 * ships as empty-string churn.
 *
 * Account name: the contact rows only carry `accountId` (a uuid), so we
 * side-fetch the accounts page (limit: 100) to build an id → name lookup.
 * A larger tenant will eventually need a denormalised response from the
 * API (contact + accountName) or a proper paginated join; not needed yet.
 */
export default function ContactsPage() {
  const contactsQuery = useApiContacts({ limit: 50 });
  const accountsQuery = useApiAccounts({ limit: 100 });

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accountsQuery.data?.data ?? []) {
      map.set(a.id, a.name);
    }
    return map;
  }, [accountsQuery.data]);

  if (contactsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (contactsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load contacts</p>
            <p className="text-red-700 mt-1">
              {contactsQuery.error instanceof Error
                ? contactsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const contacts = contactsQuery.data?.data ?? [];

  const columns: Column<Contact>[] = [
    {
      key: "firstName",
      header: "Name",
      sortable: true,
      render: (c) => (
        <span className="text-sm font-medium">
          {c.firstName} {c.lastName}
        </span>
      ),
    },
    {
      key: "accountId",
      header: "Account",
      render: (c) => (
        <span className="text-sm text-muted-foreground">
          {accountNameById.get(c.accountId) ?? "Unknown"}
        </span>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (c) => (
        <span className="text-sm">{c.designation ?? "—"}</span>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (c) => (
        <span className="text-sm text-muted-foreground">
          {c.department ?? "—"}
        </span>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (c) => (
        <span className="text-sm text-muted-foreground">
          {c.email ?? "—"}
        </span>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      render: (c) => (
        <span className="text-sm text-muted-foreground">
          {c.phone ?? "—"}
        </span>
      ),
    },
    {
      key: "isPrimary",
      header: "Role",
      render: (c) =>
        c.isPrimary ? (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200 text-xs"
          >
            Primary
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Contacts"
        description="All contacts across your accounts"
      />

      <DataTable<Contact>
        data={contacts}
        columns={columns}
        searchKey="firstName"
        searchPlaceholder="Search by name..."
      />
    </div>
  );
}
