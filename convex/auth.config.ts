// convex/auth.config.ts — Convex Auth issues and verifies its own JWTs
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
