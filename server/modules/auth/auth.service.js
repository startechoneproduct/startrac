import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "#core/config.js";
import { ALL_PERMS, expandPerms } from "#shared/permissions.js";

export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signToken(payload, opts = {}) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d", ...opts });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

// Default capabilities per role. Each person can then be given more
// (permsOverride) or have some taken away (permsRevoked) — see permsForRole.
// Broad keys open up into finer ones (see shared/permissions.js), so e.g. a
// manager's "stock" includes stock in, adjustments, counts and transfers.
export const ROLE_PERMS = {
  owner: ["*"],
  admin: ["sales", "returns", "approve_returns", "void_sales", "stock", "prices", "expenses",
          "dashboard_ops", "dashboard_finance", "staff_mgmt", "settings", "customers", "activity", "audit", "support"],
  manager: ["sales", "returns", "approve_returns", "void_sales", "stock", "prices", "expenses",
            "dashboard_ops", "customers", "activity", "support"],
  staff: ["sales", "returns", "activity"],
};

// Every permission a person can be individually given or have taken away. "*"
// (everything) is deliberately not here: only the owner role has it, and it can
// never be handed out or removed.
export const GRANTABLE_PERMS = new Set(ALL_PERMS);

/** What a role starts with, broad keys opened up. The owner is just ["*"]. */
export function roleDefaults(role) {
  const base = ROLE_PERMS[role] || ROLE_PERMS.staff;
  return base.includes("*") ? ["*"] : expandPerms(base);
}

/** Why `wanted` can't be given to someone by `actorPerms`, or null if it can. */
export function overridesProblem(actorPerms, wanted) {
  if (wanted.length && !actorPerms.includes("*") && !actorPerms.includes("staff_perms")) return "You don't have permission to change staff permissions.";
  if (wanted.some((p) => !GRANTABLE_PERMS.has(p))) return "That isn't a permission that can be given.";
  if (!actorPerms.includes("*") && wanted.some((p) => !actorPerms.includes(p))) return "You can't give someone a permission you don't have yourself.";
  return null;
}

/**
 * What a person may actually do: their role's permissions, plus what was given
 * to them, minus what was taken away. The owner always has everything.
 */
export function permsForRole(role, overrides = [], revoked = []) {
  const base = roleDefaults(role);
  if (base.includes("*")) return base;
  // Filtered on the way out as well, so an override stored before this rule existed can't carry "*".
  const given = expandPerms(overrides.filter((p) => GRANTABLE_PERMS.has(p)));
  const removed = new Set(revoked);
  return Array.from(new Set([...base, ...given])).filter((p) => !removed.has(p));
}

/** permsForRole for a stored membership. */
export const permsForMembership = (m) => permsForRole(m?.role || "staff", m?.permsOverride || [], m?.permsRevoked || []);
