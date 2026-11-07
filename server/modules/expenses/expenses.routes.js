import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import mongoose from "mongoose";
import { Expense, ExpenseAttachment, RecurringExpense, EXPENSE_METHODS } from "#modules/expenses/expense.model.js";
import { requirePerm, requireBranch } from "#core/middleware/tenant.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { escapeRegex } from "#core/regex.js";

export const expensesRouter = Router();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILES = 3;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(file.mimetype)),
});

function shape(e) {
  return {
    id: e._id, type: e.type, amount: e.amount, notes: e.notes, paidBy: e.paidBy,
    paymentMethod: e.paymentMethod || "cash", reference: e.reference || "",
    attachments: (e.attachments || []).map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })),
    recurringId: e.recurringId || null,
    actorName: e.actorName, editedAt: e.editedAt || null, editedBy: e.editedBy || "", at: e.at,
  };
}

// The day an expense is dated: today keeps the time it was entered; an earlier day sits at midday.
function dateFor(day) {
  if (!day || day === localDay()) return new Date();
  return new Date(`${day}T12:00:00`);
}

// A date can be up to a year back, never in the future.
const dayField = z.string().regex(DAY, "Use a valid date").refine((d) => d <= localDay(), "An expense can't be dated in the future").optional();

function listFilter(req) {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  const { from, to, type, method, q } = req.query;
  if (DAY.test(from || "") || DAY.test(to || "")) {
    filter.at = {};
    if (DAY.test(from || "")) filter.at.$gte = new Date(`${from}T00:00:00`);
    if (DAY.test(to || "")) filter.at.$lt = new Date(new Date(`${to}T00:00:00`).getTime() + 24 * 3600 * 1000);
  }
  if (type) filter.type = String(type);
  if (method && EXPENSE_METHODS.includes(String(method))) filter.paymentMethod = String(method);
  const term = escapeRegex(q);
  if (term) {
    const rx = new RegExp(term, "i");
    filter.$or = [{ type: rx }, { notes: rx }, { paidBy: rx }, { reference: rx }];
  }
  return filter;
}

// GET /api/expenses?from=&to=&type=&method=&q= — the entries, plus totals by category and by method
expensesRouter.get("/", requirePerm("expenses"), requireBranch, async (req, res) => {
  const filter = listFilter(req);
  const expenses = await Expense.find(filter).sort({ at: -1 }).limit(500);
  const [byType, byMethod, all] = await Promise.all([
    Expense.aggregate([{ $match: filter }, { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    Expense.aggregate([{ $match: filter }, { $group: { _id: { $ifNull: ["$paymentMethod", "cash"] }, amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    Expense.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
  ]);
  res.json({
    expenses: expenses.map(shape),
    total: money(all[0]?.amount || 0),
    count: all[0]?.count || 0,
    byType: byType.map((t) => ({ type: t._id, amount: money(t.amount), count: t.count })),
    byMethod: byMethod.map((m) => ({ method: m._id, amount: money(m.amount), count: m.count })),
  });
});

// GET /api/expenses/types — the business's own categories so far
expensesRouter.get("/types", requirePerm("expenses"), async (req, res) => {
  const types = await Expense.distinct("type", { businessId: req.ctx.businessId });
  res.json({ types: types.sort((a, b) => a.localeCompare(b)) });
});

// GET /api/expenses/summary?year=2026 — month by month for a year, and each category's share of it
expensesRouter.get("/summary", requirePerm("expenses"), requireBranch, async (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year || "")) ? Number(req.query.year) : new Date().getFullYear();
  const match = {
    businessId: req.ctx.businessId, branchId: req.ctx.branchId,
    at: { $gte: new Date(`${year}-01-01T00:00:00`), $lt: new Date(`${year + 1}-01-01T00:00:00`) },
  };
  const rows = await Expense.find(match).select("type amount at").lean();
  const months = [...Array(12)].map((_, i) => ({ month: i + 1, amount: 0, count: 0 }));
  const types = new Map();
  for (const e of rows) {
    const m = months[new Date(e.at).getMonth()];
    m.amount += e.amount; m.count += 1;
    types.set(e.type, (types.get(e.type) || 0) + e.amount);
  }
  const total = months.reduce((s, m) => s + m.amount, 0);
  res.json({
    year,
    total: money(total),
    months: months.map((m) => ({ ...m, amount: money(m.amount) })),
    byType: [...types.entries()].sort((a, b) => b[1] - a[1]).map(([type, amount]) => ({ type, amount: money(amount) })),
  });
});

const expenseSchema = z.object({
  type: z.string().trim().min(1, "What kind of expense is this?").max(60),
  amount: z.number().positive("Amount must be more than zero"),
  notes: z.string().max(500).default(""),
  paidBy: z.string().max(80).default(""),
  paymentMethod: z.enum(EXPENSE_METHODS).default("cash"),
  reference: z.string().max(80).default(""),
  date: dayField,
});

// POST /api/expenses
expensesRouter.post("/", requirePerm("expenses"), requireBranch, async (req, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const expense = await Expense.create({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: req.ctx.branchId,
    type: d.type,
    amount: money(d.amount),
    notes: d.notes,
    paidBy: d.paidBy,
    paymentMethod: d.paymentMethod,
    reference: d.reference,
    actorId: req.ctx.userId,
    actorName: req.ctx.actorName,
    at: dateFor(d.date),
  });

  await bumpDailyMetric(req.ctx, req.ctx.branchId, localDay(expense.at), { expenses: expense.amount });
  res.status(201).json({ expense: shape(expense) });
});

// PATCH /api/expenses/:id — correct an entry. The day's figures move with it; audited.
expensesRouter.patch("/:id", requirePerm("expenses_edit"), async (req, res) => {
  const parsed = expenseSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;
  const expense = await Expense.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!expense) return res.status(404).json({ error: "not_found", message: "Expense not found." });

  const before = { type: expense.type, amount: expense.amount, notes: expense.notes, paidBy: expense.paidBy, paymentMethod: expense.paymentMethod, reference: expense.reference, date: localDay(expense.at) };
  const oldDay = localDay(expense.at);
  const oldAmount = expense.amount;

  if (d.type !== undefined) expense.type = d.type;
  if (d.amount !== undefined) expense.amount = money(d.amount);
  if (d.notes !== undefined) expense.notes = d.notes;
  if (d.paidBy !== undefined) expense.paidBy = d.paidBy;
  if (d.paymentMethod !== undefined) expense.paymentMethod = d.paymentMethod;
  if (d.reference !== undefined) expense.reference = d.reference;
  if (d.date !== undefined && d.date !== oldDay) expense.at = dateFor(d.date);
  expense.editedAt = new Date();
  expense.editedBy = req.ctx.actorName;
  await expense.save();

  // Take it off the day it was on, put it on the day it is on now.
  const newDay = localDay(expense.at);
  if (newDay !== oldDay || expense.amount !== oldAmount) {
    await bumpDailyMetric(req.ctx, expense.branchId, oldDay, { expenses: -oldAmount });
    await bumpDailyMetric(req.ctx, expense.branchId, newDay, { expenses: expense.amount });
  }
  audit(req.ctx, "expense.update", { type: "expense", id: expense._id, label: expense.type }, before, {
    type: expense.type, amount: expense.amount, notes: expense.notes, paidBy: expense.paidBy, paymentMethod: expense.paymentMethod, reference: expense.reference, date: newDay,
  });
  res.json({ expense: shape(expense) });
});

// DELETE /api/expenses/:id — audited; its files go with it
expensesRouter.delete("/:id", requirePerm("expenses_delete"), async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!expense) return res.status(404).json({ error: "not_found", message: "Expense not found." });

  await expense.deleteOne();
  await ExpenseAttachment.deleteMany({ businessId: req.ctx.businessId, expenseId: expense._id });
  await bumpDailyMetric(req.ctx, expense.branchId, localDay(expense.at), { expenses: -expense.amount });
  audit(req.ctx, "expense.delete", { type: "expense", id: expense._id, label: expense.type }, { amount: expense.amount, date: localDay(expense.at) });
  res.json({ ok: true });
});

// ── Supporting documents ─────────────────────────────────────

// POST /api/expenses/:id/attachments (multipart "file") — a receipt photo or PDF, up to 3 MB, three per expense
expensesRouter.post("/:id/attachments", requirePerm("expenses"), (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: "invalid", message: err.code === "LIMIT_FILE_SIZE" ? "That file is over 3 MB." : "That file couldn't be read." });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "invalid", message: "Attach a photo (JPG, PNG, WEBP) or a PDF." });
  const expense = await Expense.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!expense) return res.status(404).json({ error: "not_found", message: "Expense not found." });
  if ((expense.attachments || []).length >= MAX_FILES) return res.status(400).json({ error: "invalid", message: `An expense can have up to ${MAX_FILES} files.` });

  const file = await ExpenseAttachment.create({
    accountId: req.ctx.accountId, businessId: req.ctx.businessId, expenseId: expense._id,
    name: String(req.file.originalname || "file").slice(0, 120), mime: req.file.mimetype, size: req.file.size, data: req.file.buffer,
  });
  expense.attachments.push({ id: file._id, name: file.name, mime: file.mime, size: file.size });
  await expense.save();
  res.status(201).json({ expense: shape(expense) });
});

// GET /api/expenses/:id/attachments/:fileId — the file itself
expensesRouter.get("/:id/attachments/:fileId", requirePerm("expenses"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.fileId)) return res.status(404).json({ error: "not_found", message: "File not found." });
  const file = await ExpenseAttachment.findOne({ _id: req.params.fileId, expenseId: req.params.id, businessId: req.ctx.businessId });
  if (!file) return res.status(404).json({ error: "not_found", message: "File not found." });
  res.set({
    "Content-Type": file.mime,
    "Content-Length": file.size,
    "Content-Disposition": `inline; filename="${file.name.replace(/[^\w.\- ]/g, "_")}"`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(file.data);
});

// DELETE /api/expenses/:id/attachments/:fileId
expensesRouter.delete("/:id/attachments/:fileId", requirePerm("expenses_edit"), async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!expense) return res.status(404).json({ error: "not_found", message: "Expense not found." });
  await ExpenseAttachment.deleteOne({ _id: req.params.fileId, expenseId: expense._id, businessId: req.ctx.businessId });
  expense.attachments = (expense.attachments || []).filter((a) => String(a.id) !== String(req.params.fileId));
  await expense.save();
  res.json({ expense: shape(expense) });
});

// ── Recurring expenses ───────────────────────────────────────

/** The next due day after `day` for a schedule, keeping the day of the month where it can. */
export function advanceDue(day, frequency) {
  const [y, m, d] = day.split("-").map(Number);
  if (frequency === "weekly") {
    const t = new Date(y, m - 1, d + 7);
    return localDay(t);
  }
  const months = frequency === "yearly" ? 12 : frequency === "quarterly" ? 3 : 1;
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return localDay(target);
}

function shapeRecurring(r) {
  return {
    id: r._id, type: r.type, amount: r.amount, notes: r.notes, paidBy: r.paidBy, paymentMethod: r.paymentMethod,
    frequency: r.frequency, nextDue: r.nextDue, active: r.active, due: r.active && r.nextDue <= localDay(),
  };
}

const recurringSchema = z.object({
  type: z.string().trim().min(1, "What kind of expense is this?").max(60),
  amount: z.number().positive("Amount must be more than zero"),
  notes: z.string().max(500).default(""),
  paidBy: z.string().max(80).default(""),
  paymentMethod: z.enum(EXPENSE_METHODS).default("transfer"),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
  nextDue: z.string().regex(DAY, "Choose when it is next due"),
  active: z.boolean().optional(),
});

// GET /api/expenses/recurring
expensesRouter.get("/recurring", requirePerm("expenses"), requireBranch, async (req, res) => {
  const rows = await RecurringExpense.find({ businessId: req.ctx.businessId, branchId: req.ctx.branchId }).sort({ active: -1, nextDue: 1 });
  res.json({ recurring: rows.map(shapeRecurring) });
});

// POST /api/expenses/recurring
expensesRouter.post("/recurring", requirePerm("expenses"), requireBranch, async (req, res) => {
  const parsed = recurringSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const r = await RecurringExpense.create({
    ...parsed.data, amount: money(parsed.data.amount),
    accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId, createdBy: req.ctx.actorName,
  });
  audit(req.ctx, "expense.recurring_create", { type: "recurring_expense", id: r._id, label: r.type }, undefined, { amount: r.amount, frequency: r.frequency, nextDue: r.nextDue });
  res.status(201).json({ recurring: shapeRecurring(r) });
});

// PATCH /api/expenses/recurring/:id — change it, pause it, or skip to a later date
expensesRouter.patch("/recurring/:id", requirePerm("expenses_edit"), async (req, res) => {
  const parsed = recurringSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const r = await RecurringExpense.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!r) return res.status(404).json({ error: "not_found", message: "Recurring expense not found." });
  const before = { amount: r.amount, frequency: r.frequency, nextDue: r.nextDue, active: r.active };
  Object.assign(r, parsed.data);
  if (parsed.data.amount !== undefined) r.amount = money(parsed.data.amount);
  await r.save();
  audit(req.ctx, "expense.recurring_update", { type: "recurring_expense", id: r._id, label: r.type }, before, { amount: r.amount, frequency: r.frequency, nextDue: r.nextDue, active: r.active });
  res.json({ recurring: shapeRecurring(r) });
});

// DELETE /api/expenses/recurring/:id — stops future reminders; recorded expenses stay
expensesRouter.delete("/recurring/:id", requirePerm("expenses_delete"), async (req, res) => {
  const r = await RecurringExpense.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!r) return res.status(404).json({ error: "not_found", message: "Recurring expense not found." });
  await r.deleteOne();
  audit(req.ctx, "expense.recurring_delete", { type: "recurring_expense", id: r._id, label: r.type });
  res.json({ ok: true });
});

const recordSchema = z.object({ amount: z.number().positive().optional(), date: dayField, reference: z.string().max(80).default("") });

// POST /api/expenses/recurring/:id/record — record this round as an expense and move to the next due date
expensesRouter.post("/recurring/:id/record", requirePerm("expenses"), requireBranch, async (req, res) => {
  const parsed = recordSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const r = await RecurringExpense.findOne({ _id: req.params.id, businessId: req.ctx.businessId, branchId: req.ctx.branchId });
  if (!r) return res.status(404).json({ error: "not_found", message: "Recurring expense not found." });

  // Moving the due date first, and only from the date we read, means two
  // people pressing Record at once can't book the same round twice.
  const claimed = await RecurringExpense.updateOne({ _id: r._id, nextDue: r.nextDue }, { $set: { nextDue: advanceDue(r.nextDue, r.frequency) } });
  if (!claimed.modifiedCount) return res.status(409).json({ error: "already_recorded", message: "That one was just recorded. Refresh to see it." });

  const day = parsed.data.date || (r.nextDue <= localDay() ? r.nextDue : localDay());
  const expense = await Expense.create({
    accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId,
    type: r.type, amount: money(parsed.data.amount ?? r.amount), notes: r.notes, paidBy: r.paidBy,
    paymentMethod: r.paymentMethod, reference: parsed.data.reference, recurringId: r._id,
    actorId: req.ctx.userId, actorName: req.ctx.actorName, at: dateFor(day),
  });
  await bumpDailyMetric(req.ctx, req.ctx.branchId, localDay(expense.at), { expenses: expense.amount });
  const fresh = await RecurringExpense.findById(r._id);
  res.status(201).json({ expense: shape(expense), recurring: shapeRecurring(fresh) });
});
