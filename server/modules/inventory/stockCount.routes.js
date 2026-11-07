import { Router } from "express";
import { z } from "zod";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { StockCount } from "#modules/inventory/stockCount.model.js";
import { requirePerm, requireBranch } from "#core/middleware/tenant.js";
import { applyMovement } from "#modules/inventory/inventory.service.js";
import { nextSeq } from "#core/counters.js";
import { audit } from "#core/audit.js";
import { afterStockChange } from "#modules/alerts/alerts.service.js";

export const stockCountRouter = Router();

const ISSUE_LABEL = { damaged: "Damaged", missing: "Missing", expired: "Expired", miscount: "Miscounted before", found: "Found extra", other: "Other" };

function shape(c) {
  return {
    id: c._id,
    countNo: c.countNo,
    status: c.status,
    lines: c.lines.map((l) => ({
      productId: l.productId, productName: l.productName, unit: l.unit,
      systemQty: l.systemQty, countedQty: l.countedQty, variance: l.variance,
      issue: l.issue || "", comment: l.comment || "",
    })),
    note: c.note,
    closeNote: c.closeNote || "",
    startedByName: c.startedByName,
    closedByName: c.closedByName,
    closedAt: c.closedAt,
    at: c.at,
  };
}

// GET /api/stock-counts?limit= — history, newest first
stockCountRouter.get("/", requirePerm("stock_count", "inventory_view"), requireBranch, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const counts = await StockCount.find({ businessId: req.ctx.businessId, branchId: req.ctx.branchId })
    .sort({ at: -1 })
    .limit(limit);
  res.json({ counts: counts.map(shape) });
});

// GET /api/stock-counts/:id
stockCountRouter.get("/:id", requirePerm("stock_count", "inventory_view"), async (req, res) => {
  const count = await StockCount.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!count) return res.status(404).json({ error: "not_found", message: "Count not found." });
  res.json({ count: shape(count) });
});

const openSchema = z.object({
  category: z.string().optional(), // scope the count to one category, e.g. "Raw Materials"
  note: z.string().default(""),
});

// POST /api/stock-counts — open a count, snapshotting today's system stock
stockCountRouter.post("/", requirePerm("stock_count"), requireBranch, async (req, res) => {
  const parsed = openSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const { category, note } = parsed.data;

  const filter = { businessId: req.ctx.businessId, status: "active", archetype: { $ne: "made_to_order" } };
  if (category) filter.category = category;
  const products = await Product.find(filter).sort({ name: 1 });
  if (!products.length) return res.status(400).json({ error: "invalid", message: "No stock products to count." });

  const inv = await Inventory.find({ branchId: req.ctx.branchId, productId: { $in: products.map((p) => p._id) } });
  const stockByProduct = new Map(inv.map((i) => [String(i.productId), i.stock]));

  const seq = await nextSeq(`stockcount:${req.ctx.branchId}`);
  const count = await StockCount.create({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: req.ctx.branchId,
    countNo: `SC-${String(seq).padStart(5, "0")}`,
    lines: products.map((p) => ({
      productId: p._id, productName: p.name, unit: p.unit || "unit",
      systemQty: stockByProduct.get(String(p._id)) ?? 0, countedQty: null, variance: null,
    })),
    note,
    startedById: req.ctx.userId,
    startedByName: req.ctx.actorName,
  });
  audit(req.ctx, "stock_count.open", { type: "stock_count", id: count._id, label: count.countNo });
  res.status(201).json({ count: shape(count) });
});

const updateSchema = z.object({
  lines: z.array(z.object({
    productId: z.string(),
    countedQty: z.number().min(0).nullable().optional(),
    issue: z.enum(["", "damaged", "missing", "expired", "miscount", "found", "other"]).optional(),
    comment: z.string().max(300).optional(),
  })).min(1),
});

// PATCH /api/stock-counts/:id — fill in physical counts while still open
stockCountRouter.patch("/:id", requirePerm("stock_count"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });

  const count = await StockCount.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!count) return res.status(404).json({ error: "not_found", message: "Count not found." });
  if (count.status !== "open") return res.status(400).json({ error: "closed", message: "This count is already closed." });

  const byId = new Map(parsed.data.lines.map((l) => [l.productId, l]));
  for (const line of count.lines) {
    const u = byId.get(String(line.productId));
    if (!u) continue;
    if (u.countedQty !== undefined) line.countedQty = u.countedQty;
    if (u.issue !== undefined) line.issue = u.issue;
    if (u.comment !== undefined) line.comment = u.comment.trim();
  }
  await count.save();
  res.json({ count: shape(count) });
});

// POST /api/stock-counts/:id/close — reconcile: every counted line that
// differs from the system posts as an ordinary ADJUST movement.
stockCountRouter.post("/:id/close", requirePerm("stock_count"), async (req, res) => {
  const count = await StockCount.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!count) return res.status(404).json({ error: "not_found", message: "Count not found." });
  if (count.status !== "open") return res.status(400).json({ error: "closed", message: "This count is already closed." });

  const touched = [];
  for (const line of count.lines) {
    if (line.countedQty === null || line.countedQty === undefined) continue;
    const variance = line.countedQty - line.systemQty;
    line.variance = variance;
    if (variance === 0) continue;
    await applyMovement(req.ctx, {
      branchId: req.ctx.branchId,
      productId: line.productId,
      productName: line.productName,
      type: "ADJUST",
      qty: variance,
      refType: "stock_count",
      refId: count._id,
      // The line's own explanation travels with the adjustment, so the stock history says why.
      reason: [`Stock count ${count.countNo}`, line.issue && ISSUE_LABEL[line.issue], line.comment].filter(Boolean).join(" · "),
    });
    touched.push(line.productId);
  }

  count.status = "closed";
  count.closeNote = String(req.body?.note || "").trim().slice(0, 500);
  count.closedAt = new Date();
  count.closedById = req.ctx.userId;
  count.closedByName = req.ctx.actorName;
  await count.save();

  if (touched.length) afterStockChange(req.ctx, req.ctx.branchId, touched);
  audit(req.ctx, "stock_count.close", { type: "stock_count", id: count._id, label: count.countNo }, undefined, {
    variances: count.lines.filter((l) => l.variance).length,
  });
  res.json({ count: shape(count) });
});
