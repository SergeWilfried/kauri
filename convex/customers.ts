// convex/customers.ts — branch-scoped customer reads and writes for the mobile app
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { authz } from "./authz";
import { isWithdrawal, signedAmount } from "./transactions";
import { requireUser } from "./users";

/** Extra KYC and collection details the app keeps on a customer. */
// Personal profile (client drawer "Profil"). null or "" clears a field.
export const GENDERS = ["F", "M"] as const;
export const MARITAL_STATUSES = ["celibataire", "marie", "union", "divorce", "veuf"] as const;
export const ACTIVITY_TYPES = [
  "commerce", "restauration", "agriculture", "elevage", "artisanat",
  "transport", "services", "salarie", "autre",
] as const;
const oneOf = <T extends readonly string[]>(values: T) =>
  v.union(...values.map((x) => v.literal(x)), v.literal(""), v.null());

const metadataValidator = v.object({
  gender: v.optional(oneOf(GENDERS)),
  birthYear: v.optional(v.union(v.number(), v.null())),
  maritalStatus: v.optional(oneOf(MARITAL_STATUSES)),
  children: v.optional(v.union(v.number(), v.null())),
  activityType: v.optional(oneOf(ACTIVITY_TYPES)),
  activity: v.optional(v.union(v.string(), v.null())), // e.g. "Boutique alimentaire, marché central"
  address: v.optional(v.string()),
  groupName: v.optional(v.string()),
  commitmentAmount: v.optional(v.number()),
  collectionFrequency: v.optional(v.string()),
  collectionDays: v.optional(v.array(v.number())),
  savingsGoal: v.optional(v.number()),
  // Set from the dashboard (portfolio.ts); listed so a round trip validates
  goalCategory: v.optional(v.string()),
  goalDeadline: v.optional(v.number()),
  accountNumber: v.optional(v.string()),
  email: v.optional(v.string()),
  // Client ID in the old app's backup, set by imports.ts to match its transactions
  legacyId: v.optional(v.string()),
});

/**
 * Check the profile fields of a metadata patch and turn "" / null into
 * "remove this field" (undefined). Throws INVALID_PROFILE for an impossible
 * birth year or number of children.
 */
export function cleanProfile<T extends Record<string, unknown>>(metadata: T, now = Date.now()): T {
  const out: Record<string, unknown> = { ...metadata };
  for (const [k, val] of Object.entries(out)) {
    if (val === null || val === "") out[k] = undefined;
  }
  if (typeof out.activity === "string") out.activity = out.activity.trim().slice(0, 120) || undefined;
  const year = new Date(now).getUTCFullYear();
  if (out.birthYear !== undefined) {
    const y = out.birthYear as number;
    if (!Number.isInteger(y) || y < year - 110 || y > year - 15) throw new ConvexError("INVALID_PROFILE");
  }
  if (out.children !== undefined) {
    const c = out.children as number;
    if (!Number.isInteger(c) || c < 0 || c > 30) throw new ConvexError("INVALID_PROFILE");
  }
  return out as T;
}

/** The object without its undefined fields. */
const withoutUndefined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as T;

/** Trim a name; throw NAME_REQUIRED if empty or longer than 200 characters. */
export function cleanName(name: string) {
  const fullName = name.trim();
  if (!fullName || fullName.length > 200) throw new ConvexError("NAME_REQUIRED");
  return fullName;
}

/**
 * Drop spaces, dots, dashes and brackets and turn a leading 00 into +, so the
 * same number typed two ways is caught as a duplicate. Throw INVALID_PHONE
 * unless 8 to 15 digits remain.
 */
export function cleanPhone(phone: string) {
  const compact = phone.replace(/[\s.\-()]/g, "").replace(/^00/, "+");
  if (!/^\+?\d{8,15}$/.test(compact)) throw new ConvexError("INVALID_PHONE");
  return compact;
}

/** Trim an ID document number; throw INVALID_ID_NUMBER past 50 characters. */
export function cleanIdNumber(idNumber: string) {
  const trimmed = idNumber.trim();
  if (trimmed.length > 50) throw new ConvexError("INVALID_ID_NUMBER");
  return trimmed;
}

/** Throw PHONE_TAKEN if another customer of the branch already has this number. */
async function assertPhoneFree(
  ctx: QueryCtx,
  branchId: Doc<"customers">["branchId"],
  phoneNumber: string,
  except?: Doc<"customers">["_id"],
) {
  const clash = await ctx.db
    .query("customers")
    .withIndex("by_phone", (q) => q.eq("phoneNumber", phoneNumber))
    .filter((q) => q.eq(q.field("branchId"), branchId))
    .first();
  if (clash && clash._id !== except) throw new ConvexError("PHONE_TAKEN");
}

/**
 * Customers of the caller's branch, newest first, for the mobile app. Balance
 * (completed deposits minus completed withdrawals) and last deposit are derived
 * from the transactions, as on the dashboard.
 * ID numbers are not sent to the phone. Empty when signed out (the app
 * subscribes before its session resolves); FORBIDDEN for staff who neither
 * onboard nor verify customers (IT admin).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    if (!(await getAuthUserId(ctx))) return [];
    const caller = await requireUser(ctx);
    const [onboard, verify] = await Promise.all([
      authz.can(ctx, caller._id, "customers:create_prospect"),
      authz.can(ctx, caller._id, "customers:verify_identity"),
    ]);
    if (!onboard && !verify) throw new ConvexError("FORBIDDEN");

    const [customers, transactions] = await Promise.all([
      ctx.db
        .query("customers")
        .withIndex("by_branch", (q) => q.eq("branchId", caller.branchId))
        .order("desc")
        .collect(),
      ctx.db
        .query("transactions")
        .withIndex("by_branch", (q) => q.eq("branchId", caller.branchId))
        .filter((q) => q.eq(q.field("status"), "completed"))
        .collect(),
    ]);
    const totals = new Map<string, { balance: number; lastDeposit: number | null }>();
    for (const t of transactions) {
      const entry = totals.get(t.customerId) ?? { balance: 0, lastDeposit: null };
      entry.balance += signedAmount(t);
      if (!isWithdrawal(t) && (entry.lastDeposit === null || t.timestamp > entry.lastDeposit)) {
        entry.lastDeposit = t.timestamp;
      }
      totals.set(t.customerId, entry);
    }
    const agentNames = new Map<string, string>();
    for (const c of customers) {
      if (!agentNames.has(c.onboardedBy)) {
        agentNames.set(c.onboardedBy, (await ctx.db.get(c.onboardedBy))?.fullName ?? "—");
      }
    }

    return customers.map((c) => ({
      _id: c._id,
      fullName: c.fullName,
      phoneNumber: c.phoneNumber,
      status: c.status,
      metadata: c.metadata ?? {},
      createdAt: c._creationTime,
      balance: totals.get(c._id)?.balance ?? 0,
      lastDeposit: totals.get(c._id)?.lastDeposit ?? null,
      onboardedBy: c.onboardedBy,
      agentName: agentNames.get(c.onboardedBy)!,
    }));
  },
});

/**
 * Register a prospect in the caller's branch. Requires customers:create_prospect.
 * Branch, onboarding agent and status (`prospect`) are set here, never from
 * arguments; KYC verification stays a back-office action. The phone must be
 * unique within the branch. Returns the new customer's ID.
 */
export const createProspect = mutation({
  args: {
    fullName: v.string(),
    phoneNumber: v.string(),
    idNumber: v.optional(v.string()),
    metadata: v.optional(metadataValidator),
  },
  handler: async (ctx, args) => {
    const caller = await requireUser(ctx);
    if (!(await authz.can(ctx, caller._id, "customers:create_prospect"))) {
      throw new ConvexError("FORBIDDEN");
    }
    const fullName = cleanName(args.fullName);
    const phoneNumber = cleanPhone(args.phoneNumber);
    await assertPhoneFree(ctx, caller.branchId, phoneNumber);

    return await ctx.db.insert("customers", {
      fullName,
      phoneNumber,
      idNumber: cleanIdNumber(args.idNumber ?? ""), // "" = no ID document yet
      branchId: caller.branchId,
      onboardedBy: caller._id,
      status: "prospect",
      metadata: args.metadata ? withoutUndefined(cleanProfile(args.metadata)) : undefined,
    });
  },
});

/**
 * Edit a customer of the caller's branch. Only fields passed are changed;
 * metadata is merged. The phone, the ID number, and the name of a verified
 * customer need customers:edit_sensitive; other fields need
 * customers:create_prospect. Status can't be changed here. A customer outside
 * the branch reads as FORBIDDEN, like one that doesn't exist.
 */
export const update = mutation({
  args: {
    id: v.id("customers"),
    fullName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    idNumber: v.optional(v.string()),
    metadata: v.optional(metadataValidator),
  },
  handler: async (ctx, { id, ...fields }) => {
    const caller = await requireUser(ctx);
    const customer = await ctx.db.get(id);
    if (!customer || customer.branchId !== caller.branchId) throw new ConvexError("FORBIDDEN");

    const patch: Partial<Doc<"customers">> = {};
    if (fields.fullName !== undefined) patch.fullName = cleanName(fields.fullName);
    if (fields.phoneNumber !== undefined) patch.phoneNumber = cleanPhone(fields.phoneNumber);
    if (fields.idNumber !== undefined) patch.idNumber = cleanIdNumber(fields.idNumber);
    if (fields.metadata !== undefined) {
      // Fields cleared by the patch disappear instead of being stored as undefined
      patch.metadata = withoutUndefined({ ...(customer.metadata ?? {}), ...cleanProfile(fields.metadata) });
    }

    const sensitive =
      (patch.phoneNumber !== undefined && patch.phoneNumber !== customer.phoneNumber) ||
      (patch.idNumber !== undefined && patch.idNumber !== customer.idNumber) ||
      (customer.status === "verified" && patch.fullName !== undefined && patch.fullName !== customer.fullName);
    const permission = sensitive ? "customers:edit_sensitive" : "customers:create_prospect";
    if (!(await authz.can(ctx, caller._id, permission))) throw new ConvexError("FORBIDDEN");

    if (patch.phoneNumber !== undefined && patch.phoneNumber !== customer.phoneNumber) {
      await assertPhoneFree(ctx, customer.branchId, patch.phoneNumber, customer._id);
    }
    await ctx.db.patch(id, patch);
    return null;
  },
});

// Largest ID photo accepted (bytes)
export const MAX_ID_IMAGE_BYTES = 5 * 1024 * 1024;
const idSide = v.union(v.literal("front"), v.literal("back"));

/** True for an uploaded file usable as an ID photo: an image of at most MAX_ID_IMAGE_BYTES. */
export function acceptableIdImage(file: { contentType?: string; size: number } | null) {
  return !!file && !!file.contentType?.startsWith("image/") && file.size > 0 && file.size <= MAX_ID_IMAGE_BYTES;
}

/** The caller, checked for customers:verify_identity, and a customer of their branch. */
async function requireIdEditor(ctx: MutationCtx, customerId: Id<"customers">) {
  const caller = await requireUser(ctx);
  if (!(await authz.can(ctx, caller._id, "customers:verify_identity"))) throw new ConvexError("FORBIDDEN");
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.branchId !== caller.branchId) throw new ConvexError("FORBIDDEN");
  return customer;
}

/** A one-time URL to upload an ID photo to (then pass the storage id to setIdImage). */
export const generateIdUploadUrl = mutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, { customerId }) => {
    await requireIdEditor(ctx, customerId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Attach an uploaded photo as the front or back of the customer's ID
 * document, replacing (and deleting) the previous one. Needs
 * customers:verify_identity. A file that isn't an image or is over
 * MAX_ID_IMAGE_BYTES is deleted and `"INVALID_IMAGE"` returned (not thrown:
 * a throw would roll the delete back and leave the file in storage);
 * `"ok"` otherwise.
 */
export const setIdImage = mutation({
  args: { customerId: v.id("customers"), side: idSide, storageId: v.id("_storage") },
  handler: async (ctx, { customerId, side, storageId }) => {
    const customer = await requireIdEditor(ctx, customerId);
    const file = await ctx.db.system.get(storageId);
    if (!acceptableIdImage(file)) {
      if (file) await ctx.storage.delete(storageId);
      return "INVALID_IMAGE" as const;
    }
    const previous = customer.idImages?.[side];
    if (previous && previous !== storageId) await ctx.storage.delete(previous);
    await ctx.db.patch(customerId, { idImages: { ...customer.idImages, [side]: storageId } });
    return "ok" as const;
  },
});

/**
 * Viewable URLs of the customer's ID photos, null for a side not provided.
 * For the back office (transactions:audit or customers:verify_identity) of
 * the customer's branch.
 */
export const idImages = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, { customerId }) => {
    const caller = await requireUser(ctx);
    const [audit, verify] = await Promise.all([
      authz.can(ctx, caller._id, "transactions:audit"),
      authz.can(ctx, caller._id, "customers:verify_identity"),
    ]);
    if (!audit && !verify) throw new ConvexError("FORBIDDEN");
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.branchId !== caller.branchId) throw new ConvexError("FORBIDDEN");
    const url = (id?: Id<"_storage">) => (id ? ctx.storage.getUrl(id) : Promise.resolve(null));
    const [front, back] = await Promise.all([url(customer.idImages?.front), url(customer.idImages?.back)]);
    return { front, back };
  },
});
