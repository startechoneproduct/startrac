import { useMemo, useState } from "react";
import {
  Plus, ArrowRight, KeyRound, Check, Search, Store,
  Blinds, Smartphone, BedDouble, UtensilsCrossed, Droplets, Egg,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input } from "@/components/ui/Field";
import { CurrencySelect } from "@/components/ui/CurrencySelect";
import { findCurrency } from "#shared/currencies.js";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { TYPE_META } from "@/lib/businessTypes";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<string, any> = {
  blinds: Blinds, electronics: Smartphone, hotel: BedDouble,
  restaurant: UtensilsCrossed, water: Droplets, poultry: Egg,
};

type Biz = {
  id: string; name: string; tradingName: string; typeKey: string; typeLabel: string;
  tagline: string; capabilities: string[]; code: string; currency: string;
  branches: { id: string; name: string }[]; staff: number;
  todayRevenue: number; todayTxns: number;
};

export function MyBusinesses() {
  const { activeBusiness, setActiveBusiness, can } = useSession();
  const { data, loading, reload } = useApi<{ businesses: Biz[] }>("/settings/businesses", []);
  const [adding, setAdding] = useState(false);

  const businesses = data?.businesses || [];
  // Money in different currencies is never added together: one total per currency.
  const byCurrency = new Map<string, number>();
  for (const b of businesses) byCurrency.set(b.currency || "₦", (byCurrency.get(b.currency || "₦") || 0) + b.todayRevenue);
  const takenToday = [...byCurrency.entries()].map(([cur, n]) => fmtMoney(n, cur)).join(" + ");

  function open(b: Biz) {
    setActiveBusiness(b.id);
    // The whole app reads the active business from the session, so a full
    // reload is the honest way to switch every screen at once.
    setTimeout(() => { window.location.href = "/app/dashboard"; }, 60);
  }

  if (loading) return <div className="p-8"><Spinner /></div>;

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="My Businesses"
        subtitle="One login, separate books. Nothing is shared between them but you."
        actions={can("*") && <Button onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add business</Button>}
      />

      {businesses.length > 1 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            ["Businesses", String(businesses.length)],
            ["Branches", String(businesses.reduce((s, b) => s + b.branches.length, 0))],
            ["People", String(businesses.reduce((s, b) => s + b.staff, 0))],
            ["Taken today", takenToday],
          ].map(([l, v]) => (
            <Card key={l} className="p-3.5">
              <div className="text-[11.5px] font-medium tracking-[0.09em] text-t3">{l}</div>
              <div className="font-mono font-semibold text-[20px] text-t1 tabular-nums mt-1">{v}</div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {businesses.map((b, i) => {
          const Icon = TYPE_ICON[b.typeKey] || Store;
          const active = b.id === activeBusiness?.id;
          return (
            <button
              key={b.id}
              onClick={() => open(b)}
              style={{ animationDelay: `${i * 45}ms` }}
              className={cn(
                "group animate-fade-up text-left rounded-card border bg-surface overflow-hidden transition-all duration-200",
                active
                  ? "border-brand-500"
                  : "border-line hover:border-brand-400 hover:shadow-e2 hover:-translate-y-1"
              )}
            >
              {/* A band in the brand, so each card reads as its own shop front. */}
              <div className="h-1.5 w-full" style={{ background: active ? "var(--st-primary)" : "var(--st-border-2)" }} />

              <div className="p-4">
                <div className="flex items-start gap-3">
                  <span className={cn(
                    "w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                    active ? "bg-primary text-white" : "bg-primary-soft text-primary"
                  )}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-t1 truncate">{b.name}</span>
                      {active && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-success-soft text-success">
                          <Check className="w-2.5 h-2.5" /> Active
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-t3 truncate">{b.typeLabel}</div>
                  </div>
                </div>

                <p className="text-[12px] text-t3 mt-2.5 leading-snug line-clamp-2">{b.tagline}</p>

                <div className="grid grid-cols-2 gap-2 mt-3.5">
                  <div className="rounded-ctl bg-surface-2 border border-line px-2.5 py-2">
                    <div className="text-[11px] font-medium text-t4">Today</div>
                    <div className="font-mono font-semibold text-[14px] text-t1 tabular-nums">{fmtMoney(b.todayRevenue, b.currency)}</div>
                    <div className="text-[10px] text-t4">{b.todayTxns} sale{b.todayTxns === 1 ? "" : "s"}</div>
                  </div>
                  <div className="rounded-ctl bg-surface-2 border border-line px-2.5 py-2">
                    <div className="text-[11px] font-medium text-t4">Team</div>
                    <div className="font-mono font-semibold text-[14px] text-t1 tabular-nums">{b.staff}</div>
                    <div className="text-[10px] text-t4">{b.branches.length} branch{b.branches.length === 1 ? "" : "es"}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
                  <KeyRound className="w-3.5 h-3.5 text-t4 shrink-0" />
                  <span className="font-mono text-[12px] font-semibold tracking-[0.15em] text-t2">{b.code}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    Open <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </button>
          );
        })}

        {can("*") && (
          <button
            onClick={() => setAdding(true)}
            className="animate-fade-up rounded-card border-2 border-dashed border-line-2 min-h-[240px] flex flex-col items-center justify-center gap-2 text-t3 hover:border-brand-400 hover:text-primary hover:bg-primary-softer transition-colors"
          >
            <span className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center">
              <Plus className="w-6 h-6" />
            </span>
            <span className="text-[13px] font-semibold">Add another business</span>
            <span className="text-[11px] text-t4 max-w-[200px] text-center">A different trade, its own staff, stock and books</span>
          </button>
        )}
      </div>

      <AddBusiness open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />
    </div>
  );
}

function AddBusiness({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { activeBusiness } = useSession();
  // A new business starts in the currency of the one you are in.
  const startCurrency = findCurrency(activeBusiness?.settings.currency)?.code || "NGN";
  const [form, setForm] = useState({ name: "", businessType: "", tradingName: "", branchName: "Main Branch", currency: startCurrency });
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const types = useMemo(() => {
    const all = Object.entries(TYPE_META).map(([key, m]) => ({ key, ...m }));
    const term = q.trim().toLowerCase();
    return term ? all.filter((t) => t.label.toLowerCase().includes(term)) : all;
  }, [q]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.businessType) { setError("Pick the trade so we can set it up properly."); return; }
    setBusy(true); setError("");
    try {
      await api("/settings/businesses", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", businessType: "", tradingName: "", branchName: "Main Branch", currency: startCurrency });
      onSaved();
      window.location.reload(); // the switcher reads businesses from the session
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a business" subtitle="Its own staff, stock, prices and books — sharing only your login" wide>
      <form onSubmit={save} className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Business name"><Input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Tado Pharmacy" /></Field>
          <Field label="First branch"><Input value={form.branchName} onChange={(e) => setForm({ ...form, branchName: e.target.value })} /></Field>
          <Field label="Currency"><CurrencySelect value={form.currency} onChange={(code) => setForm({ ...form, currency: code })} /></Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-semibold text-t2">Trade</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-t4 pointer-events-none" />
              <input
                value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
                className="h-8 w-40 pl-8 pr-2 rounded-ctl bg-surface-2 border border-line text-[12px] text-t1 placeholder:text-t4 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[240px] overflow-y-auto pr-1">
            {types.map((t) => {
              const Icon = TYPE_ICON[t.key] || Store;
              const on = form.businessType === t.key;
              return (
                <button
                  key={t.key} type="button" onClick={() => setForm({ ...form, businessType: t.key })}
                  className={cn(
                    "flex items-center gap-2 p-2.5 rounded-ctl border text-left transition-all",
                    on ? "border-brand-500 bg-primary-softer" : "border-line bg-surface hover:border-brand-300"
                  )}
                >
                  <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", on ? "bg-primary text-white" : "bg-surface-3 text-t3")}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className={cn("text-[11.5px] font-semibold leading-tight", on ? "text-primary" : "text-t1")}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create business"}</Button>
      </form>
    </Modal>
  );
}
