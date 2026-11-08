// convex/seed.ts — dev-only mock data
import { internalMutation } from "./_generated/server";
import { authz } from "./authz";

export const seedDatabase = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Already seeded: no-op, so running it twice (or on real data) is harmless
    if (await ctx.db.query("organizations").first()) return null;

    // ── Organization ─────────────────────────────────────────────────────────
    const org = await ctx.db.insert("organizations", {
      name: "Kauri Finance S.A.",
      country: "BF",
      currency: "XOF",
      licenseNumber: "BCEAO-MFI-2019-0047",
      status: "active",
    });

    // ── Branches ────────────────────────────────────────────────────────────
    const branchOuaga = await ctx.db.insert("branches", {
      organizationId: org,
      name: "Agence Ouagadougou Centre",
      location: "Ouagadougou, Kadiogo",
      code: "OUAGA-01",
    });
    const branchBobo = await ctx.db.insert("branches", {
      organizationId: org,
      name: "Agence Bobo-Dioulasso",
      location: "Bobo-Dioulasso, Houet",
      code: "BOBO-01",
    });

    // ── Users ────────────────────────────────────────────────────────────────
    const supervisor = await ctx.db.insert("users", {
      fullName: "Aminata Ouédraogo",
      email: "aminata.ouedraogo@kauri.bf",
      phoneNumber: "+22670112233",
      branchId: branchOuaga,
      status: "active",
    });
    const agent1 = await ctx.db.insert("users", {
      fullName: "Seydou Compaoré",
      email: "seydou.compaore@kauri.bf",
      phoneNumber: "+22676445566",
      branchId: branchOuaga,
      status: "active",
    });
    const agent2 = await ctx.db.insert("users", {
      fullName: "Mariam Traoré",
      email: "mariam.traore@kauri.bf",
      phoneNumber: "+22678990011",
      branchId: branchOuaga,
      status: "active",
    });
    const accountant = await ctx.db.insert("users", {
      fullName: "Ibrahim Sawadogo",
      email: "ibrahim.sawadogo@kauri.bf",
      phoneNumber: "+22665223344",
      branchId: branchOuaga,
      status: "active",
    });
    const agentBobo = await ctx.db.insert("users", {
      fullName: "Fatimata Coulibaly",
      email: "fatimata.coulibaly@kauri.bf",
      phoneNumber: "+22671556677",
      branchId: branchBobo,
      status: "active",
    });

    const itAdmin = await ctx.db.insert("users", {
      fullName: "Oumar Zida",
      email: "oumar.zida@kauri.bf",
      phoneNumber: "+22665440011",
      branchId: branchOuaga,
      status: "active",
    });

    // ── Roles (authz user IDs are users._id) ─────────────────────────────────
    await authz.assignRole(ctx, supervisor, "supervisor");
    await authz.assignRole(ctx, agent1, "field_agent");
    await authz.assignRole(ctx, agent2, "field_agent");
    await authz.assignRole(ctx, agentBobo, "field_agent");
    await authz.assignRole(ctx, accountant, "accountant");
    await authz.assignRole(ctx, itAdmin, "it_admin");

    // ── Devices ──────────────────────────────────────────────────────────────
    const tpe1 = await ctx.db.insert("devices", {
      serialNumber: "TPE-BF-0041",
      model: "Ingenico iWL250",
      status: "active",
      lastSync: Date.now() - 1000 * 60 * 30, // 30 min ago
    });
    const tpe2 = await ctx.db.insert("devices", {
      serialNumber: "TPE-BF-0042",
      model: "Ingenico iWL250",
      status: "active",
      lastSync: Date.now() - 1000 * 60 * 45,
    });
    const tpe3 = await ctx.db.insert("devices", {
      serialNumber: "TPE-BF-0043",
      model: "PAX A920",
      status: "active",
      lastSync: Date.now() - 1000 * 60 * 60,
    });
    // Who may collect with each TPE (a TPE can be shared; one TPE per agent)
    for (const [deviceId, userId] of [[tpe1, agent1], [tpe2, agent2], [tpe3, agentBobo]] as const) {
      await ctx.db.insert("deviceAssignments", { deviceId, userId, boundBy: itAdmin, boundAt: Date.now() });
    }
    await ctx.db.insert("devices", {
      serialNumber: "TPE-BF-0099",
      model: "Ingenico iWL250",
      status: "maintenance",
      lastSync: Date.now() - 1000 * 60 * 60 * 72,
    });

    // ── Customers ────────────────────────────────────────────────────────────
    const customer1 = await ctx.db.insert("customers", {
      fullName: "Adama Kaboré",
      phoneNumber: "+22677001122",
      idNumber: "BF-CNI-192837",
      branchId: branchOuaga,
      onboardedBy: agent1,
      status: "verified",
    });
    const customer2 = await ctx.db.insert("customers", {
      fullName: "Salimata Zongo",
      phoneNumber: "+22670334455",
      idNumber: "BF-CNI-556677",
      branchId: branchOuaga,
      onboardedBy: agent1,
      status: "verified",
    });
    const customer3 = await ctx.db.insert("customers", {
      fullName: "Moussa Diallo",
      phoneNumber: "+22676778899",
      idNumber: "BF-CNI-910112",
      branchId: branchOuaga,
      onboardedBy: agent2,
      status: "verified",
    });
    const customer4 = await ctx.db.insert("customers", {
      fullName: "Rasmata Kinda",
      phoneNumber: "+22678123456",
      idNumber: "BF-CNI-131415",
      branchId: branchOuaga,
      onboardedBy: agent2,
      status: "prospect",
    });
    const customer5 = await ctx.db.insert("customers", {
      fullName: "Boureima Ouattara",
      phoneNumber: "+22671654321",
      idNumber: "BF-CNI-161718",
      branchId: branchBobo,
      onboardedBy: agentBobo,
      status: "verified",
    });

    // ── Transactions ─────────────────────────────────────────────────────────
    const today = Date.now();
    const daysAgo = (n: number) => today - n * 86_400_000;

    const tx1 = await ctx.db.insert("transactions", {
      amount: 50_000,
      currency: "XOF",
      customerId: customer1,
      agentId: agent1,
      branchId: branchOuaga,
      tpeId: "TPE-BF-0041",
      status: "completed",
      timestamp: daysAgo(0) - 1000 * 60 * 120,
    });
    await ctx.db.insert("transactions", {
      amount: 75_000,
      currency: "XOF",
      customerId: customer2,
      agentId: agent1,
      branchId: branchOuaga,
      tpeId: "TPE-BF-0041",
      status: "completed",
      timestamp: daysAgo(0) - 1000 * 60 * 90,
    });
    await ctx.db.insert("transactions", {
      amount: 25_000,
      currency: "XOF",
      customerId: customer1,
      agentId: agent1,
      branchId: branchOuaga,
      tpeId: "TPE-BF-0041",
      status: "reversed",
      reversalReason: "Erreur de montant saisi",
      reversedBy: supervisor,
      timestamp: daysAgo(0) - 1000 * 60 * 60,
    });
    await ctx.db.insert("transactions", {
      amount: 100_000,
      currency: "XOF",
      customerId: customer3,
      agentId: agent2,
      branchId: branchOuaga,
      tpeId: "TPE-BF-0042",
      status: "completed",
      timestamp: daysAgo(0) - 1000 * 60 * 150,
    });
    await ctx.db.insert("transactions", {
      amount: 60_000,
      currency: "XOF",
      customerId: customer5,
      agentId: agentBobo,
      branchId: branchBobo,
      tpeId: "TPE-BF-0043",
      status: "completed",
      timestamp: daysAgo(1) - 1000 * 60 * 200,
    });

    // ── Disbursements ────────────────────────────────────────────────────────
    await ctx.db.insert("disbursements", {
      amount: 200_000,
      customerId: customer1,
      branchId: branchOuaga,
      initiatedBy: agent1,
      approvedBy: supervisor,
      status: "approved",
      payoutMethod: "mobile_money",
      timestamp: daysAgo(1),
    });
    await ctx.db.insert("disbursements", {
      amount: 150_000,
      customerId: customer3,
      branchId: branchOuaga,
      initiatedBy: agent2,
      status: "pending",
      payoutMethod: "cash",
      timestamp: daysAgo(0) - 1000 * 60 * 30,
    });

    // ── Reconciliations ──────────────────────────────────────────────────────
    const yesterday = new Date(daysAgo(1)).toISOString().split("T")[0];
    await ctx.db.insert("reconciliations", {
      agentId: agent1,
      branchId: branchOuaga,
      verifiedBy: accountant,
      date: yesterday,
      systemExpectedAmount: 125_000,
      physicalCashReceived: 125_000,
      variance: 0,
      status: "settled",
      timestamp: daysAgo(1) + 1000 * 60 * 60 * 17, // 5pm
    });
    await ctx.db.insert("reconciliations", {
      agentId: agentBobo,
      branchId: branchBobo,
      verifiedBy: accountant,
      date: yesterday,
      systemExpectedAmount: 60_000,
      physicalCashReceived: 55_000,
      variance: -5_000,
      status: "discrepancy",
      notes: "Agent déclare avoir rendu la monnaie à un client",
      timestamp: daysAgo(1) + 1000 * 60 * 60 * 16,
    });

    return {
      organization: org,
      branches: [branchOuaga, branchBobo],
      users: [supervisor, agent1, agent2, accountant, agentBobo, itAdmin],
      customers: [customer1, customer2, customer3, customer4, customer5],
    };
  },
});
