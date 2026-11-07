import { planAllows } from "#shared/plans.js";

/**
 * How a business's receipts look. The saved choices are applied only as far as
 * the account's plan allows, so a business that downgrades keeps its settings
 * but gets the standard receipt back until it upgrades again.
 */
export const RECEIPT_DEFAULTS = {
  template: "classic",
  headerNote: "",
  address: "",
  phone: "",
  showTaxId: false,
  showCashier: true,
  showCustomer: true,
  showPayments: true,
  paperWidth: "80",
  textSize: "md",
};

export const RECEIPT_TEMPLATES = ["classic", "modern", "compact", "bold"];

export function savedReceipt(business) {
  const r = business?.settings?.receipt;
  return { ...RECEIPT_DEFAULTS, ...(r?.toObject ? r.toObject() : r || {}) };
}

/** What the till prints. `taxId` is filled only when the owner chose to show it. */
export function receiptDesign(business, plan) {
  // The business's own address and phone print on every plan; the Pro receipt designer can override them.
  const contact = { address: business?.settings?.address || "", phone: business?.settings?.phone || "" };
  if (!planAllows(plan, "receiptCustom")) return { ...RECEIPT_DEFAULTS, ...contact, showTaxId: undefined, taxId: "" };
  const d = savedReceipt(business);
  if (!d.address) d.address = contact.address;
  if (!d.phone) d.phone = contact.phone;
  if (!planAllows(plan, "receiptTemplates")) d.template = "classic";
  const taxId = d.showTaxId ? business.taxId || "" : "";
  delete d.showTaxId;
  return { ...d, taxId };
}
