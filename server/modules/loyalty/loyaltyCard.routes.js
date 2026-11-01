import { Router } from "express";
import { z } from "zod";
import { LoyaltyCard } from "#modules/loyalty/loyaltyCard.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { requirePerm } from "#core/middleware/tenant.js";
import { audit } from "#core/audit.js";
import { notFound } from "#core/httpError.js";
import { sendLoyaltyCardEmail, loyaltyCardUrl } from "#modules/loyalty/loyaltyCard.service.js";

export const loyaltyCardRouter = Router();

const scanSchema = z.object({ code: z.string().min(10) });

/**
 * POST /api/loyalty-cards/scan — resolves a scanned code to the discount it
 * carries. Applies nothing itself: the POS applies the returned discount to
 * the cart exactly like a manually-entered one, so no sale-creation schema
 * change was needed for this feature at all.
 */
loyaltyCardRouter.post("/scan", requirePerm("sales"), async (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: "That doesn't look like a loyalty code." });

  const card = await LoyaltyCard.findOne({ businessId: req.ctx.businessId, code: parsed.data.code, status: "active" });
  if (!card) throw notFound("That loyalty card isn't recognised here.", "not_found");

  const customer = await Customer.findById(card.customerId);
  if (!customer) throw notFound("The customer for this card no longer exists.", "not_found");

  card.lastScannedAt = new Date();
  card.scanCount += 1;
  await card.save();

  const rule = req.ctx.business.settings?.loyaltyRule;
  audit(req.ctx, "loyaltyCard.scan", { type: "loyaltyCard", id: card._id, label: customer.name });

  res.json({
    customerId: customer._id,
    customerName: customer.name,
    discountType: rule?.discountType || "percent",
    discountValue: rule?.discountValue || 0,
  });
});

// GET /api/loyalty-cards/:customerId — card detail for a customer profile view.
loyaltyCardRouter.get("/:customerId", requirePerm("customers"), async (req, res) => {
  const card = await LoyaltyCard.findOne({ businessId: req.ctx.businessId, customerId: req.params.customerId, status: "active" });
  if (!card) return res.json({ card: null });
  res.json({
    card: {
      id: card._id, code: card.code, status: card.status, issuedAt: card.issuedAt,
      issuedVia: card.issuedVia, lastScannedAt: card.lastScannedAt, scanCount: card.scanCount,
      url: loyaltyCardUrl(req, card.code),
    },
  });
});

const emailSchema = z.object({ to: z.string().email("Enter a valid email address") });

// POST /api/loyalty-cards/:customerId/email — a customer never HAS an email
// on file (see Customer model), so this is always a one-off address a staff
// member types in on the spot, not something pulled from CRM data.
loyaltyCardRouter.post("/:customerId/email", requirePerm("customers"), async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });

  const [card, customer] = await Promise.all([
    LoyaltyCard.findOne({ businessId: req.ctx.businessId, customerId: req.params.customerId, status: "active" }),
    Customer.findOne({ _id: req.params.customerId, businessId: req.ctx.businessId }),
  ]);
  if (!card || !customer) return res.status(404).json({ error: "not_found", message: "This customer has no active loyalty card." });

  const result = await sendLoyaltyCardEmail({
    to: parsed.data.to,
    customerName: customer.name,
    businessName: req.ctx.business.name,
    cardUrl: loyaltyCardUrl(req, card.code),
  });
  res.json({ sent: result.sent, reason: result.sent ? undefined : result.reason });
});
