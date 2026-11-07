import { useState } from "react";
import { Activity, UserPlus, Wallet, LifeBuoy, ShieldCheck, Ban, Play, Download, BadgeCheck } from "lucide-react";
import { Spinner } from "@/components/ui/EmptyState";
import { useApi } from "@/lib/useApi";
import { fmtDateTime } from "@/lib/format";
import { EmptyBlock, PageHeader, Panel, Pill, Segmented, naira } from "./ui";

type Item = {
  kind: "admin" | "signup" | "payment" | "ticket";
  action?: string; at: string; actor?: string; target: string; targetType?: string; targetId?: string | null;
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null;
  detail?: string; amount?: number; priority?: string;
};
type Filter = "all" | "admin" | "events";

const PLAN: Record<string, string> = { free: "Freemium", pro: "Pro", business: "Business", growth: "Growth", legacy: "Full access" };
const plan = (v: unknown) => PLAN[String(v)] || String(v ?? "");

/** Turns one timeline row into an icon and a plain sentence. */
function describe(i: Item) {
  const by = i.actor ? <b className="text-t1">{i.actor}</b> : "StarTrack";
  const who = <b className="text-t1">{i.target}</b>;
  const reason = typeof i.after?.reason === "string" && i.after.reason ? <span className="text-t3">, “{i.after.reason}”</span> : null;
  switch (i.kind) {
    case "signup": return { icon: UserPlus, tone: "bg-success-soft text-success", text: <>{who} signed up on {plan(i.detail)}</> };
    case "payment": return { icon: Wallet, tone: "bg-primary-soft text-primary", text: <>{who} paid {naira(i.amount || 0)} for {plan(i.detail)}</> };
    case "ticket": return { icon: LifeBuoy, tone: "bg-warning-soft text-warning", text: <>{who} raised <b className="text-t1">{i.detail}</b> to StarTrack</> };
  }
  switch (i.action) {
    case "platform.plan": return { icon: BadgeCheck, tone: "bg-primary-soft text-primary", text: <>{by} moved {who} from {plan(i.before?.plan)} to {plan(i.after?.plan)}{i.after?.days ? ` for ${i.after.days} days` : ""}</> };
    case "platform.account_status": {
      const off = i.after?.status === "suspended";
      return { icon: off ? Ban : Play, tone: off ? "bg-danger-soft text-danger" : "bg-success-soft text-success", text: <>{by} {off ? "suspended" : "restored"} the account {who}{reason}</> };
    }
    case "platform.user_status": {
      const off = i.after?.status === "suspended";
      return { icon: off ? Ban : Play, tone: off ? "bg-danger-soft text-danger" : "bg-success-soft text-success", text: <>{by} {off ? "suspended" : "restored"} {who}{reason}</> };
    }
    case "platform.staff": {
      const role = String(i.after?.platformRole || "none");
      return { icon: ShieldCheck, tone: "bg-surface-3 text-t2", text: role === "none" ? <>{by} removed console access for {who}</> : <>{by} gave {who} {role} access to the console</> };
    }
    case "platform.ticket": {
      const a = i.after || {}, b = i.before || {};
      const what = a.status !== b.status ? `marked it ${String(a.status).replace("_", " ")}`
        : a.assignee !== b.assignee ? (a.assignee ? `assigned it to ${a.assignee}` : "unassigned it")
        : a.priority !== b.priority ? `set priority to ${a.priority}` : "updated it";
      return { icon: LifeBuoy, tone: "bg-primary-soft text-primary", text: <>{by} {what}: {who}</> };
    }
    case "platform.export": return { icon: Download, tone: "bg-surface-3 text-t2", text: <>{by} downloaded the {i.target} list</> };
    default: return { icon: Activity, tone: "bg-surface-3 text-t2", text: <>{by} did {i.action} on {who}</> };
  }
}

/** One timeline of what StarTrack staff did and what happened across the platform. */
export function ActivityTab({ onOpenAccount }: { onOpenAccount: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, loading } = useApi<{ items: Item[] }>(`/platform/activity?limit=100${filter !== "all" ? `&kind=${filter}` : ""}`, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1100px] mx-auto animate-fade-up">
      <PageHeader
        title="Activity"
        subtitle="Changes made in this console, and sign-ups, payments and tickets across StarTrack."
        actions={<Segmented value={filter} onChange={setFilter} options={[
          { value: "all", label: "Everything" }, { value: "admin", label: "Console changes" }, { value: "events", label: "Platform events" },
        ]} />}
      />
      <Panel flush>
        {loading && !data ? (
          <div className="py-16"><Spinner /></div>
        ) : !data || data.items.length === 0 ? (
          <EmptyBlock icon={Activity} title="Nothing yet" hint={filter === "admin" ? "Plan changes, suspensions and exports will show here." : "Activity will appear here."} />
        ) : (
          <ol className="divide-y divide-line">
            {data.items.map((i, n) => {
              const d = describe(i);
              const clickable = i.targetType === "account" && i.targetId;
              return (
                <li key={n}>
                  <button
                    type="button" disabled={!clickable} onClick={() => clickable && onOpenAccount(String(i.targetId))}
                    className="w-full flex items-center gap-3.5 px-5 py-3 text-left enabled:hover:bg-surface-2 transition-colors disabled:cursor-default"
                  >
                    <span className={`grid place-items-center w-9 h-9 rounded-xl shrink-0 ${d.tone}`}><d.icon className="w-4 h-4" strokeWidth={1.9} /></span>
                    <span className="flex-1 min-w-0 text-[13px] text-t2 leading-snug">{d.text}</span>
                    {i.kind === "admin" && <Pill tone="neutral" className="hidden sm:inline-flex">Console</Pill>}
                    {i.priority === "high" && <Pill tone="danger">High</Pill>}
                    <time className="text-[11.5px] text-t3 shrink-0 w-[128px] text-right tabular-nums">{fmtDateTime(i.at)}</time>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
