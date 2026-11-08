import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authz } from "./authz";
import { signedAmount } from "./transactions";
import { requireUser } from "./users";

export const settleDailyCash = mutation({
  args: {
    agentId: v.id("users"),
    physicalAmount: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const verifier = await requireUser(ctx);
    await authz.require(ctx, verifier._id, "reconciliation:liquidate");

    const today = new Date().toISOString().split('T')[0];
    const dayStart = Date.parse(today + "T00:00:00Z");

    const existing = await ctx.db
      .query("reconciliations")
      .withIndex("by_agent_date", (q) => q.eq("agentId", args.agentId).eq("date", today))
      .first();
    if (existing) throw new Error("Daily cash already reconciled for this agent");

    // 2. Aggregate all 'completed' transactions for this agent today (UTC day)
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_agent_date", (q) => q.eq("agentId", args.agentId))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "completed"),
          // Imported history was never in this agent's cash drawer
          q.neq(q.field("imported"), true),
          q.gte(q.field("timestamp"), dayStart),
        )
      )
      .collect();

    // Cash the agent should hold: deposits taken in minus withdrawals paid out
    const systemExpected = transactions.reduce((sum, tx) => sum + signedAmount(tx), 0);
    const variance = args.physicalAmount - systemExpected;

    // 3. Determine status
    const status = variance === 0 ? "settled" : "discrepancy";

    // 4. Create the reconciliation record
    if (!transactions[0]) throw new Error("No transactions found for agent today");

    const reconciliationId = await ctx.db.insert("reconciliations", {
      agentId: args.agentId,
      branchId: transactions[0].branchId,
      verifiedBy: verifier._id,
      date: today,
      systemExpectedAmount: systemExpected,
      physicalCashReceived: args.physicalAmount,
      variance: variance,
      status: status,
      timestamp: Date.now(),
      notes: args.notes,
    });

    return { reconciliationId, variance };
  },
});


// 3. The Reconciliation WorkflowA clean EOD process usually follows these three steps to minimize "mysterious" cash losses:Step A: The Agent's Pre-Check (TPE Side)Before heading to the branch, 
// the agent runs a "Daily Summary" on the TPE.The TPE displays: "Total Collected: 450,000 CFA".The agent counts their physical cash. If it's 450,000 CFA, they proceed. If it's 445,000 CFA, 
// they know they have a problem before talking to the accountant.Step B: The Physical HandoverAt the branch, the Accountant uses the settleDailyCash mutation.Case 1: $Variance = 0$. Perfect. 
// The session is closed.Case 2: $Variance < 0$ (Shortfall). The agent is "short." The system flags a discrepancy. 
// This usually triggers an internal HR process or a deduction from the agent's 
// next commission.Case 3: $Variance > 0$ (Overage). Rare, but usually indicates an agent forgot to record a transaction or gave a customer the wrong change.Step C: Locking the TransactionsOnce a reconciliation is settled, 
// your transactions table should ideally become "read-only" for that date.Implementation Tip: In your reverseTransaction mutation, add a check:If a reconciliation record exists for this agent on this date and is 'settled', block the reversal. 
// This prevents agents and supervisors from colluding to reverse transactions after the cash has already been accounted for.4. Why Use Math for Variances?Using a simple formula 
// ensures the Accountant doesn't have to do mental math (where errors happen):$$Variance = V_{physical} - \sum V_{system}$$By storing the $Variance$ as a signed integer, 
// you can run a monthly report to see which agents are consistently "short," which is a leading indicator of either poor training or potential fraud.Are you planning to generate a PDF or thermal receipt for the agent to keep as proof 
// that they "dropped" the cash successfully?