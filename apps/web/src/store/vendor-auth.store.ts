/**
 * Vendor-admin auth store — separate from the tenant useAuthStore.
 *
 * Why a second store? Vendor identity has no org / roles / permissions —
 * it's a flat "who is this Instigenie employee" model. Trying to shoehorn it
 * into useAuthStore would mean nullable role/orgId + permission gates that
 * don't apply, which makes both surfaces harder to reason about.
 *
 * Persistence strategy:
 *   - Tokens live in sessionStorage (instigenie-vendor-access / -refresh)
 *     managed by lib/api/vendor-admin.ts. NOT persisted through this store.
 *   - Identity (id/email/name) is NOT persisted. On page reload we call
 *     GET /vendor-admin/auth/me to rehydrate. If /me fails, tokens are
 *     already invalid — the layout redirects to /vendor-admin/login.
 *
 * This keeps "is the user logged in?" as a single source of truth: the
 * presence of a valid token, verified by the server. No stale identity
 * ever ends up in the store.
 */

import { create } from "zustand";

import type { VendorMeResponse } from "@instigenie/contracts/vendor-admin";

import {
  apiVendorLogin,
  apiVendorLogout,
  apiVendorMe,
  clearVendorTokens,
  getVendorRefreshToken,
  setVendorTokens,
} from "@/lib/api/vendor-admin";

export type VendorAdminIdentity = Pick<
  VendorMeResponse,
  "id" | "email" | "name"
> & {
  isActive?: boolean;
  lastLoginAt?: string | null;
};

export type VendorAuthStatus =
  | "unknown" // haven't tried yet — layout shows a splash
  | "signed-out" // no token, or tokens rejected
  | "signed-in"; // /me succeeded

type VendorAuthStore = {
  status: VendorAuthStatus;
  admin: VendorAdminIdentity | null;
  error: string | null;

  /** Called once at layout mount. Drives the signed-in / signed-out split. */
  hydrate: () => Promise<void>;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  /** For tests / dev-tools — never called from UI code. */
  _reset: () => void;
};

export const useVendorAuthStore = create<VendorAuthStore>()((set) => ({
  status: "unknown",
  admin: null,
  error: null,

  hydrate: async () => {
    try {
      const me = await apiVendorMe();
      set({
        status: "signed-in",
        admin: {
          id: me.id,
          email: me.email,
          name: me.name,
          isActive: me.isActive,
          lastLoginAt: me.lastLoginAt ?? null,
        },
        error: null,
      });
    } catch {
      // /me failed (no token, expired, etc) — treat as signed-out.
      clearVendorTokens();
      set({ status: "signed-out", admin: null, error: null });
    }
  },

  login: async (email, password) => {
    const res = await apiVendorLogin({ email, password });
    setVendorTokens(res.accessToken, res.refreshToken);
    set({
      status: "signed-in",
      admin: { id: res.admin.id, email: res.admin.email, name: res.admin.name },
      error: null,
    });
  },

  logout: async () => {
    const refresh = getVendorRefreshToken();
    if (refresh) {
      await apiVendorLogout(refresh).catch(() => {
        // best-effort — we still clear locally
      });
    }
    clearVendorTokens();
    set({ status: "signed-out", admin: null, error: null });
  },

  _reset: () => set({ status: "unknown", admin: null, error: null }),
}));
