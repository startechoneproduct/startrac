import { Router } from "express";
import multer from "multer";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { StockMovement } from "#modules/inventory/stockMovement.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { requirePerm, requireBranch, requireFeature, canSeeCost, limitProblem, planRequired } from "#core/middleware/tenant.js";
import { applyMovement, openStockInBulk } from "#modules/inventory/inventory.service.js";
import { afterStockChange } from "#modules/alerts/alerts.service.js";
import { scopedToBranch, ownerBranchForNew } from "#core/branchScope.js";
import { parseUpload, UploadError, MAX_FILE_BYTES } from "#modules/imports/parseSheet.js";
import { guessColumns, cleanMapping, bestTable } from "#modules/imports/columns.js";
import { clean, normKey, parseCount, parseMoney } from "#modules/imports/values.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { escapeRegex } from "#core/regex.js";
import { Branch } from "#modules/business/branch.model.js";
import { planAllows } from "#shared/plans.js";
import { renderPdf } from "#modules/reports/renderPdf.js";
import { renderXlsx } from "#modules/reports/renderXlsx.js";

/**
 * The inventory hub: one place to see what's on the shelf, what it's worth, what
 * is selling and what to buy next. It reads the same stock levels and ledger the
 * rest of the app writes (Inventory + StockMovement) — it adds views and one
 * bulk door (opening stock), never a second copy of the truth.
 *
 * Cost and value are only ever sent to roles that may see cost (canSeeCost),
 * enforced here at the data layer like everywhere else in the app.
 */
export const inventoryHubRouter = Router();

const DAY = 86_400_000;
const canRead = requirePerm("inventory_view");

/** Stock products of this business that the active store sells, with the branch's level joined on. */
function stockPipeline(ctx, extraMatch = {}) {
  const match = scopedToBranch(ctx, { businessId: ctx.businessId, status: "active", archetype: { $ne: "made_to_order" }, ...extraMatch });
  return [
    { $match: match },
    { $lookup: { from: "inventories", let: { pid: "$_id" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$productId", "$$pid"] }, { $eq: ["$branchId", ctx.branchId] }] } } }], as: "inv" } },
    { $addFields: { stock: { $ifNull: [{ $arrayElemAt: ["$inv.stock", 0] }, 0] } } },
    {
      $addFields: {
        stockStatus: { $cond: [{ $lte: ["$stock", 0] }, "out", { $cond: [{ $lte: ["$stock", "$reorderLevel"] }, "low", "ok"] }] },
        stockValue: { $multiply: [{ $max: ["$stock", 0] }, { $ifNull: ["$cost", 0] }] },
        retailValue: { $multiply: [{ $max: ["$stock", 0] }, { $ifNull: ["$price", 0] }] },
      },
    },
    { $project: { inv: 0, bom: 0 } },
  ];
}


function shapeRow(p, showCost) {
  return {
    id: String(p._id), name: p.name, sku: p.sku || "", barcode: p.barcode || "", category: p.category || "", unit: p.unit || "unit",
    imageUrl: p.imageUrl || "", stock: p.stock, reorderLevel: p.reorderLevel, status: p.stockStatus,
    price: p.price, retailValue: money(p.retailValue || 0),
    ...(showCost ? { cost: p.cost || 0, stockValue: money(p.stockValue || 0) } : {}),
  };
}

/**
 * The list's filters: a search, a category, and a stock status — ok / low /
 * out, or "instock" for everything with at least one on the shelf (the
 * "hide zero stock" view). Shared by the screen and every export, so a file
 * always holds exactly what was on screen.
 */
function listFilters(req) {
  const extra = {};
  if (req.query.q) {
    const rx = { $regex: escapeRegex(String(req.query.q).trim().slice(0, 60)), $options: "i" };
    extra.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
  }
  if (req.query.category) extra.category = String(req.query.category);
  const status = ["low", "out", "ok", "instock"].includes(String(req.query.status)) ? String(req.query.status) : null;
  const statusStage = status === "instock" ? [{ $match: { stock: { $gt: 0 } } }] : status ? [{ $match: { stockStatus: status } }] : [];
  return { extra, status, statusStage };
}

// GET /api/inventory/overview?q=&category=&status=all|low|out|ok|instock&sort=&page=&limit=
inventoryHubRouter.get("/overview", canRead, requireBranch, async (req, res) => {
  const showCost = canSeeCost(req.ctx);
  const { extra, statusStage } = listFilters(req);
  const sorts = {
    name: { name: 1 }, stock: { stock: 1, name: 1 }, "-stock": { stock: -1, name: 1 },
    value: { stockValue: -1, name: 1 }, status: { statusRank: 1, stock: 1, name: 1 },
  };
  const sort = sorts[String(req.query.sort)] || sorts.name;
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
  const page = Math.max(Number(req.query.page) || 1, 1);

  const base = stockPipeline(req.ctx, extra);
  const [rows, summary, categories] = await Promise.all([
    Product.aggregate([
      ...base,
      ...statusStage,
      { $addFields: { statusRank: { $switch: { branches: [{ case: { $eq: ["$stockStatus", "out"] }, then: 0 }, { case: { $eq: ["$stockStatus", "low"] }, then: 1 }], default: 2 } } } },
      { $sort: sort },
      { $facet: { page: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: "n" }] } },
    ]),
    // The whole shelf, whatever the filters above say.
    Product.aggregate([
      ...stockPipeline(req.ctx),
      { $group: { _id: null, items: { $sum: 1 }, units: { $sum: { $max: ["$stock", 0] } }, cost: { $sum: "$stockValue" }, retail: { $sum: "$retailValue" }, low: { $sum: { $cond: [{ $eq: ["$stockStatus", "low"] }, 1, 0] } }, out: { $sum: { $cond: [{ $eq: ["$stockStatus", "out"] }, 1, 0] } } } },
    ]),
    Product.distinct("category", scopedToBranch(req.ctx, { businessId: req.ctx.businessId, status: "active", archetype: { $ne: "made_to_order" } })),
  ]);
  const total = rows[0]?.total[0]?.n || 0;
  const s = summary[0] || { items: 0, units: 0, cost: 0, retail: 0, low: 0, out: 0 };
  res.json({
    items: (rows[0]?.page || []).map((p) => shapeRow(p, showCost)),
    summary: {
      items: s.items, units: s.units, low: s.low, out: s.out, retailValue: money(s.retail),
      ...(showCost ? { stockValue: money(s.cost), potentialProfit: money(s.retail - s.cost) } : {}),
    },
    categories: categories.filter(Boolean).sort(),
    page, pages: Math.max(1, Math.ceil(total / limit)), total, canSeeCost: showCost,
  });
});

// GET /api/inventory/valuation — what the shelf is worth, and where the money sits
inventoryHubRouter.get("/valuation", canRead, requireBranch, async (req, res) => {
  if (!canSeeCost(req.ctx)) return res.status(403).json({ error: "forbidden", message: "Stock value shows cost prices, which your role can't see." });
  const [byCategory, top] = await Promise.all([
    Product.aggregate([
      ...stockPipeline(req.ctx),
      { $group: { _id: { $ifNull: ["$category", "General"] }, items: { $sum: 1 }, units: { $sum: { $max: ["$stock", 0] } }, cost: { $sum: "$stockValue" }, retail: { $sum: "$retailValue" } } },
      { $sort: { cost: -1 } },
    ]),
    Product.aggregate([...stockPipeline(req.ctx), { $match: { stock: { $gt: 0 } } }, { $sort: { stockValue: -1 } }, { $limit: 10 }]),
  ]);
  const totals = byCategory.reduce((t, c) => ({ cost: t.cost + c.cost, retail: t.retail + c.retail, units: t.units + c.units, items: t.items + c.items }), { cost: 0, retail: 0, units: 0, items: 0 });
  res.json({
    asOf: new Date(),
    totals: { items: totals.items, units: totals.units, atCost: money(totals.cost), atRetail: money(totals.retail), potentialProfit: money(totals.retail - totals.cost), marginPct: totals.retail ? Math.round(((totals.retail - totals.cost) / totals.retail) * 1000) / 10 : 0 },
    byCategory: byCategory.map((c) => ({ category: c._id, items: c.items, units: c.units, atCost: money(c.cost), atRetail: money(c.retail), sharePct: totals.cost ? Math.round((c.cost / totals.cost) * 1000) / 10 : 0 })),
    topByValue: top.map((p) => ({ id: String(p._id), name: p.name, stock: p.stock, cost: p.cost || 0, stockValue: money(p.stockValue), sharePct: totals.cost ? Math.round((p.stockValue / totals.cost) * 1000) / 10 : 0 })),
  });
});

/** Units sold per product at this store over the last `days`, from completed sales. */
async function soldByProduct(ctx, days) {
  const since = new Date(Date.now() - days * DAY);
  const rows = await Sale.aggregate([
    { $match: { businessId: ctx.businessId, branchId: ctx.branchId, status: "completed", at: { $gte: since } } },
    { $unwind: "$items" },
    { $group: { _id: "$items.productId", qty: { $sum: { $subtract: ["$items.qty", { $ifNull: ["$items.returnedQty", 0] }] } }, revenue: { $sum: "$items.lineNet" }, lastSold: { $max: "$at" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

// GET /api/inventory/movers?days=30 — what's flying, what's gathering dust, what runs out soon
inventoryHubRouter.get("/movers", canRead, requireBranch, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365);
  const showCost = canSeeCost(req.ctx);
  const [products, sold] = await Promise.all([Product.aggregate(stockPipeline(req.ctx)), soldByProduct(req.ctx, days)]);

  const rows = products.map((p) => {
    const s = sold.get(String(p._id));
    const qty = Math.max(0, s?.qty || 0);
    const rate = qty / days;
    return {
      id: String(p._id), name: p.name, category: p.category || "", stock: p.stock, unit: p.unit || "unit", sold: qty, revenue: money(s?.revenue || 0),
      perDay: Math.round(rate * 100) / 100, coverDays: rate > 0 ? Math.round((Math.max(p.stock, 0) / rate) * 10) / 10 : null,
      lastSoldAt: s?.lastSold || null, ...(showCost ? { stockValue: money(p.stockValue || 0) } : {}),
    };
  });
  const byValue = (a, b) => (showCost ? (b.stockValue || 0) - (a.stockValue || 0) : b.stock - a.stock);
  res.json({
    days,
    fast: rows.filter((r) => r.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 10),
    runningOut: rows.filter((r) => r.stock > 0 && r.coverDays !== null && r.coverDays <= 7).sort((a, b) => a.coverDays - b.coverDays).slice(0, 10),
    dead: rows.filter((r) => r.stock > 0 && r.sold === 0).sort(byValue).slice(0, 15),
    slow: rows.filter((r) => r.stock > 0 && r.sold > 0 && r.coverDays !== null && r.coverDays > 90).sort((a, b) => b.coverDays - a.coverDays).slice(0, 10),
  });
});

// GET /api/inventory/export.csv — the whole shelf, for a spreadsheet or an accountant
inventoryHubRouter.get("/export.csv", requirePerm("inventory_export"), requireBranch, async (req, res) => {
  const showCost = canSeeCost(req.ctx);
  const rows = await Product.aggregate([...stockPipeline(req.ctx), { $sort: { name: 1 } }]);
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // a name starting with = or + must not run as a formula in Excel
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Name", "SKU", "Barcode", "Category", "Unit", "In stock", "Reorder level", "Status", "Selling price", "Retail value", ...(showCost ? ["Cost", "Stock value"] : [])];
  const lines = [head.join(",")];
  for (const p of rows) {
    lines.push([p.name, p.sku, p.barcode, p.category, p.unit, p.stock, p.reorderLevel, p.stockStatus, p.price, money(p.retailValue), ...(showCost ? [p.cost || 0, money(p.stockValue)] : [])].map(cell).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="inventory-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + lines.join("\r\n"));
});

const STATUS_LABEL = { ok: "In stock", low: "Low", out: "Out of stock" };
const FILTER_LABEL = { ok: "In stock (above reorder level)", low: "Low stock", out: "Out of stock only", instock: "Hiding zero stock" };

// GET /api/inventory/export?format=pdf|xlsx|csv&q=&category=&status=&inline=1
// The list as it is filtered on screen. PDF and Excel are the Pro reports
// (same look as every other report); CSV stays on every plan. inline=1 opens
// the PDF in the browser to print, instead of downloading it.
inventoryHubRouter.get("/export", requirePerm("inventory_export"), requireBranch, async (req, res) => {
  const format = ["pdf", "xlsx", "csv"].includes(String(req.query.format)) ? String(req.query.format) : "pdf";
  if (format !== "csv" && !planAllows(req.ctx.plan, "reports")) return res.status(403).json(planRequired("reports"));
  const showCost = canSeeCost(req.ctx);
  const { extra, status, statusStage } = listFilters(req);
  const rows = await Product.aggregate([...stockPipeline(req.ctx, extra), ...statusStage, { $sort: { category: 1, name: 1 } }]);
  const day = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const cell = (v) => {
      let t = String(v ?? "");
      if (/^[=+\-@]/.test(t)) t = `'${t}`;
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const head = ["Name", "SKU", "Barcode", "Category", "Unit", "In stock", "Reorder level", "Status", "Selling price", "Retail value", ...(showCost ? ["Cost", "Stock value"] : [])];
    const lines = [head.join(",")];
    for (const p of rows) lines.push([p.name, p.sku, p.barcode, p.category, p.unit, p.stock, p.reorderLevel, STATUS_LABEL[p.stockStatus], p.price, money(p.retailValue), ...(showCost ? [p.cost || 0, money(p.stockValue)] : [])].map(cell).join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="inventory-${day}.csv"`);
    return res.send("\uFEFF" + lines.join("\r\n"));
  }

  const branch = await Branch.findById(req.ctx.branchId).select("name");
  const units = rows.reduce((t, p) => t + Math.max(0, p.stock), 0);
  const retail = money(rows.reduce((t, p) => t + (p.retailValue || 0), 0));
  const cost = money(rows.reduce((t, p) => t + (p.stockValue || 0), 0));
  const filters = [status && FILTER_LABEL[status], req.query.category && `Category: ${req.query.category}`, req.query.q && `Search: "${String(req.query.q).slice(0, 60)}"`].filter(Boolean);
  const report = {
    kind: "inventory",
    title: "Inventory",
    subtitle: filters.length ? filters.join(" · ") : "Every stock product",
    currency: req.ctx.business?.settings?.currency || "₦",
    business: { name: req.ctx.business?.name || "Business", type: req.ctx.business?.typeKey || "" },
    branch: branch?.name || "",
    period: { label: `Stock on ${day}`, from: day, to: day, days: 1 },
    generatedAt: new Date().toISOString(),
    generatedBy: req.ctx.actorName || "",
    highlights: [],
    kpis: [
      { label: "Products", value: rows.length, format: "int" },
      { label: "Units on hand", value: units, format: "int" },
      { label: "Value at selling price", value: retail, format: "money" },
      ...(showCost ? [{ label: "Value at cost", value: cost, format: "money" }] : [{ label: "Out of stock", value: rows.filter((p) => p.stock <= 0).length, format: "int" }]),
    ],
    sections: [{
      title: "Stock",
      columns: [
        { key: "name", label: "Product", format: "text" },
        { key: "category", label: "Category", format: "text" },
        { key: "sku", label: "SKU", format: "text" },
        { key: "stock", label: "In stock", format: "decimal", align: "right" },
        { key: "unit", label: "Unit", format: "text" },
        { key: "status", label: "Status", format: "text" },
        { key: "price", label: "Price", format: "money", align: "right" },
        { key: "retailValue", label: "Retail value", format: "money", align: "right" },
        ...(showCost ? [{ key: "cost", label: "Cost", format: "money", align: "right" }, { key: "stockValue", label: "Value at cost", format: "money", align: "right" }] : []),
      ],
      rows: rows.map((p) => ({
        name: p.name, category: p.category || "", sku: p.sku || "", stock: p.stock, unit: p.unit || "unit", status: STATUS_LABEL[p.stockStatus],
        price: p.price, retailValue: money(p.retailValue || 0), ...(showCost ? { cost: p.cost || 0, stockValue: money(p.stockValue || 0) } : {}),
      })),
      totals: { name: `${rows.length} products`, stock: units, retailValue: retail, ...(showCost ? { stockValue: cost } : {}) },
    }],
  };
  if (rows.some((p) => p.stock <= 0) && status !== "out") report.highlights.push(`${rows.filter((p) => p.stock <= 0).length} of these are out of stock.`);

  const buffer = format === "xlsx" ? await renderXlsx(report) : await renderPdf(report);
  audit(req.ctx, "report.download", { type: "report", label: `Inventory (${format.toUpperCase()})` });
  res.set({
    "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
    "Content-Disposition": `${req.query.inline === "1" && format === "pdf" ? "inline" : "attachment"}; filename="inventory-${day}.${format}"`,
    "Content-Length": buffer.length,
    "Cache-Control": "no-store",
  });
  res.send(buffer);
});

// GET /api/inventory/reorder — what to buy, how many, and from whom
inventoryHubRouter.get("/reorder", canRead, requireBranch, async (req, res) => {
  const showCost = canSeeCost(req.ctx);
  const [products, sold] = await Promise.all([Product.aggregate(stockPipeline(req.ctx)), soldByProduct(req.ctx, 30)]);

  const need = products.filter((p) => {
    const rate = Math.max(0, sold.get(String(p._id))?.qty || 0) / 30;
    return p.stock <= p.reorderLevel || (rate > 0 && p.stock / rate <= 7);
  });
  if (!need.length) return res.json({ items: [], suppliers: [], canSeeCost: showCost });

  // The last supplier and price we bought each of these at, from the stock ledger.
  const last = await StockMovement.aggregate([
    { $match: { businessId: req.ctx.businessId, branchId: req.ctx.branchId, type: "IN", productId: { $in: need.map((p) => p._id) }, supplierId: { $ne: null } } },
    { $sort: { at: -1 } },
    { $group: { _id: "$productId", supplierId: { $first: "$supplierId" }, supplierName: { $first: "$supplierName" }, unitCost: { $first: "$unitCost" } } },
  ]);
  const lastBy = new Map(last.map((l) => [String(l._id), l]));

  const items = need.map((p) => {
    const rate = Math.max(0, sold.get(String(p._id))?.qty || 0) / 30;
    // Enough for two reorder levels, or two weeks of selling at the current pace, whichever is more.
    const target = Math.max(p.reorderLevel * 2, Math.ceil(rate * 14), 1);
    const l = lastBy.get(String(p._id));
    return {
      id: String(p._id), name: p.name, category: p.category || "", unit: p.unit || "unit", stock: p.stock, reorderLevel: p.reorderLevel, status: p.stockStatus,
      perDay: Math.round(rate * 100) / 100, suggested: Math.max(1, Math.ceil(target - p.stock)),
      supplierId: l ? String(l.supplierId) : null, supplierName: l?.supplierName || "",
      ...(showCost ? { unitCost: l?.unitCost ?? p.cost ?? 0 } : {}),
    };
  }).sort((a, b) => (a.status === "out" ? 0 : 1) - (b.status === "out" ? 0 : 1) || a.stock - b.stock);

  const groups = new Map();
  for (const i of items) {
    const key = i.supplierId || "none";
    if (!groups.has(key)) groups.set(key, { supplierId: i.supplierId, supplierName: i.supplierName || "No supplier on record", count: 0 });
    groups.get(key).count++;
  }
  res.json({ items, suppliers: [...groups.values()], canSeeCost: showCost });
});

// ── Opening stock: set what's on the shelf from a spreadsheet ───────────────

const MAX_ROWS = 5000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });
const SPEC = {
  name: ["name", "product", "product name", "item", "item name", "description"],
  sku: ["sku", "code", "item code", "product code"],
  barcode: ["barcode", "upc", "ean"],
  quantity: ["quantity", "qty", "stock", "opening stock", "on hand", "count", "units", "in stock"],
  cost: ["cost", "cost price", "unit cost", "buying price", "purchase price"],
  price: ["price", "selling price", "sale price", "unit price", "retail price"],
  category: ["category", "group", "type"],
  unit: ["unit", "uom"],
  reorderLevel: ["reorder level", "reorder", "min stock", "minimum", "reorder point"],
};

inventoryHubRouter.post("/import", requirePerm("stock_in"), requireFeature("csvImport"), requireBranch, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "invalid", message: "Choose a file to upload." });
  let parsed;
  try {
    parsed = await parseUpload(req.file.buffer, req.file.originalname, { maxRows: MAX_ROWS });
  } catch (err) {
    if (err instanceof UploadError) return res.status(400).json({ error: "bad_file", message: err.message });
    throw err;
  }
  const table = bestTable(parsed.tables, SPEC);
  const mapping = { ...guessColumns(table.headers, SPEC), ...cleanMapping(req.body.mapping, table.headers, SPEC) };
  if (!mapping.quantity || !(mapping.name || mapping.sku || mapping.barcode)) {
    return res.status(422).json({ error: "no_columns", message: "I need a column for the quantity, and one that identifies each product (name, SKU or barcode). Choose them below.", headers: table.headers, mapping });
  }
  const createMissing = req.body.createMissing === "1";
  const commit = req.body.commit === "1";
  const showCost = canSeeCost(req.ctx);
  const ctx = req.ctx;

  // How the file's products line up with this store's catalog.
  const catalog = await Product.find(scopedToBranch(ctx, { businessId: ctx.businessId, status: "active", archetype: { $ne: "made_to_order" } })).select("name sku barcode price cost reorderLevel category unit");
  const by = { sku: new Map(), barcode: new Map(), name: new Map() };
  for (const p of catalog) {
    if (p.sku) by.sku.set(normKey(p.sku), p);
    if (p.barcode) by.barcode.set(normKey(p.barcode), p);
    by.name.set(normKey(p.name), p);
  }
  const inv = await Inventory.find({ branchId: ctx.branchId }).select("productId stock");
  const stockOf = new Map(inv.map((i) => [String(i.productId), i.stock]));

  const cell = (row, f) => (mapping[f] ? row[mapping[f]] : "");
  const plan = [];
  const problems = [];
  const seen = new Set();
  const tally = { rows: table.rows.length, update: 0, create: 0, unchanged: 0, missing: 0, invalid: 0, overLimit: 0, duplicate: 0 };
  const productCount = await Product.countDocuments({ businessId: ctx.businessId, status: "active" });
  let newCount = 0;

  for (const row of table.rows) {
    const qtyRaw = parseCount(cell(row, "quantity"));
    const name = clean(cell(row, "name"), 140);
    if (qtyRaw === null || qtyRaw < 0 || !Number.isFinite(qtyRaw)) { tally.invalid++; problems.push({ row: row.__row, reason: `"${cell(row, "quantity")}" isn't a valid quantity` }); continue; }
    const qty = Math.round(qtyRaw * 1000) / 1000;
    const skuKey = normKey(cell(row, "sku")), barKey = normKey(cell(row, "barcode")), nameKey = normKey(name);
    const product = (skuKey && by.sku.get(skuKey)) || (barKey && by.barcode.get(barKey)) || (nameKey && by.name.get(nameKey)) || null;
    const cost = parseMoney(cell(row, "cost")), price = parseMoney(cell(row, "price")), reorder = parseCount(cell(row, "reorderLevel"));

    if (product) {
      if (seen.has(String(product._id))) { tally.duplicate++; problems.push({ row: row.__row, reason: `${product.name} appears more than once — the first row is used` }); continue; }
      seen.add(String(product._id));
      const before = stockOf.get(String(product._id)) ?? 0;
      const changesDetails = (cost !== null && cost >= 0 && cost !== product.cost) || (price !== null && price >= 0 && price !== product.price) || (reorder !== null && reorder >= 0 && reorder !== product.reorderLevel);
      if (before === qty && !changesDetails) { tally.unchanged++; continue; }
      tally.update++;
      plan.push({ kind: "update", product, before, after: qty, cost, price, reorder, row: row.__row });
    } else if (createMissing && name) {
      if (!cell(row, "price") && price === null) { tally.missing++; problems.push({ row: row.__row, reason: `${name} isn't in your catalog and has no price to create it with` }); continue; }
      if (price !== null && price < 0) { tally.invalid++; problems.push({ row: row.__row, reason: `${name}: the price is negative` }); continue; }
      if (limitProblem(ctx.plan, "products", productCount, newCount + 1)) { tally.overLimit++; continue; }
      newCount++;
      tally.create++;
      plan.push({ kind: "create", name, before: 0, after: qty, cost, price: price ?? 0, reorder, category: clean(cell(row, "category"), 60) || "General", unit: clean(cell(row, "unit"), 20) || "unit", sku: clean(cell(row, "sku"), 64), barcode: clean(cell(row, "barcode"), 64), row: row.__row });
    } else {
      tally.missing++;
      problems.push({ row: row.__row, reason: `${name || cell(row, "sku") || cell(row, "barcode") || "That row"} isn't in your catalog${createMissing ? "" : " (turn on “Add products that aren't in my catalog” to create them)"}` });
    }
  }

  const report = {
    fileName: req.file.originalname, sheet: table.name, headers: table.headers, mapping, truncated: table.truncated, totals: tally,
    sample: plan.slice(0, 8).map((p) => ({ name: p.product?.name || p.name, before: p.before, after: p.after, isNew: p.kind === "create" })),
    problems: problems.slice(0, 25), committed: false, created: 0, updated: 0, canSeeCost: showCost,
    limit: tally.overLimit ? limitProblem(ctx.plan, "products", productCount, newCount + tally.overLimit) || undefined : undefined,
  };
  if (!commit) return res.json(report);

  // Save. Each product is its own small step so one bad row can't undo the rest.
  const touched = [];
  let updated = 0, created = 0;
  const failures = [];
  const branchOwner = await ownerBranchForNew(ctx);

  const fresh = [];
  for (const p of plan) {
    try {
      if (p.kind === "update") {
        const set = {};
        if (p.cost !== null && p.cost >= 0) set.cost = p.cost;
        if (p.price !== null && p.price >= 0) set.price = p.price;
        if (p.reorder !== null && p.reorder >= 0) set.reorderLevel = p.reorder;
        if (Object.keys(set).length) await Product.updateOne({ _id: p.product._id }, { $set: set });
        const delta = p.after - p.before;
        if (delta !== 0) {
          await applyMovement(ctx, { branchId: ctx.branchId, productId: p.product._id, productName: p.product.name, type: delta > 0 ? "IN" : "ADJUST", qty: delta, refType: "import", reason: "Opening stock (import)", ...(delta > 0 && p.cost !== null ? { unitCost: p.cost } : {}) });
        }
        touched.push(p.product._id);
        updated++;
      } else {
        const doc = await Product.create({
          accountId: ctx.accountId, businessId: ctx.businessId, branchId: branchOwner, name: p.name, category: p.category, unit: p.unit,
          price: p.price, cost: p.cost ?? 0, reorderLevel: p.reorder ?? 5, ...(p.sku ? { sku: p.sku } : {}), barcode: p.barcode,
        });
        fresh.push({ productId: doc._id, productName: doc.name, qty: p.after });
        touched.push(doc._id);
        created++;
      }
    } catch (err) {
      failures.push({ row: p.row, reason: err?.code === 11000 ? "That SKU or barcode is already used by another product" : err?.message || "Couldn't save this row" });
    }
  }
  if (fresh.length) await openStockInBulk(ctx, { branchId: ctx.branchId, items: fresh, reason: "Opening stock (import)" });
  if (touched.length) afterStockChange(ctx, ctx.branchId, touched);
  audit(ctx, "inventory.import", { type: "business", id: ctx.businessId, label: req.file.originalname }, undefined, { updated, created, failed: failures.length });
  res.json({ ...report, committed: true, updated, created, problems: [...failures, ...report.problems].slice(0, 25), failed: failures.length });
});

