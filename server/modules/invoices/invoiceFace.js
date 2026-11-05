/**
 * How a business presents itself on an invoice, gathered from what the owner has
 * already told StarTrack (receipt details, business page, invoice settings), so
 * nobody types their address three times. Contains nothing private: this is what
 * the customer sees on the invoice and the public link.
 */
export function businessFace(b) {
  const s = b.settings || {};
  const site = b.site?.toObject ? b.site.toObject() : b.site || {};
  const inv = s.invoice?.toObject ? s.invoice.toObject() : s.invoice || {};
  const store = site.storefront || {};
  // Bank details for invoices; fall back to the online store's, which the owner may already have entered.
  const bank = inv.accountNumber
    ? { bankName: inv.bankName || "", accountName: inv.accountName || "", accountNumber: inv.accountNumber }
    : store.accountNumber ? { bankName: store.bankName || "", accountName: store.accountName || "", accountNumber: store.accountNumber } : null;
  return {
    name: b.tradingName || b.name,
    address: s.receipt?.address || s.address || site.contact?.address || "",
    phone: s.receipt?.phone || s.phone || site.contact?.phone || "",
    email: site.contact?.email || "",
    taxId: b.taxId || "",
    accent: site.accent || "",
    logoUrl: site.logoUrl || "",
    currency: s.currency || "₦",
    footer: inv.footer || "Thank you for your business.",
    bank,
  };
}
