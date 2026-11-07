import mongoose from "mongoose";
import { connectDb } from "#core/db.js";
import { User } from "#modules/auth/user.model.js";
import { Account } from "#modules/auth/account.model.js";
import { DEMOS } from "#modules/auth/demoShops.js";
import { hashPassword } from "#modules/auth/auth.service.js";
import { SHOWCASE_PLAN_KEYS, SHOWCASE_OWNER_PASSWORD, showcaseEmail, showcaseSubscription } from "./showcasePlans.js";

/**
 * Puts each seeded showcase account back on its plan (see showcasePlans.js),
 * e.g. after its paid year has run out, sets its password to
 * SHOWCASE_OWNER_PASSWORD, and prints every login.
 *
 *   node server/scripts/assignPlans.js            apply the plans
 *   node server/scripts/assignPlans.js --dry      only show what's there
 *   add --days=N to change how long the plan stays valid (default 365)
 */
const dry = process.argv.includes("--dry");
const days = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7)) || 365;

async function main() {
  await connectDb();
  const rows = [];
  for (const typeKey of Object.keys(DEMOS)) {
    for (const plan of SHOWCASE_PLAN_KEYS) {
      const email = showcaseEmail(typeKey, plan);
      const user = await User.findOne({ email });
      const account = user && (await Account.findOne({ ownerUserId: user._id }));
      if (!account) { rows.push({ plan, email, missing: true }); continue; }
      if (!dry) {
        account.plan = plan;
        account.subscription = showcaseSubscription(plan, days);
        await account.save();
        user.passwordHash = await hashPassword(SHOWCASE_OWNER_PASSWORD);
        await user.save();
      }
      rows.push({ plan, email });
    }
  }
  for (const r of rows) console.log(`${r.missing ? "MISSING " : dry ? "found   " : "set     "}${r.plan.padEnd(9)}${r.email}`);
  console.log(`\nPassword for all: ${SHOWCASE_OWNER_PASSWORD}${dry ? "" : `  (valid ${days} days)`}`);
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
