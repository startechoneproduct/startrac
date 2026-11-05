import express from "express";
import "express-async-errors"; // async route errors reach the error handler
import cors from "cors";
import multer from "multer";
import { HttpError } from "#core/httpError.js";
import { config } from "#core/config.js";
import { requireAuth, requireLive, requireOwner } from "#core/middleware/requireAuth.js";
import { securityHeaders } from "#core/securityHeaders.js";
import { tenantContext, requirePerm } from "#core/middleware/tenant.js";
import { InsufficientStockError } from "#modules/inventory/inventory.service.js";

// Shared core + generic feature modules — every business type uses these
// same implementations (see server/modules/businesses/*/index.js for what
// each business vertical composes from them).
import { authRouter } from "#modules/auth/auth.routes.js";
import { verifyRouter } from "#modules/auth/verify.routes.js";
import { staffRouter } from "#modules/staff/staff.routes.js";
import { productsRouter } from "#modules/products/products.routes.js";
import { productionRouter } from "#modules/production/production.routes.js";
import { suppliersRouter } from "#modules/suppliers/suppliers.routes.js";
import { stockCountRouter } from "#modules/inventory/stockCount.routes.js";
import { inventoryRouter } from "#modules/inventory/inventory.routes.js";
import { salesRouter } from "#modules/sales/sales.routes.js";
import { returnsRouter } from "#modules/returns/returns.routes.js";
import { customersRouter } from "#modules/customers/customers.routes.js";
import { expensesRouter } from "#modules/expenses/expenses.routes.js";
import { attendanceRouter } from "#modules/staff/attendance.routes.js";
import { metricsRouter } from "#modules/metrics/metrics.routes.js";
import { settingsRouter } from "#modules/business/settings.routes.js";
import { auditRouter } from "#modules/audit/audit.routes.js";
import { notificationsRouter } from "#modules/alerts/notifications.routes.js";
import { jobsRouter } from "#modules/jobs/jobs.routes.js";
import { platformRouter } from "#modules/platform/platform.routes.js";
import { deskRouter } from "#modules/support/desk.routes.js";
import { tasksRouter } from "#modules/tasks/tasks.routes.js";
import { announcementsRouter } from "#modules/announcements/announcements.routes.js";
import { ticketsRouter } from "#modules/support/tickets.routes.js";
import { aiRouter } from "#modules/ai/ai.routes.js";
import { searchRouter } from "#modules/search/search.routes.js";
import { overviewRouter } from "#modules/overview/overview.routes.js";
import { reportsRouter } from "#modules/reports/reports.routes.js";

// Business-vertical modules (server/modules/businesses/*/) — genuinely
// single-consumer logic that lives in its own directory. Blinds has none:
// its whole behavior IS the shared made_to_order capability — see its
// index.js manifest.
import { hotelRouter } from "#modules/businesses/hotel/hotel.routes.js";
import { serialsRouter } from "#modules/businesses/electronics/serials.routes.js";
import { vaccinationsRouter } from "#modules/businesses/poultry/vaccinations.routes.js";
import { cohortsRouter } from "#modules/businesses/poultry/cohorts.routes.js";
import { kitchenQueueRouter } from "#modules/businesses/restaurant/kitchenQueue.routes.js";
import { loyaltyRouter } from "#modules/businesses/water/loyalty.routes.js";
import { coldroomRouter } from "#modules/businesses/coldroom/coldroom.routes.js";
import { gymRouter } from "#modules/businesses/gym/gym.routes.js";
// Service businesses — sell time and expertise, not stock.
import { academyRouter } from "#modules/businesses/academy/academy.routes.js";
import { salonRouter } from "#modules/businesses/salon/salon.routes.js";
import { agencyRouter } from "#modules/businesses/agency/agency.routes.js";

// Cross-vertical loyalty QR cards — usable by any business, not just water's
// sachet-token mechanic above. See server/modules/loyalty/.
import { loyaltyCardRouter } from "#modules/loyalty/loyaltyCard.routes.js";
import { loyaltyCardPublicRouter } from "#modules/loyalty/loyaltyCardPublic.routes.js";
import { requireFeature } from "#core/middleware/tenant.js";
import { billingRouter, billingWebhook } from "#modules/billing/billing.routes.js";
import { siteRouter } from "#modules/site/site.routes.js";
import { sitePublicRouter } from "#modules/site/site.public.routes.js";
import { ordersRouter } from "#modules/storefront/orders.routes.js";
import { inventoryHubRouter } from "#modules/inventory/inventory.hub.routes.js";
import { salesHistoryRouter } from "#modules/imports/salesHistory.routes.js";
import { invoicesRouter } from "#modules/invoices/invoices.routes.js";
import { invoicesPublicRouter } from "#modules/invoices/invoices.public.routes.js";
import { receiptPublicRouter } from "#modules/sales/receipt.public.routes.js";
import { purchaseOrdersRouter } from "#modules/inventory/purchaseOrders.routes.js";
import { stockReceiptsRouter } from "#modules/inventory/stockReceipts.routes.js";
import { customersImportRouter } from "#modules/customers/customers.import.routes.js";
import { storefrontPublicRouter } from "#modules/storefront/storefront.public.routes.js";
import { logoPublicRouter } from "#modules/business/logo.public.routes.js";

/**
 * The whole API, and nothing else — no static-file serving, no app.listen(),
 * no background jobs. Those belong to whichever entry point actually runs
 * this process (server/index.js for a standalone server on Render/locally;
 * netlify/functions/api.js for a serverless deploy on Netlify), so that the
 * same routes are guaranteed identical on every platform instead of two
 * hand-maintained copies drifting apart.
 */
export const app = express();
app.disable("x-powered-by");
app.use(securityHeaders);
app.set("trust proxy", 1); // real client IPs behind Render/Netlify/railway proxies (rate limits)
// One app on one origin, so there is normally nothing to negotiate. CORS is
// switched on only when WEB_ORIGIN names a separately hosted client.
if (config.webOrigins.length) app.use(cors({ origin: config.webOrigins, credentials: true }));
// Paystack signs the exact bytes it sends, so this one route reads the body raw —
// and must be registered before the JSON parser below consumes it.
app.post("/api/billing/webhook", express.raw({ type: "*/*", limit: "1mb" }), billingWebhook);
app.use(express.json());

// Log every request so you can watch the backend work in the terminal.
app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - started;
    const color = res.statusCode >= 400 ? "\x1b[31m" : "\x1b[32m"; // red / green
    console.log(`${color}${res.statusCode}\x1b[0m ${req.method.padEnd(4)} ${req.originalUrl}  ${ms}ms`);
  });
  next();
});

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "startrack-api", time: new Date().toISOString() }));

// Public + session routes
app.use("/api/auth", authRouter);
// Identity-scoped, not business-scoped — knows WHO via the JWT, not which
// business they're acting in, so it sits behind requireAuth alone.
app.use("/api/verify", requireAuth, requireLive, verifyRouter);
// Account-level too: the plan belongs to the person paying, not to one business.
app.use("/api/billing", requireAuth, requireLive, requireOwner, billingRouter);

// Business-data routes: auth → tenant context → module
const tenant = [requireAuth, tenantContext];
// Spans every business of the account, so it resolves access itself (no tenantContext).
app.use("/api/overview", requireAuth, requireLive, overviewRouter);
app.use("/api/staff", tenant, staffRouter);
app.use("/api/products", tenant, productsRouter);
app.use("/api/production", tenant, requireFeature("verticals"), productionRouter);
app.use("/api/suppliers", tenant, requireFeature("suppliers"), suppliersRouter);
app.use("/api/stock-counts", tenant, requireFeature("stockCount"), stockCountRouter);
app.use("/api/inventory", tenant, inventoryRouter);
// The inventory hub: overview, valuation, movers, reorder suggestions, opening-stock import.
app.use("/api/inventory", tenant, inventoryHubRouter);
// Deliveries received (goods received notes), their paperwork, and spreadsheet-filled deliveries.
app.use("/api/stock-receipts", tenant, stockReceiptsRouter);
app.use("/api/purchase-orders", tenant, requireFeature("suppliers"), purchaseOrdersRouter);
// Upload past sales so reports start with the business's real history.
app.use("/api/history-import", tenant, requireFeature("csvImport"), salesHistoryRouter);
// Invoices: bill customers, track what they owe, take part-payments.
// Invoices put money on a customer's account, so till staff (who only have "sales") are kept out.
app.use("/api/invoices", tenant, requirePerm("invoices", "invoice_payments", "invoices_void", "dashboard_ops"), requireFeature("invoices"), invoicesRouter);
app.use("/api/sales", tenant, salesRouter);
app.use("/api/returns", tenant, requireFeature("returns"), returnsRouter);
app.use("/api/customers/import", tenant, requireFeature("csvImport"), customersImportRouter);
app.use("/api/customers", tenant, customersRouter);
app.use("/api/expenses", tenant, expensesRouter);
app.use("/api/attendance", tenant, requireFeature("attendance"), attendanceRouter);
app.use("/api/metrics", tenant, metricsRouter);
app.use("/api/settings", tenant, settingsRouter);
app.use("/api/audit", tenant, requireFeature("auditLog"), auditRouter);
app.use("/api/notifications", tenant, notificationsRouter);
app.use("/api/jobs", tenant, requireFeature("verticals"), jobsRouter);
app.use("/api/tasks", tenant, tasksRouter);
app.use("/api/announcements", tenant, announcementsRouter);
app.use("/api/tickets", tenant, ticketsRouter);
app.use("/api/ai", tenant, requireFeature("ai"), aiRouter);
app.use("/api/search", tenant, searchRouter);
app.use("/api/reports", tenant, requireFeature("reports"), reportsRouter);

// Business-vertical routes (server/modules/businesses/*/) — same auth/tenant
// gate as everything else above, just physically grouped so "every business
// has its own directory" is visible here too, not only in server/modules/.
app.use("/api/hotel", tenant, requireFeature("verticals"), hotelRouter);
app.use("/api/serials", tenant, requireFeature("verticals"), serialsRouter);
app.use("/api/vaccinations", tenant, requireFeature("verticals"), vaccinationsRouter);
app.use("/api/cohorts", tenant, requireFeature("verticals"), cohortsRouter);
app.use("/api/kitchen-queue", tenant, requireFeature("verticals"), kitchenQueueRouter);
app.use("/api/loyalty", tenant, requireFeature("loyalty"), loyaltyRouter);
app.use("/api/coldroom", tenant, requireFeature("verticals"), coldroomRouter);
app.use("/api/gym", tenant, requireFeature("verticals"), gymRouter);
app.use("/api/academy", tenant, requireFeature("verticals"), academyRouter);
app.use("/api/salon", tenant, requireFeature("verticals"), salonRouter);
app.use("/api/agency", tenant, requireFeature("verticals"), agencyRouter);
app.use("/api/loyalty-cards", tenant, requireFeature("loyalty"), loyaltyCardRouter);
app.use("/api/site", tenant, requireFeature("sitePage"), siteRouter);
// Online orders placed on the business's page, handled by its owner and staff.
app.use("/api/orders", tenant, requireFeature("sitePage"), ordersRouter);

// Public: a customer opening their card link isn't logged into anything.
app.use("/api/public/loyalty-cards", loyaltyCardPublicRouter);
app.use("/api/public/sites", sitePublicRouter);
// A customer opening the invoice link they were sent.
app.use("/api/public/invoices", invoicesPublicRouter);
app.use("/api/public/receipts", receiptPublicRouter);
// A business's logo, for receipts and invoices opened without signing in.
app.use("/api/public/logo", logoPublicRouter);
// The customer side of a business's page: register, sign in, browse, order.
app.use("/api/public/store/:slug", storefrontPublicRouter);

// StarTrack's own staff, looking across every tenant. Deliberately NOT behind
// `tenant` — it carries its own gate (see platform.routes.js).
app.use("/api/platform", platformRouter);
app.use("/api/desk", deskRouter);

// Unknown API routes are a 404 in JSON — never the HTML app shell, which
// would turn a typo'd endpoint into a confusing 200.
app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

// Central error handler — typed domain errors get proper statuses. Registered
// last so it sees errors from every route above; a standalone-server entry
// point that adds more routes after importing `app` (static files, the SPA
// catch-all) falls back to Express's default error handling for those —
// acceptable, since neither serves anything that throws these domain errors.
app.use((err, _req, res, _next) => {
  // A business rule saying no (see core/httpError.js): routes just throw it.
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  // Bad bodies are the caller's mistake, not ours.
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "invalid", message: "That request wasn't valid JSON." });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "too_large", message: "That request is too large." });
  if (err instanceof InsufficientStockError) {
    return res.status(409).json({ error: err.code, message: err.message });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "That image is too large — 5MB max." : "Couldn't upload that file.";
    return res.status(400).json({ error: "invalid", message });
  }
  if (err?.name === "CastError") {
    return res.status(400).json({ error: "invalid_id", message: "That reference doesn't look right." });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "server", message: "Something went wrong on our side." });
});
