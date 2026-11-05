import { Router } from "express";
import mongoose from "mongoose";
import { Business } from "#modules/business/business.model.js";
import { FileDoc } from "#modules/files/fileDoc.model.js";

/**
 * GET /api/public/logo/:businessId — a business's logo, for receipts and
 * invoices opened by customers who aren't signed in. A logo is meant to be
 * seen, so this is public; the address carries a version (?v=), so each
 * version can be cached for a long time and a new logo shows straight away.
 */
export const logoPublicRouter = Router();

logoPublicRouter.get("/:businessId", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.businessId)) return res.status(404).json({ error: "not_found" });
  const business = await Business.findById(req.params.businessId).select("settings.logo").lean();
  const fileId = business?.settings?.logo?.fileId;
  if (!fileId) return res.status(404).json({ error: "not_found" });
  const file = await FileDoc.findOne({ _id: fileId, ownerType: "business_logo", businessId: req.params.businessId }).lean();
  if (!file) return res.status(404).json({ error: "not_found" });
  res.set({
    "Content-Type": file.mime,
    "Content-Length": file.size,
    "Cache-Control": req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
  });
  res.send(file.data.buffer ? Buffer.from(file.data.buffer) : file.data);
});
