// convex/authz.ts
import { Authz, definePermissions, defineRoles } from "@djpanda/convex-authz";
import { components } from "./_generated/api";

// Step 1: Define specific functional permissions
// This makes it easy to add "Supervisor PIN" overrides later
const permissions = definePermissions({
  transactions: {
    collect: true,     // Ability to log a new cash deposit
    withdraw: true,    // Pay cash out of a customer's savings at the TPE
    view_ledger: true, // View personal daily collection history
    reverse: true,     // Critical: Ability to void a transaction
    audit: true,       // View all transactions across the branch
  },
  kyc: {
    register: true,    // Onboard new clients in the field
    validate: true,    // Verify client documents (Back-office)
  },
  reconciliation: {
    liquidate: true,   // Confirming physical cash-drop from Agent to Branch
  },
  customers: {
    create_prospect: true, // Field onboarding (Draft mode)
    verify_identity: true, // KYC Approval
    edit_sensitive: true,  // Changing phone numbers/bank details
  },
  disbursements: {
    request: true,         // Agent initiates a loan payout
    approve: true,         // Manager authorizes the funds release
    execute: true,         // System/Accountant triggers the final transfer
  },
  devices: {
    bind: true,        // Linking a specific TPE serial number to an agent
  },
  staff: {
    manage: true,      // Create staff, change roles, suspend, issue activation codes
  },
  data: {
    import: true,      // Load customers and past transactions from a spreadsheet
  },
  portfolio: {
    manage: true,      // Product catalogue, a client's product, savings goal targets
  },
});

// Step 2: Define Roles with Inheritance
const roles = defineRoles(permissions, {
  // Core field permissions shared by every collecting role
  base_agent: {
    transactions: ["collect", "view_ledger"],
    kyc: ["register"],
  },

  // Field-based role
  field_agent: {
    includes: ["base_agent"],
    transactions: ["withdraw"],
    customers: ["create_prospect"],
    disbursements: ["request"],
  },

  // Manager-level role
  supervisor: {
    includes: ["field_agent"], // Inherits collection & registration
    transactions: ["reverse", "audit"],
    kyc: ["validate"],
    customers: ["verify_identity", "edit_sensitive"],
    disbursements: ["approve"],
    data: ["import"],
    portfolio: ["manage"],
  },

  // Specialized back-office role
  accountant: {
    transactions: ["audit"],
    reconciliation: ["liquidate"],
    // Only the accountant or a system-level role should execute the money move
    disbursements: ["execute"], 
    customers: ["verify_identity"],
    data: ["import"],
    portfolio: ["manage"],
  },

  // System management
  it_admin: {
    devices: ["bind"],
    staff: ["manage"],
    data: ["import"],
    // Usually IT shouldn't have 'collect' or 'reverse' permissions (Separation of Duties)
  },
});

// Step 3: Create the client
// Using the branchId as the tenantId ensures data isolation
export const authz = new Authz(components.authz, { 
  permissions, 
  roles, 
  tenantId: "branch-ouaga-01" 
});