import { useState } from "react";
import { ChevronRight, Store } from "lucide-react";
import { Spinner } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { Pager } from "@/components/ui/Pager";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";
import { Avatar, EmptyBlock, PageHeader, Panel, Pill, SearchBox, naira } from "./ui";
import { ExportButton } from "./ExportButton";

type Row = {
  id: string; accountId: string; name: string; typeKey: string; typeLabel: string;
  accountName: string; plan: string; accountStatus: string; people: number;
  txns: number; revenue30d: number; lastSaleAt: string | null; createdAt: string;
};

const DAY = 86_400_000;
const PER = 10;
const COLS = "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_120px_130px_120px_24px]";

// A business that has sold before but not in a fortnight is the early sign of churn.
function health(r: Row): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (r.accountStatus === "suspended") return { label: "Suspended", tone: "danger" };
  if (!r.lastSaleAt) return { label: "No sales yet", tone: "neutral" };
  const idle = (Date.now() - new Date(r.lastSaleAt).getTime()) / DAY;
  if (idle <= 7) return { label: "Active", tone: "success" };
  if (idle <= 30) return { label: "Slowing", tone: "warning" };
  return { label: "Dormant", tone: "danger" };
}

export function BusinessesTab({ types, onOpenAccount }: {
  types: { typeKey: string; label: string }[];
  onOpenAccount: (accountId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [typeKey, setTypeKey] = useState("");
  const [page, setPage] = useState(1);

  const { data, loading } = useApi<{ businesses: Row[]; page: number; pages: number; total: number }>(
    `/platform/businesses?limit=${PER}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}${typeKey ? `&typeKey=${typeKey}` : ""}`,
    []
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto animate-fade-up">
      <PageHeader
        title="Businesses"
        subtitle="Every shop, restaurant and studio running on StarTrack, with how recently it traded."
        actions={
          <>
            <Select value={typeKey} onChange={(e) => { setTypeKey(e.target.value); setPage(1); }} className="!w-48 !h-10">
              <option value="">All trades</option>
              {types.map((t) => <option key={t.typeKey} value={t.typeKey}>{t.label}</option>)}
            </Select>
            <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search businesses…" className="w-64" />
            <ExportButton kind="businesses" />
          </>
        }
      />

      <Panel flush>
        {loading && !data ? (
          <div className="py-16"><Spinner /></div>
        ) : !data || data.businesses.length === 0 ? (
          <EmptyBlock icon={Store} title="No businesses match" hint="Try a different trade or search." />
        ) : (
          <>
            <div className={`hidden lg:grid ${COLS} gap-4 px-5 h-10 items-center bg-surface-2 border-b border-line text-[11px] font-bold uppercase tracking-[0.1em] text-t4`}>
              <span>Business</span><span>Account</span><span>Status</span><span className="text-right">30-day volume</span><span>Last sale</span><span />
            </div>
            <div className="divide-y divide-line">
              {data.businesses.map((b) => {
                const h = health(b);
                return (
                  <button
                    key={b.id} onClick={() => onOpenAccount(b.accountId)}
                    className={`w-full grid grid-cols-[auto_minmax(0,1fr)_auto] ${COLS} gap-x-4 gap-y-1 items-center px-5 py-3.5 text-left hover:bg-surface-2 transition-colors`}
                  >
                    <div className="flex items-center gap-3 min-w-0 col-span-2 lg:col-span-1">
                      <Avatar name={b.name} />
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-semibold text-t1 truncate">{b.name}</div>
                        <div className="text-[12px] text-t3 truncate">{b.typeLabel} · {b.people} {b.people === 1 ? "person" : "people"}</div>
                      </div>
                    </div>
                    <div className="hidden lg:block min-w-0">
                      <div className="text-[13px] text-t1 truncate">{b.accountName}</div>
                      <div className="text-[11.5px] text-t3 capitalize">{b.plan} plan · joined {fmtDate(b.createdAt)}</div>
                    </div>
                    <div className="hidden lg:block"><Pill tone={h.tone} dot>{h.label}</Pill></div>
                    <div className="text-right col-start-3 row-start-1 lg:col-auto lg:row-auto">
                      <div className="text-[13.5px] font-semibold text-t1 tabular-nums">{naira(b.revenue30d)}</div>
                      <div className="lg:hidden mt-0.5"><Pill tone={h.tone} dot>{h.label}</Pill></div>
                    </div>
                    <div className="hidden lg:block text-[12.5px] text-t3">{b.lastSaleAt ? fmtDate(b.lastSaleAt) : "—"}</div>
                    <ChevronRight className="hidden lg:block w-4 h-4 text-t4" />
                  </button>
                );
              })}
            </div>
            <Pager
              page={data.page} pages={data.pages} total={data.total}
              from={(data.page - 1) * PER + 1} to={(data.page - 1) * PER + data.businesses.length}
              onPage={setPage} noun="businesses"
            />
          </>
        )}
      </Panel>
    </div>
  );
}
