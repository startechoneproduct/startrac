import { FileDoc } from "#modules/files/fileDoc.model.js";

/**
 * A business's own logo, kept in the database (FileDoc) so it works on every
 * plan with no file storage set up. It is shown on receipts, invoices and the
 * app itself, and served from a public, versioned address so a printed
 * receipt or a customer's phone can load it without signing in.
 */
export const LOGO_MAX_BYTES = 200 * 1024; // the app shrinks logos before upload; this is a safety cap

// Only plain raster images: no SVG, which can carry script.
const SIGNATURES = [
  { mime: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", test: (b) => b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP" },
];

/** The real type of an image from its first bytes, or null if it isn't a PNG, JPEG or WebP. */
export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  return SIGNATURES.find((s) => s.test(buffer))?.mime || null;
}

/** Where a business's logo can be loaded from, or "" if it has none. */
export function logoUrlFor(business) {
  const logo = business?.settings?.logo;
  return logo?.fileId ? `/api/public/logo/${business._id}?v=${logo.version || 1}` : "";
}

/** Replaces a business's logo with these bytes (already checked). */
export async function saveLogo(business, buffer, mime) {
  const old = business.settings?.logo?.fileId;
  const file = await FileDoc.create({
    accountId: business.accountId, businessId: business._id, ownerType: "business_logo", ownerId: business._id,
    name: "logo", mime, size: buffer.length, data: buffer,
  });
  business.settings.logo = { fileId: file._id, mime, version: (business.settings.logo?.version || 0) + 1 };
  await business.save();
  if (old) await FileDoc.deleteOne({ _id: old, businessId: business._id });
  return logoUrlFor(business);
}

export async function removeLogo(business) {
  const old = business.settings?.logo?.fileId;
  business.settings.logo = { fileId: null, mime: "", version: (business.settings.logo?.version || 0) + 1 };
  await business.save();
  if (old) await FileDoc.deleteOne({ _id: old, businessId: business._id });
}
