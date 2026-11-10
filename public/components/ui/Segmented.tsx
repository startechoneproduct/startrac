import { cn } from "@/lib/utils";
import { animateSwitch } from "@/lib/viewTransition";

/**
 * A row of view tabs (Open / Waiting / Completed…). `badge` puts a count on one
 * of them, e.g. the orders waiting for you.
 */
export function Segmented<K extends string>({ options, value, onChange, badge }: {
  options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; badge?: { key: K; count: number };
}) {
  return (
    <div className="inline-flex p-0.5 rounded-xl bg-surface-3">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => { if (k !== value) animateSwitch("tab", () => onChange(k)); }} aria-pressed={value === k}
          className={cn("h-8 px-3.5 rounded-[10px] text-[12.5px] font-semibold transition-colors", value === k ? "bg-surface text-t1 shadow-sm" : "text-t3 hover:text-t1")}>
          {label}
          {badge && badge.key === k && badge.count > 0 && <span className="ml-1.5 inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-warning text-white text-[10.5px]">{badge.count}</span>}
        </button>
      ))}
    </div>
  );
}
