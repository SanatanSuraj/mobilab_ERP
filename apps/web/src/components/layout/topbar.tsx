"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, Search, Settings, LogOut, User, Check } from "lucide-react";
import { useAuthStore } from "@/store/auth.store";

const SESSION_COOKIE = "instigenie-session";

function clearSessionCookie() {
  // Expire the cookie by setting max-age=0
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

const notifications = [
  { id: 1, title: "Deal updated", message: "Apollo Diagnostics moved to Negotiation", time: "2m ago", read: false },
  { id: 2, title: "Work order completed", message: "WO-2026-003 marked as completed", time: "1h ago", read: false },
  { id: 3, title: "Payment received", message: "MedTech India paid INV-2026-001", time: "3h ago", read: true },
  { id: 4, title: "Leave request", message: "Priya Sharma requested sick leave", time: "5h ago", read: false },
  { id: 5, title: "New lead", message: "Sanjay Reddy from Medipoint Labs", time: "1d ago", read: true },
];

export function Topbar() {
  const [notifs, setNotifs] = useState(notifications);
  const unread = notifs.filter((n) => !n.read).length;
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  function markAllRead() {
    setNotifs(notifs.map((n) => ({ ...n, read: true })));
  }

  function handleSignOut() {
    clearSessionCookie(); // remove the proxy gate cookie
    logout();             // clear Zustand store + sessionStorage
    router.push("/login");
  }

  return (
    <header className="h-14 border-b bg-background flex items-center px-6 gap-4 shrink-0">
      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search anything..." className="pl-9 bg-muted/50 border-0" />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications */}
        <Popover>
          <PopoverTrigger className="relative inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer">
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unread}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="flex items-center justify-between p-3 border-b">
              <h4 className="font-semibold text-sm">Notifications</h4>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
                <Check className="h-3 w-3 mr-1" /> Mark all read
              </Button>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {notifs.map((n) => (
                <div key={n.id} className={`p-3 border-b last:border-0 hover:bg-muted/50 transition-colors ${!n.read ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start gap-2">
                    {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />}
                    <div className={!n.read ? "" : "ml-3.5"}>
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground">{n.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">{n.time}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* User Menu — reactive to role switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-md hover:bg-accent cursor-pointer">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                {user?.avatar ?? "?"}
              </AvatarFallback>
            </Avatar>
            <div className="hidden sm:flex flex-col items-start leading-none">
              <span className="text-sm font-medium">{user?.name ?? "Unknown"}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{role ?? ""}</span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span>{user?.name ?? "Unknown"}</span>
                <span className="text-xs font-normal text-muted-foreground font-mono">{role}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem><User className="h-4 w-4 mr-2" /> Profile</DropdownMenuItem>
            <DropdownMenuItem><Settings className="h-4 w-4 mr-2" /> Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
