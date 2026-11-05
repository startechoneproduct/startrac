import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Headphones, LifeBuoy, MessageSquare } from "lucide-react";
import { Spinner } from "@/components/ui/EmptyState";
import { Pager } from "@/components/ui/Pager";
import { useApi } from "@/lib/useApi";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyBlock, PageHeader, Panel, Pill, Segmented } from "./ui";

type T = {
  id: string; ticketNo: string; subject: string; description: string; category: string;
  priority: string; status: string; businessName: string; comments: unknown[]; escalatedAt: string | null;
};

const PRIORITY: Record<string, { tone: "danger" | "warning" | "neutral"; bar: string }> = {
  urgent: { tone: "danger", bar: "var(--st-danger)" },
  high: { tone: "warning", bar: "var(--st-warning)" },
};
const STATUS_TONE: Record<string, "brand" | "warning" | "success" | "neutral"> = {
  open: "brand", in_progress: "warning", resolved: "success", closed: "neutral",
};
const PER = 20;

export function SupportTab() {
  const [status, setStatus] = useState<"" | "open" | "in_progress" | "resolved">("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, loading } = useApi<{ tickets: T[]; page: number; pages: number; total: number }>(
    `/platform/tickets?limit=${PER}&page=${page}${status ? `&status=${status}` : ""}`,
    []
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1100px] mx-auto animate-fade-up">
      <PageHeader
        title="Support"
        subtitle="Requests businesses sent to StarTrack. Answer, assign and resolve them in the support desk."
        actions={
          <>
          <Link to="/desk" className="inline-flex items-center gap-2 h-9 px-3 rounded-[10px] bg-primary text-white text-[12.5px] font-semibold"><Headphones className="w-4 h-4" /> Open support desk</Link>
          <Segmented value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
            { value: "", label: "All" }, { value: "open", label: "Open" }, { value: "in_progress", label: "In progress" }, { value: "resolved", label: "Resolved" },
          ]} />
          </>
        }
      />

      <Panel flush>
        {loading && !data ? (
          <div className="py-16"><Spinner /></div>
        ) : !data || data.tickets.length === 0 ? (
          <EmptyBlock icon={LifeBuoy} title="Nothing escalated" hint="You're all caught up." />
        ) : (
          <>
            <div className="divide-y divide-line">
              {data.tickets.map((t) => {
                const p = PRIORITY[t.priority];
                const isOpen = openId === t.id;
                return (
                  <div key={t.id} className="relative">
                    <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: p?.bar || "transparent" }} />
                    <button onClick={() => setOpenId(isOpen ? null : t.id)} aria-expanded={isOpen} className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-surface-2 transition-colors">
                      <span className="grid place-items-center w-9 h-9 rounded-xl bg-primary-soft text-primary shrink-0 mt-0.5"><MessageSquare className="w-4 h-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13.5px] font-semibold text-t1">{t.subject}</span>
                          <Pill tone={STATUS_TONE[t.status] || "neutral"} dot>{t.status.replace("_", " ")}</Pill>
                          {p && <Pill tone={p.tone}>{t.priority}</Pill>}
                        </div>
                        <div className="text-[12px] text-t3 mt-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                          <span className="font-mono text-t4">{t.ticketNo}</span><span>·</span>
                          <span className="font-medium text-t2">{t.businessName}</span><span>·</span>
                          <span className="capitalize">{t.category}</span><span>·</span>
                          <span>{t.comments.length} {t.comments.length === 1 ? "comment" : "comments"}</span>
                          {t.escalatedAt && <><span>·</span><span>escalated {fmtDateTime(t.escalatedAt)}</span></>}
                        </div>
                      </div>
                      <ChevronDown className={cn("w-4 h-4 text-t4 mt-2 transition-transform shrink-0", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-5 pl-[72px] -mt-1">
                        <div className="rounded-xl bg-surface-2 border border-line p-4 text-[13px] leading-relaxed text-t2 whitespace-pre-wrap">{t.description || "No description."}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Pager
              page={data.page} pages={data.pages} total={data.total}
              from={(data.page - 1) * PER + 1} to={(data.page - 1) * PER + data.tickets.length}
              onPage={setPage} noun="tickets"
            />
          </>
        )}
      </Panel>
    </div>
  );
}
