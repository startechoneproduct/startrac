import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { StockMovement } from "#modules/inventory/stockMovement.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { Supplier } from "#modules/suppliers/supplier.model.js";
import { requirePerm, requireBranch, requireFeature, planRequired } from "#core/middleware/tenant.js";
import { planAllows } from "#shared/plans.js";
import { applyMovement, InsufficientStockError } from "#modules/inventory/inventory.service.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { afterStockChange } from "#modules/alerts/alerts.service.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { StockReceipt } from "#modules/inventory/stockReceipt.model.js";
import { nextSeq } from "#core/counters.js";

export const inventoryRouter = Router();

const stockInSchema = z.object({
  items: z
    .array(z.object({
      productId: z.string(),
      qty: z.number().int().positive("Quantity must be positive"),
      // Optional: what this delivery actually cost per unit. Naming it here
      // (not a fixed catalog price) matches how this stock is really bought —
      // market prices move delivery to delivery.
      unitCost: z.number().min(0).optional(),
    }))
    .min(1, "Add at least one product")
    .max(500, "Receive at most 500 lines at a time"),
  note: z.string().max(300).default(""),
  supplierId: z.string().optional(),
  // The day the goods arrived (defaults to today) and the supplier's invoice or delivery note number.
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional(),
  reference: z.string().trim().max(80).default(""),
  source: z.enum(["form", "spreadsheet"]).default("form"),
});

// POST /api/inventory/stock-in — receive a delivery into the active branch.
// Adds to what is on the shelf (never replaces it) and keeps the delivery
// together as one numbered receipt (GRN) — see stockReceipt.model.js.
inventoryRouter.post("/stock-in", requirePerm("stock_in"), requireBranch, async (req, res) => {
  const parsed = stockInSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const { items, note, supplierId, reference, source } = parsed.data;
  const receivedOn = parsed.data.receivedOn || localDay();
  if (receivedOn > localDay()) return res.status(400).json({ error: "invalid", message: "Stock can't be received on a future date." });
  if (supplierId && !planAllows(req.ctx.plan, "suppliers")) return res.status(403).json(planRequired("suppliers"));

  // The same product twice in one delivery is almost always a slip; say which.
  const seen = new Set();
  for (const i of items) {
    if (seen.has(i.productId)) {
      const dup = await Product.findOne({ _id: mongoose.isValidObjectId(i.productId) ? i.productId : null, businessId: req.ctx.businessId }).select("name");
      return res.status(400).json({ error: "duplicate", message: `${dup?.name || "A product"} is listed twice. Put it on one line with the total quantity.` });
    }
    seen.add(i.productId);
  }

  const ids = items.map((i) => i.productId).filter((id) => mongoose.isValidObjectId(id));
  const products = await Product.find({ _id: { $in: ids }, businessId: req.ctx.businessId });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  if (byId.size !== items.length) {
    return res.status(400).json({ error: "invalid", message: "One of those products doesn't exist." });
  }

  let supplier = null;
  if (supplierId) {
    supplier = await Supplier.findOne({ _id: supplierId, businessId: req.ctx.businessId });
    if (!supplier) return res.status(400).json({ error: "invalid", message: "That supplier doesn't exist." });
  }

  const invByProduct = new Map(
    (await Inventory.find({ branchId: req.ctx.branchId, productId: { $in: ids } }))
      .map((i) => [String(i.productId), i.stock])
  );

  const receipt = new StockReceipt({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: req.ctx.branchId,
    receiptNo: `GRN-${String(await nextSeq(`grn:${req.ctx.businessId}`)).padStart(4, "0")}`,
    supplierId: supplier?._id || null,
    supplierName: supplier?.name || "",
    receivedOn,
    reference,
    note,
    source,
    actorId: req.ctx.userId,
    actorName: req.ctx.actorName,
  });

  const results = [];
  for (const item of items) {
    const product = byId.get(item.productId);

    // A delivery with a named cost updates the product's running weighted-
    // average cost — the standard way to keep it honest when prices move
    // from one delivery to the next, without overwriting yesterday's number
    // wholesale.
    if (item.unitCost !== undefined) {
      const priorStock = invByProduct.get(item.productId) ?? 0;
      const newCost =
        priorStock + item.qty > 0
          ? money(((priorStock * (product.cost || 0)) + (item.qty * item.unitCost)) / (priorStock + item.qty))
          : item.unitCost;
      product.cost = newCost;
      await product.save();
    }

    const balance = await applyMovement(req.ctx, {
      branchId: req.ctx.branchId,
      productId: product._id,
      productName: product.name,
      type: "IN",
      qty: item.qty,
      refType: "stock_receipt",
      refId: receipt._id,
      reason: [receipt.receiptNo, reference && `invoice ${reference}`, note].filter(Boolean).join(" · "),
      unitCost: item.unitCost,
      supplierId: supplier?._id,
      supplierName: supplier?.name || "",
    });
    receipt.lines.push({
      productId: product._id, name: product.name, qty: item.qty,
      unitCost: item.unitCost ?? null, lineCost: item.unitCost !== undefined ? money(item.unitCost * item.qty) : null, stockAfter: balance,
    });
    results.push({ productId: product._id, name: product.name, added: item.qty, stock: balance, cost: product.cost });
  }

  receipt.totalQty = receipt.lines.reduce((s, l) => s + l.qty, 0);
  receipt.costedLines = receipt.lines.filter((l) => l.lineCost !== null).length;
  receipt.totalCost = receipt.costedLines ? money(receipt.lines.reduce((s, l) => s + (l.lineCost || 0), 0)) : null;
  await receipt.save();

  audit(req.ctx, "stock.receive", { type: "stock_receipt", id: receipt._id, label: receipt.receiptNo }, undefined, {
    lines: receipt.lines.length, totalQty: receipt.totalQty, totalCost: receipt.totalCost, supplier: receipt.supplierName, reference,
  });
  // Goods arrived — close any low-stock alerts the shelf just answered.
  afterStockChange(req.ctx, req.ctx.branchId, ids);
  res.status(201).json({ items: results, receipt: { id: receipt._id, receiptNo: receipt.receiptNo } });
});

const adjustSchema = z.object({
  productId: z.string(),
  newQty: z.number().int().min(0, "Stock can't go negative"),
  reason: z.string().min(3, "Give a reason for the adjustment"),
});

// POST /api/inventory/adjust — set a corrected count (shrinkage, recount…)
inventoryRouter.post("/adjust", requirePerm("stock_adjust"), requireBranch, async (req, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const { productId, newQty, reason } = parsed.data;

  const product = await Product.findOne({ _id: productId, businessId: req.ctx.businessId });
  if (!product) return res.status(404).json({ error: "not_found", message: "Product not found." });

  const inv = await Inventory.findOne({ branchId: req.ctx.branchId, productId });
  const current = inv?.stock ?? 0;
  const delta = newQty - current;
  if (delta === 0) return res.json({ productId, stock: current, changed: 0 });

  const balance = await applyMovement(req.ctx, {
    branchId: req.ctx.branchId,
    productId: product._id,
    productName: product.name,
    type: "ADJUST",
    qty: delta,
    refType: "manual",
    reason,
  });
  afterStockChange(req.ctx, req.ctx.branchId, [product._id]);
  audit(req.ctx, "stock.adjust", { type: "product", id: product._id, label: product.name }, { stock: current }, { stock: balance, reason });
  res.json({ productId, stock: balance, changed: delta });
});

const wasteSchema = z.object({
  productId: z.string(),
  qty: z.number().int().positive("Quantity must be positive"),
  wasteReason: z
    .enum([
      "spoilage", "staff_meal", "damage", "expired", "broken", "cracked", "rotten", "contaminated",
      "shrinkage", "cold_chain_failure", "other",
    ])
    .default("other"),
  note: z.string().default(""),
});

// POST /api/inventory/waste — stock leaving without a sale: spoilage, a
// staff meal, damage, expiry. A distinct door from /adjust (a blunt
// corrected-count tool) so it reads as its own thing in the ledger and can
// be reported on separately from an ordinary correction.
inventoryRouter.post("/waste", requirePerm("stock_adjust"), requireBranch, async (req, res) => {
  const parsed = wasteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const { productId, qty, wasteReason, note } = parsed.data;

  const product = await Product.findOne({ _id: productId, businessId: req.ctx.businessId });
  if (!product) return res.status(404).json({ error: "not_found", message: "Product not found." });

  const balance = await applyMovement(req.ctx, {
    branchId: req.ctx.branchId,
    productId: product._id,
    productName: product.name,
    type: "OUT",
    qty: -qty,
    refType: "waste",
    reason: note || wasteReason.replace("_", " "),
    wasteReason,
    // Snapshotted so a later metrics rebuild can reconstruct wasteTotal
    // exactly, even after the product's cost has since changed.
    unitCost: product.cost || 0,
  });
  afterStockChange(req.ctx, req.ctx.branchId, [product._id]);
  // Nothing was sold, so there's no revenue or COGS-of-a-sale to reverse —
  // the loss is pure profit erosion, valued at cost (never selling price,
  // since a wasted item was never sold).
  const costValue = money((product.cost || 0) * qty);
  if (costValue > 0) {
    await bumpDailyMetric(req.ctx, req.ctx.branchId, localDay(), { profit: -costValue, wasteTotal: costValue });
  }
  audit(req.ctx, "stock.waste", { type: "product", id: product._id, label: product.name }, undefined, { qty, wasteReason, costValue });
  res.status(201).json({ productId: product._id, stock: balance });
});

const transferSchema = z.object({
  toBranchId: z.string(),
  items: z
    .array(z.object({ productId: z.string(), qty: z.number().int().positive() }))
    .min(1, "Add at least one product"),
  note: z.string().default(""),
});

// POST /api/inventory/transfer — move stock from the active branch to another
inventoryRouter.post("/transfer", requirePerm("transfers"), requireFeature("transfers"), requireBranch, async (req, res) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const { toBranchId, items, note } = parsed.data;

  if (String(toBranchId) === String(req.ctx.branchId)) {
    return res.status(400).json({ error: "invalid", message: "Source and destination branch are the same." });
  }
  const toBranch = await Branch.findOne({ _id: toBranchId, businessId: req.ctx.businessId });
  if (!toBranch) return res.status(400).json({ error: "invalid", message: "Destination branch doesn't exist." });

  const products = await Product.find({ _id: { $in: items.map((i) => i.productId) }, businessId: req.ctx.businessId });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  if (byId.size !== items.length) {
    return res.status(400).json({ error: "invalid", message: "One of those products doesn't exist." });
  }

  const transferId = new mongoose.Types.ObjectId(); // links OUT and IN movements
  const results = [];
  const done = []; // for compensation if a later line fails
  try {
    for (const item of items) {
      const product = byId.get(item.productId);
      await applyMovement(req.ctx, {
        branchId: req.ctx.branchId,
        productId: product._id,
        productName: product.name,
        type: "TRANSFER_OUT",
        qty: -item.qty,
        refType: "transfer",
        refId: transferId,
        reason: note || `To ${toBranch.name}`,
      });
      const inBalance = await applyMovement(req.ctx, {
        branchId: toBranch._id,
        productId: product._id,
        productName: product.name,
        type: "TRANSFER_IN",
        qty: item.qty,
        refType: "transfer",
        refId: transferId,
        reason: note || `From branch`,
      });
      done.push({ product, qty: item.qty });
      results.push({ productId: product._id, name: product.name, qty: item.qty, destStock: inBalance });
    }
  } catch (err) {
    // Reverse the lines that already moved so branches stay consistent.
    for (const d of done.reverse()) {
      await applyMovement(req.ctx, {
        branchId: toBranch._id, productId: d.product._id, productName: d.product.name,
        type: "TRANSFER_OUT", qty: -d.qty, refType: "transfer", refId: transferId, reason: "Transfer reversal",
      }).catch(() => {});
      await applyMovement(req.ctx, {
        branchId: req.ctx.branchId, productId: d.product._id, productName: d.product.name,
        type: "TRANSFER_IN", qty: d.qty, refType: "transfer", refId: transferId, reason: "Transfer reversal",
      }).catch(() => {});
    }
    if (err instanceof InsufficientStockError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    throw err;
  }

  // Both ends moved: the source may now be short, the destination may be fine.
  const movedIds = items.map((i) => i.productId);
  afterStockChange(req.ctx, req.ctx.branchId, movedIds);
  afterStockChange(req.ctx, toBranch._id, movedIds);

  audit(req.ctx, "stock.transfer", { type: "transfer", id: transferId, label: `→ ${toBranch.name}` }, undefined, {
    items: results.map((r) => ({ name: r.name, qty: r.qty })),
  });
  res.status(201).json({ transferId, toBranch: toBranch.name, items: results });
});

// GET /api/inventory/movements?productId=&type=&refType=&supplierId=&limit= — the ledger
inventoryRouter.get("/movements", requirePerm("inventory_view"), requireBranch, async (req, res) => {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  if (req.query.productId) filter.productId = req.query.productId;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.refType) filter.refType = req.query.refType;
  if (req.query.supplierId) filter.supplierId = req.query.supplierId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const movements = await StockMovement.find(filter).sort({ at: -1 }).limit(limit);
  res.json({
    movements: movements.map((m) => ({
      id: m._id,
      productId: m.productId,
      productName: m.productName,
      type: m.type,
      qty: m.qty,
      balanceAfter: m.balanceAfter,
      reason: m.reason,
      refType: m.refType,
      actorName: m.actorName,
      unitCost: m.unitCost,
      supplierName: m.supplierName || "",
      wasteReason: m.wasteReason,
      at: m.at,
    })),
  });
});

// GET /api/inventory/low-stock — products at/below their reorder level
inventoryRouter.get("/low-stock", requireBranch, async (req, res) => {
  const products = await Product.find({ businessId: req.ctx.businessId, status: "active", archetype: { $ne: "made_to_order" } }).select("name reorderLevel");
  const inv = await Inventory.find({ branchId: req.ctx.branchId, productId: { $in: products.map((p) => p._id) } });
  const stockBy = new Map(inv.map((i) => [String(i.productId), i.stock]));
  const low = products
    .map((p) => ({ id: p._id, name: p.name, stock: stockBy.get(String(p._id)) ?? 0, reorderLevel: p.reorderLevel }))
    .filter((p) => p.stock <= p.reorderLevel)
    .sort((a, b) => a.stock - b.stock);
  res.json({ items: low });
});
