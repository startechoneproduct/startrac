import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, PackageX, PackageSearch, CalendarClock, CalendarX2, Undo2, ShieldCheck,
  Check, CheckCheck, Loader2, LifeBuoy, ShoppingBag,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export type Notification = {
  id: string;
  type: "stock_out" | "stock_low" | "expired" | "expiry_soon" | "return_pending" | "undo_pending" | "perm_changed" | "ticket_update" | "help_update" | "online_order";
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  target: { type: string; id: string; label: string } | null;
  branchName: string;
  data: Record<string, any>;
  status: string;
  read: boolean;
  at: string;
};

const ICONS = {
  stock_out: PackageX,
  stock_low: PackageSearch,
  expired: CalendarX2,
  expiry_soon: CalendarClock,
  return_pending: Undo2,
  undo_pending: Undo2,
  perm_changed: ShieldCheck,
  ticket_update: LifeBuoy,
  help_update: LifeBuoy,
  online_order: ShoppingBag,
} as const;

// Where each kind of alert wants you to go to actually deal with it. An alert
// you can't act on from the alert is only half an alert.
const DESTINATION: Record<Notification["type"], string> = {
  stock_out: "/app/stock-in",
  stock_low: "/app/stock-in",
  expired: "/app/products",
  expiry_soon: "/app/products",
  return_pending: "/app/returns",
  undo_pending: "/app/sales",
  perm_changed: "/app/activity",
  ticket_update: "/app/tickets",
  help_update: "/app/help",
  online_order: "/app/orders",
};

// A ticket update should open that exact ticket, not just the list.
function destinationFor(n: Notification) {
  if (n.type === "ticket_update" && n.target?.id) return `/app/tickets?open=${n.target.id}`;
  if (n.type === "help_update" && n.target?.id) return `/app/help?open=${n.target.id}`;
  return DESTINATION[n.type] || "/app/dashboard";
}

const TONE = {
  critical: { dot: "bg-danger", chip: "bg-danger-soft text-danger", ring: "ring-danger/20" },
  warning: { dot: "bg-warning", chip: "bg-warning-soft text-warning", ring: "ring-warning/20" },
  info: { dot: "bg-primary", chip: "bg-primary-soft text-primary", ring: "ring-primary/20" },
} as const;

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const { activeBusiness, activeBranch } = useSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!activeBusiness?.id) return;
    try {
      const r = await api<{ notifications: Notification[]; unread: number }>("/notifications?status=open&limit=30");
      setItems(r.notifications);
      setUnread(r.unread);
    } catch {
      /* a failed poll is not worth interrupting anyone over */
    }
    // activeBranch is not read here, but the request carries it as a header —
    // switching branch must refetch, so it stays a dependency.
  }, [activeBusiness?.id, activeBranch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while the tab is visible. Alerts are minutes-fresh by nature — a
  // websocket would be more machinery than the problem deserves.
  useEffect(() => {
    load();
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const timer = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await load();
      setLoading(false);
      // Opening the panel IS reading it — clear the badge, keep the list.
      if (unread > 0) {
        setUnread(0);
        api("/notifications/read-all", { method: "POST" }).catch(() => {});
      }
    }
  }

  async function dismiss(id: string) {
    setBusy(id);
    setItems((list) => list.filter((n) => n.id !== id)); // optimistic
    try {
      await api(`/notifications/${id}/dismiss`, { method: "POST" });
    } catch {
      load(); // put it back if the server disagreed
    } finally {
      setBusy(null);
    }
  }

  async function dismissAll() {
    const previous = items;
    setItems([]);
    try {
      await api("/notifications/dismiss-all", { method: "POST" });
    } catch {
      setItems(previous);
    }
  }

  const criticals = items.filter((n) => n.severity === "critical").length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className={cn(
          "relative w-9 h-9 rounded-lg border flex items-center justify-center transition-colors",
          open ? "border-brand-400 bg-primary-soft text-primary" : "border-line text-t3 hover:bg-surface-3 hover:text-t1"
        )}
        title={items.length ? `${items.length} open alert${items.length === 1 ? "" : "s"}` : "No alerts"}
      >
        <Bell className="w-[17px] h-[17px]" />
        {unread > 0 && (
          <span
            className={cn(
              "absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[9px] font-semibold flex items-center justify-center",
              criticals > 0 ? "bg-danger" : "bg-warning"
            )}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 right-0 w-[min(380px,calc(100vw-2rem))] pop border border-line-2 rounded-xl shadow-e2 z-50 overflow-hidden animate-fade-up">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
            <span className="text-[13px] font-semibold text-t1">Alerts</span>
            {items.length > 0 && (
              <span className={cn("text-[11.5px] font-medium px-1.5 py-0.5 rounded", TONE[criticals > 0 ? "critical" : "warning"].chip)}>
                {items.length} open
              </span>
            )}
            {items.length > 0 && (
              <button onClick={dismissAll} className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-t3 hover:text-primary transition-colors">
                <CheckCheck className="w-3.5 h-3.5" /> Clear all
              </button>
            )}
          </div>

          <div className="max-h-[min(460px,60vh)] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-t4">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="w-12 h-12 rounded-xl bg-success-soft text-success flex items-center justify-center mx-auto mb-3">
                  <Check className="w-6 h-6" />
                </div>
                <div className="text-[13px] font-semibold text-t2">Nothing needs you</div>
                <div className="text-[12px] text-t4 mt-1">Stock levels, expiry dates and returns all look fine.</div>
              </div>
            ) : (
              items.map((n) => {
                const Icon = ICONS[n.type] || Bell;
                const tone = TONE[n.severity];
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "group flex gap-3 px-4 py-3 border-b border-line last:border-0 hover:bg-surface-2 transition-colors cursor-pointer",
                      busy === n.id && "opacity-50"
                    )}
                    onClick={() => { setOpen(false); navigate(destinationFor(n)); }}
                  >
                    <div className={cn("w-8 h-8 shrink-0 rounded-lg flex items-center justify-center", tone.chip)}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <span className="text-[13px] font-semibold text-t1 leading-snug">{n.title}</span>
                        {!n.read && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 mt-1.5", tone.dot)} />}
                      </div>
                      {n.body && <div className="text-[12px] text-t3 leading-snug mt-0.5">{n.body}</div>}
                      <div className="text-[10px] text-t4 mt-1">{timeAgo(n.at)}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                      className="shrink-0 self-start w-6 h-6 rounded-md text-t4 opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-success flex items-center justify-center transition-all"
                      title="I've dealt with this"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {items.length > 0 && (
            <div className="px-4 py-2.5 border-t border-line bg-surface-2">
              <div className="text-[11px] text-t4">
                Alerts close themselves when the problem does — restock an item and it disappears.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
