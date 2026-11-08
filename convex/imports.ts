// convex/imports.ts — bulk import of customers and past transactions from a
// spreadsheet, for the dashboard's Import page. Rows arrive already parsed
// (the browser reads the .xlsx/.csv); every row is validated here and gets
// its own result, so one bad line never blocks the rest of a batch.
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, MutationCtx } from "./_generated/server";
import { authz } from "./authz";
import { cleanIdNumber, cleanName, cleanPhone } from "./customers";
import { signedAmount } from "./transactions";
import { requireUser } from "./users";

/** Rows per call; the page sends a file in batches of this size. */
export const IMPORT_BATCH_SIZE = 200;
const MAX_AMOUNT = 100_000_000;
const EARLIEST = Date.UTC(2000, 0, 1);

type RowResult =
  | { row: number; status: "created" | "updated"; id: string; delta?: number }
  | { row: number; status: "skipped" | "error"; code: string };

/** The importer, who needs data:import; imports land in their own branch. */
async function requireImporter(ctx: MutationCtx, rowCount: number) {
  const user = await requireUser(ctx);
  if (!(await authz.can(ctx, user._id, "data:import"))) throw new ConvexError("FORBIDDEN");
  if (rowCount > IMPORT_BATCH_SIZE) throw new ConvexError("TOO_MANY_ROWS");
  return user;
}

/** The ConvexError code of a validation helper's refusal, else rethrow. */
function refusalCode(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  throw error;
}

const optionalText = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);

/** Upper-cased, trimmed account number or old-app ID, for matching. */
const key = (s: string | undefined) => optionalText(s)?.toUpperCase();

/**
 * The branch's customers indexed by account number and by old-app ID
 * (metadata.legacyId), for matching import rows. Loaded once per batch.
 */
async function branchIndex(ctx: MutationCtx, branchId: Id<"branches">) {
  const customers = await ctx.db
    .query("customers")
    .withIndex("by_branch", (q) => q.eq("branchId", branchId))
    .collect();
  const byAccount = new Map<string, Id<"customers">>();
  const byLegacy = new Map<string, Id<"customers">>();
  for (const c of customers) {
    const account = key(c.metadata?.accountNumber);
    const legacy = key(c.metadata?.legacyId);
    if (account) byAccount.set(account, c._id);
    if (legacy) byLegacy.set(legacy, c._id);
  }
  return { byAccount, byLegacy };
}

/**
 * Create prospects in the importer's branch, as createProspect would (status
 * `prospect`, onboarded by the importer). Duplicates are `skipped`, so
 * importing the same file twice creates nothing new:
 * - a row whose `legacyId` (client ID in the old app's backup) is already
 *   imported: ALREADY_IMPORTED;
 * - otherwise, a row with an account number already used in the branch:
 *   ACCOUNT_TAKEN. With an account number, a shared phone is allowed (one
 *   person with several accounts, a family phone);
 * - a row without an account number whose phone is already used: PHONE_TAKEN.
 * `row` is echoed back for the page's report.
 */
export const importCustomers = mutation({
  args: {
    rows: v.array(
      v.object({
        row: v.number(),
        fullName: v.string(),
        phoneNumber: v.string(),
        idNumber: v.optional(v.string()),
        address: v.optional(v.string()),
        groupName: v.optional(v.string()),
        accountNumber: v.optional(v.string()),
        email: v.optional(v.string()),
        commitmentAmount: v.optional(v.number()),
        legacyId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    const importer = await requireImporter(ctx, rows.length);
    const branchId = importer.branchId;
    const { byAccount, byLegacy } = await branchIndex(ctx, branchId);
    const phonesInBatch = new Set<string>();
    const results: RowResult[] = [];

    for (const r of rows) {
      let fullName: string, phoneNumber: string, idNumber: string;
      try {
        fullName = cleanName(r.fullName);
        phoneNumber = cleanPhone(r.phoneNumber);
        idNumber = cleanIdNumber(r.idNumber ?? "");
      } catch (e) {
        results.push({ row: r.row, status: "error", code: refusalCode(e) });
        continue;
      }
      if (
        r.commitmentAmount !== undefined &&
        (!Number.isFinite(r.commitmentAmount) || r.commitmentAmount < 0)
      ) {
        results.push({ row: r.row, status: "error", code: "INVALID_AMOUNT" });
        continue;
      }
      const legacy = key(r.legacyId);
      const account = key(r.accountNumber);
      if (legacy && byLegacy.has(legacy)) {
        results.push({ row: r.row, status: "skipped", code: "ALREADY_IMPORTED" });
        continue;
      }
      if (account) {
        if (byAccount.has(account)) {
          results.push({ row: r.row, status: "skipped", code: "ACCOUNT_TAKEN" });
          continue;
        }
      } else {
        const taken =
          phonesInBatch.has(phoneNumber) ||
          (await ctx.db
            .query("customers")
            .withIndex("by_phone", (q) => q.eq("phoneNumber", phoneNumber))
            .filter((q) => q.eq(q.field("branchId"), branchId))
            .first()) !== null;
        if (taken) {
          results.push({ row: r.row, status: "skipped", code: "PHONE_TAKEN" });
          continue;
        }
      }

      const metadata = {
        address: optionalText(r.address),
        groupName: optionalText(r.groupName),
        accountNumber: optionalText(r.accountNumber),
        email: optionalText(r.email),
        commitmentAmount: r.commitmentAmount,
        legacyId: optionalText(r.legacyId),
      };
      const id = await ctx.db.insert("customers", {
        fullName,
        phoneNumber,
        idNumber,
        branchId,
        onboardedBy: importer._id,
        status: "prospect",
        metadata: Object.values(metadata).some((x) => x !== undefined) ? metadata : undefined,
      });
      phonesInBatch.add(phoneNumber);
      if (account) byAccount.set(account, id);
      if (legacy) byLegacy.set(legacy, id);
      results.push({ row: r.row, status: "created", id });
    }
    return results;
  },
});

/**
 * Record past deposits and withdrawals of the importer's branch's customers.
 * The customer is found by old-app client ID, then account number, then
 * phone. They are history: they keep their own date and time, count in the
 * customer's balance, and are marked `imported` so they never count in an
 * agent's daily cash, reconciliation or own collections. The agent named in
 * the file is kept as text; the importer is recorded as the agent. No balance
 * check: the file is a record of what happened.
 *
 * A phone matching several customers (shared phone, several accounts) is
 * refused with AMBIGUOUS_PHONE rather than guessed.
 *
 * Re-importing the same file skips every row with ALREADY_IMPORTED: a row
 * with a `reference` (transaction ID in the file) is keyed on it; otherwise
 * on its customer, type, amount, date and `occurrence` (how many identical
 * rows came before it in the file).
 */
export const importTransactions = mutation({
  args: {
    rows: v.array(
      v.object({
        row: v.number(),
        legacyClientId: v.optional(v.string()),
        phoneNumber: v.optional(v.string()),
        accountNumber: v.optional(v.string()),
        reference: v.optional(v.string()),
        type: v.union(v.literal("deposit"), v.literal("withdrawal")),
        amount: v.number(),
        date: v.number(),
        agentName: v.optional(v.string()),
        occurrence: v.number(),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    const importer = await requireImporter(ctx, rows.length);
    const branchId = importer.branchId;
    const branch = await ctx.db.get(branchId);
    const organization = branch ? await ctx.db.get(branch.organizationId) : null;
    const currency = organization?.currency ?? "XOF";
    const now = Date.now();
    const { byAccount, byLegacy } = await branchIndex(ctx, branchId);

    const results: RowResult[] = [];
    for (const r of rows) {
      let customerId: Id<"customers"> | undefined;
      const legacy = key(r.legacyClientId);
      const account = key(r.accountNumber);
      if (legacy) customerId = byLegacy.get(legacy);
      if (!customerId && account) customerId = byAccount.get(account);
      if (!customerId && !legacy && !account && optionalText(r.phoneNumber)) {
        let phone: string | null = null;
        try {
          phone = cleanPhone(r.phoneNumber!);
        } catch {
          // falls through to CUSTOMER_NOT_FOUND
        }
        const found: Doc<"customers">[] = phone
          ? await ctx.db
              .query("customers")
              .withIndex("by_phone", (q) => q.eq("phoneNumber", phone!))
              .filter((q) => q.eq(q.field("branchId"), branchId))
              .take(2)
          : [];
        // A phone may be shared by several accounts: never guess which one
        if (found.length > 1) {
          results.push({ row: r.row, status: "error", code: "AMBIGUOUS_PHONE" });
          continue;
        }
        customerId = found[0]?._id;
      }
      if (!customerId) {
        results.push({ row: r.row, status: "error", code: "CUSTOMER_NOT_FOUND" });
        continue;
      }
      if (!Number.isInteger(r.amount) || r.amount <= 0 || r.amount > MAX_AMOUNT) {
        results.push({ row: r.row, status: "error", code: "INVALID_AMOUNT" });
        continue;
      }
      if (!Number.isFinite(r.date) || r.date < EARLIEST || r.date > now) {
        results.push({ row: r.row, status: "error", code: "INVALID_DATE" });
        continue;
      }
      const reference = optionalText(r.reference);
      const clientId = reference
        ? `import:ref:${branchId}:${reference.slice(0, 120)}`
        : `import:${customerId}:${r.type}:${r.amount}:${r.date}:${r.occurrence}`;
      const existing = await ctx.db
        .query("transactions")
        .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
        .first();
      if (existing) {
        results.push({ row: r.row, status: "skipped", code: "ALREADY_IMPORTED" });
        continue;
      }
      const id = await ctx.db.insert("transactions", {
        type: r.type,
        amount: r.amount,
        currency,
        customerId,
        agentId: importer._id,
        branchId,
        tpeId: "IMPORT",
        status: "completed",
        timestamp: r.date,
        clientId,
        imported: true,
        importedAgentName: optionalText(r.agentName)?.slice(0, 120),
      });
      results.push({ row: r.row, status: "created", id });
    }
    return results;
  },
});

/** Agent name shown on the balance adjustments made by alignBalances. */
export const ADJUSTMENT_LABEL = "Ajustement import (solde de la sauvegarde)";

/**
 * Bring imported customers' balances to the balance their old-app backup
 * showed: for each customer (by old-app client ID), keep one imported
 * adjustment, labelled ADJUSTMENT_LABEL, equal to `balance` minus the sum of
 * the customer's other imported history. Movements recorded in the app since
 * the import are left out of the sum, so running the same backup again later
 * never cancels them.
 *
 * The adjustment is recomputed on every run: `created` when it is new,
 * `updated` when imported history changed since (e.g. the clients file was
 * imported before the transactions file), removed when no longer needed.
 * Unchanged: `skipped` with BALANCE_OK (none needed) or ALREADY_IMPORTED. An
 * adjustment a supervisor reversed is left alone.
 */
export const alignBalances = mutation({
  args: {
    rows: v.array(v.object({ row: v.number(), legacyId: v.string(), balance: v.number() })),
  },
  handler: async (ctx, { rows }) => {
    const importer = await requireImporter(ctx, rows.length);
    const branchId = importer.branchId;
    const branch = await ctx.db.get(branchId);
    const organization = branch ? await ctx.db.get(branch.organizationId) : null;
    const { byLegacy } = await branchIndex(ctx, branchId);
    const now = Date.now();

    const results: RowResult[] = [];
    for (const r of rows) {
      const customerId = byLegacy.get(key(r.legacyId) ?? "");
      if (!customerId) {
        results.push({ row: r.row, status: "error", code: "CUSTOMER_NOT_FOUND" });
        continue;
      }
      if (!Number.isInteger(r.balance) || Math.abs(r.balance) > MAX_AMOUNT) {
        results.push({ row: r.row, status: "error", code: "INVALID_AMOUNT" });
        continue;
      }
      const clientId = `import:align:${customerId}`;
      const history = await ctx.db
        .query("transactions")
        .withIndex("by_customer", (q) => q.eq("customerId", customerId))
        .collect();
      const existing = history.find((t) => t.clientId === clientId);
      if (existing?.status === "reversed") {
        results.push({ row: r.row, status: "skipped", code: "ALREADY_IMPORTED" });
        continue;
      }
      const imported = history
        .filter((t) => t.imported && t.status === "completed" && t.clientId !== clientId)
        .reduce((s, t) => s + signedAmount(t), 0);
      const needed = r.balance - imported;
      const current = existing ? signedAmount(existing) : 0;

      if (needed === current) {
        results.push({ row: r.row, status: "skipped", code: existing ? "ALREADY_IMPORTED" : "BALANCE_OK" });
        continue;
      }
      if (existing && needed === 0) {
        await ctx.db.delete(existing._id);
        results.push({ row: r.row, status: "updated", id: existing._id, delta: -current });
        continue;
      }
      const fields = { type: needed > 0 ? ("deposit" as const) : ("withdrawal" as const), amount: Math.abs(needed) };
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        results.push({ row: r.row, status: "updated", id: existing._id, delta: needed - current });
        continue;
      }
      const id = await ctx.db.insert("transactions", {
        ...fields,
        currency: organization?.currency ?? "XOF",
        customerId,
        agentId: importer._id,
        branchId,
        tpeId: "IMPORT",
        status: "completed",
        timestamp: now,
        clientId,
        imported: true,
        importedAgentName: ADJUSTMENT_LABEL,
      });
      results.push({ row: r.row, status: "created", id, delta: needed });
    }
    return results;
  },
});
