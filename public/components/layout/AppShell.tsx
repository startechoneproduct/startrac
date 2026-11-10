import { Suspense, useEffect, useRef, useState } from "react";
import { SkeletonList } from "@/components/ui/Skeleton";
import { prefetchPages } from "@/lib/lazyPage";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { VerifyBanner } from "./VerifyBanner";
import { UpgradePrompt } from "@/components/plan/PlanUi";
import { PlanBanner } from "@/components/plan/PlanBanner";
import { useSession } from "@/lib/session";
import { flattenNav } from "@/lib/navItems";
import { typeMeta } from "@/lib/businessTypes";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShieldOff } from "lucide-react";
import { SIDEBAR_EVENT } from "@/components/tour/ProductTour";

// A page this person's permissions don't cover, reached by typing its address.
// The server refuses its data either way; this just says so plainly instead of
// showing a screen full of errors.
function PermissionGate({ children }: { children: React.ReactNode }) {
  const { can, activeBusiness } = useSession();
  const { pathname } = useLocation();
  const page = flattenNav(typeMeta(activeBusiness?.typeKey)).find((n) => n.to === pathname);
  if (page?.perm && !can(page.perm)) {
    return (
      <div className="p-6 lg:p-8 max-w-[700px] mx-auto">
        <EmptyState icon={ShieldOff} title="You don't have access to this page" body="Ask the business owner or an admin to give you permission if you need it." />
      </div>
    );
  }
  return <>{children}</>;
}

// The conversion hook: always visible while exploring the sandbox.
function DemoBanner() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  if (!session?.demo) return null;
  return (
    <div className="shrink-0 bg-surface-3 border-b border-line text-t2 px-4 py-1.5 flex items-center gap-2 flex-wrap text-[12.5px]">
      <Sparkles className="w-3.5 h-3.5 shrink-0 text-t3" />
      <span>You're exploring the demo shop — sell, return, approve, break things. It all resets within 24 hours.</span>
      <button
        onClick={() => { logout(); navigate("/register"); }}
        className="ml-auto shrink-0 px-3 h-7 rounded-md bg-primary text-on-primary text-[12.5px] font-medium hover:bg-primary-hover transition-colors"
      >
        Create your own business →
      </button>
    </div>
  );
}

const COLLAPSE_KEY = "startrack.sidebar.collapsed";

export function AppShell() {
  const { activeBusiness, activeBranch, dataVersion } = useSession();
  const { pathname } = useLocation();
  // The Ask AI page holds the conversation itself; refreshing it would wipe the chat on screen.
  const version = pathname === "/app/ask-ai" ? 0 : dataVersion;
  const [menuOpen, setMenuOpen] = useState(false);
  // A new page starts at its top, not wherever the last one was scrolled to.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [pathname]);
  // Signed in: fetch the other pages in the background (see lib/lazyPage.ts).
  useEffect(() => prefetchPages(), []);
  // The phone drawer closes whenever the page changes, however that happened.
  useEffect(() => setMenuOpen(false), [pathname]);
  // The product tour opens the drawer to point at sidebar items on a phone,
  // and closes it again for everything else (see ProductTour).
  useEffect(() => {
    const on = (e: Event) => setMenuOpen(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(SIDEBAR_EVENT, on);
    return () => window.removeEventListener(SIDEBAR_EVENT, on);
  }, []);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });

  function toggleCollapsed() {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1"); } catch { /* storage unavailable: just don't persist */ }
      return !v;
    });
  }

  return (
    <div className="h-full flex flex-col bg-canvas">
      <DemoBanner />
      <VerifyBanner />
      <UpgradePrompt />
      <PlanBanner />
      <div className="flex-1 flex min-h-0">
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} mobileOpen={menuOpen} onClose={() => setMenuOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar onMenu={() => setMenuOpen(true)} />
          {/* Keyed by store: switching business or branch remounts the page so
              every list, form and cached total is re-fetched for the new store
              instead of showing the previous one's data. */}
          <main ref={mainRef} key={`${activeBusiness?.id}:${activeBranch?.id}:${version}`} className="st-vt-page content-bg flex-1 min-h-0 overflow-y-auto">
            {/* Keyed by page so each tab change plays a short fade-in rather
                than cutting hard from one screen to the next. */}
            <div key={pathname} className="st-page-enter">
              {/* A page opened for the first time loads its code: the frame
                  stays put and the page area shows a skeleton meanwhile. */}
              <Suspense fallback={<div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto"><SkeletonList rows={6} /></div>}>
                <PermissionGate><Outlet /></PermissionGate>
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
