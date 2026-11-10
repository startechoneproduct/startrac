import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Wallet, ShoppingCart, TrendingUp, AlertTriangle, RefreshCw, Package,
  Boxes, CalendarClock, Receipt, Users, UserCog, ArrowDownToLine, ArrowUpFromLine, History,
  ReceiptText, ArrowLeftRight, Undo2, Wrench, RotateCcw, Sparkles, Compass, Lock, ShoppingBag } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { AiText, TypingDots } from "@/components/ai/AiBits";
import { StatCard, DeltaChip } from "@/components/ui/StatCard";
import { Table, TR, TH, TD } from "@/components/ui/Table";
import { EmptyState, Spinner } from "@/components/ui/EmptyState";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { ProductTour, tourSeen, markTourSeen } from "@/components/tour/ProductTour";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { typeMeta } from "@/lib/businessTypes";
import { buildDashboardTour } from "@/lib/tourSteps";
import { SalesHistoryView } from "@/pages/Sales";
import { fmtMoney, fmtTime, fmtDate, fmtDateTime, todayStr } from "@/lib/format";
import { LockedPage } from "@/components/plan/PlanUi";
import { cn } from "@/lib/utils";
import { animateSwitch } from "@/lib/viewTransition";

const DASHBOARD_TOUR_KEY = "dashboard-v1";

type Metrics = {
  today: {
    revenue: number; txns: number; profit?: number; expenses?: number;
    deltas: { revenue: number; txns: number; profit?: number };
  };
  series7d: { date: string; revenue: number }[];
  week: { revenue: number; deltaPct: number };
  paymentSplit: { cash: number; pos: number; transfer: number };
  topProducts: { id: string; name: string; sold: number; revenue: number }[];
  lowStock: { id: string; name: string; stock: number; reorderLevel: number }[];
  recentSales: { id: string; saleNo: string; at: string; staffName: string; total: number; method: string; status: string; summary: string }[];
};

const PAY_COLORS: Record<string, string> = { cash: "var(--chart-2)", pos: "var(--chart-1)", transfer: "var(--chart-3)" };
const PAY_LABELS: Record<string, string> = { cash: "Cash", pos: "POS", transfer: "Transfer" };

function ChartTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-surface border border-line-2 shadow-e2 px-3 py-2">
      <div className="text-[11px] font-semibold text-t3 mb-0.5">{label}</div>
      <div className="text-[14px] font-semibold font-mono text-t1">{fmtMoney(payload[0].value, currency)}</div>
    </div>
  );
}

type Tab = "overview" | "profit" | "sales" | "expenses" | "inventory" | "movement" | "customers" | "staff" | "expiry" | "archive";

// The tabs a plan can lock. Overview, Sales and Expenses are on every plan; Profit & Loss is Pro.
const TAB_FEATURE: Partial<Record<string, string>> = {
  profit: "advancedDashboard", inventory: "advancedDashboard", movement: "advancedDashboard", customers: "advancedDashboard",
  staff: "advancedDashboard", expiry: "expiry", archive: "advancedDashboard",
};

export function Dashboard() {
  const { session, activeBusiness, activeBranch, currency, hasModule, hasFeature, can } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const { data: m, loading, error, reload } = useApi<Metrics>("/metrics/dashboard", [activeBranch?.id]);
  // Online orders waiting on you, if the business runs an online store. Only asked
  // when the plan includes it, so it never trips an upgrade prompt.
  const { data: web } = useApi<{ waiting: number; storeEnabled: boolean; onlineToday: { revenue: number; orders: number } }>(
    hasFeature("sitePage") && can("sales") ? "/orders/summary" : null, [activeBranch?.id]
  );

  const firstName = session?.user.name.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // A new owner/manager's first stop after logging in — so it's where the
  // tour introduces the whole app, not just this one page. Waits for the
  // real dashboard content to be on screen (the tour points at it) and
  // never shows twice on the same browser once dismissed.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (loading || !m || tourSeen(DASHBOARD_TOUR_KEY)) return;
    const t = setTimeout(() => setTourOpen(true), 700);
    return () => clearTimeout(t);
  }, [loading, m]);
  function closeTour() {
    markTourSeen(DASHBOARD_TOUR_KEY);
    setTourOpen(false);
  }

  if (loading && !m) {
    return <DashboardSkeleton />;
  }
  if (!m) {
    return (
      <div className="p-8 max-w-md mx-auto text-center">
        <div className="text-[14px] font-semibold text-t1 mt-16">Dashboard unavailable</div>
        <p className="text-[13px] text-t3 mt-1">{error || "Your role doesn't include the dashboard."}</p>
      </div>
    );
  }

  const showProfit = m.today.profit !== undefined;
  const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-NG", { weekday: "short" });
  const series = m.series7d.map((s) => ({ d: dayLabel(s.date), v: s.revenue }));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      {web?.storeEnabled && web.waiting > 0 && (
        <Link to="/app/orders" className="mb-5 flex items-center gap-3 rounded-card border border-warning/30 bg-warning-soft px-5 py-3.5 hover:brightness-95 transition">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-warning text-white"><ShoppingBag className="w-[18px] h-[18px]" /></span>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-t1">{web.waiting} online order{web.waiting === 1 ? "" : "s"} waiting for you</div>
            <div className="text-[12px] text-t3">Confirm them to record the sale and take the stock off.</div>
          </div>
          <span className="text-[12.5px] font-bold text-warning">Open orders →</span>
        </Link>
      )}

      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-[22px] leading-7 font-semibold text-t1">{greeting}, {firstName}</h1>
          <p className="text-[13px] text-t3 mt-1">
            Here's how {activeBusiness?.name || "your business"}{activeBranch ? ` · ${activeBranch.name}` : ""} is doing today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md" onClick={() => setTourOpen(true)}><Compass className="w-4 h-4" /> Take a tour</Button>
          <Button variant="secondary" size="md" onClick={reload}><RefreshCw className="w-4 h-4" /> Refresh</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-line max-w-full overflow-x-auto mb-6" data-tour="dashboard-tabs">
        {([
          { k: "overview", label: "Overview", icon: Wallet },
          ...(can("dashboard_finance") ? [{ k: "profit", label: "Profit & Loss", icon: TrendingUp }] : []),
          { k: "sales", label: "Sales", icon: Receipt },
          ...(hasModule("expenses") ? [{ k: "expenses", label: "Expenses", icon: ReceiptText }] : []),
          { k: "inventory", label: "Inventory", icon: Boxes },
          { k: "movement", label: "Movement", icon: ArrowLeftRight },
          ...(hasModule("customers") ? [{ k: "customers", label: "Customers", icon: Users }] : []),
          { k: "staff", label: "Staff", icon: UserCog },
          ...(hasModule("expiry") ? [{ k: "expiry", label: "Expiry", icon: CalendarClock }] : []),
          { k: "archive", label: "Archive", icon: History },
        ] as { k: Tab; label: string; icon: any }[]).map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            onClick={(e) => {
              // On a phone the row scrolls sideways: bring the chosen tab into the middle.
              e.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
              if (k !== tab) animateSwitch("tab", () => setTab(k));
            }}
            className={cn(
              "relative flex items-center gap-1.5 px-3 h-10 -mb-px text-[13px] font-medium transition-colors whitespace-nowrap",
              tab === k ? "text-t1" : "text-t3 hover:text-t1"
            )}
          >
            {/* Its own element so a tab change can slide it across (index.css). */}
            {tab === k && <span aria-hidden className="st-vt-tabbar absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
            <Icon className="w-4 h-4 text-t4" strokeWidth={1.75} /> {label}
            {TAB_FEATURE[k] && !hasFeature(TAB_FEATURE[k]!) && <Lock className="w-3 h-3 text-t4" />}
          </button>
        ))}
      </div>

      {/* The tab's content: on a tab change it lifts away and the next one
          rises into place (index.css), while the header and tabs stay put. */}
      <div className="st-vt-tabpanel">
      {TAB_FEATURE[tab] && !hasFeature(TAB_FEATURE[tab]!) ? <LockedPage feature={TAB_FEATURE[tab]!} /> : (
        <>
          {tab === "profit" && <ProfitTab currency={currency} branchKey={activeBranch?.id} />}
          {tab === "sales" && <SalesTab currency={currency} branchKey={activeBranch?.id} />}
          {tab === "expenses" && <ExpensesTab currency={currency} branchKey={activeBranch?.id} />}
          {tab === "inventory" && <InventoryTab currency={currency} branchKey={activeBranch?.id} />}
          {tab === "movement" && <MovementTab branchKey={activeBranch?.id} />}
          {tab === "customers" && <CustomersTab currency={currency} branchKey={activeBranch?.id} />}
          {tab === "staff" && <StaffTab currency={currency} branchKey={activeBranch?.id} />}
          {tab === "expiry" && <ExpiryTab branchKey={activeBranch?.id} />}
          {tab === "archive" && <SalesHistoryView />}
        </>
      )}
      {tab !== "overview" ? null : (
      <>
      {/* Headline band: one hero for revenue, a tile grid for the rest, and
          how the money arrived as a slim strip underneath. */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 mb-5" data-tour="dashboard-stats">
        <RevenueHero
          value={fmtMoney(m.today.revenue, currency)}
          delta={m.today.deltas.revenue}
          series={series}
          currency={currency}
          className="xl:col-span-7"
        />
        <div className="xl:col-span-5 grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-5">
          {showProfit && (
            <StatCard tone={m.today.profit! < 0 ? "danger" : "success"} label="Net profit" value={fmtMoney(m.today.profit!, currency)}
              icon={TrendingUp} change={m.today.deltas.profit ?? 0} hint="after expenses" />
          )}
          <StatCard tone="neutral" label="Transactions" value={String(m.today.txns)} icon={ShoppingCart} change={m.today.deltas.txns} hint="today" />
          <StatCard tone="warning" label="Average sale" value={fmtMoney(m.today.txns > 0 ? m.today.revenue / m.today.txns : 0, currency)} icon={Receipt} hint="per transaction" />
          <StatCard label="Last 7 days" value={fmtMoney(m.week.revenue, currency)} icon={CalendarClock} change={m.week.deltaPct} hint="vs the week before" />
        </div>
        <PaymentStrip split={m.paymentSplit} currency={currency} className="xl:col-span-12" />
      </div>

      {/* Detail on the left, things wanting attention on the right. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <TopMovingProducts products={m.topProducts} currency={currency} onViewAll={() => animateSwitch("tab", () => setTab("inventory"))} />
          <LiveFeed sales={m.recentSales} currency={currency} />
        </div>

        <div className="space-y-4">
          {hasFeature("ai") && <AiInsightsCard />}
          <AlertsPanel lowStock={m.lowStock} />
        </div>
      </div>
      </>
      )}
      </div>
      <ProductTour steps={buildDashboardTour(typeMeta(activeBusiness?.typeKey))} open={tourOpen} onClose={closeTour} />
    </div>
  );
}


// ── Overview components ──────────────────────────────────────

// The day's revenue, large, on the brand gradient with the week drawn
// underneath it. This is the one number the owner opens the dashboard for.
function RevenueHero({ value, delta, series, currency, className }: {
  value: string; delta: number; series: { d: string; v: number }[]; currency: string; className?: string;
}) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-[22px] text-white flex flex-col", className)}
      style={{ background: "linear-gradient(115deg, #1d1f9e 0%, #3538f0 48%, #7b3cf5 100%)", boxShadow: "0 24px 48px -22px rgba(53, 56, 240, 0.65)" }}
    >
      <div className="relative px-7 pt-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-white/75">Revenue today</div>
          <div className="mt-2 font-mono font-bold text-[44px] leading-none tracking-[-0.03em] truncate">{value}</div>
          <div className="mt-3 flex items-center gap-2 text-[12.5px] text-white/75">
            <DeltaChip value={delta} onDark />
            <span>{delta === 0 ? "same as yesterday" : "vs yesterday"}</span>
          </div>
        </div>
        <span className="grid place-items-center w-11 h-11 rounded-2xl bg-white/15 shrink-0">
          <Wallet className="w-5 h-5" strokeWidth={1.8} />
        </span>
      </div>
      <div className="relative mt-4 h-[120px] flex-1 min-h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="d" tickLine={false} axisLine={false} tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }} interval={0} padding={{ left: 28, right: 28 }} />
            <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: "rgba(255,255,255,0.4)", strokeDasharray: "4 4" }} />
            <Area type="monotone" dataKey="v" stroke="#fff" strokeWidth={2.5} fill="url(#hero-fill)" dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#3538f0", fill: "#fff" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// How today's money arrived, as one segmented bar with its legend beside it.
function PaymentStrip({ split, currency, className }: { split: Record<string, number>; currency: string; className?: string }) {
  const entries = Object.entries(split).filter(([, v]) => v > 0);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  return (
    <Card className={cn("px-6 py-5 flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-8", className)}>
      <div className="shrink-0">
        <div className="text-[15px] font-bold text-t1">How customers paid</div>
        <div className="text-[12.5px] text-t3">Today, by payment method</div>
      </div>
      {total === 0 ? (
        <div className="text-[12.5px] text-t3 lg:ml-auto">No sales yet today.</div>
      ) : (
        <>
          <div className="flex h-3 rounded-full overflow-hidden bg-surface-3 flex-1 min-w-[160px] gap-[3px]">
            {entries.map(([k, v]) => (
              <span key={k} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(v / total) * 100}%`, background: PAY_COLORS[k] }} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 shrink-0">
            {entries.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PAY_COLORS[k] }} />
                <div className="leading-tight">
                  <div className="text-[12.5px] font-semibold text-t1">{PAY_LABELS[k] ?? k} <span className="text-t3 font-medium">{Math.round((v / total) * 100)}%</span></div>
                  <div className="text-[11.5px] font-mono text-t3">{fmtMoney(v, currency)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// A numbered badge for ranked lists. The podium places get warm metals.
function Rank({ n }: { n: number }) {
  const podium = ["linear-gradient(135deg,#cc9933,#ecbb55)", "linear-gradient(135deg,#8a90ad,#bcc1d6)", "linear-gradient(135deg,#a8683a,#d49a6a)"];
  return n <= 3 ? (
    <span className="grid place-items-center w-6 h-6 rounded-full text-white text-[11px] font-bold shrink-0" style={{ background: podium[n - 1] }}>{n}</span>
  ) : (
    <span className="grid place-items-center w-6 h-6 rounded-full bg-surface-3 text-t3 text-[11px] font-bold shrink-0">{n}</span>
  );
}

// A small round monogram for a person.
function Monogram({ name, size = 8 }: { name: string; size?: 7 | 8 | 9 }) {
  const dim = size === 7 ? "w-7 h-7 text-[11px]" : size === 9 ? "w-9 h-9 text-[13px]" : "w-8 h-8 text-[12px]";
  return (
    <span className={cn("grid place-items-center rounded-full bg-primary-soft text-primary font-bold shrink-0", dim)}>
      {name[0]?.toUpperCase()}
    </span>
  );
}

const EMPTY = "py-8 text-center text-[12.5px] text-t3";

// The design's "Top Moving Products" table. The last column shows each
// product's share of the best seller, which is a real comparison, rather than
// a sparkline we have no per-product history to draw.
function TopMovingProducts({ products, currency, onViewAll }: {
  products: { id: string; name: string; sold: number; revenue: number }[];
  currency: string;
  onViewAll: () => void;
}) {
  const max = products[0]?.revenue || 1;
  return (
    <Panel
      flush
      icon={Package}
      title="Top moving products"
      subtitle="Best sellers by revenue, last 7 days"
      action={<button onClick={onViewAll} className="text-[12.5px] font-bold text-primary hover:underline">View all</button>}
    >
      {products.length === 0 ? (
        <div className={EMPTY}>Sales data builds this list.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[520px]">
            <thead>
              <tr>
                <TH>Product</TH>
                <TH className="text-right">Qty sold</TH>
                <TH className="text-right">Revenue</TH>
                <TH>Share</TH>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <TR key={p.id}>
                  <TD className="max-w-[240px]">
                    <span className="flex items-center gap-3 font-semibold truncate"><Rank n={i + 1} />{p.name}</span>
                  </TD>
                  <TD className="text-right font-mono text-t2">{p.sold}</TD>
                  <TD className="text-right font-mono font-bold">{fmtMoney(p.revenue, currency)}</TD>
                  <TD className="w-[130px]">
                    <span className="block h-[6px] rounded-full bg-surface-3 overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(5, (p.revenue / max) * 100)}%`, background: "var(--st-gradient-primary)" }} />
                    </span>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

// On-demand, not auto-fired on load — an AI request costs something, so a
// visit to the dashboard shouldn't spend one just by landing here.
function AiInsightsCard() {
  const [state, setState] = useState<"idle" | "loading" | "off" | "error" | "done">("idle");
  const [narrative, setNarrative] = useState("");

  async function generate() {
    setState("loading");
    try {
      const r = await api<{ enabled: boolean; ok?: boolean; narrative?: string }>("/ai/digest");
      if (!r.enabled) { setState("off"); return; }
      if (!r.ok || !r.narrative) { setState("error"); return; }
      setNarrative(r.narrative);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <Panel icon={Sparkles} title="AI insights" subtitle="A plain-English read on today">
      {state === "idle" && (
        <button onClick={generate} className="bg-primary text-white w-full flex items-center justify-center gap-1.5 h-10 rounded-xl text-[13px] font-bold">
          <Sparkles className="w-4 h-4" /> Generate today's summary
        </button>
      )}
      {state === "loading" && <div className="flex items-center justify-center gap-2 py-3 text-[12.5px] text-t3"><TypingDots /> Reading today's numbers</div>}
      {state === "off" && <div className="text-[12.5px] text-t3 text-center py-2">AI isn't set up on this server yet.</div>}
      {state === "error" && (
        <div className="text-[12.5px] text-t3 text-center py-2">
          Couldn't generate an insight right now.{" "}
          <button onClick={generate} className="text-primary font-bold hover:underline">Try again</button>
        </div>
      )}
      {state === "done" && (
        <>
          <div className="rounded-2xl bg-primary-softer border border-primary/15 px-4 py-3.5">
            <AiText text={narrative} />
          </div>
          <button onClick={generate} className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-primary hover:underline">
            <RotateCcw className="w-3.5 h-3.5" /> Regenerate
          </button>
        </>
      )}
    </Panel>
  );
}

// Severity is carried by the chip AND the left stripe, so the urgent rows
// read before any of the words do.
function AlertsPanel({ lowStock }: { lowStock: { id: string; name: string; stock: number; reorderLevel: number }[] }) {
  return (
    <Panel
      flush
      icon={AlertTriangle}
      tone="warning"
      title="Stock alerts"
      subtitle={lowStock.length ? "Running low at this branch" : "Nothing needs reordering"}
      action={lowStock.length > 0 ? <Badge tone="warning">{lowStock.length}</Badge> : undefined}
    >
      {lowStock.length === 0 ? (
        <div className={cn(EMPTY, "flex items-center justify-center gap-1.5")}>
          <Package className="w-3.5 h-3.5" /> All stocked up.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {lowStock.map((s) => {
            const out = s.stock <= 0;
            return (
              <div key={s.id} className={cn("flex items-center gap-3 px-5 py-3 border-l-[3px]", out ? "border-l-danger" : "border-l-warning")}>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-t1 truncate">{s.name}</div>
                  <div className="text-[11.5px] text-t3 mt-0.5">{s.stock} left · reorder at {s.reorderLevel}</div>
                </div>
                <Badge tone={out ? "danger" : "warning"}>{out ? "Out" : "Low"}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// The most recent sales, newest first — the design's "Live Feed".
function LiveFeed({ sales, currency }: {
  sales: { id: string; saleNo: string; at: string; staffName: string; total: number; status: string }[];
  currency: string;
}) {
  return (
    <Panel
      flush
      icon={Receipt}
      title="Live feed"
      subtitle="Newest sales first"
      action={
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-success">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> Live
        </span>
      }
    >
      {sales.length === 0 ? (
        <div className={EMPTY}>Sales appear here as they happen.</div>
      ) : (
        <div className="divide-y divide-line">
          {sales.slice(0, 6).map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-5 py-3">
              <Monogram name={s.staffName || "?"} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-t1 font-mono">{s.saleNo}</div>
                <div className="text-[11.5px] text-t3 truncate">{fmtTime(s.at)} · {s.staffName}</div>
              </div>
              <span className={cn("shrink-0 font-mono font-bold text-[13px]", s.status === "voided" ? "text-t4 line-through" : "text-t1")}>
                {fmtMoney(s.total, currency)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Sales tab ────────────────────────────────────────────────
type SalesReport = {
  days: number;
  totals: { revenue: number; txns: number; avgSale: number; profit?: number; expenses?: number };
  series: { date: string; revenue: number }[];
  byStaff: { name: string; sales: number; revenue: number }[];
  byCategory: { category: string; sold: number; revenue: number }[];
  byMethod: { method: string; amount: number }[];
};

// Labelled bars, widest first. Used wherever a total is split into parts.
function BarList({ rows, currency }: { rows: { label: string; sub: string; value: number }[]; currency: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-t1 truncate">{r.label}</div>
              {r.sub && <div className="text-[11.5px] text-t3">{r.sub}</div>}
            </div>
            <div className="font-mono text-[13px] font-bold text-t1 shrink-0">{fmtMoney(r.value, currency)}</div>
          </div>
          <div className="mt-2 h-[6px] rounded-full bg-surface-3 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(4, (r.value / max) * 100)}%`, background: "var(--st-gradient-primary)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SalesTab({ currency, branchKey }: { currency: string; branchKey?: string }) {
  const { data: r, loading } = useApi<SalesReport>("/metrics/sales-report?days=30", [branchKey]);
  if (loading || !r) return <Spinner />;

  const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
  const series = r.series.map((s) => ({ d: dayLabel(s.date), v: s.revenue }));
  const showProfit = r.totals.profit !== undefined;

  return (
    <div className="space-y-5">
      <div className={cn("grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-5", showProfit ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
        <StatCard label={`Revenue · ${r.days} days`} value={fmtMoney(r.totals.revenue, currency)} icon={Wallet} spark={r.series.map((s) => s.revenue)} />
        <StatCard tone="neutral" label="Transactions" value={String(r.totals.txns)} icon={ShoppingCart} hint={`over ${r.days} days`} />
        <StatCard tone="warning" label="Average sale" value={fmtMoney(r.totals.avgSale, currency)} icon={Receipt} hint="per transaction" />
        {showProfit && (
          <StatCard tone={r.totals.profit! < 0 ? "danger" : "success"} label="Profit after expenses" value={fmtMoney(r.totals.profit!, currency)} icon={TrendingUp} hint={r.totals.profit! < 0 ? "a loss for the period" : "kept after costs"} />
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Panel className="xl:col-span-2" icon={TrendingUp} title="Revenue trend" subtitle={`Daily, last ${r.days} days`}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="rev30" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="d" tickLine={false} axisLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} width={52} tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                  tickFormatter={(v) => (v >= 1000 ? `${currency}${Math.round(v / 1000)}k` : `${currency}${v}`)} />
                <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: "var(--chart-1)", strokeWidth: 1, strokeDasharray: "4 4" }} />
                <Area type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#rev30)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel icon={Wallet} title="How they paid" subtitle="By payment method">
          {r.byMethod.length === 0 ? (
            <div className={EMPTY}>No payments in this window.</div>
          ) : (
            <BarList currency={currency} rows={r.byMethod.map((m) => ({ label: PAY_LABELS[m.method] || m.method, sub: "", value: m.amount }))} />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel icon={UserCog} title="By staff" subtitle="Who rang up the sales">
          {r.byStaff.length === 0 ? (
            <div className={EMPTY}>No sales in this window.</div>
          ) : (
            <BarList currency={currency} rows={r.byStaff.map((s) => ({ label: s.name, sub: `${s.sales} sales`, value: s.revenue }))} />
          )}
        </Panel>
        <Panel icon={Boxes} title="By category" subtitle="What sold">
          {r.byCategory.length === 0 ? (
            <div className={EMPTY}>No sales in this window.</div>
          ) : (
            <BarList currency={currency} rows={r.byCategory.map((c) => ({ label: c.category, sub: `${c.sold} sold`, value: c.revenue }))} />
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Expenses tab ─────────────────────────────────────────────
type ExpenseRow = { id: string; type: string; amount: number; notes: string; paidBy: string; actorName: string; at: string };

function ExpensesTab({ currency, branchKey }: { currency: string; branchKey?: string }) {
  const from = todayStr().slice(0, 8) + "01"; // this month
  const { data: r, loading } = useApi<{ expenses: ExpenseRow[]; total: number }>(
    `/expenses?from=${from}&to=${todayStr()}`,
    [branchKey]
  );
  if (loading || !r) return <Spinner />;

  const byType = new Map<string, number>();
  for (const e of r.expenses) byType.set(e.type, (byType.get(e.type) || 0) + e.amount);
  const typeRows = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const biggest = typeRows[0];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5">
        <StatCard tone="danger" label="Spent this month" value={fmtMoney(r.total, currency)} icon={ReceiptText} />
        <StatCard tone="neutral" label="Entries" value={String(r.expenses.length)} icon={Receipt} hint="recorded this month" />
        <StatCard tone="warning" label={biggest ? `Biggest: ${biggest[0]}` : "Biggest category"} value={biggest ? fmtMoney(biggest[1], currency) : "—"} icon={TrendingUp} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Panel className="xl:col-span-2" icon={ReceiptText} tone="danger" title="By type" subtitle="This month">
          {typeRows.length === 0 ? (
            <div className={EMPTY}>No expenses recorded this month.</div>
          ) : (
            <BarList currency={currency} rows={typeRows.map(([type, amount]) => ({ label: type, sub: "", value: amount }))} />
          )}
        </Panel>
        <Panel className="xl:col-span-3" flush icon={Receipt} title="Recent entries" subtitle="Newest first">
          {r.expenses.length === 0 ? (
            <div className={EMPTY}>Record expenses on the Expenses page.</div>
          ) : (
            <div className="divide-y divide-line">
              {r.expenses.slice(0, 8).map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid place-items-center w-9 h-9 rounded-xl bg-danger-soft text-danger shrink-0">
                    <ReceiptText className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-t1">{e.type}</div>
                    <div className="text-[11.5px] text-t3 truncate">{e.actorName} · {fmtDate(e.at)}</div>
                  </div>
                  <span className="font-mono text-[13px] font-bold text-t1 shrink-0">{fmtMoney(e.amount, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Movement tab ─────────────────────────────────────────────
type MovementRow = {
  id: string; productName: string; type: string; qty: number; balanceAfter: number;
  reason: string; actorName: string; at: string;
};

const MOVE_META: Record<string, { label: string; icon: any; tone: "success" | "danger" | "brand" | "warning" | "neutral" }> = {
  IN: { label: "Stock in", icon: ArrowDownToLine, tone: "success" },
  OUT: { label: "Sale", icon: ArrowUpFromLine, tone: "neutral" },
  TRANSFER_IN: { label: "Transfer in", icon: ArrowLeftRight, tone: "brand" },
  TRANSFER_OUT: { label: "Transfer out", icon: ArrowLeftRight, tone: "warning" },
  RETURN: { label: "Return", icon: Undo2, tone: "brand" },
  ADJUST: { label: "Adjustment", icon: Wrench, tone: "warning" },
  VOID_RESTOCK: { label: "Void restock", icon: RotateCcw, tone: "danger" },
};

function MovementTab({ branchKey }: { branchKey?: string }) {
  const [type, setType] = useState("");
  const { data, loading } = useApi<{ movements: MovementRow[] }>(
    `/inventory/movements?limit=60${type ? `&type=${type}` : ""}`,
    [branchKey, type]
  );
  const paged = usePaged(data?.movements || []);

  const FILTERS = [
    { key: "", label: "All" },
    { key: "IN", label: "Stock in" },
    { key: "OUT", label: "Sales" },
    { key: "TRANSFER_OUT", label: "Transfers" },
    { key: "RETURN", label: "Returns" },
    { key: "ADJUST", label: "Adjustments" },
  ];

  return (
    <Panel
      flush
      icon={ArrowLeftRight}
      title="Inventory movement"
      subtitle="Every unit in and out — the ledger, newest first"
      action={
        <div className="flex gap-1 p-1 rounded-xl bg-surface-3 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setType(f.key)}
              className={cn(
                "px-3 h-7 rounded-lg text-[12px] font-bold transition-colors",
                type === f.key ? "bg-surface text-primary shadow-e1" : "text-t3 hover:text-t1"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <Spinner />
      ) : !data?.movements.length ? (
        <EmptyState icon={ArrowLeftRight} title="No movements" body="Stock-ins, sales, transfers and adjustments appear here as they happen." />
      ) : (
        <div className="divide-y divide-line">
          {paged.rows.map((m) => {
            const meta = MOVE_META[m.type] || MOVE_META.ADJUST;
            const Icon = meta.icon;
            return (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                <span className={cn("grid place-items-center w-9 h-9 rounded-xl shrink-0", m.qty > 0 ? "bg-success-soft text-success" : "bg-surface-3 text-t3")}>
                  <Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-t1 truncate">{m.productName}</div>
                  <div className="text-[11.5px] text-t3 truncate flex items-center gap-1.5">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="truncate">{m.reason && `${m.reason} · `}{m.actorName} · {fmtDateTime(m.at)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={cn("font-mono text-[14px] font-bold", m.qty > 0 ? "text-success" : "text-t1")}>
                    {m.qty > 0 ? "+" : ""}{m.qty}
                  </div>
                  <div className="text-[11px] text-t3 font-mono">balance {m.balanceAfter}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Pager {...paged} onPage={paged.setPage} noun="movements" />
    </Panel>
  );
}

// ── Expiry tab ───────────────────────────────────────────────
function ExpiryTab({ branchKey }: { branchKey?: string }) {
  const { data: r, loading } = useApi<{ expiringSoon: { id: string; name: string; stock: number; expiry: string; expired: boolean }[] }>(
    "/metrics/inventory-report",
    [branchKey]
  );
  const paged = usePaged(r?.expiringSoon || []);
  if (loading || !r) return <Spinner />;
  const expired = r.expiringSoon.filter((e) => e.expired);
  const soon = r.expiringSoon.filter((e) => !e.expired);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5">
        <StatCard tone="danger" label="Already expired" value={String(expired.length)} icon={AlertTriangle} hint="still in stock" />
        <StatCard tone="warning" label="Expiring within 30 days" value={String(soon.length)} icon={CalendarClock} hint="sell or move these first" />
      </div>
      <Panel flush icon={CalendarClock} tone="warning" title="Expiry watchlist" subtitle="Soonest first">
        {r.expiringSoon.length === 0 ? (
          <EmptyState icon={CalendarClock} title="Nothing on the watchlist" body="Products with an expiry date within 30 days (and any already expired with stock left) appear here. Set expiry dates when adding or editing products." />
        ) : (
          <div className="divide-y divide-line">
            {paged.rows.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                <span className={cn("grid place-items-center w-9 h-9 rounded-xl shrink-0", e.expired ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
                  <CalendarClock className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-t1 truncate">{e.name}</div>
                  <div className="text-[11.5px] text-t3">{e.stock} in stock</div>
                </div>
                <Badge tone={e.expired ? "danger" : "warning"}>{e.expired ? "Expired" : `Expires ${fmtDate(e.expiry)}`}</Badge>
              </div>
            ))}
          </div>
        )}
        <Pager {...paged} onPage={paged.setPage} noun="items" />
      </Panel>
    </div>
  );
}

// ── Customers tab ────────────────────────────────────────────
type CustomersReport = {
  totals: { customers: number; newLast30: number; activeLast30: number; repeatRate: number };
  topSpenders: { id: string; name: string; phone: string; totalSpend: number; visits: number }[];
  newest: { id: string; name: string; phone: string; totalSpend: number; visits: number; firstSeen: string }[];
};

function CustomersTab({ currency, branchKey }: { currency: string; branchKey?: string }) {
  const { data: r, loading } = useApi<CustomersReport>("/metrics/customers-report", [branchKey]);
  if (loading || !r) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-5">
        <StatCard label="Customers on file" value={String(r.totals.customers)} icon={Users} />
        <StatCard tone="success" label="New · last 30 days" value={String(r.totals.newLast30)} icon={Users} hint="first-time customers" />
        <StatCard tone="neutral" label="Active · last 30 days" value={String(r.totals.activeLast30)} icon={ShoppingCart} hint="bought recently" />
        <StatCard tone="warning" label="Come back to buy again" value={`${r.totals.repeatRate}%`} icon={TrendingUp} hint="repeat rate" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel flush icon={TrendingUp} tone="warning" title="Top spenders" subtitle="Highest lifetime spend">
          {r.topSpenders.length === 0 ? (
            <div className={EMPTY}>Attach customers on the POS to build this list.</div>
          ) : (
            <div className="divide-y divide-line">
              {r.topSpenders.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <Rank n={i + 1} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-t1 truncate">{c.name}</div>
                    <div className="text-[11.5px] text-t3">{c.phone || "no phone"} · {c.visits} visit{c.visits === 1 ? "" : "s"}</div>
                  </div>
                  <span className="font-mono text-[13px] font-bold text-t1 shrink-0">{fmtMoney(c.totalSpend, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel flush icon={Users} tone="success" title="Newest customers" subtitle="Most recently added">
          {r.newest.length === 0 ? (
            <div className={EMPTY}>New customers appear here as they're added.</div>
          ) : (
            <div className="divide-y divide-line">
              {r.newest.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <Monogram name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-t1 truncate">{c.name}</div>
                    <div className="text-[11.5px] text-t3">first seen {new Date(c.firstSeen).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</div>
                  </div>
                  <span className="font-mono text-[12.5px] text-t2 shrink-0">{fmtMoney(c.totalSpend, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Staff tab ────────────────────────────────────────────────
type StaffReport = {
  days: number;
  staff: { name: string; sales: number; voids: number; revenue: number; discounts: number; avgSale: number; hours: number; shifts: number }[];
};

function StaffTab({ currency, branchKey }: { currency: string; branchKey?: string }) {
  const { data: r, loading } = useApi<StaffReport>("/metrics/staff-report", [branchKey]);
  const paged = usePaged(r?.staff || []);
  if (loading || !r) return <Spinner />;

  const totalRevenue = r.staff.reduce((s, x) => s + x.revenue, 0);
  const totalSales = r.staff.reduce((s, x) => s + x.sales, 0);
  const totalHours = r.staff.reduce((s, x) => s + x.hours, 0);
  const totalVoids = r.staff.reduce((s, x) => s + x.voids, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-5">
        <StatCard label="Team with activity" value={String(r.staff.length)} icon={UserCog} hint={`last ${r.days} days`} />
        <StatCard tone="success" label="Revenue rung up" value={fmtMoney(totalRevenue, currency)} icon={Wallet} hint={`${totalSales} sales`} />
        <StatCard tone="neutral" label="Hours worked" value={totalHours ? `${totalHours.toFixed(1)}h` : "—"} icon={CalendarClock} hint="clocked in" />
        <StatCard tone={totalVoids ? "danger" : "neutral"} label="Voided sales" value={String(totalVoids)} icon={Undo2} hint={totalVoids ? "worth a look" : "none — clean record"} />
      </div>

      <Panel flush icon={UserCog} title={`Staff performance · last ${r.days} days`} subtitle="Sales, discounts given, voids and hours — per person">
        {r.staff.length === 0 ? (
          <EmptyState icon={UserCog} title="No staff activity yet" body="Sales and clock-ins over the last 30 days appear here per person." />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <thead>
                <tr>
                  <TH>Staff</TH>
                  <TH className="text-right">Sales</TH>
                  <TH className="text-right">Revenue</TH>
                  <TH className="text-right">Avg sale</TH>
                  <TH className="text-right">Discounts</TH>
                  <TH className="text-right">Voids</TH>
                  <TH className="text-right">Hours</TH>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((s) => (
                  <TR key={s.name}>
                    <TD>
                      <span className="inline-flex items-center gap-3 font-semibold"><Monogram name={s.name} size={7} />{s.name}</span>
                    </TD>
                    <TD className="text-right font-mono">{s.sales}</TD>
                    <TD className="text-right font-mono font-bold">{fmtMoney(s.revenue, currency)}</TD>
                    <TD className="text-right font-mono text-[12.5px] text-t2">{s.avgSale ? fmtMoney(s.avgSale, currency) : "—"}</TD>
                    <TD className="text-right font-mono text-[12.5px] text-t2">{s.discounts ? fmtMoney(s.discounts, currency) : "—"}</TD>
                    <TD className="text-right">
                      {s.voids > 0 ? <Badge tone="danger">{s.voids}</Badge> : <span className="text-[12.5px] text-t4">0</span>}
                    </TD>
                    <TD className="text-right font-mono text-[12.5px] text-t2">{s.hours ? `${s.hours.toFixed(1)}h` : "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <Pager {...paged} onPage={paged.setPage} noun="staff" />
      </Panel>
    </div>
  );
}

// ── Inventory tab ────────────────────────────────────────────
type InventoryReport = {
  skus: number; units: number; retailValue: number; costValue?: number; potentialProfit?: number;
  flow30d: { unitsIn: number; unitsOut: number };
  turnover: number;
  topMovers: { id: string; name: string; unitsIn: number; unitsOut: number }[];
  lowStock: { id: string; name: string; stock: number; reorderLevel: number }[];
  expiringSoon: { id: string; name: string; stock: number; expiry: string; expired: boolean }[];
};

function InventoryTab({ currency, branchKey }: { currency: string; branchKey?: string }) {
  const { hasModule } = useSession();
  const { data: r, loading } = useApi<InventoryReport>("/metrics/inventory-report", [branchKey]);
  if (loading || !r) return <Spinner />;

  const showCost = r.costValue !== undefined;
  const showExpiry = hasModule("expiry");

  return (
    <div className="space-y-5">
      <div className={cn("grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-5", showCost ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
        <StatCard label="Products in catalog" value={String(r.skus)} icon={Boxes} />
        <StatCard tone="neutral" label="Units on shelf" value={r.units.toLocaleString()} icon={Package} hint={`${r.turnover}× turnover`} />
        <StatCard tone="warning" label="Stock value (retail)" value={fmtMoney(r.retailValue, currency)} icon={Wallet} />
        {showCost && <StatCard tone="success" label="Profit sitting on the shelf" value={fmtMoney(r.potentialProfit!, currency)} icon={TrendingUp} hint="if it all sells" />}
      </div>

      {/* In & Out — the flow through the shelf, last 30 days */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Panel icon={ArrowLeftRight} title="In & out" subtitle="Last 30 days">
          <div className="grid grid-cols-2 xl:grid-cols-1 gap-3">
            <div className="rounded-2xl bg-success-soft px-4 py-4">
              <ArrowDownToLine className="w-[18px] h-[18px] text-success" />
              <div className="mt-3 font-mono text-[26px] font-bold text-success leading-none">{r.flow30d.unitsIn.toLocaleString()}</div>
              <div className="text-[12px] font-semibold text-t2 mt-1.5">units came in</div>
              <div className="text-[11.5px] text-t3">stock-ins, returns, transfers in</div>
            </div>
            <div className="rounded-2xl bg-surface-3 px-4 py-4">
              <ArrowUpFromLine className="w-[18px] h-[18px] text-t2" />
              <div className="mt-3 font-mono text-[26px] font-bold text-t1 leading-none">{r.flow30d.unitsOut.toLocaleString()}</div>
              <div className="text-[12px] font-semibold text-t2 mt-1.5">units went out</div>
              <div className="text-[11.5px] text-t3">sales, transfers out</div>
            </div>
          </div>
        </Panel>
        <Panel className="xl:col-span-2" icon={TrendingUp} title="Fastest movers" subtitle="Units out, last 30 days">
          {r.topMovers.length === 0 ? (
            <div className={EMPTY}>Movement builds this list as you sell and restock.</div>
          ) : (
            <ul className="space-y-4">
              {r.topMovers.slice(0, 6).map((m, i) => {
                const max = r.topMovers[0].unitsOut || 1;
                return (
                  <li key={m.id}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-3 min-w-0 text-[13px] font-semibold text-t1 truncate"><Rank n={i + 1} />{m.name}</span>
                      <span className="text-[12px] font-mono text-t3 shrink-0">
                        <span className="text-success font-bold">+{m.unitsIn}</span> in · <span className="text-t1 font-bold">−{m.unitsOut}</span> out
                      </span>
                    </div>
                    <div className="mt-2 ml-9 h-[6px] rounded-full bg-surface-3 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, (m.unitsOut / max) * 100)}%`, background: "var(--st-gradient-primary)" }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className={cn("grid grid-cols-1 gap-5", showExpiry && "lg:grid-cols-2")}>
        <Panel
          flush
          icon={AlertTriangle}
          tone="warning"
          title="Needs reordering"
          subtitle="At or below the reorder level"
          action={r.lowStock.length > 0 ? <Badge tone="warning">{r.lowStock.length}</Badge> : undefined}
        >
          {r.lowStock.length === 0 ? (
            <div className={EMPTY}>Everything is above its reorder level.</div>
          ) : (
            <div className="divide-y divide-line">
              {r.lowStock.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-t1 truncate">{s.name}</div>
                    <div className="text-[11.5px] text-t3">reorder at {s.reorderLevel}</div>
                  </div>
                  <Badge tone={s.stock === 0 ? "danger" : "warning"}>{s.stock === 0 ? "Out of stock" : `${s.stock} left`}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {showExpiry && (
          <Panel
            flush
            icon={CalendarClock}
            tone="danger"
            title="Expiring within 30 days"
            subtitle="Sell or move these first"
            action={r.expiringSoon.length > 0 ? <Badge tone="danger">{r.expiringSoon.length}</Badge> : undefined}
          >
            {r.expiringSoon.length === 0 ? (
              <div className={EMPTY}>Nothing close to expiry. Set expiry dates on products to track this.</div>
            ) : (
              <div className="divide-y divide-line">
                {r.expiringSoon.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-t1 truncate">{s.name}</div>
                      <div className="text-[11.5px] text-t3">{s.stock} in stock</div>
                    </div>
                    <Badge tone={s.expired ? "danger" : "warning"}>
                      {s.expired ? "Expired" : new Date(s.expiry).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

// ── Profit & Loss tab ────────────────────────────────────────
type FinanceTotals = {
  revenue: number; vat: number; netSales: number; cogs: number; grossProfit: number; waste: number;
  expenses: number; netProfit: number; refunds: number; txns: number; grossMargin: number; netMargin: number;
};
type FinanceReport = {
  period: string; from: string; to: string;
  current: FinanceTotals; previous: FinanceTotals;
  trendBy: "day" | "month";
  trend: { key: string; revenue: number; cogs: number; expenses: number; netProfit: number }[];
  expensesByType: { type: string; amount: number; count: number }[];
  stock: { purchases: number; deliveries: number; valueAtCost: number; valueAtPrice: number };
};
type FinPeriod = "today" | "week" | "month" | "year";
const FIN_PERIODS = [["today", "Today"], ["week", "Last 7 days"], ["month", "This month"], ["year", "This year"]] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const changePct = (now: number, before: number) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : 0);

function FinanceTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-surface border border-line-2 shadow-e2 px-3 py-2 space-y-1">
      <div className="text-[11px] font-semibold text-t3">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-[12.5px]">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-t2">{p.name}</span>
          <span className="ml-auto pl-3 font-mono font-semibold text-t1">{fmtMoney(p.value, currency)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The money view: what came in, what it cost, and what is left. Every figure
 * comes from the server's own daily totals (see buildFinanceReport), so it
 * matches the sales list, returns and expenses exactly.
 */
function ProfitTab({ currency, branchKey }: { currency: string; branchKey?: string }) {
  const [period, setPeriod] = useState<FinPeriod>("month");
  const { data: r, loading, error } = useApi<FinanceReport>(`/metrics/finance?period=${period}`, [branchKey, period]);
  const money = (n: number) => fmtMoney(n, currency);
  const periodName = FIN_PERIODS.find(([k]) => k === period)?.[1];
  const vs = period === "today" ? "compared with yesterday" : period === "year" ? "compared with the same time last year" : period === "month" ? "compared with the same days last month" : "compared with the 7 days before";

  const picker = (
    <div className="flex items-center gap-3 flex-wrap">
      <Segmented options={FIN_PERIODS} value={period} onChange={setPeriod} />
      {r && <span className="text-[12.5px] text-t3">{r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} to ${fmtDate(r.to)}`}, {vs}</span>}
    </div>
  );
  if (error) return <div className="space-y-5">{picker}<Card><EmptyState icon={TrendingUp} title="Couldn't load profit and loss" body={error} /></Card></div>;
  if (loading || !r) return <div className="space-y-5">{picker}<Spinner /></div>;

  const c = r.current, p = r.previous;
  const lines: { label: string; value: number; kind?: "less" | "total" | "result"; note?: string }[] = [
    { label: "Sales (after refunds)", value: c.revenue, note: c.refunds ? `${money(c.refunds)} refunded` : undefined },
    { label: "VAT collected", value: c.vat, kind: "less" },
    { label: "Net sales", value: c.netSales, kind: "total" },
    { label: "Cost of goods sold", value: c.cogs, kind: "less", note: "what the items sold cost you" },
    { label: "Gross profit", value: c.grossProfit, kind: "total", note: `${c.grossMargin}% of net sales` },
    { label: "Waste and damage", value: c.waste, kind: "less" },
    { label: "Operating expenses", value: c.expenses, kind: "less" },
    { label: c.netProfit < 0 ? "Net loss" : "Net profit", value: c.netProfit, kind: "result", note: `${c.netMargin}% of net sales` },
  ];
  const chart = r.trend.map((t) => ({ ...t, label: r.trendBy === "month" ? MONTHS[Number(t.key.slice(5, 7)) - 1] : dayLabel(t.key) }));
  const quiet = c.txns === 0 && c.expenses === 0;
  const dot = chart.length <= 12 ? { r: 4, strokeWidth: 2, fill: "var(--color-surface)" } : false;

  return (
    <div className="space-y-5">
      {picker}

      <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-5">
        <StatCard label="Sales" value={money(c.revenue)} icon={Wallet} change={changePct(c.revenue, p.revenue)} hint={`${c.txns} ${c.txns === 1 ? "sale" : "sales"}`} />
        <StatCard tone="warning" label="Cost of goods sold" value={money(c.cogs)} icon={Package} hint="cost of the items sold" />
        <StatCard tone="danger" label="Expenses" value={money(c.expenses + c.waste)} icon={ReceiptText} hint={c.waste ? `includes ${money(c.waste)} waste` : "rent, fuel, salaries and more"} />
        <StatCard tone={c.netProfit < 0 ? "danger" : "success"} label={c.netProfit < 0 ? "Net loss" : "Net profit"} value={money(c.netProfit)} icon={TrendingUp}
          change={changePct(c.netProfit, p.netProfit)} hint={`${c.netMargin}% margin`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Panel className="xl:col-span-2" icon={Receipt} title="Profit and loss" subtitle={periodName}>
          <dl className="text-[13px]">
            {lines.map((l) => (
              <div key={l.label} className={cn("flex items-baseline justify-between gap-3 py-2",
                l.kind === "total" && "border-t border-line font-semibold",
                l.kind === "result" && "border-t-2 border-line-2 mt-1 pt-3 font-bold text-[14.5px]")}>
                <dt className={cn("min-w-0", l.kind === "less" ? "text-t2 pl-3" : "text-t1")}>
                  {l.kind === "less" ? `Less ${l.label.startsWith("VAT") ? l.label : l.label[0].toLowerCase() + l.label.slice(1)}` : l.label}
                  {l.note && <span className="block text-[11.5px] font-normal text-t3">{l.note}</span>}
                </dt>
                <dd className={cn("font-mono tabular-nums shrink-0",
                  l.kind === "less" ? "text-t2" : "text-t1",
                  l.kind === "result" && (l.value < 0 ? "text-danger" : "text-success"))}>
                  {l.kind === "less" ? `(${money(l.value)})` : money(l.value)}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel className="xl:col-span-3" icon={TrendingUp} title="Sales and net profit" subtitle={r.trendBy === "month" ? "By month" : "By day"}>
          {quiet ? (
            <div className={EMPTY}>No sales or expenses in this period yet.</div>
          ) : (
            <div className="h-[280px]" role="img" aria-label={`Line chart of sales and net profit ${r.trendBy === "month" ? "by month" : "by day"}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--color-t3)", fontSize: 11 }} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--color-t3)", fontSize: 11 }}
                    tickFormatter={(v) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}m` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip content={<FinanceTooltip currency={currency} />} cursor={{ stroke: "var(--color-line-2)", strokeDasharray: "4 4" }} />
                  <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
                  <Line type="linear" name="Sales" dataKey="revenue" stroke="var(--chart-1)" strokeWidth={2} dot={dot} activeDot={{ r: 5 }} />
                  <Line type="linear" name="Net profit" dataKey="netProfit" stroke="var(--chart-2)" strokeWidth={2} dot={dot} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Panel className="xl:col-span-2" icon={Boxes} tone="success" title="Stock" subtitle="What you bought and what you hold">
          <dl className="text-[13px] divide-y divide-line">
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-t1">Stock bought in<span className="block text-[11.5px] text-t3">{r.stock.deliveries} {r.stock.deliveries === 1 ? "delivery" : "deliveries"} in this period</span></dt>
              <dd className="font-mono tabular-nums text-t1">{money(r.stock.purchases)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-t1">Stock on hand at cost<span className="block text-[11.5px] text-t3">what it cost you, today</span></dt>
              <dd className="font-mono tabular-nums text-t1">{money(r.stock.valueAtCost)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-t1">Stock on hand at selling price<span className="block text-[11.5px] text-t3">if it all sold at today's prices</span></dt>
              <dd className="font-mono tabular-nums text-t1">{money(r.stock.valueAtPrice)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[11.5px] text-t3">Stock you buy is not a cost until it sells. It becomes cost of goods sold as each item is sold.</p>
        </Panel>

        <Panel className="xl:col-span-3" icon={ReceiptText} tone="danger" title="Expenses by type" subtitle={periodName}>
          {r.expensesByType.length === 0 ? (
            <div className={EMPTY}>No expenses recorded in this period.</div>
          ) : (
            <BarList currency={currency} rows={r.expensesByType.map((e) => ({ label: e.type, sub: `${e.count} ${e.count === 1 ? "entry" : "entries"}`, value: e.amount }))} />
          )}
        </Panel>
      </div>
    </div>
  );
}
