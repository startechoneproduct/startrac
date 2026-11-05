import { Router } from "express";
import { Membership } from "#modules/auth/membership.model.js";
import { Business } from "#modules/business/business.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { DailyMetric } from "#modules/metrics/dailyMetric.model.js";
import { permsForMembership } from "#modules/auth/auth.service.js";
import { dayOffset, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { Account } from "#modules/auth/account.model.js";
import { effectivePlan, planAllows } from "#shared/plans.js";
import { planRequired } from "#core/middleware/tenant.js";

export const overviewRouter = Router();

const has = (perms, p) => perms.includes("*") || perms.includes(p);

/**
 * GET /api/overview?days=30 — every store the signed-in owner/admin runs, side
 * by side: sales, profit or loss, and stock on hand per business and branch.
 *
 * Mounted WITHOUT the per-business tenantContext on purpose: it spans
 * businesses. Access is re-derived from memberships here — an account-wide
 * membership (owner) sees every business, a business-scoped admin sees only
 * the businesses they administer, anyone else (managers, staff, till logins)
 * gets nothing.
 */
overviewRouter.get("/", async (req, res) => {
  if (req.auth.mode === "till") {
    return res.status(403).json({ error: "forbidden", message: "The all-stores view isn't available on a till." });
  }

  const plan = effectivePlan(await Account.findById(req.auth.accountId).select("isSandbox subscription"));
  if (!planAllows(plan, "multiStore")) return res.status(403).json(planRequired("multiStore"));

  const memberships = await Membership.find({
    userId: req.auth.userId,
    accountId: req.auth.accountId,
    status: "active",
    // Owners are never branch-locked (registration pins theirs to the first
    // branch, but tenantContext lets them act anywhere). Admins count only
    // when they cover every branch.
    $or: [{ role: "owner" }, { role: "admin", branchId: null }],
  });
  if (!memberships.length) {
    return res.status(403).json({ error: "forbidden", message: "Only owners and admins can see the all-stores view." });
  }

  // An owner's membership reaches every business on the account (the same
  // fallback tenantContext applies); an admin's reaches only its own business.
  const accountWide = memberships.find((m) => m.role === "owner" || !m.businessId);
  const allBusinesses = await Business.find({ accountId: req.auth.accountId }).sort({ createdAt: 1 });
  const permsFor = (businessId) => {
    const scoped = memberships.find((m) => m.businessId && String(m.businessId) === String(businessId));
    const m = scoped || accountWide;
    return m ? permsForMembership(m) : null;
  };
  const businesses = allBusinesses.filter((b) => {
    const p = permsFor(b._id);
    return p && has(p, "dashboard_ops");
  });

  const days = [1, 7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const today = localDay();
  const from = dayOffset(today, -(days - 1));
  const ids = businesses.map((b) => b._id);

  const [branches, metricRows, stockRows] = await Promise.all([
    Branch.find({ businessId: { $in: ids } }).sort({ createdAt: 1 }),
    DailyMetric.aggregate([
      { $match: { businessId: { $in: ids }, date: { $gte: from } } },
      {
        $group: {
          _id: { businessId: "$businessId", branchId: "$branchId" },
          revenue: { $sum: "$revenue" }, cost: { $sum: "$cost" }, profit: { $sum: "$profit" },
          expenses: { $sum: "$expenses" }, refunds: { $sum: "$refundTotal" }, waste: { $sum: "$wasteTotal" },
          txns: { $sum: "$txns" },
        },
      },
    ]),
    // Stock on hand per branch, valued at cost and at selling price.
    Inventory.aggregate([
      { $match: { businessId: { $in: ids } } },
      { $lookup: { from: Product.collection.name, localField: "productId", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.status": "active" } },
      {
        $group: {
          _id: { businessId: "$businessId", branchId: "$branchId" },
          skus: { $sum: 1 },
          units: { $sum: "$stock" },
          costValue: { $sum: { $multiply: ["$stock", { $ifNull: ["$p.cost", 0] }] } },
          retailValue: { $sum: { $multiply: ["$stock", { $ifNull: ["$p.price", 0] }] } },
          lowStock: { $sum: { $cond: [{ $lte: ["$stock", { $ifNull: ["$p.reorderLevel", 0] }] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const key = (r) => `${r._id.businessId}:${r._id.branchId}`;
  const metricBy = new Map(metricRows.map((r) => [key(r), r]));
  const stockBy = new Map(stockRows.map((r) => [key(r), r]));

  const blank = () => ({
    revenue: 0, cost: 0, grossProfit: 0, expenses: 0, refunds: 0, waste: 0, net: 0, txns: 0,
    skus: 0, units: 0, stockCost: 0, stockRetail: 0, lowStock: 0,
  });
  const add = (acc, row) => { for (const k of Object.keys(acc)) acc[k] += row[k] || 0; };
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, ["txns", "skus", "units", "lowStock"].includes(k) ? v : money(v)]));
  const withMargin = (o) => ({ ...round(o), marginPct: o.revenue > 0 ? Math.round((o.net / o.revenue) * 1000) / 10 : 0 });

  const totalsByCurrency = new Map();
  const out = businesses.map((b) => {
    const perms = permsFor(b._id);
    const finance = has(perms, "dashboard_finance");
    const mine = branches.filter((br) => String(br.businessId) === String(b._id));
    const rolled = blank();
    const branchRows = mine.map((br) => {
      const k = `${b._id}:${br._id}`;
      const m = metricBy.get(k);
      const s = stockBy.get(k);
      const row = blank();
      row.revenue = m?.revenue || 0;
      row.cost = m?.cost || 0;
      row.grossProfit = m?.profit || 0;
      row.expenses = m?.expenses || 0;
      row.refunds = m?.refunds || 0;
      row.waste = m?.waste || 0;
      row.net = row.grossProfit - row.expenses;
      row.txns = m?.txns || 0;
      row.skus = s?.skus || 0;
      row.units = s?.units || 0;
      row.stockCost = s?.costValue || 0;
      row.stockRetail = s?.retailValue || 0;
      row.lowStock = s?.lowStock || 0;
      add(rolled, row);
      return { id: br._id, name: br.name, ...withMargin(row) };
    });

    const currency = b.settings?.currency || "₦";
    const tot = totalsByCurrency.get(currency) || blank();
    add(tot, rolled);
    totalsByCurrency.set(currency, tot);

    // Roles without the finance permission never receive cost/profit, here
    // or anywhere else — strip them at the source, not in the UI.
    const strip = (r) => {
      if (finance) return r;
      const rest = { ...r };
      for (const k of ["cost", "grossProfit", "net", "marginPct", "stockCost", "waste"]) delete rest[k];
      return rest;
    };
    return {
      id: b._id,
      name: b.name,
      typeKey: b.typeKey,
      currency,
      showFinance: finance,
      ...strip(withMargin(rolled)),
      branches: branchRows.map(strip),
    };
  });

  res.json({
    days,
    from,
    to: today,
    businesses: out,
    totals: [...totalsByCurrency.entries()].map(([currency, t]) => ({ currency, ...withMargin(t) })),
  });
});
