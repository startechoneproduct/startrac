import { Notification } from "#modules/alerts/notification.model.js";
import { escapeRegex } from "#core/regex.js";

// A dismissed alert should not pop back the moment the same condition ticks
// again — but it MUST come back if things got worse. Ranking severity lets
// "low stock, I know" stay quiet while "now actually out of stock" reopens.
const RANK = { info: 0, warning: 1, critical: 2 };

/**
 * Raises a condition, or refreshes it if already known.
 *
 * Returns the notification, plus `isNew` so callers can decide whether it is
 * worth telling anyone. Dedupe is by `dedupeKey` within the business.
 */
export async function raise(
  { accountId, businessId, branchId = null },
  { type, severity = "info", title, body = "", target, dedupeKey, data = {}, forUserId = null }
) {
  const existing = await Notification.findOne({ businessId, dedupeKey });

  if (existing) {
    const escalated = RANK[severity] > RANK[existing.severity];
    // A resolved condition that has come back is news again.
    const returned = existing.status === "resolved";
    // The condition can change kind as well as urgency — "running low" becomes
    // "out of stock" on the same dedupe key, and the type must follow or the
    // UI shows the wrong icon and sends the reader to the wrong page.
    existing.type = type;
    existing.severity = severity;
    existing.title = title;
    existing.body = body;
    existing.data = data;
    existing.lastRaisedAt = new Date();
    if (escalated || returned) {
      existing.status = "open";
      existing.resolvedAt = null;
      existing.dismissedAt = null;
      existing.dismissedBy = null;
      existing.readBy = [];
      existing.emailedAt = null; // worth an email again
    }
    await existing.save();
    return { notification: existing, isNew: escalated || returned };
  }

  const notification = await Notification.create({
    accountId, businessId, branchId,
    type, severity, title, body,
    target: target || {},
    dedupeKey, data, forUserId,
  });
  return { notification, isNew: true };
}

/**
 * Closes a condition that stopped being true — the shelf was refilled, the
 * return was decided, the expiring batch was sold. Silent by design: nobody
 * needs an alert telling them a problem went away.
 */
export async function resolve(businessId, dedupeKey) {
  await Notification.updateOne(
    { businessId, dedupeKey, status: { $ne: "resolved" } },
    { $set: { status: "resolved", resolvedAt: new Date() } }
  );
}

/** Closes every open condition whose key starts with a prefix. */
export async function resolveByPrefix(businessId, prefix) {
  await Notification.updateMany(
    { businessId, dedupeKey: { $regex: `^${escapeRegex(prefix)}` }, status: { $ne: "resolved" } },
    { $set: { status: "resolved", resolvedAt: new Date() } }
  );
}

export const keys = {
  stock: (branchId, productId) => `stock:${branchId}:${productId}`,
  expiry: (branchId, productId, expiryISO, threshold) => `expiry:${branchId}:${productId}:${expiryISO}:${threshold}`,
  expiryPrefix: (branchId, productId) => `expiry:${branchId}:${productId}:`,
  returnPending: (returnId) => `return:${returnId}`,
  undoPending: (saleId) => `undo:${saleId}`,
  permChanged: (userId, stamp) => `perm:${userId}:${stamp}`,
  // A comment/assignment is discrete news, not a resuming condition — the
  // stamp keeps every one its own dedupeKey instead of collapsing into one
  // row that just gets refreshed, the same trick permChanged above uses.
  ticketUpdate: (ticketId, stamp) => `ticket:${ticketId}:${stamp}`,
  // Same per-instance-date shape as expiry() above: the key changes when
  // the expiry date does (a renewal), so a stale reminder naturally stops
  // matching and gets resolved rather than silently kept alive.
  membershipExpiring: (subscriptionId, expiryISO) => `membership:${subscriptionId}:${expiryISO}`,
  membershipExpiringPrefix: (subscriptionId) => `membership:${subscriptionId}:`,
};
