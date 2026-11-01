import { Router } from "express";
import { z } from "zod";
import { Product } from "#modules/products/product.model.js";
import { StockMovement } from "#modules/inventory/stockMovement.model.js";
import { Cohort } from "#modules/businesses/poultry/cohort.model.js";
import { requirePerm, requireBranch } from "#core/middleware/tenant.js";
import { applyMovement } from "#modules/inventory/inventory.service.js";
import { audit } from "#core/audit.js";
import { afterStockChange } from "#modules/alerts/alerts.service.js";

export const cohortsRouter = Router();

const dayMs = 24 * 60 * 60 * 1000;

function shape(c) {
  return {
    id: c._id,
    name: c.name,
    species: c.species,
    startDate: c.startDate,
    initialCount: c.initialCount,
    currentCount: c.currentCount,
    mortalityCount: c.mortalityCount,
    status: c.status,
    ageInDays: Math.max(0, Math.floor((Date.now() - new Date(c.startDate).getTime()) / dayMs)),
    notes: c.notes,
    at: c.at,
  };
}

// GET /api/cohorts — list, newest first
cohortsRouter.get("/", requirePerm("stock", "dashboard_ops"), requireBranch, async (req, res) => {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  if (req.query.status === "active" || req.query.status === "closed") filter.status = req.query.status;
  const cohorts = await Cohort.find(filter).sort({ at: -1 }).limit(100);
  res.json({ cohorts: cohorts.map(shape) });
});

const createSchema = z.object({
  name: z.string().min(1, "Name the batch"),
  species: z.string().default(""),
  startDate: z.string().optional(),
  initialCount: z.number().int().positive("Need at least one bird"),
  notes: z.string().default(""),
});

// POST /api/cohorts — bring in a new batch
cohortsRouter.post("/", requirePerm("stock"), requireBranch, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const cohort = await Cohort.create({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: req.ctx.branchId,
    name: d.name,
    species: d.species,
    startDate: d.startDate ? new Date(d.startDate) : new Date(),
    initialCount: d.initialCount,
    currentCount: d.initialCount,
    notes: d.notes,
  });
  audit(req.ctx, "cohort.create", { type: "cohort", id: cohort._id, label: cohort.name }, undefined, { initialCount: cohort.initialCount });
  res.status(201).json({ cohort: shape(cohort) });
});

// GET /api/cohorts/:id — detail + running totals from the ledger
cohortsRouter.get("/:id", requirePerm("stock", "dashboard_ops"), async (req, res) => {
  const cohort = await Cohort.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!cohort) return res.status(404).json({ error: "not_found", message: "Batch not found." });

  const movements = await StockMovement.find({
    businessId: req.ctx.businessId,
    refId: cohort._id,
    refType: { $in: ["cohort_feed", "cohort_harvest"] },
  }).sort({ at: -1 });

  const totalFeedQty = movements.filter((m) => m.refType === "cohort_feed").reduce((s, m) => s + Math.abs(m.qty), 0);
  // initial − still-alive − dead = however many left the batch via a "birds"
  // harvest (a "produce" harvest, like eggs, never changes currentCount).
  const birdsHarvested = Math.max(0, cohort.initialCount - cohort.currentCount - cohort.mortalityCount);
  const fcr = birdsHarvested > 0 && totalFeedQty > 0 ? Math.round((totalFeedQty / birdsHarvested) * 100) / 100 : null;

  res.json({
    cohort: shape(cohort),
    events: cohort.events.map((e) => ({ type: e.type, count: e.count, productName: e.productName, note: e.note, at: e.at })),
    totals: {
      feedQty: totalFeedQty,
      birdsHarvested,
      feedConversionRatio: fcr, // feed units per bird harvested — an approximation, not a precise zootechnical figure
    },
    movements: movements.map((m) => ({
      id: m._id, refType: m.refType, productName: m.productName, qty: m.qty, at: m.at,
    })),
  });
});

const feedSchema = z.object({
  productId: z.string(),
  qty: z.number().positive(),
  note: z.string().default(""),
});

// POST /api/cohorts/:id/feed — ordinary stock deduction, tagged to this batch
cohortsRouter.post("/:id/feed", requirePerm("stock"), requireBranch, async (req, res) => {
  const parsed = feedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const { productId, qty, note } = parsed.data;

  const cohort = await Cohort.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!cohort) return res.status(404).json({ error: "not_found", message: "Batch not found." });
  const product = await Product.findOne({ _id: productId, businessId: req.ctx.businessId, status: "active" });
  if (!product) return res.status(404).json({ error: "not_found", message: "Feed product not found." });

  const balance = await applyMovement(req.ctx, {
    branchId: req.ctx.branchId,
    productId: product._id,
    productName: product.name,
    type: "OUT",
    qty: -qty,
    refType: "cohort_feed",
    refId: cohort._id,
    reason: note || `Fed to ${cohort.name}`,
  });
  afterStockChange(req.ctx, req.ctx.branchId, [product._id]);
  res.status(201).json({ stock: balance });
});

const mortalitySchema = z.object({
  count: z.number().int().positive(),
  note: z.string().default(""),
});

// POST /api/cohorts/:id/mortality — birds lost; no Product stock is touched
cohortsRouter.post("/:id/mortality", requirePerm("stock"), async (req, res) => {
  const parsed = mortalitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const { count, note } = parsed.data;

  const cohort = await Cohort.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!cohort) return res.status(404).json({ error: "not_found", message: "Batch not found." });
  if (count > cohort.currentCount) {
    return res.status(400).json({ error: "invalid", message: `Only ${cohort.currentCount} birds are still in this batch.` });
  }

  cohort.currentCount -= count;
  cohort.mortalityCount += count;
  cohort.events.push({ type: "mortality", count, note, at: new Date() });
  await cohort.save();
  audit(req.ctx, "cohort.mortality", { type: "cohort", id: cohort._id, label: cohort.name }, undefined, { count });
  res.json({ cohort: shape(cohort) });
});

const harvestSchema = z.object({
  productId: z.string(),
  qty: z.number().positive(),
  harvestType: z.enum(["birds", "produce"]),
  note: z.string().default(""),
});

// POST /api/cohorts/:id/harvest — credits a real sellable product's stock,
// mirroring a Production Run's raw-in/finished-out shape. "birds" (meat)
// reduces the batch's live count; "produce" (eggs) doesn't — the birds are
// still in the batch, still laying.
cohortsRouter.post("/:id/harvest", requirePerm("stock"), requireBranch, async (req, res) => {
  const parsed = harvestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const { productId, qty, harvestType, note } = parsed.data;

  const cohort = await Cohort.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!cohort) return res.status(404).json({ error: "not_found", message: "Batch not found." });
  const product = await Product.findOne({ _id: productId, businessId: req.ctx.businessId, status: "active", archetype: "stock" });
  if (!product) return res.status(404).json({ error: "not_found", message: "Product not found." });
  if (harvestType === "birds" && qty > cohort.currentCount) {
    return res.status(400).json({ error: "invalid", message: `Only ${cohort.currentCount} birds are still in this batch.` });
  }

  const balance = await applyMovement(req.ctx, {
    branchId: req.ctx.branchId,
    productId: product._id,
    productName: product.name,
    type: "IN",
    qty,
    refType: "cohort_harvest",
    refId: cohort._id,
    reason: note || `Harvested from ${cohort.name}`,
  });

  if (harvestType === "birds") cohort.currentCount -= qty;
  cohort.events.push({ type: "harvest", count: qty, productName: product.name, note, at: new Date() });
  await cohort.save();

  afterStockChange(req.ctx, req.ctx.branchId, [product._id]);
  audit(req.ctx, "cohort.harvest", { type: "cohort", id: cohort._id, label: cohort.name }, undefined, { productName: product.name, qty, harvestType });
  res.status(201).json({ stock: balance, cohort: shape(cohort) });
});
