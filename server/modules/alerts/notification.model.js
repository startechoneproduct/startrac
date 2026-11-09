import mongoose from "mongoose";

/**
 * A thing the business needs to know about.
 *
 * The important idea: a notification represents a CONDITION, not an event.
 * "Bournvita is below its reorder level" is one notification that stays open
 * until the shelf is refilled — not a new one on every sale that nudges it
 * further down. That distinction is what stops an alert system becoming noise
 * people learn to ignore, and it is enforced by `dedupeKey`.
 *
 * Lifecycle:
 *   open      — the condition is true and nobody has acknowledged it
 *   dismissed — a human said "I know", explicitly
 *   resolved  — the condition stopped being true; closed automatically
 */
const notificationSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // null = concerns the whole business rather than one branch.
    branchId: { type: mongoose.Schema.Types.ObjectId, default: null },

    type: {
      type: String,
      required: true,
      enum: ["stock_out", "stock_low", "expired", "expiry_soon", "return_pending", "undo_pending", "perm_changed", "ticket_update", "help_update", "membership_expiring", "online_order"],
    },
    severity: { type: String, enum: ["info", "warning", "critical"], default: "info" },

    title: { type: String, required: true },
    body: { type: String, default: "" },

    // What the notification is about, so the UI can deep-link to it.
    target: {
      type: { type: String, default: "" }, // product | return | staff
      id: { type: mongoose.Schema.Types.ObjectId },
      label: { type: String, default: "" },
    },

    // Identity of the condition. Raising the same key again updates the
    // existing row instead of adding another. Unique per business.
    dedupeKey: { type: String, required: true },

    status: { type: String, enum: ["open", "dismissed", "resolved"], default: "open" },

    // Free-form supporting numbers (stock, reorderLevel, daysToExpiry…) so the
    // UI can render a specific message without re-querying.
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Only relevant to a specific person (a permission grant, say).
    forUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
    readBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },

    emailedAt: { type: Date, default: null },
    lastRaisedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
    dismissedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    dismissedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The dedupe guarantee itself.
notificationSchema.index({ businessId: 1, dedupeKey: 1 }, { unique: true });
// The bell's query: this business's open items, newest first.
notificationSchema.index({ businessId: 1, status: 1, createdAt: -1 });
// The digest's query: open and not yet emailed.
notificationSchema.index({ businessId: 1, status: 1, emailedAt: 1 });

export const Notification = mongoose.model("Notification", notificationSchema);
