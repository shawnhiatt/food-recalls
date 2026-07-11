import { convexTest } from "convex-test";
import schema from "../convex/schema";

// convex-test needs the function modules; this glob mirrors the convex/ dir.
export const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

export function setupConvex() {
  return convexTest(schema, modules);
}
