import mongoose from "mongoose";

/**
 * A physical count reconciled against what the system thinks is on hand —
 * the doc's "expected vs. actual" check made concrete. Opening a count
 * snapshots today's system quantity per product; closing it posts the
 * difference as ordinary ADJUST movements (via applyMovement, same as any
 * other correction) so the ledger stays the single source of truth — this
 * model just remembers the session that produced them.
 */
const stockCountSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, required: true },
    countNo: { type: String, required: true },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    lines: [
      {
        _id: false,
        productId: { type: mongoose.Schema.Types.ObjectId, required: true },
        productName: { type: String, required: true },
        unit: { type: String, default: "unit" },
        systemQty: { type: Number, required: true },
        countedQty: { type: Number, default: null },
        variance: { type: Number, default: null }, // set on close: countedQty - systemQty
        // Why this line is off (or anything worth knowing about it), kept with the count for later.
        issue: { type: String, enum: ["", "damaged", "missing", "expired", "miscount", "found", "other"], default: "" },
        comment: { type: String, default: "" },
      },
    ],
    note: { type: String, default: "" },
    closeNote: { type: String, default: "" }, // what the person closing it wants on record
    startedById: { type: mongoose.Schema.Types.ObjectId },
    startedByName: { type: String, default: "" },
    closedById: { type: mongoose.Schema.Types.ObjectId },
    closedByName: { type: String, default: "" },
    closedAt: { type: Date },
    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

stockCountSchema.index({ businessId: 1, branchId: 1, at: -1 });

export const StockCount = mongoose.model("StockCount", stockCountSchema);
