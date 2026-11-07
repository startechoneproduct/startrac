/**
 * The seeded showcase: EVERY business type on EVERY plan, so any trade can be
 * tried as Freemium, Pro or Business with a real login. One owner account each
 * (13 trades x 3 plans), no staff: add your own once you are signed in.
 *
 * Used by seedShowcase.js (accounts get their plan at creation) and by
 * assignPlans.js (existing accounts are moved onto their plan).
 */
export const SHOWCASE_OWNER_PASSWORD = "demo12";

/** The plans each trade is seeded on, in the order they are listed. */
export const SHOWCASE_PLAN_KEYS = ["free", "pro", "business"];

/** The login for a trade on a plan, e.g. salon.pro@startrack.demo. */
export const showcaseEmail = (typeKey, plan) => `${typeKey}.${plan}@startrack.demo`;

/** A paid-up subscription that stays valid for testing (no Pro bonus: Freemium stays Freemium). */
export function showcaseSubscription(plan, days = 365) {
  return { plan, trial: false, registeredPlan: plan, currentPeriodEnd: new Date(Date.now() + days * 86_400_000), payments: [] };
}
