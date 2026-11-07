import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { RequireAuth, RequirePlatform, useSession } from "@/lib/session";
import { AdminShell } from "@/components/layout/AdminShell";
import { Landing } from "@/pages/Landing";
import { Docs } from "@/pages/Docs";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";
import { LoyaltyCardView } from "@/pages/LoyaltyCardView";
import { Dashboard } from "@/pages/Dashboard";
import { AllStores } from "@/pages/AllStores";
import { StaffHome } from "@/pages/StaffHome";
import { POS } from "@/pages/POS";
import { Sales } from "@/pages/Sales";
import { Products } from "@/pages/Products";
import { StockIn } from "@/pages/StockIn";
import { Transfers } from "@/pages/Transfers";
import { Returns } from "@/pages/Returns";
import { Jobs } from "@/pages/Jobs";
import { Serials } from "@/pages/Serials";
import { Production } from "@/pages/Production";
import { Vaccinations } from "@/pages/Vaccinations";
import { Suppliers } from "@/pages/Suppliers";
import { StockCount } from "@/pages/StockCount";
import { Cohorts } from "@/pages/Cohorts";
import { KitchenQueue } from "@/pages/KitchenQueue";
import { Hotel } from "@/pages/Hotel";
import { ColdRoom } from "@/pages/ColdRoom";
import { MyBusinesses } from "@/pages/MyBusinesses";
import { Platform } from "@/pages/Platform";
import { Customers } from "@/pages/Customers";
import { Expenses } from "@/pages/Expenses";
import { Staff } from "@/pages/Staff";
import { Attendance } from "@/pages/Attendance";
import { Activity } from "@/pages/Activity";
import { Settings } from "@/pages/Settings";
import { Audit } from "@/pages/Audit";
import { Tickets } from "@/pages/Tickets";
import { Help } from "@/pages/Help";
import { SupportDesk } from "@/pages/desk/SupportDesk";
import { AskAI } from "@/pages/AskAI";
import { Members } from "@/pages/Members";
import { Academy } from "@/pages/Academy";
import { Appointments } from "@/pages/Appointments";
import { Projects } from "@/pages/Projects";
import { MySite } from "@/pages/MySite";
import { Orders } from "@/pages/Orders";
import { Invoices } from "@/pages/Invoices";
import { InvoiceView } from "@/pages/InvoiceView";
import { ReceiptView } from "@/pages/ReceiptView";
import { Inventory } from "@/pages/Inventory";
import { ImportHistory } from "@/pages/ImportHistory";
import { Billing } from "@/pages/Billing";
import { ReceiptDesigner } from "@/pages/ReceiptDesigner";
import { FeatureGate } from "@/components/plan/PlanUi";
import { BusinessSite } from "@/pages/BusinessSite";

// Owners/managers land on the dashboard; till-PIN staff land straight on the
// POS (speed matters at the till); account-login staff without a dashboard
// land on their own self-service home hub instead.
function Home() {
  const { can, session, hasCapability } = useSession();
  if (can("dashboard_ops")) return <Navigate to="dashboard" replace />;
  // A service business's front desk works in its own screen, not the product till.
  if (session?.mode === "till") {
    if (hasCapability("programs")) return <Navigate to="academy" replace />;
    if (hasCapability("appointments")) return <Navigate to="appointments" replace />;
    if (hasCapability("projects")) return <Navigate to="projects" replace />;
    return <Navigate to="pos" replace />;
  }
  return <Navigate to="home" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/loyalty/:code" element={<LoyaltyCardView />} />
      <Route path="/s/:slug" element={<BusinessSite />} />
      <Route path="/i/:token" element={<InvoiceView />} />
      <Route path="/r/:token" element={<ReceiptView />} />
      {/* StarTrack's support desk: its own frame, apart from the console. */}
      <Route path="/desk" element={<RequirePlatform><SupportDesk /></RequirePlatform>} />
      <Route path="/desk/:view" element={<RequirePlatform><SupportDesk /></RequirePlatform>} />
      <Route
        path="/admin"
        element={
          <RequirePlatform>
            <AdminShell />
          </RequirePlatform>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path=":tab" element={<Platform />} />
      </Route>
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="home" element={<StaffHome />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="all-stores" element={<FeatureGate feature="multiStore"><AllStores /></FeatureGate>} />
        <Route path="pos" element={<POS />} />
        <Route path="sales" element={<Sales />} />
        <Route path="products" element={<Products />} />
        <Route path="stock-in" element={<StockIn />} />
        <Route path="transfers" element={<FeatureGate feature="transfers"><Transfers /></FeatureGate>} />
        <Route path="returns" element={<FeatureGate feature="returns"><Returns /></FeatureGate>} />
        <Route path="jobs" element={<FeatureGate feature="verticals"><Jobs /></FeatureGate>} />
        <Route path="members" element={<FeatureGate feature="verticals"><Members /></FeatureGate>} />
        <Route path="academy" element={<FeatureGate feature="verticals"><Academy /></FeatureGate>} />
        <Route path="appointments" element={<FeatureGate feature="verticals"><Appointments /></FeatureGate>} />
        <Route path="projects" element={<FeatureGate feature="verticals"><Projects /></FeatureGate>} />
        <Route path="serials" element={<FeatureGate feature="verticals"><Serials /></FeatureGate>} />
        <Route path="production" element={<FeatureGate feature="verticals"><Production /></FeatureGate>} />
        <Route path="vaccinations" element={<FeatureGate feature="verticals"><Vaccinations /></FeatureGate>} />
        <Route path="suppliers" element={<FeatureGate feature="suppliers"><Suppliers /></FeatureGate>} />
        <Route path="stock-count" element={<FeatureGate feature="stockCount"><StockCount /></FeatureGate>} />
        <Route path="cohorts" element={<FeatureGate feature="verticals"><Cohorts /></FeatureGate>} />
        <Route path="kitchen" element={<FeatureGate feature="verticals"><KitchenQueue /></FeatureGate>} />
        <Route path="front-desk" element={<FeatureGate feature="verticals"><Hotel /></FeatureGate>} />
        <Route path="cold-room" element={<FeatureGate feature="verticals"><ColdRoom /></FeatureGate>} />
        <Route path="businesses" element={<MyBusinesses />} />
        <Route path="platform" element={<Navigate to="/admin" replace />} />
        <Route path="customers" element={<Customers />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="staff" element={<Staff />} />
        <Route path="attendance" element={<FeatureGate feature="attendance"><Attendance /></FeatureGate>} />
        <Route path="activity" element={<Activity />} />
        <Route path="settings" element={<Settings />} />
        <Route path="billing" element={<Billing />} />
        <Route path="receipt" element={<FeatureGate feature="receiptCustom"><ReceiptDesigner /></FeatureGate>} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="import-history" element={<FeatureGate feature="csvImport"><ImportHistory /></FeatureGate>} />
        <Route path="invoices" element={<FeatureGate feature="invoices"><Invoices /></FeatureGate>} />
        <Route path="orders" element={<FeatureGate feature="sitePage"><Orders /></FeatureGate>} />
        <Route path="my-site" element={<FeatureGate feature="sitePage"><MySite /></FeatureGate>} />
        <Route path="audit" element={<FeatureGate feature="auditLog"><Audit /></FeatureGate>} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="help" element={<Help />} />
        <Route path="ask-ai" element={<FeatureGate feature="ai"><AskAI /></FeatureGate>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
