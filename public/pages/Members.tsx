import { useState } from "react";
import {
  Users, Plus, QrCode, Search, CheckCircle2, XCircle, Clock, Banknote, CreditCard, Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { QrScanModal } from "@/components/loyalty/QrScanModal";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Plan = { id: string; name: string; description: string; price: number; durationDays: number };
type Subscription = {
  id: string; customerId: string; customerName: string; planName: string;
  startDate: string; expiresAt: string; status: "active" | "expired" | "cancelled";
};
type CheckIn = { id: string; customerName: string; allowed: boolean; reason?: string; at: string; byStaffName: string };

const PAY_METHODS = [
  { k: "cash", label: "Cash", icon: Banknote },
  { k: "pos", label: "POS", icon: CreditCard },
  { k: "transfer", label: "Transfer", icon: Smartphone },
] as const;

export function Members() {
  const { activeBranch, currency } = useSession();
  const [scanOpen, setScanOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [q, setQ] = useState("");
  const [checkInResult, setCheckInResult] = useState<{ allowed: boolean; memberName: string; planName?: string; expiresAt?: string; reason?: string } | null>(null);
  const [checkInError, setCheckInError] = useState("");

  const { data, loading, reload } = useApi<{ subscriptions: Subscription[] }>("/gym/subscriptions", [activeBranch?.id]);
  const { data: checkInData, reload: reloadCheckIns } = useApi<{ checkIns: CheckIn[] }>("/gym/check-ins", [activeBranch?.id]);

  const subs = (data?.subscriptions || []).filter((s) => !q || s.customerName.toLowerCase().includes(q.toLowerCase()));
  const active = subs.filter((s) => s.status === "active");
  const expiringSoon = active.filter((s) => new Date(s.expiresAt).getTime() - Date.now() < 3 * 86400000);

  async function onScanCode(code: string) {
    setScanOpen(false);
    setCheckInError("");
    setCheckInResult(null);
    try {
      const r = await api<{ allowed: boolean; memberName: string; planName?: string; expiresAt?: string; reason?: string }>(
        "/gym/check-in", { method: "POST", body: JSON.stringify({ code }) }
      );
      setCheckInResult(r);
      reloadCheckIns();
    } catch (err: any) {
      setCheckInError(err.message || "Couldn't check that card.");
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Members"
        subtitle={`${activeBranch?.name || ""} · membership plans, check-ins and renewals`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setScanOpen(true)}><QrCode className="w-4 h-4" /> Check In</Button>
            <Button onClick={() => setSellOpen(true)}><Plus className="w-4 h-4" /> Sell Membership</Button>
          </>
        }
      />

      {(checkInResult || checkInError) && (
        <div className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-card border mb-4",
          checkInError ? "bg-danger-soft border-danger/30" : checkInResult?.allowed ? "bg-success-soft border-success/30" : "bg-warning-soft border-warning/30"
        )}>
          {checkInError ? <XCircle className="w-5 h-5 text-danger shrink-0" /> : checkInResult?.allowed ? <CheckCircle2 className="w-5 h-5 text-success shrink-0" /> : <XCircle className="w-5 h-5 text-warning shrink-0" />}
          <div className="min-w-0 flex-1 text-[13px]">
            {checkInError ? (
              <span className="font-semibold text-danger">{checkInError}</span>
            ) : (
              <>
                <span className="font-semibold text-t1">{checkInResult!.memberName}</span>{" "}
                <span className={checkInResult!.allowed ? "text-success font-semibold" : "text-warning font-semibold"}>
                  {checkInResult!.allowed ? `checked in — ${checkInResult!.planName}, expires ${fmtDate(checkInResult!.expiresAt!)}` : `not allowed (${checkInResult!.reason === "expired" ? "membership expired" : "no membership"})`}
                </span>
              </>
            )}
          </div>
          <button onClick={() => { setCheckInResult(null); setCheckInError(""); }} className="shrink-0 text-t4 hover:text-t2"><XCircle className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <div className="text-[11px] font-medium text-t3">Active members</div>
          <div className="mt-2 font-mono font-semibold text-[22px] text-t1">{active.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-medium text-t3">Expiring within 3 days</div>
          <div className="mt-2 font-mono font-semibold text-[22px] text-warning">{expiringSoon.length}</div>
        </Card>
        <Card className="p-4 col-span-2 xl:col-span-1">
          <div className="text-[11px] font-medium text-t3">Check-ins today</div>
          <div className="mt-2 font-mono font-semibold text-[22px] text-t1">{checkInData?.checkIns.length ?? "—"}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <div className="relative max-w-sm mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" className="!pl-9" />
          </div>
          {loading ? (
            <Spinner />
          ) : subs.length === 0 ? (
            <Card><EmptyState icon={Users} title="No members yet" body="Sell a membership and they'll appear here, ready to check in on their next visit." /></Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="divide-y divide-line">
                {subs.map((s) => {
                  const daysLeft = Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / 86400000);
                  return (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-9 h-9 rounded-full bg-primary-soft text-primary font-semibold text-[13px] flex items-center justify-center shrink-0">
                        {s.customerName[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-t1 truncate">{s.customerName}</div>
                        <div className="text-[11px] text-t3 mt-0.5">{s.planName} · {s.status === "active" ? `${daysLeft >= 0 ? `expires in ${daysLeft}d` : "expires today"}` : "expired"} {fmtDate(s.expiresAt)}</div>
                      </div>
                      <Badge tone={s.status === "active" ? (daysLeft <= 3 ? "warning" : "success") : "danger"} className="capitalize shrink-0">
                        {s.status === "active" && daysLeft <= 3 ? "expiring soon" : s.status}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        <div>
          <div className="text-[13px] font-semibold text-t1 mb-2">Today's check-ins</div>
          <Card className="overflow-hidden">
            {!checkInData?.checkIns.length ? (
              <div className="px-4 py-8 text-center text-[12px] text-t4 flex items-center justify-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Nothing yet today.
              </div>
            ) : (
              <div className="divide-y divide-line">
                {checkInData.checkIns.map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    {c.allowed ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" /> : <XCircle className="w-4 h-4 text-danger shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold text-t1 truncate">{c.customerName}</div>
                      <div className="text-[10.5px] text-t4">{new Date(c.at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })} · {c.byStaffName}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <QrScanModal open={scanOpen} onClose={() => setScanOpen(false)} onCode={onScanCode} kind="member" />
      <SellMembershipModal open={sellOpen} onClose={() => setSellOpen(false)} onSold={() => { setSellOpen(false); reload(); }} currency={currency} />
    </div>
  );
}

function SellMembershipModal({ open, onClose, onSold, currency }: { open: boolean; onClose: () => void; onSold: () => void; currency: string }) {
  const { data: planData } = useApi<{ plans: Plan[] }>(open ? "/gym/plans" : null, []);
  const plans = planData?.plans || [];
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [planId, setPlanId] = useState("");
  const [method, setMethod] = useState<(typeof PAY_METHODS)[number]["k"]>("cash");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const plan = plans.find((p) => p.id === planId) || plans[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) return;
    setBusy(true); setError("");
    try {
      await api("/gym/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          customer: { name: customerName.trim(), phone: customerPhone.trim() },
          planId: plan.id,
          payments: [{ method, amount: plan.price }],
        }),
      });
      setCustomerName(""); setCustomerPhone(""); setPlanId("");
      onSold();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Sell a membership" subtitle="A returning customer's phone number extends their existing plan automatically">
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Member name"><Input autoFocus required value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></Field>
          <Field label="Phone"><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="080…" /></Field>
        </div>
        <Field label="Plan">
          <Select required value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Choose a plan…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtMoney(p.price, currency)} / {p.durationDays}d</option>)}
          </Select>
        </Field>
        {plan && (
          <>
            <Field label="Payment method">
              <div className="flex gap-1.5">
                {PAY_METHODS.map(({ k, label, icon: Icon }) => (
                  <button key={k} type="button" onClick={() => setMethod(k)} className={cn(
                    "flex-1 h-10 rounded-ctl border text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors",
                    method === k ? "bg-primary-soft border-brand-400 text-primary" : "border-line-2 text-t3 hover:text-t1"
                  )}>
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>
            </Field>
            <div className="flex justify-between px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-[13px]">
              <span className="text-t3">Amount due</span>
              <span className="font-mono font-semibold text-t1">{fmtMoney(plan.price, currency)}</span>
            </div>
          </>
        )}
        <Button type="submit" className="w-full" disabled={busy || !plan}>{busy ? "Processing…" : "Sell membership"}</Button>
      </form>
    </Modal>
  );
}
