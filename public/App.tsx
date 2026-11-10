import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { RequireAuth, RequirePlatform, useSession } from "@/lib/session";
import { AdminShell } from "@/components/layout/AdminShell";
import { FeatureGate } from "@/components/plan/PlanUi";
import { lazyPage } from "@/lib/lazyPage";
import { Suspense } from "react";

// Every page loads on demand, in its own file (see lib/lazyPage.ts).
const Landing = lazyPage(() => import("@/pages/Landing"), "Landing");
const Docs = lazyPage(() => import("@/pages/Docs"), "Docs");
const Login = lazyPage(() => import("@/pages/Login"), "Login");
const Register = lazyPage(() => import("@/pages/Register"), "Register");
const LoyaltyCardView = lazyPage(() => import("@/pages/LoyaltyCardView"), "LoyaltyCardView");
const Dashboard = lazyPage(() => import("@/pages/Dashboard"), "Dashboard");
const AllStores = lazyPage(() => import("@/pages/AllStores"), "AllStores");
const StaffHome = lazyPage(() => import("@/pages/StaffHome"), "StaffHome");
const POS = lazyPage(() => import("@/pages/POS"), "POS");
const Sales = lazyPage(() => import("@/pages/Sales"), "Sales");
const Products = lazyPage(() => import("@/pages/Products"), "Products");
const StockIn = lazyPage(() => import("@/pages/StockIn"), "StockIn");
const Transfers = lazyPage(() => import("@/pages/Transfers"), "Transfers");
const Returns = lazyPage(() => import("@/pages/Returns"), "Returns");
const Jobs = lazyPage(() => import("@/pages/Jobs"), "Jobs");
const Serials = lazyPage(() => import("@/pages/Serials"), "Serials");
const Production = lazyPage(() => import("@/pages/Production"), "Production");
const Vaccinations = lazyPage(() => import("@/pages/Vaccinations"), "Vaccinations");
const Suppliers = lazyPage(() => import("@/pages/Suppliers"), "Suppliers");
const StockCount = lazyPage(() => import("@/pages/StockCount"), "StockCount");
const Cohorts = lazyPage(() => import("@/pages/Cohorts"), "Cohorts");
const KitchenQueue = lazyPage(() => import("@/pages/KitchenQueue"), "KitchenQueue");
const Hotel = lazyPage(() => import("@/pages/Hotel"), "Hotel");
const ColdRoom = lazyPage(() => import("@/pages/ColdRoom"), "ColdRoom");
const MyBusinesses = lazyPage(() => import("@/pages/MyBusinesses"), "MyBusinesses");
const Platform = lazyPage(() => import("@/pages/Platform"), "Platform");
const Customers = lazyPage(() => import("@/pages/Customers"), "Customers");
const Expenses = lazyPage(() => import("@/pages/Expenses"), "Expenses");
const Staff = lazyPage(() => import("@/pages/Staff"), "Staff");
const Attendance = lazyPage(() => import("@/pages/Attendance"), "Attendance");
const Activity = lazyPage(() => import("@/pages/Activity"), "Activity");
const Settings = lazyPage(() => import("@/pages/Settings"), "Settings");
const Audit = lazyPage(() => import("@/pages/Audit"), "Audit");
const Tickets = lazyPage(() => import("@/pages/Tickets"), "Tickets");
const Help = lazyPage(() => import("@/pages/Help"), "Help");
const SupportDesk = lazyPage(() => import("@/pages/desk/SupportDesk"), "SupportDesk");
const AskAI = lazyPage(() => import("@/pages/AskAI"), "AskAI");
const Members = lazyPage(() => import("@/pages/Members"), "Members");
const Academy = lazyPage(() => import("@/pages/Academy"), "Academy");
const Appointments = lazyPage(() => import("@/pages/Appointments"), "Appointments");
const Projects = lazyPage(() => import("@/pages/Projects"), "Projects");
const MySite = lazyPage(() => import("@/pages/MySite"), "MySite");
const Orders = lazyPage(() => import("@/pages/Orders"), "Orders");
const Invoices = lazyPage(() => import("@/pages/Invoices"), "Invoices");
const InvoiceView = lazyPage(() => import("@/pages/InvoiceView"), "InvoiceView");
const ReceiptView = lazyPage(() => import("@/pages/ReceiptView"), "ReceiptView");
const Inventory = lazyPage(() => import("@/pages/Inventory"), "Inventory");
const ImportHistory = lazyPage(() => import("@/pages/ImportHistory"), "ImportHistory");
const Billing = lazyPage(() => import("@/pages/Billing"), "Billing");
const ReceiptDesigner = lazyPage(() => import("@/pages/ReceiptDesigner"), "ReceiptDesigner");
const BusinessSite = lazyPage(() => import("@/pages/BusinessSite"), "BusinessSite");

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

// While a page outside the app's frame loads (landing, sign-in, the desk…):
// a quiet, empty screen in the page colour, rather than a flash of white.
function PageLoading() {
  return <div className="min-h-dvh bg-canvas" aria-busy="true" />;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
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
    </Suspense>
  );
}
