import { useEffect, useRef, useState, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Building2, Store, CreditCard, LifeBuoy, ShieldCheck, Users, Activity, LogOut, ArrowUpRight, Search, ChevronDown, ChevronLeft, ChevronRight, Headphones, Menu, X } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BrandMark } from "@/components/brand/BrandMark";
import { RefreshButton } from "@/components/layout/Topbar";
import { useSession } from "@/lib/session";
import { ADMIN_TABS, type AdminTab } from "@/pages/platform/tabs";
import { cn } from "@/lib/utils";

const ICONS: Record<AdminTab, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  overview: LayoutDashboard,
  accounts: Building2,
  businesses: Store,
  subscriptions: CreditCard,
  users: Users,
  activity: Activity,
  support: LifeBuoy,
  team: ShieldCheck,
};

const COLLAPSE_KEY = "startrack.admin.sidebar.collapsed";

// Labels hide (but stay readable to screen readers) on the collapsed rail, from `lg` up.
const label = "group-data-[collapsed=true]/side:lg:sr-only";
const linkBase =
  "flex items-center gap-3 px-3.5 py-[9px] rounded-xl text-[13.5px] font-semibold whitespace-nowrap transition-colors group-data-[collapsed=true]/side:lg:justify-center group-data-[collapsed=true]/side:lg:px-2";
const item = (on: boolean) => cn(linkBase, "relative", on ? "bg-primary text-white before:absolute before:-left-4 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-[var(--st-accent)] group-data-[collapsed=true]/side:lg:before:-left-3" : "text-nav-fg hover:bg-nav-hover hover:text-nav-strong");

// The platform console's frame. It looks like the business app (same sidebar,
// same top bar, same colours) but carries no business or branch switcher and
// no till: this person is running StarTrack, not a shop on it.
export function AdminShell() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const isOverseer = session?.platformRole === "overseer";
  const tabs = ADMIN_TABS.filter((t) => !t.overseerOnly || isOverseer);

  useEffect(() => { setMenu(false); setDrawer(false); }, [pathname]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1"); } catch { /* storage unavailable: just don't persist */ }
      return !v;
    });
  }

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    navigate(`/admin/accounts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  }

  const name = session?.user.name || "Admin";

  return (
    <div className="admin-theme h-full flex bg-canvas">
      <div
        onClick={() => setDrawer(false)}
        className={cn("lg:hidden fixed inset-0 z-[55] bg-ink/55 backdrop-blur-[2px] transition-opacity", drawer ? "opacity-100" : "opacity-0 pointer-events-none")}
      />
      <aside
        data-collapsed={collapsed}
        style={{ background: "var(--st-gradient-ink)" }}
        className={cn(
          "group/side text-nav-strong flex flex-col overflow-hidden shrink-0",
          "fixed inset-y-0 left-0 z-[60] w-[280px] transition-[width,transform] duration-200 ease-out",
          "lg:relative lg:z-20 lg:translate-x-0",
          collapsed ? "lg:w-[80px]" : "lg:w-[264px]",
          drawer ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <svg aria-hidden viewBox="0 0 264 240" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 w-full h-60 pointer-events-none group-data-[collapsed=true]/side:lg:hidden">
          <path d="M0 150 C 60 110, 110 190, 170 150 S 250 100, 264 120 V240 H0 Z" fill="rgba(236,120,46,0.06)" />
          <path d="M0 190 C 70 150, 120 230, 180 190 S 245 150, 264 165 V240 H0 Z" fill="rgba(120,165,240,0.07)" />
          <path d="M0 150 C 60 110, 110 190, 170 150 S 250 100, 264 120" fill="none" stroke="rgba(236,120,46,0.22)" strokeWidth="1" />
        </svg>

        <div className="relative px-5 pt-5 pb-4 flex flex-col gap-2.5 group-data-[collapsed=true]/side:lg:px-2">
          <div className="flex items-center justify-between gap-2 group-data-[collapsed=true]/side:lg:flex-col group-data-[collapsed=true]/side:lg:gap-3">
            <Link to="/admin" className="flex items-center gap-3 min-w-0" aria-label="StarTrack platform admin">
              <BrandMark className="w-10 h-10" glow />
              <span className={cn("font-extrabold text-[17px] tracking-[-0.02em] text-white", label)}>StarTrack</span>
            </Link>
            <button
              onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden lg:grid place-items-center w-9 h-9 rounded-full border border-nav-line bg-white/5 text-nav-fg hover:bg-white/10 hover:text-white transition-colors"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button onClick={() => setDrawer(false)} aria-label="Close menu" className="lg:hidden grid place-items-center w-9 h-9 rounded-full border border-nav-line bg-white/5 text-nav-fg hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <span className={cn("self-start px-2.5 py-[3px] rounded-full border border-[var(--st-accent)]/40 bg-[var(--st-accent)]/15 text-[11px] font-bold tracking-[0.12em] uppercase text-[#ffb98a] whitespace-nowrap", label)}>
            Platform admin
          </span>
        </div>

        <nav className="relative flex-1 overflow-y-auto px-4 group-data-[collapsed=true]/side:lg:px-3 flex flex-col gap-0.5" aria-label="Platform sections">
          {tabs.map((t) => {
            const Icon = ICONS[t.key];
            return (
              <NavLink key={t.key} to={`/admin/${t.key}`} title={t.label} className={({ isActive }) => item(isActive)}>
                <Icon className="w-[18px] h-[18px] shrink-0 opacity-90" strokeWidth={1.8} />
                <span className={label}>{t.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="relative px-4 py-3 flex flex-col gap-0.5 group-data-[collapsed=true]/side:lg:px-3">
          <Link
            to="/desk" title="Support desk"
            className="flex items-center gap-3 p-2 rounded-xl text-white hover:bg-white/[0.07] transition-colors text-left group-data-[collapsed=true]/side:lg:justify-center group-data-[collapsed=true]/side:lg:px-2"
          >
            <span className="grid place-items-center w-9 h-9 rounded-full bg-white/10 shrink-0">
              <Headphones className="w-[18px] h-[18px]" strokeWidth={1.8} />
            </span>
            <span className={cn("flex flex-col min-w-0 leading-[1.3]", label)}>
              <strong className="text-[14px]">Support desk</strong>
              <span className="text-[12px] text-nav-fg">Answer business requests</span>
            </span>
          </Link>
          <button onClick={signOut} title="Sign out" className={cn(linkBase, "w-full text-nav-fg hover:bg-white/[0.06] hover:text-white")}>
            <LogOut className="w-[18px] h-[18px] shrink-0 opacity-90" strokeWidth={1.8} />
            <span className={label}>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="frost h-[72px] shrink-0 border-b border-line flex items-center gap-3 px-4 lg:px-12 relative z-30">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" className="lg:hidden w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-t1 hover:bg-surface-3">
            <Menu className="w-5 h-5" />
          </button>

          <form onSubmit={search} className="relative flex-1 max-w-[420px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-t3 pointer-events-none" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an account or owner…" aria-label="Find an account"
              className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-3 border border-transparent text-[13px] text-t1 placeholder:text-t3 focus:outline-none focus:border-primary focus:bg-surface focus:shadow-[var(--st-focus-ring)] transition-[border-color,box-shadow,background-color]"
            />
          </form>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            <Link to="/desk" className="hidden md:inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-[var(--st-accent)] hover:brightness-95 text-white text-[13px] font-bold transition">
              <Headphones className="w-4 h-4" /> Support desk
            </Link>
            <RefreshButton />
            <ThemeToggle className="max-sm:hidden" />
            <span className="hidden sm:block w-px h-8 bg-line mx-1" />

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}
                className="flex items-center gap-3 rounded-full hover:bg-surface-3 transition-colors pr-2 sm:pr-3"
              >
                <span
                  className="grid place-items-center w-10 h-10 rounded-full text-white text-[14px] font-bold shrink-0"
                  style={{ background: "var(--st-gradient-primary)", boxShadow: "0 0 0 3px var(--st-surface), 0 0 0 4px var(--st-brand-100)" }}
                >
                  {name[0]?.toUpperCase()}
                </span>
                <span className="hidden md:flex flex-col leading-[1.3] text-left">
                  <span className="text-[13px] font-bold text-t1 max-w-[140px] truncate">{name}</span>
                  <span className="text-[12px] text-t3">{isOverseer ? "Overseer" : "Support, read only"}</span>
                </span>
                <ChevronDown className={cn("w-3.5 h-3.5 text-t3 max-sm:hidden transition-transform", menu && "rotate-180")} />
              </button>

              {menu && (
                <div role="menu" className="absolute right-0 top-full mt-2 z-50 w-60 pop border border-line rounded-2xl shadow-e2 py-2">
                  <div className="px-4 py-3 border-b border-line">
                    <div className="text-[13px] font-bold text-t1 truncate">{name}</div>
                    <div className="text-[12px] text-t3 truncate">{session?.user.email}</div>
                  </div>
                  <Link to="/app" role="menuitem" className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-t2 hover:bg-surface-3">
                    <Store className="w-4 h-4" /> My business <ArrowUpRight className="w-3.5 h-3.5 ml-auto text-t4" />
                  </Link>
                  <button onClick={signOut} role="menuitem" className="w-full flex items-center gap-2 text-left px-4 py-2.5 text-[13px] font-medium text-danger hover:bg-danger-soft">
                    <LogOut className="w-4 h-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content-bg flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
