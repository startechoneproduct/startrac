import mongoose from "mongoose";

/**
 * One delivery, received in one go: a goods received note (GRN). The stock
 * itself moves through the ledger as usual (one IN movement per line, each
 * pointing back here with refType "stock_receipt"); this record keeps the
 * delivery together so it can be looked up, printed and checked against the
 * supplier's invoice.
 */
const lineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, default: "" },
    qty: { type: Number, required: true }, // in the product's stock unit
    unitCost: { type: Number, default: null }, // what this delivery cost per unit, if given
    lineCost: { type: Number, default: null },
    stockAfter: { type: Number, default: 0 },
  },
  { _id: false }
);

const stockReceiptSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, required: true },
    receiptNo: { type: String, required: true }, // GRN-0001, per business
    supplierId: { type: mongoose.Schema.Types.ObjectId, default: null },
    supplierName: { type: String, default: "" },
    receivedOn: { type: String, required: true }, // YYYY-MM-DD, the day the goods arrived
    reference: { type: String, default: "" }, // the supplier's invoice or delivery note number
    note: { type: String, default: "" },
    lines: [lineSchema],
    totalQty: { type: Number, default: 0 },
    totalCost: { type: Number, default: null }, // only when every line had a cost
    costedLines: { type: Number, default: 0 },
    attachments: [{ _id: false, id: mongoose.Schema.Types.ObjectId, name: String, mime: String, size: Number }],
    source: { type: String, enum: ["form", "spreadsheet"], default: "form" },
    actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    actorName: { type: String, default: "" },
  },
  { timestamps: true }
);

stockReceiptSchema.index({ businessId: 1, branchId: 1, createdAt: -1 });

export const StockReceipt = mongoose.model("StockReceipt", stockReceiptSchema);
