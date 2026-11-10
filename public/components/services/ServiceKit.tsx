import { Banknote, CreditCard, Smartphone } from "lucide-react";
import { TONES } from "@/components/ui/StatCard";
import { cn } from "@/lib/utils";
import { animateSwitch } from "@/lib/viewTransition";

/**
 * Small pieces the three service-business screens (Academy, Appointments,
 * Projects) all need, kept in one place so they look and behave the same.
 */

export type PayMethod = "cash" | "pos" | "transfer";

const PAY_METHODS = [
  { k: "cash", label: "Cash", icon: Banknote },
  { k: "pos", label: "POS", icon: CreditCard },
  { k: "transfer", label: "Transfer", icon: Smartphone },
] as const;

export function MethodPicker({ value, onChange }: { value: PayMethod; onChange: (m: PayMethod) => void }) {
  return (
    <div className="flex gap-1.5">
      {PAY_METHODS.map(({ k, label, icon: Icon }) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cn(
            "flex-1 h-10 rounded-ctl border text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors",
            value === k ? "bg-primary-soft border-brand-400 text-primary" : "border-line-2 text-t3 hover:text-t1"
          )}
        >
          <Icon className="w-3.5 h-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

/**
 * A compact metric for dense grids (eight to a screen on the service pages).
 * An accent bar down the left edge carries the tone; the figure leads.
 */
export function Tile({
  label, value, tone, hint,
}: { label: string; value: React.ReactNode; tone?: "warning" | "danger" | "success"; hint?: string }) {
  const accent = TONES[tone ?? "brand"];
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-surface shadow-e1 pl-5 pr-4 py-3.5 min-w-0 transition-[box-shadow,transform] duration-200 hover:shadow-lg2 hover:-translate-y-0.5">
      <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full" style={{ background: accent.accent }} />
      <div className="text-[12px] font-semibold text-t3 truncate">{label}</div>
      <div
        className="mt-1.5 font-mono font-bold text-[22px] leading-tight truncate tracking-[-0.015em]"
        style={{ color: tone ? accent.text : "var(--st-text-1)" }}
      >
        {value}
      </div>
      {hint && <div className="text-[11.5px] text-t3 mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs, value, onChange,
}: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="mb-5 max-w-full overflow-x-auto">
      <div className="inline-flex gap-1 p-1 rounded-xl bg-surface-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { if (t.key !== value) animateSwitch("tab", () => onChange(t.key)); }}
            className={cn(
              "px-4 h-9 rounded-lg text-[13px] font-bold whitespace-nowrap transition-colors",
              value === t.key ? "bg-surface text-primary shadow-e1" : "text-t3 hover:text-t1"
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-[11px] text-t4 font-mono">{t.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Meter({ pct, tone = "brand" }: { pct: number; tone?: "brand" | "success" | "warning" | "danger" }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const bar = { brand: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** A section heading with an optional right-hand action. */
export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="text-[13px] font-semibold text-t1">{children}</div>
      {action}
    </div>
  );
}

/** Walk-in-friendly person picker: a name + phone. A known phone re-uses that customer server-side. */
export function PersonFields({
  label, name, phone, onName, onPhone, autoFocus,
}: { label: string; name: string; phone: string; onName: (v: string) => void; onPhone: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block">
        <span className="block text-[12px] font-semibold text-t2 mb-1.5">{label}</span>
        <input
          autoFocus={autoFocus}
          required
          value={name}
          onChange={(e) => onName(e.target.value)}
          className="w-full h-10 px-3 rounded-ctl bg-surface-2 border border-line-2 text-[13px] text-t1 placeholder:text-t4 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-primary-softer transition-colors"
        />
      </label>
      <label className="block">
        <span className="block text-[12px] font-semibold text-t2 mb-1.5">Phone</span>
        <input
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
          placeholder="080…"
          className="w-full h-10 px-3 rounded-ctl bg-surface-2 border border-line-2 text-[13px] text-t1 placeholder:text-t4 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-primary-softer transition-colors"
        />
        <span className="block text-[11px] text-t4 mt-1">A phone we already know re-uses that person.</span>
      </label>
    </div>
  );
}
