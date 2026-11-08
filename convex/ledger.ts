// convex/ledger.ts — audit copy of every movement in a Formance ledger.
//
// Shadow mode: Convex stays the source of truth for balances. Each completed
// transaction is also posted, as a double-entry transaction, to an immutable
// Formance ledger; a reversal becomes a Formance revert (never an edit). A
// nightly check compares every customer's balance on both sides and keeps the
// result, so the auditor can see the two books agree.
//
// Off unless FORMANCE_URL is set (Convex environment variables):
//   FORMANCE_URL            e.g. https://<org>-<stack>.<region>.formance.cloud
//   FORMANCE_CLIENT_ID      OAuth client (Formance Cloud; omit for an open stack)
//   FORMANCE_CLIENT_SECRET
//   FORMANCE_TOKEN_URL      optional, default /api/auth/oauth/token
//   FORMANCE_LEDGER         optional, default "tontipro"
//
// Chart of accounts (every amount in the organisation's currency, e.g. XOF):
//   customers:{customerId}:savings              agent and imported movements
//   customers:{customerId}:vault:{productId}    partner-API movements
//   agents:{agentId}:cash                       cash collected by the agent, negative = held
//   partners:{userId}:settlement                money moved through the partner API
//   migration:opening                           history loaded from spreadsheets
import { SDK } from "@formance/formance-sdk";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  MutationCtx,
  query,
} from "./_generated/server";
import { authz } from "./authz";
import { isWithdrawal, signedAmount } from "./transactions";
import { requireUser } from "./users";

const LEDGER = () => process.env.FORMANCE_LEDGER || "tontipro";
export const ledgerEnabled = () => !!process.env.FORMANCE_URL;

// Rows posted per sweep run (every 5 minutes): ~29 000 a day while backfilling
const SWEEP_BATCH = 100;
// Mismatches kept on a check, for the dashboard
const MAX_MISMATCHES = 50;

function client() {
  const clientID = process.env.FORMANCE_CLIENT_ID;
  return new SDK({
    serverURL: process.env.FORMANCE_URL,
    security: clientID
      ? {
          clientID,
          clientSecret: process.env.FORMANCE_CLIENT_SECRET,
          tokenURL: process.env.FORMANCE_TOKEN_URL || "/api/auth/oauth/token",
        }
      : undefined,
  });
}

/** Formance's error code (INSUFFICIENT_FUND, CONFLICT…) on a failed call, if any. */
const errorCode = (e: unknown): string | undefined =>
  (e as { errorCode?: string } | null)?.errorCode;

const describe = (e: unknown) =>
  (errorCode(e) ? `${errorCode(e)}: ` : "") +
  String((e as { errorMessage?: string; message?: string })?.errorMessage ?? (e as Error)?.message ?? e).slice(0, 300);

// One script with the overdraft allowed on the source, one where Formance
// refuses it: the ledger itself checks what Convex already checked.
const SEND = `vars {
  monetary $amount
  account $source
  account $destination
}
send $amount (
  source = $source
  destination = $destination
)`;
const SEND_OVERDRAFT = SEND.replace(
  "source = $source",
  "source = $source allowing unbounded overdraft",
);

/** The customer-side account a movement lands in. */
export function customerAccount(t: Pick<Doc<"transactions">, "customerId" | "productId">) {
  return t.productId
    ? `customers:${t.customerId}:vault:${t.productId}`
    : `customers:${t.customerId}:savings`;
}

/**
 * The Formance transaction for a Convex movement: who pays whom, whether the
 * paying account may go negative, and the audit metadata (all strings).
 */
export function entryFor(t: Doc<"transactions">) {
  const customer = customerAccount(t);
  const counterpart = t.imported
    ? "migration:opening"
    : t.channel === "api"
      ? `partners:${t.agentId}:settlement`
      : `agents:${t.agentId}:cash`;
  const withdrawal = isWithdrawal(t);
  // Deposits draw on accounts that are meant to go negative (cash held,
  // money owed by a partner, opening balances). A withdrawal may only
  // overdraw the customer when Convex let it: an offline payout, or history
  // loaded as-is.
  const overdraft = !withdrawal || t.overdraft === true || t.imported === true;
  const metadata: Record<string, string> = {
    convexId: t._id,
    type: withdrawal ? "withdrawal" : "deposit",
    customerId: t.customerId,
    agentId: t.agentId,
    branchId: t.branchId,
    tpeId: t.tpeId,
  };
  if (t.clientId) metadata.clientId = t.clientId;
  if (t.productId) metadata.productId = t.productId;
  if (t.recordedAt !== undefined) metadata.recordedAt = new Date(t.recordedAt).toISOString();
  if (t.location) metadata.location = `${t.location.lat},${t.location.lng}`;
  if (t.location?.mocked) metadata.mockedLocation = "true";
  if (t.offline) metadata.offline = "true";
  if (t.overdraft) metadata.overdraft = "true";
  if (t.imported) metadata.imported = "true";
  if (t.channel) metadata.channel = t.channel;
  return {
    reference: t._id as string,
    timestamp: new Date(t.timestamp),
    metadata,
    script: {
      plain: overdraft ? SEND_OVERDRAFT : SEND,
      vars: {
        amount: `${t.currency} ${t.amount}`,
        source: withdrawal ? customer : counterpart,
        destination: withdrawal ? counterpart : customer,
      },
    },
  };
}

/** Post a movement right after it is recorded (the sweep catches any miss). */
export async function scheduleLedgerPost(ctx: MutationCtx, transactionId: Id<"transactions">) {
  if (ledgerEnabled()) {
    await ctx.scheduler.runAfter(0, internal.ledger.post, { transactionId });
  }
}

export const getRow = internalQuery({
  args: { transactionId: v.id("transactions") },
  handler: (ctx, { transactionId }) => ctx.db.get(transactionId),
});

/** Oldest movements not in the ledger yet, then reversals not reverted there yet. */
export const pending = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const unposted = await ctx.db
      .query("transactions")
      .withIndex("by_ledger_tx", (q) => q.eq("ledgerTxId", undefined))
      .take(limit);
    const unreverted = await ctx.db
      .query("transactions")
      .withIndex("by_ledger_revert", (q) => q.eq("status", "reversed").eq("ledgerRevertTxId", undefined))
      .filter((q) => q.neq(q.field("ledgerTxId"), undefined))
      .take(limit);
    return { unposted: unposted.map((t) => t._id), unreverted: unreverted.map((t) => t._id) };
  },
});

export const markPosted = internalMutation({
  args: {
    transactionId: v.id("transactions"),
    ledgerTxId: v.optional(v.string()),
    ledgerRevertTxId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { transactionId, ledgerTxId, ledgerRevertTxId, error }) => {
    await ctx.db.patch(transactionId, {
      ...(ledgerTxId !== undefined ? { ledgerTxId } : {}),
      ...(ledgerRevertTxId !== undefined ? { ledgerRevertTxId } : {}),
      ledgerError: error,
    });
  },
});

/** The ledger id of the transaction already posted for this row, if any. */
async function findByReference(sdk: SDK, reference: string) {
  const res = await sdk.ledger.v2.listTransactions({
    ledger: LEDGER(),
    pageSize: 1,
    query: { $match: { reference } },
  });
  const found = res.v2TransactionsCursorResponse?.cursor.data[0];
  return found ? String(found.id) : undefined;
}

async function createLedgerIfMissing(sdk: SDK, e: unknown) {
  if (errorCode(e) !== "LEDGER_NOT_FOUND") return false;
  await sdk.ledger.v2.createLedger({ ledger: LEDGER(), v2CreateLedgerRequest: {} }).catch((err) => {
    if (errorCode(err) !== "LEDGER_ALREADY_EXISTS") throw err;
  });
  return true;
}

/**
 * Post one movement (and its revert if it was reversed). Safe to run twice:
 * the idempotency key and the reference (the Convex id) make Formance return
 * or refuse the existing transaction instead of booking it again. Failures
 * are stored on the row and retried by the sweep.
 */
export const post = internalAction({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, { transactionId }) => {
    if (!ledgerEnabled()) return "disabled";
    const t = await ctx.runQuery(internal.ledger.getRow, { transactionId });
    if (!t) return "missing";
    const sdk = client();
    let ledgerTxId = t.ledgerTxId;

    if (ledgerTxId === undefined) {
      const entry = entryFor(t);
      const create = () =>
        sdk.ledger.v2.createTransaction({
          ledger: LEDGER(),
          idempotencyKey: `tx-${t._id}`,
          v2PostTransaction: entry,
        });
      try {
        let res;
        try {
          res = await create();
        } catch (e) {
          if (!(await createLedgerIfMissing(sdk, e))) throw e;
          res = await create();
        }
        ledgerTxId = String(res.v2CreateTransactionResponse!.data.id);
      } catch (e) {
        // Posted before, under an idempotency key Formance no longer holds
        ledgerTxId = errorCode(e) === "CONFLICT" ? await findByReference(sdk, entry.reference) : undefined;
        if (ledgerTxId === undefined) {
          await ctx.runMutation(internal.ledger.markPosted, { transactionId, error: describe(e) });
          return "failed";
        }
      }
      await ctx.runMutation(internal.ledger.markPosted, { transactionId, ledgerTxId });
    }

    if (t.status === "reversed" && t.ledgerRevertTxId === undefined) {
      try {
        const res = await sdk.ledger.v2.revertTransaction({
          ledger: LEDGER(),
          id: BigInt(ledgerTxId),
          idempotencyKey: `revert-${t._id}`,
          // The ledger mirrors Convex: the reversal stands even if the
          // customer has spent the money since (it then shows as negative)
          force: true,
          v2RevertTransactionRequest: {
            metadata: {
              convexId: t._id,
              reason: (t.reversalReason ?? "").slice(0, 200),
              ...(t.reversedBy ? { reversedBy: t.reversedBy } : {}),
            },
          },
        });
        await ctx.runMutation(internal.ledger.markPosted, {
          transactionId,
          ledgerRevertTxId: String(res.v2CreateTransactionResponse!.data.id),
        });
      } catch (e) {
        if (errorCode(e) === "ALREADY_REVERT") {
          await ctx.runMutation(internal.ledger.markPosted, { transactionId, ledgerRevertTxId: "reverted" });
        } else {
          await ctx.runMutation(internal.ledger.markPosted, { transactionId, error: describe(e) });
          return "failed";
        }
      }
    }
    return "ok";
  },
});

/**
 * Every 5 minutes: post what is missing, oldest first (this also backfills
 * the history), then the reversals. One at a time, so a withdrawal never
 * reaches the ledger before the deposit it spends.
 */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!ledgerEnabled()) return { posted: 0, failed: 0 };
    const { unposted, unreverted } = await ctx.runQuery(internal.ledger.pending, { limit: SWEEP_BATCH });
    let posted = 0;
    let failed = 0;
    for (const transactionId of [...unposted, ...unreverted]) {
      const r = await ctx.runAction(internal.ledger.post, { transactionId });
      if (r === "ok") posted++;
      else failed++;
    }
    return { posted, failed };
  },
});

/** One page of movements with what the balance check needs. */
export const balancePage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("transactions").paginate({ cursor, numItems: 2000 });
    return {
      rows: page.page.map((t) => {
        const posted = t.ledgerTxId !== undefined;
        const reverted = t.ledgerRevertTxId !== undefined;
        return {
          account: customerAccount(t),
          // What the ledger should hold for this row given what was sent to it
          amount: posted && !reverted ? signedAmount(t) : 0,
          // Not (fully) in the ledger yet: Convex and the ledger differ by it for now
          pending: !posted || (t.status === "reversed" && !reverted),
        };
      }),
      cursor: page.continueCursor,
      done: page.isDone,
    };
  },
});

export const saveCheck = internalMutation({
  args: {
    accounts: v.number(),
    unposted: v.number(),
    mismatches: v.array(v.object({ account: v.string(), convex: v.number(), ledger: v.number() })),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("ledgerChecks", { at: Date.now(), ...args });
  },
});

/**
 * Nightly: every customer account's balance in Formance against what Convex
 * sent it. Movements not (fully) posted yet are counted apart, so a backlog
 * doesn't read as a discrepancy; any mismatch left is a real one.
 */
export const check = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!ledgerEnabled()) return null;
    const expected = new Map<string, number>();
    let unposted = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: { rows: { account: string; amount: number; pending: boolean }[]; cursor: string; done: boolean } =
        await ctx.runQuery(internal.ledger.balancePage, { cursor });
      for (const r of page.rows) {
        if (r.pending) unposted++;
        expected.set(r.account, (expected.get(r.account) ?? 0) + r.amount);
      }
      if (page.done) break;
      cursor = page.cursor;
    }

    const actual = new Map<string, number>();
    try {
      const sdk = client();
      let next: string | undefined;
      do {
        const res = await sdk.ledger.v2.listAccounts({
          ledger: LEDGER(),
          pageSize: 100,
          cursor: next,
          expand: "volumes",
        });
        const c = res.v2AccountsCursorResponse!.cursor;
        for (const a of c.data) {
          if (!a.address.startsWith("customers:")) continue;
          const total = Object.values(a.volumes ?? {}).reduce(
            (s, vol) => s + Number(vol.balance ?? vol.input - vol.output),
            0,
          );
          actual.set(a.address, total);
        }
        next = c.hasMore ? c.next : undefined;
      } while (next);
    } catch (e) {
      await ctx.runMutation(internal.ledger.saveCheck, {
        accounts: 0, unposted, mismatches: [], error: describe(e),
      });
      return null;
    }

    const mismatches: { account: string; convex: number; ledger: number }[] = [];
    for (const account of new Set([...expected.keys(), ...actual.keys()])) {
      const convex = expected.get(account) ?? 0;
      const ledger = actual.get(account) ?? 0;
      if (convex !== ledger) mismatches.push({ account, convex, ledger });
    }
    await ctx.runMutation(internal.ledger.saveCheck, {
      accounts: expected.size,
      unposted,
      mismatches: mismatches.slice(0, MAX_MISMATCHES),
    });
    return mismatches.length;
  },
});

/**
 * Ledger health for the dashboard (transactions:audit): whether it is on,
 * the posting backlog and failures, and the last balance check.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!(await authz.can(ctx, user._id, "transactions:audit"))) throw new ConvexError("FORBIDDEN");
    if (!ledgerEnabled()) return { enabled: false as const };
    // Capped counts: enough to show "1 000+" without scanning everything
    const CAP = 1000;
    const backlog = await ctx.db
      .query("transactions")
      .withIndex("by_ledger_tx", (q) => q.eq("ledgerTxId", undefined))
      .take(CAP);
    const failed = backlog.filter((t) => t.ledgerError);
    const lastCheck = await ctx.db.query("ledgerChecks").order("desc").first();
    // Account address → customer name, for the mismatch table
    const mismatches = [];
    for (const m of lastCheck?.mismatches ?? []) {
      const id = ctx.db.normalizeId("customers", m.account.split(":")[1] ?? "");
      const customer = id ? await ctx.db.get(id) : null;
      mismatches.push({ ...m, client: customer?.fullName ?? null });
    }
    return {
      enabled: true as const,
      ledger: LEDGER(),
      backlog: backlog.length,
      backlogCapped: backlog.length === CAP,
      failures: failed.slice(0, 10).map((t) => ({ id: t._id, error: t.ledgerError!, timestamp: t.timestamp })),
      lastCheck: lastCheck
        ? {
            at: lastCheck.at,
            accounts: lastCheck.accounts,
            unposted: lastCheck.unposted,
            mismatches,
            error: lastCheck.error ?? null,
          }
        : null,
    };
  },
});
