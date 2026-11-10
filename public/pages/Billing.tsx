import { useEffect, useRef, useState, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Crown, Loader2, Minus, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fmtMoney } from "@/lib/format";
import { FEATURES, PLANS, PLAN_ORDER, planRank, type LimitName, type PlanKey } from "#shared/plans.js";
import { cn } from "@/lib/utils";
import { COMPARE } from "@/lib/planCompare";

type Billing = {
  plan: PlanKey; planName: string; legacy: boolean; periodEnd: string | null; trial: boolean; lapsed: boolean;
  canManage: boolean; paymentsEnabled: boolean; paymentsOn?: boolean; trialEnded?: boolean;
  awaitingPayment?: boolean; paidUntil?: string | null; paidPlan?: PlanKey | null;
  limits: Record<LimitName, number | null>;
  usage: { businesses: number; perBusiness: { id: string; name: string; products: number; staff: number; branches: number; customers: number }[] };
  payments: { reference: string; plan: string; amount: number; at: string }[];
};

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }) : "");

function Meter({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const over = cap !== null && used > cap;
  const hot = cap !== null && used >= cap;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="font-semibold text-t2">{label}</span>
        <span className={cn("font-mono tabular-nums", over ? "text-danger font-bold" : hot ? "text-warning font-bold" : "text-t3")}>{used.toLocaleString()} / {cap === null ? "Unlimited" : cap.toLocaleString()}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-surface-3 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: cap === null ? "6%" : `${Math.max(pct, used ? 4 : 0)}%`, background: over ? "linear-gradient(90deg,#d02b3c,#f26a78)" : hot ? "linear-gradient(90deg,#cc9933,#ecbb55)" : "var(--st-gradient-primary)" }} />
      </div>
    </div>
  );
}

function Cell({ v }: { v: string | boolean }) {
  if (v === true) return <Check className="w-[18px] h-[18px] mx-auto text-success" strokeWidth={2.4} />;
  if (v === false) return <Minus className="w-4 h-4 mx-auto text-t4" />;
  return <span className="text-[12.5px] font-semibold text-t2">{v}</span>;
}

export function Billing() {
  const { refreshSession, can } = useSession();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<PlanKey | "">("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const target = params.get("plan");
  const verifying = useRef(false);

  const load = () => api<Billing>("/billing").then(setData).catch((e) => setError(e?.message || "Couldn't load your plan."));
  useEffect(() => { load(); }, []);

  // Back from the payment page: confirm it with the server, which asks Paystack.
  useEffect(() => {
    const ref = params.get("reference") || params.get("trxref");
    if (!ref || verifying.current) return;
    verifying.current = true;
    api<{ plan: string; already?: boolean }>(`/billing/verify?reference=${encodeURIComponent(ref)}`)
      .then(async (r) => {
        setNotice({ ok: true, text: r.already ? "That payment was already applied." : `You're now on ${PLANS[r.plan as PlanKey]?.name || r.plan}. Thank you!` });
        await refreshSession();
        await load();
      })
      .catch((e) => setNotice({ ok: false, text: e?.message || "We couldn't confirm that payment yet. If you were charged, contact support with your reference." }))
      .finally(() => { const next = new URLSearchParams(params); next.delete("reference"); next.delete("trxref"); setParams(next, { replace: true }); });
  }, [params, setParams, refreshSession]);

  async function upgrade(plan: PlanKey) {
    setBusy(plan);
    setError("");
    try {
      const r = await api<{ url: string }>("/billing/checkout", { method: "POST", body: JSON.stringify({ plan, returnUrl: window.location.href }) });
      window.location.href = r.url;
    } catch (e: any) {
      setError(e?.message || "Couldn't start the payment.");
      setBusy("");
    }
  }

  if (!data) return <div className="p-8">{error ? <ErrorBanner message={error} /> : <Spinner />}</div>;
  // The plan the money has bought. During the free welcome days the account runs a bigger plan than that.
  const bonusOn = data.trial && !!data.paidPlan && data.periodEnd !== data.paidUntil;
  const here = bonusOn && data.paidPlan ? data.paidPlan : data.plan;
  const biggest = data.usage.perBusiness.reduce((m, b) => ({ products: Math.max(m.products, b.products), staff: Math.max(m.staff, b.staff), branches: Math.max(m.branches, b.branches), customers: Math.max(m.customers, b.customers) }), { products: 0, staff: 0, branches: 0, customers: 0 });
  const owner = data.canManage && can("*");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1180px] mx-auto space-y-6">
      <PageHeader title="Plan & billing" subtitle="What your subscription includes, what you've used, and how to upgrade" />
      <ErrorBanner message={error} />
      {notice && (
        <div className={cn("flex items-start gap-3 rounded-2xl px-4 py-3.5 border", notice.ok ? "bg-success-soft border-success/30 text-success" : "bg-danger-soft border-danger/30 text-danger")}>
          {notice.ok ? <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />}
          <p className="text-[13.5px] font-semibold flex-1">{notice.text}</p>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Where you are */}
      <div className="relative overflow-hidden rounded-[24px] text-white p-6 sm:p-8" style={{ background: "linear-gradient(115deg, #1d1f9e 0%, #3538f0 48%, #7b3cf5 100%)", boxShadow: "0 24px 48px -22px rgba(53, 56, 240, 0.65)" }}>
        <div className="absolute -right-16 -top-20 w-72 h-72 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="text-[13px] font-semibold text-white/75">Your plan</div>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-[34px] sm:text-[40px] font-extrabold tracking-[-0.03em] leading-none">{data.awaitingPayment ? "Not started" : data.lapsed ? "Plan ended" : data.planName}</span>
              <span className="grid place-items-center w-10 h-10 rounded-2xl bg-white/15"><Crown className="w-5 h-5" /></span>
            </div>
            <div className="mt-2.5 text-[13.5px] text-white/85">
              {data.legacy ? "Your account has full access. Nothing to pay."
                : data.awaitingPayment ? "Pick a plan and pay to start. Until then your account is view-only. Start with Freemium and you get 14 days of Pro free."
                : data.lapsed ? `Your plan ended${data.periodEnd ? ` on ${day(data.periodEnd)}` : ""}. You can view your data, but changes are paused until you renew.`
                : bonusOn ? `You're enjoying ${data.planName} free until ${day(data.periodEnd)}. After that you carry on with ${PLANS[data.paidPlan as PlanKey].name}, paid until ${day(data.paidUntil ?? null)}.`
                : data.trial ? (data.paymentsOn ? `Free trial, ends ${day(data.periodEnd)}. Choose a plan to keep going.` : `Free ${data.planName} trial until ${day(data.periodEnd)}. After that you carry on free on Freemium, and nothing is deleted.`)
                : data.trialEnded ? `Your free days are over and you're on ${data.planName}, the plan you paid for, until ${day(data.periodEnd)}. Everything you entered is still here.`
                : data.plan === "free" ? (data.paymentsOn ? "Freemium plan." : "You're on Freemium. It's free.")
                : data.periodEnd ? `Active until ${day(data.periodEnd)}${data.paymentsOn ? "" : ", then Freemium"}` : "Active"}
            </div>
          </div>
          {data.legacy && <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/15 text-[12.5px] font-bold"><ShieldCheck className="w-4 h-4" /> Early-access account</span>}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-6">
        <Panel title="What you've used" subtitle={data.usage.perBusiness.length > 1 ? "Your busiest business" : "Against your plan's limits"} icon={Sparkles} tone="brand">
          <div className="space-y-4">
            <Meter label="Products" used={biggest.products} cap={data.limits.products} />
            <Meter label="Customers" used={biggest.customers} cap={data.limits.customers} />
            <Meter label="Staff accounts" used={biggest.staff} cap={data.limits.staff} />
            <Meter label="Branches" used={biggest.branches} cap={data.limits.branches} />
            <Meter label="Businesses" used={data.usage.businesses} cap={data.limits.businesses} />
          </div>
          <p className="mt-4 text-[12px] text-t3 leading-relaxed">If you go over a limit after changing plan, nothing is deleted. You just can't add more until you upgrade or remove some.</p>
        </Panel>

        <Panel title="Payments" subtitle={data.paymentsOn ? "Plans are paid monthly. Nothing renews by itself." : "Payments are switched off. Plans are free right now."} icon={ShieldCheck} tone="success">
          {data.payments.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-t3">No payments yet.</div>
          ) : (
            <ul className="divide-y divide-line">
              {data.payments.map((p) => (
                <li key={p.reference} className="flex items-center justify-between gap-3 py-3 text-[13px]">
                  <div className="min-w-0"><div className="font-semibold text-t1">{PLANS[p.plan as PlanKey]?.name || p.plan} · 30 days</div><div className="text-[11.5px] text-t4 font-mono truncate">{p.reference}</div></div>
                  <div className="text-right shrink-0"><div className="font-mono font-bold text-t1">{fmtMoney(p.amount, "₦")}</div><div className="text-[11.5px] text-t3">{day(p.at)}</div></div>
                </li>
              ))}
            </ul>
          )}
          {data.paymentsOn && !data.paymentsEnabled && <p className="mt-3 text-[12px] text-warning font-semibold">Online payment isn't set up on this server yet. Plans can be switched on by the StarTrack team.</p>}
        </Panel>
      </div>

      {/* Plans */}
      <div className="grid md:grid-cols-3 gap-5 items-stretch">
        {PLAN_ORDER.map((k) => {
          const p = PLANS[k];
          const current = k === here && !data.legacy && !data.lapsed;
          const higher = planRank(k) > planRank(here);
          const featured = k === "pro";
          return (
            <div key={k} className={cn("relative rounded-[24px] border bg-surface p-6 flex flex-col transition-shadow", featured ? "border-primary shadow-e3" : "border-line shadow-e1", target === k && "ring-2 ring-primary ring-offset-2 ring-offset-canvas")}>
              {featured && <span className="absolute -top-3 left-6 px-3 py-1 rounded-full text-[11px] font-bold text-white" style={{ background: "var(--st-gradient-primary)" }}>Most popular</span>}
              <div className="flex items-center justify-between"><h3 className="text-[19px] font-extrabold text-t1">{p.name}</h3>{current && <span className="px-2 py-[3px] rounded-md bg-success-soft text-success text-[10px] font-bold uppercase tracking-wide">{data.trial && !bonusOn ? "Trial" : "Current"}</span>}</div>
              <p className="mt-1 text-[13px] text-t3">{p.tagline}</p>
              {k === "free" && data.paymentsOn && !data.legacy && !bonusOn && !data.paidPlan && <p className="mt-2 text-[12px] font-semibold text-primary">New here? Your first month includes 14 days of Pro, free.</p>}
              <div className="mt-4 flex items-baseline gap-1"><span className="text-[34px] font-extrabold tracking-[-0.03em] text-t1">{data.paymentsOn ? fmtMoney(p.price, "₦") : "₦0"}</span><span className="text-[13px] text-t3">{data.paymentsOn ? "/ month" : k === "free" ? "forever" : `${14} days on sign-up`}</span></div>
              <ul className="mt-5 space-y-2 flex-1">
                {p.highlights.map((h) => <li key={h} className="flex items-start gap-2 text-[13px] text-t2"><Check className="w-4 h-4 mt-0.5 text-success shrink-0" strokeWidth={2.4} /> {h}</li>)}
              </ul>
              <div className="mt-6">
                {!data.paymentsOn ? (
                  <Button variant="secondary" className="w-full" disabled>
                    {data.legacy ? "Included in your account" : current ? "Your current plan" : planRank(k) < planRank(here) ? "Included in your plan" : k === "free" ? "Free" : "Free trial on sign-up"}
                  </Button>
                ) : (
                  <>
                {data.legacy ? <Button variant="secondary" className="w-full" disabled>Included in your account</Button>
                  : !owner ? <Button variant="secondary" className="w-full" disabled>{current ? "Your current plan" : "Ask the owner"}</Button>
                  : current && data.trial && !bonusOn ? <Button className="w-full" onClick={() => upgrade(k as PlanKey)} disabled={!!busy}>{busy === k ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Pay for {p.name} <ArrowRight className="w-4 h-4" /></Button>
                  : current ? <Button variant="secondary" className="w-full" onClick={() => upgrade(k as PlanKey)} disabled={!!busy}>{busy === k ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Add 30 days</Button>
                  : data.lapsed || higher || data.trial ? <Button className="w-full" onClick={() => upgrade(k as PlanKey)} disabled={!!busy}>{busy === k ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {data.lapsed ? "Renew with" : higher ? "Upgrade to" : "Switch to"} {p.name} <ArrowRight className="w-4 h-4" /></Button>
                  : <Button variant="ghost" className="w-full" disabled>Included in your plan</Button>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Compare */}
      <Panel title="Compare plans" subtitle="Every feature, side by side" flush icon={Crown} tone="warning">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left px-5 py-3 font-semibold text-t3 w-[44%]" />
                {PLAN_ORDER.map((k) => <th key={k} className={cn("px-3 py-3 text-center font-extrabold text-t1", k === here && "text-primary")}>{PLANS[k].name}</th>)}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((g) => (
                <Fragment key={g.title}>
                  <tr className="bg-surface-2"><td colSpan={4} className="px-5 py-2 text-[11.5px] font-bold uppercase tracking-[0.1em] text-t3">{g.title}</td></tr>
                  {g.rows.map((r) => (
                    <tr key={g.title + r.label} className="border-b border-line last:border-0">
                      <td className="px-5 py-3 text-t2">{r.label}</td>
                      <td className="px-3 py-3 text-center"><Cell v={r.free} /></td>
                      <td className="px-3 py-3 text-center"><Cell v={r.pro} /></td>
                      <td className="px-3 py-3 text-center"><Cell v={r.business} /></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="text-[12px] text-t4 text-center">{Object.keys(FEATURES).length} features across three plans. Prices are in naira, per month.</p>
    </div>
  );
}
