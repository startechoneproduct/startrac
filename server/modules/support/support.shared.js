import multer from "multer";
import mongoose from "mongoose";
import { FileDoc, DOC_MIME, DOC_MAX_BYTES } from "#modules/files/fileDoc.model.js";
import { User } from "#modules/auth/user.model.js";
import { Business } from "#modules/business/business.model.js";
import { raise, keys } from "#modules/alerts/notify.js";
import { emailPerson, realEmail } from "#core/ownerMail.js";
import { esc } from "#core/mailer.js";
import { nextSeq } from "#core/counters.js";
import { badRequest } from "#core/httpError.js";
import { sniffImage } from "#modules/business/logo.js";

/**
 * What the business help pages (tickets.routes.js) and StarTrack's support desk
 * (desk.routes.js) share: attachments, the StarTrack reference, and telling the
 * business when StarTrack has answered.
 */

export const MAX_FILES_PER_MESSAGE = 5;
export const MAX_FILES_PER_TICKET = 20;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOC_MAX_BYTES, files: MAX_FILES_PER_MESSAGE },
  fileFilter: (_req, file, cb) => (DOC_MIME.test(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error("type"), { code: "BAD_TYPE" }))),
});

/** Accepts up to five screenshots or PDFs as multipart "files"; a JSON body passes straight through. */
export function acceptFiles(req, res, next) {
  upload.array("files", MAX_FILES_PER_MESSAGE)(req, res, (err) => {
    if (!err) return next();
    const message = err.code === "BAD_TYPE" ? "Attach screenshots or photos (JPG, PNG, WEBP) or PDFs only."
      : err.code === "LIMIT_FILE_SIZE" ? "Each file must be 3 MB or less."
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `Attach up to ${MAX_FILES_PER_MESSAGE} files at a time.`
      : "That file couldn't be read.";
    res.status(400).json({ error: "invalid", message });
  });
}

/** Stores the uploaded files against the ticket and returns what to keep on the ticket or reply. */
export async function saveFiles(ticket, files = []) {
  const already = countFiles(ticket);
  if (already + files.length > MAX_FILES_PER_TICKET) throw badRequest(`A ticket can hold up to ${MAX_FILES_PER_TICKET} files.`);
  // Trust the bytes, not the browser's label: a page renamed to .png is refused here.
  const real = files.map((f) => sniffImage(f.buffer) || (f.buffer.subarray(0, 5).toString("latin1") === "%PDF-" ? "application/pdf" : null));
  if (real.some((m) => !m)) throw badRequest("Attach screenshots or photos (JPG, PNG, WEBP) or PDFs only.");
  const out = [];
  for (const [i, f] of files.entries()) {
    const doc = await FileDoc.create({
      accountId: ticket.accountId, businessId: ticket.businessId, ownerType: "ticket", ownerId: ticket._id,
      name: String(f.originalname || "file").slice(0, 120), mime: real[i], size: f.size, data: f.buffer,
    });
    out.push({ fileId: doc._id, name: doc.name, mime: doc.mime, size: doc.size });
  }
  return out;
}

const countFiles = (t) => (t.attachments || []).length + (t.comments || []).reduce((s, c) => s + (c.attachments || []).length, 0);

/**
 * Whether this file belongs to a part of the ticket the reader may see.
 * The business can't open a file that sits on a StarTrack internal note.
 */
export function fileVisible(ticket, fileId, { desk }) {
  const id = String(fileId);
  if ((ticket.attachments || []).some((a) => String(a.fileId) === id)) return true;
  return (ticket.comments || []).some((c) => (desk || !c.internal) && (c.attachments || []).some((a) => String(a.fileId) === id));
}

/** Streams a ticket file. Shown inline (screenshots open in the tab), never sniffed into something runnable. */
export async function sendTicketFile(res, ticket, fileId) {
  if (!mongoose.isValidObjectId(fileId)) return res.status(404).json({ error: "not_found", message: "File not found." });
  const file = await FileDoc.findOne({ _id: fileId, ownerType: "ticket", ownerId: ticket._id });
  if (!file) return res.status(404).json({ error: "not_found", message: "File not found." });
  res.set({
    "Content-Type": file.mime,
    "Content-Length": file.size,
    "Content-Disposition": `inline; filename="${file.name.replace(/[^\w.\- ]/g, "_")}"`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(file.data);
}

/** Hands a ticket to StarTrack: a platform-wide reference and a place in the desk queue. */
export async function sendToStarTrack(ticket) {
  ticket.scope = "platform";
  ticket.escalatedAt = ticket.escalatedAt || new Date();
  if (!ticket.ref) ticket.ref = `ST-${String(await nextSeq("ticket:platform")).padStart(6, "0")}`;
  ticket.awaiting = "startrack";
  ticket.lastMessageAt = new Date();
  if (ticket.status === "resolved" || ticket.status === "closed") { ticket.status = "open"; ticket.resolvedAt = null; ticket.closedAt = null; }
}

/** Tells the person who raised it (bell + email) that StarTrack has moved their ticket on. */
export async function notifyBusiness(ticket, { title, body }) {
  const stamp = Date.now();
  await raise(
    { accountId: ticket.accountId, businessId: ticket.businessId, branchId: ticket.branchId },
    {
      type: "help_update", severity: "info", title, body,
      target: { type: "ticket", id: ticket._id, label: ticket.subject },
      dedupeKey: keys.ticketUpdate(ticket._id, stamp),
      forUserId: ticket.raisedBy.userId,
    }
  ).catch(() => {});
  const [person, business] = await Promise.all([
    User.findById(ticket.raisedBy.userId).select("email"),
    Business.findById(ticket.businessId).select("name"),
  ]);
  if (person && realEmail(person.email)) {
    emailPerson(person.email, {
      subject: `${title}: ${ticket.subject}`,
      businessName: business?.name || "StarTrack",
      heading: title,
      intro: body || `Your request "${ticket.subject}" has an update from StarTrack support.`,
      sections: [`<p style="font-size:13px;color:#6b7280;margin:0">Reference ${esc(ticket.ref || ticket.ticketNo)}: ${esc(ticket.subject)}. Open Help in StarTrack to reply.</p>`],
      footNote: "You are receiving this because you contacted StarTrack support.",
    }).catch(() => {});
  }
}

/** Emails the StarTrack person working a ticket when the business writes back. */
export async function notifyDesk(ticket, body) {
  if (!ticket.deskAssigneeId) return;
  const agent = await User.findById(ticket.deskAssigneeId).select("email");
  if (!agent || !realEmail(agent.email)) return;
  emailPerson(agent.email, {
    subject: `New reply on ${ticket.ref}: ${ticket.subject}`,
    heading: `The business replied on ${ticket.ref}`,
    intro: body.slice(0, 400) || "They added files to the ticket.",
    sections: [`<p style="font-size:13px;color:#6b7280;margin:0">Open the support desk to answer.</p>`],
    footNote: "You are receiving this because the ticket is assigned to you.",
  }).catch(() => {});
}

/** The business's view of the conversation: StarTrack's internal notes are left out. */
export function publicComments(ticket) {
  return (ticket.comments || []).filter((c) => !c.internal).map((c) => ({
    byId: c.byId, byName: c.side === "startrack" ? `${c.byName} · StarTrack` : c.byName, body: c.body, at: c.at,
    side: c.side || "business", attachments: c.attachments || [],
  }));
}
