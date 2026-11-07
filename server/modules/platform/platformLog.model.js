import mongoose from "mongoose";

/**
 * What StarTrack's own staff did in the platform console: plan changes,
 * suspensions, staff access, people suspended or restored. Append-only.
 * The affected business's own audit log gets a copy too (see
 * platform.routes.js); this one is the platform-wide history in one place.
 */
const platformLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    actorName: { type: String, default: "" },
    action: { type: String, required: true }, // platform.plan | platform.account_status | platform.staff | platform.user_status
    target: {
      type: { type: String, default: "" }, // account | user
      id: { type: mongoose.Schema.Types.ObjectId },
      label: { type: String, default: "" },
    },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    at: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

export const PlatformLog = mongoose.model("PlatformLog", platformLogSchema);

/** Records one console action. Never fails the action it describes. */
export function logPlatform(req, action, target, before, after) {
  return PlatformLog.create({
    actorId: req.platformUser._id, actorName: req.platformUser.name, action, target, before, after,
  }).catch((err) => console.error("platform log:", err.message));
}
