import { Link, useSearchParams } from "react-router-dom";
import {
  CalendarClock, CircleSlash, LifeBuoy, ChevronRight, ArrowUpRight, Building2, Wallet, ShoppingCart, LogIn, Moon, Ban, UserX,
  CheckCircle2, LayoutDashboard, TrendingUp, UserPlus, Store, Users, Receipt, CreditCard, Clock, Inbox, Headphones, GitBranch, Hourglass, Trophy,
} from "lucide-react";
import { Spinner } from "@/components/ui/EmptyState";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AreaChart, Avatar, BarChart, Donut, EmptyBlock, KpiCard, Panel, Pill, RowButton, Segmented, naira } from "./ui";
import type { Overview } from "./types";

type Growth = { days: number; series: { date: string; signups: number; volume: number; txns: number }[] };
type SubRow = { id: string; name: string; plan: string; trial?: boolean; periodEnd?: string | null; daysLeft?: number; owner: { name: string; email: string } | null };
type Subs = {
  counts: { paid: number; trialing: number; lapsed: number; free: number; legacy: number };
  mrr: number; collected30d: number; collectedAll: number;
  expiring: SubRow[]; lapsed: SubRow[];
  payments: { accountId: string; accountName: string; plan: string; amount: number; at: string }[];
};
type Alert = { kind: "lapsed" | "tickets" | "quiet" | "suspended" | "users"; tone: "danger" | "brand" | "warning" | "neutral"; label: string; hint: string; to: string };
type Insights = {
  money: { mrr: number; collected30d: number; paid: number; trialing: number };
  businesses: { total: number; active7d: number; active30d: number; quiet: number };
  users: { active: number; suspended: number; signedIn7d: number; signedIn30d: number; owners: number; admins: number; managers: number; staff: number; platformStaff: number };
  today: { sales: number; volume: number; businesses: number };
  usage: { products: number; customers: number; invoices: number; returns30d: number; ticketsOpen: number };
  alerts: Alert[];
};
type Leaders = {
  businesses: { id: string; accountId: string; name: string; typeLabel: string; total: number; txns: number; lastSaleAt: string }[];
  trades: { typeKey: string; label: string; total: number; txns: number; businesses: number }[];
};
type DeskStats = {
  totals: {
    received: number; resolved: number; open: number; waitingOnUs: number; unassigned: number;
    medianFirstResponseHours: number | null; medianResolutionHours: number | null; answeredWithin24hPct: number | null; oldestWaitingSince: string | null;
  };
  byCategory: { key: string; count: number }[];
  byPriority: { key: string; count: number }[];
  series: { date: string; created: number; resolved: number }[];
  agents: { name: string; resolved: number; open: number }[];
};
type Recent = { accounts: { id: string; name: string; plan: string; status: string; createdAt: string; owner: { email: string } | null; businesses: { typeLabel: string }[] }[] };

const ALERT_ICON = { lapsed: CircleSlash, tickets: LifeBuoy, quiet: Moon, suspended: Ban, users: UserX } as const;
const PLAN_COLOR: Record<string, string> = { free: "#a7b3c9", pro: "#2557ad", business: "#ec782e" };
const PLAN_LABEL: Record<string, string> = { free: "Freemium", pro: "Pro", business: "Business", growth: "Growth", legacy: "Full access" };
const CATEGORY: Record<string, string> = { technical: "Not working", billing: "Plan or payment", question: "How to", complaint: "Complaint", other: "Other" };
const RANGES = ["7", "30", "90"] as const;
type Range = (typeof RANGES)[number];

const VIEWS = [
  { k: "overview", label: "Overview", icon: LayoutDashboard },
  { k: "money", label: "Money", icon: Wallet },
  { k: "trading", label: "Trading", icon: TrendingUp },
  { k: "signups", label: "Sign-ups", icon: UserPlus },
  { k: "businesses", label: "Businesses", icon: Store },
  { k: "people", label: "People", icon: Users },
  { k: "support", label: "Support", icon: LifeBuoy },
] as const;
type View = (typeof VIEWS)[number]["k"];

const toneCls = { warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", brand: "bg-primary-soft text-primary", neutral: "bg-surface-3 text-t2", success: "bg-success-soft text-success" };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
const hrs = (h: number | null) => (h == null ? "Not yet" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h} h` : `${Math.round(h / 24)} days`);
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const ViewAll = ({ to, children = "View all" }: { to: string; children?: string }) => (
  <Link to={to} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">{children} <ArrowUpRight className="w-3.5 h-3.5" /></Link>
);
const Loading = ({ h = 190 }: { h?: number }) => <div className="grid place-items-center" style={{ height: h }}><Spinner /></div>;

/** Horizontal bars for a ranked list, each bar a share of the largest. */
function Bars({ rows, color = "var(--st-gradient-primary)" }: { rows: { label: string; value: number; shown?: string }[]; color?: string }) {
  const top = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="py-8 text-center text-[12.5px] text-t3">Nothing in this range yet.</div>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-center justify-between text-[12.5px] mb-1.5">
            <span className="text-t2 font-medium truncate pr-3">{r.label}</span>
            <span className="font-semibold text-t1 tabular-nums">{r.shown ?? r.value.toLocaleString()}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(r.value ? 4 : 0, (r.value / top) * 100)}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Percentage ring, used for "trading this week". */
function Ring({ pct }: { pct: number }) {
  const r = 38, c = 2 * Math.PI * r;
  return (
    <div className="relative w-[104px] h-[104px] shrink-0">
      <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90" role="img" aria-label={`${pct}%`}>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--st-surface-3)" strokeWidth="10" />
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--st-primary)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(Math.max(pct, 2) / 100) * c} ${c}`} className="transition-[stroke-dasharray] duration-700" />
      </svg>
      <div className="absolute inset-0 grid place-items-center font-mono text-[22px] font-bold text-t1 tabular-nums">{pct}%</div>
    </div>
  );
}

/** The headline card, on the same indigo gradient as the business dashboard's revenue card. */
function VolumeHero({ growth, days, businesses }: { growth: Growth | null; days: Range; businesses: number }) {
  const series = growth?.series ?? [];
  const labels = series.map((d) => fmtDate(d.date));
  const volume = sum(series, (d) => d.volume);
  const sales = sum(series, (d) => d.txns);
  return (
    <div
      className="relative overflow-hidden rounded-[22px] text-white flex flex-col xl:col-span-7 min-h-[300px]"
      style={{ background: "var(--admin-hero)", boxShadow: "0 24px 48px -22px rgba(37, 87, 173, 0.6)" }}
    >
      <div className="relative px-7 pt-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-white/75">Sold on StarTrack, last {days} days</div>
          <div className="mt-2 font-mono font-bold text-[32px] sm:text-[44px] leading-none tracking-[-0.03em] truncate">{growth ? naira(volume) : "…"}</div>
          <div className="mt-3 text-[12.5px] text-white/75">{sales.toLocaleString()} sales across {businesses.toLocaleString()} businesses</div>
        </div>
        <span className="grid place-items-center w-11 h-11 rounded-2xl shrink-0" style={{ background: "#ec782e" }}><TrendingUp className="w-5 h-5" strokeWidth={1.8} /></span>
      </div>
      <div className="relative mt-4 px-2 pb-3 flex-1 min-h-[150px] flex flex-col justify-end">
        {growth ? (
          <>
            <AreaChart dark values={series.map((d) => d.volume)} labels={labels} color="#ffffff" format={naira} height={150} />
            <div className="flex justify-between text-[11px] text-white/65 px-3 mt-1"><span>{labels[0]}</span><span>{labels[labels.length - 1]}</span></div>
          </>
        ) : <Loading h={150} />}
      </div>
    </div>
  );
}

/** The console's front page: tabs across the top, the way the business dashboard works. */
export function OverviewTab({ ov, onOpenAccount }: { ov: Overview; onOpenAccount: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.some((v) => v.k === params.get("view")) ? (params.get("view") as View) : "overview";
  const days: Range = RANGES.includes(params.get("days") as Range) ? (params.get("days") as Range) : "30";
  const set = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set(k, v); return n; }, { replace: true });

  const { data: growth } = useApi<Growth>(`/platform/growth?days=${days}`, []);
  const { data: ins } = useApi<Insights>("/platform/insights", []);
  const { data: subs } = useApi<Subs>("/platform/subscriptions", []);
  const { data: recent } = useApi<Recent>("/platform/accounts?limit=8", []);

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-[22px] leading-7 font-semibold text-t1">{greeting()}, {ov.viewer.name.split(" ")[0]}</h1>
          <p className="text-[13px] text-t3 mt-1">Here's how StarTrack is doing across {ov.totals.businesses.toLocaleString()} businesses.</p>
        </div>
        <Segmented value={days} onChange={(v) => set("days", v)} options={RANGES.map((r) => ({ value: r, label: `${r} days` }))} />
      </div>

      <div className="flex items-center gap-1 border-b border-line max-w-full overflow-x-auto mb-6" role="tablist" aria-label="Overview sections">
        {VIEWS.map(({ k, label, icon: Icon }) => (
          <button
            key={k} role="tab" aria-selected={view === k} onClick={() => set("view", k)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-10 -mb-px border-b-2 text-[13px] font-medium transition-colors whitespace-nowrap",
              view === k ? "border-primary text-t1" : "border-transparent text-t3 hover:text-t1"
            )}
          >
            <Icon className="w-4 h-4 text-t4" strokeWidth={1.75} /> {label}
          </button>
        ))}
      </div>

      {view === "overview" && <Summary ov={ov} days={days} growth={growth} ins={ins} subs={subs} recent={recent} onOpenAccount={onOpenAccount} />}
      {view === "money" && <MoneyView subs={subs} ov={ov} onOpenAccount={onOpenAccount} />}
      {view === "trading" && <TradingView days={days} growth={growth} ins={ins} ov={ov} onOpenAccount={onOpenAccount} />}
      {view === "signups" && <SignupsView days={days} growth={growth} ov={ov} recent={recent} onOpenAccount={onOpenAccount} />}
      {view === "businesses" && <BusinessesView ov={ov} ins={ins} />}
      {view === "people" && <PeopleView ins={ins} />}
      {view === "support" && <SupportView days={days} />}
    </div>
  );
}

function PlanMix({ ov }: { ov: Overview }) {
  const segments = Object.entries(ov.byPlan).map(([k, v]) => ({ label: PLAN_LABEL[k] || k, value: v, color: PLAN_COLOR[k] || "#6f7492" }));
  const total = sum(segments, (s) => s.value);
  return (
    <Panel title="Plan mix" subtitle="Customer accounts by plan">
      <div className="flex flex-col items-center gap-4">
        <Donut size={150} segments={segments} centre={<div><div className="font-mono text-[26px] font-bold text-t1 leading-none tabular-nums">{total}</div><div className="text-[11px] text-t3 mt-1">accounts</div></div>} />
        <ul className="w-full space-y-2">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-2.5 text-[12.5px]">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-t2 flex-1 truncate">{s.label}</span>
              <span className="font-semibold text-t1 tabular-nums">{s.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function NewestCustomers({ recent, onOpenAccount, limit = 6 }: { recent: Recent | null; onOpenAccount: (id: string) => void; limit?: number }) {
  return (
    <Panel title="Newest customers" subtitle="The latest accounts to join" flush action={<ViewAll to="/admin/accounts" />}>
      {!recent ? <Loading h={160} /> : recent.accounts.length === 0 ? (
        <EmptyBlock icon={Building2} title="No customers yet" hint="New sign-ups will appear here." />
      ) : (
        <div className="divide-y divide-line">
          {recent.accounts.slice(0, limit).map((a) => (
            <RowButton key={a.id} onClick={() => onOpenAccount(a.id)} className="!py-3">
              <Avatar name={a.name} size={34} className="!rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-t1 truncate">{a.name}</div>
                <div className="text-[12px] text-t3 truncate">{a.businesses[0]?.typeLabel || a.owner?.email || ""}</div>
              </div>
              <Pill tone={a.status === "suspended" ? "danger" : "neutral"}>{a.status === "suspended" ? "Suspended" : PLAN_LABEL[a.plan] || a.plan}</Pill>
              <span className="text-[11.5px] text-t3 w-[72px] text-right hidden xl:block">{fmtDate(a.createdAt)}</span>
            </RowButton>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Overview ─────────────────────────────────────────────────

function Summary({ ov, days, growth, ins, subs, recent, onOpenAccount }: {
  ov: Overview; days: Range; growth: Growth | null; ins: Insights | null; subs: Subs | null; recent: Recent | null; onOpenAccount: (id: string) => void;
}) {
  const renewing = subs?.expiring.length ?? 0;
  const attention = [
    ...(renewing ? [{ icon: CalendarClock, tone: "warning" as const, label: `${renewing} renewing within 14 days`, hint: "A reminder now saves a lapse", to: "/admin/subscriptions" }] : []),
    ...(ins?.alerts ?? []).map((a) => ({ icon: ALERT_ICON[a.kind], tone: a.tone, label: a.label, hint: a.hint, to: `/admin/${a.to}` })),
  ];
  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 mb-5">
        <VolumeHero growth={growth} days={days} businesses={ov.totals.businesses} />
        <div className="xl:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <KpiCard icon={Wallet} tone="success" label="Income a month" value={ins ? naira(ins.money.mrr) : "…"} sub={ins ? `${naira(ins.money.collected30d)} collected in 30 days` : undefined} />
          <KpiCard icon={ShoppingCart} tone="neutral" label="Sold today" value={ins ? naira(ins.today.volume) : "…"} sub={ins ? `${ins.today.sales.toLocaleString()} sales in ${ins.today.businesses} ${ins.today.businesses === 1 ? "business" : "businesses"}` : undefined} />
          <KpiCard icon={LogIn} tone="warning" label="Signed in this week" value={ins ? ins.users.signedIn7d.toLocaleString() : "…"} sub={ins ? `of ${ins.users.active.toLocaleString()} people` : undefined} />
          <KpiCard icon={UserPlus} tone="brand" label="Accounts" value={ov.totals.accounts.toLocaleString()} sub={`+${ov.totals.newAccounts30d} in 30 days`} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel title="Needs attention" subtitle="Where a person could help today" flush className="xl:col-span-4">
          <div className="divide-y divide-line">
            {ins && attention.length === 0 && (
              <div className="flex items-center gap-3.5 px-5 py-5">
                <span className={cn("grid place-items-center w-9 h-9 rounded-xl shrink-0", toneCls.success)}><CheckCircle2 className="w-4 h-4" strokeWidth={1.9} /></span>
                <div className="text-[13px] text-t2">All clear. Nothing needs a person right now.</div>
              </div>
            )}
            {attention.map((a) => (
              <Link key={a.label} to={a.to} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-surface-2 transition-colors">
                <span className={cn("grid place-items-center w-9 h-9 rounded-xl shrink-0", toneCls[a.tone])}><a.icon className="w-4 h-4" strokeWidth={1.9} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-t1 truncate">{a.label}</div>
                  <div className="text-[11.5px] text-t3 truncate">{a.hint}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-t4" />
              </Link>
            ))}
            <div className="px-5 py-3.5 flex items-center gap-2 flex-wrap">
              <Pill tone="success" dot>{subs?.counts.paid ?? 0} paying</Pill>
              <Pill tone="brand" dot>{subs?.counts.trialing ?? 0} on trial</Pill>
            </div>
          </div>
        </Panel>
        <div className="xl:col-span-5"><NewestCustomers recent={recent} onOpenAccount={onOpenAccount} /></div>
        <div className="xl:col-span-3"><PlanMix ov={ov} /></div>
      </div>
    </>
  );
}

// ── Money ────────────────────────────────────────────────────

function MoneyView({ subs, ov, onOpenAccount }: { subs: Subs | null; ov: Overview; onOpenAccount: (id: string) => void }) {
  if (!subs) return <Loading h={300} />;
  const c = subs.counts;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard icon={Wallet} tone="success" label="Income a month" value={naira(subs.mrr)} sub="From accounts paying today" />
        <KpiCard icon={Receipt} tone="brand" label="Collected, 30 days" value={naira(subs.collected30d)} sub={`${naira(subs.collectedAll)} since the start`} />
        <KpiCard icon={CreditCard} tone="neutral" label="Paying accounts" value={c.paid.toLocaleString()} sub={`${c.trialing} on trial, ${c.free} on Freemium`} />
        <KpiCard icon={CircleSlash} tone={c.lapsed ? "danger" : "neutral"} label="Lapsed" value={c.lapsed.toLocaleString()} sub="Plan ended, not renewed" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel title="Renewing soon" subtitle="Plans ending within 14 days" flush className="xl:col-span-5" action={<ViewAll to="/admin/subscriptions" />}>
          {subs.expiring.length === 0 ? <EmptyBlock icon={CalendarClock} title="Nothing due" hint="No paid plan ends in the next 14 days." /> : (
            <div className="divide-y divide-line">
              {subs.expiring.slice(0, 7).map((a) => (
                <RowButton key={a.id} onClick={() => onOpenAccount(a.id)} className="!py-3">
                  <Avatar name={a.name} size={34} className="!rounded-full" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-t1 truncate">{a.name}</div>
                    <div className="text-[12px] text-t3 truncate">{PLAN_LABEL[a.plan] || a.plan}{a.trial ? ", trial" : ""}</div>
                  </div>
                  <Pill tone={(a.daysLeft ?? 0) <= 3 ? "danger" : "warning"}>{a.daysLeft === 0 ? "Today" : `${a.daysLeft} days`}</Pill>
                </RowButton>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Latest payments" subtitle="What came in most recently" flush className="xl:col-span-4">
          {subs.payments.length === 0 ? <EmptyBlock icon={Receipt} title="No payments yet" hint="Paystack payments will appear here." /> : (
            <div className="divide-y divide-line">
              {subs.payments.slice(0, 7).map((p, i) => (
                <RowButton key={i} onClick={() => onOpenAccount(p.accountId)} className="!py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-t1 truncate">{p.accountName}</div>
                    <div className="text-[12px] text-t3 truncate">{PLAN_LABEL[p.plan] || p.plan} · {p.at ? fmtDate(p.at) : ""}</div>
                  </div>
                  <span className="font-mono font-bold text-[13px] text-t1 tabular-nums">{naira(p.amount)}</span>
                </RowButton>
              ))}
            </div>
          )}
        </Panel>
        <div className="xl:col-span-3"><PlanMix ov={ov} /></div>
      </div>
      {subs.lapsed.length > 0 && (
        <Panel title="Lapsed accounts" subtitle="Worth a call to win them back" flush>
          <div className="divide-y divide-line">
            {subs.lapsed.slice(0, 6).map((a) => (
              <RowButton key={a.id} onClick={() => onOpenAccount(a.id)} className="!py-3">
                <Avatar name={a.name} size={34} className="!rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-t1 truncate">{a.name}</div>
                  <div className="text-[12px] text-t3 truncate">{a.owner?.email || ""}</div>
                </div>
                <span className="text-[12px] text-t3">{a.periodEnd ? `Ended ${fmtDate(a.periodEnd)}` : PLAN_LABEL[a.plan] || a.plan}</span>
              </RowButton>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── Trading ──────────────────────────────────────────────────

function TradingView({ days, growth, ins, ov, onOpenAccount }: { days: Range; growth: Growth | null; ins: Insights | null; ov: Overview; onOpenAccount: (id: string) => void }) {
  const { data: lead } = useApi<Leaders>(`/platform/leaders?days=${days}`, []);
  const series = growth?.series ?? [];
  const labels = series.map((d) => fmtDate(d.date));
  const volume = sum(series, (d) => d.volume);
  const sales = sum(series, (d) => d.txns);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard icon={TrendingUp} tone="brand" label={`Sold, last ${days} days`} value={growth ? naira(volume) : "…"} sub="All businesses together" />
        <KpiCard icon={ShoppingCart} tone="neutral" label="Number of sales" value={growth ? sales.toLocaleString() : "…"} sub={growth ? `About ${Math.round(sales / Number(days)).toLocaleString()} a day` : undefined} />
        <KpiCard icon={Receipt} tone="warning" label="Average sale" value={growth ? naira(sales ? volume / sales : 0) : "…"} sub="Per transaction" />
        <KpiCard icon={Clock} tone="success" label="Sold today" value={ins ? naira(ins.today.volume) : "…"} sub={ins ? `${ins.today.sales} sales so far` : undefined} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Money through StarTrack" subtitle="Sales value per day">
          {growth ? <AreaChart values={series.map((d) => d.volume)} labels={labels} format={naira} height={200} /> : <Loading h={200} />}
        </Panel>
        <Panel title="Sales per day" subtitle="Number of receipts issued">
          {growth ? <BarChart values={series.map((d) => d.txns)} labels={labels} height={200} /> : <Loading h={200} />}
        </Panel>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel title="Top selling businesses" subtitle={`Last ${days} days, demo shops left out`} flush className="xl:col-span-7">
          {!lead ? <Loading h={200} /> : lead.businesses.length === 0 ? <EmptyBlock icon={Trophy} title="No sales yet" hint="Real businesses that sell will rank here." /> : (
            <div className="divide-y divide-line">
              {lead.businesses.map((b, i) => (
                <RowButton key={b.id} onClick={() => onOpenAccount(b.accountId)} className="!py-3">
                  <span className={cn("grid place-items-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0", i < 3 ? "text-white" : "bg-surface-3 text-t3")}
                    style={i < 3 ? { background: ["linear-gradient(135deg,#cc9933,#ecbb55)", "linear-gradient(135deg,#8a90ad,#bcc1d6)", "linear-gradient(135deg,#a8683a,#d49a6a)"][i] } : undefined}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-t1 truncate">{b.name}</div>
                    <div className="text-[12px] text-t3 truncate">{b.typeLabel} · {b.txns.toLocaleString()} sales · last {fmtDateTime(b.lastSaleAt)}</div>
                  </div>
                  <span className="font-mono font-bold text-[13px] text-t1 tabular-nums">{naira(b.total)}</span>
                </RowButton>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Sales by trade" subtitle={`Which kinds of business sell most`} className="xl:col-span-5">
          {!lead ? <Loading h={200} /> : <Bars rows={lead.trades.slice(0, 7).map((t) => ({ label: t.label, value: t.total, shown: naira(t.total) }))} />}
          <div className="mt-4 pt-4 border-t border-line text-[12px] text-t3">{ov.totals.activeBusinesses7d} of {ov.totals.businesses} businesses sold something this week.</div>
        </Panel>
      </div>
    </div>
  );
}

// ── Sign-ups ─────────────────────────────────────────────────

function SignupsView({ days, growth, ov, recent, onOpenAccount }: { days: Range; growth: Growth | null; ov: Overview; recent: Recent | null; onOpenAccount: (id: string) => void }) {
  const series = growth?.series ?? [];
  const labels = series.map((d) => fmtDate(d.date));
  const joined = sum(series, (d) => d.signups);
  const best = series.reduce((m, d) => (d.signups > m.signups ? d : m), { date: "", signups: 0 } as { date: string; signups: number });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard icon={Building2} tone="brand" label="Customer accounts" value={ov.totals.accounts.toLocaleString()} sub={`${ov.totals.sandboxes} demo shops not counted`} />
        <KpiCard icon={UserPlus} tone="success" label={`Joined, last ${days} days`} value={growth ? joined.toLocaleString() : "…"} sub={growth ? `About ${(joined / Number(days)).toFixed(1)} a day` : undefined} />
        <KpiCard icon={TrendingUp} tone="warning" label="Best day" value={best.signups ? String(best.signups) : "0"} sub={best.signups ? fmtDate(best.date) : "No sign-ups yet"} />
        <KpiCard icon={CreditCard} tone="neutral" label="Joined, 30 days" value={ov.totals.newAccounts30d.toLocaleString()} sub="New customer accounts" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel title="New accounts per day" subtitle={`${joined} in the last ${days} days`} className="xl:col-span-7">
          {growth ? <BarChart values={series.map((d) => d.signups)} labels={labels} height={220} /> : <Loading h={220} />}
        </Panel>
        <div className="xl:col-span-5"><NewestCustomers recent={recent} onOpenAccount={onOpenAccount} limit={6} /></div>
      </div>
    </div>
  );
}

// ── Businesses ───────────────────────────────────────────────

function BusinessesView({ ov, ins }: { ov: Overview; ins: Insights | null }) {
  const t = ov.totals;
  const pct = t.businesses ? Math.round((t.activeBusinesses7d / t.businesses) * 100) : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard icon={Store} tone="brand" label="Businesses" value={t.businesses.toLocaleString()} sub={`Under ${t.accounts} accounts`} />
        <KpiCard icon={GitBranch} tone="neutral" label="Branches" value={t.branches.toLocaleString()} sub="Shops and outlets" />
        <KpiCard icon={TrendingUp} tone="success" label="Sold in 30 days" value={ins ? ins.businesses.active30d.toLocaleString() : "…"} sub="Businesses with a sale" />
        <KpiCard icon={Moon} tone={ins?.businesses.quiet ? "danger" : "neutral"} label="Quiet businesses" value={ins ? ins.businesses.quiet.toLocaleString() : "…"} sub="No sale in 30 days" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel title="Trading this week" subtitle="Businesses that made at least one sale" className="xl:col-span-4">
          <div className="flex items-center gap-5">
            <Ring pct={pct} />
            <div>
              <div className="font-mono text-[30px] leading-none font-bold text-t1 tabular-nums">{t.activeBusinesses7d}<span className="text-t3 text-[16px]"> / {t.businesses}</span></div>
              <div className="text-[12.5px] text-t3 mt-1.5">sold something in the last 7 days</div>
              <div className="mt-3"><ViewAll to="/admin/businesses">See businesses</ViewAll></div>
            </div>
          </div>
        </Panel>
        <Panel title="Trades on the platform" subtitle={`${ov.byType.length} trades in use`} className="xl:col-span-4">
          <Bars rows={ov.byType.slice(0, 7).map((r) => ({ label: r.label, value: r.count }))} />
        </Panel>
        <Panel title="What's in StarTrack" subtitle="Records kept across every business" className="xl:col-span-4">
          {!ins ? <Loading h={180} /> : (
            <dl className="grid grid-cols-2 gap-3">
              {([
                ["Products", ins.usage.products], ["Customers", ins.usage.customers], ["Invoices sent", ins.usage.invoices],
                ["Returns, 30 days", ins.usage.returns30d], ["Open tickets", ins.usage.ticketsOpen], ["Traded in 30 days", ins.businesses.active30d],
              ] as const).map(([l, v]) => (
                <div key={l} className="rounded-xl bg-surface-2 border border-line px-4 py-3">
                  <dt className="text-[11.5px] text-t3">{l}</dt>
                  <dd className="font-mono text-[20px] font-bold text-t1 tabular-nums mt-0.5">{v.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── People ───────────────────────────────────────────────────

function PeopleView({ ins }: { ins: Insights | null }) {
  if (!ins) return <Loading h={300} />;
  const u = ins.users;
  const signedPct = u.active ? Math.round((u.signedIn30d / u.active) * 100) : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard icon={Users} tone="brand" label="People with logins" value={u.active.toLocaleString()} sub={`${u.owners} business owners`} />
        <KpiCard icon={LogIn} tone="success" label="Signed in this week" value={u.signedIn7d.toLocaleString()} sub={`${u.signedIn30d} in 30 days`} />
        <KpiCard icon={Hourglass} tone="warning" label="Not seen in 30 days" value={Math.max(0, u.active - u.signedIn30d).toLocaleString()} sub={`${signedPct}% came back this month`} />
        <KpiCard icon={Ban} tone={u.suspended ? "danger" : "neutral"} label="Suspended" value={u.suspended.toLocaleString()} sub="Cannot sign in" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Who uses StarTrack" subtitle="People by their role" action={<ViewAll to="/admin/users">See people</ViewAll>}>
          <Bars rows={[
            { label: "Business owners", value: u.owners }, { label: "Admins", value: u.admins }, { label: "Managers", value: u.managers },
            { label: "Staff", value: u.staff }, { label: "StarTrack team", value: u.platformStaff },
          ]} />
        </Panel>
        <Panel title="How often people come back" subtitle="Share of people who signed in">
          <Bars color="linear-gradient(90deg,#0f9f6e,#3cc99a)" rows={[
            { label: "This week", value: u.signedIn7d, shown: `${u.signedIn7d} (${u.active ? Math.round((u.signedIn7d / u.active) * 100) : 0}%)` },
            { label: "This month", value: u.signedIn30d, shown: `${u.signedIn30d} (${signedPct}%)` },
            { label: "Everyone who can sign in", value: u.active },
          ]} />
        </Panel>
      </div>
    </div>
  );
}

// ── Support ──────────────────────────────────────────────────

function SupportView({ days }: { days: Range }) {
  const { data: s } = useApi<DeskStats>(`/desk/stats?days=${days}`, []);
  if (!s) return <Loading h={300} />;
  const t = s.totals;
  const labels = s.series.map((d) => fmtDate(d.date));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard icon={Inbox} tone={t.waitingOnUs ? "danger" : "success"} label="Waiting on StarTrack" value={String(t.waitingOnUs)} sub={t.oldestWaitingSince ? `Oldest since ${fmtDateTime(t.oldestWaitingSince)}` : "Nobody is waiting"} />
        <KpiCard icon={LifeBuoy} tone="brand" label="Open requests" value={String(t.open)} sub={`${t.unassigned} not assigned yet`} />
        <KpiCard icon={Clock} tone="warning" label="Typical first reply" value={hrs(t.medianFirstResponseHours)} sub={t.answeredWithin24hPct == null ? "No replies yet" : `${t.answeredWithin24hPct}% answered within a day`} />
        <KpiCard icon={CheckCircle2} tone="success" label={`Resolved, last ${days} days`} value={String(t.resolved)} sub={t.medianResolutionHours == null ? `${t.received} received` : `${t.received} received · typical ${hrs(t.medianResolutionHours)}`} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel title="Requests received" subtitle="Per day" className="xl:col-span-4">
          <BarChart values={s.series.map((d) => d.created)} labels={labels} height={180} />
        </Panel>
        <Panel title="Requests resolved" subtitle="Per day" className="xl:col-span-4">
          <BarChart values={s.series.map((d) => d.resolved)} labels={labels} height={180} color="#0f9f6e" />
        </Panel>
        <Panel title="What businesses ask about" subtitle={`Last ${days} days`} className="xl:col-span-4"
          action={<Link to="/desk" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline"><Headphones className="w-3.5 h-3.5" /> Open desk</Link>}>
          <Bars rows={s.byCategory.map((c) => ({ label: CATEGORY[c.key] || c.key, value: c.count }))} />
        </Panel>
      </div>
    </div>
  );
}
