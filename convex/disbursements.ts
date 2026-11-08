// convex/disbursements.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { authz } from "./authz";
import { requireUser } from "./users";

export const approveDisbursement = mutation({
  args: { disbursementId: v.id("disbursements") },
  handler: async (ctx, args) => {
    const supervisor = await requireUser(ctx);
    await authz.require(ctx, supervisor._id, "disbursements:approve");

    const record = await ctx.db.get(args.disbursementId);
    if (!record) throw new Error("Disbursement not found");

    if (record.initiatedBy === supervisor._id) {
      throw new Error("Fraud Prevention: You cannot approve your own request.");
    }

    await ctx.db.patch(args.disbursementId, {
      status: "approved",
      approvedBy: supervisor._id,
    });
  },
});