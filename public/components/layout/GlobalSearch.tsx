import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Compass, Package, Users, Receipt, UserCog, ReceiptText, Loader2, CornerDownLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { typeMeta } from "@/lib/businessTypes";
import { flattenNav } from "@/lib/navItems";
import { fmtMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Category = "page" | "product" | "customer" | "sale" | "staff" | "expense";
type Result = {
  category: Category; id: string; label: string; route: string;
  sub?: string; // pre-formatted detail line, shown under the label
};
type ApiResult = {
  category: Exclude<Category, "page">; id: string; label: string; route: string;
  meta: Record<string, any>;
};

const CATEGORY_META: Record<Category, { icon: React.ComponentType<{ className?: string }>; heading: string }> = {
  page: { icon: Compass, heading: "Go to" },
  product: { icon: Package, heading: "Products" },
  customer: { icon: Users, heading: "Customers" },
  sale: { icon: Receipt, heading: "Sales" },
  staff: { icon: UserCog, heading: "Staff" },
  expense: { icon: ReceiptText, heading: "Expenses" },
};
const ORDER: Category[] = ["page", "product", "customer", "sale", "staff", "expense"];

/**
 * The header's "search for anything" box: instantly matches every page/module
 * the signed-in role can actually reach (public/lib/navItems.ts, shared with
 * the Sidebar so the two can't drift), plus a debounced live search across
 * products, customers, sales, staff and expenses (server/modules/search).
 * Each data result deep-links to the page that already knows how to filter
 * down to it (Products/Customers ?q=, Sales ?saleNo=) — see those pages'
 * useSearchParams sync.
 */
/**
 * `mobile`: the phone version, opened from the top bar's search button. It
 * spans the bar, focuses straight away, and calls `onDone` once a result is
 * picked or Esc is pressed so the top bar can put its buttons back.
 */
export function GlobalSearch({ mobile = false, onDone }: { mobile?: boolean; onDone?: () => void } = {}) {
  const navigate = useNavigate();
  const { can, currency, activeBusiness } = useSession();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [apiResults, setApiResults] = useState<ApiResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const pages = useMemo(() => flattenNav(typeMeta(activeBusiness?.typeKey)).filter((n) => !n.perm || can(n.perm)), [activeBusiness?.typeKey, can]);

  // Ctrl/Cmd+K focuses search from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // Debounced live search against real data; page matches are instant and
  // computed separately below, so they never wait on the network.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setApiResults([]); setLoading(false); return; }
    setLoading(true);
    const mySeq = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const r = await api<{ results: ApiResult[] }>(`/search?q=${encodeURIComponent(term)}`);
        if (seq.current === mySeq) setApiResults(r.results);
      } catch {
        if (seq.current === mySeq) setApiResults([]);
      } finally {
        if (seq.current === mySeq) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const matchedPages: Result[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return pages
      .filter((p) => p.label.toLowerCase().includes(term))
      .slice(0, 5)
      .map((p) => ({ category: "page" as const, id: p.to, label: p.label, route: p.to }));
  }, [q, pages]);

  const dataResults: Result[] = useMemo(
    () =>
      apiResults.map((r) => {
        let sub = "";
        if (r.category === "product") sub = [r.meta.category, r.meta.price != null ? fmtMoney(r.meta.price, currency) : ""].filter(Boolean).join(" · ");
        else if (r.category === "customer") sub = r.meta.phone || "";
        else if (r.category === "sale") sub = [r.meta.customerName, fmtMoney(r.meta.total, currency), fmtDate(r.meta.at)].filter(Boolean).join(" · ");
        else if (r.category === "staff") sub = r.meta.role || "";
        else if (r.category === "expense") sub = [fmtMoney(r.meta.amount, currency), fmtDate(r.meta.at)].filter(Boolean).join(" · ");
        return { category: r.category, id: r.id, label: r.label, route: r.route, sub };
      }),
    [apiResults, currency]
  );

  const grouped = useMemo(() => {
    const all = [...matchedPages, ...dataResults];
    return ORDER.map((cat) => ({ cat, items: all.filter((r) => r.category === cat) })).filter((g) => g.items.length);
  }, [matchedPages, dataResults]);

  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  useEffect(() => { setHighlight(0); }, [q]);

  function go(r: Result) {
    navigate(r.route);
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
    onDone?.();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); onDone?.(); return; }
    if (!open || !flat.length) {
      if (e.key === "Enter" && q.trim()) {
        // No matches at all yet (or still loading) — the catalog is the
        // most likely place anything typed here actually lives.
        navigate(`/app/products?q=${encodeURIComponent(q.trim())}`);
        setQ(""); setOpen(false); inputRef.current?.blur(); onDone?.();
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(flat[highlight] ?? flat[0]); }
  }

  const term = q.trim();
  let runningIndex = -1;

  return (
    <div ref={boxRef} className={mobile ? "flex-1 relative" : "flex-1 max-w-md relative max-sm:hidden"} data-tour={mobile ? undefined : "topbar-search"}>
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-t3 pointer-events-none" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoFocus={mobile}
        enterKeyHint="search"
        placeholder={mobile ? "Search products, customers, sales…" : "Search anything… (Ctrl+K)"}
        className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-3 border border-transparent text-[13px] text-t1 placeholder:text-t3 focus:outline-none focus:border-primary focus:bg-surface focus:shadow-[var(--st-focus-ring)] transition-[border-color,box-shadow,background-color]"
      />

      {open && term.length >= 2 && (
        <div className="absolute top-full mt-1.5 left-0 right-0 pop border border-line-2 rounded-xl shadow-e2 py-1.5 z-50 max-h-[70vh] overflow-y-auto">
          {loading && !flat.length && (
            <div className="flex items-center gap-2 px-3.5 py-4 text-[12.5px] text-t4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
            </div>
          )}
          {!loading && !flat.length && (
            <div className="px-3.5 py-4 text-[12.5px] text-t4">No matches for "{term}" — press Enter to search the catalog.</div>
          )}
          {grouped.map((g) => {
            const Meta = CATEGORY_META[g.cat];
            return (
              <div key={g.cat} className="mb-1 last:mb-0">
                <div className="px-3.5 pt-1.5 pb-1 text-[11.5px] font-medium text-t4">{Meta.heading}</div>
                {g.items.map((r) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  const Icon = CATEGORY_META[r.category].icon;
                  return (
                    <button
                      key={`${r.category}-${r.id}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(r)}
                      onMouseEnter={() => setHighlight(idx)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors",
                        idx === highlight ? "bg-primary-soft" : "hover:bg-surface-2"
                      )}
                    >
                      <Icon className="w-4 h-4 text-primary shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-t1 truncate">{r.label}</span>
                        {r.sub && <span className="block text-[11px] text-t4 truncate">{r.sub}</span>}
                      </span>
                      {idx === highlight && <CornerDownLeft className="w-3.5 h-3.5 text-t4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
