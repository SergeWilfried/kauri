# Partner API (Nafa)

HTTP API for a partner app's **backend** to sell Mizo savings products to its
own users. Code: `convex/http.ts` (routes), `convex/channelApi.ts` (rules),
`convex/apiClients.ts` (keys).

## Model

- A partner has a **service staff member** in its **own branch**. Customers it
  creates live in that branch; their movements are recorded under that staff
  member, with `channel: "api"` and `tpeId: "API"`. On the dashboard it shows
  up as an agent named "<partner> (API)", with its customers and collections.
- A partner sells only products with its channel ticked on the dashboard
  (Produits → Distribution → Applications partenaires), that are **active**,
  of the **épargne** or **tontine** family, and open to its branch.
- A customer holds **one balance per product** (a "vault"). Partner movements
  carry the product; agents' movements don't.
- A product with a minimum duration (`durationMin` months) **locks** its
  balance for that long after the customer's first deposit on it.

## Set up a partner (CLI)

```bash
npx convex run apiClients:create '{"name":"Nafa","channel":"nafa",
  "newBranch":{"organizationId":"<org id>","name":"Nafa (canal digital)","code":"NAFA-01","location":"En ligne"}}'
# → { apiClientId, key }   The key is shown once: store it in the partner's secrets.

npx convex run apiClients:rotate '{"apiClientId":"…"}'   # new key, old one stops working
npx convex run apiClients:revoke '{"apiClientId":"…"}'   # cut the partner off
```

Suspending the service staff member on the dashboard also cuts it off.

For a dev or preview deployment, give the partner demo products (one per Nafa
theme, plus `NAFA-LIBRE`; re-running updates them):

```bash
npx convex run apiClients:seedDemoCatalogue '{"apiClientId":"…"}'
```

## Public catalogue (no key)

`GET /api/v1/public/catalogue?partner=<apiClientId>` returns the same body as
`GET /api/v1/catalogue` with no key, so the partner's app can show its offer
directly. The partner ID isn't a secret. Any origin may read it (CORS `*`),
and it may be cached for 5 minutes. `404 PARTNER_NOT_FOUND` for an unknown or
revoked partner.

## Calls

Base URL: the deployment's `.convex.site` address. Every call sends
`Authorization: Bearer mzk_…`. **Server to server only: never put the key in
a mobile app.** Bodies and responses are JSON.

| Call | Body / query | Returns |
|---|---|---|
| `GET /api/v1/catalogue` | | `{ currency, products: [{ code, name, family, summary, rate, durationMin, durationMax, minDeposit, maxBalance, fees, feesUnit, grace, kycLevel, updatedAt }] }` |
| `POST /api/v1/customers` | `{ fullName, phoneNumber, idNumber? }` | `{ customerId, status: "prospect" }` |
| `GET /api/v1/customer` | `?customerId=` | `{ customerId, fullName, phoneNumber, status, balance, vaults: [{ productCode, productName, rate, balance, firstDepositAt, lockedUntil }] }` |
| `GET /api/v1/transactions` | `?customerId=&productCode=&limit=` | newest first: `[{ transactionId, reference, type, amount, currency, productCode, status, reversalReason, timestamp }]` |
| `POST /api/v1/deposits` | `{ customerId, productCode, amount, reference }` | `{ transactionId, status, balance, replayed }` |
| `POST /api/v1/withdrawals` | same | same |
| `POST /api/v1/withdrawals/cancel` | `{ reference, reason? }` | `{ transactionId, status: "reversed" }` |

- **`reference`** is the partner's payment ID (max 64 characters). Sending the
  same one again returns the stored movement (`replayed: true`) instead of
  moving money twice. Reusing it for a different movement is
  `DUPLICATE_REFERENCE`.
- **Deposit** once the customer's mobile money payment is confirmed.
- **Withdraw** before sending the transfer to the customer's wallet; if the
  transfer fails, **cancel** the withdrawal (within 24 h, before the day is
  reconciled) to put the money back. Cancelling twice is harmless.
- KYC: new customers are `prospect`; the back office verifies them on the
  dashboard. Deposits are refused only for `rejected` customers.

## Errors

`{ "error": CODE, ...details }`

| HTTP | Codes |
|---|---|
| 400 | `INVALID_REQUEST`, `INVALID_AMOUNT`, `INVALID_REFERENCE`, `INVALID_PHONE`, `NAME_REQUIRED`, `INVALID_ID_NUMBER` |
| 401 | `UNAUTHORIZED` (missing, unknown or revoked key; suspended service account) |
| 404 | `CUSTOMER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `TRANSACTION_NOT_FOUND` |
| 409 | `PHONE_TAKEN` (+ `customerId`), `DUPLICATE_REFERENCE`, `DAY_CLOSED` |
| 422 | `PRODUCT_NOT_AVAILABLE`, `CUSTOMER_REJECTED`, `BELOW_MIN_DEPOSIT` (+ `minDeposit`, first deposit only), `OVER_MAX_BALANCE` (+ `maxBalance`), `LOCKED` (+ `lockedUntil`, ms), `INSUFFICIENT_BALANCE`, `CANCEL_WINDOW_PASSED` |

## Reconciliation

The partner's day is reconciled like an agent's (`settleDailyCash` on the
service staff member): the accountant enters what the mobile money provider
actually settled. Once a day is reconciled, movements and cancellations on it
are refused (`DAY_CLOSED`).

## Not yet

- Interest: `rate` is published but nothing credits it yet.
- One vault per product per customer.
- `grace` and `fees` are published, not applied.
