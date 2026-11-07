import mongoose from "mongoose";

// Header + lines in one document. Discounts and VAT live on the header;
// line totals are net. Voided sales are kept and flagged — never deleted.
const saleSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, required: true },
    saleNo: { type: String, required: true }, // human receipt number, per-branch sequence
    at: { type: Date, default: Date.now },
    staffId: { type: mongoose.Schema.Types.ObjectId, required: true }, // userId of seller
    staffName: { type: String, default: "" },
    customerId: { type: mongoose.Schema.Types.ObjectId },
    customerName: { type: String, default: "" },
    // "online" = placed on the business's web page and confirmed by the owner;
    // everything else is a till sale. orderId/orderNo point back at the order.
    channel: { type: String, enum: ["pos", "online", "import", "invoice"], default: "pos" },
    // Set on the sale an issued invoice records (channel "invoice").
    invoiceId: { type: mongoose.Schema.Types.ObjectId },
    // Set on sales that came from an uploaded history file (see modules/imports/).
    importBatchId: { type: mongoose.Schema.Types.ObjectId },
    orderId: { type: mongoose.Schema.Types.ObjectId },
    orderNo: { type: String },
    // Flat delivery charge, already inside `total`.
    deliveryFee: { type: Number, default: 0 },
    items: [
      {
        _id: false,
        productId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
        // Not "min: 1" — a coldroom sale can be a fraction of a carton (0.5)
        // or a kg weight under 1 (0.3kg of fish), both legitimate quantities
        // for that trade's own sale endpoint (see coldroom.routes.js's
        // /sales). Every other checkout path already only ever sends whole
        // units, so relaxing the floor changes nothing for them.
        qty: { type: Number, required: true, min: 0.001 },
        unitPrice: { type: Number, required: true },
        lineCost: { type: Number, default: 0 }, // qty * unit cost at time of sale
        lineNet: { type: Number, required: true }, // qty * unitPrice
        returnedQty: { type: Number, default: 0 }, // maintained by the returns module
        // Made-to-order lines: the order's dimensions and the exact
        // components consumed (void restores THESE, not the MTO product).
        width: { type: Number },
        height: { type: Number },
        // Set only when the selling business has the kitchenQueue capability
        // (restaurant) — see server/modules/businesses/restaurant/. Every
        // other business type's line never gets this field at all.
        prepStatus: { type: String, enum: ["pending", "preparing", "ready", "served"] },
        components: [
          {
            _id: false,
            productId: { type: mongoose.Schema.Types.ObjectId, required: true },
            name: { type: String, required: true },
            qty: { type: Number, required: true },
          },
        ],
      },
    ],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    vat: { type: Number, default: 0 },
    total: { type: Number, required: true },
    payments: [
      {
        _id: false,
        // "credit" is the "credit" capability (coldroom today) — a sale
        // settled against the customer's running balance instead of cash in
        // hand. It's never offered by the generic checkout's own validation;
        // only a business-vertical sale endpoint that checks hasCapability()
        // itself constructs one. See customerLedger.model.js for the ledger
        // it posts to, and sales.routes.js's void handler for the reversal.
        method: { type: String, enum: ["cash", "pos", "transfer", "credit", "store_credit"], required: true },
        amount: { type: Number, required: true },
      },
    ],
    // Cash handed over and given back. Recorded for the till count at close
    // of day — the payments array stays the record of what the sale was PAID,
    // which is what the books care about.
    tendered: { type: Number, default: 0 },
    change: { type: Number, default: 0 },
    status: { type: String, enum: ["completed", "voided"], default: "completed" },
    voidInfo: {
      by: { type: mongoose.Schema.Types.ObjectId },
      byName: { type: String },
      reason: { type: String },
      at: { type: Date },
    },
    clientSaleId: { type: String }, // offline-queue idempotency key
    // Set only on payments taken by a service business (academy fees, salon
    // appointments, agency project payments — see server/modules/services/).
    // Their lines have no real product behind them, so the stock-based void
    // and return flows must not touch them: they are reversed through the
    // owning record instead.
    service: {
      kind: { type: String, enum: ["academy", "salon", "agency"] },
      refId: { type: mongoose.Schema.Types.ObjectId },
    },
  },
  { timestamps: true }
);

saleSchema.index({ businessId: 1, branchId: 1, at: -1 });
saleSchema.index({ businessId: 1, saleNo: 1 });
saleSchema.index({ businessId: 1, customerId: 1, at: -1 });
saleSchema.index({ businessId: 1, staffId: 1, at: -1 });
saleSchema.index({ businessId: 1, channel: 1, at: -1 });
saleSchema.index({ importBatchId: 1 }, { sparse: true });
saleSchema.index(
  { businessId: 1, clientSaleId: 1 },
  { unique: true, partialFilterExpression: { clientSaleId: { $type: "string" } } }
);

export const Sale = mongoose.model("Sale", saleSchema);
