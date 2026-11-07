import { Business, alertRecipients } from "#modules/business/business.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { Return } from "#modules/returns/return.model.js";
import { Notification } from "#modules/alerts/notification.model.js";
import { raise, resolve, resolveByPrefix, keys } from "#modules/alerts/notify.js";
import { sendMail, emailShell, alertRow, mailEnabled, esc } from "#core/mailer.js";
import { ownerOf, realEmail } from "#core/ownerMail.js";
import { runBillingNotices } from "#modules/billing/billingNotices.js";
import { sendSms } from "#core/sms.js";
import { config } from "#core/config.js";
import { aiEnabled } from "#core/ai.js";
import { generateDigest } from "#modules/ai/ai.service.js";
import { hasCapability } from "#shared/businessTypes.js";
import { businessHasFeature } from "#core/plan.js";
import { GymSubscription } from "#modules/businesses/gym/gymSubscription.model.js";
import { Customer } from "#modules/customers/customer.model.js";

const DAY = 86_400_000;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const iso = (d) => new Date(d).toISOString().slice(0, 10);

// ── Stock ────────────────────────────────────────────────────────────

/**
 * Re-evaluates stock alerts for the products a movement just touched.
 *
 * Deliberately called AFTER the sale's transaction commits, not inside it:
 * a rolled-back sale must not leave an alert behind, and an alert failing
 * must never be able to fail a sale. It is also why this never throws.
 *
 * "Low" and "out" share one dedupe key, so a product sliding from low to out
 * escalates the existing alert instead of raising a competing second one —
 * the legacy app emailed on every single sale that touched a low product.
 */
export async function afterStockChange(ctx, branchId, productIds) {
  try {
    if (!branchId || !productIds?.length) return;
    const business = ctx.business || (await Business.findById(ctx.businessId));
    const prefs = business?.settings?.alerts || {};
    if (prefs.lowStock === false && prefs.outOfStock === false) return;

    const ids = [...new Set(productIds.map(String))];
    const [products, levels, branch] = await Promise.all([
      Product.find({ _id: { $in: ids }, businessId: ctx.businessId }).select("name reorderLevel archetype status"),
      Inventory.find({ branchId, productId: { $in: ids } }).select("productId stock"),
      Branch.findById(branchId).select("name"),
    ]);
    const stockBy = new Map(levels.map((l) => [String(l.productId), l.stock]));
    const where = branch?.name ? ` at ${branch.name}` : "";

    let urgent = false;
    for (const p of products) {
      // Made-to-order items hold no stock of their own — their components do.
      if (p.archetype === "made_to_order" || p.status !== "active") continue;
      const stock = stockBy.get(String(p._id)) ?? 0;
      const key = keys.stock(branchId, p._id);
      const reorder = p.reorderLevel ?? 0;

      if (stock <= 0 && prefs.outOfStock !== false) {
        const { isNew } = await raise(
          { accountId: ctx.accountId, businessId: ctx.businessId, branchId },
          {
            type: "stock_out",
            severity: "critical",
            title: `${p.name} is out of stock`,
            body: `There is none left${where}. Restock before it costs you sales.`,
            target: { type: "product", id: p._id, label: p.name },
            dedupeKey: key,
            data: { stock, reorderLevel: reorder, branchName: branch?.name || "" },
          }
        );
        if (isNew) urgent = true;
      } else if (stock > 0 && stock <= reorder && prefs.lowStock !== false) {
        await raise(
          { accountId: ctx.accountId, businessId: ctx.businessId, branchId },
          {
            type: "stock_low",
            severity: "warning",
            title: `${p.name} is running low`,
            body: `${stock} left${where} — reorder level is ${reorder}.`,
            target: { type: "product", id: p._id, label: p.name },
            dedupeKey: key,
            data: { stock, reorderLevel: reorder, branchName: branch?.name || "" },
          }
        );
      } else {
        // Back above the line — close it quietly.
        await resolve(ctx.businessId, key);
      }
    }
    if (urgent && business) digestSoon(business);
  } catch (err) {
    console.error("stock alert check failed:", err.message);
  }
}

/**
 * Re-evaluates stock alerts for a whole business.
 *
 * The per-movement check only fires when something moves. A shelf that ran
 * low and then sat untouched — or stock loaded outside the app — would never
 * raise anything, so the scheduled sweep re-checks every level as well.
 */
export async function scanStock(business) {
  const prefs = business.settings?.alerts || {};
  if (prefs.lowStock === false && prefs.outOfStock === false) return { checked: 0 };

  const branches = await Branch.find({ businessId: business._id }).select("_id");
  const ctx = { accountId: business.accountId, businessId: business._id, business };
  let checked = 0;
  for (const b of branches) {
    const levels = await Inventory.find({ businessId: business._id, branchId: b._id }).select("productId");
    if (!levels.length) continue;
    await afterStockChange(ctx, b._id, levels.map((l) => l.productId));
    checked += levels.length;
  }
  return { checked };
}

// ── Expiry ───────────────────────────────────────────────────────────

// One alert per product per expiry date, escalating as the date nears, so a
// single tin of milk cannot generate four separate unread items.
function expiryTier(days, thresholds) {
  const sorted = [...thresholds].sort((a, b) => a - b); // e.g. [7, 14, 30]
  const hit = sorted.find((t) => days <= t);
  if (hit === undefined) return null;
  const idx = sorted.indexOf(hit);
  // Nearest threshold is the most urgent one.
  return { threshold: hit, severity: idx === 0 ? "critical" : idx === 1 ? "warning" : "info" };
}

/**
 * Scans one business's stock for anything expiring or already expired.
 * Products with no stock left are skipped, and any alert they had is closed —
 * the legacy app's `_autoDismissExpiryAlerts`, but automatic rather than
 * something the caller has to remember to invoke.
 */
export async function scanExpiry(business) {
  const prefs = business.settings?.alerts || {};
  if (prefs.expiry === false) return { raised: 0, resolved: 0 };
  const thresholds = prefs.expiryDays?.length ? prefs.expiryDays : [30, 14, 7];
  const maxDays = Math.max(...thresholds);

  const products = await Product.find({
    businessId: business._id,
    status: "active",
    expiry: { $ne: null, $exists: true },
  }).select("name expiry");
  if (!products.length) return { raised: 0, resolved: 0 };

  const byId = new Map(products.map((p) => [String(p._id), p]));
  const levels = await Inventory.find({
    businessId: business._id,
    productId: { $in: [...byId.keys()] },
  }).select("productId branchId stock");
  const branches = await Branch.find({ businessId: business._id }).select("name");
  const branchName = new Map(branches.map((b) => [String(b._id), b.name]));

  const today = startOfToday();
  let raised = 0, resolved = 0;

  for (const lvl of levels) {
    const p = byId.get(String(lvl.productId));
    if (!p) continue;
    const prefix = keys.expiryPrefix(lvl.branchId, lvl.productId);

    // Sold out, or expiry cleared — nothing to warn about any more.
    if (lvl.stock <= 0 || !p.expiry) {
      await resolveByPrefix(business._id, prefix);
      resolved++;
      continue;
    }

    const days = Math.floor((new Date(p.expiry).setHours(0, 0, 0, 0) - today) / DAY);
    const where = branchName.get(String(lvl.branchId)) ? ` at ${branchName.get(String(lvl.branchId))}` : "";
    const base = { accountId: business.accountId, businessId: business._id, branchId: lvl.branchId };

    if (days < 0) {
      // Expired is a different condition from "expiring", not a louder one —
      // it gets its own key so acknowledging the warning doesn't silence it.
      await raise(base, {
        type: "expired",
        severity: "critical",
        title: `${p.name} has expired`,
        body: `${lvl.stock} in stock${where}, expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago on ${iso(p.expiry)}. Pull it off the shelf.`,
        target: { type: "product", id: p._id, label: p.name },
        dedupeKey: `${prefix}${iso(p.expiry)}:expired`,
        data: { stock: lvl.stock, expiry: iso(p.expiry), days, branchName: branchName.get(String(lvl.branchId)) || "" },
      });
      raised++;
      continue;
    }

    if (days > maxDays) {
      await resolveByPrefix(business._id, prefix);
      continue;
    }

    const tier = expiryTier(days, thresholds);
    if (!tier) continue;
    await raise(base, {
      type: "expiry_soon",
      severity: tier.severity,
      title: `${p.name} expires in ${days} day${days === 1 ? "" : "s"}`,
      body: `${lvl.stock} in stock${where}, expiring ${iso(p.expiry)}. Discount it or move it while it still sells.`,
      target: { type: "product", id: p._id, label: p.name },
      dedupeKey: `${prefix}${iso(p.expiry)}`,
      data: { stock: lvl.stock, expiry: iso(p.expiry), days, threshold: tier.threshold, branchName: branchName.get(String(lvl.branchId)) || "" },
    });
    raised++;
  }

  return { raised, resolved };
}

// ── Gym membership renewals ──────────────────────────────────────────

/**
 * Mirrors scanExpiry's shape above, applied to GymSubscription instead of
 * Product — same escalate/resolve-by-prefix rhythm, just one threshold
 * (the owner's configured renewalReminderDays) instead of stock's several.
 * Only businesses with the "memberships" capability have anything to scan.
 */
export async function scanGymExpiries(business) {
  if (!hasCapability(business.typeKey, "memberships")) return { raised: 0, resolved: 0 };

  const cfg = business.settings?.gym || {};
  const reminderDays = cfg.renewalReminderDays ?? 3;
  const now = new Date();

  // Keeps `status` honest for every other query (front-desk roster,
  // check-in) instead of leaving it to a lazy compute at read time.
  await GymSubscription.updateMany(
    { businessId: business._id, status: "active", expiresAt: { $lt: now } },
    { $set: { status: "expired" } }
  );

  const active = await GymSubscription.find({ businessId: business._id, status: "active" })
    .select("customerId customerName planName expiresAt branchId");
  if (!active.length) return { raised: 0, resolved: 0 };

  let raised = 0, resolved = 0;
  for (const sub of active) {
    const prefix = keys.membershipExpiringPrefix(sub._id);
    const days = Math.ceil((sub.expiresAt - now) / DAY);

    if (days > reminderDays) {
      // Renewed past the window, or simply not due yet — any reminder tied
      // to an earlier expiry date on this subscription is stale now.
      await resolveByPrefix(business._id, prefix);
      resolved++;
      continue;
    }

    const { isNew } = await raise(
      { accountId: business.accountId, businessId: business._id, branchId: sub.branchId },
      {
        type: "membership_expiring",
        severity: days <= 0 ? "critical" : "warning",
        title: `${sub.customerName}'s membership expires ${days <= 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
        body: `${sub.planName} plan, expires ${iso(sub.expiresAt)}. Remind them to renew.`,
        target: { type: "gymSubscription", id: sub._id, label: sub.customerName },
        dedupeKey: keys.membershipExpiring(sub._id, iso(sub.expiresAt)),
        data: { customerName: sub.customerName, planName: sub.planName, expiresAt: iso(sub.expiresAt), days },
      }
    );
    raised++;

    // Member-facing SMS, distinct from the owner-facing Notification above
    // (the point here is nudging the MEMBER to come back) — opt-in, and
    // only on the first raise of this particular reminder, not every sweep.
    if (isNew && cfg.smsReminders) {
      const customer = await Customer.findById(sub.customerId).select("phone whatsapp");
      const phone = customer?.phone || customer?.whatsapp;
      if (phone) {
        await sendSms({
          to: phone,
          message: `Hi ${sub.customerName}, your ${business.name} membership expires ${iso(sub.expiresAt)}. Renew to keep your access.`,
        }).catch(() => {});
      }
    }
  }

  return { raised, resolved };
}

// ── Returns waiting on a manager ─────────────────────────────────────

export async function raiseReturnPending(ctx, ret) {
  try {
    const prefs = ctx.business?.settings?.alerts || {};
    if (prefs.pendingReturns === false) return;
    await raise(
      { accountId: ctx.accountId, businessId: ctx.businessId, branchId: ret.branchId },
      {
        type: "return_pending",
        severity: "warning",
        title: `Return on ${ret.saleNo} needs a decision`,
        body: `${ret.requestedByName} submitted a return worth ${ret.refund.amount}. Reason: ${ret.reason}`,
        target: { type: "return", id: ret._id, label: ret.saleNo },
        dedupeKey: keys.returnPending(ret._id),
        data: { amount: ret.refund.amount, saleNo: ret.saleNo, requestedBy: ret.requestedByName },
      }
    );
  } catch (err) {
    console.error("return alert failed:", err.message);
  }
}

export async function resolveReturnPending(businessId, returnId) {
  await resolve(businessId, keys.returnPending(returnId)).catch(() => {});
}

// ── Digest email ─────────────────────────────────────────────────────

const TYPE_ORDER = { stock_out: 0, expired: 1, stock_low: 2, expiry_soon: 3, return_pending: 4, perm_changed: 5 };

/**
 * Who hears about alerts: the addresses the owner listed in Settings. If none are
 * listed, the owner's own email, so a new shop gets its stock alerts without
 * having to find that setting first.
 */
async function digestRecipients(business) {
  const listed = alertRecipients(business);
  if (listed.length) return listed;
  const owner = await ownerOf(business.accountId);
  return owner && realEmail(owner.email) ? [owner.email.toLowerCase()] : [];
}

// Something urgent (an item just ran out) shouldn't sit until the next sweep. A short wait gathers
// whatever else came up at the same time, and one email goes out. One pending wait per business.
const digestTimers = new Map();
export function digestSoon(business) {
  const key = String(business._id);
  const delay = config.alertDigestDelayMs;
  if (!mailEnabled() || !(delay > 0) || digestTimers.has(key)) return;
  const t = setTimeout(async () => {
    digestTimers.delete(key);
    try {
      const fresh = await Business.findById(key);
      if (fresh) await sendDigest(fresh);
    } catch (err) {
      console.error("quick alert email failed:", err.message);
    }
  }, delay);
  t.unref?.();
  digestTimers.set(key, t);
}

/**
 * Emails everything raised since the last digest as ONE message.
 *
 * The legacy app sent a separate email per alert, which meant a busy Saturday
 * could produce dozens and the owner stopped reading any of them. One message
 * per sweep, ordered worst-first, is the whole improvement.
 */
export async function sendDigest(business) {
  if (!mailEnabled()) return { sent: false, reason: "not_configured" };
  if (business.settings?.alerts?.email === false) return { sent: false, reason: "disabled" };
  const to = await digestRecipients(business);
  if (!to.length) return { sent: false, reason: "no_recipients" };

  const pending = await Notification.find({
    businessId: business._id,
    status: "open",
    emailedAt: null,
    // Personal ones go to the person, and a new online order is emailed the moment it arrives.
    type: { $nin: ["perm_changed", "ticket_update", "help_update", "online_order"] },
  }).sort({ severity: -1, createdAt: 1 });
  if (!pending.length) return { sent: false, reason: "nothing_new" };

  const sorted = [...pending].sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));
  const critical = sorted.filter((n) => n.severity === "critical").length;

  // AI narrative — only ever piggybacked onto an email already going out
  // (we're past the "nothing new" return above), never a second send of its
  // own. An owner-level ctx: this runs from the background sweep, not a
  // logged-in request, and whoever gets this digest already opted in via
  // settings.alertEmails.
  const aiSections = [];
  if (business.settings?.ai?.digestEnabled && aiEnabled() && (await businessHasFeature(business, "ai"))) {
    const digest = await generateDigest({ accountId: business.accountId, businessId: business._id, branchId: null, perms: ["*"] });
    if (digest.ok) {
      aiSections.push(
        `<div style="background:#f0f4ff;border:1px solid #c7d6ff;border-radius:8px;padding:14px 16px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#1a48cc;margin-bottom:6px">AI summary</div>
          <div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-line">${esc(digest.narrative)}</div>
        </div>`
      );
    }
  }

  const html = emailShell({
    businessName: business.name,
    heading:
      critical > 0
        ? `${critical} thing${critical === 1 ? "" : "s"} need${critical === 1 ? "s" : ""} attention now`
        : `${sorted.length} update${sorted.length === 1 ? "" : "s"} from your shop`,
    intro:
      sorted.length === 1
        ? "One item came up since the last summary."
        : `${sorted.length} items came up since the last summary, most urgent first.`,
    sections: [
      ...aiSections,
      ...sorted.map((n) =>
        alertRow({
          severity: n.severity,
          title: n.title,
          body: n.body,
          meta: n.data?.branchName ? `Branch: ${n.data.branchName}` : "",
        })
      ),
    ],
  });

  const subject =
    critical > 0
      ? `[Action needed] ${sorted[0].title}${sorted.length > 1 ? ` +${sorted.length - 1} more` : ""} — ${business.name}`
      : `${sorted.length} shop update${sorted.length === 1 ? "" : "s"} — ${business.name}`;

  const result = await sendMail({ to, subject, html });
  if (result.sent) {
    await Notification.updateMany({ _id: { $in: sorted.map((n) => n._id) } }, { $set: { emailedAt: new Date() } });
  }
  return { ...result, count: sorted.length };
}

// ── The sweep ────────────────────────────────────────────────────────

/** Everything one business needs looked at on a schedule. */
export async function sweepBusiness(business) {
  const stock = await scanStock(business);
  // Expiry tracking is a Pro feature; Freemium businesses get no expiry alerts.
  const expiry = (await businessHasFeature(business, "expiry")) ? await scanExpiry(business) : { raised: 0, resolved: 0 };
  const memberships = await scanGymExpiries(business);

  // Returns still waiting — catches any submitted while alerts were off.
  const stale = await Return.find({ businessId: business._id, status: "pending" }).select(
    "saleNo branchId refund reason requestedByName"
  );
  for (const ret of stale) {
    await raiseReturnPending(
      { accountId: business.accountId, businessId: business._id, business },
      ret
    );
  }

  const digest = await sendDigest(business);
  return { business: business.name, stock, expiry, memberships, pendingReturns: stale.length, digest };
}

/**
 * The scheduled pass over every business. Sandbox accounts are skipped —
 * a throwaway demo does not need email, and it would be someone else's shop
 * name in the subject line.
 */
export async function runAlertSweep() {
  const businesses = await Business.find({}).populate({ path: "accountId", select: "isSandbox" });
  const results = [];
  for (const business of businesses) {
    if (business.accountId?.isSandbox) continue;
    try {
      results.push(await sweepBusiness(business));
    } catch (err) {
      console.error(`alert sweep failed for ${business.name}:`, err.message);
    }
  }
  // Plan emails (free days ending, plan ending) ride the same schedule.
  await runBillingNotices().catch((err) => console.error("billing notices failed:", err.message));
  return results;
}

/** Starts the periodic sweep. Returns a stop function. */
export function startAlertScheduler() {
  const hours = config.alertSweepHours;
  if (!hours || hours <= 0) {
    console.log("⏰ Alert sweep disabled (ALERT_SWEEP_HOURS=0)");
    return () => {};
  }
  const every = hours * 3600 * 1000;
  // First pass shortly after boot, so a fresh deploy doesn't wait hours to
  // notice a shelf that has been empty since yesterday.
  const first = setTimeout(() => {
    runAlertSweep().catch((err) => console.error("alert sweep error:", err.message));
  }, 30_000);
  const timer = setInterval(() => {
    runAlertSweep().catch((err) => console.error("alert sweep error:", err.message));
  }, every);
  timer.unref?.();
  first.unref?.();
  console.log(`⏰ Alert sweep every ${hours}h${mailEnabled() ? " (email on)" : " (in-app only)"}`);
  return () => { clearInterval(timer); clearTimeout(first); };
}
