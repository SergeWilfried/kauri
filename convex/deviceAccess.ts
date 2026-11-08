// convex/deviceAccess.ts — who may use which TPE. A TPE can be shared by
// several agents (deviceAssignments); an agent has at most one TPE. Devices
// bound before sharing existed still carry the legacy `devices.assignedTo`,
// read here as a fallback until devices:migrateAssignments has run.
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";

/** The TPE an agent may collect with, or null. */
export async function deviceOfUser(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"devices"> | null> {
  const assignment = await ctx.db
    .query("deviceAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (assignment) return await ctx.db.get(assignment.deviceId);
  return await ctx.db
    .query("devices")
    .withIndex("by_assignee", (q) => q.eq("assignedTo", userId))
    .first();
}

/** The agents allowed on a TPE, in binding order. */
export async function agentsOfDevice(ctx: QueryCtx, device: Doc<"devices">): Promise<Id<"users">[]> {
  const rows = await ctx.db
    .query("deviceAssignments")
    .withIndex("by_device", (q) => q.eq("deviceId", device._id))
    .collect();
  const ids = rows.sort((a, b) => a.boundAt - b.boundAt).map((r) => r.userId);
  if (device.assignedTo && !ids.includes(device.assignedTo)) ids.unshift(device.assignedTo);
  return ids;
}

/** Every binding as userId → device, for list pages (one read of each table). */
export async function devicesByUser(ctx: QueryCtx, devices: Doc<"devices">[]) {
  const byId = new Map(devices.map((d) => [d._id as string, d]));
  const map = new Map<string, Doc<"devices">>();
  for (const d of devices) if (d.assignedTo) map.set(d.assignedTo, d);
  for (const a of await ctx.db.query("deviceAssignments").collect()) {
    const d = byId.get(a.deviceId);
    if (d) map.set(a.userId, d);
  }
  return map;
}
