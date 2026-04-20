"use client";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { contacts, getAccountById, type Contact } from "@/data/crm-mock";

export default function ContactsPage() {
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
      render: (c) => {
        const account = getAccountById(c.accountId);
        return (
          <span className="text-sm text-muted-foreground">
            {account?.name ?? "Unknown"}
          </span>
        );
      },
    },
    {
      key: "designation",
      header: "Designation",
      render: (c) => <span className="text-sm">{c.designation}</span>,
    },
    {
      key: "department",
      header: "Department",
      render: (c) => (
        <span className="text-sm text-muted-foreground">{c.department}</span>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (c) => (
        <span className="text-sm text-muted-foreground">{c.email}</span>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      render: (c) => (
        <span className="text-sm text-muted-foreground">{c.phone}</span>
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
          <span className="text-xs text-muted-foreground">&mdash;</span>
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
