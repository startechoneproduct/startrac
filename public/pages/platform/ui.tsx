import { useId, useState, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";
import { TONES as APP_TONES } from "@/components/ui/StatCard";

// The console's own figure colours: StarTechOne blue leads, its orange stands in for gold.
const TONES = {
  ...APP_TONES,
  brand: { ...APP_TONES.brand, chip: "linear-gradient(135deg, #2557ad, #3a72d1)", tint: "rgba(37, 87, 173, 0.07)", glow: "rgba(37, 87, 173, 0.5)" },
  warning: { ...APP_TONES.warning, chip: "linear-gradient(135deg, #ec782e, #f39a5c)", tint: "rgba(236, 120, 46, 0.09)", glow: "rgba(236, 120, 46, 0.5)" },
  neutral: { ...APP_TONES.neutral, chip: "linear-gradient(135deg, #3c4a63, #7d8aa3)", tint: "rgba(60, 74, 99, 0.07)" },
};

/* Shared building blocks for the platform console. Everything reads the app's
   design tokens, so light and dark mode both work without extra code. */

/** Whole naira — pennies are noise on a platform-wide screen. */
export const naira = (n: number) => fmtMoney(Math.round(n), "₦");

export function compactMoney(n: number, symbol = "₦") {
  const abs = Math.abs(n);
  const fmt = (v: number, s: string) => `${symbol}${(Math.round(v * 10) / 10).toString().replace(/\.0$/, "")}${s}`;
  if (abs >= 1e9) return fmt(n / 1e9, "B");
  if (abs >= 1e6) return fmt(n / 1e6, "M");
  if (abs >= 1e3) return fmt(n / 1e3, "K");
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-7 font-semibold text-t1">{title}</h1>
        {subtitle && <p className="text-[13px] text-t3 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Panel({ title, subtitle, action, children, className, flush }: {
  title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <section className={cn("bg-surface border border-line rounded-card shadow-e1 overflow-hidden min-w-0", className)}>
      {(title || action) && (
        <header className={cn("flex items-center justify-between gap-3 px-5 py-4", flush && "border-b border-line")}>
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-bold text-t1 leading-tight truncate">{title}</h2>}
            {subtitle && <p className="text-[12.5px] text-t3 mt-0.5 truncate">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={flush ? "" : "px-5 pb-5"}>{children}</div>
    </section>
  );
}

type Tone = "brand" | "success" | "warning" | "danger" | "neutral";
const TONE_CHIP: Record<Tone, string> = {
  brand: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-3 text-t2",
};

export function Pill({ tone = "neutral", dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full text-[11.5px] font-semibold capitalize whitespace-nowrap", TONE_CHIP[tone], className)}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#2557ad,#3a72d1)",
  "linear-gradient(135deg,#ec782e,#f39a5c)",
  "linear-gradient(135deg,#0f9f6e,#3cc99a)",
  "linear-gradient(135deg,#d02b3c,#f26a78)",
  "linear-gradient(135deg,#1f6fd1,#5ca8f0)",
  "linear-gradient(135deg,#4a5070,#8189ad)",
];

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn("shrink-0 grid place-items-center rounded-xl font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length] }}
    >
      {name.trim()[0]?.toUpperCase() || "?"}
    </span>
  );
}

export function Sparkline({ values, color = "var(--st-primary)", className }: { values: number[]; color?: string; className?: string }) {
  const id = `sp${useId().replace(/:/g, "")}`;
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const W = 100, H = 32;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 3 - (v / max) * (H - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("w-full h-8", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A headline figure, drawn exactly like the business dashboard's StatCard. */
export function KpiCard({ icon: Icon, label, value, sub, tone = "brand", spark, sparkColor }: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string; value: string; sub?: ReactNode; tone?: Tone; spark?: number[]; sparkColor?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      className="group relative overflow-hidden rounded-card border border-line bg-surface p-4 sm:p-5 shadow-e1 min-w-0 transition-[box-shadow,transform] duration-200 hover:shadow-lg2 hover:-translate-y-0.5"
      style={{ backgroundImage: `linear-gradient(135deg, ${t.tint} 0%, transparent 58%)` }}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <div className="text-[12px] sm:text-[12.5px] font-semibold text-t3 truncate">{label}</div>
          <div className={cn("mt-2 leading-none font-bold font-mono truncate tracking-[-0.02em] text-t1 tabular-nums", value.length > 11 ? "text-[16px] sm:text-[20px]" : value.length > 7 ? "text-[19px] sm:text-[23px]" : "text-[22px] sm:text-[28px]")}>{value}</div>
        </div>
        <span className="grid place-items-center w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl text-white shrink-0" style={{ background: t.chip, boxShadow: `0 10px 18px -10px ${t.glow}` }}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.9} />
        </span>
      </div>
      {sub && <div className="mt-3 sm:mt-3.5 text-[11.5px] sm:text-[12px] text-t3 truncate min-h-[20px] flex items-center">{sub}</div>}
      {spark && spark.length > 1 && <div className="mt-3 -mx-1"><Sparkline values={spark} color={sparkColor} /></div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex p-0.5 rounded-xl bg-surface-3 gap-0.5" role="group">
      {options.map((o) => (
        <button
          key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={cn(
            "h-8 px-3 rounded-[10px] text-[12.5px] font-semibold transition-colors",
            value === o.value ? "bg-surface text-t1 shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-t3 hover:text-t1"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Smooth area chart with a hover read-out. Pure SVG, no chart library. */
export function AreaChart({ values, labels, color = "var(--st-primary)", format = (n: number) => n.toLocaleString(), height = 176, dark }: {
  values: number[]; labels: string[]; color?: string; format?: (n: number) => string; height?: number; dark?: boolean;
}) {
  const id = `ac${useId().replace(/:/g, "")}`;
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  if (n < 2) return null;
  const W = 600, H = height, pad = 10;
  const max = Math.max(1, ...values) * 1.12;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  let d = `M${x(0)},${y(values[0])}`;
  for (let i = 1; i < n; i++) {
    const mx = (x(i - 1) + x(i)) / 2;
    d += ` C${mx},${y(values[i - 1])} ${mx},${y(values[i])} ${x(i)},${y(values[i])}`;
  }

  return (
    <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" role="img" aria-label="Trend chart">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.30" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke={dark ? "rgba(255,255,255,0.12)" : "var(--st-border)"} strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="absolute inset-0 flex">
        {values.map((_, i) => (
          <div key={i} className="flex-1" onMouseEnter={() => setHover(i)} />
        ))}
      </div>

      {hover !== null && (
        <>
          <div className={cn("absolute top-0 bottom-0 w-px pointer-events-none", dark ? "bg-white/25" : "bg-line-2")} style={{ left: `${(hover / (n - 1)) * 100}%` }} />
          <div
            className={cn("absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full border-2 pointer-events-none", dark ? "border-ink" : "border-surface")}
            style={{ left: `${(hover / (n - 1)) * 100}%`, top: `${(y(values[hover]) / H) * 100}%`, background: color }}
          />
          <div
            className={cn("absolute z-10 -translate-x-1/2 pointer-events-none rounded-lg px-2.5 py-1.5 text-[11.5px] shadow-lg2 whitespace-nowrap", dark ? "bg-white text-ink" : "bg-ink text-white")}
            style={{
              left: `clamp(48px, ${(hover / (n - 1)) * 100}%, calc(100% - 48px))`,
              top: `max(0px, calc(${(y(values[hover]) / H) * 100}% - 46px))`,
            }}
          >
            <div className={dark ? "text-ink/60" : "text-white/60"}>{labels[hover]}</div>
            <div className="font-semibold tabular-nums">{format(values[hover])}</div>
          </div>
        </>
      )}
    </div>
  );
}

export function BarChart({ values, labels, color = "var(--st-primary)", format = (n: number) => n.toLocaleString(), height = 176 }: {
  values: number[]; labels: string[]; color?: string; format?: (n: number) => string; height?: number;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label="Bar chart">
      {values.map((v, i) => (
        <div key={i} className="group relative flex-1 h-full flex items-end min-w-0">
          <div
            className="w-full rounded-t-[4px] transition-[filter] group-hover:brightness-110"
            style={{ height: v === 0 ? 3 : `${Math.max(5, (v / max) * 100)}%`, background: color, opacity: v === 0 ? 0.22 : 1 }}
          />
          <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-10 rounded-lg bg-ink text-white px-2.5 py-1.5 text-[11.5px] shadow-lg2 whitespace-nowrap">
            <div className="text-white/60">{labels[i]}</div>
            <div className="font-semibold tabular-nums">{format(v)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Donut({ segments, size = 148, centre }: {
  segments: { label: string; value: number; color: string }[]; size?: number; centre?: ReactNode;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 52, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90" role="img" aria-label="Plan mix">
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--st-surface-3)" strokeWidth="14" />
        {total > 0 && segments.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={s.label} cx="64" cy="64" r={r} fill="none" stroke={s.color} strokeWidth="14" strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`} strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {centre && <div className="absolute inset-0 grid place-items-center text-center">{centre}</div>}
    </div>
  );
}

export function EmptyBlock({ icon: Icon, title, hint }: { icon: ComponentType<{ className?: string }>; title: string; hint?: string }) {
  return (
    <div className="py-12 px-6 text-center">
      <span className="mx-auto mb-3 grid place-items-center w-11 h-11 rounded-2xl bg-surface-3 text-t3"><Icon className="w-5 h-5" /></span>
      <div className="text-[13.5px] font-semibold text-t1">{title}</div>
      {hint && <div className="text-[12.5px] text-t3 mt-1">{hint}</div>}
    </div>
  );
}

/** A table-ish row used by every list so spacing and hover feel identical. */
export function RowButton({ onClick, children, className }: { onClick?: () => void; children: ReactNode; className?: string }) {
  const cls = cn("w-full flex items-center gap-3.5 px-5 py-3.5 text-left transition-colors", onClick && "hover:bg-surface-2 cursor-pointer", className);
  return onClick ? <button type="button" onClick={onClick} className={cls}>{children}</button> : <div className={cls}>{children}</div>;
}

export function SearchBox({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={cn("relative block", className)}>
      <span className="sr-only">{placeholder}</span>
      <svg viewBox="0 0 24 24" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-10 pl-10 pr-3.5 rounded-xl bg-surface border border-line-2 text-[13px] text-t1 placeholder:text-t4 hover:border-t4 focus:outline-none focus:border-primary focus:shadow-[var(--st-focus-ring)] transition-[border-color,box-shadow]"
      />
    </label>
  );
}
