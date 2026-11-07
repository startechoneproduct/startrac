import mongoose from "mongoose";

// A person who logs in (the human, not the business).
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: "", trim: true },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    // When they last signed in (password or till PIN), for the platform console's usage figures.
    lastLoginAt: { type: Date, default: null },

    // Soft flags, never a login/feature gate on their own — see
    // verify.routes.js. A business simply nags or disables a channel-specific
    // feature (e.g. gym SMS reminders) until the relevant flag is true.
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },

    /**
     * StarTrack-side role, entirely separate from what this person is inside
     * any business. An overseer works FOR StarTrack and can see every account
     * on the platform; a business owner is the top of their own tree and can
     * never see another shop, no matter their role there.
     *
     * Deliberately not part of the tenant permission system — mixing the two
     * is how a customer accidentally gets god rights.
     */
    platformRole: { type: String, enum: ["none", "support", "overseer"], default: "none", index: true },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
