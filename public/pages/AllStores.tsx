import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Boxes, Building2, Receipt, Store, TrendingDown, TrendingUp, Trophy, Wallet } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { StatCard, TONES } from "@/components/ui/StatCard";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/Field";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { typeMeta } from "@/lib/businessTypes";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  revenue: number; expenses: number; refunds: number; txns: number;
  skus: number; units: number; stockRetail: number; lowStock: number;
  // Finance-only: absent for roles without the finance permission.
  cost?: number; grossProfit?: number; net?: number; marginPct?: number; stockCost?: number; waste?: number;
};
type BranchRow = Row & { id: string; name: string };
type BusinessRow = Row & { id: string; name: string; typeKey: string; currency: string; showFinance: boolean; branches: BranchRow[] };
type Overview = { days: number; from: string; to: string; businesses: BusinessRow[]; totals: (Row & { currency: string })[] };

const RANGES = [{ days: 1, label: "Today" }, { days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }];

// One colour per business, reused in the share bar, its legend and its card chip.
const HUES = [
  "linear-gradient(135deg, #3538f0, #7b3cf5)",
  "linear-gradient(135deg, #0f9f6e, #3cc99a)",
  "linear-gradient(135deg, #cc9933, #ecbb55)",
  "linear-gradient(135deg, #d02b3c, #f26a78)",
  "linear-gradient(135deg, #0e8fb3, #4fc3e6)",
  "linear-gradient(135deg, #4a5070, #8189ad)",
];
const hue = (i: number) => HUES[i % HUES.length];

const signed = (v: number, currency: string) => `${v < 0 ? "−" : ""}${fmtMoney(Math.abs(v), currency)}`;

// Profit or loss as a small coloured pill.
function ResultPill({ value, currency }: { value?: number; currency: string }) {
  if (value === undefined) return <span className="text-t4">—</span>;
  const loss = value < 0;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[12px] font-bold font-mono tabular-nums", loss ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>
      {loss ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
      {signed(value, currency)}
    </span>
  );
}

function Chip({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/12 backdrop-blur-sm px-4 py-3 min-w-0" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)" }}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white/70"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className="mt-1 font-mono font-bold text-[18px] tracking-[-0.01em] truncate">{value}</div>
    </div>
  );
}

/** The headline for one currency: net result, with revenue, spend and sales beneath. */
function Hero({ t, shares, currency }: { t: Row & { currency: string }; shares: { name: string; value: number }[]; currency: string }) {
  const finance = t.net !== undefined;
  const loss = finance && (t.net ?? 0) < 0;
  const total = shares.reduce((s, x) => s + x.value, 0);
  return (
    <div
      className="relative overflow-hidden rounded-[22px] text-white lg:col-span-2"
      style={{
        background: loss ? "linear-gradient(115deg, #8a1424 0%, #c22a3c 55%, #e0576a 100%)" : "linear-gradient(115deg, #1d1f9e 0%, #3538f0 48%, #7b3cf5 100%)",
        boxShadow: loss ? "0 24px 48px -22px rgba(194, 42, 60, 0.6)" : "0 24px 48px -22px rgba(53, 56, 240, 0.65)",
      }}
    >
      <div className="absolute -right-16 -top-20 w-72 h-72 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute right-24 -bottom-24 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
      <div className="relative p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white/75">{finance ? (loss ? "Net loss across all stores" : "Net profit across all stores") : "Revenue across all stores"}</div>
            <div className="mt-2 font-mono font-bold text-[40px] sm:text-[48px] leading-none tracking-[-0.03em] truncate">
              {fmtMoney(finance ? Math.abs(t.net ?? 0) : t.revenue, currency)}
            </div>
            {finance && (
              <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-[12px] font-bold">
                {loss ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                {t.marginPct}% margin
              </div>
            )}
          </div>
          <span className="grid place-items-center w-11 h-11 rounded-2xl bg-white/15 shrink-0">
            {finance ? (loss ? <TrendingDown className="w-5 h-5" strokeWidth={1.8} /> : <TrendingUp className="w-5 h-5" strokeWidth={1.8} />) : <Wallet className="w-5 h-5" strokeWidth={1.8} />}
          </span>
        </div>

        <div className={cn("mt-6 grid gap-3", finance ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2")}>
          <Chip icon={Wallet} label="Revenue" value={fmtMoney(t.revenue, currency)} />
          {finance && <Chip icon={Receipt} label="Expenses" value={fmtMoney(t.expenses, currency)} />}
          <Chip icon={Receipt} label="Sales made" value={t.txns.toLocaleString()} />
        </div>

        {shares.length > 1 && total > 0 && (
          <div className="mt-6">
            <div className="text-[12px] font-semibold text-white/70 mb-2">Where the revenue comes from</div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-white/15 gap-[2px]">
              {shares.map((s, i) => (
                <div key={s.name} title={`${s.name}: ${Math.round((s.value / total) * 100)}%`} style={{ width: `${(s.value / total) * 100}%`, background: ["#fff", "#c9ccff", "#a6abff", "#8388f7", "#6a6fe8", "#5258d6"][i % 6], opacity: 0.95 }} />
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/80">
              {shares.map((s, i) => (
                <span key={s.name} className="inline-flex items-center gap-1.5 min-w-0">
                  <i className="w-2 h-2 rounded-full shrink-0" style={{ background: ["#fff", "#c9ccff", "#a6abff", "#8388f7", "#6a6fe8", "#5258d6"][i % 6] }} />
                  <span className="truncate">{s.name}</span> <b className="font-bold text-white">{Math.round((s.value / total) * 100)}%</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type Ranked = { key: string; business: string; businessId: string; branchId: string; name: string; value: number; revenue: number; net?: number; currency: string; hue: number };

/** Every branch of every business on one leaderboard. */
function Ranking({ rows, finance, onOpen }: { rows: Ranked[]; finance: boolean; onOpen: (r: Ranked) => void }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const podium = ["linear-gradient(135deg,#cc9933,#ecbb55)", "linear-gradient(135deg,#8a90ad,#bcc1d6)", "linear-gradient(135deg,#a8683a,#d49a6a)"];
  return (
    <Panel title="Store ranking" subtitle={finance ? "By profit or loss" : "By revenue"} icon={Trophy} tone="warning" className="h-full">
      <ul className="space-y-3.5">
        {rows.slice(0, 7).map((r, i) => (
          <li key={r.key}>
            <button onClick={() => onOpen(r)} className="w-full text-left group">
              <div className="flex items-center gap-2.5">
                <span className={cn("grid place-items-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0", i > 2 && "bg-surface-3 text-t3")} style={i <= 2 ? { background: podium[i], color: "#fff" } : undefined}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-t1 truncate group-hover:text-primary transition-colors">{r.name}</div>
                  <div className="text-[11.5px] text-t3 truncate">{r.business}</div>
                </div>
                <div className={cn("font-mono font-bold text-[13px] tabular-nums shrink-0", r.value < 0 ? "text-danger" : "text-t1")}>{signed(r.value, r.currency)}</div>
              </div>
              <div className="mt-1.5 ml-[34px] h-1.5 rounded-full bg-surface-3 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(3, (Math.abs(r.value) / max) * 100)}%`, background: r.value < 0 ? TONES.danger.accent.replace("180deg", "90deg") : hue(r.hue) }} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function BusinessCard({ b, index, onOpen }: { b: BusinessRow; index: number; onOpen: (businessId: string, branchId?: string) => void }) {
  const finance = b.showFinance;
  const topRevenue = Math.max(...b.branches.map((br) => br.revenue), 1);
  const cols = finance ? "grid-cols-[minmax(150px,1.5fr)_repeat(5,minmax(92px,1fr))]" : "grid-cols-[minmax(150px,1.5fr)_repeat(3,minmax(92px,1fr))]";
  const head = "text-[11px] font-semibold text-t3 uppercase tracking-[0.05em]";
  return (
    <Card className="overflow-hidden !p-0">
      <div className="flex items-center gap-4 px-5 py-4 flex-wrap" style={{ background: "linear-gradient(180deg, var(--st-surface-2), var(--st-surface))" }}>
        <span className="grid place-items-center w-11 h-11 rounded-2xl text-white shrink-0" style={{ background: hue(index), boxShadow: "0 10px 18px -10px rgba(53, 56, 240, 0.5)" }}>
          <Store className="w-5 h-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-[16px] font-bold text-t1 truncate tracking-[-0.01em]">{b.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-t3">
            <span className="px-2 py-[2px] rounded-full bg-surface-3 font-semibold">{typeMeta(b.typeKey).label}</span>
            <span>{b.branches.length} branch{b.branches.length === 1 ? "" : "es"}</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div>
            <div className="text-[11.5px] font-semibold text-t3">Revenue</div>
            <div className="font-mono font-bold text-[16px] text-t1 tabular-nums">{fmtMoney(b.revenue, b.currency)}</div>
          </div>
          {finance && (
            <div>
              <div className="text-[11.5px] font-semibold text-t3">{(b.net ?? 0) < 0 ? "Loss" : "Profit"}</div>
              <ResultPill value={b.net} currency={b.currency} />
            </div>
          )}
          <button onClick={() => onOpen(b.id)} className="h-9 px-3.5 rounded-xl border border-line-2 bg-surface text-[12.5px] font-bold text-t1 hover:border-primary hover:text-primary hover:bg-primary-soft inline-flex items-center gap-1.5 transition-colors">
            Open <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border-t border-line">
        <div className="min-w-[760px]">
          <div className={cn("grid gap-3 px-5 py-2.5 bg-surface-2/60 border-b border-line", cols)}>
            <div className={head}>Branch</div>
            <div className={cn(head, "text-right")}>Revenue</div>
            <div className={cn(head, "text-right")}>Expenses</div>
            {finance && <div className={cn(head, "text-right")}>Profit / loss</div>}
            <div className={cn(head, "text-right")}>Stock value</div>
            <div className={cn(head, "text-right")}>Low stock</div>
          </div>
          {b.branches.map((br) => (
            <button key={br.id} onClick={() => onOpen(b.id, br.id)} className={cn("w-full text-left grid gap-3 px-5 py-3.5 items-center border-b border-line last:border-b-0 hover:bg-primary-softer transition-colors", cols)}>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-t1 truncate">{br.name}</div>
                <div className="mt-1.5 h-1 rounded-full bg-surface-3 overflow-hidden max-w-[160px]">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, (br.revenue / topRevenue) * 100)}%`, background: hue(index) }} />
                </div>
              </div>
              <div className="text-right font-mono text-[13px] font-semibold text-t1 tabular-nums">{fmtMoney(br.revenue, b.currency)}</div>
              <div className="text-right font-mono text-[13px] text-t2 tabular-nums">{fmtMoney(br.expenses, b.currency)}</div>
              {finance && <div className="text-right"><ResultPill value={br.net} currency={b.currency} /></div>}
              <div className="text-right font-mono text-[13px] text-t2 tabular-nums">
                {fmtMoney(finance ? (br.stockCost ?? 0) : br.stockRetail, b.currency)}
                <div className="text-[11px] text-t4">{br.units.toLocaleString()} units</div>
              </div>
              <div className="text-right">
                {br.lowStock > 0
                  ? <span className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full bg-warning-soft text-warning text-[12px] font-bold"><AlertTriangle className="w-3 h-3" />{br.lowStock}</span>
                  : <span className="text-[12px] text-t4">All good</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function AllStores() {
  const { setActiveBusiness, setActiveBranch } = useSession();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const { data, loading, error } = useApi<Overview>(`/overview?days=${days}`, []);

  // Jump straight into one store from the comparison.
  function open(businessId: string, branchId?: string) {
    setActiveBusiness(businessId);
    if (branchId) setActiveBranch(branchId);
    navigate("/app/dashboard");
  }

  const ranked = useMemo(() => {
    const out = new Map<string, Ranked[]>();
    (data?.businesses || []).forEach((b, bi) => {
      for (const br of b.branches) {
        const list = out.get(b.currency) || [];
        list.push({ key: `${b.id}:${br.id}`, business: b.name, businessId: b.id, branchId: br.id, name: br.name, value: b.showFinance ? (br.net ?? 0) : br.revenue, revenue: br.revenue, net: br.net, currency: b.currency, hue: bi });
        out.set(b.currency, list);
      }
    });
    for (const list of out.values()) list.sort((a, c) => c.value - a.value);
    return out;
  }, [data]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1240px] mx-auto">
      <PageHeader
        title="All stores"
        subtitle="Sales, profit or loss and stock for every business and branch you run, side by side"
        actions={
          <div className="flex p-1 rounded-xl border border-line-2 bg-surface-2 gap-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={cn("px-3.5 h-8 rounded-[9px] text-[12.5px] font-bold transition-all", days === r.days ? "bg-surface text-primary shadow-e1" : "text-t3 hover:text-t1")}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}
      {loading && !data ? (
        <Spinner />
      ) : !data || data.businesses.length === 0 ? (
        <Card><EmptyState icon={Store} title="Nothing to compare yet" body="Add a second business or branch and it appears here." /></Card>
      ) : (
        <div className="space-y-6">
          {data.totals.map((t) => {
            const finance = t.net !== undefined;
            const mine = data.businesses.filter((b) => b.currency === t.currency);
            const shares = mine.map((b) => ({ name: b.name, value: b.revenue })).sort((a, c) => c.value - a.value);
            const list = ranked.get(t.currency) || [];
            return (
              <section key={t.currency} className="space-y-5">
                {data.totals.length > 1 && (
                  <div className="flex items-center gap-2 text-[12.5px] font-bold text-t2"><Building2 className="w-4 h-4 text-t3" /> Businesses trading in {t.currency}</div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  <Hero t={t} shares={shares} currency={t.currency} />
                  {list.length > 1 && <Ranking rows={list} finance={finance} onOpen={(r) => open(r.businessId, r.branchId)} />}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-5">
                  <StatCard
                    tone="warning"
                    label="Stock on hand"
                    value={fmtMoney(finance ? (t.stockCost ?? 0) : t.stockRetail, t.currency)}
                    icon={Boxes}
                    hint={`${t.units.toLocaleString()} units · ${finance ? "at cost" : "at price"}`}
                  />
                  <StatCard
                    tone={t.lowStock > 0 ? "danger" : "success"}
                    label="Items running low"
                    value={t.lowStock.toLocaleString()}
                    icon={AlertTriangle}
                    hint={t.lowStock > 0 ? "at or below reorder level" : "everything is stocked"}
                  />
                  {finance && <StatCard tone="success" label="Gross profit" value={fmtMoney(t.grossProfit ?? 0, t.currency)} icon={TrendingUp} hint="before expenses" />}
                  <StatCard tone="neutral" label="Refunds" value={fmtMoney(t.refunds, t.currency)} icon={Receipt} hint="already taken off profit" />
                </div>
              </section>
            );
          })}

          <div className="space-y-5">
            {data.businesses.map((b, i) => (
              <BusinessCard key={b.id} b={b} index={i} onOpen={open} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
