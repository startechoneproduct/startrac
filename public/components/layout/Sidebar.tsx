import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Globe2, HelpCircle, Home, LogOut, X } from "lucide-react";
import { useSession } from "@/lib/session";
import { HelpPanel } from "@/components/layout/HelpPanel";
import { useNavGroups } from "@/components/layout/useNav";
import { LockChip } from "@/components/plan/PlanUi";
import { BrandMark } from "@/components/brand/BrandMark";
import { cn } from "@/lib/utils";

// Labels disappear (but stay readable to screen readers) when the sidebar is
// collapsed to its icon rail. The collapsed state only applies from `lg` up;
// on a phone the sidebar is a full drawer.
const label = "group-data-[collapsed=true]/side:lg:sr-only";

const linkBase =
  "flex items-center gap-3 px-3.5 py-[8px] rounded-xl text-[13.5px] font-semibold whitespace-nowrap transition-colors group-data-[collapsed=true]/side:lg:justify-center group-data-[collapsed=true]/side:lg:px-2";

export function Sidebar({ collapsed, onToggle, mobileOpen, onClose }: {
  collapsed: boolean; onToggle: () => void; mobileOpen: boolean; onClose: () => void;
}) {
  const { session, can, logout } = useSession();
  const { groups, active } = useNavGroups();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  // The open section folds away when its own name is clicked again, and
  // unfolds on the next click. Moving to another section opens that one.
  const [folded, setFolded] = useState<string | null>(null);
  useEffect(() => setFolded(null), [active?.to]);
  const isPlatform = !!session?.platformRole && session.platformRole !== "none";

  const item = (isActive: boolean) =>
    cn(linkBase, isActive ? "bg-primary text-white" : "text-nav-fg hover:bg-nav-hover hover:text-nav-strong");

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={onClose}
        className={cn("lg:hidden fixed inset-0 z-[55] bg-ink/55 backdrop-blur-[2px] transition-opacity", mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none")}
      />
      <aside
        data-collapsed={collapsed}
        style={{ background: "var(--st-gradient-ink)" }}
        className={cn(
          "group/side text-nav-strong flex flex-col overflow-hidden shrink-0",
          "fixed inset-y-0 left-0 z-[60] w-[280px] transition-[width,transform] duration-200 ease-out",
          "lg:relative lg:z-20 lg:translate-x-0",
          collapsed ? "lg:w-[80px]" : "lg:w-[264px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Decorative wave, bottom of the sidebar */}
        <svg aria-hidden viewBox="0 0 264 240" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 w-full h-60 pointer-events-none group-data-[collapsed=true]/side:lg:hidden">
          <path d="M0 150 C 60 110, 110 190, 170 150 S 250 100, 264 120 V240 H0 Z" fill="rgba(143,148,255,0.06)" />
          <path d="M0 190 C 70 150, 120 230, 180 190 S 245 150, 264 165 V240 H0 Z" fill="rgba(143,148,255,0.07)" />
          <path d="M0 150 C 60 110, 110 190, 170 150 S 250 100, 264 120" fill="none" stroke="rgba(160,170,255,0.18)" strokeWidth="1" />
        </svg>

        {/* Brand block */}
        <div className="relative px-5 pt-5 pb-4 flex flex-col gap-2.5 group-data-[collapsed=true]/side:lg:px-2">
          <div className="flex items-center justify-between gap-2 group-data-[collapsed=true]/side:lg:flex-col group-data-[collapsed=true]/side:lg:gap-3">
            <Link to="/app/dashboard" className="flex items-center gap-3 min-w-0" aria-label="StarTrack">
              <BrandMark className="w-10 h-10" glow />
              <span className={cn("font-extrabold text-[17px] tracking-[-0.02em] text-white", label)}>StarTrack</span>
            </Link>
            <button
              onClick={onToggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden lg:grid place-items-center w-9 h-9 rounded-full border border-nav-line bg-white/5 text-nav-fg hover:bg-white/10 hover:text-white transition-colors"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button onClick={onClose} aria-label="Close menu" className="lg:hidden grid place-items-center w-9 h-9 rounded-full border border-nav-line bg-white/5 text-nav-fg hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <span className={cn("self-start px-2.5 py-[3px] rounded-full border border-nav-line bg-white/5 text-[11px] font-bold tracking-[0.12em] uppercase text-nav-fg whitespace-nowrap", label)}>
            {session?.role === "owner" || session?.role === "admin" ? "Admin portal" : `${session?.role ?? ""} portal`}
          </span>
        </div>

        {/* Sections. The current section opens to show its pages. */}
        <nav className="relative flex-1 overflow-y-auto px-4 group-data-[collapsed=true]/side:lg:px-3 flex flex-col gap-0.5" aria-label="Main">
          {!can("dashboard_ops") && (
            <NavLink to="/app/home" onClick={onClose} title="Home" className={() => item(pathname === "/app/home")}>
              <Home className="w-[18px] h-[18px] shrink-0 opacity-90" strokeWidth={1.8} />
              <span className={label}>Home</span>
            </NavLink>
          )}
          {groups.map((g) => {
            const isActive = active?.to === g.to;
            const open = isActive && folded !== g.to;
            return (
              <div key={g.label}>
                <NavLink
                  to={g.to}
                  title={g.label}
                  data-tour={`nav-${g.to.replace("/app/", "")}`}
                  className={() => item(isActive)}
                  aria-expanded={g.children ? open : undefined}
                  onClick={(e) => {
                    // Already in this section, with names showing: just open or close its pages.
                    if (isActive && g.children && !collapsed) {
                      e.preventDefault();
                      setFolded(open ? g.to : null);
                      return;
                    }
                    onClose();
                  }}
                >
                  <g.icon className="w-[18px] h-[18px] shrink-0 opacity-90" strokeWidth={1.8} />
                  <span className={label}>{g.label}</span>
                  {g.children && (
                    <ChevronDown className={cn("w-4 h-4 ml-auto shrink-0 opacity-70 transition-transform group-data-[collapsed=true]/side:lg:hidden", !open && "-rotate-90")} strokeWidth={2} />
                  )}
                </NavLink>
                {open && g.children && (
                  <div className="my-1 ml-[24px] pl-3.5 border-l border-nav-line space-y-px group-data-[collapsed=true]/side:lg:hidden">
                    {g.children.map((c) => (
                      <NavLink
                        key={c.to + c.label}
                        to={c.to}
                        end
                        onClick={onClose}
                        className={({ isActive: on }) =>
                          cn(
                            "block px-3 py-[6px] rounded-lg text-[12.5px] font-medium transition-colors",
                            on ? "bg-white/10 text-white" : "text-nav-fg hover:text-white hover:bg-white/[0.06]"
                          )
                        }
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate">{c.label}</span>
                          {c.locked && c.feature && <LockChip feature={c.feature} className="!bg-white/10 !text-white/80" />}
                        </span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer: support and sign out */}
        <div className="relative px-4 py-3 flex flex-col gap-0.5 group-data-[collapsed=true]/side:lg:px-3">
          {isPlatform && (
            <NavLink to="/admin" onClick={onClose} title="Platform admin" className={() => item(false)}>
              <Globe2 className="w-[18px] h-[18px] shrink-0 opacity-90" strokeWidth={1.8} />
              <span className={label}>Platform admin</span>
            </NavLink>
          )}
          <button
            data-tour="sidebar-help"
            onClick={() => setHelpOpen(true)}
            title="Help"
            className="flex items-center gap-3 p-2 rounded-xl text-white hover:bg-white/[0.07] transition-colors text-left group-data-[collapsed=true]/side:lg:justify-center group-data-[collapsed=true]/side:lg:px-2"
          >
            <span className="grid place-items-center w-9 h-9 rounded-full bg-white/10 shrink-0">
              <HelpCircle className="w-[18px] h-[18px]" strokeWidth={1.8} />
            </span>
            <span className={cn("flex flex-col min-w-0 leading-[1.3]", label)}>
              <strong className="text-[14px]">Help & support</strong>
              <span className="text-[12px] text-nav-fg">Guides and shortcuts</span>
            </span>
          </button>
          <button
            onClick={() => { logout(); navigate("/login"); }}
            title="Sign out"
            className={cn(linkBase, "w-full text-nav-fg hover:bg-white/[0.06] hover:text-white")}
          >
            <LogOut className="w-[18px] h-[18px] shrink-0 opacity-90" strokeWidth={1.8} />
            <span className={label}>Sign out</span>
          </button>
        </div>
        <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
      </aside>
    </>
  );
}
