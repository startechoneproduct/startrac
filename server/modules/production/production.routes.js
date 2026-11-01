import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Product } from "#modules/products/product.model.js";
import { ProductionRun } from "#modules/production/productionRun.model.js";
import { requirePerm, requireBranch } from "#core/middleware/tenant.js";
import { applyMovement } from "#modules/inventory/inventory.service.js";
import { nextSeq } from "#core/counters.js";
import { audit } from "#core/audit.js";
import { withTransaction } from "#core/tx.js";
import { badRequest, notFound } from "#core/httpError.js";
import { afterStockChange } from "#modules/alerts/alerts.service.js";

export const productionRouter = Router();

function shape(r) {
  return {
    id: r._id,
    runNo: r.runNo,
    productId: r.productId,
    productName: r.productName,
    producedUnits: r.producedUnits,
    leakage: r.leakage,
    creditedQty: r.creditedQty,
    producedUnitsPerStockUnit: r.producedUnitsPerStockUnit,
    components: r.components.map((c) => ({ productId: c.productId, name: c.name, qty: c.qty, includedLeakage: c.includedLeakage })),
    note: r.note,
    staffName: r.staffName,
    at: r.at,
  };
}

const round3 = (n) => Math.round(n * 1000) / 1000;

// GET /api/production/runs — batch history for the active branch, newest first.
productionRouter.get("/runs", requirePerm("stock", "dashboard_ops"), requireBranch, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const runs = await ProductionRun.find({ businessId: req.ctx.businessId, branchId: req.ctx.branchId })
    .sort({ at: -1 })
    .limit(limit);
  res.json({ runs: runs.map(shape) });
});

const runSchema = z.object({
  productId: z.string(),
  producedUnits: z.number().int().positive(),
  leakage: z.number().int().min(0).default(0),
  note: z.string().default(""),
});

/**
 * POST /api/production/runs — a completed batch: raw materials in, finished
 * stock out. Implements the "production" capability (water bottling/sachet
 * lines, but equally bakery/furniture/printing — anything with a recipe on a
 * stock product). Reuses applyMovement for every deduction/credit so nothing
 * here writes Inventory.stock directly, same as checkout and stock-in.
 */
productionRouter.post("/runs", requirePerm("stock"), requireBranch, async (req, res) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const out = await withTransaction(async (session) => {
    const product = await Product.findOne({
      _id: d.productId, businessId: req.ctx.businessId, status: "active", archetype: "stock",
    }).session(session);
    if (!product) throw notFound("Product not found.");
    if (!product.bom?.length) {
      throw badRequest(`${product.name} has no production recipe configured — set one up on the product first.`);
    }

    const yieldPer = product.producedUnitsPerStockUnit || 1;
    if (d.producedUnits < yieldPer) {
      throw badRequest(`Produce at least ${yieldPer} unit(s) to credit a full ${yieldPer > 1 ? "batch" : "unit"}.`);
    }

    const compIds = product.bom.map((c) => c.productId);
    const compProducts = await Product.find({ _id: { $in: compIds }, businessId: req.ctx.businessId }).session(session);
    const compById = new Map(compProducts.map((p) => [String(p._id), p]));

    // Leakage is per-line: a burst preform still used a preform, but never
    // reached capping/labeling — each recipe line says for itself whether
    // it scales with leakage, rather than hardcoding which material is "special".
    const components = [];
    for (const line of product.bom) {
      const comp = compById.get(String(line.productId));
      if (!comp) throw badRequest(`A component of ${product.name} no longer exists.`);
      const includeLeakage = line.includeLeakage !== false;
      const qty = round3(line.factor * (d.producedUnits + (includeLeakage ? d.leakage : 0)));
      if (qty > 0) components.push({ productId: comp._id, name: comp.name, qty, includedLeakage: includeLeakage });
    }

    const creditedQty = Math.floor(d.producedUnits / yieldPer);
    const runId = new mongoose.Types.ObjectId();

    // Every material is deducted before the finished good is credited.
    // Inside a transaction an abort undoes the lot; without one (standalone
    // MongoDB) we walk applied movements back by hand, same pattern as
    // inventory.routes.js's /transfer.
    const moved = [];
    try {
      for (const c of components) {
        await applyMovement(req.ctx, {
          branchId: req.ctx.branchId, productId: c.productId, productName: c.name,
          type: "OUT", qty: -c.qty, refType: "production", refId: runId,
          reason: `Used for production run of ${product.name}`, session,
        });
        moved.push(c);
      }
      await applyMovement(req.ctx, {
        branchId: req.ctx.branchId, productId: product._id, productName: product.name,
        type: "IN", qty: creditedQty, refType: "production", refId: runId,
        reason: `Production run — ${d.producedUnits} unit(s), ${d.leakage} leakage`, session,
      });
    } catch (err) {
      if (!session) {
        for (const c of moved.reverse()) {
          await applyMovement(req.ctx, {
            branchId: req.ctx.branchId, productId: c.productId, productName: c.name,
            type: "IN", qty: c.qty, refType: "production", refId: runId, reason: "Production run rollback",
          }).catch((e) => console.error("production rollback failed:", c.name, e.message));
        }
      }
      throw err;
    }

    const seq = await nextSeq(`run:${req.ctx.branchId}`, session);
    const [run] = await ProductionRun.create(
      [{
        _id: runId,
        accountId: req.ctx.accountId,
        businessId: req.ctx.businessId,
        branchId: req.ctx.branchId,
        runNo: `PR-${String(seq).padStart(5, "0")}`,
        productId: product._id,
        productName: product.name,
        producedUnits: d.producedUnits,
        leakage: d.leakage,
        creditedQty,
        producedUnitsPerStockUnit: yieldPer,
        components,
        note: d.note,
        staffId: req.ctx.userId,
        staffName: req.ctx.actorName,
      }],
      { session }
    );

    return { run, deductedIds: components.map((c) => c.productId), productId: product._id };
  });

  afterStockChange(req.ctx, req.ctx.branchId, [...out.deductedIds, out.productId]);
  audit(req.ctx, "production.run", { type: "product", id: out.run.productId, label: out.run.productName }, undefined, {
    runNo: out.run.runNo, producedUnits: out.run.producedUnits, creditedQty: out.run.creditedQty,
  });
  res.status(201).json({ run: shape(out.run) });
});
