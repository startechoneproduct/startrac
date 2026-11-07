import crypto from "node:crypto";
import { config } from "#core/config.js";
import { publicBase } from "#core/share.js";
import { receiptDesign } from "#modules/business/receiptDesign.js";
import { logoUrlFor } from "#modules/business/logo.js";
import { planAllows } from "#shared/plans.js";

/**
 * The receipt a customer is given: built in one place for the till, for a
 * reprint from Sales History, and for the link they open on their phone.
 */

export function buildReceipt({ business, plan, sale, customerPhone = "", tendered, change }) {
  return {
    saleNo: sale.saleNo,
    businessName: business.name,
    // Printing the logo on receipts is a Business plan feature; everyone sees their logo in the app.
    logoUrl: planAllows(plan, "receiptLogo") ? logoUrlFor(business) : "",
    at: sale.at,
    staffName: sale.staffName,
    customerName: sale.customerName,
    customerPhone,
    items: sale.items.map((l) => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, lineNet: l.lineNet })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    vat: sale.vat,
    total: sale.total,
    payments: sale.payments,
    tendered,
    change,
    footer: business.settings?.receiptFooter,
    currency: business.settings?.currency,
    design: receiptDesign(business, plan),
  };
}

// ── the link ────────────────────────────────────────────────────────────────
// No token is stored: the link is the sale's id plus a signature only this
// server can make, so it can't be guessed and old sales can be shared at once.

const sign = (saleId) => crypto.createHmac("sha256", `${config.jwtSecret}::receipt`).update(String(saleId)).digest("hex").slice(0, 24);

export const receiptToken = (saleId) => `${saleId}${sign(saleId)}`;

/** The sale id inside a genuine token, or null. */
export function saleIdFromToken(token) {
  if (!/^[a-f0-9]{48}$/.test(String(token))) return null;
  const id = token.slice(0, 24), sig = Buffer.from(token.slice(24));
  const want = Buffer.from(sign(id));
  return sig.length === want.length && crypto.timingSafeEqual(sig, want) ? id : null;
}

export const receiptUrl = (req, saleId) => `${publicBase(req)}/r/${receiptToken(saleId)}`;

/** The WhatsApp wording. A link, not a wall of text: the customer opens a proper receipt. */
export function receiptMessage(receipt, url) {
  const cur = receipt.currency || "₦";
  const money = (n) => `${cur}${/[A-Za-z]$/.test(cur) ? " " : ""}${Number(n).toLocaleString("en-NG")}`;
  const first = (receipt.customerName || "").split(" ")[0];
  return `Hello${first ? ` ${first}` : ""}, thank you for shopping at ${receipt.businessName}. Your receipt ${receipt.saleNo} (${money(receipt.total)}): ${url}`;
}
