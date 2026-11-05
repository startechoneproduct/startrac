import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, setToken, setTenant } from "./api";
import { planAllows, PLANS, type PlanKey } from "#shared/plans.js";

export type Business = {
  id: string;
  name: string;
  typeKey: string;
  settings: { currency: string; vatEnabled: boolean; vatRate: number; receiptFooter?: string; modules?: string[]; logo?: { fileId?: string | null; version?: number } };
  capabilities?: string[];
};
export type PlanSummary = {
  key: PlanKey; name: string; features: string[];
  limits: { businesses: number | null; branches: number | null; staff: number | null; products: number | null };
  legacy: boolean; periodEnd: string | null; trial: boolean; lapsed: boolean; trialEnded?: boolean; paymentsOn?: boolean;
  /** Signed up but hasn't paid yet. `paidUntil`/`paidPlan` are what the money has bought (the welcome bonus can sit above it). */
  awaitingPayment?: boolean; paidUntil?: string | null; paidPlan?: PlanKey | null;
};
export type Branch = { id: string; businessId: string; name: string };
export type Session = {
  token?: string;
  mode?: "till";
  demo?: boolean;
  platformRole?: "none" | "support" | "overseer";
  user: { id: string; name: string; email: string; phone?: string };
  emailVerified?: boolean;
  phoneVerified?: boolean;
  account: { id: string; name: string; plan: string };
  /** Absent only on a stale cached session; treated as full access. */
  plan?: PlanSummary;
  role: "owner" | "admin" | "manager" | "staff";
  permissions: string[];
  businesses: Business[];
  branches: Branch[];
};

type RegisterInput = {
  name: string; email: string; phone?: string; password: string;
  businessName: string; businessType?: string;
  tradingName?: string; taxId?: string; employees?: number;
  branchName?: string; currency?: string;
  plan?: "free" | "pro" | "business";
};

type Ctx = {
  session: Session | null;
  loading: boolean;
  activeBusiness: Business | null;
  activeBranch: Branch | null;
  branchesForActive: Branch[];
  currency: string;
  setActiveBusiness: (id: string) => void;
  setActiveBranch: (id: string) => void;
  /**
   * Bumps whenever something changed the business's data from outside the page
   * on screen (the AI added a list of products, say). The app shell re-keys the
   * page on it, so what you're looking at re-fetches instead of going stale.
   */
  dataVersion: number;
  refreshData: () => void;
  login: (email: string, password: string) => Promise<Session>;
  tillLogin: (businessCode: string, pin: string) => Promise<void>;
  demoLogin: (type?: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  // Re-pulls /auth/me — used after a verify/confirm so the emailVerified /
  // phoneVerified flags (and anything else) update without a full re-login.
  refreshSession: () => Promise<void>;
  logout: () => void;
  can: (perm: string) => boolean;
  hasModule: (module: string) => boolean;
  hasCapability: (capability: string) => boolean;
  /** The subscription this account is on, and whether it includes a feature. */
  plan: PlanSummary;
  hasFeature: (feature: string) => boolean;
};

const SessionContext = createContext<Ctx | null>(null);

// Which business/branch this tab is looking at. Per tab (sessionStorage) so two
// tabs can work in two businesses, and gone when the tab closes.
const ACTIVE_KEY = "startrack.active";
function readActive(): { businessId: string | null; branchId: string | null } | null {
  try { return JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null"); } catch { return null; }
}
function writeActive(businessId: string, branchId: string | null) {
  try { sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ businessId, branchId })); } catch { /* private mode: just don't remember */ }
}
function clearActive() {
  try { sessionStorage.removeItem(ACTIVE_KEY); } catch { /* nothing to clear */ }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  // Bootstrap from a stored token on first load. A reload keeps the business and
  // branch you were in (several screens reload to re-read the session); a fresh
  // sign-in starts on the first business.
  useEffect(() => {
    const stored = localStorage.getItem("startrack.token");
    if (!stored) { setLoading(false); return; }
    api<Session>("/auth/me")
      .then((s) => applySession(s, true))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  function applySession(s: Session, restore = false) {
    if (s.token) setToken(s.token);
    setSession(s);
    // Only honour the remembered choice if it is still one of this session's own.
    const saved = restore ? readActive() : null;
    const biz = s.businesses.find((b) => b.id === saved?.businessId) || s.businesses[0] || null;
    const branch =
      s.branches.find((b) => b.id === saved?.branchId && b.businessId === biz?.id) ||
      s.branches.find((b) => b.businessId === biz?.id) ||
      null;
    setActiveBusinessId(biz?.id ?? null);
    setActiveBranchId(branch?.id ?? null);
    setTenant(biz?.id ?? null, branch?.id ?? null); // headers ready before pages fetch
  }

  // Keep the API client's tenant headers in lockstep with the switcher.
  useEffect(() => {
    setTenant(activeBusinessId, activeBranchId);
    if (activeBusinessId) writeActive(activeBusinessId, activeBranchId);
  }, [activeBusinessId, activeBranchId]);

  const value = useMemo<Ctx>(() => {
    const activeBusiness = session?.businesses.find((b) => b.id === activeBusinessId) || null;
    const branchesForActive = session?.branches.filter((b) => b.businessId === activeBusinessId) || [];
    const activeBranch = branchesForActive.find((b) => b.id === activeBranchId) || branchesForActive[0] || null;

    return {
      session,
      loading,
      activeBusiness,
      activeBranch,
      branchesForActive,
      currency: activeBusiness?.settings.currency || "₦",
      setActiveBusiness: (id) => {
        const first = session?.branches.find((b) => b.businessId === id);
        setActiveBusinessId(id);
        setActiveBranchId(first?.id ?? null);
        setTenant(id, first?.id ?? null);
        writeActive(id, first?.id ?? null); // written now, not after render: some callers reload straight away
      },
      setActiveBranch: (id) => {
        setActiveBranchId(id);
        setTenant(activeBusinessId, id);
      },
      dataVersion,
      refreshData: () => setDataVersion((v) => v + 1),
      login: async (email, password) => {
        const s = await api<Session>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
        applySession(s);
        return s;
      },
      tillLogin: async (businessCode, pin) => {
        const s = await api<Session>("/auth/till", { method: "POST", body: JSON.stringify({ businessCode, pin }) });
        applySession(s);
      },
      demoLogin: async (type?: string) => {
        const s = await api<Session>("/auth/demo", { method: "POST", body: JSON.stringify(type ? { type } : {}) });
        applySession(s);
      },
      register: async (input) => {
        const s = await api<Session>("/auth/register", { method: "POST", body: JSON.stringify(input) });
        applySession(s);
      },
      refreshSession: async () => {
        const s = await api<Session>("/auth/me");
        setSession(s);
      },
      logout: () => {
        setToken(null);
        clearActive();
        setTenant(null, null);
        setSession(null);
        setActiveBusinessId(null);
        setActiveBranchId(null);
      },
      can: (perm) => !!session && (session.permissions.includes("*") || session.permissions.includes(perm)),
      // Business-level feature switch. Missing list (legacy) = everything on.
      hasModule: (module) => {
        const modules = activeBusiness?.settings.modules;
        return !modules || modules.includes(module);
      },
      // What the TRADE structurally supports. Unlike a module this is not a
      // preference — a supermarket has no job tickets to switch on.
      hasCapability: (capability) => (activeBusiness?.capabilities || []).includes(capability),
      plan: planOf(session),
      hasFeature: (feature) => planAllows(planOf(session).key, feature),
    };
  }, [session, loading, activeBusinessId, activeBranchId, dataVersion]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

const FULL: PlanSummary = { key: "business", name: PLANS.business.name, features: [], limits: PLANS.business.limits, legacy: true, periodEnd: null, trial: false, lapsed: false };
function planOf(session: Session | null): PlanSummary {
  return session?.plan || FULL;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

/** StarTrack staff (overseer or support) — people who run the platform, not a business on it. */
export const isPlatformUser = (s: Session | null | undefined) => !!s && !s.mode && (s.platformRole === "overseer" || s.platformRole === "support");

// Route guard for /admin/*. Anyone without platform access is sent back to
// their own business; the API enforces the same rule independently.
export function RequirePlatform({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-canvas">
        <div className="w-8 h-8 rounded-full border-2 border-line border-t-primary animate-spin" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!isPlatformUser(session)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

// Route guard for /app/*
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-canvas">
        <div className="w-8 h-8 rounded-full border-2 border-line border-t-primary animate-spin" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
