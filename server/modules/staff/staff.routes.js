import { config } from "#core/config.js";
import { emailPerson, realEmail, button } from "#core/ownerMail.js";
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { User } from "#modules/auth/user.model.js";
import { Membership } from "#modules/auth/membership.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { Shift } from "#modules/staff/shift.model.js";
import { RosterEntry } from "#modules/staff/rosterEntry.model.js";
import { hashPassword, permsForMembership, roleDefaults, overridesProblem } from "#modules/auth/auth.service.js";
import { requirePerm, requireBranch, limitProblem } from "#core/middleware/tenant.js";
import { audit } from "#core/audit.js";
import { localDay } from "#modules/metrics/metrics.service.js";

export const staffRouter = Router();

const ASSIGNABLE_ROLES = ["admin", "manager", "staff"];
const pinSchema = z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits");

function shape(m, user, branch, shift, reportsToUser) {
  return {
    id: m._id,
    userId: m.userId,
    name: user?.name || "",
    email: user?.email?.endsWith(".till.local") ? "" : user?.email || "",
    role: m.role,
    branchId: m.branchId || null,
    branchName: branch?.name || "All branches",
    permsOverride: m.permsOverride,
    permsRevoked: m.permsRevoked || [],
    roleDefaults: roleDefaults(m.role),
    permissions: permsForMembership(m),
    hasPin: !!m.pinHash,
    shiftId: m.shiftId || null,
    shiftName: shift ? `${shift.name} (${shift.start}–${shift.end})` : "",
    // Organizational metadata — never consulted by requirePerm/canSeeCost.
    position: m.position || "",
    reportsToId: m.reportsToId || null,
    reportsToName: reportsToUser?.name || "",
    status: m.status,
    createdAt: m.createdAt,
  };
}

// People who work at the active branch: those assigned to it, plus the
// branch-less roles (owner/admin = "All branches"). `scope=all` lifts the
// branch filter so an owner can still see the whole business's team.
function teamFilter(req) {
  const base = { accountId: req.ctx.accountId, $or: [{ businessId: req.ctx.businessId }, { businessId: null }] };
  if (req.ctx.branchId && req.query.scope !== "all") {
    // Owners count everywhere: registration pins theirs to the first branch,
    // but they run every one.
    return { ...base, $and: [{ $or: [{ branchId: req.ctx.branchId }, { branchId: null }, { role: "owner" }] }] };
  }
  return base;
}

// GET /api/staff[?scope=all] — the team for the active branch of the active business
staffRouter.get("/", requirePerm("staff_view"), async (req, res) => {
  const memberships = await Membership.find(teamFilter(req)).sort({ createdAt: 1 });
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).select("name email status");
  const branches = await Branch.find({ businessId: req.ctx.businessId }).select("name");
  const shifts = await Shift.find({ businessId: req.ctx.businessId });
  const membershipById = new Map(memberships.map((m) => [String(m._id), m]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const branchById = new Map(branches.map((b) => [String(b._id), b]));
  const shiftById = new Map(shifts.map((s) => [String(s._id), s]));
  res.json({
    staff: memberships.map((m) => {
      const reportsTo = m.reportsToId && membershipById.get(String(m.reportsToId));
      const reportsToUser = reportsTo && userById.get(String(reportsTo.userId));
      return shape(m, userById.get(String(m.userId)), branchById.get(String(m.branchId)), shiftById.get(String(m.shiftId)), reportsToUser);
    }),
  });
});

// GET /api/staff/org-chart — the whole business as a reporting tree, owner at the top.
// Purely organizational (see Membership.position/reportsToId); the security
// role ladder (owner/admin/manager/staff) is unaffected by this view.
// Everyone is included, whichever branch is selected: it's the company's chart.
const ROLE_ORDER = { owner: 0, admin: 1, manager: 2, staff: 3 };
staffRouter.get("/org-chart", requirePerm("staff_view"), async (req, res) => {
  const memberships = await Membership.find({
    accountId: req.ctx.accountId, status: "active",
    $or: [{ businessId: req.ctx.businessId }, { businessId: null }],
  }).sort({ createdAt: 1 });
  const [users, branches] = await Promise.all([
    User.find({ _id: { $in: memberships.map((m) => m.userId) } }).select("name"),
    Branch.find({ businessId: req.ctx.businessId }).select("name"),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const branchById = new Map(branches.map((b) => [String(b._id), b]));

  const nodeById = new Map(
    memberships.map((m) => [
      String(m._id),
      {
        id: m._id, name: userById.get(String(m.userId))?.name || "", position: m.position || "", role: m.role,
        // Owners run every branch (registration just pins theirs to the first), so they read as "All branches".
        branchName: m.role !== "owner" && m.branchId ? branchById.get(String(m.branchId))?.name || "" : "All branches",
        inferred: false, children: [],
      },
    ])
  );
  const owners = memberships.filter((m) => m.role === "owner");
  const top = owners.length ? nodeById.get(String(owners[0]._id)) : null;

  // A boss chain that loops back on itself (bad data) is ignored rather than followed forever.
  const loops = (m) => {
    let cur = m;
    for (let i = 0; i < 25 && cur?.reportsToId; i++) {
      if (String(cur.reportsToId) === String(m._id)) return true;
      cur = memberships.find((x) => String(x._id) === String(cur.reportsToId));
    }
    return false;
  };

  const roots = [];
  for (const m of memberships) {
    const node = nodeById.get(String(m._id));
    const parent = m.role !== "owner" && m.reportsToId && !loops(m) ? nodeById.get(String(m.reportsToId)) : null;
    if (parent && parent !== node) parent.children.push(node);
    else if (m.role !== "owner" && top) { node.inferred = true; top.children.push(node); }
    else roots.push(node); // an owner (or a team with no owner on record)
  }
  const sortKids = (n) => {
    n.children.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name));
    n.children.forEach(sortKids);
  };
  roots.forEach(sortKids);
  res.json({ chart: roots, total: memberships.length });
});

// ── Shifts ───────────────────────────────────────────────────

// GET /api/staff/shifts
staffRouter.get("/shifts", requirePerm("staff_view"), async (req, res) => {
  const shifts = await Shift.find({ businessId: req.ctx.businessId }).sort({ start: 1 });
  res.json({ shifts: shifts.map((s) => ({ id: s._id, name: s.name, start: s.start, end: s.end })) });
});

const shiftSchema = z.object({
  name: z.string().min(1, "Give the shift a name"),
  start: z.string().regex(/^\d{2}:\d{2}$/, "Start time must be HH:MM"),
  end: z.string().regex(/^\d{2}:\d{2}$/, "End time must be HH:MM"),
});

// POST /api/staff/shifts
staffRouter.post("/shifts", requirePerm("staff_mgmt"), async (req, res) => {
  const parsed = shiftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const shift = await Shift.create({ accountId: req.ctx.accountId, businessId: req.ctx.businessId, ...parsed.data });
  audit(req.ctx, "shift.create", { type: "shift", id: shift._id, label: shift.name });
  res.status(201).json({ shift: { id: shift._id, name: shift.name, start: shift.start, end: shift.end } });
});

// DELETE /api/staff/shifts/:id — unassigns anyone on it
staffRouter.delete("/shifts/:id", requirePerm("staff_mgmt"), async (req, res) => {
  const shift = await Shift.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!shift) return res.status(404).json({ error: "not_found", message: "Shift not found." });
  await Membership.updateMany({ businessId: req.ctx.businessId, shiftId: shift._id }, { $set: { shiftId: null } });
  await shift.deleteOne();
  audit(req.ctx, "shift.delete", { type: "shift", id: shift._id, label: shift.name });
  res.json({ ok: true });
});

const createSchema = z.object({
  name: z.string().min(2, "Enter the staff member's name"),
  role: z.enum(ASSIGNABLE_ROLES),
  branchId: z.string().optional(), // required for manager/staff
  pin: pinSchema,
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(6).optional().or(z.literal("")),
  permsOverride: z.array(z.string()).default([]),
  position: z.string().max(80).default(""),
  reportsToId: z.string().nullable().optional(),
});

staffRouter.post("/", requirePerm("staff_mgmt"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  // The owner doesn't count toward the plan's staff cap, only the people they add.
  const staffRoom = limitProblem(req.ctx.plan, "staff", await Membership.countDocuments({ businessId: req.ctx.businessId, status: "active", role: { $ne: "owner" } }));
  if (staffRoom) return res.status(403).json(staffRoom);

  if ((d.role === "manager" || d.role === "staff") && !d.branchId) {
    return res.status(400).json({ error: "invalid", message: "Managers and staff must be assigned to a branch." });
  }
  const problem = overridesProblem(req.ctx.perms, d.permsOverride);
  if (problem) return res.status(403).json({ error: "forbidden", message: problem });
  if (d.branchId) {
    const branch = await Branch.findOne({ _id: d.branchId, businessId: req.ctx.businessId });
    if (!branch) return res.status(400).json({ error: "invalid", message: "That branch doesn't exist." });
  }
  // Only owners may create admins.
  if (d.role === "admin" && !req.ctx.perms.includes("*")) {
    return res.status(403).json({ error: "forbidden", message: "Only the owner can add admins." });
  }
  let boss = null;
  if (d.reportsToId) {
    boss = await Membership.findOne({ _id: d.reportsToId, accountId: req.ctx.accountId, businessId: req.ctx.businessId });
    if (!boss) return res.status(400).json({ error: "invalid", message: "That 'reports to' person doesn't exist on this business." });
  }

  let email = (d.email || "").toLowerCase().trim();
  if (email) {
    if (await User.findOne({ email })) {
      return res.status(409).json({ error: "email_taken", message: "That email is already registered." });
    }
  } else {
    // Till-only staff: synthesize an internal, never-typed address.
    email = `staff-${crypto.randomBytes(6).toString("hex")}@${req.ctx.businessId}.till.local`;
  }

  const user = await User.create({
    name: d.name,
    email,
    passwordHash: await hashPassword(d.password || crypto.randomBytes(12).toString("hex")),
  });
  const membership = await Membership.create({
    userId: user._id,
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: d.branchId || null,
    role: d.role,
    permsOverride: d.permsOverride,
    pinHash: await hashPassword(d.pin),
    position: d.position,
    reportsToId: d.reportsToId || null,
  });

  // Someone added with a real email is told (never the password: that is the owner's to pass on).
  if (realEmail(email)) {
    emailPerson(email, {
      subject: `You've been added to ${req.ctx.business.name} on StarTrack`,
      businessName: req.ctx.business.name,
      heading: `Welcome to ${req.ctx.business.name}`,
      intro: `${req.ctx.actorName} added you as ${d.role === "admin" ? "an" : "a"} ${d.role}. Sign in with this email address and the password they gave you.`,
      sections: [config.appUrl ? button(`${config.appUrl.replace(/\/$/, "")}/login`, "Sign in") : ""],
      footNote: "You are receiving this because someone added you to their StarTrack business.",
    }).catch(() => {});
  }

  audit(req.ctx, "staff.create", { type: "staff", id: membership._id, label: d.name }, undefined, {
    role: d.role,
    branchId: d.branchId || null,
    position: d.position,
    reportsToId: d.reportsToId || null,
  });
  const branch = d.branchId ? await Branch.findById(d.branchId) : null;
  const reportsToUser = boss ? await User.findById(boss.userId).select("name") : null;
  res.status(201).json({ staff: shape(membership, user, branch, null, reportsToUser) });
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  branchId: z.string().nullable().optional(),
  shiftId: z.string().nullable().optional(),
  permsOverride: z.array(z.string()).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  position: z.string().max(80).optional(),
  reportsToId: z.string().nullable().optional(),
});

// Walks the reportsToId chain from `candidateId` upward; true if it ever
// reaches `membershipId` (which would make that person their own manager,
// directly or transitively). Bounded so a data glitch can't loop forever.
async function wouldCreateReportingCycle(businessId, membershipId, candidateId) {
  let current = candidateId;
  for (let i = 0; i < 20 && current; i++) {
    if (String(current) === String(membershipId)) return true;
    const next = await Membership.findOne({ _id: current, businessId }).select("reportsToId");
    current = next?.reportsToId || null;
  }
  return false;
}

// PATCH /api/staff/:id — role/branch/overrides/suspend
staffRouter.patch("/:id", requirePerm("staff_mgmt"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const membership = await Membership.findOne({ _id: req.params.id, accountId: req.ctx.accountId, businessId: req.ctx.businessId });
  if (!membership) return res.status(404).json({ error: "not_found", message: "Staff member not found." });
  if (membership.role === "owner") {
    return res.status(403).json({ error: "forbidden", message: "The owner can't be edited here." });
  }
  if ((d.role === "admin" || membership.role === "admin") && !req.ctx.perms.includes("*")) {
    return res.status(403).json({ error: "forbidden", message: "Only the owner can manage admins." });
  }
  // Nobody widens their own access: that is the owner's call.
  if (String(membership.userId) === String(req.ctx.userId) && !req.ctx.perms.includes("*")) {
    return res.status(403).json({ error: "forbidden", message: "You can't change your own access." });
  }
  if (d.permsOverride) {
    const problem = overridesProblem(req.ctx.perms, d.permsOverride);
    if (problem) return res.status(403).json({ error: "forbidden", message: problem });
  }
  if (d.branchId) {
    const branch = await Branch.findOne({ _id: d.branchId, businessId: req.ctx.businessId });
    if (!branch) return res.status(400).json({ error: "invalid", message: "That branch doesn't exist." });
  }

  if (d.shiftId) {
    const shift = await Shift.findOne({ _id: d.shiftId, businessId: req.ctx.businessId });
    if (!shift) return res.status(400).json({ error: "invalid", message: "That shift doesn't exist." });
  }

  if (d.reportsToId) {
    const boss = await Membership.findOne({ _id: d.reportsToId, accountId: req.ctx.accountId, businessId: req.ctx.businessId });
    if (!boss) return res.status(400).json({ error: "invalid", message: "That 'reports to' person doesn't exist on this business." });
    if (await wouldCreateReportingCycle(req.ctx.businessId, membership._id, d.reportsToId)) {
      return res.status(400).json({ error: "invalid", message: "That would create a reporting loop." });
    }
  }

  const before = {
    role: membership.role, branchId: membership.branchId, status: membership.status,
    permsOverride: membership.permsOverride, position: membership.position, reportsToId: membership.reportsToId,
  };
  if (d.role) membership.role = d.role;
  if (d.branchId !== undefined) membership.branchId = d.branchId;
  if (d.shiftId !== undefined) membership.shiftId = d.shiftId;
  if (d.permsOverride) membership.permsOverride = d.permsOverride;
  if (d.status) membership.status = d.status;
  if (d.position !== undefined) membership.position = d.position;
  if (d.reportsToId !== undefined) membership.reportsToId = d.reportsToId || null;
  await membership.save();

  const user = await User.findById(membership.userId);
  if (d.name && user) {
    user.name = d.name;
    await user.save();
  }

  audit(req.ctx, "staff.update", { type: "staff", id: membership._id, label: user?.name || "" }, before, {
    role: membership.role,
    branchId: membership.branchId,
    status: membership.status,
    permsOverride: membership.permsOverride,
    position: membership.position,
    reportsToId: membership.reportsToId,
  });
  const branch = membership.branchId ? await Branch.findById(membership.branchId) : null;
  const shift = membership.shiftId ? await Shift.findById(membership.shiftId) : null;
  const reportsTo = membership.reportsToId ? await Membership.findById(membership.reportsToId) : null;
  const reportsToUser = reportsTo ? await User.findById(reportsTo.userId).select("name") : null;
  res.json({ staff: shape(membership, user, branch, shift, reportsToUser) });
});

const permissionsSchema = z.object({ permissions: z.array(z.string()) });

// PUT /api/staff/:id/permissions — set exactly what this person may do.
// Stored as the difference from their role: what was given on top
// (permsOverride) and what was taken away (permsRevoked), so a later role
// change still starts from the new role's defaults.
staffRouter.put("/:id/permissions", requirePerm("staff_perms"), async (req, res) => {
  const parsed = permissionsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });

  const membership = await Membership.findOne({ _id: req.params.id, accountId: req.ctx.accountId, businessId: req.ctx.businessId });
  if (!membership) return res.status(404).json({ error: "not_found", message: "Staff member not found." });
  if (membership.role === "owner") {
    return res.status(403).json({ error: "forbidden", message: "The owner always has full access." });
  }
  if (membership.role === "admin" && !req.ctx.perms.includes("*")) {
    return res.status(403).json({ error: "forbidden", message: "Only the owner can change an admin's permissions." });
  }
  if (String(membership.userId) === String(req.ctx.userId) && !req.ctx.perms.includes("*")) {
    return res.status(403).json({ error: "forbidden", message: "You can't change your own permissions." });
  }

  const wanted = new Set(parsed.data.permissions);
  const defaults = roleDefaults(membership.role);
  const granted = [...wanted].filter((p) => !defaults.includes(p));
  const revoked = defaults.filter((p) => !wanted.has(p));
  // Giving is capped by the giver's own access; taking away is not.
  const problem = overridesProblem(req.ctx.perms, granted);
  if (problem) return res.status(403).json({ error: "forbidden", message: problem });

  const before = { permsOverride: membership.permsOverride, permsRevoked: membership.permsRevoked };
  membership.permsOverride = granted;
  membership.permsRevoked = revoked;
  await membership.save();

  const user = await User.findById(membership.userId).select("name email");
  audit(req.ctx, "staff.permissions", { type: "staff", id: membership._id, label: user?.name || "" }, before, {
    permsOverride: granted,
    permsRevoked: revoked,
  });
  const branch = membership.branchId ? await Branch.findById(membership.branchId) : null;
  res.json({ staff: shape(membership, user, branch, null, null) });
});

// POST /api/staff/:id/pin — reset a till PIN
staffRouter.post("/:id/pin", requirePerm("staff_mgmt"), async (req, res) => {
  const parsed = pinSchema.safeParse(req.body?.pin);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });

  const membership = await Membership.findOne({ _id: req.params.id, accountId: req.ctx.accountId, businessId: req.ctx.businessId });
  if (!membership) return res.status(404).json({ error: "not_found", message: "Staff member not found." });
  if (membership.role === "admin" && !req.ctx.perms.includes("*")) {
    return res.status(403).json({ error: "forbidden", message: "Only the owner can reset an admin's PIN." });
  }

  membership.pinHash = await hashPassword(parsed.data);
  await membership.save();
  const user = await User.findById(membership.userId).select("name");
  audit(req.ctx, "staff.pin_reset", { type: "staff", id: membership._id, label: user?.name || "" });
  res.json({ ok: true });
});

// ── Roster ───────────────────────────────────────────────────
// A dated assignment of one staff member to one named shift — "my schedule"
// on the staff home screen reads this; Shift itself stays a reusable template.

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

function shapeRoster(r, shift) {
  return {
    id: r._id,
    date: r.date,
    membershipId: r.membershipId,
    shiftId: r.shiftId,
    shiftName: shift?.name || "",
    start: shift?.start || "",
    end: shift?.end || "",
  };
}

// GET /api/staff/roster?from&to — my own upcoming schedule, defaults to the next 7 days.
staffRouter.get("/roster", requirePerm("activity"), requireBranch, async (req, res) => {
  const from = String(req.query.from || localDay());
  const to = String(req.query.to || addDays(from, 7));
  const entries = await RosterEntry.find({
    businessId: req.ctx.businessId,
    membershipId: req.ctx.membership._id,
    date: { $gte: from, $lte: to },
  }).sort({ date: 1 });
  const shifts = await Shift.find({ businessId: req.ctx.businessId });
  const shiftById = new Map(shifts.map((s) => [String(s._id), s]));
  res.json({ roster: entries.map((r) => shapeRoster(r, shiftById.get(String(r.shiftId)))) });
});

const rosterSchema = z.object({
  membershipId: z.string(),
  shiftId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
});

// POST /api/staff/roster — assign a staff member to a shift on a date.
staffRouter.post("/roster", requirePerm("staff_mgmt"), requireBranch, async (req, res) => {
  const parsed = rosterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const membership = await Membership.findOne({ _id: d.membershipId, accountId: req.ctx.accountId, businessId: req.ctx.businessId });
  if (!membership) return res.status(400).json({ error: "invalid", message: "That staff member doesn't exist." });
  const shift = await Shift.findOne({ _id: d.shiftId, businessId: req.ctx.businessId });
  if (!shift) return res.status(400).json({ error: "invalid", message: "That shift doesn't exist." });

  const entry = await RosterEntry.create({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: membership.branchId || req.ctx.branchId,
    membershipId: membership._id,
    shiftId: shift._id,
    date: d.date,
  });
  audit(req.ctx, "roster.assign", { type: "roster", id: entry._id, label: `${shift.name} · ${d.date}` });
  res.status(201).json({ entry: shapeRoster(entry, shift) });
});

// DELETE /api/staff/roster/:id
staffRouter.delete("/roster/:id", requirePerm("staff_mgmt"), async (req, res) => {
  const entry = await RosterEntry.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!entry) return res.status(404).json({ error: "not_found", message: "Roster entry not found." });
  await entry.deleteOne();
  audit(req.ctx, "roster.unassign", { type: "roster", id: entry._id });
  res.json({ ok: true });
});
