import mongoose from "mongoose";

/**
 * A help-desk ticket — separate from Job Tickets (server/modules/jobs/),
 * which is a work-order/billing workflow. This is a plain "something needs
 * looking into, track it to resolution" thread. Staff-raised only for now:
 * there's no customer login anywhere in this app (Customer is CRM-lite, no
 * credentials — see customer.model.js), so a ticket is filed BY a staff
 * member, optionally ABOUT a customer, not submitted directly by one.
 */
// A screenshot or document added to a ticket or a reply; the bytes live in FileDoc (ownerType "ticket").
const attachmentSchema = new mongoose.Schema(
  { fileId: { type: mongoose.Schema.Types.ObjectId, required: true }, name: String, mime: String, size: Number },
  { _id: false }
);

const commentSchema = new mongoose.Schema(
  {
    byId: { type: mongoose.Schema.Types.ObjectId, required: true },
    byName: { type: String, required: true },
    body: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    // Who is speaking: someone in the business, or StarTrack's support team.
    side: { type: String, enum: ["business", "startrack"], default: "business" },
    // A StarTrack-only note between support staff. Never sent to the business.
    internal: { type: Boolean, default: false },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, default: null },
    ticketNo: { type: String, required: true },

    subject: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    category: { type: String, enum: ["complaint", "question", "billing", "technical", "other"], default: "other" },
    priority: { type: String, enum: ["low", "normal", "high"], default: "normal" },
    status: { type: String, enum: ["open", "in_progress", "resolved", "closed"], default: "open" },

    // Optional — "a customer called in about X" vs. a purely internal issue.
    customerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },

    raisedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, required: true },
      name: { type: String, required: true },
    },
    assignedToId: { type: mongoose.Schema.Types.ObjectId, default: null },
    assignedToName: { type: String, default: "" },

    comments: { type: [commentSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },

    // "platform" once escalated to StarTrack's own support staff — see
    // platform.routes.js's GET /tickets, gated by the same platformRole
    // check every other platform-overseer route already uses.
    scope: { type: String, enum: ["business", "platform"], default: "business" },
    escalatedAt: { type: Date, default: null },
    // StarTrack-wide reference (ST-000123), given when the ticket reaches StarTrack.
    // ticketNo above only counts within one business.
    ref: { type: String, default: undefined },
    // Who at StarTrack is working it, and whose turn it is to reply.
    deskAssigneeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    deskAssigneeName: { type: String, default: "" },
    awaiting: { type: String, enum: ["startrack", "business", null], default: null },
    firstResponseAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: null },

    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ticketSchema.index({ businessId: 1, status: 1, createdAt: -1 });
ticketSchema.index({ businessId: 1, ticketNo: 1 }, { unique: true });
ticketSchema.index({ scope: 1, status: 1, createdAt: -1 });
ticketSchema.index({ ref: 1 }, { unique: true, sparse: true });

export const Ticket = mongoose.model("Ticket", ticketSchema);
