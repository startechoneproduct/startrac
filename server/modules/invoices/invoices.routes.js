import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Invoice } from "#modules/invoices/invoice.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { Business } from "#modules/business/business.model.js";
import { requirePerm, requireBranch } from "#core/middleware/tenant.js";
import { InsufficientStockError } from "#modules/inventory/inventory.service.js";
import { HttpError } from "#core/httpError.js";
import { sendMail, emailShell, esc } from "#core/mailer.js";
import { waUrl } from "#core/share.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { priceInvoice, issueInvoice, recordPayment, removePayment, voidInvoice, dueDateFor, shape, shareUrl } from "#modules/invoices/invoices.service.js";
import { businessFace } from "#modules/invoices/invoiceFace.js";
import { renderInvoicePdf } from "#modules/invoices/invoicePdf.js";
import { escapeRegex } from "#core/regex.js";

/**
 * /api/invoices — the owner's side. Anyone who may sell may draft, issue and take
 * payment on invoices; voiding or deleting a payment needs the void permission,
 * and the invoice defaults need settings access.
 */
export const invoicesRouter = Router();
invoicesRouter.use(requirePerm("sales"));

const oidStr = z.string().regex(/^[a-f\d]{24}$/i);
const reply = (res, err) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
  if (err instanceof InsufficientStockError) return res.status(409).json({ error: err.code, message: `Not enough stock to issue this invoice: ${err.message}` });
  throw err;
};
const parseDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };

const itemSchema = z.object({
  productId: oidStr.nullable().optional(),
  name: z.string().trim().max(140).optional(),
  description: z.string().trim().max(200).optional(),
  qty: z.number().positive().max(1_000_000),
  unitPrice: z.number().min(0).max(1_000_000_000).optional(),
});
const bodySchema = z.object({
  customerId: oidStr.nullable().optional(),
  customer: z.object({ name: z.string().trim().max(120).optional(), phone: z.string().trim().max(30).optional(), email: z.union([z.literal(""), z.string().trim().email().max(120)]).optional(), address: z.string().trim().max(250).optional() }).optional(),
  items: z.array(itemSchema).min(1, "Add at least one line").max(100),
  discount: z.number().min(0).optional(),
  discountPct: z.number().min(0).max(100).optional(),
  applyVat: z.boolean().default(false),
  issueDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
  terms: z.string().trim().max(1000).optional(),
});

/** The customer block: copied from the book if one was picked, else what was typed. */
async function customerBlock(ctx, d) {
  if (d.customerId) {
    const c = await Customer.findOne({ _id: d.customerId, businessId: ctx.businessId });
    if (!c) throw new HttpError(400, "invalid", "That customer isn't in your customer book.");
    return { customerId: c._id, customer: { name: c.name, phone: c.phone || "", email: c.email || "", address: c.address || "" } };
  }
  const c = d.customer || {};
  return { customerId: null, customer: { name: c.name || "", phone: c.phone || "", email: c.email || "", address: c.address || "" } };
}

async function fields(ctx, d) {
  const priced = await priceInvoice(ctx, d);
  const issueDate = parseDate(d.issueDate) || new Date();
  return {
    ...(await customerBlock(ctx, d)),
    ...priced,
    issueDate,
    dueDate: d.dueDate === null ? null : parseDate(d.dueDate) || dueDateFor(ctx, issueDate),
    notes: d.notes || "",
    terms: d.terms ?? ctx.business.settings?.invoice?.terms ?? "",
  };
}

async function load(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).json({ error: "not_found", message: "Invoice not found." }); return null; }
  const inv = await Invoice.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!inv) res.status(404).json({ error: "not_found", message: "Invoice not found." });
  return inv;
}
const out = (req, inv) => shape(inv, { url: shareUrl(req, inv) });

// ── settings (before /:id so "settings" isn't read as an id) ───────────────

invoicesRouter.get("/settings", (req, res) => {
  const s = req.ctx.business.settings || {};
  res.json({ settings: { dueDays: 14, terms: "", footer: "", bankName: "", accountName: "", accountNumber: "", ...(s.invoice?.toObject?.() || s.invoice || {}) }, vatEnabled: !!s.vatEnabled, vatRate: s.vatRate, currency: s.currency || "₦" });
});

const settingsSchema = z.object({
  dueDays: z.number().int().min(0).max(365),
  terms: z.string().trim().max(500),
  footer: z.string().trim().max(200),
  bankName: z.string().trim().max(60),
  accountName: z.string().trim().max(80),
  accountNumber: z.string().trim().max(24).regex(/^[0-9 -]*$/, "Account number can only have digits"),
});
invoicesRouter.put("/settings", requirePerm("settings"), async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  await Business.updateOne({ _id: req.ctx.businessId }, { $set: { "settings.invoice": parsed.data } });
  audit(req.ctx, "invoice.settings", { type: "business", id: req.ctx.businessId, label: req.ctx.business.name });
  res.json({ ok: true });
});

// ── list ────────────────────────────────────────────────────────────────────

// GET /api/invoices?status=all|draft|unpaid|overdue|paid|void&q=&customerId=&from=&to=&page=
invoicesRouter.get("/", async (req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const filter = { businessId: req.ctx.businessId };
  const status = String(req.query.status || "all");
  if (status === "draft" || status === "paid" || status === "void") filter.status = status;
  else if (status === "unpaid") filter.status = { $in: ["issued", "partial"] };
  else if (status === "overdue") Object.assign(filter, { status: { $in: ["issued", "partial"] }, dueDate: { $lt: today }, balance: { $gt: 0.005 } });
  if (req.query.q) {
    const q = escapeRegex(String(req.query.q).trim().slice(0, 60));
    filter.$or = [{ invoiceNo: { $regex: q, $options: "i" } }, { "customer.name": { $regex: q, $options: "i" } }];
  }
  if (req.query.customerId && mongoose.isValidObjectId(req.query.customerId)) filter.customerId = req.query.customerId;
  const from = parseDate(req.query.from), to = parseDate(req.query.to);
  if (from || to) filter.issueDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: new Date(to.getTime() + 86_400_000) } : {}) };

  const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const base = { businessId: req.ctx.businessId };
  const [rows, total, outstanding, overdue, collected, drafts] = await Promise.all([
    Invoice.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Invoice.countDocuments(filter),
    Invoice.aggregate([{ $match: { ...base, status: { $in: ["issued", "partial"] } } }, { $group: { _id: null, amount: { $sum: "$balance" }, n: { $sum: 1 } } }]),
    Invoice.aggregate([{ $match: { ...base, status: { $in: ["issued", "partial"] }, dueDate: { $lt: today }, balance: { $gt: 0.005 } } }, { $group: { _id: null, amount: { $sum: "$balance" }, n: { $sum: 1 } } }]),
    Invoice.aggregate([{ $match: { ...base, status: { $ne: "void" } } }, { $unwind: "$payments" }, { $match: { "payments.at": { $gte: monthStart } } }, { $group: { _id: null, amount: { $sum: "$payments.amount" } } }]),
    Invoice.countDocuments({ ...base, status: "draft" }),
  ]);
  res.json({
    invoices: rows.map((i) => out(req, i)), page, pages: Math.max(1, Math.ceil(total / limit)), total,
    summary: { outstanding: money(outstanding[0]?.amount || 0), outstandingCount: outstanding[0]?.n || 0, overdue: money(overdue[0]?.amount || 0), overdueCount: overdue[0]?.n || 0, collectedThisMonth: money(collected[0]?.amount || 0), drafts },
  });
});

invoicesRouter.get("/:id", async (req, res) => {
  const inv = await load(req, res);
  if (inv) res.json({ invoice: out(req, inv) });
});

// ── drafts ──────────────────────────────────────────────────────────────────

invoicesRouter.post("/", requirePerm("invoices"), requireBranch, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  try {
    const f = await fields(req.ctx, parsed.data);
    const inv = await Invoice.create({ accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId, status: "draft", createdBy: req.ctx.actorName, ...f });
    audit(req.ctx, "invoice.create", { type: "invoice", id: inv._id, label: "draft" }, undefined, { total: inv.total });
    res.status(201).json({ invoice: out(req, inv) });
  } catch (err) { reply(res, err); }
});

invoicesRouter.put("/:id", requirePerm("invoices"), async (req, res) => {
  const inv = await load(req, res);
  if (!inv) return;
  if (inv.status !== "draft") return res.status(409).json({ error: "locked", message: "Only a draft can be edited. An issued invoice has already been sent out and recorded." });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  try {
    inv.set(await fields(req.ctx, parsed.data));
    await inv.save();
    res.json({ invoice: out(req, inv) });
  } catch (err) { reply(res, err); }
});

invoicesRouter.delete("/:id", requirePerm("invoices"), async (req, res) => {
  const inv = await load(req, res);
  if (!inv) return;
  if (inv.status !== "draft") return res.status(409).json({ error: "locked", message: "Only a draft can be deleted. To cancel an issued invoice, void it." });
  await inv.deleteOne();
  res.json({ ok: true });
});

invoicesRouter.post("/:id/duplicate", requirePerm("invoices"), requireBranch, async (req, res) => {
  const inv = await load(req, res);
  if (!inv) return;
  const issueDate = new Date();
  const copy = await Invoice.create({
    accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId, status: "draft", createdBy: req.ctx.actorName,
    customerId: inv.customerId, customer: inv.customer, items: inv.items, subtotal: inv.subtotal, discount: inv.discount, vatRate: inv.vatRate, vat: inv.vat, total: inv.total,
    issueDate, dueDate: dueDateFor(req.ctx, issueDate), notes: inv.notes, terms: inv.terms,
  });
  res.status(201).json({ invoice: out(req, copy) });
});

// ── the books ───────────────────────────────────────────────────────────────

invoicesRouter.post("/:id/issue", requirePerm("invoices"), async (req, res) => {
  const inv = await load(req, res);
  if (!inv) return;
  if (!inv.customer?.name && !inv.customerId) return res.status(400).json({ error: "invalid", message: "Say who this invoice is for before issuing it." });
  try { res.json({ invoice: out(req, await issueInvoice(req.ctx, inv._id)) }); } catch (err) { reply(res, err); }
});

const paymentSchema = z.object({ method: z.enum(["cash", "pos", "transfer"]), amount: z.number().positive().max(1_000_000_000), at: z.string().optional(), note: z.string().trim().max(200).optional() });
invoicesRouter.post("/:id/payments", requirePerm("invoice_payments"), async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const inv = await load(req, res);
  if (!inv) return;
  try { res.status(201).json({ invoice: out(req, await recordPayment(req.ctx, inv._id, parsed.data)) }); } catch (err) { reply(res, err); }
});

invoicesRouter.delete("/:id/payments/:pid", requirePerm("invoices_void"), async (req, res) => {
  const inv = await load(req, res);
  if (!inv) return;
  try { res.json({ invoice: out(req, await removePayment(req.ctx, inv._id, req.params.pid)) }); } catch (err) { reply(res, err); }
});

invoicesRouter.post("/:id/void", requirePerm("invoices_void"), async (req, res) => {
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 3) return res.status(400).json({ error: "invalid", message: "Give a reason for voiding this invoice." });
  const inv = await load(req, res);
  if (!inv) return;
  try { res.json({ invoice: out(req, await voidInvoice(req.ctx, inv._id, reason)) }); } catch (err) { reply(res, err); }
});

// Notes, terms and the due date can change after issue (extending a due date is routine); money can't.
invoicesRouter.patch("/:id", requirePerm("invoices"), async (req, res) => {
  const parsed = z.object({ dueDate: z.string().optional(), notes: z.string().trim().max(1000).optional(), terms: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const inv = await load(req, res);
  if (!inv) return;
  if (inv.status === "void") return res.status(409).json({ error: "locked", message: "This invoice is void." });
  const d = parsed.data;
  if (d.dueDate !== undefined) { const due = parseDate(d.dueDate); if (!due) return res.status(400).json({ error: "invalid", message: "That due date isn't valid." }); inv.dueDate = due; }
  if (d.notes !== undefined) inv.notes = d.notes;
  if (d.terms !== undefined) inv.terms = d.terms;
  await inv.save();
  res.json({ invoice: out(req, inv) });
});

// ── sending ─────────────────────────────────────────────────────────────────


invoicesRouter.post("/:id/send", requirePerm("invoices"), async (req, res) => {
  const parsed = z.object({ via: z.enum(["whatsapp", "email", "link"]), kind: z.enum(["invoice", "reminder"]).default("invoice"), to: z.string().trim().max(120).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const inv = await load(req, res);
  if (!inv) return;
  if (inv.status === "draft") return res.status(409).json({ error: "draft", message: "Issue the invoice first, then send it." });
  if (inv.status === "void") return res.status(409).json({ error: "void", message: "This invoice is void." });
  const { via, kind } = parsed.data;
  const face = businessFace(req.ctx.business);
  const url = shareUrl(req, inv);
  const cur = face.currency;
  const fmt = (n) => `${cur}${Number(n).toLocaleString("en-NG")}`;
  const due = inv.dueDate ? inv.dueDate.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }) : "";
  const first = (inv.customer?.name || "").split(" ")[0] || "there";
  const text = kind === "reminder"
    ? `Hello ${first}, a friendly reminder from ${face.name}: invoice ${inv.invoiceNo} has ${fmt(inv.balance)} outstanding${due ? ` (it was due ${due})` : ""}. You can view it and see how to pay here: ${url}`
    : `Hello ${first}, here is invoice ${inv.invoiceNo} from ${face.name} for ${fmt(inv.total)}${due ? `, due ${due}` : ""}. View, print or download it here: ${url}`;

  let email = null;
  let to = "";
  if (via === "email") {
    to = parsed.data.to || inv.customer?.email || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return res.status(400).json({ error: "invalid", message: "Enter the email address to send it to." });
    email = await sendMail({
      to, subject: `${kind === "reminder" ? "Reminder: invoice" : "Invoice"} ${inv.invoiceNo} from ${face.name}`,
      html: emailShell({
        businessName: face.name, heading: `${kind === "reminder" ? "Payment reminder" : "Invoice"} ${inv.invoiceNo}`,
        intro: kind === "reminder" ? `${fmt(inv.balance)} is outstanding${due ? ` (due ${due})` : ""}.` : `Amount ${fmt(inv.total)}${due ? `, due ${due}` : ""}.`,
        sections: [`<p style="margin:0 0 18px"><a href="${esc(url)}" style="display:inline-block;background:#1a48cc;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">View invoice</a></p>`, `<p style="font-size:12px;color:#6b7280;word-break:break-all">${esc(url)}</p>`],
        footNote: `Sent on behalf of ${face.name}.`,
      }),
    });
  }
  // Remember what went out, but only count an email that really left.
  if (via !== "email" || email?.sent) { inv.sends.push({ via, kind, to: via === "email" ? to : inv.customer?.phone || "", by: req.ctx.actorName }); await inv.save(); }
  audit(req.ctx, "invoice.send", { type: "invoice", id: inv._id, label: inv.invoiceNo }, undefined, { via, kind });
  res.json({
    invoice: out(req, inv), text, url,
    whatsappUrl: via === "whatsapp" ? waUrl(inv.customer?.phone, text) : "",
    email: email ? { sent: !!email.sent, reason: email.sent ? "" : email.reason === "not_configured" ? "Email isn't set up on this server yet. Use the link or WhatsApp instead." : "The email couldn't be sent. Try again, or use the link." } : null,
  });
});

invoicesRouter.get("/:id/pdf", async (req, res) => {
  const inv = await load(req, res);
  if (!inv) return;
  const face = businessFace(req.ctx.business);
  const pdf = await renderInvoicePdf(shape(inv), face, face.currency);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${(inv.invoiceNo || "invoice-draft").replace(/[^\w-]/g, "")}.pdf"`);
  res.send(pdf);
});

