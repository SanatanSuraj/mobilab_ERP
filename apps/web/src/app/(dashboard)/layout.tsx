import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { TenantAuthGate } from "@/components/layout/tenant-auth-gate";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantAuthGate>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto bg-muted/20">
            {children}
          </main>
        </div>
      </div>
    </TenantAuthGate>
  );
}
