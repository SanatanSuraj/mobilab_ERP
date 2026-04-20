"use client";

/**
 * AuthProvider — bootstrap permissions after Zustand rehydrates.
 *
 * Problem: Zustand persist rehydrates role from sessionStorage synchronously
 * via onRehydrateStorage, but in the real-API path fetchPermissions() makes
 * a network call. We run it once on mount to ensure _permSet is always fresh.
 *
 * In mock mode: fetchPermissions() is instant (mock map lookup) so this
 * component adds near-zero cost.
 *
 * In real-API mode: permissions will be stale for ~150ms until the fetch
 * resolves. During that window isPermLoading === true so gated UI can show
 * a skeleton instead of a flash of "no access".
 *
 * Place this inside QueryProvider (it may call apiFetch in the future).
 */

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/store/auth.store";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role);
  const fetchPermissions = useAuthStore((s) => s.fetchPermissions);
  const bootstrapped = useRef(false);

  useEffect(() => {
    // Only run once per mount, and only if there is an active session.
    // The role check guards against running on the /login page where
    // the store starts empty.
    if (bootstrapped.current || !role) return;
    bootstrapped.current = true;
    fetchPermissions();
  }, [role, fetchPermissions]);

  return <>{children}</>;
}
