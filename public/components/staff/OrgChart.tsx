import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Crown, MapPin, Network, Users } from "lucide-react";
import { EmptyState, Spinner } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";

export type OrgNode = {
  id: string; name: string; position: string; role: string; branchName: string;
  /** True when nobody was named as this person's manager, so they're shown under the owner. */
  inferred: boolean; children: OrgNode[];
};

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", staff: "Staff" };
const ROLE_TONE: Record<string, string> = {
  owner: "bg-primary text-white",
  admin: "bg-primary-soft text-primary",
  manager: "bg-warning-soft text-warning",
  staff: "bg-surface-3 text-t2",
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const countAll = (n: OrgNode): number => 1 + n.children.reduce((t, c) => t + countAll(c), 0);
const idsWithKids = (nodes: OrgNode[]): string[] => nodes.flatMap((n) => (n.children.length ? [n.id, ...idsWithKids(n.children)] : []));

function Person({ node, collapsed, toggle }: { node: OrgNode; collapsed: Set<string>; toggle: (id: string) => void }) {
  const kids = node.children.length;
  const closed = collapsed.has(node.id);
  return (
    <li>
      <div
        data-testid="org-node" data-name={node.name} data-role={node.role}
        title={node.inferred ? "No manager has been set, so they're shown under the owner" : undefined}
        className={cn("relative inline-flex flex-col items-center w-[176px] rounded-2xl border bg-surface px-3 pt-4 pb-3 shadow-e1 text-center", node.role === "owner" ? "border-primary" : "border-line")}
      >
        <span className={cn("grid place-items-center w-11 h-11 rounded-full text-[14px] font-bold", node.role === "owner" ? "bg-primary text-white" : "bg-primary-soft text-primary")}>
          {node.role === "owner" ? <Crown className="w-5 h-5" /> : initials(node.name)}
        </span>
        <div className="mt-2 text-[13.5px] font-semibold text-t1 leading-tight break-words w-full">{node.name || "Unnamed"}</div>
        <div className="mt-0.5 text-[11.5px] text-t3 min-h-[16px] w-full truncate">{node.position || " "}</div>
        <span className={cn("mt-1.5 px-2 py-[2px] rounded-full text-[10px] font-bold uppercase tracking-wide", ROLE_TONE[node.role] || ROLE_TONE.staff)}>{ROLE_LABEL[node.role] || node.role}</span>
        {node.branchName && <div className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-t4 max-w-full"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate">{node.branchName}</span></div>}
        {kids > 0 && (
          <button
            type="button" onClick={() => toggle(node.id)} aria-expanded={!closed} aria-label={`${closed ? "Show" : "Hide"} the ${kids} ${kids === 1 ? "person" : "people"} who report to ${node.name}`}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-0.5 h-6 px-2 rounded-full border border-line-2 bg-surface text-[11px] font-semibold text-t2 hover:text-primary hover:border-primary z-10"
          >
            {closed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{kids}
          </button>
        )}
      </div>
      {kids > 0 && !closed && (
        <ul>
          {node.children.map((c) => <Person key={c.id} node={c} collapsed={collapsed} toggle={toggle} />)}
        </ul>
      )}
    </li>
  );
}

/**
 * The company as a top-down chart: the owner at the top, and everyone under the
 * person they report to. A read view (positions and "reports to" are set on each
 * staff member), fetched fresh each time it opens. Branches of the tree can be
 * folded away to look at one team.
 */
export function OrgChart({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, loading } = useApi<{ chart: OrgNode[]; total: number }>(open ? "/staff/org-chart" : null, [open]);
  const roots = useMemo(() => data?.chart || [], [data]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const people = roots.reduce((t, r) => t + countAll(r), 0);
  const foldable = useMemo(() => idsWithKids(roots), [roots]);

  return (
    <Modal open={open} onClose={onClose} title="Organization chart" subtitle="Who reports to whom. Set a Position and Reports to on each staff member to shape it." wide>
      {loading ? (
        <div className="py-12"><Spinner /></div>
      ) : roots.length === 0 ? (
        <EmptyState icon={Network} title="Nothing to chart yet" body="Add your team, then set a Position and Reports to on each person to build this out." />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-[12.5px] text-t3">
            <span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4" /> {people} {people === 1 ? "person" : "people"}</span>
            {foldable.length > 0 && (
              <span className="ml-auto flex gap-2">
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setCollapsed(new Set())}>Expand all</button>
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setCollapsed(new Set(foldable))}>Collapse all</button>
              </span>
            )}
          </div>
          <div className="overflow-auto max-h-[68vh] rounded-2xl border border-line bg-surface-2 px-4 pt-6 pb-8" data-testid="org-chart">
            <div className="org-tree min-w-max mx-auto">
              <ul>
                {roots.map((r) => <Person key={r.id} node={r} collapsed={collapsed} toggle={toggle} />)}
              </ul>
            </div>
          </div>
          <p className="text-[11.5px] text-t4">Anyone without a manager set is shown under the owner. Positions are labels only; they don't change what a person can do.</p>
        </div>
      )}
    </Modal>
  );
}
