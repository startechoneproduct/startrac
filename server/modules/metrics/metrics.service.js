import { DailyMetric } from "#modules/metrics/dailyMetric.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { Return } from "#modules/returns/return.model.js";
import { Expense } from "#modules/expenses/expense.model.js";
import { StockMovement } from "#modules/inventory/stockMovement.model.js";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { Attendance } from "#modules/staff/attendance.model.js";
import { canSeeCost } from "#core/middleware/tenant.js";
import { money } from "#core/money.js";
import { scopedToBranch } from "#core/branchScope.js";


export function localDay(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const NUMERIC = ["revenue", "cost", "profit", "txns", "discountTotal", "vatTotal", "refundTotal", "wasteTotal", "expenses"];
const METHODS = ["cash", "pos", "transfer"];


export async function bumpDailyMetric(ctx, branchId, date, delta, session = null) {
  const inc = {};
  for (const k of NUMERIC) {
    if (delta[k]) inc[k] = money(delta[k]);
  }
  for (const m of METHODS) {
    if (delta.payments?.[m]) inc[`paymentSplit.${m}`] = money(delta.payments[m]);
  }
  if (!Object.keys(inc).length) return;
  await DailyMetric.findOneAndUpdate(
    { businessId: ctx.businessId, branchId, date },
    { $inc: inc, $setOnInsert: { accountId: ctx.accountId } },
    { upsert: true, session }
  );
}


export function dayOffset(base, days) {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDay(d);
}

/**
 * Stock value, gaps and movement — exactly what GET /metrics/inventory-report
 * returns. Extracted so the AI restock-suggestion prompt (server/modules/ai/)
 * and the human-facing report route share one implementation instead of two
 * copies of the same low-stock/velocity math drifting apart.
 */
export async function buildInventoryReport(ctx) {
  const showFinance = canSeeCost(ctx);
  const products = await Product.find(scopedToBranch(ctx, { businessId: ctx.businessId, status: "active", archetype: { $ne: "made_to_order" } }))
    .select("name category price cost reorderLevel expiry");
  const invFilter = ctx.branchId ? { branchId: ctx.branchId } : { businessId: ctx.businessId };
  const inv = await Inventory.find({ ...invFilter, productId: { $in: products.map((p) => p._id) } });

  const stockBy = new Map();
  for (const i of inv) {
    stockBy.set(String(i.productId), (stockBy.get(String(i.productId)) || 0) + i.stock);
  }

  let units = 0, retailValue = 0, costValue = 0;
  const lowStock = [];
  const expiringSoon = [];
  const soonCutoff = new Date(Date.now() + 30 * 24 * 3600 * 1000);

  for (const p of products) {
    const stock = stockBy.get(String(p._id)) ?? 0;
    units += stock;
    retailValue += stock * p.price;
    costValue += stock * (p.cost || 0);
    if (stock <= p.reorderLevel) {
      lowStock.push({ id: p._id, name: p.name, stock, reorderLevel: p.reorderLevel });
    }
    if (p.expiry && stock > 0 && p.expiry <= soonCutoff) {
      expiringSoon.push({ id: p._id, name: p.name, stock, expiry: p.expiry, expired: p.expiry < new Date() });
    }
  }
  lowStock.sort((a, b) => a.stock - b.stock);
  expiringSoon.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const moveBranch = ctx.branchId ? { branchId: ctx.branchId } : {};
  const flows = await StockMovement.aggregate([
    { $match: { businessId: ctx.businessId, ...moveBranch, at: { $gte: since } } },
    {
      $group: {
        _id: "$productId",
        name: { $first: "$productName" },
        unitsIn: { $sum: { $cond: [{ $gt: ["$qty", 0] }, "$qty", 0] } },
        unitsOut: { $sum: { $cond: [{ $lt: ["$qty", 0] }, { $abs: "$qty" }, 0] } },
      },
    },
  ]);
  let unitsIn = 0, unitsOut = 0;
  for (const f of flows) { unitsIn += f.unitsIn; unitsOut += f.unitsOut; }
  const topMovers = [...flows].sort((a, b) => b.unitsOut - a.unitsOut).slice(0, 10)
    .map((f) => ({ id: f._id, name: f.name, unitsIn: f.unitsIn, unitsOut: f.unitsOut }));

  return {
    skus: products.length,
    units,
    retailValue: money(retailValue),
    ...(showFinance ? { costValue: money(costValue), potentialProfit: money(retailValue - costValue) } : {}),
    flow30d: { unitsIn, unitsOut },
    turnover: units > 0 ? Math.round((unitsOut / units) * 100) / 100 : 0,
    topMovers,
    lowStock: lowStock.slice(0, 15),
    expiringSoon: expiringSoon.slice(0, 15),
  };
}

/**
 * Everything the Dashboard's overview needs in one call — exactly what
 * GET /metrics/dashboard returns. Extracted for the same reason as
 * buildInventoryReport above: the AI digest and Ask-AI chat ground their
 * answers in this same summary, not a second hand-rolled aggregation.
 */
export async function buildDashboardSummary(ctx) {
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};
  const scope = { businessId: ctx.businessId, ...branchFilter };
  const today = localDay();
  const days = [...Array(7)].map((_, i) => dayOffset(today, i - 6));
  const prevDays = [...Array(7)].map((_, i) => dayOffset(today, i - 13));
  const showFinance = canSeeCost(ctx);

  const rows = await DailyMetric.find({ ...scope, date: { $gte: prevDays[0] } });
  const byDate = new Map();
  for (const r of rows) {
    const acc = byDate.get(r.date) || {
      revenue: 0, cost: 0, profit: 0, txns: 0, discountTotal: 0, vatTotal: 0,
      refundTotal: 0, wasteTotal: 0, expenses: 0, cash: 0, pos: 0, transfer: 0,
    };
    acc.revenue += r.revenue; acc.cost += r.cost; acc.profit += r.profit; acc.txns += r.txns;
    acc.discountTotal += r.discountTotal; acc.vatTotal += r.vatTotal;
    acc.refundTotal += r.refundTotal; acc.wasteTotal += r.wasteTotal || 0; acc.expenses += r.expenses;
    acc.cash += r.paymentSplit?.cash || 0; acc.pos += r.paymentSplit?.pos || 0; acc.transfer += r.paymentSplit?.transfer || 0;
    byDate.set(r.date, acc);
  }
  const zero = { revenue: 0, cost: 0, profit: 0, txns: 0, discountTotal: 0, vatTotal: 0, refundTotal: 0, wasteTotal: 0, expenses: 0, cash: 0, pos: 0, transfer: 0 };
  const todayM = byDate.get(today) || zero;
  const yesterdayM = byDate.get(dayOffset(today, -1)) || zero;

  const sum = (dates, key) => money(dates.reduce((s, d) => s + (byDate.get(d)?.[key] || 0), 0));
  const weekRevenue = sum(days, "revenue");
  const prevWeekRevenue = sum(prevDays, "revenue");

  const since = new Date(`${days[0]}T00:00:00`);
  const top = await Sale.aggregate([
    { $match: { businessId: ctx.businessId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}), at: { $gte: since }, status: "completed" } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.productId",
        name: { $first: "$items.name" },
        sold: { $sum: "$items.qty" },
        revenue: { $sum: "$items.lineNet" },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 5 },
  ]);

  let lowStock = [];
  if (ctx.branchId) {
    const products = await Product.find(scopedToBranch(ctx, { businessId: ctx.businessId, status: "active", archetype: { $ne: "made_to_order" } })).select("name reorderLevel");
    const inv = await Inventory.find({ branchId: ctx.branchId, productId: { $in: products.map((p) => p._id) } });
    const stockBy = new Map(inv.map((i) => [String(i.productId), i.stock]));
    lowStock = products
      .map((p) => ({ id: p._id, name: p.name, stock: stockBy.get(String(p._id)) ?? 0, reorderLevel: p.reorderLevel }))
      .filter((p) => p.stock <= p.reorderLevel)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 8);
  }

  const recent = await Sale.find({ businessId: ctx.businessId, ...branchFilter })
    .sort({ at: -1 })
    .limit(8)
    .select("saleNo at staffName total payments status items.name items.qty");

  const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : now > 0 ? 100 : 0);

  return {
    today: {
      revenue: money(todayM.revenue),
      txns: todayM.txns,
      ...(showFinance ? { profit: money(todayM.profit - todayM.expenses), cost: money(todayM.cost), expenses: money(todayM.expenses), wasteTotal: money(todayM.wasteTotal) } : {}),
      discountTotal: money(todayM.discountTotal),
      vatTotal: money(todayM.vatTotal),
      refundTotal: money(todayM.refundTotal),
      deltas: {
        revenue: pct(todayM.revenue, yesterdayM.revenue),
        txns: pct(todayM.txns, yesterdayM.txns),
        ...(showFinance ? { profit: pct(todayM.profit, yesterdayM.profit) } : {}),
      },
    },
    series7d: days.map((d) => ({
      date: d,
      revenue: money(byDate.get(d)?.revenue || 0),
      txns: byDate.get(d)?.txns || 0,
      ...(showFinance ? { profit: money(byDate.get(d)?.profit || 0) } : {}),
    })),
    week: { revenue: weekRevenue, deltaPct: pct(weekRevenue, prevWeekRevenue) },
    paymentSplit: { cash: money(todayM.cash), pos: money(todayM.pos), transfer: money(todayM.transfer) },
    topProducts: top.map((t) => ({ id: t._id, name: t.name, sold: t.sold, revenue: money(t.revenue) })),
    lowStock,
    recentSales: recent.map((s) => ({
      id: s._id,
      saleNo: s.saleNo,
      at: s.at,
      staffName: s.staffName,
      total: s.total,
      method: s.payments[0]?.method || "cash",
      split: s.payments.length > 1,
      status: s.status,
      summary: s.items.map((i) => `${i.name} ×${i.qty}`).join(", "),
    })),
  };
}

/**
 * Revenue trend + staff/category/payment breakdowns over a window —
 * exactly what GET /metrics/sales-report returns. Extracted for the same
 * reason as buildInventoryReport/buildDashboardSummary above: the AI
 * features (server/modules/ai/) ground their answers in this, not a
 * second hand-rolled aggregation.
 */
export async function buildSalesReport(ctx, daysBack = 30) {
  const clamped = Math.min(Math.max(daysBack, 7), 90);
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};
  const today = localDay();
  const days = [...Array(clamped)].map((_, i) => dayOffset(today, i - (clamped - 1)));
  const showFinance = canSeeCost(ctx);

  const rows = await DailyMetric.find({ businessId: ctx.businessId, ...branchFilter, date: { $gte: days[0] } });
  const byDate = new Map();
  for (const r of rows) {
    const acc = byDate.get(r.date) || { revenue: 0, profit: 0, txns: 0, expenses: 0 };
    acc.revenue += r.revenue;
    acc.profit += r.profit - r.expenses;
    acc.txns += r.txns;
    acc.expenses += r.expenses;
    byDate.set(r.date, acc);
  }

  const since = new Date(`${days[0]}T00:00:00`);
  const saleMatch = { businessId: ctx.businessId, ...branchFilter, at: { $gte: since }, status: "completed" };

  const byStaff = await Sale.aggregate([
    { $match: saleMatch },
    { $group: { _id: "$staffId", name: { $first: "$staffName" }, sales: { $sum: 1 }, revenue: { $sum: "$total" } } },
    { $sort: { revenue: -1 } },
    { $limit: 10 },
  ]);
  const byCategory = await Sale.aggregate([
    { $match: saleMatch },
    { $unwind: "$items" },
    { $lookup: { from: "products", localField: "items.productId", foreignField: "_id", as: "product" } },
    { $group: { _id: { $ifNull: [{ $first: "$product.category" }, "Other"] }, sold: { $sum: "$items.qty" }, revenue: { $sum: "$items.lineNet" } } },
    { $sort: { revenue: -1 } },
    { $limit: 8 },
  ]);
  const byMethod = await Sale.aggregate([
    { $match: saleMatch },
    { $unwind: "$payments" },
    { $group: { _id: "$payments.method", amount: { $sum: "$payments.amount" } } },
  ]);

  const totals = days.reduce(
    (acc, d) => {
      const m = byDate.get(d);
      if (m) { acc.revenue += m.revenue; acc.txns += m.txns; acc.profit += m.profit; acc.expenses += m.expenses; }
      return acc;
    },
    { revenue: 0, txns: 0, profit: 0, expenses: 0 }
  );

  return {
    days: clamped,
    totals: {
      revenue: money(totals.revenue),
      txns: totals.txns,
      avgSale: totals.txns > 0 ? money(totals.revenue / totals.txns) : 0,
      ...(showFinance ? { profit: money(totals.profit), expenses: money(totals.expenses) } : {}),
    },
    series: days.map((d) => ({
      date: d,
      revenue: money(byDate.get(d)?.revenue || 0),
      txns: byDate.get(d)?.txns || 0,
      ...(showFinance ? { profit: money(byDate.get(d)?.profit || 0) } : {}),
    })),
    byStaff: byStaff.map((s) => ({ name: s.name, sales: s.sales, revenue: money(s.revenue) })),
    byCategory: byCategory.map((c) => ({ category: c._id, sold: c.sold, revenue: money(c.revenue) })),
    byMethod: byMethod.map((m) => ({ method: m._id, amount: money(m.amount) })),
  };
}

/**
 * Who buys, how often, how much — exactly what GET /metrics/customers-report
 * returns. See buildSalesReport above for why this is shared rather than
 * duplicated for the AI features.
 */
export async function buildCustomersReport(ctx) {
  const scope = scopedToBranch(ctx, { businessId: ctx.businessId });
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const total = await Customer.countDocuments(scope);
  const newThisMonth = await Customer.countDocuments({ ...scope, firstSeen: { $gte: since30 } });
  const repeat = await Customer.countDocuments({ ...scope, visits: { $gte: 2 } });
  const active30 = await Customer.countDocuments({ ...scope, lastSeen: { $gte: since30 } });

  const top = await Customer.find(scope).sort({ totalSpend: -1 }).limit(10).select("name phone totalSpend visits lastSeen");
  const recent = await Customer.find(scope).sort({ firstSeen: -1 }).limit(8).select("name phone totalSpend visits firstSeen");

  return {
    totals: {
      customers: total,
      newLast30: newThisMonth,
      activeLast30: active30,
      repeatRate: total > 0 ? Math.round((repeat / total) * 100) : 0,
    },
    topSpenders: top.map((c) => ({ id: c._id, name: c.name, phone: c.phone, totalSpend: c.totalSpend, visits: c.visits, lastSeen: c.lastSeen })),
    newest: recent.map((c) => ({ id: c._id, name: c.name, phone: c.phone, totalSpend: c.totalSpend, visits: c.visits, firstSeen: c.firstSeen })),
  };
}

/**
 * Per-staff sales/voids/revenue/hours over 30 days — exactly what
 * GET /metrics/staff-report returns. See buildSalesReport above for why
 * this is shared rather than duplicated for the AI features.
 */
export async function buildStaffReport(ctx) {
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const sinceDay = localDay(since);

  const perf = await Sale.aggregate([
    { $match: { businessId: ctx.businessId, ...branchFilter, at: { $gte: since } } },
    {
      $group: {
        _id: "$staffId",
        name: { $first: "$staffName" },
        sales: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        voids: { $sum: { $cond: [{ $eq: ["$status", "voided"] }, 1, 0] } },
        revenue: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$total", 0] } },
        discounts: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$discount", 0] } },
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  const hours = await Attendance.aggregate([
    { $match: { businessId: ctx.businessId, ...branchFilter, date: { $gte: sinceDay } } },
    { $group: { _id: "$userId", name: { $first: "$staffName" }, hours: { $sum: "$hours" }, shifts: { $sum: 1 } } },
  ]);
  const hoursBy = new Map(hours.map((h) => [String(h._id), h]));

  const staff = perf.map((p) => {
    const h = hoursBy.get(String(p._id));
    if (h) hoursBy.delete(String(p._id));
    return {
      name: p.name,
      sales: p.sales,
      voids: p.voids,
      revenue: money(p.revenue),
      discounts: money(p.discounts),
      avgSale: p.sales > 0 ? money(p.revenue / p.sales) : 0,
      hours: h ? money(h.hours) : 0,
      shifts: h ? h.shifts : 0,
    };
  });
  for (const h of hoursBy.values()) {
    staff.push({ name: h.name, sales: 0, voids: 0, revenue: 0, discounts: 0, avgSale: 0, hours: money(h.hours), shifts: h.shifts });
  }

  return { days: 30, staff };
}

export async function rebuildDailyMetrics({ accountId, businessId, from, to }) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(new Date(`${to}T00:00:00`).getTime() + 24 * 3600 * 1000);
  const inRange = { businessId, at: { $gte: start, $lt: end } };

  
  const acc = new Map();
  const bucket = (branchId, date) => {
    const key = `${branchId}|${date}`;
    if (!acc.has(key)) {
      acc.set(key, {
        branchId,
        date,
        revenue: 0, cost: 0, profit: 0, txns: 0,
        discountTotal: 0, vatTotal: 0, refundTotal: 0, wasteTotal: 0, expenses: 0,
        paymentSplit: { cash: 0, pos: 0, transfer: 0 },
      });
    }
    return acc.get(key);
  };

  // 1. Completed sales. Voided ones contribute nothing — that is the whole
  //    point of keeping them flagged rather than deleted.
  const sales = await Sale.find({ ...inRange, status: "completed" })
    .select("branchId at total vat discount items payments")
    .lean();
  for (const s of sales) {
    const b = bucket(String(s.branchId), localDay(s.at));
    const cost = s.items.reduce((sum, i) => sum + (i.lineCost || 0), 0);
    b.revenue += s.total;
    b.cost += cost;
    b.profit += s.total - s.vat - cost;
    b.txns += 1;
    b.discountTotal += s.discount;
    b.vatTotal += s.vat;
    for (const p of s.payments || []) {
      if (METHODS.includes(p.method)) b.paymentSplit[p.method] += p.amount;
    }
  }

  // 2. Approved returns, bucketed by the day they were APPROVED (that is when
  //    the money actually moved, and what the incremental path recorded).
  const returns = await Return.find({
    businessId,
    status: "approved",
    decidedAt: { $gte: start, $lt: end },
  })
    .select("branchId decidedAt items refund")
    .lean();
  for (const r of returns) {
    const b = bucket(String(r.branchId), localDay(r.decidedAt));
    const costBack = r.items.reduce((sum, i) => sum + (i.unitCost || 0) * i.qty, 0);
    b.revenue -= r.refund.amount;
    b.cost -= costBack;
    b.profit -= r.refund.amount - costBack;
    b.refundTotal += r.refund.amount;
    if (METHODS.includes(r.refund.method)) b.paymentSplit[r.refund.method] -= r.refund.amount;
    // Damaged returns: their cost is written off as waste (see returns.routes.js approve).
    const damaged = r.items.filter((i) => i.condition === "damaged").reduce((sum, i) => sum + (i.unitCost || 0) * i.qty, 0);
    b.wasteTotal += damaged;
    b.profit -= damaged;
  }

  // 3. Waste — never sold, so no revenue/cost to reverse, just a straight
  //    profit hit valued at each movement's own snapshotted unitCost (not
  //    the product's current cost, which may have moved on since).
  const waste = await StockMovement.find({ ...inRange, refType: "waste" }).select("branchId at qty unitCost").lean();
  for (const w of waste) {
    const b = bucket(String(w.branchId), localDay(w.at));
    const value = Math.abs(w.qty) * (w.unitCost || 0);
    b.wasteTotal += value;
    b.profit -= value;
  }

  // 4. Expenses — kept apart from profit; dashboards subtract them themselves.
  const expenses = await Expense.find(inRange).select("branchId at amount").lean();
  for (const e of expenses) {
    bucket(String(e.branchId), localDay(e.at)).expenses += e.amount;
  }

  // Overwrite every stored day in range, including ones that should now be
  // empty — a stale row left behind is exactly the drift we are fixing.
  const touched = new Set([...acc.keys()]);
  const stale = await DailyMetric.find({ businessId, date: { $gte: from, $lte: to } }).select("branchId date").lean();
  for (const row of stale) {
    const key = `${row.branchId}|${row.date}`;
    if (!touched.has(key)) bucket(String(row.branchId), row.date); // all zeros
  }

  const ops = [...acc.values()].map((v) => ({
    updateOne: {
      filter: { businessId, branchId: v.branchId, date: v.date },
      update: {
        $set: {
          revenue: money(v.revenue), cost: money(v.cost), profit: money(v.profit),
          txns: v.txns, discountTotal: money(v.discountTotal), vatTotal: money(v.vatTotal),
          refundTotal: money(v.refundTotal), wasteTotal: money(v.wasteTotal), expenses: money(v.expenses),
          paymentSplit: {
            cash: money(v.paymentSplit.cash),
            pos: money(v.paymentSplit.pos),
            transfer: money(v.paymentSplit.transfer),
          },
        },
        $setOnInsert: { accountId },
      },
      upsert: true,
    },
  }));
  if (ops.length) await DailyMetric.bulkWrite(ops);

  return {
    rebuilt: ops.length,
    days: new Set([...acc.values()].map((v) => v.date)).size,
    branches: new Set([...acc.values()].map((v) => v.branchId)).size,
    sales: sales.length,
    returns: returns.length,
    waste: waste.length,
    expenses: expenses.length,
  };
}

/** The date range a Profit & Loss period covers, and the one just before it, as YYYY-MM-DD. */
export function financeRange(period, from, to) {
  const today = localDay();
  const span = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86_400_000) + 1;
  let start, end = today, prevStart, prevEnd;
  if (period === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(from || "") && /^\d{4}-\d{2}-\d{2}$/.test(to || "") && from <= to && span(from, to) <= 366) {
    start = from; end = to;
  } else if (period === "today") {
    start = today;
  } else if (period === "month") {
    start = `${today.slice(0, 8)}01`;
  } else if (period === "year") {
    start = `${today.slice(0, 4)}-01-01`;
  } else {
    period = "week";
    start = dayOffset(today, -6);
  }
  if (period === "month") {
    // Compare with the same days of last month, not the whole of it.
    const d = new Date(`${start}T00:00:00`); d.setMonth(d.getMonth() - 1);
    prevStart = localDay(d);
    prevEnd = dayOffset(prevStart, span(start, end) - 1);
  } else if (period === "year") {
    prevStart = `${Number(today.slice(0, 4)) - 1}-01-01`;
    prevEnd = `${Number(today.slice(0, 4)) - 1}${end.slice(4)}`;
  } else {
    prevEnd = dayOffset(start, -1);
    prevStart = dayOffset(prevEnd, -(span(start, end) - 1));
  }
  return { period, from: start, to: end, prevFrom: prevStart, prevTo: prevEnd };
}

/**
 * Profit & Loss for a period, from the same pre-rolled daily numbers the rest
 * of the dashboard reads, so every figure here agrees with the sales list:
 *
 *   sales (after refunds) − VAT − cost of goods sold = gross profit
 *   gross profit − waste − expenses                  = net profit
 *
 * Cost of goods sold uses the cost recorded on each sale line when it was
 * sold (refunded lines put theirs back), not today's product cost. Stock
 * bought in is what was spent on deliveries in the period, which is not a
 * cost until those goods are sold; stock value is what is on the shelf now.
 */
export async function buildFinanceReport(ctx, { period, from, to } = {}) {
  const range = financeRange(period, from, to);
  const scope = { businessId: ctx.businessId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) };

  const rows = await DailyMetric.find({ ...scope, date: { $gte: range.prevFrom < range.from ? range.prevFrom : range.from, $lte: range.to } }).lean();
  const totalsFor = (a, b) => {
    const t = { revenue: 0, vat: 0, cost: 0, profit: 0, waste: 0, expenses: 0, refunds: 0, txns: 0 };
    for (const r of rows) {
      if (r.date < a || r.date > b) continue;
      t.revenue += r.revenue; t.vat += r.vatTotal || 0; t.cost += r.cost; t.profit += r.profit;
      t.waste += r.wasteTotal || 0; t.expenses += r.expenses; t.refunds += r.refundTotal || 0; t.txns += r.txns;
    }
    const grossProfit = t.profit + t.waste; // daily profit already has waste taken out
    const netProfit = t.profit - t.expenses;
    return {
      revenue: money(t.revenue), vat: money(t.vat), netSales: money(t.revenue - t.vat), cogs: money(t.cost),
      grossProfit: money(grossProfit), waste: money(t.waste), expenses: money(t.expenses), netProfit: money(netProfit),
      refunds: money(t.refunds), txns: t.txns,
      grossMargin: t.revenue - t.vat > 0 ? Math.round((grossProfit / (t.revenue - t.vat)) * 1000) / 10 : 0,
      netMargin: t.revenue - t.vat > 0 ? Math.round((netProfit / (t.revenue - t.vat)) * 1000) / 10 : 0,
    };
  };
  const current = totalsFor(range.from, range.to);
  const previous = totalsFor(range.prevFrom, range.prevTo);

  // The trend: by day for anything up to two months, by month beyond that.
  const byMonth = range.period === "year" || (new Date(`${range.to}T00:00:00`) - new Date(`${range.from}T00:00:00`)) / 86_400_000 > 62;
  const buckets = new Map();
  const keyOf = (date) => (byMonth ? date.slice(0, 7) : date);
  for (let d = range.from; d <= range.to; d = dayOffset(d, 1)) {
    const k = keyOf(d);
    if (!buckets.has(k)) buckets.set(k, { key: k, revenue: 0, cogs: 0, expenses: 0, netProfit: 0 });
  }
  for (const r of rows) {
    if (r.date < range.from || r.date > range.to) continue;
    const b = buckets.get(keyOf(r.date));
    b.revenue += r.revenue; b.cogs += r.cost; b.expenses += r.expenses; b.netProfit += r.profit - r.expenses;
  }
  const trend = [...buckets.values()].map((b) => ({
    key: b.key, revenue: money(b.revenue), cogs: money(b.cogs), expenses: money(b.expenses), netProfit: money(b.netProfit),
  }));

  // Expenses by what they were for.
  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${dayOffset(range.to, 1)}T00:00:00`);
  const expenseRows = await Expense.aggregate([
    { $match: { ...scope, at: { $gte: start, $lt: end } } },
    { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    { $sort: { amount: -1 } },
  ]);

  // Stock bought in during the period: each delivery at the cost it was
  // received at, or the product's cost where none was entered.
  const ins = await StockMovement.find({ ...scope, type: "IN", refType: { $ne: "production" }, at: { $gte: start, $lt: end } })
    .select("productId qty unitCost").lean();
  const needCost = [...new Set(ins.filter((m) => m.unitCost === undefined || m.unitCost === null).map((m) => String(m.productId)))];
  const costOf = new Map(
    (needCost.length ? await Product.find({ _id: { $in: needCost } }).select("cost").lean() : []).map((p) => [String(p._id), p.cost || 0])
  );
  const purchases = ins.reduce((s, m) => s + m.qty * (m.unitCost ?? costOf.get(String(m.productId)) ?? 0), 0);

  const inventory = await buildInventoryReport(ctx);

  return {
    ...range,
    current,
    previous,
    trendBy: byMonth ? "month" : "day",
    trend,
    expensesByType: expenseRows.map((e) => ({ type: e._id || "Other", amount: money(e.amount), count: e.count })),
    stock: { purchases: money(purchases), deliveries: ins.length, valueAtCost: inventory.costValue ?? 0, valueAtPrice: inventory.retailValue ?? 0 },
  };
}
