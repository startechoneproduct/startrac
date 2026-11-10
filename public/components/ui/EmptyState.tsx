import type { LucideIcon } from "lucide-react";
import { SkeletonList } from "./Skeleton";

// Empty states teach — never a blank white screen.
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-10 h-10 rounded-lg border border-line bg-surface-2 text-t3 flex items-center justify-center mb-3.5">
        <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
      </div>
      <div className="text-[14px] font-semibold text-t1">{title}</div>
      {body && <p className="text-[13px] text-t3 mt-1 max-w-sm leading-relaxed">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// The app-wide "still loading" placeholder. It used to be a spinner; it now
// draws a shimmering skeleton list, so every page that shows it gets the
// shape of its content up front instead of a blank screen and a sudden pop.
export function Spinner({ rows }: { rows?: number } = {}) {
  return <SkeletonList rows={rows} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
      <div>
        <h1 className="text-[22px] leading-7 font-semibold text-t1">{title}</h1>
        {subtitle && <p className="text-[13px] text-t3 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
