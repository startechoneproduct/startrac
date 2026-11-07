import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2, ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui/EmptyState";
import { Pager } from "@/components/ui/Pager";
import { useApi } from "@/lib/useApi";
import { fmtDate } from "@/lib/format";
import { Avatar, EmptyBlock, PageHeader, Panel, Pill, SearchBox, Segmented, naira } from "./ui";
import { ExportButton } from "./ExportButton";

type Account = {
  id: string; name: string; plan: string; legacy: boolean; status: string; isSandbox: boolean; createdAt: string;
  owner: { name: string; email: string } | null;
  businesses: { id: string; name: string; typeLabel: string }[];
  revenue: number; txns: number; lastSaleAt: string | null;
};

const PER = 10;
// One grid template shared by the header and every row keeps the columns aligned.
const COLS = "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_96px_130px_120px_24px]";

export function AccountsTab({ onOpenAccount }: { onOpenAccount: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const [status, setStatus] = useState<"all" | "suspended">("all");
  const [page, setPage] = useState(1);

  function setQ(v: string) {
    const next = new URLSearchParams(params);
    if (v) next.set("q", v); else next.delete("q");
    setParams(next, { replace: true });
    setPage(1);
  }

  const { data, loading } = useApi<{ accounts: Account[]; page: number; pages: number; total: number }>(
    `/platform/accounts?limit=${PER}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}${status === "suspended" ? "&status=suspended" : ""}`,
    []
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto animate-fade-up">
      <PageHeader
        title="Accounts"
        subtitle="Every customer that has signed up. An account can own several businesses."
        actions={
          <>
            <Segmented value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "all", label: "All" }, { value: "suspended", label: "Suspended" }]} />
            <SearchBox value={q} onChange={setQ} placeholder="Search accounts…" className="w-64" />
            <ExportButton kind="accounts" />
          </>
        }
      />

      <Panel flush>
        {loading && !data ? (
          <div className="py-16"><Spinner /></div>
        ) : !data || data.accounts.length === 0 ? (
          <EmptyBlock icon={Building2} title="No accounts match" hint={q ? "Try a different search." : "Nothing here yet."} />
        ) : (
          <>
            <div className={`hidden lg:grid ${COLS} gap-4 px-5 h-10 items-center bg-surface-2 border-b border-line text-[11px] font-bold uppercase tracking-[0.1em] text-t4`}>
              <span>Account</span><span>Businesses</span><span>Plan</span><span className="text-right">Revenue</span><span>Last sale</span><span />
            </div>
            <div className="divide-y divide-line">
              {data.accounts.map((a) => (
                <button
                  key={a.id} onClick={() => onOpenAccount(a.id)}
                  className={`w-full grid grid-cols-[auto_minmax(0,1fr)_auto] ${COLS} gap-x-4 gap-y-1 items-center px-5 py-3.5 text-left hover:bg-surface-2 transition-colors`}
                >
                  <div className="flex items-center gap-3 min-w-0 col-span-2 lg:col-span-1">
                    <Avatar name={a.name} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-t1 truncate">{a.name}</span>
                        {a.status === "suspended" && <Pill tone="danger" dot>Suspended</Pill>}
                      </div>
                      <div className="text-[12px] text-t3 truncate">{a.owner?.email || "—"}</div>
                    </div>
                  </div>
                  <div className="hidden lg:block min-w-0">
                    <div className="text-[13px] text-t1 truncate">{a.businesses[0]?.name || "—"}</div>
                    <div className="text-[11.5px] text-t3 truncate">
                      {a.businesses.length > 1 ? `+${a.businesses.length - 1} more · ` : ""}{a.businesses[0]?.typeLabel}
                    </div>
                  </div>
                  <div className="hidden lg:block"><Pill tone={a.plan === "free" ? "neutral" : "brand"}>{a.plan}{a.legacy ? " · early" : ""}</Pill></div>
                  <div className="text-right col-start-3 row-start-1 lg:col-auto lg:row-auto">
                    <div className="text-[13.5px] font-semibold text-t1 tabular-nums">{naira(a.revenue)}</div>
                    <div className="text-[11px] text-t4 lg:hidden">{a.txns} sales</div>
                  </div>
                  <div className="hidden lg:block text-[12.5px] text-t3">{a.lastSaleAt ? fmtDate(a.lastSaleAt) : "No sales yet"}</div>
                  <ChevronRight className="hidden lg:block w-4 h-4 text-t4" />
                </button>
              ))}
            </div>
            <Pager
              page={data.page} pages={data.pages} total={data.total}
              from={(data.page - 1) * PER + 1} to={(data.page - 1) * PER + data.accounts.length}
              onPage={setPage} noun="accounts"
            />
          </>
        )}
      </Panel>
    </div>
  );
}
