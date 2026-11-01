import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Job, JOB_STAGES } from "#modules/jobs/job.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { requirePerm, requireBranch, canSeeCost } from "#core/middleware/tenant.js";

import { nextSeq } from "#core/counters.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { withTransaction } from "#core/tx.js";
import { badRequest, conflict, notFound } from "#core/httpError.js";
import { afterStockChange } from "#modules/alerts/alerts.service.js";
import { priceLines, totalsFor, consumeParts, restoreParts, shapeJob } from "#modules/jobs/jobs.service.js";
import { escapeRegex } from "#core/regex.js";

export const jobsRouter = Router();

const lineSchema = z.object({
  productId: z.string().optional(),
  name: z.string().optional(),
  kind: z.enum(["part", "labour"]).optional(),
  qty: z.number().positive(),
  price: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
});

const createSchema = z.object({
  title: z.string().min(2, "Describe the job"),
  reference: z.string().default(""),
  // Links this ticket to a specific tracked unit (server/modules/products/
  // serial.model.js) so its repair history shows up on the serial lookup.
  serialNo: z.string().default(""),
  notes: z.string().default(""),
  customerId: z.string().optional(),
  customer: z.object({ name: z.string().min(1), phone: z.string().default("") }).optional(),
  lines: z.array(lineSchema).default([]),
  discount: z.number().min(0).default(0),
  deposit: z.number().min(0).default(0),
  depositMethod: z.enum(["cash", "pos", "transfer"]).default("cash"),
  promisedAt: z.string().optional(),
});

// POST /api/jobs — take work in
jobsRouter.post("/", requirePerm("sales"), requireBranch, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const job = await withTransaction(async (session) => {
    const { lines, subtotal } = await priceLines(req.ctx, d.lines, session);
    const totals = totalsFor(req.ctx.business, subtotal, d.discount);
    if (d.deposit > totals.total) throw badRequest("The deposit is more than the job is worth.");

    let customer = null;
    if (d.customerId) {
      customer = await Customer.findOne({ _id: d.customerId, businessId: req.ctx.businessId }).session(session);
      if (!customer) throw badRequest("That customer doesn't exist.");
    } else if (d.customer?.name) {
      customer =
        (d.customer.phone &&
          (await Customer.findOne({ businessId: req.ctx.businessId, phone: d.customer.phone }).session(session))) ||
        (await Customer.create([{
          accountId: req.ctx.accountId, businessId: req.ctx.businessId,
          name: d.customer.name, phone: d.customer.phone, whatsapp: d.customer.phone,
        }], { session }))[0];
    }

    const seq = await nextSeq(`job:${req.ctx.branchId}`, session);
    const [job] = await Job.create([{
      accountId: req.ctx.accountId,
      businessId: req.ctx.businessId,
      branchId: req.ctx.branchId,
      jobNo: `J-${String(seq).padStart(5, "0")}`,
      customerId: customer?._id,
      customerName: customer?.name || "",
      customerPhone: customer?.phone || "",
      title: d.title.trim(),
      reference: d.reference.trim(),
      serialNo: d.serialNo.trim(),
      notes: d.notes,
      lines,
      ...totals,
      deposit: money(d.deposit),
      depositMethod: d.depositMethod,
      promisedAt: d.promisedAt ? new Date(d.promisedAt) : undefined,
      staffId: req.ctx.userId,
      staffName: req.ctx.actorName,
      stageHistory: [{ stage: "received", at: new Date(), by: req.ctx.userId, byName: req.ctx.actorName }],
    }], { session });
    return job;
  });

  audit(req.ctx, "job.create", { type: "job", id: job._id, label: job.jobNo }, undefined, { total: job.total, deposit: job.deposit });
  res.status(201).json({ job: shapeJob(job, canSeeCost(req.ctx)) });
});

// GET /api/jobs?stage=&q=&page=&limit=
jobsRouter.get("/", requirePerm("sales", "dashboard_ops"), requireBranch, async (req, res) => {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  if (req.query.stage && JOB_STAGES.includes(String(req.query.stage))) filter.stage = req.query.stage;
  if (req.query.serialNo) filter.serialNo = String(req.query.serialNo);
  if (req.query.open === "1") filter.stage = { $in: ["received", "in_progress", "ready"] };
  if (req.query.overdue === "1") {
    filter.stage = { $in: ["received", "in_progress", "ready"] };
    filter.promisedAt = { $lt: new Date() };
  }
  if (req.query.q) {
    const rx = escapeRegex(req.query.q);
    filter.$or = [
      { jobNo: { $regex: rx, $options: "i" } },
      { title: { $regex: rx, $options: "i" } },
      { reference: { $regex: rx, $options: "i" } },
      { customerName: { $regex: rx, $options: "i" } },
    ];
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);

  const [jobs, count, counts] = await Promise.all([
    Job.find(filter).sort({ promisedAt: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Job.countDocuments(filter),
    // Stage tallies for the tab bar, over the branch rather than the filter.
    Job.aggregate([
      { $match: { businessId: req.ctx.businessId, branchId: req.ctx.branchId } },
      { $group: { _id: "$stage", n: { $sum: 1 } } },
    ]),
  ]);

  const showCost = canSeeCost(req.ctx);
  res.json({
    jobs: jobs.map((j) => shapeJob(j, showCost)),
    page,
    pages: Math.max(1, Math.ceil(count / limit)),
    total: count,
    stageCounts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
  });
});

// GET /api/jobs/:id
jobsRouter.get("/:id", requirePerm("sales", "dashboard_ops"), async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!job) return res.status(404).json({ error: "not_found", message: "Job not found." });
  res.json({ job: shapeJob(job, canSeeCost(req.ctx)) });
});

const updateSchema = z.object({
  title: z.string().min(2).optional(),
  reference: z.string().optional(),
  serialNo: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).optional(),
  discount: z.number().min(0).optional(),
  promisedAt: z.string().nullable().optional(),
});

// PATCH /api/jobs/:id — edit while it is still open
jobsRouter.patch("/:id", requirePerm("sales"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const job = await withTransaction(async (session) => {
    const job = await Job.findOne({ _id: req.params.id, businessId: req.ctx.businessId }).session(session);
    if (!job) throw notFound("Job not found.");
    if (job.stage === "collected" || job.stage === "cancelled") {
      throw conflict("This job is closed — reopen isn't possible.", "closed");
    }
    // Changing the lines after parts have been issued would silently
    // desync stock from the ledger.
    if (d.lines && job.partsConsumed) {
      throw conflict("Parts are already issued for this job — cancel it instead of re-pricing.", "parts_issued");
    }

    if (d.title !== undefined) job.title = d.title.trim();
    if (d.reference !== undefined) job.reference = d.reference.trim();
    if (d.serialNo !== undefined) job.serialNo = d.serialNo.trim();
    if (d.notes !== undefined) job.notes = d.notes;
    if (d.promisedAt !== undefined) job.promisedAt = d.promisedAt ? new Date(d.promisedAt) : undefined;

    if (d.lines || d.discount !== undefined) {
      const raw = d.lines ?? job.lines.map((l) => ({
        productId: l.productId ? String(l.productId) : undefined,
        name: l.name, kind: l.kind, qty: l.qty, price: l.unitPrice,
      }));
      const { lines, subtotal } = await priceLines(req.ctx, raw, session);
      const totals = totalsFor(req.ctx.business, subtotal, d.discount ?? job.discount);
      job.lines = lines;
      Object.assign(job, totals);
      if (job.deposit > job.total) throw badRequest("The deposit is now more than the job is worth.");
    }

    await job.save({ session });
    return job;
  });
  res.json({ job: shapeJob(job, canSeeCost(req.ctx)) });
});

// Which stage can follow which. Collection has its own endpoint because it
// takes money, so it is deliberately not reachable from here.
const NEXT = {
  received: ["in_progress", "cancelled"],
  in_progress: ["ready", "cancelled"],
  ready: ["in_progress", "cancelled"],
  collected: [],
  cancelled: [],
};

// POST /api/jobs/:id/stage — move it along
jobsRouter.post("/:id/stage", requirePerm("sales"), async (req, res) => {
  const stage = String(req.body?.stage || "");
  const note = String(req.body?.note || "");
  if (!JOB_STAGES.includes(stage)) return res.status(400).json({ error: "invalid", message: "Unknown stage." });

  const job = await withTransaction(async (session) => {
    const job = await Job.findOne({ _id: req.params.id, businessId: req.ctx.businessId }).session(session);
    if (!job) throw notFound("Job not found.");
    if (!NEXT[job.stage].includes(stage)) {
      throw conflict(`A job that is ${job.stage.replace("_", " ")} can't move to ${stage.replace("_", " ")}.`, "bad_stage");
    }

    // Starting work is when parts leave the shelf.
    if (stage === "in_progress" && !job.partsConsumed) {
      await consumeParts(req.ctx, job, session);
      job.partsConsumed = true;
    }
    // Cancelling puts them back.
    if (stage === "cancelled" && job.partsConsumed) {
      await restoreParts(req.ctx, job, session);
      job.partsConsumed = false;
    }

    job.stage = stage;
    if (stage === "ready") job.readyAt = new Date();
    job.stageHistory.push({ stage, at: new Date(), by: req.ctx.userId, byName: req.ctx.actorName, note });
    await job.save({ session });
    return job;
  });

  afterStockChange(req.ctx, job.branchId, job.lines.filter((l) => l.productId).map((l) => l.productId));
  audit(req.ctx, "job.stage", { type: "job", id: job._id, label: job.jobNo }, undefined, { stage, note });
  res.json({ job: shapeJob(job, canSeeCost(req.ctx)) });
});

const collectSchema = z.object({
  payments: z.array(z.object({ method: z.enum(["cash", "pos", "transfer"]), amount: z.number().min(0) })).default([]),
});

/**
 * POST /api/jobs/:id/collect — the customer takes the work away and pays.
 *
 * This is where a job becomes a sale. Revenue is recognised now, on delivery,
 * not when the deposit was taken — so the deposit is re-stated as a payment
 * against this sale rather than counted twice.
 */
jobsRouter.post("/:id/collect", requirePerm("sales"), async (req, res) => {
  const parsed = collectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });

  const out = await withTransaction(async (session) => {
    const job = await Job.findOne({ _id: req.params.id, businessId: req.ctx.businessId }).session(session);
    if (!job) throw notFound("Job not found.");
    if (job.stage === "collected") throw conflict("This job was already collected.", "already_collected");
    if (job.stage === "cancelled") throw conflict("This job was cancelled.", "cancelled");
    if (job.stage !== "ready") throw conflict("Mark the job ready before collecting it.", "not_ready");

    const balance = money(job.total - job.deposit);
    const paid = money(parsed.data.payments.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(paid - balance) > 0.01) {
      throw badRequest(`Payments (${paid}) don't match the balance owing (${balance}).`, "payment_mismatch");
    }

    // Parts may never have been issued if the job went straight to ready.
    if (!job.partsConsumed) {
      await consumeParts(req.ctx, job, session);
      job.partsConsumed = true;
    }

    // The deposit is money already collected; restate it on the sale so the
    // receipt shows the whole story and the payment split stays truthful.
    const payments = [...parsed.data.payments.map((p) => ({ method: p.method, amount: money(p.amount) }))];
    if (job.deposit > 0) {
      const existing = payments.find((p) => p.method === job.depositMethod);
      if (existing) existing.amount = money(existing.amount + job.deposit);
      else payments.push({ method: job.depositMethod, amount: job.deposit });
    }

    const seq = await nextSeq(`sale:${req.ctx.branchId}`, session);
    const [sale] = await Sale.create([{
      accountId: req.ctx.accountId,
      businessId: req.ctx.businessId,
      branchId: job.branchId,
      saleNo: `R-${String(seq).padStart(5, "0")}`,
      staffId: req.ctx.userId,
      staffName: req.ctx.actorName,
      customerId: job.customerId,
      customerName: job.customerName,
      items: job.lines.map((l) => ({
        productId: l.productId || new mongoose.Types.ObjectId(),
        name: l.name, qty: l.qty, unitPrice: l.unitPrice,
        lineCost: l.lineCost, lineNet: l.lineNet, returnedQty: 0,
      })),
      subtotal: job.subtotal, discount: job.discount, vat: job.vat, total: job.total,
      payments,
    }], { session });

    job.stage = "collected";
    job.collectedAt = new Date();
    job.saleId = sale._id;
    job.stageHistory.push({ stage: "collected", at: new Date(), by: req.ctx.userId, byName: req.ctx.actorName });
    await job.save({ session });

    if (job.customerId) {
      const customer = await Customer.findById(job.customerId).session(session);
      if (customer) {
        customer.totalSpend = money(customer.totalSpend + job.total);
        customer.visits += 1;
        customer.lastSeen = new Date();
        customer.lastBranchId = job.branchId;
        await customer.save({ session });
      }
    }

    const totalCost = money(job.lines.reduce((s, l) => s + l.lineCost, 0));
    const split = {};
    for (const p of payments) split[p.method] = (split[p.method] || 0) + p.amount;
    await bumpDailyMetric(req.ctx, job.branchId, localDay(), {
      revenue: job.total, cost: totalCost, profit: job.total - job.vat - totalCost,
      txns: 1, discountTotal: job.discount, vatTotal: job.vat, payments: split,
    }, session);

    return { job, sale };
  });

  afterStockChange(req.ctx, out.job.branchId, out.job.lines.filter((l) => l.productId).map((l) => l.productId));
  audit(req.ctx, "job.collect", { type: "job", id: out.job._id, label: out.job.jobNo }, undefined, {
    total: out.job.total, saleNo: out.sale.saleNo,
  });
  res.json({ job: shapeJob(out.job, canSeeCost(req.ctx)), saleNo: out.sale.saleNo });
});
