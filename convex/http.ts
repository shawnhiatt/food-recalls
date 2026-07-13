import { httpRouter } from "convex/server";
import { auth } from "./auth";

// Convex Auth mounts its sign-in / token-refresh / verification HTTP endpoints
// here. (One-click email unsubscribe is served by the Next.js /unsubscribe
// page hitting a public mutation, not an HTTP route — see app/unsubscribe.)
const http = httpRouter();
auth.addHttpRoutes(http);

export default http;
