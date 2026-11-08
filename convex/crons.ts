// convex/crons.ts — scheduled jobs
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Formance audit ledger (ledger.ts): post what is missing (retries and
// backfill), then compare balances every night. Both do nothing until
// FORMANCE_URL is set.
crons.interval("ledger sweep", { minutes: 5 }, internal.ledger.sweep, {});
crons.daily("ledger balance check", { hourUTC: 2, minuteUTC: 17 }, internal.ledger.check, {});

export default crons;
