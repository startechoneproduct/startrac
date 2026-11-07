import { Sale } from "#modules/sales/sale.model.js";
import { Expense } from "#modules/expenses/expense.model.js";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { Branch } from "#modules/business/branch.model.js";
import {
  buildSalesReport, buildDashboardSummary, buildInventoryReport, buildCustomersReport, buildStaffReport,
  localDay, dayOffset,
} from "#modules/metrics/metrics.service.js";
import { scopedToBranch } from "#core/branchScope.js";
import { hasCapability } from "#shared/businessTypes.js";
import { money } from "#core/money.js";

/**
 * Report data, assembled from the SAME builders the dashboard uses — so a
 * downloaded report can never disagree with the screen, and nothing in it is
 * written by the AI. The AI only decides which report to offer; the numbers
 * come from the database at the moment of download.
 *
 * Every builder returns the same neutral shape, which the PDF and Excel
 * renderers both consume:
 *
 *   { kind, title, subtitle, currency, business, branch, period, generatedAt,
 *     generatedBy, highlights[], kpis[], sections[] }
 *
 * kpis:     { label, value, format, hint?, tone? }
 * sections: { title, note?, columns[{ key, label, format, align? }], rows[], totals? }
 * formats:  text | money | int | decimal | pct | date | datetime
 */

export const REPORT_KINDS = {
  summary:      { label: "Business summary",   blurb: "Today, this week, top sellers and stock alerts in one page", perms: ["dashboard_ops"], days: false },
  sales:        { label: "Sales report",       blurb: "Revenue, profit, staff, category and payment breakdown",     perms: ["dashboard_ops"], days: true },
  transactions: { label: "Sales transactions", blurb: "Every receipt in the period, line by line",                  perms: ["dashboard_ops"], days: true },
  expenses:     { label: "Expenses report",    blurb: "What was spent, on what, and by whom",                       perms: ["expenses", "dashboard_ops"], days: true },
  inventory:    { label: "Inventory report",   blurb: "Stock on hand and its value, reorder list and expiry",       perms: ["dashboard_ops", "stock"], days: false },
  customers:    { label: "Customers report",   blurb: "Top spenders, newest customers and who owes money",          perms: ["customers", "dashboard_ops"], days: false },
  staff:        { label: "Staff performance",  blurb: "Sales, discounts, voids and hours per person",               perms: ["dashboard_ops"], days: false },
};

export const ALLOWED_DAYS = [1, 7, 30, 90];

export const canBuild = (ctx, kind) => {
  const k = REPORT_KINDS[kind];
  return !!k && (ctx.perms.includes("*") || k.perms.some((p) => ctx.perms.includes(p)));
};

export const reportsFor = (ctx) =>
  Object.entries(REPORT_KINDS).filter(([k]) => canBuild(ctx, k)).map(([key, v]) => ({ key, label: v.label, blurb: v.blurb, days: v.days }));

export const clampDays = (n, fallback = 30) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return ALLOWED_DAYS.reduce((best, d) => (Math.abs(d - v) < Math.abs(best - v) ? d : best), ALLOWED_DAYS[0]);
};

// ── small helpers ────────────────────────────────────────────────────
const sum = (rows, key) => money(rows.reduce((n, r) => n + (Number(r[key]) || 0), 0));
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const fmt = (currency, n) => `${currency}${Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
const METHOD = { cash: "Cash", pos: "POS", transfer: "Transfer" };

async function frame(ctx, kind, { subtitle, period } = {}) {
  const branch = ctx.branchId ? await Branch.findById(ctx.branchId).select("name") : null;
  return {
    kind,
    title: REPORT_KINDS[kind].label,
    subtitle: subtitle || REPORT_KINDS[kind].blurb,
    currency: ctx.business?.settings?.currency || "₦",
    business: { name: ctx.business?.name || "Business", type: ctx.business?.typeKey || "" },
    branch: branch?.name || "All branches",
    period: period || null,
    generatedAt: new Date().toISOString(),
    generatedBy: ctx.actorName || "",
    highlights: [],
    kpis: [],
    sections: [],
  };
}

const periodFor = (days) => {
  const to = localDay();
  const from = dayOffset(to, -(days - 1));
  return { label: days === 1 ? "Today" : `Last ${days} days`, from, to, days };
};

// ── builders ─────────────────────────────────────────────────────────

async function salesReport(ctx, days) {
  const d = Math.max(days, 7); // the daily roll-up is never shorter than a week
  const r = await buildSalesReport(ctx, d);
  const finance = r.totals.profit !== undefined;
  const out = await frame(ctx, "sales", { period: periodFor(r.days) });
  const c = out.currency;

  const best = [...r.series].sort((a, b) => b.revenue - a.revenue)[0];
  out.kpis = [
    { label: "Revenue", value: r.totals.revenue, format: "money" },
    { label: "Transactions", value: r.totals.txns, format: "int" },
    { label: "Average sale", value: r.totals.avgSale, format: "money" },
    ...(finance ? [
      { label: "Profit after expenses", value: r.totals.profit, format: "money", tone: r.totals.profit < 0 ? "bad" : "good" },
      { label: "Expenses", value: r.totals.expenses, format: "money" },
    ] : []),
    { label: "Best day", value: best && best.revenue > 0 ? dayLabel(best.date) : "—", format: "text", hint: best && best.revenue > 0 ? fmt(c, best.revenue) : undefined },
  ];

  const cols = [
    { key: "date", label: "Day", format: "text" },
    { key: "revenue", label: "Revenue", format: "money", align: "right" },
    { key: "txns", label: "Sales", format: "int", align: "right" },
    ...(finance ? [{ key: "profit", label: "Profit after expenses", format: "money", align: "right" }] : []),
  ];
  // Days before the first sale are noise — a new shop's 30-day report would
  // open with three weeks of zeros. Keep everything from the first active day.
  const firstActive = r.series.findIndex((s) => s.txns > 0 || s.revenue !== 0);
  const shown = firstActive > 0 ? r.series.slice(firstActive) : r.series;
  const rows = shown.map((s) => ({ date: dayLabel(s.date), revenue: s.revenue, txns: s.txns, profit: s.profit }));
  out.sections.push({
    title: "Daily performance",
    note: firstActive > 0 ? `Days before the first sale (${r.series.length - shown.length}) are left out.` : undefined,
    columns: cols, rows,
    totals: { date: "Total", revenue: r.totals.revenue, txns: r.totals.txns, ...(finance ? { profit: r.totals.profit } : {}) },
  });

  if (r.byStaff.length) {
    out.sections.push({
      title: "By staff", note: "Completed sales rung up by each person",
      columns: [
        { key: "name", label: "Staff", format: "text" },
        { key: "sales", label: "Sales", format: "int", align: "right" },
        { key: "revenue", label: "Revenue", format: "money", align: "right" },
        { key: "share", label: "Share", format: "pct", align: "right" },
      ],
      rows: r.byStaff.map((s) => ({ ...s, share: share(s.revenue, r.totals.revenue) })),
    });
  }
  if (r.byCategory.length) {
    out.sections.push({
      title: "By category", note: "What sold, grouped by product category",
      columns: [
        { key: "category", label: "Category", format: "text" },
        { key: "sold", label: "Units sold", format: "int", align: "right" },
        { key: "revenue", label: "Revenue", format: "money", align: "right" },
        { key: "share", label: "Share", format: "pct", align: "right" },
      ],
      rows: r.byCategory.map((x) => ({ ...x, share: share(x.revenue, r.totals.revenue) })),
    });
  }
  if (r.byMethod.length) {
    const totalPaid = sum(r.byMethod, "amount");
    out.sections.push({
      title: "How customers paid",
      columns: [
        { key: "method", label: "Method", format: "text" },
        { key: "amount", label: "Amount", format: "money", align: "right" },
        { key: "share", label: "Share", format: "pct", align: "right" },
      ],
      rows: r.byMethod.map((m) => ({ method: METHOD[m.method] || m.method, amount: m.amount, share: share(m.amount, totalPaid) })),
      totals: { method: "Total", amount: totalPaid },
    });
  }

  if (best && best.revenue > 0) out.highlights.push(`Best day was ${dayLabel(best.date)} with ${fmt(c, best.revenue)} from ${best.txns} sale${best.txns === 1 ? "" : "s"}.`);
  if (r.byStaff[0]) out.highlights.push(`${r.byStaff[0].name} led the team with ${fmt(c, r.byStaff[0].revenue)} (${share(r.byStaff[0].revenue, r.totals.revenue)}% of revenue).`);
  if (r.byCategory[0]) out.highlights.push(`${r.byCategory[0].category} was the strongest category at ${fmt(c, r.byCategory[0].revenue)}.`);
  if (finance && r.totals.profit < 0) out.highlights.push(`Expenses outran profit in this period — a loss of ${fmt(c, Math.abs(r.totals.profit))}.`);
  return out;
}

async function transactionsReport(ctx, days) {
  const period = periodFor(days);
  const since = new Date(`${period.from}T00:00:00`);
  const LIMIT = 2000;
  const sales = await Sale.find({ businessId: ctx.businessId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}), at: { $gte: since } })
    .sort({ at: -1 }).limit(LIMIT + 1);
  const truncated = sales.length > LIMIT;
  const list = sales.slice(0, LIMIT);

  const out = await frame(ctx, "transactions", { period });
  const done = list.filter((s) => s.status === "completed");
  const revenue = money(done.reduce((n, s) => n + s.total, 0));
  out.kpis = [
    { label: "Completed sales", value: done.length, format: "int" },
    { label: "Voided", value: list.length - done.length, format: "int", tone: list.length - done.length ? "warn" : undefined },
    { label: "Revenue", value: revenue, format: "money" },
    { label: "Average sale", value: done.length ? money(revenue / done.length) : 0, format: "money" },
    { label: "Discounts given", value: money(done.reduce((n, s) => n + (s.discount || 0), 0)), format: "money" },
  ];
  out.sections.push({
    title: "Receipts",
    note: truncated ? `Showing the newest ${LIMIT} receipts of this period.` : undefined,
    columns: [
      { key: "saleNo", label: "Receipt", format: "text" },
      { key: "at", label: "When", format: "datetime" },
      { key: "staff", label: "Staff", format: "text" },
      { key: "customer", label: "Customer", format: "text" },
      { key: "items", label: "Items", format: "text" },
      { key: "method", label: "Paid by", format: "text" },
      { key: "discount", label: "Discount", format: "money", align: "right" },
      { key: "total", label: "Total", format: "money", align: "right" },
      { key: "status", label: "Status", format: "text" },
    ],
    rows: list.map((s) => ({
      saleNo: s.saleNo,
      at: s.at,
      staff: s.staffName,
      customer: s.customerName || "—",
      items: s.items.map((i) => `${i.name} ×${i.qty}`).join(", "),
      method: [...new Set(s.payments.map((p) => METHOD[p.method] || p.method))].join(" + "),
      discount: s.discount || 0,
      total: s.total,
      status: s.status === "voided" ? "Voided" : "Completed",
    })),
    totals: { saleNo: "Completed total", total: revenue },
  });
  return out;
}

const METHOD_LABEL = { cash: "Cash", transfer: "Bank transfer", pos: "POS", card: "Card", cheque: "Cheque", other: "Other" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// opts (from the Expenses page): an exact from/to range, and the category or payment method it was filtered to.
async function expensesReport(ctx, days, opts = {}) {
  const ranged = DAY.test(opts.from || "") && DAY.test(opts.to || "") && opts.from <= opts.to;
  const period = ranged
    ? { label: `${opts.from} to ${opts.to}`, from: opts.from, to: opts.to, days: Math.round((new Date(`${opts.to}T00:00:00`) - new Date(`${opts.from}T00:00:00`)) / 86400000) + 1 }
    : periodFor(days);
  const since = new Date(`${period.from}T00:00:00`);
  const until = new Date(new Date(`${period.to}T00:00:00`).getTime() + 86400000);
  const filter = { businessId: ctx.businessId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}), at: { $gte: since, $lt: until } };
  if (opts.type) filter.type = String(opts.type);
  if (opts.method && METHOD_LABEL[opts.method]) filter.paymentMethod = opts.method;
  const rows = await Expense.find(filter).sort({ at: -1 }).limit(5000);

  const out = await frame(ctx, "expenses", { period });
  const total = sum(rows, "amount");
  const byType = new Map();
  for (const e of rows) {
    const t = byType.get(e.type) || { type: e.type, entries: 0, amount: 0 };
    t.entries += 1; t.amount = money(t.amount + e.amount);
    byType.set(e.type, t);
  }
  const types = [...byType.values()].sort((a, b) => b.amount - a.amount);

  out.kpis = [
    { label: "Total spent", value: total, format: "money", tone: total > 0 ? "bad" : undefined },
    { label: "Entries", value: rows.length, format: "int" },
    { label: "Largest category", value: types[0]?.type || "—", format: "text", hint: types[0] ? fmt(out.currency, types[0].amount) : undefined },
    { label: "Daily average", value: money(total / period.days), format: "money" },
  ];
  if (types.length) {
    out.sections.push({
      title: "By type",
      columns: [
        { key: "type", label: "Type", format: "text" },
        { key: "entries", label: "Entries", format: "int", align: "right" },
        { key: "amount", label: "Amount", format: "money", align: "right" },
        { key: "share", label: "Share", format: "pct", align: "right" },
      ],
      rows: types.map((t) => ({ ...t, share: share(t.amount, total) })),
      totals: { type: "Total", entries: rows.length, amount: total },
    });
  }
  out.sections.push({
    title: "All entries",
    columns: [
      { key: "at", label: "Date", format: "date" },
      { key: "type", label: "Category", format: "text" },
      { key: "notes", label: "Description", format: "text" },
      { key: "method", label: "Paid with", format: "text" },
      { key: "reference", label: "Receipt no.", format: "text" },
      { key: "paidBy", label: "Paid by", format: "text" },
      { key: "actorName", label: "Recorded by", format: "text" },
      { key: "amount", label: "Amount", format: "money", align: "right" },
    ],
    rows: rows.map((e) => ({ at: e.at, type: e.type, notes: e.notes || "—", method: METHOD_LABEL[e.paymentMethod] || "Cash", reference: e.reference || "—", paidBy: e.paidBy || "—", actorName: e.actorName, amount: e.amount })),
    totals: { type: "Total", amount: total },
  });
  if (types[0]) out.highlights.push(`${types[0].type} was the biggest cost at ${fmt(out.currency, types[0].amount)} (${share(types[0].amount, total)}% of spending).`);
  return out;
}

async function inventoryReport(ctx) {
  const r = await buildInventoryReport(ctx);
  const finance = r.costValue !== undefined;
  const out = await frame(ctx, "inventory");
  const c = out.currency;

  out.kpis = [
    { label: "Products", value: r.skus, format: "int" },
    { label: "Units on hand", value: r.units, format: "int" },
    { label: "Stock value (retail)", value: r.retailValue, format: "money" },
    ...(finance ? [
      { label: "Stock value (cost)", value: r.costValue, format: "money" },
      { label: "Profit on the shelf", value: r.potentialProfit, format: "money", tone: "good" },
    ] : []),
    { label: "Turnover (30 days)", value: r.turnover, format: "decimal", hint: "units out ÷ units on hand" },
  ];

  // The full stock list, at this branch (or summed across branches).
  const products = await Product.find(scopedToBranch(ctx, { businessId: ctx.businessId, status: "active", archetype: { $ne: "made_to_order" } }))
    .sort({ name: 1 }).limit(1000).select("name category unit price cost reorderLevel");
  const inv = await Inventory.find({ ...(ctx.branchId ? { branchId: ctx.branchId } : { businessId: ctx.businessId }), productId: { $in: products.map((p) => p._id) } });
  const stockBy = new Map();
  for (const i of inv) stockBy.set(String(i.productId), (stockBy.get(String(i.productId)) || 0) + i.stock);
  const stockRows = products.map((p) => {
    const stock = stockBy.get(String(p._id)) ?? 0;
    return { name: p.name, category: p.category, unit: p.unit || "unit", stock, reorderLevel: p.reorderLevel, price: p.price, cost: p.cost || 0, value: money(stock * (finance ? p.cost || 0 : p.price)) };
  });
  out.sections.push({
    title: "Stock on hand",
    note: finance ? "Value is at cost" : "Value is at selling price",
    columns: [
      { key: "name", label: "Product", format: "text" },
      { key: "category", label: "Category", format: "text" },
      { key: "stock", label: "In stock", format: "int", align: "right" },
      { key: "reorderLevel", label: "Reorder at", format: "int", align: "right" },
      { key: "price", label: "Price", format: "money", align: "right" },
      ...(finance ? [{ key: "cost", label: "Cost", format: "money", align: "right" }] : []),
      { key: "value", label: "Value", format: "money", align: "right" },
    ],
    rows: stockRows,
    totals: { name: "Total", stock: stockRows.reduce((n, x) => n + x.stock, 0), value: sum(stockRows, "value") },
  });

  if (r.lowStock.length) {
    out.sections.push({
      title: "Needs reordering",
      columns: [
        { key: "name", label: "Product", format: "text" },
        { key: "stock", label: "In stock", format: "int", align: "right" },
        { key: "reorderLevel", label: "Reorder at", format: "int", align: "right" },
      ],
      rows: r.lowStock,
    });
  }
  if (r.expiringSoon.length) {
    out.sections.push({
      title: "Expiring within 30 days",
      columns: [
        { key: "name", label: "Product", format: "text" },
        { key: "stock", label: "In stock", format: "int", align: "right" },
        { key: "expiry", label: "Expires", format: "date" },
        { key: "state", label: "Status", format: "text" },
      ],
      rows: r.expiringSoon.map((e) => ({ ...e, state: e.expired ? "Expired" : "Expiring" })),
    });
  }
  if (r.topMovers.length) {
    out.sections.push({
      title: "Fastest movers · last 30 days",
      columns: [
        { key: "name", label: "Product", format: "text" },
        { key: "unitsIn", label: "Units in", format: "int", align: "right" },
        { key: "unitsOut", label: "Units out", format: "int", align: "right" },
      ],
      rows: r.topMovers,
    });
  }

  if (r.lowStock.length) out.highlights.push(`${r.lowStock.length} product${r.lowStock.length === 1 ? " is" : "s are"} at or below the reorder level — ${r.lowStock[0].name} is the lowest (${r.lowStock[0].stock} left).`);
  if (r.expiringSoon.length) out.highlights.push(`${r.expiringSoon.length} product${r.expiringSoon.length === 1 ? "" : "s"} expire${r.expiringSoon.length === 1 ? "s" : ""} within 30 days.`);
  if (finance) out.highlights.push(`Stock is worth ${fmt(c, r.costValue)} at cost and ${fmt(c, r.retailValue)} at selling price.`);
  return out;
}

async function customersReport(ctx) {
  const r = await buildCustomersReport(ctx);
  const out = await frame(ctx, "customers");
  out.kpis = [
    { label: "Customers on file", value: r.totals.customers, format: "int" },
    { label: "New · last 30 days", value: r.totals.newLast30, format: "int" },
    { label: "Active · last 30 days", value: r.totals.activeLast30, format: "int" },
    { label: "Repeat rate", value: r.totals.repeatRate, format: "pct", hint: "bought more than once" },
  ];
  if (r.topSpenders.length) {
    out.sections.push({
      title: "Top spenders",
      columns: [
        { key: "name", label: "Customer", format: "text" },
        { key: "phone", label: "Phone", format: "text" },
        { key: "visits", label: "Visits", format: "int", align: "right" },
        { key: "totalSpend", label: "Total spend", format: "money", align: "right" },
        { key: "lastSeen", label: "Last seen", format: "date" },
      ],
      rows: r.topSpenders.map((c) => ({ ...c, phone: c.phone || "—" })),
    });
  }
  if (r.newest.length) {
    out.sections.push({
      title: "Newest customers",
      columns: [
        { key: "name", label: "Customer", format: "text" },
        { key: "phone", label: "Phone", format: "text" },
        { key: "firstSeen", label: "First seen", format: "date" },
        { key: "totalSpend", label: "Spend so far", format: "money", align: "right" },
      ],
      rows: r.newest.map((c) => ({ ...c, phone: c.phone || "—" })),
    });
  }
  if (hasCapability(ctx.business?.typeKey, "credit")) {
    const debtors = await Customer.find(scopedToBranch(ctx, { businessId: ctx.businessId, creditBalance: { $gt: 0 } })).sort({ creditBalance: -1 }).limit(200).select("name phone creditBalance lastSeen");
    if (debtors.length) {
      const owed = sum(debtors.map((d) => ({ v: d.creditBalance })), "v");
      out.kpis.push({ label: "Owed by customers", value: owed, format: "money", tone: "warn" });
      out.sections.push({
        title: "Who owes money",
        columns: [
          { key: "name", label: "Customer", format: "text" },
          { key: "phone", label: "Phone", format: "text" },
          { key: "lastSeen", label: "Last seen", format: "date" },
          { key: "balance", label: "Owes", format: "money", align: "right" },
        ],
        rows: debtors.map((d) => ({ name: d.name, phone: d.phone || "—", lastSeen: d.lastSeen, balance: d.creditBalance })),
        totals: { name: "Total owed", balance: owed },
      });
      out.highlights.push(`${debtors.length} customer${debtors.length === 1 ? " owes" : "s owe"} ${fmt(out.currency, owed)} in total.`);
    }
  }
  if (r.topSpenders[0]) out.highlights.push(`${r.topSpenders[0].name} is the top spender at ${fmt(out.currency, r.topSpenders[0].totalSpend)}.`);
  return out;
}

async function staffReport(ctx) {
  const r = await buildStaffReport(ctx);
  const out = await frame(ctx, "staff", { period: periodFor(r.days) });
  const revenue = sum(r.staff, "revenue");
  out.kpis = [
    { label: "People with activity", value: r.staff.length, format: "int" },
    { label: "Revenue rung up", value: revenue, format: "money" },
    { label: "Sales", value: r.staff.reduce((n, s) => n + s.sales, 0), format: "int" },
    { label: "Hours worked", value: money(r.staff.reduce((n, s) => n + s.hours, 0)), format: "decimal" },
    { label: "Voided sales", value: r.staff.reduce((n, s) => n + s.voids, 0), format: "int", tone: r.staff.some((s) => s.voids) ? "warn" : undefined },
  ];
  out.sections.push({
    title: "Team performance",
    columns: [
      { key: "name", label: "Staff", format: "text" },
      { key: "sales", label: "Sales", format: "int", align: "right" },
      { key: "revenue", label: "Revenue", format: "money", align: "right" },
      { key: "avgSale", label: "Avg sale", format: "money", align: "right" },
      { key: "discounts", label: "Discounts", format: "money", align: "right" },
      { key: "voids", label: "Voids", format: "int", align: "right" },
      { key: "hours", label: "Hours", format: "decimal", align: "right" },
      { key: "shifts", label: "Shifts", format: "int", align: "right" },
    ],
    rows: r.staff,
    totals: {
      name: "Team", sales: r.staff.reduce((n, s) => n + s.sales, 0), revenue,
      discounts: sum(r.staff, "discounts"), voids: r.staff.reduce((n, s) => n + s.voids, 0),
      hours: money(r.staff.reduce((n, s) => n + s.hours, 0)), shifts: r.staff.reduce((n, s) => n + s.shifts, 0),
    },
  });
  if (r.staff[0] && r.staff[0].revenue > 0) out.highlights.push(`${r.staff[0].name} rang up the most — ${fmt(out.currency, r.staff[0].revenue)} from ${r.staff[0].sales} sales.`);
  const voiders = r.staff.filter((s) => s.voids > 0).sort((a, b) => b.voids - a.voids);
  if (voiders[0]) out.highlights.push(`${voiders[0].name} has the most voided sales (${voiders[0].voids}) — worth a look.`);
  return out;
}

async function summaryReport(ctx) {
  const m = await buildDashboardSummary(ctx);
  const finance = m.today.profit !== undefined;
  const out = await frame(ctx, "summary", { period: { label: "Today and the last 7 days", from: m.series7d[0]?.date, to: m.series7d[m.series7d.length - 1]?.date, days: 7 } });
  const c = out.currency;

  out.kpis = [
    { label: "Revenue today", value: m.today.revenue, format: "money" },
    ...(finance ? [{ label: "Net profit today", value: m.today.profit, format: "money", tone: m.today.profit < 0 ? "bad" : "good" }] : []),
    { label: "Transactions today", value: m.today.txns, format: "int" },
    { label: "Revenue · last 7 days", value: m.week.revenue, format: "money", hint: `${m.week.deltaPct >= 0 ? "+" : ""}${m.week.deltaPct}% vs the week before` },
  ];
  out.sections.push({
    title: "Last 7 days",
    columns: [
      { key: "date", label: "Day", format: "text" },
      { key: "revenue", label: "Revenue", format: "money", align: "right" },
      { key: "txns", label: "Sales", format: "int", align: "right" },
      ...(finance ? [{ key: "profit", label: "Profit", format: "money", align: "right" }] : []),
    ],
    rows: m.series7d.map((s) => ({ date: dayLabel(s.date), revenue: s.revenue, txns: s.txns, profit: s.profit })),
    totals: { date: "Total", revenue: sum(m.series7d, "revenue"), txns: m.series7d.reduce((n, s) => n + s.txns, 0), ...(finance ? { profit: sum(m.series7d, "profit") } : {}) },
  });
  const paid = Object.entries(m.paymentSplit).filter(([, v]) => v > 0);
  if (paid.length) {
    const t = paid.reduce((n, [, v]) => n + v, 0);
    out.sections.push({
      title: "How customers paid today",
      columns: [{ key: "method", label: "Method", format: "text" }, { key: "amount", label: "Amount", format: "money", align: "right" }, { key: "share", label: "Share", format: "pct", align: "right" }],
      rows: paid.map(([k, v]) => ({ method: METHOD[k] || k, amount: v, share: share(v, t) })),
    });
  }
  if (m.topProducts.length) {
    out.sections.push({
      title: "Top moving products",
      columns: [{ key: "name", label: "Product", format: "text" }, { key: "sold", label: "Qty sold", format: "int", align: "right" }, { key: "revenue", label: "Revenue", format: "money", align: "right" }],
      rows: m.topProducts,
    });
  }
  if (m.lowStock.length) {
    out.sections.push({
      title: "Stock alerts",
      columns: [{ key: "name", label: "Product", format: "text" }, { key: "stock", label: "In stock", format: "int", align: "right" }, { key: "reorderLevel", label: "Reorder at", format: "int", align: "right" }],
      rows: m.lowStock,
    });
  }
  if (m.recentSales.length) {
    out.sections.push({
      title: "Latest sales",
      columns: [{ key: "saleNo", label: "Receipt", format: "text" }, { key: "at", label: "When", format: "datetime" }, { key: "staffName", label: "Staff", format: "text" }, { key: "total", label: "Total", format: "money", align: "right" }],
      rows: m.recentSales.map((s) => ({ ...s })),
    });
  }
  if (m.topProducts[0]) out.highlights.push(`${m.topProducts[0].name} is the best seller this week at ${fmt(c, m.topProducts[0].revenue)}.`);
  if (m.lowStock.length) out.highlights.push(`${m.lowStock.length} item${m.lowStock.length === 1 ? "" : "s"} running low on stock.`);
  return out;
}

export async function buildReport(ctx, kind, days, opts = {}) {
  if (!canBuild(ctx, kind)) return null;
  const d = clampDays(days);
  switch (kind) {
    case "summary": return summaryReport(ctx);
    case "sales": return salesReport(ctx, d);
    case "transactions": return transactionsReport(ctx, d);
    case "expenses": return expensesReport(ctx, d, opts);
    case "inventory": return inventoryReport(ctx);
    case "customers": return customersReport(ctx);
    case "staff": return staffReport(ctx);
    default: return null;
  }
}
