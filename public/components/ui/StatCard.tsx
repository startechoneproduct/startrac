import { useId } from "react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

export type Tone = "brand" | "success" | "warning" | "danger" | "neutral";

/**
 * One palette for every metric in the app: a gradient for the icon chip, a
 * whisper of the same colour washed across the card, and the accent used for
 * trend lines. Keeping it in one table is what makes the tiles read as a set.
 */
export const TONES: Record<Tone, { chip: string; tint: string; glow: string; text: string; accent: string }> = {
  brand:   { chip: "linear-gradient(135deg, #3538f0, #7b3cf5)", tint: "rgba(53, 56, 240, 0.07)",   glow: "rgba(59, 63, 245, 0.55)",  text: "var(--st-primary)", accent: "var(--st-gradient-primary)" },
  success: { chip: "linear-gradient(135deg, #0f9f6e, #3cc99a)", tint: "rgba(15, 159, 110, 0.08)",  glow: "rgba(15, 159, 110, 0.5)",  text: "var(--st-success)", accent: "linear-gradient(180deg, #0f9f6e, #3cc99a)" },
  warning: { chip: "linear-gradient(135deg, #cc9933, #ecbb55)", tint: "rgba(204, 153, 51, 0.10)",  glow: "rgba(204, 153, 51, 0.5)",  text: "var(--st-warning)", accent: "linear-gradient(180deg, #cc9933, #ecbb55)" },
  danger:  { chip: "linear-gradient(135deg, #d02b3c, #f26a78)", tint: "rgba(208, 43, 60, 0.07)",   glow: "rgba(208, 43, 60, 0.45)",  text: "var(--st-danger)",  accent: "linear-gradient(180deg, #d02b3c, #f26a78)" },
  neutral: { chip: "linear-gradient(135deg, #4a5070, #8189ad)", tint: "rgba(111, 116, 146, 0.08)", glow: "rgba(74, 80, 112, 0.45)",  text: "var(--st-text-1)",  accent: "linear-gradient(180deg, #4a5070, #8189ad)" },
};

/** A percentage change, green when up and red when down. */
export function DeltaChip({ value, onDark = false, className }: { value: number; onDark?: boolean; className?: string }) {
  if (!value) return null;
  const up = value > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 px-2 py-[3px] rounded-full text-[11.5px] font-bold leading-none",
        onDark ? "bg-white/15 text-white" : up ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
        className
      )}
    >
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {up ? "+" : ""}{value}%
    </span>
  );
}

/**
 * A headline metric. The label leads, the figure is the loudest thing on the
 * card, the icon sits in a gradient chip, and the foot carries the change and
 * a hint. `delta`/`trend` (a ready-made string) and `change` (a number) both
 * exist so older call sites keep working.
 */
export function StatCard({
  label, value, icon: Icon, tone = "brand", change, delta, trend, hint, spark, valueTone, className,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: Tone;
  change?: number;
  delta?: string;
  trend?: "up" | "down";
  hint?: string;
  spark?: number[];
  valueTone?: Tone;
  className?: string;
  index?: number; // accepted for call-site compatibility
}) {
  const gradientId = `spark-${useId()}`;
  const sparkData = (spark ?? []).map((v, i) => ({ i, v }));
  const t = TONES[tone];
  const up = trend === "up";
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-card border border-line bg-surface p-4 sm:p-5 shadow-e1 min-w-0",
        "transition-[box-shadow,transform] duration-200 hover:shadow-lg2 hover:-translate-y-0.5",
        className
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${t.tint} 0%, transparent 58%)` }}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <div className="text-[12px] sm:text-[12.5px] font-semibold text-t3 truncate">{label}</div>
          <div
            className={cn("mt-2 leading-none font-bold font-mono truncate tracking-[-0.02em]", value.length > 12 ? "text-[17px] sm:text-[21px]" : value.length > 9 ? "text-[19px] sm:text-[24px]" : "text-[22px] sm:text-[28px]")}
            style={{ color: valueTone ? TONES[valueTone].text : "var(--st-text-1)" }}
          >
            {value}
          </div>
        </div>
        <span
          className="grid place-items-center w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl text-white shrink-0"
          style={{ background: t.chip, boxShadow: `0 10px 18px -10px ${t.glow}` }}
        >
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.9} />
        </span>
      </div>

      {(change !== undefined || delta || hint) && (
        <div className="mt-3 sm:mt-3.5 flex items-center gap-x-2 gap-y-1 min-h-[20px] flex-wrap">
          {change !== undefined && <DeltaChip value={change} />}
          {delta && (
            <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-bold", up ? "text-success" : "text-danger")}>
              {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
              {delta}
            </span>
          )}
          {hint && <span className="text-[12px] text-t3 truncate">{hint}</span>}
        </div>
      )}

      {sparkData.length > 1 && (
        <div className="h-9 mt-3 -mb-1 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={2} fill={`url(#${gradientId})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
