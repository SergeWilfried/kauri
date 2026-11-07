// convex/passwordReset.ts — "Mot de passe oublié" for activated staff accounts.
// An administrator issues a one-time code (staff.issueResetCode); the staff
// member trades it, with their email or phone, for a new password. Same code storage
// as activation: only the hash, 48h, single use.
import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";
import { hashActivationCode } from "./users";
import { revokeDeviceKeys } from "./deviceKeys";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Check and burn a reset code. Returns the staff member's ID, or null when the
 * email, account or code doesn't match: callers can't tell which.
 */
export const consumeResetCode = internalMutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .unique();
    if (!user || user.status !== "active") return null;
    // Only for accounts that already have a password; first login is "Première connexion"
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id).eq("provider", "password"))
      .first();
    if (!account || account.providerAccountId !== args.email) return null;
    if (
      !user.activationCodeHash ||
      !user.activationExpiresAt ||
      user.activationExpiresAt < Date.now() ||
      (await hashActivationCode(args.code)) !== user.activationCodeHash
    ) {
      return null;
    }
    await ctx.db.patch(user._id, { activationCodeHash: undefined, activationExpiresAt: undefined });
    // A reset secures the account: phones need the new password, not just a PIN
    await revokeDeviceKeys(ctx, user._id);
    return user._id;
  },
});

/**
 * Set a new password with an administrator-issued reset code, then sign the
 * account out everywhere. Identify the account by `email` (dashboard) or
 * `phone` (mobile app). Throws `WEAK_PASSWORD`, or `RESET_REFUSED` for any
 * wrong identifier, code or account state.
 */
export const resetPassword = action({
  args: {
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    code: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.newPassword.length < MIN_PASSWORD_LENGTH) throw new ConvexError("WEAK_PASSWORD");
    const email =
      args.phone !== undefined
        ? await ctx.runQuery(internal.users.staffEmailByPhone, { phone: args.phone })
        : args.email?.trim().toLowerCase();
    if (!email) throw new ConvexError("RESET_REFUSED");
    const userId = await ctx.runMutation(internal.passwordReset.consumeResetCode, {
      email,
      code: args.code.trim().toUpperCase(),
    });
    if (!userId) throw new ConvexError("RESET_REFUSED");
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: args.newPassword },
    });
    await invalidateSessions(ctx, { userId });
  },
});
