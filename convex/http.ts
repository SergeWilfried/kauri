// convex/http.ts — HTTP routes: Convex Auth, and the partner API (channelApi.ts)
import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { ActionCtx, httpAction } from "./_generated/server";
import { hashApiKey } from "./apiClients";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

// ─── Partner API ─────────────────────────────────────────────────────────────
// Server to server only: the key must never ship inside a mobile app.
// Requests and responses are JSON. Errors are { error: CODE, ...details }.
// Reference: docs/partner-api.md

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

const STATUS_BY_ERROR: Record<string, number> = {
  UNAUTHORIZED: 401,
  PARTNER_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  TRANSACTION_NOT_FOUND: 404,
  PHONE_TAKEN: 409,
  DUPLICATE_REFERENCE: 409,
  DAY_CLOSED: 409,
  PRODUCT_NOT_AVAILABLE: 422,
  CUSTOMER_REJECTED: 422,
  BELOW_MIN_DEPOSIT: 422,
  OVER_MAX_BALANCE: 422,
  LOCKED: 422,
  INSUFFICIENT_BALANCE: 422,
  CANCEL_WINDOW_PASSED: 422,
};

class BadRequest extends Error {}

/**
 * A ConvexError's payload as { code, ...details }. channelApi throws either a
 * code ("LOCKED") or { code, ...details }; crossing runQuery / runMutation
 * may hand it over JSON-encoded, so both forms are accepted.
 */
function errorData(data: unknown): { code: string; [k: string]: unknown } {
  if (typeof data === "string") {
    try {
      return errorData(JSON.parse(data));
    } catch {
      return { code: data };
    }
  }
  if (data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string") {
    return data as { code: string };
  }
  return { code: "ERROR" };
}

type Handler = (ctx: ActionCtx, keyHash: string, request: Request) => Promise<unknown>;

/**
 * Wrap an API handler: check the bearer key's shape and hash it (the lookup
 * happens in channelApi), and turn ConvexError codes into HTTP statuses.
 */
const endpoint = (handler: Handler) =>
  httpAction(async (ctx, request) => {
    const match = /^Bearer (mzk_[0-9a-f]{64})$/.exec(request.headers.get("Authorization") ?? "");
    if (!match) return json(401, { error: "UNAUTHORIZED" });
    try {
      return json(200, await handler(ctx, await hashApiKey(match[1]), request));
    } catch (e) {
      if (e instanceof BadRequest) return json(400, { error: "INVALID_REQUEST", message: e.message });
      if (e instanceof ConvexError) {
        const { code, ...details } = errorData(e.data);
        return json(STATUS_BY_ERROR[code] ?? 400, { error: code, ...details });
      }
      console.error(e);
      return json(500, { error: "INTERNAL" });
    }
  });

/** The JSON body as an object, or a 400. */
async function body(request: Request): Promise<Record<string, unknown>> {
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BadRequest("JSON object expected");
  return parsed as Record<string, unknown>;
}

function str(o: Record<string, unknown>, k: string): string {
  if (typeof o[k] !== "string") throw new BadRequest(`${k} must be a string`);
  return o[k] as string;
}

function optStr(o: Record<string, unknown>, k: string): string | undefined {
  return o[k] === undefined || o[k] === null ? undefined : str(o, k);
}

function num(o: Record<string, unknown>, k: string): number {
  if (typeof o[k] !== "number") throw new BadRequest(`${k} must be a number`);
  return o[k] as number;
}

function param(request: Request, k: string): string {
  const value = new URL(request.url).searchParams.get(k);
  if (!value) throw new BadRequest(`${k} is required`);
  return value;
}

function movement(o: Record<string, unknown>) {
  return {
    customerId: str(o, "customerId"),
    productCode: str(o, "productCode"),
    amount: num(o, "amount"),
    reference: str(o, "reference"),
  };
}

http.route({
  path: "/api/v1/catalogue",
  method: "GET",
  handler: endpoint((ctx, keyHash) => ctx.runQuery(internal.channelApi.catalogue, { keyHash })),
});

// Public: the partner's offer as its app shows it, with no key. Any origin may
// read it (the app also runs on the web); a short cache keeps load low.
http.route({
  path: "/api/v1/public/catalogue",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
    const partnerId = new URL(request.url).searchParams.get("partner");
    if (!partnerId) return json(400, { error: "INVALID_REQUEST", message: "partner is required" }, headers);
    try {
      return json(200, await ctx.runQuery(internal.channelApi.publicCatalogue, { partnerId }), headers);
    } catch (e) {
      if (e instanceof ConvexError && errorData(e.data).code === "PARTNER_NOT_FOUND") {
        return json(404, { error: "PARTNER_NOT_FOUND" }, headers);
      }
      console.error(e);
      return json(500, { error: "INTERNAL" }, headers);
    }
  }),
});

http.route({
  path: "/api/v1/customers",
  method: "POST",
  handler: endpoint(async (ctx, keyHash, request) => {
    const o = await body(request);
    return ctx.runMutation(internal.channelApi.createCustomer, {
      keyHash,
      fullName: str(o, "fullName"),
      phoneNumber: str(o, "phoneNumber"),
      idNumber: optStr(o, "idNumber"),
    });
  }),
});

http.route({
  path: "/api/v1/customer",
  method: "GET",
  handler: endpoint((ctx, keyHash, request) =>
    ctx.runQuery(internal.channelApi.customer, { keyHash, customerId: param(request, "customerId") }),
  ),
});

http.route({
  path: "/api/v1/transactions",
  method: "GET",
  handler: endpoint(async (ctx, keyHash, request) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit"));
    return ctx.runQuery(internal.channelApi.transactions, {
      keyHash,
      customerId: param(request, "customerId"),
      productCode: url.searchParams.get("productCode") || undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
  }),
});

http.route({
  path: "/api/v1/deposits",
  method: "POST",
  handler: endpoint(async (ctx, keyHash, request) =>
    ctx.runMutation(internal.channelApi.deposit, { keyHash, ...movement(await body(request)) }),
  ),
});

http.route({
  path: "/api/v1/withdrawals",
  method: "POST",
  handler: endpoint(async (ctx, keyHash, request) =>
    ctx.runMutation(internal.channelApi.withdraw, { keyHash, ...movement(await body(request)) }),
  ),
});

http.route({
  path: "/api/v1/withdrawals/cancel",
  method: "POST",
  handler: endpoint(async (ctx, keyHash, request) => {
    const o = await body(request);
    return ctx.runMutation(internal.channelApi.cancelWithdrawal, {
      keyHash,
      reference: str(o, "reference"),
      reason: optStr(o, "reason") ?? "",
    });
  }),
});

export default http;
