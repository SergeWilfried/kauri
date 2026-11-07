// convex/schema.ts
import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Convex Auth tables (sessions, accounts, tokens…). Its default `users`
// table is replaced by the staff table below, which auth links to by email.
const { users: _authUsers, ...authOnlyTables } = authTables;

// Where the phone was, as Expo Location reports it. `mocked` is Android's
// "position simulée" flag (a fake-GPS app); `at` is when the fix was taken.
export const geoFix = v.object({
  lat: v.number(),
  lng: v.number(),
  accuracy: v.optional(v.number()), // metres
  mocked: v.optional(v.boolean()),
  at: v.optional(v.number()),
});

export default defineSchema({
  ...authOnlyTables,

  // 1. ORGANIZATIONAL STRUCTURE

  // Top-level tenant — one MFI licence = one organization
  organizations: defineTable({
    name: v.string(),               // "Kauri Finance S.A."
    country: v.string(),            // ISO-3166 alpha-2, e.g. "BF"
    currency: v.string(),           // ISO-4217, e.g. "XOF"
    licenseNumber: v.string(),      // Regulatory / BCEAO licence ref
    status: v.union(v.literal("active"), v.literal("suspended")),
    logoUrl: v.optional(v.string()),
  }).index("by_country", ["country"]),

  branches: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    location: v.string(),
    code: v.string(), // e.g., "OUAGA-01"
  })
    .index("by_code", ["code"])
    .index("by_organization", ["organizationId"]),

  // 2. USER MANAGEMENT (Agents, Supervisors)
  users: defineTable({
    fullName: v.string(),
    email: v.string(),
    phoneNumber: v.string(),
    tokenIdentifier: v.optional(v.string()), // Legacy external-auth ID, unused
    branchId: v.id("branches"),
    status: v.union(v.literal("active"), v.literal("suspended")),
    // One-time code an administrator issues for "Première connexion"
    activationCodeHash: v.optional(v.string()),
    activationExpiresAt: v.optional(v.number()),
  })
    .index("email", ["email"]) // Name required by Convex Auth
    .index("by_phone", ["phoneNumber"]), // Agents sign in with their phone (auth.ts)

  // 3. KYC & CUSTOMERS
  customers: defineTable({
    fullName: v.string(),
    phoneNumber: v.string(),
    idNumber: v.string(), // National ID / Passport
    branchId: v.id("branches"),
    onboardedBy: v.id("users"),
    status: v.union(
      v.literal("prospect"), 
      v.literal("verified"), 
      v.literal("rejected")
    ),
    metadata: v.optional(v.any()), // Extra KYC info
    // Product the client holds, set from the dashboard (portfolio.ts)
    productId: v.optional(v.id("products")),
    // Photos of the ID document, front and back (customers:setIdImage)
    idImages: v.optional(v.object({
      front: v.optional(v.id("_storage")),
      back: v.optional(v.id("_storage")),
    })),
  })
    .index("by_phone", ["phoneNumber"])
    .index("by_status", ["status"])
    .index("by_branch", ["branchId"]),

  // 4. DEVICE BINDING (TPE Tracking)
  devices: defineTable({
    serialNumber: v.string(), // Hardcoded TPE Serial
    model: v.string(),
    // Legacy single binding. Agents now live in deviceAssignments (several per
    // TPE); devices:migrateAssignments moves this over, and reads fall back to
    // it until then (deviceAccess.ts)
    assignedTo: v.optional(v.id("users")),
    boundBy: v.optional(v.id("users")), // Last it_admin to bind/unbind
    boundAt: v.optional(v.number()),
    // Set when an agent's phone registers itself on the "liaison" screen
    // (devices:registerMine); cleared once an it_admin binds the device.
    requestedBy: v.optional(v.id("users")),
    requestedAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("maintenance"), v.literal("lost")),
    lastSync: v.number(), // last time the phone checked in (devices:heartbeat)
    // What the phone reported at its last check-in
    telemetry: v.optional(v.object({
      appVersion: v.optional(v.string()), // e.g. "1.0.0 (42)"
      updateId: v.optional(v.string()), // EAS Update running on top of the build
      osVersion: v.optional(v.string()),
      battery: v.optional(v.number()), // 0..1
      charging: v.optional(v.boolean()),
      network: v.optional(v.union(v.literal("wifi"), v.literal("cellular"), v.literal("none"), v.literal("other"))),
      pendingOps: v.optional(v.number()), // operations recorded offline, not yet on the server
      // Phone clock minus server clock at the check-in, in ms: a phone set
      // back in time can back-date what it records offline
      clockSkewMs: v.optional(v.number()),
      rooted: v.optional(v.boolean()), // expo-device's root / jailbreak guess
      emulator: v.optional(v.boolean()),
      // Location permission refused: transactions then carry no position
      locationDenied: v.optional(v.boolean()),
      location: v.optional(geoFix),
      // Agent signed in on the phone at that check-in (shared TPEs)
      reportedBy: v.optional(v.id("users")),
    })),
  })
    .index("by_serial", ["serialNumber"])
    .index("by_assignee", ["assignedTo"])
    .index("by_requester", ["requestedBy"]),

  // Agents allowed to collect with a TPE: several per TPE (shared terminals),
  // at most one TPE per agent so each movement traces to a single device
  deviceAssignments: defineTable({
    deviceId: v.id("devices"),
    userId: v.id("users"),
    boundBy: v.id("users"),
    boundAt: v.number(),
  })
    .index("by_device", ["deviceId"])
    .index("by_user", ["userId"]),

  // 5. CASH COLLECTIONS (Transactions)
  transactions: defineTable({
    // Missing on rows written before withdrawals existed: those are deposits
    type: v.optional(v.union(v.literal("deposit"), v.literal("withdrawal"))),
    amount: v.number(), // always positive; `type` gives the direction
    currency: v.string(), // e.g., "XOF"
    customerId: v.id("customers"),
    agentId: v.id("users"),
    branchId: v.id("branches"),
    tpeId: v.string(), // Serial of the TPE used
    status: v.union(v.literal("completed"), v.literal("reversed")),
    reversalReason: v.optional(v.string()),
    reversedBy: v.optional(v.id("users")), // Supervisor ID
    timestamp: v.number(),
    // UUID the mobile app generates when it records a collection, so an
    // offline replay can't create the same deposit twice
    clientId: v.optional(v.string()),
    // Withdrawal the app queued offline and replayed later
    offline: v.optional(v.boolean()),
    // That offline withdrawal took the customer's balance below zero
    overdraft: v.optional(v.boolean()),
    // Past movement loaded from a spreadsheet (imports.ts): counts in the
    // customer's balance, never in an agent's cash or own collections
    imported: v.optional(v.boolean()),
    // Agent named in the spreadsheet; agentId is the importer
    importedAgentName: v.optional(v.string()),
    // Recorded through the partner API (channelApi.ts) rather than at a TPE;
    // tpeId is then "API"
    channel: v.optional(v.literal("api")),
    // Product the movement belongs to. Set by the partner API, where one
    // customer holds a separate balance (a "vault") per product; agents'
    // movements leave it unset and count in the customer's overall balance.
    productId: v.optional(v.id("products")),
    // When the agent recorded it on the TPE (phone clock). Differs from
    // `timestamp` (server time) when it was queued offline and synced later.
    recordedAt: v.optional(v.number()),
    // Where the TPE was when the agent recorded it
    location: v.optional(geoFix),
    // Audit copy in the Formance ledger (ledger.ts): its transaction id, the
    // id of its revert once reversed, and the last posting error if any
    ledgerTxId: v.optional(v.string()),
    ledgerRevertTxId: v.optional(v.string()),
    ledgerError: v.optional(v.string()),
  })
    .index("by_agent_date", ["agentId"]) // Convex appends _creationTime to every index
    .index("by_branch", ["branchId"])
    .index("by_customer", ["customerId"])
    .index("by_customer_product", ["customerId", "productId"])
    .index("by_client_id", ["clientId"])
    .index("by_ledger_tx", ["ledgerTxId"])
    .index("by_ledger_revert", ["status", "ledgerRevertTxId"]),

  // Nightly comparison of customer balances with the Formance ledger (ledger.ts)
  ledgerChecks: defineTable({
    at: v.number(),
    accounts: v.number(),
    unposted: v.number(), // movements not (fully) in the ledger yet
    mismatches: v.array(v.object({ account: v.string(), convex: v.number(), ledger: v.number() })),
    error: v.optional(v.string()), // the check couldn't read the ledger
  }),

  // 6. DISBURSEMENTS (Maker-Checker Workflow)
  disbursements: defineTable({
    amount: v.number(),
    customerId: v.id("customers"),
    branchId: v.id("branches"),
    initiatedBy: v.id("users"), // The "Maker"
    approvedBy: v.optional(v.id("users")), // The "Checker"
    status: v.union(
      v.literal("pending"), 
      v.literal("approved"), 
      v.literal("executed"), 
      v.literal("rejected")
    ),
    timestamp: v.number(),
    payoutMethod: v.union(v.literal("cash"), v.literal("mobile_money")),
    transactionId: v.optional(v.string()), // External reference from payment gateway
  }).index("by_status", ["status"]),
  // Add this to your existing schema.ts
reconciliations: defineTable({
    agentId: v.id("users"),
    branchId: v.id("branches"),
    verifiedBy: v.id("users"), // The Accountant/Supervisor
    
    date: v.string(), // YYYY-MM-DD for easy indexing
    systemExpectedAmount: v.number(), // Sum of transactions
    physicalCashReceived: v.number(), // What the agent actually handed over
    variance: v.number(), // physical - expected
    timestamp: v.number(),
    status: v.union(v.literal("pending"), v.literal("settled"), v.literal("discrepancy")),
    notes: v.optional(v.string()),
  })
    .index("by_agent_date", ["agentId", "date"])
    .index("by_branch_status", ["branchId", "status"]),

  // 7. PRODUCT CATALOGUE (one per organization, see portfolio.ts)
  products: defineTable({
    organizationId: v.id("organizations"),
    code: v.string(), // upper case, unique in the organization
    name: v.string(),
    family: v.union(
      v.literal("epargne"),
      v.literal("credit"),
      v.literal("tontine"),
      v.literal("assurance"),
    ),
    summary: v.string(),
    status: v.union(v.literal("actif"), v.literal("brouillon"), v.literal("archive")),
    rate: v.number(), // % per year
    durationMin: v.number(), // months; 0 / 0 = open-ended
    durationMax: v.number(),
    minDeposit: v.number(), // FCFA
    maxBalance: v.number(), // FCFA, 0 = no ceiling
    fees: v.number(),
    feesUnit: v.union(v.literal("FCFA"), v.literal("%")),
    grace: v.number(), // days
    kycLevel: v.string(),
    targets: v.array(v.string()),
    branchIds: v.array(v.id("branches")), // branches allowed to sell it
    // Partner apps allowed to offer it through the API (apiClients.channel)
    channels: v.optional(v.array(v.literal("nafa"))),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_code", ["organizationId", "code"]),

  // 8. PARTNER API CLIENTS (apiClients.ts, channelApi.ts)
  // A partner app's backend calling the HTTP API with a secret key. It acts
  // as its service staff member (`userId`, no password, no roles) in that
  // member's branch, which holds the partner's customers.
  apiClients: defineTable({
    name: v.string(),
    channel: v.literal("nafa"), // which products it may sell (products.channels)
    keyHash: v.string(), // SHA-256 hex of the key; the key itself is never stored
    userId: v.id("users"),
    status: v.union(v.literal("active"), v.literal("revoked")),
    createdAt: v.number(),
  }).index("by_key_hash", ["keyHash"]),

  // 9. DEVICE KEYS (deviceKeys.ts)
  // Lets a phone where an agent set their PIN sign that agent back in when
  // the server session has expired, without the password: the app keeps the
  // key in its secure storage and sends it with the "deviceKey" provider
  // (auth.ts). One per agent and app install; deleted when the agent is
  // suspended, unbound from a TPE or has their password reset.
  deviceKeys: defineTable({
    userId: v.id("users"),
    installId: v.string(), // random id of the app install, chosen by the phone
    secretHash: v.string(), // SHA-256 hex of the secret; the secret is never stored
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_install", ["userId", "installId"]),
});