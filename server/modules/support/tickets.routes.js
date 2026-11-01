import { Router } from "express";
import { z } from "zod";
import { Ticket } from "#modules/support/ticket.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { requirePerm } from "#core/middleware/tenant.js";
import { audit } from "#core/audit.js";
import { raise, keys } from "#modules/alerts/notify.js";
import { User } from "#modules/auth/user.model.js";
import { emailPerson, realEmail } from "#core/ownerMail.js";
import { esc } from "#core/mailer.js";
import { nextSeq } from "#core/counters.js";
import { notFound, badRequest } from "#core/httpError.js";
import { escapeRegex } from "#core/regex.js";

export const ticketsRouter = Router();

function shape(t) {
  return {
    id: t._id,
    ticketNo: t.ticketNo,
    subject: t.subject,
    description: t.description,
    category: t.category,
    priority: t.priority,
    status: t.status,
    customerId: t.customerId,
    customerName: t.customerName,
    customerPhone: t.customerPhone,
    raisedBy: t.raisedBy,
    assignedToId: t.assignedToId,
    assignedToName: t.assignedToName,
    comments: t.comments,
    scope: t.scope,
    escalatedAt: t.escalatedAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const canManage = (ctx) => ctx.perms.includes("*") || ctx.perms.includes("support");
// Everyone can see their own — the ticket they raised, or one assigned to
// them — support-permed roles (admin/manager/owner) see the whole queue.
function visibilityFilter(ctx) {
  if (canManage(ctx)) return { businessId: ctx.businessId };
  return { businessId: ctx.businessId, $or: [{ "raisedBy.userId": ctx.userId }, { assignedToId: ctx.userId }] };
}

/** Notifies specific people about a ticket update — never a broadcast. */
async function notify(ctx, ticket, { toUserIds, title, body }) {
  const stamp = Date.now();
  const recipients = [...new Set(toUserIds.map(String))].filter((id) => id !== String(ctx.userId));
  for (const forUserId of recipients) {
    await raise(
      { accountId: ctx.accountId, businessId: ctx.businessId, branchId: ticket.branchId },
      {
        type: "ticket_update",
        severity: "info",
        title,
        body,
        target: { type: "ticket", id: ticket._id, label: ticket.subject },
        dedupeKey: keys.ticketUpdate(ticket._id, stamp),
        forUserId,
      }
    );
  }
  // The bell is for people who are in the app; the email reaches them when they aren't.
  const people = await User.find({ _id: { $in: recipients } }).select("email");
  for (const person of people.filter((u) => realEmail(u.email))) {
    emailPerson(person.email, {
      subject: `${title} — ${ticket.subject}`,
      businessName: ctx.business?.name || "StarTrack",
      heading: title,
      intro: body || `Support ticket "${ticket.subject}" has an update.`,
      sections: [`<p style="font-size:13px;color:#6b7280;margin:0">Ticket ${esc(ticket.ticketNo)}: ${esc(ticket.subject)}. Open Support in StarTrack to reply.</p>`],
      footNote: "You are receiving this because you raised or were assigned this ticket.",
    }).catch(() => {});
  }
}

const createSchema = z.object({
  subject: z.string().min(2, "Give the ticket a subject"),
  description: z.string().default(""),
  category: z.enum(["complaint", "question", "billing", "technical", "other"]).default("other"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  customerId: z.string().optional(),
  customerName: z.string().default(""),
  customerPhone: z.string().default(""),
});

// POST /api/tickets
ticketsRouter.post("/", requirePerm("sales"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  let customerName = d.customerName;
  let customerPhone = d.customerPhone;
  if (d.customerId) {
    const customer = await Customer.findOne({ _id: d.customerId, businessId: req.ctx.businessId });
    if (!customer) return res.status(400).json({ error: "invalid", message: "That customer doesn't exist." });
    customerName = customer.name;
    customerPhone = customer.phone || customer.whatsapp || "";
  }

  const seq = await nextSeq(`ticket:${req.ctx.businessId}`);
  const ticket = await Ticket.create({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: req.ctx.branchId,
    ticketNo: `T-${String(seq).padStart(5, "0")}`,
    subject: d.subject,
    description: d.description,
    category: d.category,
    priority: d.priority,
    customerId: d.customerId || null,
    customerName,
    customerPhone,
    raisedBy: { userId: req.ctx.userId, name: req.ctx.actorName },
  });

  audit(req.ctx, "ticket.create", { type: "ticket", id: ticket._id, label: ticket.ticketNo });
  res.status(201).json({ ticket: shape(ticket) });
});

// GET /api/tickets?status=&priority=&q=
ticketsRouter.get("/", async (req, res) => {
  const filter = visibilityFilter(req.ctx);
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.priority) filter.priority = String(req.query.priority);
  if (req.query.q) {
    const rx = { $regex: escapeRegex(req.query.q), $options: "i" };
    filter.$and = [...(filter.$and || []), { $or: [{ subject: rx }, { ticketNo: rx }, { customerName: rx }] }];
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const [tickets, total, statusCounts] = await Promise.all([
    Ticket.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Ticket.countDocuments(filter),
    Ticket.aggregate([{ $match: visibilityFilter(req.ctx) }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);

  res.json({
    tickets: tickets.map(shape),
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
    canManage: canManage(req.ctx),
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.n])),
  });
});

// GET /api/tickets/:id
ticketsRouter.get("/:id", async (req, res) => {
  const ticket = await Ticket.findOne({ _id: req.params.id, ...visibilityFilter(req.ctx) });
  if (!ticket) return res.status(404).json({ error: "not_found", message: "Ticket not found." });
  res.json({ ticket: shape(ticket), canManage: canManage(req.ctx) });
});

const updateSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assignedToId: z.string().nullable().optional(),
  assignedToName: z.string().optional(),
});

// PATCH /api/tickets/:id — status/priority/assignment
ticketsRouter.patch("/:id", requirePerm("support"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const ticket = await Ticket.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!ticket) return res.status(404).json({ error: "not_found", message: "Ticket not found." });
  const before = shape(ticket);

  if (d.assignedToId !== undefined) {
    ticket.assignedToId = d.assignedToId || null;
    ticket.assignedToName = d.assignedToId ? d.assignedToName || "" : "";
  }
  if (d.priority) ticket.priority = d.priority;
  if (d.status) {
    ticket.status = d.status;
    if (d.status === "resolved") ticket.resolvedAt = new Date();
    if (d.status === "closed") ticket.closedAt = new Date();
    if (d.status === "open" || d.status === "in_progress") { ticket.resolvedAt = null; ticket.closedAt = null; }
  }
  await ticket.save();

  audit(req.ctx, "ticket.update", { type: "ticket", id: ticket._id, label: ticket.ticketNo }, before, shape(ticket));

  const notifyIds = [ticket.raisedBy.userId];
  if (ticket.assignedToId) notifyIds.push(ticket.assignedToId);
  await notify(req.ctx, ticket, {
    toUserIds: notifyIds,
    title: `${ticket.ticketNo} updated`,
    body: d.assignedToId !== undefined && d.assignedToName ? `Assigned to ${d.assignedToName}` : `Now ${ticket.status.replace("_", " ")}`,
  });

  res.json({ ticket: shape(ticket) });
});

const commentSchema = z.object({ body: z.string().min(1, "Write something first") });

// POST /api/tickets/:id/comments
ticketsRouter.post("/:id/comments", async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });

  const ticket = await Ticket.findOne({ _id: req.params.id, ...visibilityFilter(req.ctx) });
  if (!ticket) return res.status(404).json({ error: "not_found", message: "Ticket not found." });

  ticket.comments.push({ byId: req.ctx.userId, byName: req.ctx.actorName, body: parsed.data.body });
  await ticket.save();

  const notifyIds = [ticket.raisedBy.userId];
  if (ticket.assignedToId) notifyIds.push(ticket.assignedToId);
  await notify(req.ctx, ticket, {
    toUserIds: notifyIds,
    title: `New reply on ${ticket.ticketNo}`,
    body: parsed.data.body.slice(0, 140),
  });

  res.status(201).json({ ticket: shape(ticket) });
});

// POST /api/tickets/:id/escalate — owner/admin only, hands it to StarTrack.
ticketsRouter.post("/:id/escalate", requirePerm("settings"), async (req, res) => {
  const ticket = await Ticket.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!ticket) throw notFound("Ticket not found.");
  if (ticket.scope === "platform") throw badRequest("This ticket is already with StarTrack support.", "already_escalated");

  ticket.scope = "platform";
  ticket.escalatedAt = new Date();
  await ticket.save();
  audit(req.ctx, "ticket.escalate", { type: "ticket", id: ticket._id, label: ticket.ticketNo });
  res.json({ ticket: shape(ticket) });
});
