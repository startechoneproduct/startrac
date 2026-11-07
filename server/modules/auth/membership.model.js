import mongoose from "mongoose";

// Links a user to a business/branch with a role. This is the separation-of-power
// backbone: role + per-user permission overrides + an optional till PIN.
const membershipSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", index: true }, // null = account-wide (owner)
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch" }, // null = all branches
    role: { type: String, enum: ["owner", "admin", "manager", "staff"], default: "staff" },
    permsOverride: { type: [String], default: [] }, // given on top of the role
    permsRevoked: { type: [String], default: [] }, // taken away from what the role gives
    pinHash: { type: String, default: "" }, // set when staff can log in at a till
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift", default: null },
    // Organizational, not security — a job title and who this person reports
    // to, for the Staff org-chart view. Never read by requirePerm/canSeeCost;
    // the role field above is the only thing that governs access.
    position: { type: String, default: "" },
    reportsToId: { type: mongoose.Schema.Types.ObjectId, ref: "Membership", default: null },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

membershipSchema.index({ businessId: 1, status: 1 });

export const Membership = mongoose.model("Membership", membershipSchema);
