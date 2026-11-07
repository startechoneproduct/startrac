import { Router } from "express";
import { requirePerm, requireFeature } from "#core/middleware/tenant.js";
import {
  dayOffset, localDay, rebuildDailyMetrics,
  buildInventoryReport, buildDashboardSummary, buildSalesReport, buildCustomersReport, buildStaffReport, buildFinanceReport,
} from "#modules/metrics/metrics.service.js";
import { audit } from "#core/audit.js";

export const metricsRouter = Router();

// GET /api/metrics/sales-report?days=30 — the Sales tab: trend + breakdowns
metricsRouter.get("/sales-report", requirePerm("dashboard_ops"), async (req, res) => {
  const daysBack = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
  res.json(await buildSalesReport(req.ctx, daysBack));
});

// GET /api/metrics/inventory-report — the Inventory tab: value, gaps, expiry
metricsRouter.get("/inventory-report", requirePerm("inventory_view"), requireFeature("advancedDashboard"), async (req, res) => {
  res.json(await buildInventoryReport(req.ctx));
});

// GET /api/metrics/customers-report — the Customers tab
metricsRouter.get("/customers-report", requirePerm("dashboard_ops"), requireFeature("advancedDashboard"), async (req, res) => {
  res.json(await buildCustomersReport(req.ctx));
});

// GET /api/metrics/staff-report — the Staff tab (30-day window)
metricsRouter.get("/staff-report", requirePerm("dashboard_ops"), requireFeature("advancedDashboard"), async (req, res) => {
  res.json(await buildStaffReport(req.ctx));
});

// GET /api/metrics/finance?period=today|week|month|year|custom&from=&to= — Profit & Loss.
// Owner-level numbers (cost, margins, net profit), so it needs the profit permission.
metricsRouter.get("/finance", requirePerm("dashboard_finance"), requireFeature("advancedDashboard"), async (req, res) => {
  res.json(await buildFinanceReport(req.ctx, { period: String(req.query.period || "week"), from: req.query.from, to: req.query.to }));
});

// GET /api/metrics/dashboard — everything the dashboard needs in one call.
// Owner/admin with no branch selected sees the whole business consolidated.
metricsRouter.get("/dashboard", requirePerm("dashboard_ops"), async (req, res) => {
  res.json(await buildDashboardSummary(req.ctx));
});

// POST /api/metrics/rebuild — recompute the pre-rolled numbers for a range
// straight from the sales, returns and expenses that caused them.
//
// The incremental roll-up is fast but unforgiving: an increment lost to a
// crash is lost for good, and the dashboard would disagree with the sales
// list forever. This is the repair. It is owner-level because it rewrites
// what everyone else reads, and it is capped at a year per call.
metricsRouter.post("/rebuild", requirePerm("dashboard_finance"), async (req, res) => {
  const today = localDay();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.to || "") ? req.body.to : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.from || "") ? req.body.from : dayOffset(to, -29);
  if (from > to) return res.status(400).json({ error: "invalid", message: "The start date is after the end date." });
  const spanDays = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);
  if (spanDays > 366) return res.status(400).json({ error: "range_too_wide", message: "Rebuild at most a year at a time." });

  const result = await rebuildDailyMetrics({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    from,
    to,
  });

  audit(req.ctx, "metrics.rebuild", { type: "metrics", label: `${from} → ${to}` }, undefined, result);
  res.json({ from, to, ...result });
});
