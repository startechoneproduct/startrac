import { useLocation } from "react-router-dom";
import { useSession } from "@/lib/session";
import { typeMeta } from "@/lib/businessTypes";
import { buildNav, type NavGroup } from "@/lib/navItems";

/**
 * The navigation this person can actually use right now: sections gated by
 * role, children by role + switched-on modules + what the trade supports.
 * Shared by the header tabs and the sub-tab strip so they never disagree.
 */
export function useNavGroups(): { groups: NavGroup[]; active: NavGroup | undefined } {
  const { can, hasModule, hasCapability, hasFeature, activeBusiness } = useSession();
  const { pathname } = useLocation();

  const groups = buildNav(typeMeta(activeBusiness?.typeKey))
    .filter((g) => !g.perm || can(g.perm))
    .map((g) => ({
      ...g,
      // Pages the plan doesn't include stay visible, marked locked, so people
      // can see what an upgrade adds; opening one explains it.
      children: g.children
        ?.filter((c) => (!c.perm || can(c.perm)) && (!c.module || hasModule(c.module)) && (!c.capability || hasCapability(c.capability)))
        .map((c) => ({ ...c, locked: !!c.feature && !hasFeature(c.feature) })),
    }))
    // A section shows only if this person can open at least one of its pages,
    // and it opens on the first one their plan includes.
    .filter((g) => !g.children || g.children.length > 0)
    .map((g) => (g.children ? { ...g, to: (g.children.find((c) => !c.locked) ?? g.children[0]).to } : g))
    // A section with a single page is just that page; don't show a strip of one.
    .map((g) => ({ ...g, children: (g.children?.length ?? 0) > 1 ? g.children : undefined }));

  const active = groups.find((g) => pathname === g.to || (g.children?.some((c) => c.to === pathname) ?? false));
  return { groups, active };
}
