"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { type ReactNode } from "react";

// Convex Auth (Phase 5, SPEC.md §5): the client provider manages the auth token
// and exposes useAuthActions()/useConvexAuth() to the tree. Paired with
// ConvexAuthNextjsServerProvider (app/layout.tsx) + middleware.ts for SSR.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>;
}
