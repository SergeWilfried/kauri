// convex/deviceKeys.ts — PIN-only sign-in on a phone after its first setup.
//
// The first sign-in on a phone needs the password (and the network). Once the
// agent has chosen their PIN, the app asks for a device key (issue) and keeps
// it in its secure storage. From then on the PIN, checked on the phone, is all
// the agent types: when the server session expires, the app signs back in
// with the key ("deviceKey" provider, auth.ts) as soon as it is online.
// beforeSessionCreation still refuses suspended accounts.
import { getAuthSessionId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { internalMutation, mutation, MutationCtx } from "./_generated/server";
import { requireUser } from "./users";

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keys one staff member may hold: bounds what revokeDeviceKeys deletes in one go. */
const MAX_DEVICE_KEYS_PER_USER = 20;

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Delete every device key of `userId`: their phones need the password again. */
export async function revokeDeviceKeys(ctx: MutationCtx, userId: Id<"users">) {
  const keys = await ctx.db
    .query("deviceKeys")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  await Promise.all(keys.map((k) => ctx.db.delete(k._id)));
}

/** revokeDeviceKeys for actions (passwordReset.resetPassword). */
export const revokeAll = internalMutation({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) => revokeDeviceKeys(ctx, userId),
});

/**
 * A new device key for the signed-in staff member on this app install
 * (`installId`, chosen by the phone), replacing the install's previous one.
 * Returns `{ keyId, secret }` once; only the secret's hash is stored.
 * Refused once the caller's session has been ended (a password reset or
 * suspension), even while its access token is still valid: a key issued then
 * would outlive the revocation. Throws `SESSION_ENDED`, `INVALID_INSTALL_ID`
 * or `TOO_MANY_DEVICE_KEYS`.
 */
export const issue = mutation({
  args: { installId: v.string() },
  handler: async (ctx, { installId }) => {
    const user = await requireUser(ctx);
    const sessionId = await getAuthSessionId(ctx);
    const session = sessionId && ctx.db.normalizeId("authSessions", sessionId);
    if (!session || !(await ctx.db.get(session))) throw new ConvexError("SESSION_ENDED");
    if (!/^[\w-]{8,64}$/.test(installId)) throw new ConvexError("INVALID_INSTALL_ID");
    const previous = await ctx.db
      .query("deviceKeys")
      .withIndex("by_user_install", (q) => q.eq("userId", user._id).eq("installId", installId))
      .collect();
    await Promise.all(previous.map((k) => ctx.db.delete(k._id)));
    const held = await ctx.db
      .query("deviceKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_DEVICE_KEYS_PER_USER);
    if (held.length >= MAX_DEVICE_KEYS_PER_USER) throw new ConvexError("TOO_MANY_DEVICE_KEYS");
    const secret = randomSecret();
    const keyId = await ctx.db.insert("deviceKeys", {
      userId: user._id,
      installId,
      secretHash: await sha256Hex(secret),
      createdAt: Date.now(),
    });
    return { keyId, secret };
  },
});

/** Delete the caller's key `keyId` ("Retirer ce téléphone" in the app). */
export const revoke = mutation({
  args: { keyId: v.string() },
  handler: async (ctx, { keyId }) => {
    const user = await requireUser(ctx);
    const id = ctx.db.normalizeId("deviceKeys", keyId);
    const key = id ? await ctx.db.get(id) : null;
    if (key && key.userId === user._id) await ctx.db.delete(key._id);
  },
});

/**
 * The staff member a device key signs in, or null when the key is unknown,
 * deleted or its secret wrong (the caller can't tell which). Records its use.
 */
export const verify = internalMutation({
  args: { keyId: v.string(), secret: v.string() },
  handler: async (ctx, { keyId, secret }) => {
    const id = ctx.db.normalizeId("deviceKeys", keyId);
    const key = id ? await ctx.db.get(id) : null;
    if (!key || (await sha256Hex(secret)) !== key.secretHash) return null;
    await ctx.db.patch(key._id, { lastUsedAt: Date.now() });
    return key.userId;
  },
});
