import mongoose from "mongoose";
import { Membership } from "#modules/auth/membership.model.js";
import { Business } from "#modules/business/business.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { User } from "#modules/auth/user.model.js";
import { permsForMembership } from "#modules/auth/auth.service.js";
import { hasCapability } from "#shared/businessTypes.js";
import { Account } from "#modules/auth/account.model.js";
import { planStatus, planAllows, requiredPlanFor, limitOf, PLANS, FEATURES } from "#shared/plans.js";

const oid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null);

/**
 * Resolves the tenant context for every business-data request.
 * The account comes from the JWT ONLY. The active business/branch come from
 * headers, but are validated against the caller's membership — a client can
 * never reach a business or branch its membership doesn't grant.
 *
 * Attaches req.ctx = { userId, actorName, accountId, businessId, branchId,
 *                      role, perms, membership, allBranches }
 */
export async function tenantContext(req, res, next) {
  try {
    const businessId = oid(req.headers["x-business-id"]);
    const branchId = oid(req.headers["x-branch-id"]);
    if (!businessId) {
      return res.status(400).json({ error: "no_business", message: "Missing business context." });
    }

    const business = await Business.findOne({ _id: businessId, accountId: req.auth.accountId });
    if (!business) {
      return res.status(403).json({ error: "forbidden", message: "That business isn't on your account." });
    }

    // Prefer a membership scoped to this business; fall back to account-wide (owner).
    const membership =
      (await Membership.findOne({ userId: req.auth.userId, accountId: req.auth.accountId, businessId, status: "active" })) ||
      (await Membership.findOne({ userId: req.auth.userId, accountId: req.auth.accountId, businessId: null, status: "active" })) ||
      (await Membership.findOne({ userId: req.auth.userId, accountId: req.auth.accountId, role: "owner", status: "active" }));
    if (!membership) {
      return res.status(403).json({ error: "forbidden", message: "You don't have access to this business." });
    }

    const role = membership.role;
    const branchLocked = !!membership.branchId && (role === "manager" || role === "staff");

    let effectiveBranchId = branchId;
    if (branchLocked) {
      // Branch-scoped roles can only ever act in their own branch.
      effectiveBranchId = membership.branchId;
    }
    if (effectiveBranchId) {
      const branch = await Branch.findOne({ _id: effectiveBranchId, businessId });
      if (!branch) {
        return res.status(403).json({ error: "forbidden", message: "That branch doesn't belong to this business." });
      }
    }

    const user = await User.findById(req.auth.userId).select("name status");
    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "unauthorized", message: "Please sign in again." });
    }

    const account = await Account.findById(business.accountId).select("isSandbox subscription status");
    if (account?.status === "suspended") {
      return res.status(403).json({ error: "account_suspended", message: "This account is suspended. Please contact support." });
    }
    const status = planStatus(account);

    // A lapsed account can still look at everything it has; it just can't change
    // anything until it renews. (Billing lives outside this middleware, so paying
    // is always possible.)
    if (status.lapsed && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return res.status(402).json({
        error: "subscription_lapsed",
        message: "Your plan has ended. You can still view your data, but changes are paused until you renew.",
      });
    }

    req.ctx = {
      plan: status.plan,
      lapsed: status.lapsed,
      userId: membership.userId,
      actorName: user.name,
      accountId: business.accountId,
      businessId: business._id,
      branchId: effectiveBranchId || null,
      branchLocked,
      role,
      perms: permsForMembership(membership),
      membership,
      business,
    };
    next();
  } catch (err) {
    console.error("tenantContext error:", err);
    res.status(500).json({ error: "server", message: "Could not resolve your business context." });
  }
}

// Route-level permission gate. Owner ("*") passes everything.
export function requirePerm(...perms) {
  return (req, res, next) => {
    const have = req.ctx?.perms || [];
    if (have.includes("*") || perms.some((p) => have.includes(p))) return next();
    return res.status(403).json({ error: "forbidden", message: "You don't have permission to do that." });
  };
}

// Gate for a business-vertical API: the active business's TRADE must support
// the capability. Hiding the menu is not enough — a restaurant owner shouldn't
// be able to POST to /api/academy by hand and litter their books with classes.
export function requireCapability(capability) {
  return (req, res, next) => {
    if (hasCapability(req.ctx?.business?.typeKey, capability)) return next();
    return res.status(404).json({ error: "not_available", message: "This business type doesn't use that feature." });
  };
}

// Requires an explicit branch context (most operational endpoints).
export function requireBranch(req, res, next) {
  if (!req.ctx.branchId) {
    return res.status(400).json({ error: "no_branch", message: "Select a branch first." });
  }
  next();
}

// Staff-safe projection: roles without the finance permission never receive
// cost/profit fields — enforced here at the data layer, not in the UI.
export function canSeeCost(ctx) {
  return ctx.perms.includes("*") || ctx.perms.includes("dashboard_finance") || ctx.perms.includes("costs");
}

/**
 * Refuses a feature the account's plan doesn't include. The error carries what
 * the app needs to offer the right upgrade: which feature, and which plan has it.
 */
export function requireFeature(feature) {
  return (req, res, next) => {
    if (planAllows(req.ctx?.plan || "free", feature)) return next();
    return res.status(403).json(planRequired(feature));
  };
}

export function planRequired(feature) {
  const need = requiredPlanFor(feature);
  const f = FEATURES[feature];
  return {
    error: "plan_required",
    feature,
    requiredPlan: need,
    message: `${f?.label || "This feature"} is part of the ${PLANS[need].name} plan. Upgrade to use it.`,
  };
}

/**
 * Called before creating something a plan caps ("products", "staff", …).
 * Returns null when there's room, or the refusal body when there isn't.
 * `adding` is how many are about to be created. Existing data over a limit
 * (after a downgrade) is never touched; only new additions are refused.
 */
export function limitProblem(plan, name, currentCount, adding = 1) {
  const cap = limitOf(plan, name);
  if (cap === null || currentCount + adding <= cap) return null;
  const upTo = ["free", "pro", "business"].find((p) => limitOf(p, name) === null || limitOf(p, name) > cap);
  const noun = { businesses: "businesses", branches: "branches", staff: "staff accounts", products: "products", customers: "customers" }[name];
  return {
    error: "plan_limit",
    limit: name,
    cap,
    requiredPlan: upTo || "business",
    message: `Your ${PLANS[plan].name} plan includes up to ${cap} ${noun}. Upgrade to ${PLANS[upTo || "business"].name} to add more.`,
  };
}
