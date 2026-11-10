import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, KeyRound, LogOut, Store, Building2, Plus, Menu, Lock, RefreshCw, Check, Search } from "lucide-react";
import { refreshAll } from "@/lib/useApi";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { AiAssistant } from "@/components/ai/AiAssistant";
import { PlanChip } from "@/components/plan/PlanUi";
import { ErrorBanner, Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { businessLogoUrl } from "@/lib/logo";
import { CurrencySwitcher } from "@/components/layout/CurrencySwitcher";

// Staff change their own till PIN — requires the current one when set.
function ChangePinModal({ open, onClose, businessId }: { open: boolean; onClose: () => void; businessId: string }) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/auth/change-pin", { method: "POST", body: JSON.stringify({ businessId, currentPin, newPin }) });
      setDone(true);
      setCurrentPin(""); setNewPin("");
      setTimeout(() => { setDone(false); onClose(); }, 1200);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Change my PIN" subtitle="Your till login PIN for this business">
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        {done && <div className="px-3 py-2.5 rounded-ctl bg-success-soft text-success text-[12px] font-semibold">PIN changed.</div>}
        <Field label="Current PIN" hint="Leave blank if you've never had one">
          <Input type="password" inputMode="numeric" maxLength={6} value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="New PIN">
          <Input required type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Changing…" : "Change PIN"}</Button>
      </form>
    </Modal>
  );
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate();
  const { session, can, hasFeature, activeBusiness, activeBranch, branchesForActive, setActiveBusiness, setActiveBranch, logout } = useSession();
  const [branchOpen, setBranchOpen] = useState(false);
  const [bizOpen, setBizOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setBranchOpen(false); setBizOpen(false); setUserOpen(false); } };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (!session) return null;
  const multiBiz = session.businesses.length > 1;

  const chip = "flex items-center gap-2 px-3 h-10 rounded-xl text-[13px] font-semibold text-t1 hover:bg-surface-3 transition-colors";
  const menu = "absolute top-full mt-2 left-0 pop border border-line rounded-2xl shadow-e2 py-2 z-50";

  return (
    <header ref={ref} className="frost h-16 sm:h-[72px] shrink-0 border-b border-line flex items-center gap-2 sm:gap-3 px-3 sm:px-4 lg:px-12 relative z-30">
      <button onClick={onMenu} aria-label="Open menu" className="lg:hidden w-10 h-10 shrink-0 -ml-1 rounded-full flex items-center justify-center text-t1 hover:bg-surface-3">
        <Menu className="w-5 h-5" />
      </button>

      <GlobalSearch />

      {/* Workspace: which business, which branch. */}
      <div className="flex items-center min-w-0 shrink max-md:hidden">
        <div className="relative">
          <button onClick={() => { setBizOpen((v) => !v); setBranchOpen(false); setUserOpen(false); }} className={cn(chip, !multiBiz && "cursor-default hover:bg-transparent")}>
            {businessLogoUrl(activeBusiness)
              ? <img src={businessLogoUrl(activeBusiness)} alt="" className="w-6 h-6 rounded-lg object-contain bg-white shrink-0" />
              : <span className="w-6 h-6 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0"><Store className="w-3.5 h-3.5" strokeWidth={2} /></span>}
            <span className="truncate max-w-[150px]">{activeBusiness?.name}</span>
            {multiBiz && <ChevronDown className="w-3.5 h-3.5 text-t3" />}
          </button>
          {bizOpen && multiBiz && (
            <div className={cn(menu, "w-60")}>
              <div className="px-4 py-1.5 text-[12px] font-semibold text-t3">My businesses</div>
              {session.businesses.map((b) => (
                <button key={b.id} onClick={() => { setActiveBusiness(b.id); setBizOpen(false); }} className={cn("w-full flex items-center gap-2 text-left px-4 py-2.5 text-[13px] font-medium hover:bg-surface-3", b.id === activeBusiness?.id ? "text-primary" : "text-t2")}>
                  <Building2 className="w-3.5 h-3.5" /> {b.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {branchesForActive.length > 0 && (
          <>
            <span className="text-t4 text-[16px] select-none">/</span>
            <div className="relative">
              <button onClick={() => { setBranchOpen((v) => !v); setBizOpen(false); setUserOpen(false); }} className={cn(chip, "text-t2 font-medium")}>
                <span className="truncate max-w-[130px]">{activeBranch?.name}</span>
                {branchesForActive.length > 1 && <ChevronDown className="w-3.5 h-3.5 text-t3 shrink-0" />}
              </button>
              {branchOpen && branchesForActive.length > 1 && (
                <div className={cn(menu, "w-52")}>
                  {branchesForActive.map((b) => (
                    <button key={b.id} onClick={() => { setActiveBranch(b.id); setBranchOpen(false); }} className={cn("w-full text-left px-4 py-2.5 text-[13px] font-medium hover:bg-surface-3", b.id === activeBranch?.id ? "text-primary" : "text-t2")}>{b.name}</button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Phone: search opens over the whole bar, since there's no room for the box. */}
      {searchOpen && (
        <div className="sm:hidden absolute inset-0 z-40 bg-surface flex items-center gap-2 px-3 animate-fade-in">
          <GlobalSearch mobile onDone={() => setSearchOpen(false)} />
          <button onClick={() => setSearchOpen(false)} className="shrink-0 h-10 px-2 text-[13px] font-semibold text-t2">Cancel</button>
        </div>
      )}

      <div className="flex items-center gap-1.5 sm:gap-2 ml-auto shrink-0">
        <button onClick={() => setSearchOpen(true)} aria-label="Search" className="sm:hidden grid place-items-center w-10 h-10 rounded-full text-t2 hover:bg-surface-3">
          <Search className="w-[18px] h-[18px]" />
        </button>
        {can("sales") && (
          <Link
            to="/app/pos"
            data-tour="new-sale-btn"
            aria-label="New sale"
            className="inline-flex items-center justify-center gap-1.5 h-10 max-sm:w-10 sm:px-4 rounded-xl bg-primary text-white text-[13px] font-bold"
          >
            <Plus className="w-4 h-4" /> <span className="max-sm:hidden">New sale</span>
          </Link>
        )}
        <CurrencySwitcher />
        {/* Very narrow phones: the refresh button gives way so the bar never overflows. */}
        <span className="contents max-[359px]:hidden"><RefreshButton /></span>
        <span data-tour="topbar-notifications" className="flex">
          <NotificationBell />
        </span>
        {hasFeature("ai") ? <AiAssistant /> : can("*") && (
          <Link to="/app/billing?plan=pro" title="AI assistant is on the Pro plan" className="hidden sm:inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full border border-line-2 bg-surface text-[13px] font-bold text-t2 hover:text-primary hover:border-primary transition-colors">
            <Lock className="w-3.5 h-3.5" /> AI <PlanChip plan="pro" />
          </Link>
        )}
        <ThemeToggle className="max-sm:hidden" />
        <span className="hidden sm:block w-px h-8 bg-line mx-1" />

        <div className="relative">
          <button onClick={() => { setUserOpen((v) => !v); setBizOpen(false); setBranchOpen(false); }} className="flex items-center gap-3 rounded-full hover:bg-surface-3 transition-colors pr-2 sm:pr-3">
            <span
              className="grid place-items-center w-10 h-10 rounded-full text-white text-[14px] font-bold shrink-0"
              style={{ background: "var(--st-gradient-primary)", boxShadow: "0 0 0 3px var(--st-surface), 0 0 0 4px var(--st-brand-100)" }}
            >
              {session.user.name[0]?.toUpperCase()}
            </span>
            <span className="hidden md:flex flex-col leading-[1.3] text-left">
              <span className="text-[13px] font-bold text-t1 max-w-[140px] truncate">{session.user.name}</span>
              <span className="text-[12px] text-t3 capitalize">{session.role}</span>
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-t3 max-sm:hidden" />
          </button>
          {userOpen && (
            <div className={cn(menu, "left-auto right-0 w-60")}>
              <div className="px-4 py-3 border-b border-line">
                <div className="text-[13px] font-bold text-t1 truncate">{session.user.name}</div>
                <div className="text-[12px] text-t3 truncate">{session.user.email}</div>
              </div>
              <button onClick={() => { setUserOpen(false); setPinOpen(true); }} className="w-full flex items-center gap-2 text-left px-4 py-2.5 text-[13px] font-medium text-t2 hover:bg-surface-3">
                <KeyRound className="w-4 h-4" /> Change my PIN
              </button>
              <button onClick={() => { logout(); navigate("/login"); }} className="w-full flex items-center gap-2 text-left px-4 py-2.5 text-[13px] font-medium text-danger hover:bg-danger-soft">
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      <ChangePinModal open={pinOpen} onClose={() => setPinOpen(false)} businessId={activeBusiness?.id || ""} />
    </header>
  );
}

/** Fetches everything on screen again, quietly, without reloading the app. */
export function RefreshButton() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  async function go() {
    if (state === "busy") return;
    setState("busy");
    // Long enough to see it turn, even when the answer is instant.
    await Promise.all([refreshAll(), new Promise((r) => setTimeout(r, 450))]);
    setState("done");
    setTimeout(() => setState("idle"), 1200);
  }
  return (
    <button
      type="button"
      onClick={go}
      title="Refresh the figures on this page"
      aria-label={state === "busy" ? "Refreshing" : state === "done" ? "Up to date" : "Refresh"}
      className="grid place-items-center w-10 h-10 rounded-full border border-line-2 bg-surface text-t2 hover:text-primary hover:border-primary transition-colors"
    >
      {state === "done" ? <Check className="w-4 h-4 text-success" /> : <RefreshCw className={cn("w-4 h-4", state === "busy" && "animate-spin")} />}
    </button>
  );
}
