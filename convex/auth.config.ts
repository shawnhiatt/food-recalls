// Convex Auth JWT config (SPEC.md §5 / §17.7). The deployment validates its
// own issued tokens: `domain` is this deployment's site URL (CONVEX_SITE_URL is
// injected by Convex), `applicationID` is the fixed "convex" audience the
// library signs with. JWT_PRIVATE_KEY / JWKS env vars back the signing keys.
const authConfig = {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
