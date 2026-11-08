// convex/devices.ts — TPE ↔ agent binding (it_admin only, via devices:bind).
// A TPE can be shared by several agents (each signs in with their own
// account); an agent has at most one TPE. Agents' phones register themselves
// (registerMine) so the dashboard can offer a one-click "Lier"; only an
// it_admin can actually bind.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, Infer, v } from "convex/values";
import { internalMutation, mutation, MutationCtx, query } from "./_generated/server";
import { authz } from "./authz";
import { geoFix } from "./schema";
import { Doc, Id } from "./_generated/dataModel";
import { agentsOfDevice, deviceOfUser } from "./deviceAccess";
import { assignedDevice, requireUser } from "./users";
import { revokeDeviceKeys } from "./deviceKeys";

/**
 * Return the authenticated user after checking the devices:bind permission.
 * @throws If authentication, permission, or the user's database record is missing.
 */
async function requireBinder(ctx: MutationCtx) {
  const actor = await requireUser(ctx);
  await authz.require(ctx, actor._id, "devices:bind");
  return actor;
}

/**
 * Look up a device by its serial number.
 * @throws If no device has the supplied serial number.
 */
async function getDevice(ctx: MutationCtx, serialNumber: string) {
  const device = await ctx.db
    .query("devices")
    .withIndex("by_serial", (q) => q.eq("serialNumber", serialNumber))
    .unique();
  if (!device) throw new Error("Device not found");
  return device;
}

// Agents sharing one TPE, at most
export const MAX_AGENTS_PER_DEVICE = 6;

/** Remove one agent's binding to a device (the assignment row and/or the legacy field). */
async function removeAgent(ctx: MutationCtx, device: Doc<"devices">, userId: Id<"users">) {
  const rows = await ctx.db
    .query("deviceAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const r of rows) if (r.deviceId === device._id) await ctx.db.delete(r._id);
  if (device.assignedTo === userId) await ctx.db.patch(device._id, { assignedTo: undefined });
}

/**
 * Let an active field agent or supervisor collect with an active device,
 * requiring devices:bind. Several agents may share a TPE (up to
 * MAX_AGENTS_PER_DEVICE); an agent keeps at most one TPE. Records the actor
 * and time, and clears the agent's pending request on this device.
 * Returns the device ID; binding an agent already on the device is a no-op.
 */
export const bindDevice = mutation({
  args: { serialNumber: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requireBinder(ctx);
    const device = await getDevice(ctx, args.serialNumber);

    if (device.status !== "active") {
      throw new Error(`Device is ${device.status}; only active devices can be bound`);
    }
    const agents = await agentsOfDevice(ctx, device);
    if (agents.includes(args.userId)) return device._id;
    if (agents.length >= MAX_AGENTS_PER_DEVICE) {
      throw new Error(`A TPE can be shared by ${MAX_AGENTS_PER_DEVICE} agents at most`);
    }

    const agent = await ctx.db.get(args.userId);
    if (!agent) throw new Error("Agent not found");
    if (agent.status !== "active") throw new Error("Agent is suspended");
    // Only collecting roles (field_agent, supervisor) need a terminal
    if (!(await authz.can(ctx, agent._id, "transactions:collect"))) {
      throw new Error("Only field agents and supervisors can be bound to a TPE");
    }

    // One terminal per agent, so every collection traces to a single device
    const existing = await deviceOfUser(ctx, args.userId);
    if (existing) {
      throw new Error(`Agent already has ${existing.serialNumber}; unbind it first`);
    }

    const now = Date.now();
    await ctx.db.insert("deviceAssignments", {
      deviceId: device._id,
      userId: args.userId,
      boundBy: actor._id,
      boundAt: now,
    });
    await ctx.db.patch(device._id, {
      boundBy: actor._id,
      boundAt: now,
      ...(device.requestedBy === args.userId ? { requestedBy: undefined, requestedAt: undefined } : {}),
    });
    return device._id;
  },
});

const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9 ._-]{2,49}$/;

/**
 * Called by the mobile app's "liaison" screen: record this phone's serial as a
 * device waiting to be bound to the signed-in agent, so it shows on the
 * dashboard as "Non affecté · demandé par …". It never binds anything itself.
 * Only active staff who can collect (field agents, supervisors) can register.
 * A TPE already used by other agents can be requested too (shared TPE).
 * An agent has at most one pending request: a new serial replaces the old one,
 * and a device row that was only ever a request is deleted.
 * Returns "bound" (the caller already uses this TPE), "pending", or throws
 * `INVALID_SERIAL`.
 */
export const registerMine = mutation({
  args: { serialNumber: v.string(), model: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (user.status !== "active") throw new ConvexError("SUSPENDED");
    if (!(await authz.can(ctx, user._id, "transactions:collect"))) throw new ConvexError("FORBIDDEN");
    const serialNumber = args.serialNumber.trim().toUpperCase();
    if (!SERIAL_PATTERN.test(serialNumber)) throw new ConvexError("INVALID_SERIAL");
    const model = args.model.trim().slice(0, 60) || "Inconnu";
    const now = Date.now();

    const device = await ctx.db
      .query("devices")
      .withIndex("by_serial", (q) => q.eq("serialNumber", serialNumber))
      .unique();
    if (device && (await agentsOfDevice(ctx, device)).includes(user._id)) return "bound" as const;

    // Drop this agent's earlier requests for other serials
    const earlier = await ctx.db
      .query("devices")
      .withIndex("by_requester", (q) => q.eq("requestedBy", user._id))
      .collect();
    for (const old of earlier) {
      if (old.serialNumber === serialNumber) continue;
      // A TPE that is or was bound stays; one that was only ever a request goes
      if (old.boundBy || (await agentsOfDevice(ctx, old)).length > 0) {
        await ctx.db.patch(old._id, { requestedBy: undefined, requestedAt: undefined });
      } else {
        await ctx.db.delete(old._id);
      }
    }

    if (device) {
      await ctx.db.patch(device._id, { requestedBy: user._id, requestedAt: now, lastSync: now });
    } else {
      await ctx.db.insert("devices", {
        serialNumber,
        model,
        status: "active",
        lastSync: now,
        requestedBy: user._id,
        requestedAt: now,
      });
    }
    return "pending" as const;
  },
});

/**
 * Stop an agent (`userId`) from using a device, or every agent when `userId`
 * is omitted, with devices:bind permission. Records the actor and time.
 * Returns the device ID; an agent not on the device is a no-op.
 */
export const unbindDevice = mutation({
  args: { serialNumber: v.string(), userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const actor = await requireBinder(ctx);
    const device = await getDevice(ctx, args.serialNumber);
    const agents = await agentsOfDevice(ctx, device);
    const leaving = args.userId ? agents.filter((a) => a === args.userId) : agents;
    if (leaving.length === 0) return device._id;

    for (const userId of leaving) {
      await removeAgent(ctx, device, userId);
      // Unbound: that phone no longer signs the agent in with their PIN alone
      await revokeDeviceKeys(ctx, userId);
    }
    await ctx.db.patch(device._id, { boundBy: actor._id, boundAt: Date.now() });
    return device._id;
  },
});

/**
 * One-off: move legacy single bindings (devices.assignedTo) into
 * deviceAssignments. Idempotent; run after deploying the shared-TPE schema
 * (the CI runs it after each production deploy).
 */
export const migrateAssignments = internalMutation({
  args: {},
  handler: async (ctx) => {
    let moved = 0;
    for (const d of await ctx.db.query("devices").collect()) {
      if (!d.assignedTo) continue;
      const already = await ctx.db
        .query("deviceAssignments")
        .withIndex("by_user", (q) => q.eq("userId", d.assignedTo!))
        .first();
      if (!already) {
        await ctx.db.insert("deviceAssignments", {
          deviceId: d._id,
          userId: d.assignedTo,
          boundBy: d.boundBy ?? d.assignedTo,
          boundAt: d.boundAt ?? d._creationTime,
        });
        moved++;
      }
      await ctx.db.patch(d._id, { assignedTo: undefined });
    }
    return { moved };
  },
});

/**
 * The caller's own bound terminal ({ serialNumber, model, status }), or null
 * when none is bound or nobody is signed in. Used by the mobile app's
 * bind-device / verify-device screens; also returned as `users.me().device`.
 */
export const myDevice = query({
  args: {},
  handler: async (ctx) => {
    if (!(await getAuthUserId(ctx))) return null;
    const user = await requireUser(ctx);
    return assignedDevice(ctx, user._id);
  },
});

/**
 * A GPS fix from the app, or undefined when it isn't a real position
 * (out-of-range or non-finite coordinates). Accuracy is kept to a sane range.
 */
export function cleanFix(fix: Infer<typeof geoFix> | undefined) {
  if (!fix) return undefined;
  const { lat, lng } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return undefined;
  }
  const accuracy =
    fix.accuracy !== undefined && Number.isFinite(fix.accuracy)
      ? Math.min(100_000, Math.max(0, Math.round(fix.accuracy)))
      : undefined;
  const at = fix.at !== undefined && Number.isFinite(fix.at) ? fix.at : undefined;
  return { lat, lng, accuracy, mocked: fix.mocked === true ? true : undefined, at };
}

const YEAR_MS = 365 * 24 * 3600 * 1000;

const short = (max: number) => (s: string | undefined) =>
  s === undefined ? undefined : s.trim().slice(0, max) || undefined;

/**
 * Check-in from the agent's phone (every ~15 min while the app is open):
 * stamps lastSync and stores what the phone reports, with the agent signed
 * in (`reportedBy`, for shared TPEs). Only an agent allowed on the device can
 * report for it; anything else is ignored, so a phone that was unbound
 * meanwhile doesn't error in a loop.
 */
export const heartbeat = mutation({
  args: {
    serialNumber: v.string(),
    appVersion: v.optional(v.string()),
    updateId: v.optional(v.string()),
    osVersion: v.optional(v.string()),
    battery: v.optional(v.number()),
    charging: v.optional(v.boolean()),
    network: v.optional(v.union(v.literal("wifi"), v.literal("cellular"), v.literal("none"), v.literal("other"))),
    pendingOps: v.optional(v.number()),
    // Phone clock (Date.now()) when it sent the check-in
    clientTime: v.optional(v.number()),
    rooted: v.optional(v.boolean()),
    emulator: v.optional(v.boolean()),
    locationDenied: v.optional(v.boolean()),
    location: v.optional(geoFix),
  },
  handler: async (ctx, { serialNumber, ...report }) => {
    const user = await requireUser(ctx);
    const device = await ctx.db
      .query("devices")
      .withIndex("by_serial", (q) => q.eq("serialNumber", serialNumber.trim().toUpperCase()))
      .unique();
    if (!device || !(await agentsOfDevice(ctx, device)).includes(user._id)) return "ignored" as const;

    const battery =
      report.battery !== undefined && Number.isFinite(report.battery)
        ? Math.min(1, Math.max(0, report.battery))
        : undefined;
    const pendingOps =
      report.pendingOps !== undefined && Number.isFinite(report.pendingOps)
        ? Math.min(100_000, Math.max(0, Math.round(report.pendingOps)))
        : undefined;
    const now = Date.now();
    // Rounded to the second; anything past a year either way is clamped
    const clockSkewMs =
      report.clientTime !== undefined && Number.isFinite(report.clientTime)
        ? Math.round(Math.min(YEAR_MS, Math.max(-YEAR_MS, report.clientTime - now)) / 1000) * 1000
        : undefined;
    await ctx.db.patch(device._id, {
      lastSync: now,
      telemetry: {
        appVersion: short(40)(report.appVersion),
        updateId: short(64)(report.updateId),
        osVersion: short(40)(report.osVersion),
        battery,
        charging: report.charging,
        network: report.network,
        pendingOps,
        clockSkewMs,
        rooted: report.rooted,
        emulator: report.emulator,
        locationDenied: report.locationDenied,
        location: cleanFix(report.location),
        reportedBy: user._id,
      },
    });
    return "ok" as const;
  },
});
