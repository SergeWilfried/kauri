// convex/auth.ts — staff sign-in (email or phone + password, invite-only)
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, createAccount, retrieveAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { hashActivationCode } from "./users";

const MIN_PASSWORD_LENGTH = 8;

const normalizeEmail = (email: unknown) => String(email ?? "").trim().toLowerCase();

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      // Same lowercase account ID for sign-up and sign-in. The activation code
      // only travels to createOrUpdateUser; it is never stored on the account.
      profile: (params) =>
        ({
          email: normalizeEmail(params.email),
          activationCode: typeof params.code === "string" ? params.code.trim().toUpperCase() : undefined,
        }) as any,
    }),
    // Field agents sign in with their phone: signIn("phone", { phone, password,
    // flow }). The phone only finds the staff member; the password is checked
    // against, or for "Première connexion" (flow "signUp" + code) set on, the
    // same email-keyed "password" account the dashboard uses. So one password
    // works with either identifier, and activation keeps its code check.
    ConvexCredentials({
      id: "phone",
      authorize: async (params, ctx) => {
        const password = typeof params.password === "string" ? params.password : "";
        const email =
          typeof params.phone === "string"
            ? await ctx.runQuery(internal.users.staffEmailByPhone, { phone: params.phone })
            : null;
        // Same message whatever is wrong, so the form doesn't reveal staff phones
        if (!email || !password) throw new Error("Invalid credentials");
        if (params.flow === "signIn") {
          const { user } = await retrieveAccount(ctx, {
            provider: "password",
            account: { id: email, secret: password },
          });
          return { userId: user._id };
        }
        if (params.flow === "signUp") {
          if (password.length < MIN_PASSWORD_LENGTH) throw new Error("Invalid password");
          const { user } = await createAccount(ctx, {
            provider: "password",
            account: { id: email, secret: password },
            profile: {
              email,
              activationCode: typeof params.code === "string" ? params.code.trim().toUpperCase() : undefined,
            } as any,
          });
          return { userId: user._id };
        }
        throw new Error("Invalid credentials");
      },
    }),
    // A phone where the agent set their PIN signs them back in with its
    // device key once the session has expired (deviceKeys.ts):
    // signIn("deviceKey", { keyId, secret }). No password, no account.
    ConvexCredentials({
      id: "deviceKey",
      authorize: async (params, ctx) => {
        const keyId = typeof params.keyId === "string" ? params.keyId : "";
        const secret = typeof params.secret === "string" ? params.secret : "";
        const userId = keyId && secret
          ? await ctx.runMutation(internal.deviceKeys.verify, { keyId, secret })
          : null;
        if (!userId) throw new Error("Invalid credentials");
        return { userId };
      },
    }),
  ],
  callbacks: {
    // Staff are created by an administrator (or the seed), never by sign-up.
    // "Première connexion" (signUp) links a password to an existing, active
    // staff row, and only with the one-time code an administrator issued for
    // that email: knowing a staff email is not enough to claim the account.
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId) return args.existingUserId;

      const email = normalizeEmail(args.profile.email);
      const code = args.profile.activationCode;
      const staff = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .unique();
      if (!staff || staff.status !== "active") throw new Error("Activation refused");
      if (
        typeof code !== "string" ||
        !staff.activationCodeHash ||
        !staff.activationExpiresAt ||
        staff.activationExpiresAt < Date.now() ||
        (await hashActivationCode(code)) !== staff.activationCodeHash
      ) {
        throw new Error("Activation refused");
      }
      // One-time use
      await ctx.db.patch(staff._id, { activationCodeHash: undefined, activationExpiresAt: undefined });
      return staff._id;
    },

    // Every new session, including plain sign-ins that skip createOrUpdateUser
    async beforeSessionCreation(ctx, { userId }) {
      const user = await ctx.db.get(userId);
      if (!user || user.status !== "active") throw new Error("Account suspended");
    },
  },
});
