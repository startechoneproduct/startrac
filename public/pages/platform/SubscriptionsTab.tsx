import { CalendarClock, CircleSlash, Receipt, Wallet, TrendingUp, BadgeCheck, Hourglass, Sparkles } from "lucide-react";
import { Spinner } from "@/components/ui/EmptyState";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";
import { EmptyBlock, KpiCard, PageHeader, Panel, Pill, RowButton, Avatar, compactMoney, naira } from "./ui";
import { ExportButton } from "./ExportButton";

type AccountRow = {
  id: string; name: string; plan: string; trial: boolean; periodEnd: string | null; daysLeft?: number;
  owner: { name: string; email: string } | null;
};
type Subs = {
  paymentsOn?: boolean;
  counts: { paid: number; trialing: number; lapsed: number; free: number; legacy: number };
  mrr: number; collected30d: number; collectedAll: number;
  expiring: AccountRow[]; lapsed: AccountRow[];
  payments: { accountId: string; accountName: string; plan: string; amount: number; at: string; reference: string }[];
};

export function SubscriptionsTab({ onOpenAccount }: { onOpenAccount: (id: string) => void }) {
  const { data, loading } = useApi<Subs>("/platform/subscriptions", []);
  if (loading || !data) return <div className="p-8"><Spinner /></div>;

  const total = data.counts.paid + data.counts.trialing + data.counts.lapsed + data.counts.free + data.counts.legacy;
  const mix = [
    { label: "Paying", n: data.counts.paid, color: "var(--st-success)" },
    { label: "On trial", n: data.counts.trialing, color: "var(--st-primary)" },
    { label: "Early access", n: data.counts.legacy, color: "var(--st-violet)" },
    { label: "Freemium", n: data.counts.free, color: "var(--st-text-4)" },
    { label: "Lapsed", n: data.counts.lapsed, color: "var(--st-danger)" },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto animate-fade-up">
      <PageHeader title="Subscriptions" subtitle="Who is paying, who is trialling, and who is about to lapse." actions={<ExportButton kind="payments" label="Export payments" />} />

      {data.paymentsOn === false && (
        <div className="mb-4 rounded-2xl border border-warning/30 bg-warning-soft px-5 py-3.5 text-[13px] text-t1">
          <b>Payments are switched off.</b> New accounts get 14 days of Pro, then continue free on Freemium; nobody is charged, so there is no income here. To give an account Pro or Business, set it from the account's drawer. Turn payments back on with <code className="font-mono text-[12px]">PAYMENTS_ENABLED</code> in server/shared/plans.js.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard icon={TrendingUp} tone="brand" label="Est. monthly recurring" value={compactMoney(data.mrr)} sub="From accounts on a current paid plan" />
        <KpiCard icon={Wallet} tone="success" label="Collected · 30 days" value={compactMoney(data.collected30d)} sub="Subscription payments received" />
        <KpiCard icon={Receipt} tone="neutral" label="Collected · all time" value={compactMoney(data.collectedAll)} sub={`${data.payments.length ? "Latest payments below" : "No payments yet"}`} />
        <KpiCard icon={BadgeCheck} tone="warning" label="Paying customers" value={String(data.counts.paid)} sub={<>{data.counts.trialing} more on a free trial</>} />
      </div>

      <Panel className="mt-4" title="Customer base by subscription" subtitle={`${total} customer accounts`}>
        <div className="flex h-3 rounded-full overflow-hidden bg-surface-3 gap-[2px]">
          {mix.filter((m) => m.n > 0).map((m) => <div key={m.label} title={`${m.label}: ${m.n}`} style={{ width: `${(m.n / (total || 1)) * 100}%`, background: m.color }} />)}
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
          {mix.map((m) => (
            <li key={m.label} className="flex items-center gap-2 text-[12.5px]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
              <span className="text-t3">{m.label}</span>
              <span className="font-semibold text-t1 tabular-nums">{m.n}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
        <Panel title="Renewing within 14 days" subtitle="A nudge now saves a lapse later" flush>
          {data.expiring.length === 0 ? <EmptyBlock icon={CalendarClock} title="Nothing about to expire" /> : (
            <div className="divide-y divide-line border-t border-line">
              {data.expiring.map((a) => (
                <RowButton key={a.id} onClick={() => onOpenAccount(a.id)}>
                  <Avatar name={a.name} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-t1 truncate">{a.name}</div>
                    <div className="text-[12px] text-t3 truncate">{a.owner?.email || "—"}</div>
                  </div>
                  <Pill tone="neutral">{a.plan}{a.trial ? " trial" : ""}</Pill>
                  <Pill tone={(a.daysLeft ?? 0) <= 3 ? "danger" : "warning"}><Hourglass className="w-3 h-3" />{a.daysLeft === 0 ? "today" : `${a.daysLeft}d`}</Pill>
                </RowButton>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recently lapsed" subtitle="Back on Freemium after their period ended" flush>
          {data.lapsed.length === 0 ? <EmptyBlock icon={CircleSlash} title="No lapsed subscriptions" /> : (
            <div className="divide-y divide-line border-t border-line">
              {data.lapsed.map((a) => (
                <RowButton key={a.id} onClick={() => onOpenAccount(a.id)}>
                  <Avatar name={a.name} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-t1 truncate">{a.name}</div>
                    <div className="text-[12px] text-t3 truncate">{a.owner?.email || "—"}</div>
                  </div>
                  <span className="text-[12px] text-t3">{a.periodEnd ? `ended ${fmtDate(a.periodEnd)}` : "ended"}</span>
                </RowButton>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-4" title="Latest payments" flush>
        {data.payments.length === 0 ? <EmptyBlock icon={Sparkles} title="No payments yet" hint="Subscription payments will show up here." /> : (
          <div className="divide-y divide-line border-t border-line">
            {data.payments.map((p) => (
              <RowButton key={p.reference} onClick={() => onOpenAccount(p.accountId)}>
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-success-soft text-success shrink-0"><Receipt className="w-4 h-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-t1 truncate">{p.accountName}</div>
                  <div className="text-[12px] text-t3 truncate capitalize">{p.plan} plan · <span className="font-mono">{p.reference}</span></div>
                </div>
                <div className="text-right">
                  <div className="text-[13.5px] font-semibold text-t1 tabular-nums">{naira(p.amount)}</div>
                  <div className="text-[11.5px] text-t4">{p.at ? fmtDate(p.at) : ""}</div>
                </div>
              </RowButton>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
