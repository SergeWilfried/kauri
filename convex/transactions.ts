// convex/transactions.ts
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, Infer, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { authz } from "./authz";
import { cleanFix } from "./devices";
import { scheduleLedgerPost } from "./ledger";
import { geoFix } from "./schema";
import { assignedDevice, requireExpectedUser, requireUser } from "./users";

export const MAX_AMOUNT = 100_000_000; // sanity cap, in the branch currency
/**
 * Largest withdrawal an agent may pay out while offline. The app enforces it
 * before queuing; the server refuses anything larger so a modified client
 * can't bypass it.
 */
export const OFFLINE_WITHDRAWAL_CAP = 25_000;

/** The UTC day (YYYY-MM-DD) of a timestamp, as reconciliation.ts files it. */
const utcDay = (ms: number) => new Date(ms).toISOString().split("T")[0];

/** Rows written before withdrawals existed have no type: they are deposits. */
export const isWithdrawal = (t: Doc<"transactions">) => t.type === "withdrawal";

/**
 * A transaction's effect on the customer's balance and on the agent's cash:
 * deposits add, withdrawals subtract. Callers filter on status themselves.
 */
export const signedAmount = (t: Doc<"transactions">) => (isWithdrawal(t) ? -t.amount : t.amount);

/** A customer's balance: completed deposits minus completed withdrawals. */
export async function customerBalance(ctx: QueryCtx, customerId: Id<"customers">) {
  const rows = await ctx.db
    .query("transactions")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  return rows.filter((t) => t.status === "completed").reduce((s, t) => s + signedAmount(t), 0);
}

const movementArgs = {
  customerId: v.id("customers"),
  amount: v.number(),
  clientId: v.string(),
  // When and where the agent recorded it on the TPE (stored as reported,
  // for the audit: the server's own `timestamp` stays authoritative)
  recordedAt: v.optional(v.number()),
  location: v.optional(geoFix),
  // The agent who recorded it on the TPE (see requireExpectedUser)
  expectedAgentId: v.optional(v.string()),
};

/**
 * Record a cash movement by the signed-in agent. The agent, branch, TPE (the
 * agent's bound device) and time come from the server, never from arguments.
 * `clientId` is the UUID the app generated when it recorded the movement:
 * replaying the same one returns the row already stored instead of a second
 * one.
 */
async function recordMovement(
  ctx: MutationCtx,
  type: "deposit" | "withdrawal",
  args: {
    customerId: Id<"customers">;
    amount: number;
    clientId: string;
    offline?: boolean;
    recordedAt?: number;
    location?: Infer<typeof geoFix>;
    expectedAgentId?: string;
  },
) {
  const agent = await requireUser(ctx);
  requireExpectedUser(agent, args.expectedAgentId);
  const permission = type === "deposit" ? "transactions:collect" : "transactions:withdraw";
  if (!(await authz.can(ctx, agent._id, permission))) {
    throw new ConvexError("FORBIDDEN");
  }
  const clientId = args.clientId.trim();
  if (!clientId || clientId.length > 64) throw new ConvexError("INVALID_CLIENT_ID");

  // Idempotent replay: checked first, so a movement already stored is
  // returned even if the day has been closed since
  const previous = await ctx.db
    .query("transactions")
    .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
    .first();
  if (previous) {
    if (previous.agentId !== agent._id || isWithdrawal(previous) !== (type === "withdrawal")) {
      throw new ConvexError("DUPLICATE_CLIENT_ID");
    }
    return previous._id;
  }

  if (!Number.isInteger(args.amount) || args.amount <= 0 || args.amount > MAX_AMOUNT) {
    throw new ConvexError("INVALID_AMOUNT");
  }
  const customer = await ctx.db.get(args.customerId);
  if (!customer || customer.branchId !== agent.branchId) {
    throw new ConvexError("CUSTOMER_NOT_FOUND");
  }
  const device = await assignedDevice(ctx, agent._id);
  if (!device || device.status !== "active") throw new ConvexError("NO_DEVICE");

  const now = Date.now();
  const closed = await ctx.db
    .query("reconciliations")
    .withIndex("by_agent_date", (q) => q.eq("agentId", agent._id).eq("date", utcDay(now)))
    .first();
  if (closed) throw new ConvexError("DAY_CLOSED");

  // An offline withdrawal was already paid out when it was queued: refusing it
  // would only lose the record, so it is stored and flagged instead.
  const offline = type === "withdrawal" && args.offline === true;
  if (offline && args.amount > OFFLINE_WITHDRAWAL_CAP) {
    throw new ConvexError("OFFLINE_LIMIT");
  }
  let overdraft = false;
  if (type === "withdrawal") {
    // Mutations are serialized, so two withdrawals can't both pass this check
    const balance = await customerBalance(ctx, customer._id);
    if (balance < args.amount) {
      if (!offline) throw new ConvexError("INSUFFICIENT_BALANCE");
      overdraft = true;
    }
  }

  const branch = await ctx.db.get(agent.branchId);
  const organization = branch ? await ctx.db.get(branch.organizationId) : null;
  const recordedAt =
    args.recordedAt !== undefined && Number.isFinite(args.recordedAt) ? args.recordedAt : undefined;
  const location = cleanFix(args.location);
  const id = await ctx.db.insert("transactions", {
    type,
    amount: args.amount,
    currency: organization?.currency ?? "XOF",
    customerId: customer._id,
    agentId: agent._id,
    branchId: agent.branchId,
    tpeId: device.serialNumber,
    status: "completed",
    timestamp: now,
    clientId,
    ...(offline ? { offline: true } : {}),
    ...(overdraft ? { overdraft: true } : {}),
    ...(recordedAt !== undefined ? { recordedAt } : {}),
    ...(location ? { location } : {}),
  });
  await scheduleLedgerPost(ctx, id);
  return id;
}

/**
 * Record a cash deposit collected by the signed-in agent. Requires
 * transactions:collect. See recordMovement for what the server sets and for
 * replays. Throws `INVALID_AMOUNT`, `CUSTOMER_NOT_FOUND` (unknown or another
 * branch's), `NO_DEVICE` (no active bound TPE), `DAY_CLOSED` (today's cash
 * already reconciled), `DUPLICATE_CLIENT_ID` (UUID used by another agent or
 * for a withdrawal), `FORBIDDEN`, or `AGENT_MISMATCH` when `expectedAgentId`
 * is not the caller.
 */
export const createDeposit = mutation({
  args: movementArgs,
  handler: (ctx, args) => recordMovement(ctx, "deposit", args),
});

/**
 * Pay cash out of a customer's savings at the TPE: a direct debit, with no
 * approval step. Requires transactions:withdraw. Same rules and errors as
 * createDeposit, plus `INSUFFICIENT_BALANCE` when the amount exceeds the
 * customer's balance (completed deposits minus completed withdrawals).
 *
 * `offline: true` marks the replay of a withdrawal the app queued offline,
 * whose cash is already handed over: it is never refused for the balance, and
 * is stored with `overdraft: true` if it takes the balance below zero. It
 * must not exceed OFFLINE_WITHDRAWAL_CAP (`OFFLINE_LIMIT`).
 */
export const createWithdrawal = mutation({
  args: { ...movementArgs, offline: v.optional(v.boolean()) },
  handler: (ctx, args) => recordMovement(ctx, "withdrawal", args),
});

/** Shape of the caller's own movements for the mobile app. */
async function myRows(ctx: QueryCtx, rows: Doc<"transactions">[]) {
  const names = new Map<string, string>();
  for (const t of rows) {
    if (!names.has(t.customerId)) {
      names.set(t.customerId, (await ctx.db.get(t.customerId))?.fullName ?? "—");
    }
  }
  return rows.map((t) => ({
    _id: t._id,
    overdraft: t.overdraft === true,
    type: isWithdrawal(t) ? ("withdrawal" as const) : ("deposit" as const),
    clientId: t.clientId ?? null,
    customerId: t.customerId,
    customerName: names.get(t.customerId)!,
    amount: t.amount,
    currency: t.currency,
    tpeId: t.tpeId,
    status: t.status,
    reversalReason: t.reversalReason ?? null,
    timestamp: t.timestamp,
  }));
}

/**
 * The signed-in agent's own collections, newest first (the last `limit`,
 * default 200). Empty when signed out: the app subscribes before its session
 * resolves.
 */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!(await getAuthUserId(ctx))) return [];
    const agent = await requireUser(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 200), 1), 1000);
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_agent_date", (q) => q.eq("agentId", agent._id))
      .order("desc")
      // Spreadsheet imports are recorded under the importer but aren't theirs
      .filter((q) => q.neq(q.field("imported"), true))
      .take(limit);
    return myRows(ctx, rows);
  },
});

/**
 * The signed-in agent's own collections with `from <= timestamp < to` (ms),
 * newest first, e.g. today's for the end-of-day summary. Empty when signed out.
 */
export const listMineInRange = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    if (!(await getAuthUserId(ctx))) return [];
    const agent = await requireUser(ctx);
    // timestamp is set from the server clock at insert, like _creationTime
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_agent_date", (q) =>
        q.eq("agentId", agent._id).gte("_creationTime", args.from - 60_000).lt("_creationTime", args.to + 60_000),
      )
      .order("desc")
      .collect();
    return myRows(
      ctx,
      rows.filter((t) => !t.imported && t.timestamp >= args.from && t.timestamp < args.to),
    );
  },
});

export const reverseTransaction = mutation({
  args: { transactionId: v.id("transactions"), reason: v.string() },
  handler: async (ctx, args) => {
    const supervisor = await requireUser(ctx);
    await authz.require(ctx, supervisor._id, "transactions:reverse");

    const tx = await ctx.db.get(args.transactionId);
    if (!tx) throw new Error("Transaction not found");
    if (tx.status === "reversed") throw new Error("Already reversed");

    // Block reversal if daily cash for this agent is already settled
    const txDate = new Date(tx.timestamp).toISOString().split("T")[0];
    const settled = await ctx.db
      .query("reconciliations")
      .withIndex("by_agent_date", (q) =>
        q.eq("agentId", tx.agentId).eq("date", txDate)
      )
      .filter((q) => q.eq(q.field("status"), "settled"))
      .first();
    if (settled) throw new Error("Cannot reverse: daily cash already settled");

    await ctx.db.patch(args.transactionId, {
      status: "reversed",
      reversalReason: args.reason,
      reversedBy: supervisor._id,
    });
    // Reverted in the ledger as a new transaction, never edited
    await scheduleLedgerPost(ctx, args.transactionId);
  },
});

/**
 * An agent's transactions, newest first. Agents may read their own history;
 * reading someone else's needs transactions:audit (supervisor, accountant)
 * and is limited to agents of the caller's branch.
 */
export const listByAgent = query({
  args: { agentId: v.id("users") },
  handler: async (ctx, args) => {
    const caller = await requireUser(ctx);
    if (args.agentId !== caller._id) {
      const agent = await ctx.db.get(args.agentId);
      const allowed =
        agent !== null &&
        agent.branchId === caller.branchId &&
        (await authz.can(ctx, caller._id, "transactions:audit"));
      if (!allowed) throw new ConvexError("FORBIDDEN");
    }
    return ctx.db
      .query("transactions")
      .withIndex("by_agent_date", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .collect();
  },
});

/**
 * A branch's transactions, newest first. Needs transactions:audit and is
 * limited to the caller's own branch.
 */
export const listByBranch = query({
  args: { branchId: v.id("branches") },
  handler: async (ctx, args) => {
    const caller = await requireUser(ctx);
    if (
      args.branchId !== caller.branchId ||
      !(await authz.can(ctx, caller._id, "transactions:audit"))
    ) {
      throw new ConvexError("FORBIDDEN");
    }
    return ctx.db
      .query("transactions")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .collect();
  },
});
