import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Ticket } from "#modules/support/ticket.model.js";
import { User } from "#modules/auth/user.model.js";
import { Account } from "#modules/auth/account.model.js";
import { Business } from "#modules/business/business.model.js";
import { requireAuth } from "#core/middleware/requireAuth.js";
import { requirePlatform } from "#modules/platform/platform.routes.js";
import { logPlatform } from "#modules/platform/platformLog.model.js";
import { escapeRegex } from "#core/regex.js";
import { nextSeq } from "#core/counters.js";
import { effectivePlan } from "#shared/plans.js";
import { typeTemplate } from "#shared/businessTypes.js";
import { acceptFiles, saveFiles, fileVisible, sendTicketFile, notifyBusiness } from "#modules/support/support.shared.js";

/**
 * StarTrack's support desk: the queue of requests businesses have sent to
 * StarTrack, worked by platform staff (support or overseer). It only ever sees
 * tickets with scope "platform"; a business's internal tickets stay theirs.
 * Unlike the console, support staff can act here: answering is their job.
 */
export const deskRouter = Router();
deskRouter.use(requireAuth, requirePlatform);

const DAY = 86_400_000;
const OPEN = ["open", "in_progress"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];

function shape(t, bizName = "") {
  return {
    id: t._id, ref: t.ref || t.ticketNo, ticketNo: t.ticketNo, subject: t.subject, description: t.description,
    category: t.category, priority: t.priority, status: t.status, awaiting: t.awaiting || null,
    businessId: t.businessId, accountId: t.accountId, businessName: bizName,
    raisedBy: t.raisedBy, customerName: t.customerName,
    assignee: t.deskAssigneeId ? { id: t.deskAssigneeId, name: t.deskAssigneeName } : null,
    attachments: t.attachments || [],
    comments: (t.comments || []).map((c) => ({ byId: c.byId, byName: c.byName, body: c.body, at: c.at, side: c.side || "business", internal: !!c.internal, attachments: c.attachments || [] })),
    messages: (t.comments || []).filter((c) => !c.internal).length,
    escalatedAt: t.escalatedAt, firstResponseAt: t.firstResponseAt, lastMessageAt: t.lastMessageAt || t.escalatedAt || t.createdAt,
    resolvedAt: t.resolvedAt, closedAt: t.closedAt, createdAt: t.createdAt,
  };
}

async function namesFor(tickets) {
  const biz = await Business.find({ _id: { $in: tickets.map((t) => t.businessId) } }).select("name").lean();
  return new Map(biz.map((b) => [String(b._id), b.name]));
}

async function loadTicket(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const t = await Ticket.findOne({ _id: id, scope: "platform" });
  // Escalated before StarTrack references existed: give it one now.
  if (t && !t.ref) {
    t.ref = `ST-${String(await nextSeq("ticket:platform")).padStart(6, "0")}`;
    await t.save();
  }
  return t;
}

// GET /api/desk/tickets?view=mine|unassigned|waiting|all&status=&priority=&category=&q=&page=
deskRouter.get("/tickets", async (req, res) => {
  const filter = { scope: "platform" };
  const view = String(req.query.view || "open");
  if (view === "mine") filter.deskAssigneeId = req.platformUser._id;
  if (view === "unassigned") filter.deskAssigneeId = null;
  if (view === "waiting") filter.awaiting = "startrack";
  if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
  else if (view !== "all") filter.status = { $in: OPEN };
  if (["low", "normal", "high"].includes(req.query.priority)) filter.priority = req.query.priority;
  if (["complaint", "question", "billing", "technical", "other"].includes(req.query.category)) filter.category = req.query.category;
  const term = escapeRegex(req.query.q);
  if (term) {
    const rx = { $regex: term, $options: "i" };
    const biz = await Business.find({ name: rx }).select("_id").limit(50).lean();
    filter.$or = [{ subject: rx }, { ref: rx }, { ticketNo: rx }, { "raisedBy.name": rx }, { businessId: { $in: biz.map((b) => b._id) } }];
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const me = req.platformUser._id;
  const [tickets, total, counts] = await Promise.all([
    // Most urgent first: high priority, then whoever has waited longest for us.
    Ticket.aggregate([
      { $match: filter },
      { $addFields: { _p: { $indexOfArray: [["high", "normal", "low"], "$priority"] }, _w: { $cond: [{ $eq: ["$awaiting", "startrack"] }, 0, 1] }, _last: { $ifNull: ["$lastMessageAt", "$escalatedAt"] } } },
      { $sort: { _w: 1, _p: 1, _last: 1 } },
      { $skip: (page - 1) * limit }, { $limit: limit },
      { $project: { _p: 0, _w: 0, _last: 0 } },
    ]),
    Ticket.countDocuments(filter),
    Ticket.aggregate([
      { $match: { scope: "platform", status: { $in: OPEN } } },
      { $group: {
        _id: null, open: { $sum: 1 },
        mine: { $sum: { $cond: [{ $eq: ["$deskAssigneeId", me] }, 1, 0] } },
        unassigned: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$deskAssigneeId", null] }, null] }, 1, 0] } },
        waiting: { $sum: { $cond: [{ $eq: ["$awaiting", "startrack"] }, 1, 0] } },
      } },
    ]),
  ]);
  const names = await namesFor(tickets);
  const c = counts[0] || {};
  res.json({
    tickets: tickets.map((t) => { const s = shape(t, names.get(String(t.businessId)) || ""); delete s.comments; return s; }),
    page, pages: Math.max(1, Math.ceil(total / limit)), total,
    counts: { open: c.open || 0, mine: c.mine || 0, unassigned: c.unassigned || 0, waiting: c.waiting || 0 },
  });
});

// GET /api/desk/tickets/:id — the whole conversation, internal notes included, and who the business is
deskRouter.get("/tickets/:id", async (req, res) => {
  const t = await loadTicket(req.params.id);
  if (!t) return res.status(404).json({ error: "not_found", message: "Ticket not found." });
  const [biz, account, raiser, history] = await Promise.all([
    Business.findById(t.businessId).select("name typeKey").lean(),
    Account.findById(t.accountId).select("name plan subscription status createdAt").lean(),
    User.findById(t.raisedBy.userId).select("email phone").lean(),
    Ticket.find({ scope: "platform", businessId: t.businessId, _id: { $ne: t._id } }).sort({ escalatedAt: -1 }).limit(5).select("ref ticketNo subject status escalatedAt").lean(),
  ]);
  const email = raiser?.email && !raiser.email.endsWith(".till.local") ? raiser.email : "";
  res.json({
    ticket: shape(t, biz?.name || ""),
    business: {
      name: biz?.name || "", trade: biz ? typeTemplate(biz.typeKey).label : "", plan: account ? effectivePlan(account) : "",
      accountStatus: account?.status || "active", customerSince: account?.createdAt || null,
      contact: { name: t.raisedBy.name, email, phone: raiser?.phone || "" },
    },
    history: history.map((h) => ({ id: h._id, ref: h.ref || h.ticketNo, subject: h.subject, status: h.status, at: h.escalatedAt })),
  });
});

const replySchema = z.object({
  body: z.string().trim().max(5000).default(""),
  internal: z.preprocess((v) => v === true || v === "true" || v === "1", z.boolean()).default(false),
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
});

// POST /api/desk/tickets/:id/reply — JSON or multipart (body, internal, status, files)
deskRouter.post("/tickets/:id/reply", acceptFiles, async (req, res) => {
  const parsed = replySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;
  const files = req.files || [];
  if (!d.body && !files.length) return res.status(400).json({ error: "invalid", message: "Write a reply first." });
  const t = await loadTicket(req.params.id);
  if (!t) return res.status(404).json({ error: "not_found", message: "Ticket not found." });

  const me = req.platformUser;
  const attachments = await saveFiles(t, files);
  t.comments.push({ byId: me._id, byName: me.name, body: d.body, side: "startrack", internal: d.internal, attachments });
  if (!d.internal) {
    t.awaiting = "business";
    t.lastMessageAt = new Date();
    if (!t.firstResponseAt) t.firstResponseAt = new Date();
    if (t.status === "open") t.status = "in_progress";
  }
  // Whoever answers first picks the ticket up, unless someone already has it.
  if (!t.deskAssigneeId) { t.deskAssigneeId = me._id; t.deskAssigneeName = me.name; }
  if (d.status) applyStatus(t, d.status);
  await t.save();

  if (!d.internal) {
    await notifyBusiness(t, {
      title: t.status === "resolved" ? `${t.ref} resolved by StarTrack` : `StarTrack replied on ${t.ref}`,
      body: d.body.slice(0, 160) || "StarTrack support sent you files.",
    });
  }
  const names = await namesFor([t]);
  res.status(201).json({ ticket: shape(t, names.get(String(t.businessId)) || "") });
});

function applyStatus(t, status) {
  t.status = status;
  if (status === "resolved") { t.resolvedAt = new Date(); t.awaiting = null; }
  if (status === "closed") { t.closedAt = new Date(); t.resolvedAt = t.resolvedAt || new Date(); t.awaiting = null; }
  if (status === "open" || status === "in_progress") { t.resolvedAt = null; t.closedAt = null; }
}

const updateSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  category: z.enum(["complaint", "question", "billing", "technical", "other"]).optional(),
  assigneeId: z.string().nullable().optional(),
});

// PATCH /api/desk/tickets/:id — status, priority, category, who at StarTrack has it
deskRouter.patch("/tickets/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;
  const t = await loadTicket(req.params.id);
  if (!t) return res.status(404).json({ error: "not_found", message: "Ticket not found." });
  const before = { status: t.status, priority: t.priority, category: t.category, assignee: t.deskAssigneeName || null };

  if (d.assigneeId !== undefined) {
    if (d.assigneeId === null) { t.deskAssigneeId = null; t.deskAssigneeName = ""; }
    else {
      const agent = mongoose.isValidObjectId(d.assigneeId)
        && await User.findOne({ _id: d.assigneeId, status: "active", platformRole: { $in: ["support", "overseer"] } }).select("name");
      if (!agent) return res.status(400).json({ error: "invalid", message: "Assign it to someone on the StarTrack team." });
      t.deskAssigneeId = agent._id; t.deskAssigneeName = agent.name;
    }
  }
  if (d.priority) t.priority = d.priority;
  if (d.category) t.category = d.category;
  const statusChanged = d.status && d.status !== t.status;
  if (statusChanged) applyStatus(t, d.status);
  await t.save();

  const after = { status: t.status, priority: t.priority, category: t.category, assignee: t.deskAssigneeName || null };
  logPlatform(req, "platform.ticket", { type: "ticket", id: t._id, label: `${t.ref}: ${t.subject}` }, before, after);
  if (statusChanged && (t.status === "resolved" || t.status === "closed")) {
    await notifyBusiness(t, { title: `${t.ref} ${t.status} by StarTrack`, body: "Reply on the request if you still need help and it will open again." });
  }
  const names = await namesFor([t]);
  res.json({ ticket: shape(t, names.get(String(t.businessId)) || "") });
});

// GET /api/desk/tickets/:id/files/:fileId — any attachment, internal notes included
deskRouter.get("/tickets/:id/files/:fileId", async (req, res) => {
  const t = await loadTicket(req.params.id);
  if (!t || !fileVisible(t, req.params.fileId, { desk: true })) return res.status(404).json({ error: "not_found", message: "File not found." });
  return sendTicketFile(res, t, req.params.fileId);
});

// GET /api/desk/team — who a ticket can be assigned to
deskRouter.get("/team", async (_req, res) => {
  const people = await User.find({ status: "active", platformRole: { $in: ["support", "overseer"] } }).select("name email platformRole").sort({ name: 1 }).lean();
  res.json({ team: people.map((p) => ({ id: p._id, name: p.name, email: p.email, role: p.platformRole })) });
});

// The calendar day on the server clock (toISOString would give the UTC day, a day off near midnight).
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// GET /api/desk/stats?days=30 — how support is doing: workload, speed, what people ask about
deskRouter.get("/stats", async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);
  const [recent, openNow] = await Promise.all([
    Ticket.find({ scope: "platform", escalatedAt: { $gte: since } })
      .select("category priority status escalatedAt firstResponseAt resolvedAt deskAssigneeId deskAssigneeName").lean(),
    Ticket.find({ scope: "platform", status: { $in: OPEN } }).select("awaiting escalatedAt lastMessageAt deskAssigneeId").lean(),
  ]);
  const resolvedInRange = await Ticket.find({ scope: "platform", resolvedAt: { $gte: since } }).select("escalatedAt resolvedAt deskAssigneeId deskAssigneeName").lean();

  const hours = (a, b) => (new Date(b) - new Date(a)) / 3_600_000;
  const firstResponse = recent.filter((t) => t.firstResponseAt).map((t) => hours(t.escalatedAt, t.firstResponseAt));
  const resolution = resolvedInRange.filter((t) => t.escalatedAt).map((t) => hours(t.escalatedAt, t.resolvedAt));
  const within24 = firstResponse.filter((h) => h <= 24).length;

  const tally = (rows, key, order) => {
    const m = Object.fromEntries(order.map((k) => [k, 0]));
    for (const r of rows) m[r[key]] = (m[r[key]] || 0) + 1;
    return order.map((k) => ({ key: k, count: m[k] }));
  };

  // One point per day: requests that came in, and requests resolved.
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const key = localKey(d);
    series.push({ date: key, created: 0, resolved: 0 });
  }
  const byDay = new Map(series.map((s) => [s.date, s]));
  const dayKey = (at) => localKey(new Date(at));
  for (const t of recent) { const s = byDay.get(dayKey(t.escalatedAt)); if (s) s.created++; }
  for (const t of resolvedInRange) { const s = byDay.get(dayKey(t.resolvedAt)); if (s) s.resolved++; }

  const agents = new Map();
  for (const t of resolvedInRange) {
    if (!t.deskAssigneeId) continue;
    const a = agents.get(String(t.deskAssigneeId)) || { name: t.deskAssigneeName, resolved: 0, open: 0 };
    a.resolved++;
    agents.set(String(t.deskAssigneeId), a);
  }
  for (const t of openNow) {
    if (!t.deskAssigneeId) continue;
    const a = agents.get(String(t.deskAssigneeId));
    if (a) a.open++;
  }
  const oldestWaiting = openNow.filter((t) => t.awaiting === "startrack").map((t) => t.lastMessageAt || t.escalatedAt).sort((a, b) => new Date(a) - new Date(b))[0] || null;
  const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

  res.json({
    days,
    totals: {
      received: recent.length, resolved: resolvedInRange.length, open: openNow.length,
      waitingOnUs: openNow.filter((t) => t.awaiting === "startrack").length,
      unassigned: openNow.filter((t) => !t.deskAssigneeId).length,
      medianFirstResponseHours: round1(median(firstResponse)),
      medianResolutionHours: round1(median(resolution)),
      answeredWithin24hPct: firstResponse.length ? Math.round((within24 / firstResponse.length) * 100) : null,
      oldestWaitingSince: oldestWaiting,
    },
    byCategory: tally(recent, "category", ["technical", "billing", "question", "complaint", "other"]),
    byPriority: tally(recent, "priority", ["high", "normal", "low"]),
    series,
    agents: [...agents.values()].sort((a, b) => b.resolved - a.resolved),
  });
});
