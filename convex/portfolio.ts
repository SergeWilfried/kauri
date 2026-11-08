// convex/portfolio.ts — product catalogue and savings goals for the dashboard
//
// Reads need transactions:audit and cover the caller's branch (the catalogue
// itself is the organization's). Writes need portfolio:manage (supervisor,
// accountant). A savings goal is the customer's metadata.savingsGoal, which
// agents set in the app; the dashboard adds a reason and a deadline.
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, query, QueryCtx } from "./_generated/server";
import { authz } from "./authz";
import { signedAmount } from "./transactions";
import { requireUser } from "./users";

const DAY = 86_400_000;
const KYC_LEVELS = ["Allégée", "Standard", "Renforcée"];

/** Signed-in auditor (transactions:audit), or FORBIDDEN. */
async function requireAuditor(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (!(await authz.can(ctx, user._id, "transactions:audit"))) {
    throw new ConvexError("FORBIDDEN");
  }
  return user;
}

/** Signed-in user with portfolio:manage, or FORBIDDEN. */
async function requireManager(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (!(await authz.can(ctx, user._id, "portfolio:manage"))) {
    throw new ConvexError("FORBIDDEN");
  }
  return user;
}

/** The organization of the user's branch. */
async function organizationOf(ctx: QueryCtx, user: Doc<"users">) {
  const branch = await ctx.db.get(user.branchId);
  if (!branch) throw new ConvexError("FORBIDDEN");
  return branch.organizationId;
}

/** A customer of the user's own branch, or FORBIDDEN. */
async function ownCustomer(ctx: QueryCtx, user: Doc<"users">, customerId: Id<"customers">) {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.branchId !== user.branchId) throw new ConvexError("FORBIDDEN");
  return customer;
}

/** Completed transactions of a branch, grouped by customer and oldest first. */
async function ledgerByCustomer(ctx: QueryCtx, branchId: Id<"branches">) {
  const txs = await ctx.db
    .query("transactions")
    .withIndex("by_branch", (q) => q.eq("branchId", branchId))
    .collect();
  const byCustomer = new Map<string, Doc<"transactions">[]>();
  for (const t of txs) {
    if (t.status !== "completed") continue;
    const list = byCustomer.get(t.customerId) ?? [];
    list.push(t);
    byCustomer.set(t.customerId, list);
  }
  for (const list of byCustomer.values()) list.sort((a, b) => a.timestamp - b.timestamp);
  return byCustomer;
}

const balanceOf = (txs: Doc<"transactions">[] = []) =>
  txs.reduce((s, t) => s + signedAmount(t), 0);

// ─── Products ────────────────────────────────────────────────────────────────

/**
 * The organization's catalogue, with how many of the caller's branch clients
 * hold each product and their combined balance, plus the branches a product
 * can be offered in.
 */
export const listProducts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuditor(ctx);
    const organizationId = await organizationOf(ctx, user);
    const [products, branches, customers, ledger] = await Promise.all([
      ctx.db
        .query("products")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
      ctx.db
        .query("branches")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
      ctx.db
        .query("customers")
        .withIndex("by_branch", (q) => q.eq("branchId", user.branchId))
        .collect(),
      ledgerByCustomer(ctx, user.branchId),
    ]);
    const branchNames = new Map(branches.map((b) => [b._id as string, b.name]));
    const recent = Date.now() - 30 * DAY;

    const rows = products.map((p) => {
      const holders = customers.filter((c) => c.productId === p._id);
      return {
        id: p._id,
        code: p.code,
        name: p.name,
        family: p.family,
        summary: p.summary,
        status: p.status,
        rate: p.rate,
        durationMin: p.durationMin,
        durationMax: p.durationMax,
        minDeposit: p.minDeposit,
        maxBalance: p.maxBalance,
        fees: p.fees,
        feesUnit: p.feesUnit,
        grace: p.grace,
        kycLevel: p.kycLevel,
        targets: p.targets,
        channels: p.channels ?? [],
        branchIds: p.branchIds,
        branches: p.branchIds.map((id) => branchNames.get(id) ?? "—"),
        clients: holders.length,
        encours: holders.reduce((s, c) => s + balanceOf(ledger.get(c._id)), 0),
        opened30: holders.filter((c) => c._creationTime >= recent).length,
        created: p._creationTime,
        updated: p.updatedAt,
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return {
      products: rows,
      branches: branches.map((b) => ({ id: b._id, name: b.name })),
    };
  },
});

const productFields = {
  code: v.string(),
  name: v.string(),
  family: v.union(
    v.literal("epargne"),
    v.literal("credit"),
    v.literal("tontine"),
    v.literal("assurance"),
  ),
  summary: v.string(),
  status: v.union(v.literal("actif"), v.literal("brouillon"), v.literal("archive")),
  rate: v.number(),
  durationMin: v.number(),
  durationMax: v.number(),
  minDeposit: v.number(),
  maxBalance: v.number(),
  fees: v.number(),
  feesUnit: v.union(v.literal("FCFA"), v.literal("%")),
  grace: v.number(),
  kycLevel: v.string(),
  targets: v.array(v.string()),
  branchIds: v.array(v.id("branches")),
  // Partner apps that may offer it through the API (channelApi.ts)
  channels: v.optional(v.array(v.literal("nafa"))),
};

/** Create a product (no id) or update one of the caller's organization. */
export const saveProduct = mutation({
  args: { id: v.optional(v.id("products")), ...productFields },
  handler: async (ctx, { id, ...args }) => {
    const user = await requireManager(ctx);
    const organizationId = await organizationOf(ctx, user);

    const code = args.code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9+._-]{1,19}$/.test(code)) throw new ConvexError("INVALID_CODE");
    const name = args.name.trim();
    if (!name || name.length > 80) throw new ConvexError("NAME_REQUIRED");
    const summary = args.summary.trim();
    if (summary.length > 300) throw new ConvexError("SUMMARY_TOO_LONG");

    const amounts = [args.rate, args.durationMin, args.durationMax, args.minDeposit, args.maxBalance, args.fees, args.grace];
    if (
      amounts.some((n) => !Number.isFinite(n) || n < 0) ||
      args.rate > 100 ||
      (args.feesUnit === "%" && args.fees > 100) ||
      args.durationMin > args.durationMax ||
      !KYC_LEVELS.includes(args.kycLevel)
    ) {
      throw new ConvexError("INVALID_TERMS");
    }
    const targets = [...new Set(args.targets.map((t) => t.trim()).filter(Boolean))];
    if (targets.length > 20 || targets.some((t) => t.length > 40)) throw new ConvexError("INVALID_TERMS");

    const branchIds = [...new Set(args.branchIds)];
    for (const branchId of branchIds) {
      const branch = await ctx.db.get(branchId);
      if (!branch || branch.organizationId !== organizationId) throw new ConvexError("INVALID_BRANCH");
    }

    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing || existing.organizationId !== organizationId) throw new ConvexError("FORBIDDEN");
    }
    const clash = await ctx.db
      .query("products")
      .withIndex("by_organization_code", (q) => q.eq("organizationId", organizationId).eq("code", code))
      .first();
    if (clash && clash._id !== id) throw new ConvexError("CODE_TAKEN");

    const doc = {
      ...args,
      code,
      name,
      summary,
      targets,
      branchIds,
      channels: [...new Set(args.channels ?? [])],
      updatedBy: user._id,
      updatedAt: Date.now(),
    };
    if (id) {
      await ctx.db.patch(id, doc);
      return id;
    }
    return await ctx.db.insert("products", { organizationId, ...doc });
  },
});

/** Give a client of the caller's branch an active product, or none (null). */
export const setCustomerProduct = mutation({
  args: { customerId: v.id("customers"), productId: v.union(v.id("products"), v.null()) },
  handler: async (ctx, args) => {
    const user = await requireManager(ctx);
    const customer = await ownCustomer(ctx, user, args.customerId);
    if (args.productId === null) {
      await ctx.db.patch(customer._id, { productId: undefined });
      return;
    }
    const product = await ctx.db.get(args.productId);
    if (!product || product.organizationId !== (await organizationOf(ctx, user))) {
      throw new ConvexError("FORBIDDEN");
    }
    if (product.status !== "actif") throw new ConvexError("PRODUCT_INACTIVE");
    if (!product.branchIds.includes(customer.branchId)) throw new ConvexError("PRODUCT_NOT_IN_BRANCH");
    await ctx.db.patch(customer._id, { productId: product._id });
  },
});

// ─── Savings goals ───────────────────────────────────────────────────────────

type GoalStatus = "atteint" | "enavance" | "surrythme" | "enretard" | "enpause" | "encours";

/**
 * Where a goal stands:
 * - atteint: the balance covers the target;
 * - enpause: no deposit in the last 30 days;
 * - with a deadline, the last 30 days' net savings carried to the deadline
 *   decide: short of the target → enretard, 20% over → enavance, else
 *   surrythme; a passed deadline is enretard;
 * - without a deadline there is no pace to judge: encours.
 */
export function goalStatus(g: {
  target: number;
  balance: number;
  monthly: number;
  lastDeposit: number | null;
  deadline: number | null;
  now: number;
}): GoalStatus {
  if (g.balance >= g.target) return "atteint";
  if (g.lastDeposit === null || g.lastDeposit < g.now - 30 * DAY) return "enpause";
  if (g.deadline === null) return "encours";
  if (g.deadline <= g.now) return "enretard";
  const projected = g.balance + (g.monthly * (g.deadline - g.now)) / (30 * DAY);
  if (projected < g.target) return "enretard";
  if (projected >= g.target * 1.2) return "enavance";
  return "surrythme";
}

/**
 * The caller's branch clients that have a savings goal, with progress and
 * pace, plus the clients without one (for "Nouvel objectif").
 */
export const listGoals = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuditor(ctx);
    const now = Date.now();
    const [customers, ledger, staff, branch, products] = await Promise.all([
      ctx.db
        .query("customers")
        .withIndex("by_branch", (q) => q.eq("branchId", user.branchId))
        .collect(),
      ledgerByCustomer(ctx, user.branchId),
      ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("branchId"), user.branchId))
        .collect(),
      ctx.db.get(user.branchId),
      organizationOf(ctx, user).then((organizationId) =>
        ctx.db
          .query("products")
          .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
          .collect(),
      ),
    ]);
    const staffNames = new Map(staff.map((u) => [u._id as string, u.fullName]));
    const productNames = new Map(products.map((p) => [p._id as string, p.name]));

    const goals = [];
    const withoutGoal = [];
    for (const c of customers) {
      const meta = (c.metadata ?? {}) as Record<string, unknown>;
      const target = typeof meta.savingsGoal === "number" && meta.savingsGoal > 0 ? meta.savingsGoal : null;
      if (target === null) {
        if (c.status !== "rejected") withoutGoal.push({ id: c._id, name: c.fullName, phone: c.phoneNumber });
        continue;
      }
      const txs = ledger.get(c._id) ?? [];
      let balance = 0;
      let reachedAt: number | null = null;
      let lastDeposit: number | null = null;
      let net30 = 0;
      for (const t of txs) {
        const before = balance;
        balance += signedAmount(t);
        // Latest time the balance climbed to the target and stayed there
        if (balance >= target && before < target) reachedAt = t.timestamp;
        if (balance < target) reachedAt = null;
        if (signedAmount(t) > 0) lastDeposit = t.timestamp;
        if (t.timestamp >= now - 30 * DAY) net30 += signedAmount(t);
      }
      const deadline = typeof meta.goalDeadline === "number" ? meta.goalDeadline : null;
      const monthly = Math.max(0, net30);
      goals.push({
        id: c._id,
        client: c.fullName,
        phone: c.phoneNumber,
        agent: staffNames.get(c.onboardedBy) ?? "—",
        village: branch?.location.split(",")[0] ?? "—",
        product: c.productId ? productNames.get(c.productId) ?? null : null,
        category: typeof meta.goalCategory === "string" ? meta.goalCategory : null,
        target,
        current: balance,
        monthly,
        pct: Math.max(0, Math.round((balance / target) * 100)),
        deadline,
        daysLeft: deadline === null ? null : Math.ceil((deadline - now) / DAY),
        reachedAt,
        created: c._creationTime,
        status: goalStatus({ target, balance, monthly, lastDeposit, deadline, now }),
      });
    }
    withoutGoal.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return { goals, withoutGoal };
  },
});

/**
 * Set a client's goal: target (FCFA), and optionally a reason and a deadline.
 * A null or empty reason / deadline clears it.
 */
export const setGoal = mutation({
  args: {
    customerId: v.id("customers"),
    target: v.number(),
    category: v.optional(v.union(v.string(), v.null())),
    deadline: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const user = await requireManager(ctx);
    const customer = await ownCustomer(ctx, user, args.customerId);
    if (!Number.isInteger(args.target) || args.target <= 0 || args.target > 1e12) {
      throw new ConvexError("INVALID_TARGET");
    }
    const category = args.category?.trim() || null;
    if (category && category.length > 40) throw new ConvexError("INVALID_CATEGORY");
    const deadline = args.deadline ?? null;
    if (deadline !== null && (!Number.isFinite(deadline) || deadline < Date.now() - DAY)) {
      throw new ConvexError("INVALID_DEADLINE");
    }

    const { goalCategory: _c, goalDeadline: _d, ...rest } = (customer.metadata ?? {}) as Record<string, unknown>;
    await ctx.db.patch(customer._id, {
      metadata: {
        ...rest,
        savingsGoal: args.target,
        ...(category ? { goalCategory: category } : {}),
        ...(deadline !== null ? { goalDeadline: deadline } : {}),
      },
    });
  },
});

/** Remove a client's goal (target, reason and deadline). */
export const removeGoal = mutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const user = await requireManager(ctx);
    const customer = await ownCustomer(ctx, user, args.customerId);
    const {
      savingsGoal: _g,
      goalCategory: _c,
      goalDeadline: _d,
      ...rest
    } = (customer.metadata ?? {}) as Record<string, unknown>;
    await ctx.db.patch(customer._id, { metadata: rest });
  },
});
