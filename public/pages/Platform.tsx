import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Spinner } from "@/components/ui/EmptyState";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { OverviewTab } from "@/pages/platform/OverviewTab";
import { AccountsTab } from "@/pages/platform/AccountsTab";
import { BusinessesTab } from "@/pages/platform/BusinessesTab";
import { SubscriptionsTab } from "@/pages/platform/SubscriptionsTab";
import { SupportTab } from "@/pages/platform/SupportTab";
import { TeamTab } from "@/pages/platform/TeamTab";
import { UsersTab } from "@/pages/platform/UsersTab";
import { ActivityTab } from "@/pages/platform/ActivityTab";
import { TenantDrawer } from "@/pages/platform/TenantDrawer";
import { EmptyBlock } from "@/pages/platform/ui";
import { isAdminTab } from "@/pages/platform/tabs";
import type { Overview } from "@/pages/platform/types";

/** Content of /admin/:tab — the shell around it lives in AdminShell. */
export function Platform() {
  const { session } = useSession();
  const { tab } = useParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const { data: ov, loading } = useApi<Overview>("/platform/overview", [version]);
  const isOverseer = session?.platformRole === "overseer";

  if (!isAdminTab(tab) || (tab === "team" && !isOverseer)) return <Navigate to="/admin/overview" replace />;
  if (loading && !ov) return <div className="p-10"><Spinner /></div>;
  if (!ov) return <EmptyBlock icon={ShieldAlert} title="No platform access" hint="This console is for StarTrack staff." />;

  return (
    <>
      {tab === "overview" && <OverviewTab ov={ov} onOpenAccount={setOpenId} />}
      {tab === "accounts" && <AccountsTab onOpenAccount={setOpenId} />}
      {tab === "businesses" && <BusinessesTab types={ov.byType} onOpenAccount={setOpenId} />}
      {tab === "subscriptions" && <SubscriptionsTab onOpenAccount={setOpenId} />}
      {tab === "users" && <UsersTab canAct={isOverseer} selfEmail={session?.user.email} />}
      {tab === "activity" && <ActivityTab onOpenAccount={setOpenId} />}
      {tab === "support" && <SupportTab />}
      {tab === "team" && <TeamTab selfEmail={session?.user.email} />}

      <TenantDrawer id={openId} canAct={isOverseer} onClose={() => setOpenId(null)} onChanged={() => setVersion((v) => v + 1)} />
    </>
  );
}
