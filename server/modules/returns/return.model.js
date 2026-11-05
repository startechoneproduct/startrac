import mongoose from "mongoose";

// Staff submit, managers/admins approve. Approval restores stock via a
// RETURN movement and corrects revenue/cost in the daily metrics.
const returnSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, required: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, required: true },
    saleNo: { type: String, default: "" },
    returnNo: { type: String, default: "" }, // RTN-0001, per business
    customerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    customerName: { type: String, default: "" },
    items: [
      {
        _id: false,
        productId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
        qty: { type: Number, required: true, min: 1 },
        unitPrice: { type: Number, required: true }, // from the original sale line
        unitCost: { type: Number, default: 0 },
        // Custom-made items refund money but can't restock (the fabric is cut).
        restock: { type: Boolean, default: true },
        // good: back on the shelf. damaged: recorded, never put back in stock;
        // its cost is written off as waste when the return is approved.
        condition: { type: String, enum: ["good", "damaged"], default: "good" },
      },
    ],
    refund: {
      // store_credit: the money goes onto the customer's account to spend later, instead of out of the till.
      method: { type: String, enum: ["cash", "pos", "transfer", "store_credit"], default: "cash" },
      amount: { type: Number, required: true },
    },
    reasonType: { type: String, enum: ["defective", "wrong_item", "damaged", "not_wanted", "expired", "other"], default: "other" },
    reason: { type: String, default: "" }, // the comment
    // What the customer gets: their money back, credit to spend later, or another item (credit spent on the replacement).
    outcome: { type: String, enum: ["refund", "store_credit", "exchange"], default: "refund" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    requestedByName: { type: String, default: "" },
    decidedBy: { type: mongoose.Schema.Types.ObjectId },
    decidedByName: { type: String, default: "" },
    decidedAt: { type: Date },
    decisionNote: { type: String, default: "" },
  },
  { timestamps: true }
);

returnSchema.index({ businessId: 1, branchId: 1, status: 1, createdAt: -1 });

export const Return = mongoose.model("Return", returnSchema);
