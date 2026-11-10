import { cn } from "@/lib/utils";

/**
 * Loading placeholders. A soft shimmering block in the shape of what's coming,
 * so a page settles into place instead of flashing from blank to full.
 * Purely decorative: the wrapper announces "Loading" once for screen readers.
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("st-skel rounded-md", className)} style={style} />;
}

// Varied widths so the rows read as text, not a barcode.
const LINE_W = ["62%", "48%", "71%", "55%", "40%", "66%"];

/** The everyday list: avatar, two lines of text, a figure on the right. */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("bg-surface border border-line rounded-card overflow-hidden animate-fade-in", className)}>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="w-9 h-9 rounded-full shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-3" style={{ width: LINE_W[i % LINE_W.length] }} />
              <Skeleton className="h-2.5" style={{ width: `calc(${LINE_W[(i + 3) % LINE_W.length]} * 0.6)` }} />
            </div>
            <div className="shrink-0 flex flex-col items-end gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-2.5 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A row of stat tiles. */
export function SkeletonStats({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid grid-cols-2 gap-3 sm:gap-5", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-surface border border-line rounded-card p-5">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="w-8 h-8 rounded-lg" />
          </div>
          <Skeleton className="h-6 w-32 mb-2.5" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      ))}
    </div>
  );
}

/** The dashboard's first paint: header, tabs, revenue hero + tiles, then a list. */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard" className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto animate-fade-in">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div className="space-y-2.5">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3 w-72 max-w-[70vw]" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-ctl" />
          <Skeleton className="h-9 w-24 rounded-ctl" />
        </div>
      </div>
      <div className="flex gap-4 border-b border-line mb-6 pb-3 overflow-hidden">
        {[72, 96, 56, 70, 76, 80].map((w, i) => <Skeleton key={i} className="h-4 shrink-0" style={{ width: w }} />)}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 mb-5">
        <div className="xl:col-span-7 bg-surface border border-line rounded-card p-6">
          <Skeleton className="h-3 w-28 mb-4" />
          <Skeleton className="h-9 w-48 mb-6" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
        <SkeletonStats className="xl:col-span-5" />
      </div>
      <SkeletonList rows={4} />
    </div>
  );
}
