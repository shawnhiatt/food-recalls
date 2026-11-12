import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { fdaRssRelay } from "./ingest/fdaRelay";

// Convex Auth mounts its sign-in / token-refresh / verification HTTP endpoints
// here. (One-click email unsubscribe is served by the Next.js /unsubscribe
// page hitting a public mutation, not an HTTP route — see app/unsubscribe.)
const http = httpRouter();
auth.addHttpRoutes(http);

// FDA press relay (T5): an off-Convex relay POSTs fda.gov's feed and press
// pages here, because fda.gov denies Convex's egress. Shared-secret auth.
http.route({ path: "/relay/fda-rss", method: "POST", handler: fdaRssRelay });

export default http;
