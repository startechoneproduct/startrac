import mongoose from "mongoose";

/**
 * A small supporting document (a supplier's invoice, a delivery note) kept in
 * the database itself, so attaching files works with no file storage set up.
 * `ownerType` + `ownerId` say what it belongs to, e.g. a stock receipt.
 */
const fileDocSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true },
    ownerType: { type: String, required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, default: "file" },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

fileDocSchema.index({ businessId: 1, ownerType: 1, ownerId: 1 });

export const FileDoc = mongoose.model("FileDoc", fileDocSchema);

/** Photos and PDFs only, up to 3 MB: what a receipt or invoice needs, nothing that could run. */
export const DOC_MIME = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;
export const DOC_MAX_BYTES = 3 * 1024 * 1024;
