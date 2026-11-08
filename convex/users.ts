// convex/users.ts — current staff member, and role administration
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, MutationCtx, query, QueryCtx } from "./_generated/server";
import { authz } from "./authz";
import { deviceOfUser } from "./deviceAccess";

export const ROLE = v.union(
  v.literal("field_agent"),
  v.literal("supervisor"),
  v.literal("accountant"),
  v.literal("it_admin"),
);

const ACTIVATION_TTL_MS = 48 * 60 * 60 * 1000;
// No 0/O/1/I so codes survive being read out over the phone
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** SHA-256 hex digest of an activation code, the only form in which codes are stored. */
export async function hashActivationCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Canonical form of a staff phone number, the form stored in `users.phoneNumber`
 * and used to sign in: separators dropped, a leading 00 turned into +, and an
 * 8-digit local number given the Burkina Faso prefix (+226). So "70 11 22 33",
 * "+226 70-11-22-33" and "0022670112233" are all "+22670112233". Null when the
 * input isn't a phone number.
 */
export function normalizeStaffPhone(phone: string): string | null {
  let p = phone.replace(/[\s.\-()]/g, "").replace(/^00/, "+");
  if (/^\d{8}$/.test(p)) p = `+226${p}`;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

/**
 * The email (password account ID) of the staff member with this phone, for
 * phone sign-in and reset. Null when unknown, malformed or shared by two rows.
 */
export const staffEmailByPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const phone = normalizeStaffPhone(args.phone);
    if (!phone) return null;
    const matches = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", phone))
      .take(2);
    return matches.length === 1 ? matches[0].email : null;
  },
});

/**
 * One-off: rewrite every staff phone in canonical form so phone sign-in finds
 * it. Reports rows it can't parse and numbers shared by several staff members;
 * fix those from the dashboard, since phone sign-in refuses them.
 *   npx convex run users:normalizeStaffPhones
 */
export const normalizeStaffPhones = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const invalid: string[] = [];
    const seen = new Map<string, number>();
    let updated = 0;
    for (const user of users) {
      const phone = normalizeStaffPhone(user.phoneNumber);
      if (!phone) {
        invalid.push(user.email);
        continue;
      }
      seen.set(phone, (seen.get(phone) ?? 0) + 1);
      if (phone !== user.phoneNumber) {
        await ctx.db.patch(user._id, { phoneNumber: phone });
        updated++;
      }
    }
    const duplicates = [...seen].filter(([, n]) => n > 1).map(([phone]) => phone);
    return { updated, invalid, duplicates };
  },
});

/**
 * Return the signed-in, active staff member; throw if unauthenticated, missing or suspended. Authz user IDs are `users._id`.
 * The errors are ConvexErrors ("Unauthenticated", "User not found", "Account
 * suspended") so clients can tell them apart in production, where a plain
 * Error reaches them as "Server Error".
 */
export async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Unauthenticated");
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("User not found");
  if (user.status !== "active") throw new ConvexError("Account suspended");
  return user;
}

/**
 * Refuse a call sent for another staff member: on a shared TPE, Convex sends a
 * call held while offline with whichever agent is signed in when the network
 * returns. Throws `AGENT_MISMATCH`; the app keeps the call for its own agent.
 */
export function requireExpectedUser(user: { _id: string }, expected: string | undefined) {
  if (expected !== undefined && expected !== user._id) throw new ConvexError("AGENT_MISMATCH");
}

/**
 * The terminal a staff member may collect with (one at most, possibly shared
 * with other agents), as the mobile app needs it to check it runs on that
 * TPE, or null. Serial format: BRAND-MODEL-INSTALLID.
 */
export async function assignedDevice(ctx: QueryCtx, userId: Id<"users">) {
  const device = await deviceOfUser(ctx, userId);
  return device ? { serialNumber: device.serialNumber, model: device.model, status: device.status } : null;
}

/**
 * The signed-in staff member for the dashboard and the mobile app: `null` when signed out, `{ active: false }` when suspended, otherwise profile (incl. `branchId`, `phoneNumber`, `organization`), roles, bound `device` and `can` flags. The flags are UI hints only; every mutation checks its own permission.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    if (user.status !== "active") return { id: user._id, name: user.fullName, active: false as const };
    const can = (permission: Parameters<typeof authz.can>[2]) =>
      authz.can(ctx, user._id, permission).catch(() => false);
    const [branch, device, roles, withdraw, audit, reverse, approve, liquidate, bind, manageStaff, importData, managePortfolio, verifyIdentity, editCustomers] = await Promise.all([
      ctx.db.get(user.branchId),
      assignedDevice(ctx, user._id),
      authz.getUserRoles(ctx, user._id).catch(() => []),
      can("transactions:withdraw"),
      can("transactions:audit"),
      can("transactions:reverse"),
      can("disbursements:approve"),
      can("reconciliation:liquidate"),
      can("devices:bind"),
      can("staff:manage"),
      can("data:import"),
      can("portfolio:manage"),
      can("customers:verify_identity"),
      can("customers:create_prospect"),
    ]);
    const organization = branch ? await ctx.db.get(branch.organizationId) : null;
    return {
      id: user._id,
      active: true as const,
      name: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      branchId: user.branchId,
      branch: branch?.name ?? null,
      organization: organization ? { name: organization.name, currency: organization.currency } : null,
      roles: roles.map((r) => r.role),
      device,
      // UI hints only: every mutation re-checks its own permission
      can: { withdraw, audit, reverse, approve, liquidate, bind, manageStaff, importData, managePortfolio, verifyIdentity, editCustomers },
    };
  },
});

/**
 * Rebuild every user's permissions from the current role definitions in
 * authz.ts. convex-authz stores a copy of a role's permissions when the role is
 * assigned, so a permission added to a role later (e.g. staff:manage on
 * it_admin) only reaches existing users after this runs. Run it after each
 * deploy that changes defineRoles():
 *   npx convex run users:syncRolePermissions
 */
export const syncRolePermissions = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Per user rather than authz.syncRoles(): that pages inside the component,
    // which Convex doesn't support. Staff count is small enough for one pass.
    const users = await ctx.db.query("users").collect();
    for (const user of users) await authz.recomputeUser(ctx, user._id);
    return { usersProcessed: users.length };
  },
});

/** Bootstrap / admin tool: npx convex run users:assignRole '{"email":"…","role":"it_admin"}' */
export const assignRole = internalMutation({
  args: { email: v.string(), role: ROLE },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!user) throw new Error("No staff account for this email");
    await authz.assignRole(ctx, user._id, args.role);
    return user._id;
  },
});

/**
 * Issue a one-time code from the CLI: for "Première connexion" if the account has no password yet, otherwise for "Mot de passe oublié". Re-issuing replaces the previous code. Only the hash is stored.
 *   npx convex run users:issueActivationCode '{"email":"…"}'
 */
export const issueActivationCode = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!user) throw new Error("No staff account for this email");
    return createActivationCode(ctx, user);
  },
});

/**
 * Generate a 48h activation code for an active user and store its hash. Returns the plain code and its expiry. Shared by the CLI mutation above and `staff.issueActivationCode` / `staff.issueResetCode` (UI).
 */
export async function createActivationCode(ctx: MutationCtx, user: Doc<"users">) {
  if (user.status !== "active") throw new Error("Account suspended");
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  const expiresAt = Date.now() + ACTIVATION_TTL_MS;
  await ctx.db.patch(user._id, {
    activationCodeHash: await hashActivationCode(code),
    activationExpiresAt: expiresAt,
  });
  return { code, expiresAt: new Date(expiresAt).toISOString() };
}
