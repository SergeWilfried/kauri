// convex/channelApi.ts — what a partner app (Nafa) can do through the HTTP API
//
// http.ts checks nothing but the shape of the request: every function here
// takes the hash of the caller's key and resolves the partner itself
// (apiClients.requireApiClient). A partner works in its service staff
// member's branch, on its own customers only.
//
// A customer holds one balance per product (a "vault"): the completed
// movements carrying that productId. A product with a minimum duration locks
// its balance for that many months after the customer's first deposit on it.
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, MutationCtx, QueryCtx } from "./_generated/server";
import { ApiCaller, publicPartner, requireApiClient } from "./apiClients";
import { cleanIdNumber, cleanName, cleanPhone } from "./customers";
import { scheduleLedgerPost } from "./ledger";
import { customerBalance, isWithdrawal, MAX_AMOUNT, signedAmount } from "./transactions";

const DAY = 86_400_000;
/** How long after a withdrawal the partner may cancel it (failed transfer). */
const CANCEL_WINDOW_MS = DAY;
/** Product families that hold savings; credit and insurance aren't deposits. */
const SAVINGS_FAMILIES = ["epargne", "tontine"];

const utcDay = (ms: number) => new Date(ms).toISOString().split("T")[0];

/** `ms` plus `months` calendar months (UTC), for lock end dates. */
function addMonths(ms: number, months: number) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

/** A customer of the partner's branch, or CUSTOMER_NOT_FOUND. */
async function ownCustomer(ctx: QueryCtx, caller: ApiCaller, customerId: string) {
  const id = ctx.db.normalizeId("customers", customerId);
  const customer = id ? await ctx.db.get(id) : null;
  if (!customer || customer.branchId !== caller.branch._id) throw new ConvexError("CUSTOMER_NOT_FOUND");
  return customer;
}

/** A product of the partner's organization by code, or PRODUCT_NOT_FOUND. */
async function productByCode(ctx: QueryCtx, caller: ApiCaller, code: string) {
  const product = await ctx.db
    .query("products")
    .withIndex("by_organization_code", (q) =>
      q.eq("organizationId", caller.organization._id).eq("code", code.trim().toUpperCase()),
    )
    .first();
  if (!product) throw new ConvexError("PRODUCT_NOT_FOUND");
  return product;
}

/** Whether the partner may open or pay into this product now. */
function offered(caller: ApiCaller, p: Doc<"products">) {
  return (
    p.status === "actif" &&
    SAVINGS_FAMILIES.includes(p.family) &&
    (p.channels ?? []).includes(caller.client.channel) &&
    p.branchIds.includes(caller.branch._id)
  );
}

/** Completed movements of one customer on one product, oldest first. */
async function vaultRows(ctx: QueryCtx, customerId: Id<"customers">, productId: Id<"products">) {
  const rows = await ctx.db
    .query("transactions")
    .withIndex("by_customer_product", (q) => q.eq("customerId", customerId).eq("productId", productId))
    .collect();
  return rows.filter((t) => t.status === "completed").sort((a, b) => a.timestamp - b.timestamp);
}

/** Balance, first deposit and lock end of a vault, from its completed movements. */
function vaultState(product: Doc<"products">, rows: Doc<"transactions">[]) {
  const balance = rows.reduce((s, t) => s + signedAmount(t), 0);
  const firstDeposit = rows.find((t) => !isWithdrawal(t))?.timestamp ?? null;
  const lockedUntil =
    firstDeposit !== null && product.durationMin > 0 ? addMonths(firstDeposit, product.durationMin) : null;
  return { balance, firstDepositAt: firstDeposit, lockedUntil };
}

/** The public terms of a product, as the partner shows them. */
function publicProduct(p: Doc<"products">) {
  return {
    code: p.code,
    name: p.name,
    family: p.family,
    summary: p.summary,
    rate: p.rate,
    durationMin: p.durationMin,
    durationMax: p.durationMax,
    minDeposit: p.minDeposit,
    maxBalance: p.maxBalance,
    fees: p.fees,
    feesUnit: p.feesUnit,
    grace: p.grace,
    kycLevel: p.kycLevel,
    updatedAt: p.updatedAt,
  };
}

/** Throw DAY_CLOSED if the accountant already reconciled the partner's day. */
async function assertDayOpen(ctx: QueryCtx, userId: Id<"users">, ms: number) {
  const closed = await ctx.db
    .query("reconciliations")
    .withIndex("by_agent_date", (q) => q.eq("agentId", userId).eq("date", utcDay(ms)))
    .first();
  if (closed) throw new ConvexError("DAY_CLOSED");
}

/** Active savings products the partner may offer, sorted by name. */
async function offeredCatalogue(ctx: QueryCtx, caller: ApiCaller) {
  const products = await ctx.db
    .query("products")
    .withIndex("by_organization", (q) => q.eq("organizationId", caller.organization._id))
    .collect();
  return {
    currency: caller.organization.currency,
    products: products
      .filter((p) => offered(caller, p))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map(publicProduct),
  };
}

export const catalogue = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => offeredCatalogue(ctx, await requireApiClient(ctx, args.keyHash)),
});

/**
 * The same catalogue without a key, for the partner's app to show its offer:
 * only public terms, as on a brochure.
 */
export const publicCatalogue = internalQuery({
  args: { partnerId: v.string() },
  handler: async (ctx, args) => offeredCatalogue(ctx, await publicPartner(ctx, args.partnerId)),
});

/**
 * Register a customer as a prospect in the partner's branch; KYC verification
 * stays a back-office action on the dashboard. PHONE_TAKEN (with the existing
 * customerId) if the branch already has this phone.
 */
export const createCustomer = internalMutation({
  args: {
    keyHash: v.string(),
    fullName: v.string(),
    phoneNumber: v.string(),
    idNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const caller = await requireApiClient(ctx, args.keyHash);
    const fullName = cleanName(args.fullName);
    const phoneNumber = cleanPhone(args.phoneNumber);
    // Same rule as customers.createProspect: one customer per phone in a branch
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", phoneNumber))
      .filter((q) => q.eq(q.field("branchId"), caller.branch._id))
      .first();
    if (existing) throw new ConvexError({ code: "PHONE_TAKEN", customerId: existing._id });
    const customerId = await ctx.db.insert("customers", {
      fullName,
      phoneNumber,
      idNumber: cleanIdNumber(args.idNumber ?? ""),
      branchId: caller.branch._id,
      onboardedBy: caller.user._id,
      status: "prospect",
    });
    return { customerId, status: "prospect" as const };
  },
});

/** A customer's KYC status and vaults (one per product they have used). */
export const customer = internalQuery({
  args: { keyHash: v.string(), customerId: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireApiClient(ctx, args.keyHash);
    const customer = await ownCustomer(ctx, caller, args.customerId);
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    const productIds = [...new Set(rows.flatMap((t) => (t.productId ? [t.productId] : [])))];
    const vaults = [];
    for (const productId of productIds) {
      const product = await ctx.db.get(productId);
      if (!product) continue;
      const completed = rows
        .filter((t) => t.productId === productId && t.status === "completed")
        .sort((a, b) => a.timestamp - b.timestamp);
      vaults.push({
        productCode: product.code,
        productName: product.name,
        rate: product.rate,
        ...vaultState(product, completed),
      });
    }
    return {
      customerId: customer._id,
      fullName: customer.fullName,
      phoneNumber: customer.phoneNumber,
      status: customer.status,
      balance: await customerBalance(ctx, customer._id),
      vaults,
    };
  },
});

/** A customer's movements, newest first, optionally on one product. */
export const transactions = internalQuery({
  args: {
    keyHash: v.string(),
    customerId: v.string(),
    productCode: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const caller = await requireApiClient(ctx, args.keyHash);
    const customer = await ownCustomer(ctx, caller, args.customerId);
    const product = args.productCode ? await productByCode(ctx, caller, args.productCode) : null;
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 500);
    const rows = await (product
      ? ctx.db
          .query("transactions")
          .withIndex("by_customer_product", (q) => q.eq("customerId", customer._id).eq("productId", product._id))
      : ctx.db.query("transactions").withIndex("by_customer", (q) => q.eq("customerId", customer._id))
    )
      .order("desc")
      .take(limit);
    const codes = new Map<string, string>();
    for (const t of rows) {
      if (t.productId && !codes.has(t.productId)) codes.set(t.productId, (await ctx.db.get(t.productId))?.code ?? "");
    }
    return rows.map((t) => ({
      transactionId: t._id,
      reference: t.clientId ?? null,
      type: isWithdrawal(t) ? ("withdrawal" as const) : ("deposit" as const),
      amount: t.amount,
      currency: t.currency,
      productCode: t.productId ? codes.get(t.productId)! : null,
      status: t.status,
      reversalReason: t.reversalReason ?? null,
      timestamp: t.timestamp,
    }));
  },
});

const movementArgs = {
  keyHash: v.string(),
  customerId: v.string(),
  productCode: v.string(),
  amount: v.number(),
  reference: v.string(),
};

/**
 * Credit or debit a customer's vault. `reference` is the partner's payment ID:
 * replaying it returns the movement already stored, so a retried call never
 * moves money twice.
 *
 * Deposits (call once the customer's mobile money payment is confirmed): the
 * product must be offered to the partner (PRODUCT_NOT_AVAILABLE); the first
 * deposit must reach minDeposit (BELOW_MIN_DEPOSIT); the balance may not pass
 * maxBalance (OVER_MAX_BALANCE); rejected customers can't save (CUSTOMER_REJECTED).
 *
 * Withdrawals (call before sending the transfer; cancel it if the transfer
 * fails): refused while the vault is locked (LOCKED, with lockedUntil) or
 * short of the amount (INSUFFICIENT_BALANCE). They work on a product the
 * partner no longer offers, so a customer can always take their money out.
 */
async function recordMovement(
  ctx: MutationCtx,
  type: "deposit" | "withdrawal",
  args: { keyHash: string; customerId: string; productCode: string; amount: number; reference: string },
) {
  const caller = await requireApiClient(ctx, args.keyHash);
  const reference = args.reference.trim();
  if (!reference || reference.length > 64) throw new ConvexError("INVALID_REFERENCE");
  const customer = await ownCustomer(ctx, caller, args.customerId);
  const product = await productByCode(ctx, caller, args.productCode);

  const previous = await ctx.db
    .query("transactions")
    .withIndex("by_client_id", (q) => q.eq("clientId", reference))
    .first();
  if (previous) {
    const same =
      previous.agentId === caller.user._id &&
      isWithdrawal(previous) === (type === "withdrawal") &&
      previous.customerId === customer._id &&
      previous.productId === product._id &&
      previous.amount === args.amount;
    if (!same) throw new ConvexError("DUPLICATE_REFERENCE");
    const state = vaultState(product, await vaultRows(ctx, customer._id, product._id));
    return { transactionId: previous._id, status: previous.status, balance: state.balance, replayed: true };
  }

  if (!Number.isInteger(args.amount) || args.amount <= 0 || args.amount > MAX_AMOUNT) {
    throw new ConvexError("INVALID_AMOUNT");
  }
  const now = Date.now();
  await assertDayOpen(ctx, caller.user._id, now);
  const state = vaultState(product, await vaultRows(ctx, customer._id, product._id));

  if (type === "deposit") {
    if (customer.status === "rejected") throw new ConvexError("CUSTOMER_REJECTED");
    if (!offered(caller, product)) throw new ConvexError("PRODUCT_NOT_AVAILABLE");
    if (state.firstDepositAt === null && args.amount < product.minDeposit) {
      throw new ConvexError({ code: "BELOW_MIN_DEPOSIT", minDeposit: product.minDeposit });
    }
    if (product.maxBalance > 0 && state.balance + args.amount > product.maxBalance) {
      throw new ConvexError({ code: "OVER_MAX_BALANCE", maxBalance: product.maxBalance });
    }
  } else {
    if (state.lockedUntil !== null && now < state.lockedUntil) {
      throw new ConvexError({ code: "LOCKED", lockedUntil: state.lockedUntil });
    }
    // Mutations are serialized, so two withdrawals can't both pass this check
    if (state.balance < args.amount) throw new ConvexError("INSUFFICIENT_BALANCE");
  }

  const transactionId = await ctx.db.insert("transactions", {
    type,
    amount: args.amount,
    currency: caller.organization.currency,
    customerId: customer._id,
    agentId: caller.user._id,
    branchId: caller.branch._id,
    tpeId: "API",
    channel: "api",
    productId: product._id,
    status: "completed",
    timestamp: now,
    clientId: reference,
  });
  await scheduleLedgerPost(ctx, transactionId);
  const balance = state.balance + (type === "deposit" ? args.amount : -args.amount);
  return { transactionId, status: "completed" as const, balance, replayed: false };
}

export const deposit = internalMutation({
  args: movementArgs,
  handler: (ctx, args) => recordMovement(ctx, "deposit", args),
});

export const withdraw = internalMutation({
  args: movementArgs,
  handler: (ctx, args) => recordMovement(ctx, "withdrawal", args),
});

/**
 * Cancel a withdrawal whose transfer failed, putting the money back in the
 * vault. Only the partner's own withdrawals, within CANCEL_WINDOW_MS and
 * before its day is reconciled. Cancelling twice is a no-op.
 */
export const cancelWithdrawal = internalMutation({
  args: { keyHash: v.string(), reference: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireApiClient(ctx, args.keyHash);
    const tx = await ctx.db
      .query("transactions")
      .withIndex("by_client_id", (q) => q.eq("clientId", args.reference.trim()))
      .first();
    if (!tx || tx.agentId !== caller.user._id || !isWithdrawal(tx)) throw new ConvexError("TRANSACTION_NOT_FOUND");
    if (tx.status === "reversed") return { transactionId: tx._id, status: tx.status };
    if (Date.now() - tx.timestamp > CANCEL_WINDOW_MS) throw new ConvexError("CANCEL_WINDOW_PASSED");
    await assertDayOpen(ctx, caller.user._id, tx.timestamp);
    const reason = args.reason.trim().slice(0, 200) || "Virement échoué";
    await ctx.db.patch(tx._id, {
      status: "reversed",
      reversalReason: `API : ${reason}`,
      reversedBy: caller.user._id,
    });
    return { transactionId: tx._id, status: "reversed" as const };
  },
});
