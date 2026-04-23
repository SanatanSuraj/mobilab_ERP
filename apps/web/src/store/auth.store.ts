/**
 * Auth Store — Zustand + persist
 *
 * Design decisions aligned with ERP-ARCH-MIDSCALE-2025-005:
 *
 * 1. JWT is identity-only — NO roles/permissions baked in.
 *    fetchPermissions() resolves permissions at runtime from the backend
 *    (today: MOCK_PERMISSIONS_BY_ROLE; tomorrow: GET /api/auth/me/permissions).
 *
 * 2. Permissions stored as Set<string> for O(1) can() lookups.
 *    Sets are not JSON-serialisable, so they are NOT persisted.
 *    On page reload → rehydrate role → call fetchPermissions() → rebuild set.
 *
 * 3. Permission format: "resource:action"  (exactly two colon-delimited parts)
 *    Examples: "deals:write", "purchase_orders:approve_finance"
 *    NEVER: "po:approve:finance"  ← three parts, violates the contract.
 *
 * 4. org_id is persisted alongside user/role because it is part of identity,
 *    not a permission. Every API call must supply X-Org-Id: <orgId>.
 *
 * Swapping mock → real API:
 *   1. Add token storage (httpOnly cookie preferred; memory fallback).
 *   2. Replace MOCK block in fetchPermissions() with:
 *        const res = await fetch('/api/auth/me/permissions', {
 *          headers: { Authorization: `Bearer ${get().token}` }
 *        });
 *        const { permissions } = await res.json();
 *   3. No other changes needed.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─── Types ──────────────────────────────────────────────────────────────────

export type UserRole =
  | "SUPER_ADMIN"
  | "MANAGEMENT"
  | "SALES_REP"
  | "SALES_MANAGER"
  | "FINANCE"
  | "PRODUCTION"
  | "PRODUCTION_MANAGER"
  | "RD"
  | "QC_INSPECTOR"
  | "QC_MANAGER"
  | "STORES"
  | "CUSTOMER";

/**
 * Open string type — validated at call sites via the mock map below.
 * Using a string union here would couple the store to every future permission;
 * keeping it open lets the backend be the source of truth.
 */
export type Permission = string;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  avatar: string;
};

// ─── Mock Data ───────────────────────────────────────────────────────────────

/** Instigenie staff personas — one per role for dev/demo mode. */
export const MOCK_USERS_BY_ROLE: Record<UserRole, AuthUser> = {
  SUPER_ADMIN:        { id: "u0",  name: "Admin User",      email: "admin@instigenie.in",    avatar: "AU" },
  MANAGEMENT:         { id: "u1",  name: "Chetan (HOD)",    email: "chetan@instigenie.in",   avatar: "CH" },
  SALES_REP:          { id: "u2",  name: "Priya Sharma",    email: "priya@instigenie.in",    avatar: "PS" },
  SALES_MANAGER:      { id: "u3",  name: "Rahul Mehta",     email: "rahul.m@instigenie.in",  avatar: "RM" },
  FINANCE:            { id: "u4",  name: "Anita Das",       email: "anita@instigenie.in",    avatar: "AD" },
  PRODUCTION:         { id: "u5",  name: "Shubham (T1)",    email: "shubham@instigenie.in",  avatar: "SH" },
  PRODUCTION_MANAGER: { id: "u6",  name: "Chetan (HOD)",    email: "chetan@instigenie.in",   avatar: "CH" },
  RD:                 { id: "u7",  name: "R&D Lead",        email: "rd@instigenie.in",       avatar: "RD" },
  QC_INSPECTOR:       { id: "u8",  name: "Sanju (T1)",      email: "sanju@instigenie.in",    avatar: "SJ" },
  QC_MANAGER:         { id: "u9",  name: "QC Manager",      email: "qc@instigenie.in",       avatar: "QM" },
  STORES:             { id: "u10", name: "Stores Manager",  email: "stores@instigenie.in",   avatar: "SM" },
  CUSTOMER:           { id: "u11", name: "Customer Portal", email: "portal@instigenie.in",   avatar: "CP" },
};

/**
 * Mock permission sets — mirrors what GET /api/auth/me/permissions returns.
 *
 * Format rule: "resource:action"
 *   resource  = snake_case plural noun   (deals, work_orders, purchase_orders …)
 *   action    = snake_case verb/qualifier (write, create, cancel, approve_finance …)
 */
export const MOCK_PERMISSIONS_BY_ROLE: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: [
    "deals:write",
    "deals:mark_won",
    "deals:mark_lost",
    "work_orders:create",
    "work_orders:cancel",
    "wip_stages:advance",
    "qc:submit_inspection",
    "qc:override",
    "purchase_orders:approve_finance",
    "purchase_orders:approve_management",
    "invoices:create",
    "invoices:post",
    "stock:adjust",
    "batches:quarantine",
    "bom:edit",
    "ecn:initiate",
    "ecn:approve",
  ],
  MANAGEMENT: [
    "deals:mark_won",
    "deals:mark_lost",
    "work_orders:cancel",
    "qc:override",
    "purchase_orders:approve_management",
    "ecn:approve",
  ],
  SALES_REP: [
    "deals:write",
    "deals:mark_won",
    "deals:mark_lost",
  ],
  SALES_MANAGER: [
    "deals:write",
    "deals:mark_won",
    "deals:mark_lost",
  ],
  FINANCE: [
    "invoices:create",
    "invoices:post",
    "purchase_orders:approve_finance",
  ],
  PRODUCTION: [
    "wip_stages:advance",
    "work_orders:create",
  ],
  PRODUCTION_MANAGER: [
    "wip_stages:advance",
    "work_orders:create",
    "work_orders:cancel",
    "bom:edit",
  ],
  RD: [
    "bom:edit",
    "ecn:initiate",
  ],
  QC_INSPECTOR: [
    "qc:submit_inspection",
  ],
  QC_MANAGER: [
    "qc:submit_inspection",
    "qc:override",
    "batches:quarantine",
  ],
  STORES: [
    "stock:adjust",
  ],
  CUSTOMER: [],
};

/** Default org for dev/demo — real value comes from JWT claims. */
const MOCK_ORG_ID = "org_instigenie";

// ─── Store Shape ─────────────────────────────────────────────────────────────

type AuthStore = {
  // ── Persisted identity ──────────────────────────────────────────────────
  user: AuthUser | null;
  role: UserRole | null;
  orgId: string | null; // X-Org-Id for every API call
  // token: string | null;  // TODO: add when real auth lands

  // ── Runtime-only (not persisted) ────────────────────────────────────────
  _permSet: Set<string>;
  isPermLoading: boolean;

  // ── Actions ─────────────────────────────────────────────────────────────
  /**
   * Populate _permSet from the backend (or mock).
   * Call once after login and once after rehydration.
   *
   * Real implementation:
   *   const { permissions } = await apiFetch('/api/auth/me/permissions').then(r => r.json());
   */
  fetchPermissions: () => Promise<void>;

  /** O(1) permission check. Returns false if permissions are not yet loaded. */
  can: (permission: Permission) => boolean;

  /** Dev-only: switch role without a real login flow. */
  setRole: (role: UserRole) => void;

  logout: () => void;
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      // ── Initial state ──────────────────────────────────────────────────
      user: MOCK_USERS_BY_ROLE.PRODUCTION_MANAGER,
      role: "PRODUCTION_MANAGER",
      orgId: MOCK_ORG_ID,
      _permSet: new Set(MOCK_PERMISSIONS_BY_ROLE.PRODUCTION_MANAGER),
      isPermLoading: false,

      // ── fetchPermissions ───────────────────────────────────────────────
      fetchPermissions: async () => {
        const { role } = get();
        if (!role) return;

        set({ isPermLoading: true });
        try {
          // ── MOCK ─────────────────────────────────────────────────────
          // Simulate network latency in dev so loading states are testable.
          if (process.env.NODE_ENV === "development") {
            await new Promise((r) => setTimeout(r, 150));
          }
          const permissions = MOCK_PERMISSIONS_BY_ROLE[role] ?? [];
          // ── END MOCK — replace block above with real fetch() ─────────

          set({ _permSet: new Set(permissions), isPermLoading: false });
        } catch {
          set({ isPermLoading: false });
        }
      },

      // ── can ────────────────────────────────────────────────────────────
      can: (permission) => get()._permSet.has(permission),

      // ── setRole (dev only) ─────────────────────────────────────────────
      setRole: (role) => {
        set({
          role,
          user: MOCK_USERS_BY_ROLE[role],
          orgId: MOCK_ORG_ID,
          _permSet: new Set(MOCK_PERMISSIONS_BY_ROLE[role]),
        });
      },

      // ── logout ─────────────────────────────────────────────────────────
      logout: () =>
        set({
          user: null,
          role: null,
          orgId: null,
          _permSet: new Set(),
        }),
    }),

    {
      name: "instigenie-auth",
      storage: createJSONStorage(() =>
        // sessionStorage clears on tab close — good default for prototypes.
        // Swap to a secure httpOnly cookie strategy before production.
        typeof window !== "undefined" ? sessionStorage : localStorage
      ),

      // Only persist identity — permissions are re-fetched, not stored.
      // _permSet is a Set (not JSON-serialisable) so it must never appear here.
      partialize: (state) => ({
        user: state.user,
        role: state.role,
        orgId: state.orgId,
      }),

      // After rehydration: rebuild _permSet from persisted role.
      // This runs synchronously before the first render that reads can().
      onRehydrateStorage: () => (state) => {
        if (state?.role) {
          state._permSet = new Set(MOCK_PERMISSIONS_BY_ROLE[state.role] ?? []);
        }
      },
    }
  )
);
